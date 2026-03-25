import { useState, useEffect, useCallback, useReducer, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  TrendingUp, TrendingDown, Minus, Scale, Plus, X, Check,
  Camera, Clock, Upload, Image, Trash2,
} from 'lucide-react';
import Skeleton from '../../components/Skeleton';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, parseISO, subDays } from 'date-fns';
import {
  MEASUREMENT_FIELDS, PERIOD_OPTIONS,
  fmtW, today, cmToIn, inToCm,
} from './progressConstants';
import ChartTooltip from '../../components/ChartTooltip';

// ── MeasurementsModal ────────────────────────────────────────────────────────

// Reducer for the 8 measurement form fields + saving/error/scan state (10 related states)
const modalInitialState = {
  form: {},
  saving: false,
  error: '',
  scanning: false,
  scanPreview: null,
};

function modalReducer(state, action) {
  switch (action.type) {
    case 'SET_FORM':
      return { ...state, form: action.payload };
    case 'UPDATE_FIELD':
      return { ...state, form: { ...state.form, [action.key]: action.value } };
    case 'MERGE_ESTIMATES':
      return {
        ...state,
        form: MEASUREMENT_FIELDS.reduce((next, f) => {
          if (action.estimates[f.key] != null && (state.form[f.key] === '' || state.form[f.key] === undefined)) {
            // AI returns cm — convert to inches for display
            const val = f.dbUnit === 'cm' ? cmToIn(action.estimates[f.key]) : action.estimates[f.key];
            next[f.key] = String(val);
          }
          return next;
        }, { ...state.form }),
      };
    case 'SET_SAVING':
      return { ...state, saving: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_SCANNING':
      return { ...state, scanning: action.payload };
    case 'SET_SCAN_PREVIEW':
      return { ...state, scanPreview: action.payload };
    default:
      return state;
  }
}

const MEASUREMENT_LABEL_KEYS = {
  chest_cm: 'progress.body.chest',
  waist_cm: 'progress.body.waist',
  hips_cm: 'progress.body.hips',
  left_arm_cm: 'progress.body.leftArm',
  right_arm_cm: 'progress.body.rightArm',
  left_thigh_cm: 'progress.body.leftThigh',
  right_thigh_cm: 'progress.body.rightThigh',
  body_fat_pct: 'progress.body.bodyFat',
};

// ── Measurement Trend Chart ──────────────────────────────────────────────────
const MeasurementChart = ({ history, metrics }) => {
  const [activeMetric, setActiveMetric] = useState(0);
  const metric = metrics[activeMetric];

  const chartData = useMemo(() => {
    return [...history].reverse().map(m => {
      let val;
      if (metric.avg) {
        const vals = metric.avg.map(k => m[k]).filter(Boolean);
        val = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      } else {
        val = m[metric.key];
      }
      if (val == null) return null;
      return {
        date: format(parseISO(m.measured_at), 'MMM d'),
        value: metric.convert ? cmToIn(val) : Math.round(val * 10) / 10,
      };
    }).filter(Boolean);
  }, [history, metric]);

  if (chartData.length < 2) return null;

  const values = chartData.map(d => d.value);
  const yMin = Math.floor(Math.min(...values) - 1);
  const yMax = Math.ceil(Math.max(...values) + 1);
  const first = values[0];
  const last = values[values.length - 1];
  const totalDelta = Math.round((last - first) * 10) / 10;

  return (
    <div className="mt-4 pt-4 border-t border-white/[0.06]">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold text-[#4B5563] uppercase tracking-[0.12em]">Progress Trends</p>
        {totalDelta !== 0 && (
          <span className="text-[10px] font-bold tabular-nums" style={{ color: totalDelta > 0 ? (metric.key === 'waist_cm' || metric.key === 'body_fat_pct' ? '#EF4444' : '#10B981') : (metric.key === 'waist_cm' || metric.key === 'body_fat_pct' ? '#10B981' : '#EF4444') }}>
            {totalDelta > 0 ? '+' : ''}{totalDelta}{metric.unit}
          </span>
        )}
      </div>

      {/* Metric selector pills */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto scroll-smooth scrollbar-none">
        {metrics.map((m, i) => (
          <button key={m.key} onClick={() => setActiveMetric(i)}
            className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold flex-shrink-0 transition-all"
            style={activeMetric === i
              ? { background: `${m.color}18`, color: m.color, border: `1px solid ${m.color}30` }
              : { background: 'rgba(17,24,39,0.6)', color: '#4B5563', border: '1px solid rgba(255,255,255,0.06)' }
            }>
            {m.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={150}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="measGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={metric.color} stopOpacity={0.2} />
              <stop offset="95%" stopColor={metric.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#4B5563' }} tickLine={false} axisLine={false} />
          <YAxis domain={[yMin, yMax]} tick={{ fontSize: 9, fill: '#4B5563' }} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip formatter={(v) => `${v} ${metric.unit}`} />} cursor={{ fill: `${metric.color}08` }} />
          <Area type="monotone" dataKey="value" stroke={metric.color} strokeWidth={2} fill="url(#measGrad)" dot={false} activeDot={{ r: 5, strokeWidth: 2, fill: metric.color }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

const SCAN_STEPS = [
  { id: 'front', label: 'Front View', instruction: 'Stand facing the camera, arms relaxed at your sides, feet shoulder-width apart.' },
  { id: 'side', label: 'Side View', instruction: 'Turn 90° to your right. Stand naturally with arms at your sides.' },
];

const compressImage = (file, maxW = 800) => new Promise((resolve, reject) => {
  const img = new Image();
  const objectUrl = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(objectUrl);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, maxW / img.width);
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(resolve, 'image/jpeg', 0.7);
  };
  img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Failed to load image')); };
  img.src = objectUrl;
});

const blobToBase64 = (blob) => new Promise((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result.split(',')[1]);
  r.readAsDataURL(blob);
});

const MeasurementsModal = ({ existing, gymId, profileId, onSaved, onClose }) => {
  const { t } = useTranslation('pages');
  const empty = MEASUREMENT_FIELDS.reduce((a, f) => ({ ...a, [f.key]: '' }), {});
  const initialForm = existing
    ? MEASUREMENT_FIELDS.reduce(
        (a, f) => {
          if (existing[f.key] == null) return { ...a, [f.key]: '' };
          // Convert cm to inches for display (body_fat_pct stays as-is)
          const val = f.dbUnit === 'cm' ? cmToIn(existing[f.key]) : existing[f.key];
          return { ...a, [f.key]: String(val) };
        },
        {}
      )
    : empty;

  const [state, dispatch] = useReducer(modalReducer, {
    ...modalInitialState,
    form: initialForm,
  });
  const { form, saving, error, scanning, scanPreview } = state;
  const fileRef = useRef(null);

  // Guided scan state
  const [scanMode, setScanMode] = useState(false);
  const [scanStep, setScanStep] = useState(0);
  const [frontPhoto, setFrontPhoto] = useState(null); // { preview, base64 }
  const [sidePhoto, setSidePhoto] = useState(null);
  const [scanResult, setScanResult] = useState(null); // AI response with derived metrics

  const handlePhotoCapture = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      const compressed = await compressImage(file);
      const base64 = await blobToBase64(compressed);

      // Thumbnail for preview
      const thumbBlob = await compressImage(file, 200);
      const thumbReader = new FileReader();
      const preview = await new Promise(r => { thumbReader.onload = ev => r(ev.target.result); thumbReader.readAsDataURL(thumbBlob); });

      if (scanStep === 0) {
        setFrontPhoto({ preview, base64 });
        setScanStep(1);
      } else {
        setSidePhoto({ preview, base64 });
        // Both photos captured — run analysis
        await runAnalysis(frontPhoto.base64, base64);
      }
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: 'Failed to process photo' });
    }
  };

  const skipSidePhoto = async () => {
    if (frontPhoto) {
      await runAnalysis(frontPhoto.base64, null);
    }
  };

  const runAnalysis = async (frontBase64, sideBase64) => {
    dispatch({ type: 'SET_SCANNING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: '' });

    try {
      const body = { image: frontBase64 };
      if (sideBase64) body.sideImage = sideBase64;

      const { data, error: fnError } = await supabase.functions.invoke('analyze-body-photo', { body });

      if (fnError) {
        let msg = fnError.message || 'Analysis failed';
        try { const b = await fnError.context?.json(); if (b?.error) msg = b.error; } catch {}
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);

      if (data?.estimates) {
        dispatch({ type: 'MERGE_ESTIMATES', estimates: data.estimates });
        setScanResult(data.estimates);
        setScanMode(false);
      }
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Photo analysis failed' });
      setScanMode(false);
    } finally {
      dispatch({ type: 'SET_SCANNING', payload: false });
    }
  };

  const resetScan = () => {
    setScanMode(true);
    setScanStep(0);
    setFrontPhoto(null);
    setSidePhoto(null);
    setScanResult(null);
  };

  const handleSave = async () => {
    dispatch({ type: 'SET_SAVING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: '' });
    try {
      const payload = { profile_id: profileId, gym_id: gymId, measured_at: today() };
      MEASUREMENT_FIELDS.forEach(f => {
        if (form[f.key] === '' || form[f.key] == null) {
          payload[f.key] = null;
        } else {
          const val = parseFloat(form[f.key]);
          // Convert inches back to cm for DB storage (body_fat_pct stays as-is)
          payload[f.key] = f.dbUnit === 'cm' ? inToCm(val) : val;
        }
      });
      const { error: err } = await supabase
        .from('body_measurements')
        .upsert(payload, { onConflict: 'profile_id,measured_at' });
      if (err) throw new Error(err.message);
      onSaved();
      onClose();
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message === 'Load failed' ? 'Network error — check your connection and try again.' : (err.message || 'Failed to save') });
      dispatch({ type: 'SET_SAVING', payload: false });
    }
  };

  const currentStep = SCAN_STEPS[scanStep];

  // ── Guided scan overlay ──────────────────────────────────
  if (scanMode && !scanning) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl" onClick={() => setScanMode(false)}>
        <div className="relative w-full max-w-md mx-4 rounded-[28px] overflow-hidden"
          style={{ background: 'linear-gradient(180deg, #0C1222 0%, #080D18 100%)', boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)' }}
          onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="px-6 pt-6 pb-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold text-[#4B5563] uppercase tracking-[0.15em]">Body Scan</p>
              <button onClick={() => setScanMode(false)}>
                <X size={18} className="text-[#6B7280]" />
              </button>
            </div>
            <h3 className="text-[20px] font-bold text-white">{currentStep.label}</h3>
            <p className="text-[12px] text-[#6B7280] mt-1 leading-relaxed">{currentStep.instruction}</p>
          </div>

          {/* Step indicators */}
          <div className="flex gap-2 px-6 mb-5">
            {SCAN_STEPS.map((s, i) => (
              <div key={s.id} className="flex-1 h-[3px] rounded-full" style={{
                background: i < scanStep ? '#10B981' : i === scanStep ? '#D4AF37' : 'rgba(255,255,255,0.06)',
              }} />
            ))}
          </div>

          {/* Photo preview area */}
          <div className="mx-6 mb-5 aspect-[3/4] rounded-[18px] overflow-hidden flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.02)', border: '2px dashed rgba(255,255,255,0.08)' }}>
            {scanStep === 1 && frontPhoto ? (
              <div className="relative w-full h-full">
                <img src={frontPhoto.preview} alt="Front" className="w-full h-full object-cover opacity-30" />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <Check size={32} className="text-[#10B981] mb-2" />
                  <p className="text-[12px] font-semibold text-[#10B981]">Front captured</p>
                  <p className="text-[11px] text-[#6B7280] mt-1">Now take the side view</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                {/* Silhouette */}
                <svg width="80" height="160" viewBox="0 0 80 160" fill="none" className="opacity-20 mb-3">
                  {scanStep === 0 ? (
                    // Front silhouette
                    <path d="M40 8 C44 8 48 12 48 18 C48 24 44 28 40 28 C36 28 32 24 32 18 C32 12 36 8 40 8 Z M28 32 L52 32 C56 32 58 36 58 40 L58 80 L52 80 L52 120 L44 120 L44 152 L36 152 L36 120 L28 120 L28 80 L22 80 L22 40 C22 36 24 32 28 32 Z" fill="white" />
                  ) : (
                    // Side silhouette
                    <path d="M40 8 C44 8 47 12 47 18 C47 24 44 28 40 28 C36 28 33 24 33 18 C33 12 36 8 40 8 Z M34 32 L46 32 C50 32 54 36 54 40 L52 80 L48 80 L46 120 L42 120 L42 152 L38 152 L38 120 L34 120 L32 80 L28 80 L26 40 C26 36 30 32 34 32 Z" fill="white" />
                  )}
                </svg>
                <p className="text-[11px] text-[#374151]">Align yourself with the outline</p>
              </div>
            )}
          </div>

          {/* Tips */}
          <div className="mx-6 mb-5 px-4 py-3 rounded-[14px]" style={{ background: 'rgba(212,175,55,0.04)', border: '1px solid rgba(212,175,55,0.08)' }}>
            <p className="text-[10px] text-[#6B7280] leading-relaxed">
              <span className="text-[#D4AF37] font-semibold">Tips:</span> Wear fitted clothing. Use consistent lighting. Stand 5-6 feet from camera. Photos are analyzed and immediately discarded.
            </p>
          </div>

          {/* Action buttons */}
          <div className="px-6 pb-6">
            <button onClick={() => fileRef.current?.click()}
              className="w-full py-[16px] rounded-[16px] font-bold text-[14px] flex items-center justify-center gap-2 active:scale-[0.97] transition-all mb-3"
              style={{ background: 'linear-gradient(135deg, #D4AF37 0%, #C4A030 100%)', color: '#000', boxShadow: '0 4px 16px rgba(212,175,55,0.25)' }}>
              <Camera size={18} /> Take {currentStep.label} Photo
            </button>
            {scanStep === 1 && (
              <button onClick={skipSidePhoto}
                className="w-full py-3 rounded-[14px] text-[12px] font-semibold text-[#6B7280] active:scale-[0.97] transition-all"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                Skip side photo (less accurate)
              </button>
            )}
          </div>

          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" className="hidden" onChange={handlePhotoCapture} />
        </div>
      </div>
    );
  }

  // ── Main modal (form + results) ──────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/80 backdrop-blur-xl" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-t-[28px] md:rounded-[28px]"
        style={{ background: 'linear-gradient(180deg, #0F172A 0%, #0B1120 100%)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 24px 80px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
          <p className="text-[17px] font-bold text-[#E5E7EB]">
            {existing ? t('progress.body.updateMeasurements') : t('progress.body.addMeasurements')}
          </p>
          <button onClick={onClose} aria-label="Close"><X size={18} className="text-[#6B7280]" /></button>
        </div>

        <div className="p-5 max-h-[65vh] overflow-y-auto">
          {/* AI Body Scan button */}
          <div className="mb-5">
            {scanning ? (
              <div className="flex flex-col items-center py-6 rounded-[16px]" style={{ background: 'rgba(212,175,55,0.04)', border: '1px solid rgba(212,175,55,0.1)' }}>
                <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin mb-3" />
                <p className="text-[13px] font-semibold text-[#D4AF37]">Analyzing your photos...</p>
                <p className="text-[10px] text-[#4B5563] mt-1">Estimating body composition</p>
              </div>
            ) : scanResult ? (
              <div className="rounded-[16px] overflow-hidden" style={{ background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.1)' }}>
                <div className="px-4 py-3.5 flex items-center gap-3">
                  <div className="flex gap-2">
                    {frontPhoto && <img src={frontPhoto.preview} alt="" className="w-10 h-14 rounded-lg object-cover" style={{ border: '1px solid rgba(255,255,255,0.08)' }} />}
                    {sidePhoto && <img src={sidePhoto.preview} alt="" className="w-10 h-14 rounded-lg object-cover" style={{ border: '1px solid rgba(255,255,255,0.08)' }} />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <Check size={13} className="text-[#10B981]" />
                      <span className="text-[12px] font-bold text-[#10B981]">Scan complete</span>
                    </div>
                    <p className="text-[10px] text-[#6B7280] mt-0.5">
                      {scanResult.scan_quality === 'good' ? 'High quality scan' : scanResult.scan_quality === 'fair' ? 'Fair quality — ' + (scanResult.scan_notes || '') : 'Low quality — ' + (scanResult.scan_notes || '')}
                    </p>
                  </div>
                  <button onClick={resetScan} className="text-[10px] font-semibold text-[#D4AF37]">Rescan</button>
                </div>

                {/* Derived metrics */}
                {(scanResult.lean_mass_kg || scanResult.waist_to_hip || scanResult.ffmi) && (
                  <div className="px-4 pb-3.5 pt-0 flex gap-2 flex-wrap">
                    {scanResult.body_fat_pct != null && (
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-semibold" style={{ background: 'rgba(245,158,11,0.08)', color: '#F59E0B' }}>
                        {scanResult.body_fat_pct}% BF
                      </span>
                    )}
                    {scanResult.lean_mass_kg != null && (
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-semibold" style={{ background: 'rgba(16,185,129,0.08)', color: '#10B981' }}>
                        {scanResult.lean_mass_kg}kg lean
                      </span>
                    )}
                    {scanResult.ffmi != null && (
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-semibold" style={{ background: 'rgba(96,165,250,0.08)', color: '#60A5FA' }}>
                        FFMI {scanResult.ffmi}
                      </span>
                    )}
                    {scanResult.waist_to_hip != null && (
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-semibold" style={{ background: 'rgba(167,139,250,0.08)', color: '#A78BFA' }}>
                        W/H {scanResult.waist_to_hip}
                      </span>
                    )}
                  </div>
                )}

                {/* AI disclaimer */}
                <div className="px-4 pb-3.5">
                  <p className="text-[9px] text-[#374151] leading-relaxed">
                    AI estimates may vary ±3-5%. Edit values below for accuracy. Photos were not stored.
                  </p>
                </div>
              </div>
            ) : (
              <button onClick={resetScan}
                className="w-full py-4 rounded-[16px] flex flex-col items-center gap-2 active:scale-[0.97] transition-all"
                style={{ background: 'rgba(212,175,55,0.04)', border: '1px solid rgba(212,175,55,0.1)' }}>
                <Camera size={22} className="text-[#D4AF37]" />
                <span className="text-[13px] font-bold text-[#D4AF37]">AI Body Scan</span>
                <span className="text-[10px] text-[#4B5563]">2 photos (front + side) for best accuracy</span>
              </button>
            )}
          </div>

          {/* Manual fields */}
          <div className="grid grid-cols-2 gap-3">
            {MEASUREMENT_FIELDS.map(f => (
              <div key={f.key}>
                <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                  {MEASUREMENT_LABEL_KEYS[f.key] ? t(MEASUREMENT_LABEL_KEYS[f.key]) : f.label} ({f.unit})
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  placeholder="—"
                  value={form[f.key]}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === '' || v === '-') return dispatch({ type: 'UPDATE_FIELD', key: f.key, value: v });
                    const n = parseFloat(v);
                    dispatch({ type: 'UPDATE_FIELD', key: f.key, value: !isNaN(n) && n < 0 ? '0' : v });
                  }}
                  className="w-full bg-[#111827] border border-white/[0.06] rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
                />
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-[12px] text-red-400 px-5 pb-2">{error}</p>}
        <div className="px-5 pb-5">
          <button onClick={handleSave} disabled={saving}
            className="w-full py-[14px] rounded-[16px] font-bold text-[14px] active:scale-[0.97] transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #D4AF37 0%, #C4A030 100%)', color: '#000', boxShadow: '0 4px 16px rgba(212,175,55,0.2)' }}>
            {saving ? t('progress.body.saving') : t('progress.body.saveMeasurements')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Body tab reducer (consolidates 10 related useState calls) ────────────────
const bodyInitialState = {
  weightLogs: [],
  chartData: [],
  period: 90,
  weightInput: '',
  loggingWeight: false,
  weightError: '',
  latestMeasurements: null,
  prevMeasurements: null,
  measurementHistory: [],
  showMeasurements: false,
  showWeightHistory: false,
  loading: true,
};

function bodyReducer(state, action) {
  switch (action.type) {
    case 'SET_DATA':
      return {
        ...state,
        weightLogs: action.weightLogs,
        chartData: action.chartData,
        latestMeasurements: action.latestMeasurements,
        prevMeasurements: action.prevMeasurements || null,
        measurementHistory: action.measurementHistory || [],
        loading: false,
      };
    case 'SET_LOADING':
      return { ...state, loading: true };
    case 'SET_PERIOD':
      return { ...state, period: action.payload };
    case 'SET_WEIGHT_INPUT':
      return { ...state, weightInput: action.payload, weightError: '' };
    case 'SET_LOGGING_WEIGHT':
      return { ...state, loggingWeight: action.payload };
    case 'SET_WEIGHT_ERROR':
      return { ...state, weightError: action.payload };
    case 'CLEAR_WEIGHT_INPUT':
      return { ...state, weightInput: '' };
    case 'TOGGLE_MEASUREMENTS':
      return { ...state, showMeasurements: action.payload };
    case 'TOGGLE_WEIGHT_HISTORY':
      return { ...state, showWeightHistory: action.payload };
    default:
      return state;
  }
}

// ── BodyTab ──────────────────────────────────────────────────────────────────
export default function ProgressBody() {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const [state, dispatch] = useReducer(bodyReducer, bodyInitialState);
  const {
    weightLogs, chartData, period, weightInput, loggingWeight,
    weightError, latestMeasurements, prevMeasurements, measurementHistory, showMeasurements, showWeightHistory, loading,
  } = state;

  const [progressPhotos, setProgressPhotos] = useState([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef(null);

  const loadData = useCallback(async () => {
    if (!user) return;
    dispatch({ type: 'SET_LOADING' });

    const from = subDays(new Date(), period).toISOString().slice(0, 10);

    const [{ data: logs }, { data: measHistory }, { data: photos }] = await Promise.all([
      supabase
        .from('body_weight_logs')
        .select('id, weight_lbs, logged_at, notes')
        .eq('profile_id', user.id)
        .gte('logged_at', from)
        .order('logged_at', { ascending: true }),
      supabase
        .from('body_measurements')
        .select('id, measured_at, chest_cm, waist_cm, hips_cm, left_arm_cm, right_arm_cm, left_thigh_cm, right_thigh_cm, body_fat_pct')
        .eq('profile_id', user.id)
        .order('measured_at', { ascending: false })
        .limit(10),
      supabase
        .from('progress_photos')
        .select('id, storage_path, view_angle, taken_at, created_at')
        .eq('profile_id', user.id)
        .order('taken_at', { ascending: false })
        .limit(12),
    ]);

    const allLogs = logs ?? [];
    const allMeas = measHistory ?? [];

    // Resolve photo URLs
    if (photos?.length) {
      const withUrls = await Promise.all(photos.map(async (p) => {
        const { data: urlData } = supabase.storage.from('progress-photos').getPublicUrl(p.storage_path);
        return { ...p, url: urlData?.publicUrl || null };
      }));
      setProgressPhotos(withUrls.filter(p => p.url));
    } else {
      setProgressPhotos([]);
    }
    dispatch({
      type: 'SET_DATA',
      weightLogs: [...allLogs].reverse(),
      chartData: allLogs.map(l => ({
        date: format(parseISO(l.logged_at), 'MMM d'),
        weight: parseFloat(l.weight_lbs),
      })),
      latestMeasurements: allMeas[0] ?? null,
      prevMeasurements: allMeas[1] ?? null,
      measurementHistory: allMeas,
    });
  }, [user, period]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Lock body scroll when modals are open
  useEffect(() => {
    if (showWeightHistory || showMeasurements) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showWeightHistory, showMeasurements]);

  const handleLogWeight = async () => {
    const w = parseFloat(weightInput);
    if (!w || w <= 0) {
      dispatch({ type: 'SET_WEIGHT_ERROR', payload: t('progress.body.enterValidWeight') });
      return;
    }
    dispatch({ type: 'SET_LOGGING_WEIGHT', payload: true });
    dispatch({ type: 'SET_WEIGHT_ERROR', payload: '' });

    const { error } = await supabase
      .from('body_weight_logs')
      .upsert(
        { profile_id: user.id, gym_id: profile.gym_id, weight_lbs: w, logged_at: today() },
        { onConflict: 'profile_id,logged_at' }
      );

    if (error) {
      dispatch({ type: 'SET_WEIGHT_ERROR', payload: error.message });
      dispatch({ type: 'SET_LOGGING_WEIGHT', payload: false });
      return;
    }
    dispatch({ type: 'CLEAR_WEIGHT_INPUT' });
    loadData();
    dispatch({ type: 'SET_LOGGING_WEIGHT', payload: false });
  };

  const latest = weightLogs[0];
  const earliest = weightLogs[weightLogs.length - 1];
  const currentW = latest ? parseFloat(latest.weight_lbs) : null;
  const startingW = earliest ? parseFloat(earliest.weight_lbs) : null;
  const delta =
    currentW != null && startingW != null && weightLogs.length > 1
      ? currentW - startingW
      : null;

  const DeltaIcon = delta == null ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const deltaColor = delta == null ? '#6B7280' : delta > 0 ? '#EF4444' : '#10B981';

  const yMin = chartData.length
    ? Math.floor(Math.min(...chartData.map(d => d.weight)) - 2)
    : undefined;
  const yMax = chartData.length
    ? Math.ceil(Math.max(...chartData.map(d => d.weight)) + 2)
    : undefined;

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton variant="chart" />
        <Skeleton variant="card" height="h-[60px]" count={4} />
      </div>
    );
  }

  return (
    <div>
      {/* Log weight bar */}
      <div className="flex items-center gap-2 rounded-xl px-4 py-3 mb-4 border border-[#D4AF37]/25" style={{ background: 'rgba(212,175,55,0.06)' }}>
        <Scale size={16} className="text-[#D4AF37] flex-shrink-0" />
        <input
          type="number"
          inputMode="decimal"
          min={0}
          placeholder={weightLogs[0]?.logged_at === today() ? fmtW(weightLogs[0].weight_lbs) : t('progress.body.enterTodaysWeight')}
          value={weightInput}
          onChange={e => {
            const v = e.target.value;
            if (v === '' || v === '-') return dispatch({ type: 'SET_WEIGHT_INPUT', payload: v });
            const n = parseFloat(v);
            dispatch({ type: 'SET_WEIGHT_INPUT', payload: !isNaN(n) && n < 0 ? '0' : v });
          }}
          onKeyDown={e => e.key === 'Enter' && handleLogWeight()}
          className="flex-1 min-w-0 bg-transparent text-[14px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none"
        />
        <span className="text-[12px] text-[#6B7280] flex-shrink-0 mr-1">lbs</span>
        <button
          onClick={handleLogWeight}
          disabled={loggingWeight || !weightInput}
          aria-label="Log weight"
          className="flex-shrink-0 px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 bg-[#D4AF37] disabled:opacity-30 transition-opacity"
        >
          {loggingWeight ? (
            <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
          ) : (
            <>
              <Plus size={14} strokeWidth={2.5} className="text-black" />
              <span className="text-[12px] font-bold text-black">{t('progress.body.log')}</span>
            </>
          )}
        </button>
      </div>
      {weightError && <p className="text-[12px] text-red-400 -mt-2 mb-3">{weightError}</p>}
      {!weightError && weightLogs[0]?.logged_at === today() && (
        <div className="flex items-center justify-between -mt-2 mb-3">
          <p className="text-[11px] text-[#6B7280]">
            {t('progress.body.today')}: <span className="text-[#D4AF37]">{fmtW(weightLogs[0].weight_lbs)} lbs</span> — {t('progress.body.enterNewValueToUpdate')}
          </p>
          <button
            onClick={() => dispatch({ type: 'TOGGLE_WEIGHT_HISTORY', payload: true })}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg active:scale-[0.95] transition-all"
            style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.12)' }}>
            <Clock size={11} className="text-[#60A5FA]" />
            <span className="text-[10px] font-bold text-[#60A5FA]">History</span>
          </button>
        </div>
      )}
      {!weightError && (!weightLogs[0] || weightLogs[0]?.logged_at !== today()) && weightLogs.length > 0 && (
        <div className="flex justify-end -mt-2 mb-3">
          <button
            onClick={() => dispatch({ type: 'TOGGLE_WEIGHT_HISTORY', payload: true })}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg active:scale-[0.95] transition-all"
            style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.12)' }}>
            <Clock size={11} className="text-[#60A5FA]" />
            <span className="text-[10px] font-bold text-[#60A5FA]">History</span>
          </button>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: t('progress.body.current'), value: currentW != null ? `${fmtW(currentW)} lbs` : '—', icon: Scale, color: '#D4AF37' },
          { label: `${t('progress.body.change')} (${period}d)`, value: delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)} lbs` : '—', icon: DeltaIcon, color: deltaColor },
          { label: t('progress.body.entries'), value: weightLogs.length, icon: TrendingUp, color: '#60A5FA' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="bg-[#0F172A] rounded-2xl border border-white/[0.06] p-4 flex flex-col items-center gap-1.5 text-center"
          >
            <Icon size={16} style={{ color }} strokeWidth={2} />
            <p className="text-[22px] font-black leading-none text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">{label}</p>
          </div>
        ))}
      </div>

      {/* Weight chart */}
      <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[14px] font-semibold text-[#E5E7EB]">{t('progress.body.weightTrend')}</p>
          <div className="flex gap-1.5">
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.label}
                onClick={() => dispatch({ type: 'SET_PERIOD', payload: opt.days })}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors"
                style={
                  period === opt.days
                    ? { background: 'rgba(212,175,55,0.15)', color: '#D4AF37' }
                    : { background: '#111827', color: '#6B7280', border: '1px solid rgba(255,255,255,0.06)' }
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {chartData.length < 2 ? (
          <div className="h-[160px] flex items-center justify-center">
            <p className="text-[13px] text-[#6B7280]">{t('progress.body.logAtLeast2')}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#D4AF37" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#D4AF37" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: '#6B7280' }}
                tickLine={false}
                axisLine={false}
                interval={Math.max(0, Math.floor(chartData.length / 5) - 1)}
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fontSize: 10, fill: '#6B7280' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ChartTooltip formatter={(v) => `${v} lbs`} />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
              <Area
                type="monotone"
                dataKey="weight"
                stroke="#D4AF37"
                strokeWidth={2}
                fill="url(#wGrad)"
                dot={false}
                activeDot={{ r: 6, strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Body measurements */}
      <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[14px] font-semibold text-[#E5E7EB]">{t('progress.body.measurements')}</p>
          <button
            onClick={() => dispatch({ type: 'TOGGLE_MEASUREMENTS', payload: true })}
            className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-xl transition-colors"
            style={{ background: 'rgba(212,175,55,0.1)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.2)' }}
          >
            <Plus size={13} strokeWidth={2.5} />
            {latestMeasurements ? t('progress.body.update') : t('progress.body.add')}
          </button>
        </div>

        {latestMeasurements ? (
          <>
            <p className="text-[11px] mb-3 text-[#6B7280]">
              {t('progress.body.lastRecorded')} {format(parseISO(latestMeasurements.measured_at), 'MMMM d, yyyy')}
            </p>

            {/* Body fat warning */}
            {latestMeasurements.body_fat_pct != null && latestMeasurements.body_fat_pct > 25 && (
              <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl mb-3"
                style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.1)' }}>
                <TrendingUp size={13} className="text-[#EF4444] flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-[#EF4444]/80 leading-relaxed">
                  Body fat is above 25%. Consider adjusting nutrition and increasing cardio to reduce fat while maintaining muscle.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {MEASUREMENT_FIELDS.filter(f => latestMeasurements[f.key] != null).map(f => {
                const rawVal = parseFloat(latestMeasurements[f.key]);
                const displayVal = f.dbUnit === 'cm' ? cmToIn(rawVal) : rawVal;
                const prevRaw = prevMeasurements?.[f.key] != null ? parseFloat(prevMeasurements[f.key]) : null;
                const prevDisplay = prevRaw != null ? (f.dbUnit === 'cm' ? cmToIn(prevRaw) : prevRaw) : null;
                const delta = prevDisplay != null ? Math.round((displayVal - prevDisplay) * 10) / 10 : null;
                // For waist — increasing is bad. For arms/thighs/chest — increasing is good (muscle). Body fat increasing is bad.
                const isWaist = f.key === 'waist_cm' || f.key === 'body_fat_pct';
                const deltaGood = delta != null && delta !== 0 ? (isWaist ? delta < 0 : delta > 0) : null;
                const deltaColor = delta == null || delta === 0 ? '#4B5563' : deltaGood ? '#10B981' : '#EF4444';

                return (
                  <div key={f.key} className="rounded-xl p-3 text-center" style={{ background: 'rgba(17,24,39,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p className="text-[18px] font-black text-white leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {displayVal.toFixed(1)}
                      <span className="text-[10px] font-medium ml-0.5 text-[#4B5563]">{f.unit}</span>
                    </p>
                    {delta != null && delta !== 0 && (
                      <p className="text-[9px] font-bold mt-1 tabular-nums" style={{ color: deltaColor }}>
                        {delta > 0 ? '+' : ''}{delta.toFixed(1)} {f.unit}
                      </p>
                    )}
                    <p className="text-[9px] font-semibold uppercase tracking-wide mt-1 text-[#4B5563]">
                      {MEASUREMENT_LABEL_KEYS[f.key] ? t(MEASUREMENT_LABEL_KEYS[f.key]) : f.label}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Measurement trend chart */}
            {measurementHistory.length > 1 && (() => {
              const CHART_METRICS = [
                { key: 'body_fat_pct', label: 'Body Fat', color: '#F59E0B', unit: '%', convert: false },
                { key: 'chest_cm', label: 'Chest', color: '#D4AF37', unit: 'in', convert: true },
                { key: 'waist_cm', label: 'Waist', color: '#EF4444', unit: 'in', convert: true },
                { key: 'left_arm_cm', label: 'Arms', color: '#10B981', unit: 'in', convert: true, avg: ['left_arm_cm', 'right_arm_cm'] },
                { key: 'left_thigh_cm', label: 'Thighs', color: '#A78BFA', unit: 'in', convert: true, avg: ['left_thigh_cm', 'right_thigh_cm'] },
                { key: 'hips_cm', label: 'Hips', color: '#60A5FA', unit: 'in', convert: true },
              ];
              // Filter to metrics that have data
              const available = CHART_METRICS.filter(m => measurementHistory.some(h => {
                if (m.avg) return m.avg.some(k => h[k] != null);
                return h[m.key] != null;
              }));
              if (!available.length) return null;

              return (
                <MeasurementChart
                  history={measurementHistory}
                  metrics={available}
                />
              );
            })()}
          </>
        ) : (
          <div className="py-6 text-center">
            <p className="text-[13px] text-[#6B7280]">{t('progress.body.noMeasurementsYet')}</p>
            <p className="text-[11px] mt-1 text-[#4B5563]">{t('progress.body.trackMeasurementsHint')}</p>
          </div>
        )}
      </div>

      {/* Progress Photos */}
      <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[14px] font-semibold text-[#E5E7EB]">Progress Photos</p>
          <button
            onClick={() => photoInputRef.current?.click()}
            disabled={uploadingPhoto}
            className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-xl transition-colors"
            style={{ background: 'rgba(212,175,55,0.1)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.2)' }}
          >
            {uploadingPhoto ? (
              <div className="w-3 h-3 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
            ) : (
              <Upload size={13} strokeWidth={2.5} />
            )}
            Add Photo
          </button>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            capture="environment"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file || !user) return;
              e.target.value = '';
              setUploadingPhoto(true);
              try {
                // Compress
                const compressed = await compressImage(file, 1200);
                const path = `${user.id}/${Date.now()}.jpg`;
                const { data: uploadData, error: uploadErr } = await supabase.storage
                  .from('progress-photos')
                  .upload(path, compressed, { contentType: 'image/jpeg', upsert: false });
                if (uploadErr) throw uploadErr;

                // Insert DB record
                await supabase.from('progress_photos').insert({
                  profile_id: user.id,
                  gym_id: profile.gym_id,
                  storage_path: uploadData.path,
                  view_angle: 'front',
                  taken_at: today(),
                  is_private: true,
                });

                // Reload photos
                loadData();
              } catch (err) {
                console.error('Photo upload failed:', err);
              } finally {
                setUploadingPhoto(false);
              }
            }}
          />
        </div>

        {progressPhotos.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {progressPhotos.map(photo => (
              <div key={photo.id} className="relative group">
                <div className="aspect-[3/4] rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                  <img src={photo.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                </div>
                <p className="text-[9px] text-[#4B5563] mt-1 text-center">
                  {format(parseISO(photo.taken_at), 'MMM d')}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center">
            <Image size={28} className="text-[#2A3040] mx-auto mb-2" />
            <p className="text-[12px] text-[#4B5563]">No progress photos yet</p>
            <p className="text-[10px] text-[#374151] mt-0.5">Track your visual transformation over time</p>
          </div>
        )}
      </div>

      {/* Measurements modal */}
      {showMeasurements && createPortal(
        <MeasurementsModal
          existing={latestMeasurements}
          gymId={profile.gym_id}
          profileId={user.id}
          onSaved={loadData}
          onClose={() => dispatch({ type: 'TOGGLE_MEASUREMENTS', payload: false })}
        />,
        document.body
      )}

      {/* Weight history modal */}
      {showWeightHistory && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/80 backdrop-blur-xl"
          onClick={() => dispatch({ type: 'TOGGLE_WEIGHT_HISTORY', payload: false })}>
          <div className="w-full max-w-md max-h-[75vh] overflow-hidden rounded-[24px]"
            style={{ background: 'linear-gradient(180deg, #0F172A 0%, #0B1120 100%)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 24px 80px rgba(0,0,0,0.5)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
              <div>
                <p className="text-[17px] font-bold text-[#E5E7EB]">Weight History</p>
                <p className="text-[11px] text-[#4B5563] mt-0.5">{weightLogs.length} entries</p>
              </div>
              <button onClick={() => dispatch({ type: 'TOGGLE_WEIGHT_HISTORY', payload: false })} aria-label="Close">
                <X size={18} className="text-[#6B7280]" />
              </button>
            </div>
            <div className="overflow-y-auto divide-y divide-white/[0.03]" style={{ maxHeight: 'calc(75vh - 80px)' }}>
              {weightLogs.map((log, i) => {
                const prev = weightLogs[i + 1];
                const diff = prev ? parseFloat(log.weight_lbs) - parseFloat(prev.weight_lbs) : null;
                const isToday = log.logged_at === today();
                return (
                  <div key={log.id} className="flex items-center justify-between px-5 py-3.5">
                    <div>
                      <p className="text-[13px] font-semibold text-[#E5E7EB]">
                        {isToday ? 'Today' : format(parseISO(log.logged_at), 'EEE, MMM d')}
                      </p>
                      {log.notes && <p className="text-[11px] mt-0.5 text-[#4B5563]">{log.notes}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      {diff != null && (
                        <span className="text-[11px] font-bold tabular-nums"
                          style={{ color: diff === 0 ? '#4B5563' : diff > 0 ? '#EF4444' : '#10B981' }}>
                          {diff > 0 ? '+' : ''}{diff.toFixed(1)}
                        </span>
                      )}
                      <p className="text-[15px] font-black text-white tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtW(log.weight_lbs)}
                        <span className="text-[10px] font-medium text-[#4B5563] ml-0.5">lbs</span>
                      </p>
                    </div>
                  </div>
                );
              })}
              {weightLogs.length === 0 && (
                <div className="py-12 text-center">
                  <p className="text-[13px] text-[#4B5563]">No weight entries yet</p>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
