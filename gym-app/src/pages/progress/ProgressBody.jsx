import { useState, useEffect, useCallback, useReducer, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  TrendingUp, TrendingDown, Minus, Scale, Plus, X, Check,
  Camera, Clock, Upload, Image as ImageIcon, Trash2, ChevronDown,
} from 'lucide-react';
import Skeleton from '../../components/Skeleton';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, parseISO, subDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import {
  MEASUREMENT_FIELDS, PERIOD_OPTIONS,
  fmtW, today, cmToIn, inToCm,
} from './progressConstants';
import ChartTooltip from '../../components/ChartTooltip';
import { takePhoto } from '../../lib/takePhoto';
import { validateImageFile } from '../../lib/validateImage';
import { useToast } from '../../contexts/ToastContext';
import { usePostHog } from '@posthog/react';
import { useCachedState, hasCachedState } from '../../hooks/useCachedState';
import { hasConsentedToAI, recordAIConsent } from '../../lib/aiConsent';
import AIConsentDialog from '../../components/AIConsentDialog';

// ── Goal-aware progress color helper ─────────────────────────────────────────

/**
 * Maps a measurement DB key to a canonical metric name for color logic.
 */
const toMetricKey = (dbKey) => {
  if (dbKey === 'waist_cm') return 'waist';
  if (dbKey === 'body_fat_pct') return 'body_fat';
  if (dbKey === 'chest_cm') return 'chest';
  if (dbKey === 'left_arm_cm' || dbKey === 'right_arm_cm' || dbKey === 'bicep_cm' || dbKey === 'arm_cm') return 'arms';
  if (dbKey === 'left_thigh_cm' || dbKey === 'right_thigh_cm' || dbKey === 'thigh_cm') return 'thighs';
  if (dbKey === 'hips_cm' || dbKey === 'hip_cm') return 'hips';
  return dbKey;
};

/**
 * Returns the appropriate color for a progress delta based on user's goal.
 * @param {'weight'|'waist'|'body_fat'|'chest'|'arms'|'thighs'|'hips'} metric
 * @param {number|null} delta - positive = increase, negative = decrease
 * @param {'muscle_gain'|'fat_loss'|'strength'|'endurance'|'general_fitness'} primaryGoal
 * @returns {string} color hex string
 */
