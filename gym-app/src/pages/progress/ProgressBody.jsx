import { useState, useEffect, useCallback, useReducer, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  TrendingUp, TrendingDown, Minus, Scale, Plus, X, Check,
  Camera,
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
  fmtW, today,
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
            next[f.key] = String(action.estimates[f.key]);
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

const MeasurementsModal = ({ existing, gymId, profileId, onSaved, onClose }) => {
  const { t } = useTranslation('pages');
  const empty = MEASUREMENT_FIELDS.reduce((a, f) => ({ ...a, [f.key]: '' }), {});
  const initialForm = existing
    ? MEASUREMENT_FIELDS.reduce(
        (a, f) => ({ ...a, [f.key]: existing[f.key] != null ? String(existing[f.key]) : '' }),
        {}
      )
    : empty;

  const [state, dispatch] = useReducer(modalReducer, {
    ...modalInitialState,
    form: initialForm,
  });
  const { form, saving, error, scanning, scanPreview } = state;
  const fileRef = useRef(null);

  const handleScan = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show preview
    const reader = new FileReader();
    reader.onload = (ev) => dispatch({ type: 'SET_SCAN_PREVIEW', payload: ev.target.result });
    reader.readAsDataURL(file);

    dispatch({ type: 'SET_SCANNING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: '' });

    try {
      // Compress image for upload
      const compressed = await new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          const canvas = document.createElement('canvas');
          const maxW = 1200;
          const scale = Math.min(1, maxW / img.width);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(resolve, 'image/jpeg', 0.8);
        };
        img.onerror = (err) => {
          URL.revokeObjectURL(objectUrl);
          reject(err);
        };
        img.src = objectUrl;
      });

      // Convert to base64
      const base64 = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(',')[1]);
        r.readAsDataURL(compressed);
      });

      // Call Supabase edge function for AI analysis
      const { data, error: fnError } = await supabase.functions.invoke('analyze-body-photo', {
        body: { image: base64, existingMeasurements: form },
      });

      if (fnError) throw fnError;

      if (data?.estimates) {
        dispatch({ type: 'MERGE_ESTIMATES', estimates: data.estimates });
      }
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Photo analysis failed — enter measurements manually' });
    } finally {
      dispatch({ type: 'SET_SCANNING', payload: false });
    }
  };

  const handleSave = async () => {
    dispatch({ type: 'SET_SAVING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: '' });
    const payload = { profile_id: profileId, gym_id: gymId, measured_at: today() };
    MEASUREMENT_FIELDS.forEach(f => {
      payload[f.key] = form[f.key] !== '' ? parseFloat(form[f.key]) : null;
    });
    const { error: err } = await supabase
      .from('body_measurements')
      .upsert(payload, { onConflict: 'profile_id,measured_at' });
    if (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message });
      dispatch({ type: 'SET_SAVING', payload: false });
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/6">
          <p className="text-[16px] font-bold text-[#E5E7EB]">
            {existing ? t('progress.body.updateMeasurements') : t('progress.body.addMeasurements')}
          </p>
          <button onClick={onClose} aria-label="Close measurements modal"><X size={20} className="text-[#6B7280]" /></button>
        </div>

        <div className="p-5 max-h-[65vh] overflow-y-auto">
          {/* AI Photo Scan */}
          <div className="mb-4">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={scanning}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed transition-colors"
              style={{
                borderColor: scanPreview ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.12)',
                background: scanPreview ? 'rgba(212,175,55,0.06)' : 'rgba(255,255,255,0.02)',
              }}
            >
              {scanning ? (
                <>
                  <div className="w-4 h-4 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
                  <span className="text-[12px] font-semibold text-[#D4AF37]">{t('progress.body.analyzingPhoto')}</span>
                </>
              ) : scanPreview ? (
                <>
                  <Check size={14} className="text-[#10B981]" />
                  <span className="text-[12px] font-semibold text-[#10B981]">{t('progress.body.estimatesApplied')}</span>
                </>
              ) : (
                <>
                  <Camera size={16} className="text-[#D4AF37]" />
                  <span className="text-[12px] font-semibold text-[#D4AF37]">{t('progress.body.estimateFromPhoto')}</span>
                  <span className="text-[10px] text-[#6B7280] ml-1">{t('progress.body.aiBfEstimate')}</span>
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              className="hidden"
              onChange={handleScan}
            />
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
                  className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
                />
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-[12px] text-red-400 px-5 pb-2">{error}</p>}
        <div className="px-5 pb-5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] disabled:opacity-50 transition-opacity"
          >
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
  showMeasurements: false,
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
    weightError, latestMeasurements, showMeasurements, loading,
  } = state;

  const loadData = useCallback(async () => {
    if (!user) return;
    dispatch({ type: 'SET_LOADING' });

    const from = subDays(new Date(), period).toISOString().slice(0, 10);

    const [{ data: logs }, { data: meas }] = await Promise.all([
      supabase
        .from('body_weight_logs')
        .select('id, weight_lbs, logged_at, notes')
        .eq('profile_id', user.id)
        .gte('logged_at', from)
        .order('logged_at', { ascending: true }),
      supabase
        .from('body_measurements')
        .select('*')
        .eq('profile_id', user.id)
        .order('measured_at', { ascending: false })
        .limit(1)
        .single(),
    ]);

    const allLogs = logs ?? [];
    dispatch({
      type: 'SET_DATA',
      weightLogs: [...allLogs].reverse(),
      chartData: allLogs.map(l => ({
        date: format(parseISO(l.logged_at), 'MMM d'),
        weight: parseFloat(l.weight_lbs),
      })),
      latestMeasurements: meas ?? null,
    });
  }, [user, period]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
        <p className="text-[11px] text-[#6B7280] -mt-2 mb-3">
          {t('progress.body.today')}: <span className="text-[#D4AF37]">{fmtW(weightLogs[0].weight_lbs)} lbs</span> — {t('progress.body.enterNewValueToUpdate')}
        </p>
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
            className="bg-[#0F172A] rounded-2xl border border-white/8 p-4 flex flex-col items-center gap-1.5 text-center"
          >
            <Icon size={16} style={{ color }} strokeWidth={2} />
            <p className="text-[22px] font-black leading-none text-white">{value}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">{label}</p>
          </div>
        ))}
      </div>

      {/* Weight chart */}
      <div className="bg-[#0F172A] rounded-2xl border border-white/8 p-5 mb-5">
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
                    : { background: '#111827', color: '#6B7280', border: '1px solid rgba(255,255,255,0.08)' }
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
      <div className="bg-[#0F172A] rounded-2xl border border-white/8 p-5 mb-5">
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {MEASUREMENT_FIELDS.filter(f => latestMeasurements[f.key] != null).map(f => (
                <div key={f.key} className="rounded-xl p-3 text-center bg-[#111827]">
                  <p className="text-[18px] font-black text-white leading-none">
                    {parseFloat(latestMeasurements[f.key]).toFixed(1)}
                    <span className="text-[11px] font-medium ml-0.5 text-[#6B7280]">{f.unit}</span>
                  </p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide mt-1.5 text-[#6B7280]">
                    {MEASUREMENT_LABEL_KEYS[f.key] ? t(MEASUREMENT_LABEL_KEYS[f.key]) : f.label}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="py-6 text-center">
            <p className="text-[13px] text-[#6B7280]">{t('progress.body.noMeasurementsYet')}</p>
            <p className="text-[11px] mt-1 text-[#4B5563]">{t('progress.body.trackMeasurementsHint')}</p>
          </div>
        )}
      </div>

      {/* Weight history */}
      {weightLogs.length > 0 && (
        <div className="bg-[#0F172A] rounded-2xl border border-white/8 overflow-hidden">
          <p className="text-[14px] font-semibold px-5 pt-4 pb-3 text-[#E5E7EB]">{t('progress.body.history')}</p>
          <div className="divide-y divide-white/4">
            {weightLogs.map((log, i) => {
              const prev = weightLogs[i + 1];
              const diff = prev
                ? parseFloat(log.weight_lbs) - parseFloat(prev.weight_lbs)
                : null;
              return (
                <div key={log.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-[13px] font-semibold text-[#E5E7EB]">
                      {format(parseISO(log.logged_at), 'EEE, MMM d')}
                    </p>
                    {log.notes && (
                      <p className="text-[11px] mt-0.5 text-[#6B7280]">{log.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {diff != null && (
                      <span
                        className="text-[11px] font-semibold"
                        style={{ color: diff === 0 ? '#6B7280' : diff > 0 ? '#EF4444' : '#10B981' }}
                      >
                        {diff > 0 ? '+' : ''}
                        {diff.toFixed(1)}
                      </span>
                    )}
                    <p className="text-[15px] font-bold text-white">
                      {fmtW(log.weight_lbs)}{' '}
                      <span className="text-[11px] font-medium text-[#6B7280]">lbs</span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Measurements modal — portalled out of SwipeableTabView to avoid touch conflicts */}
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

    </div>
  );
}