const getProgressColor = (metric, delta, primaryGoal) => {
  if (delta == null || delta === 0) return 'var(--color-text-muted)'; // neutral gray

  const isUp = delta > 0;

  // Fat-indicator metrics: waist and body fat — DOWN is always good
  if (metric === 'waist' || metric === 'body_fat') {
    return isUp ? 'var(--color-danger)' : 'var(--color-success)';
  }

  // Muscle-indicator metrics: chest, arms, thighs — UP is good for muscle/strength goals
  if (['chest', 'arms', 'thighs'].includes(metric)) {
    if (['muscle_gain', 'strength'].includes(primaryGoal)) {
      return isUp ? 'var(--color-success)' : 'var(--color-danger)'; // up = good (gaining muscle)
    }
    if (primaryGoal === 'fat_loss') {
      return isUp ? 'var(--color-success)' : 'var(--color-warning)'; // up = good, down = amber (expected during cut)
    }
    return isUp ? 'var(--color-success)' : 'var(--color-text-muted)'; // general: up = good, down = neutral
  }

  // Weight — depends entirely on goal
  if (metric === 'weight') {
    if (primaryGoal === 'muscle_gain') {
      return isUp ? 'var(--color-success)' : 'var(--color-danger)'; // up = good (gaining mass)
    }
    if (primaryGoal === 'fat_loss') {
      return isUp ? 'var(--color-danger)' : 'var(--color-success)'; // up = bad, down = good
    }
    if (primaryGoal === 'strength') {
      return 'var(--color-accent)'; // gold/neutral — weight doesn't matter much
    }
    return 'var(--color-accent)'; // general_fitness, endurance — neutral gold
  }

  // Hips — similar to waist for fat loss, neutral otherwise
  if (metric === 'hips') {
    if (primaryGoal === 'fat_loss') {
      return isUp ? 'var(--color-danger)' : 'var(--color-success)';
    }
    return 'var(--color-text-muted)'; // neutral
  }

  return 'var(--color-text-muted)'; // default neutral
};

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
const MeasurementChart = ({ history, metrics, primaryGoal }) => {
  const { t, i18n } = useTranslation('pages');
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
        date: format(parseISO(m.measured_at), 'MMM d', { locale: i18n.language === 'es' ? esLocale : undefined }),
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
    <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.12em]">{t('progressBody.progressTrends')}</p>
        {totalDelta !== 0 && (
          <span className="text-[10px] font-bold tabular-nums" style={{ color: getProgressColor(toMetricKey(metric.key), totalDelta, primaryGoal) }}>
            {totalDelta > 0 ? '+' : ''}{totalDelta}{metric.unit}
          </span>
        )}
      </div>

      {/* Metric selector pills */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {metrics.map((m, i) => (
          <button key={m.key} onClick={() => setActiveMetric(i)}
            className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all"
            style={activeMetric === i
              ? { background: `${m.color}18`, color: m.color, border: `1px solid ${m.color}30` }
              : { background: 'var(--color-bg-deep)', color: 'var(--color-text-subtle)', border: '1px solid var(--color-border-subtle)' }
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
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--color-text-subtle)' }} tickLine={false} axisLine={false} />
          <YAxis domain={[yMin, yMax]} tick={{ fontSize: 9, fill: 'var(--color-text-subtle)' }} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip formatter={(v) => `${v} ${metric.unit}`} nameLabel={metric.label} />} cursor={{ fill: `${metric.color}08` }} />
          <Area type="monotone" dataKey="value" stroke={metric.color} strokeWidth={2} fill="url(#measGrad)" dot={false} activeDot={{ r: 5, strokeWidth: 2, fill: metric.color }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

const ProgressPhotoTimeline = ({ byDate, byMonth, latestDate, onDeletePhoto, onPhotoTap }) => {
  const { t, i18n } = useTranslation('pages');
  const [expandedDates, setExpandedDates] = useState(() => new Set([latestDate]));
  const [expandedMonths, setExpandedMonths] = useState(() => {
    const months = Object.keys(byMonth);
    return new Set(months.length ? [months[0]] : []);
  });
  const [deleting, setDeleting] = useState(null);

  const toggleMonth = (m) => setExpandedMonths(prev => {
    const next = new Set(prev);
    next.has(m) ? next.delete(m) : next.add(m);
    return next;
  });
  const toggleDate = (d) => setExpandedDates(prev => {
    const next = new Set(prev);
    next.has(d) ? next.delete(d) : next.add(d);
    return next;
  });

  const handleDelete = async (photo) => {
    const msg = t('progressBody.confirmDeletePhoto', 'Delete this progress photo? This cannot be undone.');
    if (!window.confirm(msg)) return;
    setDeleting(photo.id);
    await onDeletePhoto(photo);
    setDeleting(null);
  };

  const ANGLES = ['front', 'side', 'back'];

  return (
    <div className="space-y-3">
      {Object.entries(byMonth).map(([month, dates]) => (
        <div key={month}>
          {Object.keys(byMonth).length > 1 && (
            <button onClick={() => toggleMonth(month)}
              className="flex items-center justify-between w-full py-2 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{month}</span>
              <ChevronDown size={14} className={`text-[var(--color-text-muted)] transition-transform ${expandedMonths.has(month) ? 'rotate-180' : ''}`} />
            </button>
          )}

          {(Object.keys(byMonth).length === 1 || expandedMonths.has(month)) && dates.map(dateKey => {
            const photos = byDate[dateKey];
            const isExpanded = expandedDates.has(dateKey);
            const dateLabel = format(parseISO(dateKey), 'MMM d', { locale: i18n.language === 'es' ? esLocale : undefined });
            const hasPhotos = ANGLES.some(a => photos[a]);

            return (
              <div key={dateKey} className="mb-2">
                <button onClick={() => toggleDate(dateKey)}
                  className="flex items-center justify-between w-full py-2 px-3 rounded-xl transition-colors"
                  style={{ background: isExpanded ? 'var(--color-surface-hover)' : 'transparent' }}>
                  <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{dateLabel}</span>
                  <ChevronDown size={14} className={`text-[var(--color-text-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {isExpanded && hasPhotos && (
                  <div className="grid grid-cols-3 gap-2 mt-2 px-1">
                    {ANGLES.map(angle => {
                      const photo = photos[angle];
                      return (
                        <div key={angle} className="text-center">
                          {photo ? (
                            <div className="relative aspect-[3/4] rounded-xl overflow-hidden group" style={{ border: '1px solid var(--color-border-subtle)' }}>
                              <button
                                type="button"
                                onClick={() => onPhotoTap && onPhotoTap(photo)}
                                className="block w-full h-full p-0 border-0 bg-transparent cursor-pointer"
                                aria-label={t('progressBody.zoomPhoto', 'View larger')}
                              >
                                <img src={photo.url} alt={`${angle.charAt(0).toUpperCase() + angle.slice(1)} body progress photo`} className="w-full h-full object-cover" loading="lazy" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(photo); }}
                                disabled={deleting === photo.id}
                                className="absolute top-1.5 right-1.5 w-8 h-8 rounded-full flex items-center justify-center"
                                style={{ backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', minWidth: 32, minHeight: 32 }}
                                aria-label={t('progressBody.deletePhoto', 'Delete photo')}
                              >
                                {deleting === photo.id
                                  ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                  : <Trash2 size={13} className="text-red-400" />
                                }
                              </button>
                            </div>
                          ) : (
                            <div className="aspect-[3/4] rounded-xl flex items-center justify-center"
                              style={{ background: 'var(--color-surface-hover)', border: '1px dashed var(--color-border-subtle)' }}>
                              <ImageIcon size={16} className="text-[var(--color-text-muted)]" />
                            </div>
                          )}
                          <p className="text-[9px] text-[var(--color-text-muted)] mt-1 capitalize font-medium">{t(`progressBody.angle_${angle}`)}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

const SCAN_STEPS = [
  { id: 'front', labelKey: 'progressBody.photoSteps.front_title', instructionKey: 'progressBody.photoSteps.front_desc' },
  { id: 'side', labelKey: 'progressBody.photoSteps.side_title', instructionKey: 'progressBody.photoSteps.side_desc' },
];

// Resize + JPEG re-encode via Canvas. Default 800px is used for the AI body
// scan thumbnails; the upload path passes 1080 + 0.8 for the storage write.
const compressImage = (file, maxW = 800, quality = 0.7) => new Promise((resolve, reject) => {
  const img = new Image();
  const objectUrl = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(objectUrl);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, maxW / img.width);
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(resolve, 'image/jpeg', quality);
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
  const { t, i18n } = useTranslation('pages');
  const posthog = usePostHog();
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

  // Guided scan state
  const [scanMode, setScanMode] = useState(false);
  const [scanStep, setScanStep] = useState(0);
  const [frontPhoto, setFrontPhoto] = useState(null); // { preview, base64 }
  const [sidePhoto, setSidePhoto] = useState(null);
  const [scanResult, setScanResult] = useState(null); // AI response with derived metrics

  // AI third-party consent gate (Apple 5.1.2): block scan launch until user
  // explicitly consents to OpenAI Vision processing of body photos.
  const [consentOpen, setConsentOpen] = useState(false);

  // Clean up localStorage when modal closes
  const handleClose = useCallback(() => {
    try { localStorage.removeItem('_bodyScanFront'); localStorage.removeItem('_bodyScanSide'); } catch {}
    onClose();
  }, [onClose]);

  // Resume pending body scan after Android WebView restart
  useEffect(() => {
    try {
      // Case 1: completed result
      const done = localStorage.getItem('_pendingBodyResult');
      if (done) {
        localStorage.removeItem('_pendingBodyResult');
        localStorage.removeItem('_pendingBodyScan');
        const estimates = JSON.parse(done);
        if (estimates) {
          dispatch({ type: 'MERGE_ESTIMATES', estimates });
          setScanResult(estimates);
        }
        return;
      }
      // Case 2: analysis was in progress (photos saved, API not yet complete)
      const pending = localStorage.getItem('_pendingBodyScan');
      if (pending) {
        // Apple 5.1.2 / GDPR Art. 7: a background resume MUST NOT silently
        // re-fire the analyze-body-photo edge function if the user has since
        // revoked consent. Discard rather than re-prompt — the resume path is
        // a safety net, not a feature entry point.
        if (!hasConsentedToAI('body-analysis')) {
          localStorage.removeItem('_pendingBodyScan');
          try { localStorage.removeItem('_bodyScanFront'); localStorage.removeItem('_bodyScanSide'); } catch {}
          return;
        }
        // TTL guard: ignore stale pending scans (>24h). The user has clearly
        // moved on and we shouldn't re-process old photos automatically.
        let parsedPending;
        try { parsedPending = JSON.parse(pending); } catch { parsedPending = null; }
        const pendingTs = parsedPending?.timestamp;
        if (pendingTs && (Date.now() - pendingTs) > 24 * 60 * 60 * 1000) {
          localStorage.removeItem('_pendingBodyScan');
          try { localStorage.removeItem('_bodyScanFront'); localStorage.removeItem('_bodyScanSide'); } catch {}
          return;
        }
        localStorage.removeItem('_pendingBodyScan');
        // Also clean up photo cache since analysis already started
        try { localStorage.removeItem('_bodyScanFront'); localStorage.removeItem('_bodyScanSide'); } catch {}
        const { frontBase64, sideBase64 } = parsedPending || {};
        if (frontBase64) {
          dispatch({ type: 'SET_SCANNING', payload: true });
          (async () => {
            try {
              const reqBody = { image: frontBase64, language: i18n.language };
              if (sideBase64) reqBody.sideImage = sideBase64;
              const { data, error: fnError } = await supabase.functions.invoke('analyze-body-photo', { body: reqBody });
              if (fnError) {
                let msg = fnError.message || 'Analysis failed';
                try { const b = await fnError.context?.json(); if (b?.error) msg = b.error; } catch {}
                throw new Error(msg);
              }
              if (data?.error) throw new Error(data.error);
              if (data?.estimates) {
                dispatch({ type: 'MERGE_ESTIMATES', estimates: data.estimates });
                setScanResult(data.estimates);
              }
            } catch (err) {
              dispatch({ type: 'SET_ERROR', payload: err.message || 'Photo analysis failed' });
            } finally {
              dispatch({ type: 'SET_SCANNING', payload: false });
            }
          })();
        }
        return;
      }
      // Case 3: front photo was captured but scan wasn't started yet (Samsung WebView killed)
      const savedFront = localStorage.getItem('_bodyScanFront');
      if (savedFront) {
        const front = JSON.parse(savedFront);
        setFrontPhoto(front);
        setScanMode(true);
        const savedSide = localStorage.getItem('_bodyScanSide');
        if (savedSide) {
          // Both photos captured — auto-run analysis
          const side = JSON.parse(savedSide);
          setSidePhoto(side);
          localStorage.removeItem('_bodyScanFront');
          localStorage.removeItem('_bodyScanSide');
          runAnalysis(front.base64, side.base64);
        } else {
          // Only front photo — resume at step 1 (side photo)
          setScanStep(1);
          // Auto-open camera for side photo after a brief delay
          setTimeout(async () => {
            try {
              const { takePhoto } = await import('../../lib/takePhoto');
              const file = await takePhoto({ cameraOnly: true });
              if (file) {
                const compressed = await compressImage(file);
                const sideBase64 = await blobToBase64(compressed);
                const thumbBlob = await compressImage(file, 200);
                const sidePreview = await new Promise(r => {
                  const reader = new FileReader();
                  reader.onload = ev => r(ev.target.result);
                  reader.readAsDataURL(thumbBlob);
                });
                try { localStorage.setItem('_bodyScanSide', JSON.stringify({ preview: sidePreview, base64: sideBase64, timestamp: Date.now() })); } catch {}
                setSidePhoto({ preview: sidePreview, base64: sideBase64 });
                runAnalysis(front.base64, sideBase64);
              }
            } catch {}
          }, 800);
        }
      }
    } catch {}
  }, []);

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
        // Persist to localStorage — survives Samsung WebView kill
        try { localStorage.setItem('_bodyScanFront', JSON.stringify({ preview, base64, timestamp: Date.now() })); } catch {}
        setFrontPhoto({ preview, base64 });
        setScanStep(1);
      } else {
        // Persist side photo before analysis
        try { localStorage.setItem('_bodyScanSide', JSON.stringify({ preview, base64, timestamp: Date.now() })); } catch {}
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

    // Save to localStorage before API call — survives Android WebView restart
    try {
      localStorage.setItem('_pendingBodyScan', JSON.stringify({ frontBase64, sideBase64, timestamp: Date.now() }));
      // Clear individual photo cache — they're now in _pendingBodyScan
      localStorage.removeItem('_bodyScanFront');
      localStorage.removeItem('_bodyScanSide');
    } catch {}

    try {
      const body = { image: frontBase64, language: i18n.language };
      if (sideBase64) body.sideImage = sideBase64;
      posthog?.capture('ai_body_analysis_requested');

      const { data, error: fnError } = await supabase.functions.invoke('analyze-body-photo', { body });

      if (fnError) {
        let msg = fnError.message || 'Analysis failed';
        try { const b = await fnError.context?.json(); if (b?.error) msg = b.error; } catch {}
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);

      if (data?.estimates) {
        // Clear pending — analysis succeeded
        try { localStorage.removeItem('_pendingBodyScan'); } catch {}
        dispatch({ type: 'MERGE_ESTIMATES', estimates: data.estimates });
        setScanResult(data.estimates);
        setScanMode(false);
      }
    } catch (err) {
      try { localStorage.removeItem('_pendingBodyScan'); } catch {}
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Photo analysis failed' });
      setScanMode(false);
    } finally {
      dispatch({ type: 'SET_SCANNING', payload: false });
    }
  };

  // Internal: open scan UI (no consent check). Called after consent is granted
  // or already on file.
  const openScanFlow = useCallback(() => {
    setScanMode(true);
    setScanStep(0);
    setFrontPhoto(null);
    setSidePhoto(null);
    setScanResult(null);
    try { localStorage.removeItem('_bodyScanFront'); localStorage.removeItem('_bodyScanSide'); } catch {}
  }, []);

  // Public entry: gate the AI scan flow on third-party consent (Apple 5.1.2).
  // If not yet consented, open the AIConsentDialog; on agree, persist and proceed.
  const resetScan = useCallback(() => {
    if (!hasConsentedToAI('body-analysis')) {
      setConsentOpen(true);
      return;
    }
    openScanFlow();
  }, [openScanFlow]);

  const handleConsentAgree = useCallback(async () => {
    setConsentOpen(false);
    try { await recordAIConsent('body-analysis'); } catch { /* non-blocking */ }
    openScanFlow();
  }, [openScanFlow]);

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
      posthog?.capture('body_metric_logged', { metric_type: 'measurements' });
      onSaved();
      handleClose();
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message === 'Load failed' ? 'Network error — check your connection and try again.' : (err.message || 'Failed to save') });
      dispatch({ type: 'SET_SAVING', payload: false });
    }
  };

  const currentStep = SCAN_STEPS[scanStep];

  // ── Guided scan overlay ──────────────────────────────────
  if (scanMode && !scanning) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl" role="button" tabIndex={0} aria-label={t('progressBody.closeBodyScan', 'Close body scan')} onClick={() => setScanMode(false)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setScanMode(false); }}>
        <div role="dialog" aria-modal="true" aria-label={t('progressBody.bodyScan', 'Body Scan')} className="relative w-full max-w-md mx-4 rounded-[28px] overflow-hidden"
          style={{ background: 'linear-gradient(180deg, var(--color-bg-card) 0%, var(--color-bg-secondary) 100%)', boxShadow: '0 24px 80px rgba(0,0,0,0.3), 0 0 0 1px var(--color-border-subtle)' }}
          onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="px-6 pt-6 pb-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.15em]">{t('progressBody.bodyScan')}</p>
              <button onClick={() => setScanMode(false)} aria-label={t('progressBody.closeBodyScan', 'Close body scan')} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
                <X size={18} className="text-[var(--color-text-muted)]" />
              </button>
            </div>
            <h3 className="text-[20px] font-bold text-[var(--color-text-primary)]">{t(currentStep.labelKey)}</h3>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-1 leading-relaxed">{t(currentStep.instructionKey)}</p>
          </div>

          {/* Step indicators */}
          <div className="flex gap-2 px-6 mb-5">
            {SCAN_STEPS.map((s, i) => (
              <div key={s.id} className="flex-1 h-[3px] rounded-full" style={{
                background: i < scanStep ? 'var(--color-success)' : i === scanStep ? 'var(--color-accent)' : 'var(--color-border-subtle)',
              }} />
            ))}
          </div>

          {/* Photo preview area */}
          <div className="mx-6 mb-5 aspect-[3/4] rounded-[18px] overflow-hidden flex items-center justify-center"
            style={{ background: 'var(--color-surface-hover)', border: '2px dashed var(--color-border-subtle)' }}>
            {scanStep === 1 && frontPhoto ? (
              <div className="relative w-full h-full">
                <img src={frontPhoto.preview} alt={t('progressBody.frontBodyPhotoAlt', 'Front body progress photo')} className="w-full h-full object-cover opacity-30" loading="lazy" />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <Check size={32} className="text-[#10B981] mb-2" />
                  <p className="text-[12px] font-semibold text-[#10B981]">{t('progressBody.frontCaptured')}</p>
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-1">{t('progressBody.nowTakeSide')}</p>
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
                <p className="text-[11px] text-[var(--color-text-muted)]">{t('progressBody.alignOutline')}</p>
              </div>
            )}
          </div>

          {/* Tips */}
          <div className="mx-6 mb-5 px-4 py-3 rounded-[14px]" style={{ background: 'color-mix(in srgb, var(--color-accent) 4%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 8%, transparent)' }}>
            <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed">
              <span className="text-[#D4AF37] font-semibold">{t('progressBody.tips')}:</span> {t('progressBody.tipsText')}
            </p>
          </div>

          {/* Action buttons */}
          <div className="px-6 pb-6">
            <button onClick={async () => {
                const file = await takePhoto({ cameraOnly: true });
                if (file) {
                  const dt = new DataTransfer();
                  dt.items.add(file);
                  handlePhotoCapture({ target: { files: dt.files, value: '' } });
                }
              }}
              className="w-full py-[16px] rounded-[16px] font-bold text-[14px] flex items-center justify-center gap-2 active:scale-[0.97] transition-all mb-3"
              style={{ background: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-dark) 100%)', color: '#000', boxShadow: '0 4px 16px color-mix(in srgb, var(--color-accent) 25%, transparent)' }}>
              <Camera size={18} /> {t('progressBody.takePhoto', { view: t(currentStep.labelKey) })}
            </button>
            {scanStep === 1 && (
              <button onClick={skipSidePhoto}
                className="w-full py-3 rounded-[14px] text-[12px] font-semibold text-[var(--color-text-muted)] active:scale-[0.97] transition-all"
                style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}>
                {t('progressBody.skipSidePhoto')}
              </button>
            )}
          </div>


        </div>
      </div>
    );
  }

  // ── Main modal (form + results) ──────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/80 backdrop-blur-xl" role="button" tabIndex={0} aria-label={t('progressBody.closeMeasurements', 'Close measurements')} onClick={handleClose} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="measurements-modal-title" className="w-full max-w-md overflow-hidden rounded-[28px]"
        style={{ background: 'linear-gradient(180deg, var(--color-bg-card) 0%, var(--color-bg-secondary) 100%)', border: '1px solid var(--color-border-subtle)', boxShadow: '0 24px 80px rgba(0,0,0,0.3)' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)]">
          <p id="measurements-modal-title" className="text-[17px] font-bold text-[var(--color-text-primary)]">
            {existing ? t('progress.body.updateMeasurements') : t('progress.body.addMeasurements')}
          </p>
          <button onClick={handleClose} aria-label={t('progressBody.close', 'Close')} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"><X size={18} className="text-[var(--color-text-muted)]" /></button>
        </div>

        <div className="p-5 max-h-[65vh] overflow-y-auto">
          {/* AI Body Scan button */}
          <div className="mb-5">
            {scanning ? (
              <div className="flex flex-col items-center py-6 rounded-[16px]" aria-busy="true" style={{ background: 'color-mix(in srgb, var(--color-accent) 4%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 10%, transparent)' }}>
                <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin mb-3" role="status" aria-label={t('progressBody.analyzingPhotos', 'Analyzing your photos...')} />
                <p className="text-[13px] font-semibold text-[#D4AF37]">{t('progressBody.analyzingPhotos')}</p>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{t('progressBody.estimatingComposition')}</p>
              </div>
            ) : scanResult ? (
              <div className="rounded-[16px] overflow-hidden" style={{ background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.1)' }}>
                <div className="px-4 py-3.5 flex items-center gap-3">
                  <div className="flex gap-2">
                    {frontPhoto && <img src={frontPhoto.preview} alt={t('progressBody.frontBodyPhotoAlt', 'Front body progress photo')} className="w-10 h-14 rounded-lg object-cover" width={40} height={56} loading="lazy" style={{ border: '1px solid var(--color-border-subtle)' }} />}
                    {sidePhoto && <img src={sidePhoto.preview} alt={t('progressBody.sideBodyPhotoAlt', 'Side body progress photo')} className="w-10 h-14 rounded-lg object-cover" width={40} height={56} loading="lazy" style={{ border: '1px solid var(--color-border-subtle)' }} />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <Check size={13} className="text-[#10B981]" />
                      <span className="text-[12px] font-bold text-[#10B981]">{t('progressBody.scanComplete')}</span>
                    </div>
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                      {scanResult.scan_quality === 'good' ? t('progressBody.highQualityScan') : scanResult.scan_quality === 'fair' ? t('progressBody.fairQuality') + ' — ' + (scanResult.scan_notes || '') : t('progressBody.lowQuality') + ' — ' + (scanResult.scan_notes || '')}
                    </p>
                  </div>
                  <button onClick={resetScan} aria-label={t('progressBody.rescan')} className="text-[10px] font-semibold text-[#D4AF37]">{t('progressBody.rescan')}</button>
                </div>

                {/* Derived metrics */}
                {(scanResult.lean_mass_kg || scanResult.waist_to_hip || scanResult.ffmi) && (
                  <div className="px-4 pb-3.5 pt-0 flex gap-2 flex-wrap">
                    {scanResult.body_fat_pct != null && (
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-semibold" style={{ background: 'rgba(245,158,11,0.08)', color: 'var(--color-warning)' }}>
                        {scanResult.body_fat_pct}% BF
                      </span>
                    )}
                    {scanResult.lean_mass_kg != null && (
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-semibold" style={{ background: 'rgba(16,185,129,0.08)', color: 'var(--color-success)' }}>
                        {scanResult.lean_mass_kg}kg {t('progressBody.lean')}
                      </span>
                    )}
                    {scanResult.ffmi != null && (
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-semibold" style={{ background: 'rgba(96,165,250,0.08)', color: 'var(--color-blue-soft)' }}>
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
                  <p className="text-[9px] text-[var(--color-text-muted)] leading-relaxed">
                    {t('progressBody.aiDisclaimer')}
                  </p>
                  {/* Medical disclaimer (Apple 1.4.1) — body fat %, FFMI,
                      BMI, waist-to-hip ratio are health metrics. */}
                  <p className="text-[9px] text-[var(--color-text-muted)] leading-relaxed mt-1.5">
                    {t('aiConsent.medicalDisclaimer')}
                  </p>
                </div>
              </div>
            ) : (
              <button onClick={resetScan}
                className="w-full py-4 rounded-[16px] flex flex-col items-center gap-2 active:scale-[0.97] transition-all"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 4%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 10%, transparent)' }}>
                <Camera size={22} className="text-[#D4AF37]" />
                <span className="text-[13px] font-bold text-[#D4AF37]">{t('progressBody.aiBodyScan')}</span>
                <span className="text-[10px] text-[var(--color-text-muted)]">{t('progressBody.photosForAccuracy')}</span>
              </button>
            )}
          </div>

          {/* Manual fields */}
          <div className="grid grid-cols-2 gap-3">
            {MEASUREMENT_FIELDS.map(f => (
              <div key={f.key}>
                <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
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
                  className="w-full bg-[var(--color-bg-deep)] border border-[var(--color-border-subtle)] rounded-xl px-3 py-2.5 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[#D4AF37]/40"
                />
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-[12px] text-red-400 px-5 pb-2">{error}</p>}
        <div className="px-5 pb-5">
          <button onClick={handleSave} disabled={saving}
            className="w-full py-[14px] rounded-[16px] font-bold text-[14px] active:scale-[0.97] transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-dark) 100%)', color: '#000', boxShadow: '0 4px 16px color-mix(in srgb, var(--color-accent) 20%, transparent)' }}>
            {saving ? t('progress.body.saving') : t('progress.body.saveMeasurements')}
          </button>
        </div>
      </div>

      {/* AI third-party consent gate (Apple 5.1.2) — must accept before
          OpenAI Vision receives body photos. Center-aligned modal. */}
      <AIConsentDialog
        open={consentOpen}
        onAgree={handleConsentAgree}
        onCancel={() => setConsentOpen(false)}
        featureName="body-analysis"
      />
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
  const { t, i18n } = useTranslation('pages');
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const posthog = usePostHog();

  // Cache keys scoped to user — survives unmount via localStorage so swapping
  // back to the Body tab after visiting Dashboard/Workouts paints instantly.
  const uid = user?.id || 'anon';
  const bodyCacheKey = `progress-body-${uid}`;

  // Hydrate reducer initial state from cached data when available. We only
  // cache the server-derived slices (weightLogs, chartData, measurements) —
  // UI-only fields (inputs, modal flags) always reset.
  const buildInitialState = () => {
    if (!hasCachedState(bodyCacheKey)) return bodyInitialState;
    // Access the cached slice directly via the hook's module-level map by
    // reading through localStorage mirror: easiest path is to just start
    // with loading=false and let the subsequent useCachedState hooks fill in.
    return { ...bodyInitialState, loading: false };
  };
  const [state, dispatch] = useReducer(bodyReducer, null, buildInitialState);
  const {
    weightLogs, chartData, period, weightInput, loggingWeight,
    weightError, latestMeasurements, prevMeasurements, measurementHistory, showMeasurements, showWeightHistory, loading,
  } = state;

  // Persist the server-data portion of reducer state across unmounts.
  // We mirror into useCachedState + rehydrate once on mount.
  const [cachedBodyData, setCachedBodyData] = useCachedState(bodyCacheKey, null);
  // On mount, if we have cached data, push it into the reducer so the UI
  // paints immediately without a skeleton. Subsequent loads will refresh.
  useEffect(() => {
    if (cachedBodyData && !weightLogs.length && !measurementHistory.length) {
      dispatch({
        type: 'SET_DATA',
        weightLogs: cachedBodyData.weightLogs || [],
        chartData: cachedBodyData.chartData || [],
        latestMeasurements: cachedBodyData.latestMeasurements || null,
        prevMeasurements: cachedBodyData.prevMeasurements || null,
        measurementHistory: cachedBodyData.measurementHistory || [],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cache the photo METADATA only (id, storage_path, taken_at, ...). Supabase
  // signed URLs expire after 1 h, so caching them caused broken <img>s
  // whenever the user opened the Body tab >1 h after their last visit. The
  // signed URLs are re-derived in the effect below from the cached metadata
  // on every mount — instant paint stays, but URLs are always fresh.
  const [photoMeta, setPhotoMeta] = useCachedState(`${bodyCacheKey}-photos`, []);
  const [progressPhotos, setProgressPhotos] = useState([]);
  useEffect(() => {
    if (!photoMeta?.length) { setProgressPhotos([]); return; }
    let cancelled = false;
    (async () => {
      const withUrls = await Promise.all(photoMeta.map(async (p) => {
        const { data } = await supabase.storage
          .from('progress-photos')
          .createSignedUrl(p.storage_path, 3600);
        return { ...p, url: data?.signedUrl || null };
      }));
      if (!cancelled) setProgressPhotos(withUrls.filter(p => p.url));
    })();
    return () => { cancelled = true; };
  }, [photoMeta]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [primaryGoal, setPrimaryGoal] = useState('general_fitness');
  // Photo zoom modal — { url, taken_at, ... }
  const [zoomPhoto, setZoomPhoto] = useState(null);

  // Auto-cleanup stale body scan data (older than 10 minutes)
  useEffect(() => {
    const STALE_THRESHOLD = 10 * 60 * 1000; // 10 minutes
    ['_bodyScanFront', '_bodyScanSide', '_pendingBodyScan'].forEach(key => {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const data = JSON.parse(raw);
          if (data.timestamp && Date.now() - data.timestamp > STALE_THRESHOLD) {
            localStorage.removeItem(key);
          }
        }
      } catch {
        localStorage.removeItem(key);
      }
    });
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('member_onboarding').select('primary_goal').eq('profile_id', user.id).maybeSingle()
      .then(({ data }) => { if (data?.primary_goal) setPrimaryGoal(data.primary_goal); });
  }, [user?.id]);

  const loadData = useCallback(async () => {
    if (!user) return;
    // Only show the loading skeleton on the very first load when we have no
    // cached data. Subsequent refreshes revalidate silently behind the paint.
    if (!hasCachedState(bodyCacheKey)) dispatch({ type: 'SET_LOADING' });

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

    // Store the photo metadata — URL signing happens in the effect above.
    // Never cache the signed URL itself (1 h expiry).
    setPhotoMeta(photos ?? []);
    const newWeightLogs = [...allLogs].reverse();
    const newChartData = allLogs.map(l => ({
      date: format(parseISO(l.logged_at), 'MMM d', { locale: i18n.language === 'es' ? esLocale : undefined }),
      weight: parseFloat(l.weight_lbs),
    }));
    const newLatest = allMeas[0] ?? null;
    const newPrev = allMeas[1] ?? null;
    dispatch({
      type: 'SET_DATA',
      weightLogs: newWeightLogs,
      chartData: newChartData,
      latestMeasurements: newLatest,
      prevMeasurements: newPrev,
      measurementHistory: allMeas,
    });
    // Mirror server-derived data to the persistent cache so the next mount
    // paints instantly instead of flashing the skeleton.
    setCachedBodyData({
      weightLogs: newWeightLogs,
      chartData: newChartData,
      latestMeasurements: newLatest,
      prevMeasurements: newPrev,
      measurementHistory: allMeas,
    });
  }, [user, period, i18n.language, setCachedBodyData, bodyCacheKey]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await loadData();
      } catch (e) {
        if (alive) console.warn('ProgressBody loadData failed:', e);
      }
    })();
    return () => { alive = false; };
  }, [loadData]);

  const handleDeletePhoto = async (photo) => {
    try {
      // Delete from storage
      await supabase.storage.from('progress-photos').remove([photo.storage_path]);
      // Delete from database
      await supabase.from('progress_photos').delete().eq('id', photo.id);
      // Update local state — strip the deleted photo from the cached META;
      // the URL-bearing `progressPhotos` derives from it via the effect above.
      setPhotoMeta(prev => prev.filter(p => p.id !== photo.id));
    } catch (err) {
      // silent — UI state unchanged on failure
    }
  };

  // Auto-open measurements modal if there's pending body scan data (Samsung WebView restart)
  useEffect(() => {
    const hasPending = localStorage.getItem('_bodyScanFront') ||
                       localStorage.getItem('_pendingBodyScan') ||
                       localStorage.getItem('_pendingBodyResult');
    if (hasPending) {
      dispatch({ type: 'TOGGLE_MEASUREMENTS', payload: true });
    }
  }, []);

  // Lock body scroll when modals are open
  useEffect(() => {
    if (showWeightHistory || showMeasurements || zoomPhoto) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showWeightHistory, showMeasurements, zoomPhoto]);

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
    posthog?.capture('body_metric_logged', { metric_type: 'weight' });
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
  const deltaColor = getProgressColor('weight', delta, primaryGoal);

  const yMin = chartData.length
    ? Math.floor(Math.min(...chartData.map(d => d.weight)) - 2)
    : undefined;
  const yMax = chartData.length
    ? Math.ceil(Math.max(...chartData.map(d => d.weight)) + 2)
    : undefined;

  if (loading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton variant="chart" />
        <Skeleton variant="card" height="h-[60px]" count={4} />
      </div>
    );
  }

  const TU_DISPLAY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';
  const TU_ACCENT = 'var(--color-accent, #2EC4C4)';

  return (
    <div>
      {/* ── Progress Photos (top) ── */}
      <div className="rounded-[22px] overflow-hidden mb-4" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
        {/* Before / Now side-by-side
            progressPhotos is ordered DESC by taken_at (newest first), so:
            - 0 photos: both slots empty
            - 1 photo: that single photo IS the user's current state, so we
              show it under "Now" / "Actual" (the "Before" slot stays empty
              prompting them to take a follow-up to compare against)
            - 2+ photos: oldest = "Antes", newest = "Actual" */}
        <div className="grid grid-cols-2 gap-px" style={{ background: 'var(--color-border-subtle)' }}>
          {['before', 'now'].map(slot => {
            let photo = null;
            if (progressPhotos.length === 1) {
              // The single photo represents the user's current state — render
              // it under "Now". The "Before" slot stays empty as a prompt to
              // take a future photo to start a comparison.
              if (slot === 'now') photo = progressPhotos[0];
            } else if (progressPhotos.length >= 2) {
              if (slot === 'before') photo = progressPhotos[progressPhotos.length - 1]; // oldest
              else photo = progressPhotos[0]; // newest
            }
            return (
              <button
                key={slot}
                type="button"
                onClick={() => photo?.url && setZoomPhoto(photo)}
                disabled={!photo?.url}
                className="flex flex-col items-center justify-center py-8 transition-transform active:scale-[0.98]"
                style={{ background: 'var(--color-bg-card)', border: 'none', cursor: photo?.url ? 'pointer' : 'default' }}
              >
                {photo?.url ? (
                  <img src={photo.url} alt={slot} className="w-20 h-20 rounded-[14px] object-cover mb-2" loading="lazy" />
                ) : (
                  <div className="w-16 h-16 rounded-[14px] flex items-center justify-center mb-2" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.03))' }}>
                    <Camera size={22} style={{ color: 'var(--color-text-muted)' }} />
                  </div>
                )}
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
                  {slot === 'before' ? t('progressBody.before', 'Before') : t('progressBody.now', 'Now')}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  {photo ? format(parseISO(photo.taken_at), 'MMM d', { locale: i18n.language === 'es' ? esLocale : undefined }) : t('progressBody.addFirst', 'Add first')}
                </p>
              </button>
            );
          })}
        </div>
        {/* Take Photo CTA */}
        <div className="flex items-center justify-between px-4 py-3.5" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
          <div>
            <p className="text-[14px] font-bold" style={{ fontFamily: TU_DISPLAY, color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>
              {t('progressBody.progressPhotos', 'Progress photos')}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('progressBody.takeMonthlyPhoto', 'Take a monthly photo')}
            </p>
          </div>
          <button
            onClick={async () => {
              const file = await takePhoto({ cameraOnly: true });
              if (!file || !user) return;
              const validation = await validateImageFile(file);
              if (!validation.valid) { showToast(validation.error, 'error'); return; }
              setUploadingPhoto(true);
              try {
                // Compress: max 1080px wide, JPEG q=0.8 — reduces storage cost
                // and load time; preserves enough detail for body comparisons.
                const compressed = await compressImage(file, 1080, 0.8);
                const path = `${user.id}/${Date.now()}-front.jpg`;
                const { data: uploadData, error: uploadErr } = await supabase.storage.from('progress-photos').upload(path, compressed, { contentType: 'image/jpeg', upsert: false });
                if (uploadErr) throw uploadErr;
                await supabase.from('progress_photos').insert({ profile_id: user.id, gym_id: profile.gym_id, storage_path: uploadData.path, view_angle: 'front', taken_at: today(), is_private: true });
                posthog?.capture('progress_photo_taken');
                loadData();
              } catch {} finally { setUploadingPhoto(false); }
            }}
            disabled={uploadingPhoto}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-bold active:scale-95 transition-all"
            style={{ background: TU_ACCENT, color: '#001512' }}>
            <Camera size={14} /> {t('progressBody.takePhotoButton', 'Take Photo')}
          </button>
        </div>
      </div>

      {/* ── Current Weight Card ── */}
      <div className="rounded-[22px] overflow-hidden mb-4 flex" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
        {/* Left: weight + date + CTA */}
        <div className="flex-1 flex flex-col">
          <div className="px-5 pt-5 pb-3 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
              {t('progress.body.currentWeight', 'Current weight')}
            </div>
            <div className="flex items-baseline gap-2 mb-1">
              <span style={{ fontFamily: TU_DISPLAY, fontSize: 42, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -2, lineHeight: 1 }}>
                {currentW != null ? fmtW(currentW) : '—'}
              </span>
              <span className="text-[16px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>lbs</span>
            </div>
            <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              {latest ? `${t('progressBody.logged', 'Logged')} ${format(parseISO(latest.logged_at), 'MMM d', { locale: i18n.language === 'es' ? esLocale : undefined })}` : ''}
              {weightLogs.length > 0 && ` ${'\u00B7'} ${t('progressBody.entriesTotal', { count: weightLogs.length, defaultValue: `${weightLogs.length} ${weightLogs.length === 1 ? 'entry' : 'entries'} total` })}`}
            </p>
          </div>
          <div className="px-5 pb-4">
            <button
              onClick={() => {
                const w = prompt(t('progress.body.enterTodaysWeight', 'Enter weight (lbs)'));
                if (w && !isNaN(parseFloat(w)) && parseFloat(w) > 0) {
                  dispatch({ type: 'SET_WEIGHT_INPUT', payload: w });
                  setTimeout(() => handleLogWeight(), 50);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-bold active:scale-95 transition-all whitespace-nowrap"
              style={{ background: 'transparent', border: `1.5px solid ${TU_ACCENT}`, color: TU_ACCENT }}>
              <Plus size={13} strokeWidth={2.5} />
              {t('progressBody.logTodaysWeight', "Log today's weight")}
            </button>
            {weightError && <p className="text-[12px] mt-2" style={{ color: 'var(--color-danger)' }}>{weightError}</p>}
          </div>
        </div>
        {/* Right: change + entries */}
        <div className="flex flex-col items-center justify-center gap-5 flex-shrink-0 pr-5" style={{ width: 120 }}>
          <div className="text-center">
            <p style={{ fontFamily: TU_DISPLAY, fontSize: 20, fontWeight: 800, color: deltaColor, lineHeight: 1 }}>
              {delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '—'}
            </p>
            <p className="text-[9px] font-bold uppercase mt-1" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.04em' }}>
              {t('progressBody.periodChange', { days: period, defaultValue: `${period}d change` })}
            </p>
          </div>
          <div className="text-center">
            <p style={{ fontFamily: TU_DISPLAY, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1 }}>
              {weightLogs.length}
            </p>
            <p className="text-[9px] font-bold uppercase mt-1" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.04em' }}>
              {t('progress.body.entries', 'Entries')}
            </p>
          </div>
        </div>
      </div>

      {/* ── Weight Trend Chart ── */}
      <div className="rounded-[22px] p-5 mb-4" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
        <div className="flex items-center justify-between mb-4">
          <p style={{ fontFamily: TU_DISPLAY, fontSize: 16, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>{t('progress.body.weightTrend')}</p>
          <div className="flex gap-1 p-1 rounded-full" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.03))' }}>
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.label}
                onClick={() => dispatch({ type: 'SET_PERIOD', payload: opt.days })}
                className="px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors"
                style={
                  period === opt.days
                    ? { background: TU_ACCENT, color: '#001512' }
                    : { background: 'transparent', color: 'var(--color-text-muted)' }
                }
              >
                {opt.labelKey ? t(opt.labelKey, opt.label) : opt.label}
              </button>
            ))}
          </div>
        </div>

        {chartData.length < 2 ? (
          <div className="h-[140px] flex flex-col items-center justify-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ background: TU_ACCENT }} />
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('progress.body.logAtLeast2', 'Log 1 more entry to see your trend')}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'var(--color-text-subtle)' }}
                tickLine={false}
                axisLine={false}
                interval={Math.max(0, Math.floor(chartData.length / 5) - 1)}
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fontSize: 10, fill: 'var(--color-text-subtle)' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ChartTooltip formatter={(v) => `${v} lbs`} nameLabel={t('progressBody.tooltipWeight')} />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
              <Area
                type="monotone"
                dataKey="weight"
                stroke="var(--color-accent)"
                strokeWidth={2}
                fill="url(#wGrad)"
                dot={false}
                activeDot={{ r: 6, strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Measurements ── */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between mb-3 px-1">
          <div style={{ fontFamily: TU_DISPLAY, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>
            {t('progress.body.measurements', 'Measurements')}
          </div>
          <button onClick={() => dispatch({ type: 'TOGGLE_MEASUREMENTS', payload: true })}
            className="text-[13px] font-bold flex items-center gap-1" style={{ color: TU_ACCENT }}>
            <Plus size={14} strokeWidth={2.5} />
            {latestMeasurements ? t('progress.body.update', 'Update') : t('progress.body.add', 'Add')}
          </button>
        </div>

        {latestMeasurements ? (
          <>
            <p className="text-[11px] mb-3 text-[var(--color-text-muted)]">
              {t('progress.body.lastRecorded')} {format(parseISO(latestMeasurements.measured_at), 'MMMM d, yyyy', { locale: i18n.language === 'es' ? esLocale : undefined })}
            </p>

            {/* Body fat warning */}
            {latestMeasurements.body_fat_pct != null && latestMeasurements.body_fat_pct > 25 && (
              <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl mb-3"
                style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.1)' }}>
                <TrendingUp size={13} className="text-[#EF4444] flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-[#EF4444]/80 leading-relaxed">
                  {t('progressBody.bodyFatAbove25')}
                </p>
              </div>
            )}

            {/* Measurement pills as horizontal scroll */}
            <div className="flex gap-2 overflow-x-auto scrollbar-none pb-2 mb-3">
              {MEASUREMENT_FIELDS.filter(f => latestMeasurements[f.key] != null).map(f => {
                const label = MEASUREMENT_LABEL_KEYS[f.key] ? t(MEASUREMENT_LABEL_KEYS[f.key]) : f.label;
                return (
                  <span key={f.key} className="px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap flex-shrink-0"
                    style={{ background: 'transparent', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                    {label}
                  </span>
                );
              })}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {MEASUREMENT_FIELDS.filter(f => latestMeasurements[f.key] != null).map(f => {
                const rawVal = parseFloat(latestMeasurements[f.key]);
                const displayVal = f.dbUnit === 'cm' ? cmToIn(rawVal) : rawVal;
                const prevRaw = prevMeasurements?.[f.key] != null ? parseFloat(prevMeasurements[f.key]) : null;
                const prevDisplay = prevRaw != null ? (f.dbUnit === 'cm' ? cmToIn(prevRaw) : prevRaw) : null;
                const d = prevDisplay != null ? Math.round((displayVal - prevDisplay) * 10) / 10 : null;
                const dColor = getProgressColor(toMetricKey(f.key), d, primaryGoal);

                return (
                  <div key={f.key} className="rounded-[14px] p-3 text-center" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                    <p style={{ fontFamily: TU_DISPLAY, fontSize: 18, fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                      {displayVal.toFixed(1)}
                      <span className="text-[10px] font-medium ml-0.5" style={{ color: 'var(--color-text-muted)' }}>{f.unit}</span>
                    </p>
                    {d != null && d !== 0 && (
                      <p className="text-[9px] font-bold mt-1 tabular-nums" style={{ color: dColor }}>
                        {d > 0 ? '+' : ''}{d.toFixed(1)} {f.unit}
                      </p>
                    )}
                    <p className="text-[9px] font-bold uppercase tracking-wider mt-1" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
                      {MEASUREMENT_LABEL_KEYS[f.key] ? t(MEASUREMENT_LABEL_KEYS[f.key]) : f.label}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Measurement trend chart */}
            {measurementHistory.length > 1 && (() => {
              const CHART_METRICS = [
                { key: 'body_fat_pct', label: t('progressBody.chartLabels.bodyFat'), color: 'var(--color-warning)', unit: '%', convert: false },
                { key: 'chest_cm', label: t('progressBody.chartLabels.chest'), color: 'var(--color-accent)', unit: 'in', convert: true },
                { key: 'waist_cm', label: t('progressBody.chartLabels.waist'), color: 'var(--color-danger)', unit: 'in', convert: true },
                { key: 'left_arm_cm', label: t('progressBody.chartLabels.arms'), color: 'var(--color-success)', unit: 'in', convert: true, avg: ['left_arm_cm', 'right_arm_cm'] },
                { key: 'left_thigh_cm', label: t('progressBody.chartLabels.thighs'), color: '#A78BFA', unit: 'in', convert: true, avg: ['left_thigh_cm', 'right_thigh_cm'] },
                { key: 'hips_cm', label: t('progressBody.chartLabels.hips'), color: 'var(--color-blue-soft)', unit: 'in', convert: true },
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
                  primaryGoal={primaryGoal}
                />
              );
            })()}
          </>
        ) : (
          <div className="py-6 text-center">
            <p className="text-[13px] text-[var(--color-text-muted)]">{t('progress.body.noMeasurementsYet')}</p>
            <p className="text-[11px] mt-1 text-[var(--color-text-muted)]">{t('progress.body.trackMeasurementsHint')}</p>
          </div>
        )}
      </div>

      {/* Progress photos timeline (if more than basic before/now) */}
      {progressPhotos.length > 2 && (() => {
        const byDate = {};
        progressPhotos.forEach(p => {
          const dateKey = format(parseISO(p.taken_at), 'yyyy-MM-dd');
          if (!byDate[dateKey]) byDate[dateKey] = { front: null, side: null, back: null };
          const angle = (p.view_angle || 'front').toLowerCase();
          if (['front', 'side', 'back'].includes(angle)) byDate[dateKey][angle] = p;
          else byDate[dateKey].front = byDate[dateKey].front || p;
        });
        const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
        const byMonth = {};
        sortedDates.forEach(d => {
          const monthKey = format(parseISO(d), 'MMMM yyyy', { locale: i18n.language === 'es' ? esLocale : undefined });
          if (!byMonth[monthKey]) byMonth[monthKey] = [];
          byMonth[monthKey].push(d);
        });
        return (
          <div className="rounded-[22px] p-5 mb-4" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
            <div className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
              {t('progressBody.photoTimeline', 'Photo timeline')}
            </div>
            <ProgressPhotoTimeline byDate={byDate} byMonth={byMonth} latestDate={sortedDates[0]} onDeletePhoto={handleDeletePhoto} onPhotoTap={setZoomPhoto} />
          </div>
        );
      })()}

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
          role="button" tabIndex={0} aria-label={t('progressBody.closeWeightHistory', 'Close weight history')} onClick={() => dispatch({ type: 'TOGGLE_WEIGHT_HISTORY', payload: false })} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') dispatch({ type: 'TOGGLE_WEIGHT_HISTORY', payload: false }); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="weight-history-title" className="w-full max-w-md max-h-[75vh] overflow-hidden rounded-[24px]"
            style={{ background: 'linear-gradient(180deg, var(--color-bg-card) 0%, var(--color-bg-secondary) 100%)', border: '1px solid var(--color-border-subtle)', boxShadow: '0 24px 80px rgba(0,0,0,0.3)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)]">
              <div>
                <p id="weight-history-title" className="text-[17px] font-bold text-[var(--color-text-primary)]">{t('progressBody.weightHistory')}</p>
                <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{weightLogs.length} {t('progressBody.entries')}</p>
              </div>
              <button onClick={() => dispatch({ type: 'TOGGLE_WEIGHT_HISTORY', payload: false })} aria-label={t('progressBody.close', 'Close')} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
                <X size={18} className="text-[var(--color-text-muted)]" />
              </button>
            </div>
            <div className="overflow-y-auto divide-y divide-[var(--color-border-subtle)]" style={{ maxHeight: 'calc(75vh - 80px)' }}>
              {weightLogs.map((log, i) => {
                const prev = weightLogs[i + 1];
                const diff = prev ? parseFloat(log.weight_lbs) - parseFloat(prev.weight_lbs) : null;
                const isToday = log.logged_at === today();
                return (
                  <div key={log.id} className="flex items-center justify-between px-5 py-3.5">
                    <div>
                      <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                        {isToday ? t('progress.body.today') : format(parseISO(log.logged_at), 'EEE, MMM d', { locale: i18n.language === 'es' ? esLocale : undefined })}
                      </p>
                      {log.notes && <p className="text-[11px] mt-0.5 text-[var(--color-text-muted)]">{['Initial weight at signup', 'Peso inicial al registrarse'].includes(log.notes) ? t('progress.body.initialWeightNote') : log.notes}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      {diff != null && (
                        <span className="text-[11px] font-bold tabular-nums"
                          style={{ color: diff === 0 ? 'var(--color-text-muted)' : diff > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                          {diff > 0 ? '+' : ''}{diff.toFixed(1)}
                        </span>
                      )}
                      <p className="text-[15px] font-black text-[var(--color-text-primary)] tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtW(log.weight_lbs)}
                        <span className="text-[10px] font-medium text-[var(--color-text-muted)] ml-0.5">lbs</span>
                      </p>
                    </div>
                  </div>
                );
              })}
              {weightLogs.length === 0 && (
                <div className="py-12 text-center">
                  <p className="text-[13px] text-[var(--color-text-muted)]">{t('progressBody.noWeightEntriesYet')}</p>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Photo zoom modal — fullscreen viewer w/ upload date */}
      {zoomPhoto && createPortal(
        <div
          role="button"
          tabIndex={0}
          aria-label={t('progressBody.closePhotoZoom', 'Close photo viewer')}
          onClick={() => setZoomPhoto(null)}
          onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') setZoomPhoto(null); }}
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center px-4 py-6 bg-black/95 backdrop-blur-xl"
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setZoomPhoto(null); }}
            aria-label={t('progressBody.close', 'Close')}
            className="absolute top-4 right-4 w-11 h-11 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}
          >
            <X size={20} className="text-white" />
          </button>
          <div
            className="flex flex-col items-center gap-4 max-w-full max-h-full"
            onClick={e => e.stopPropagation()}
          >
            <img
              src={zoomPhoto.url}
              alt={t('progressBody.progressPhotoFullAlt', 'Progress photo')}
              className="rounded-[18px] object-contain"
              style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 140px)' }}
            />
            <div className="text-center">
              <p className="text-[13px] font-bold text-white">
                {t('progressBody.takenOn', 'Taken on')}{' '}
                {format(parseISO(zoomPhoto.taken_at), 'MMMM d, yyyy', { locale: i18n.language === 'es' ? esLocale : undefined })}
              </p>
              {zoomPhoto.view_angle && (
                <p className="text-[11px] mt-1 text-white/70 capitalize">
                  {t(`progressBody.angle_${zoomPhoto.view_angle}`, zoomPhoto.view_angle)}
                </p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
