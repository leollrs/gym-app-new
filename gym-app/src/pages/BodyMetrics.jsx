import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Scale, Plus, TrendingUp, TrendingDown, Minus, X, Check, Camera, Upload, ChevronDown, ChevronRight } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { format, parseISO, subDays } from 'date-fns';

// ── Helpers ──────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const fmtW = (w) => w != null ? `${parseFloat(w).toFixed(1)}` : '—';

const tooltipStyle = {
  contentStyle: {
    background: '#111827', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10, fontSize: 12,
  },
  labelStyle: { color: '#9CA3AF' },
  itemStyle:  { color: '#D4AF37' },
};

const MEASUREMENT_FIELDS = [
  { key: 'chest_cm',       label: 'Chest',       unit: 'cm' },
  { key: 'waist_cm',       label: 'Waist',       unit: 'cm' },
  { key: 'hips_cm',        label: 'Hips',        unit: 'cm' },
  { key: 'left_arm_cm',    label: 'Left Arm',    unit: 'cm' },
  { key: 'right_arm_cm',   label: 'Right Arm',   unit: 'cm' },
  { key: 'left_thigh_cm',  label: 'Left Thigh',  unit: 'cm' },
  { key: 'right_thigh_cm', label: 'Right Thigh', unit: 'cm' },
  { key: 'body_fat_pct',   label: 'Body Fat',    unit: '%'  },
];

const PERIOD_OPTIONS = [
  { label: '1M', days: 30  },
  { label: '3M', days: 90  },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
];

// ── Measurements modal ───────────────────────────────────────────────────────
const MeasurementsModal = ({ existing, gymId, profileId, onSaved, onClose }) => {
  const empty = MEASUREMENT_FIELDS.reduce((a, f) => ({ ...a, [f.key]: '' }), {});
  const [form, setForm]   = useState(() => {
    if (!existing) return empty;
    return MEASUREMENT_FIELDS.reduce((a, f) => ({
      ...a, [f.key]: existing[f.key] != null ? String(existing[f.key]) : '',
    }), {});
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    const payload = {
      profile_id:   profileId,
      gym_id:       gymId,
      measured_at:  today(),
    };
    MEASUREMENT_FIELDS.forEach(f => {
      payload[f.key] = form[f.key] !== '' ? parseFloat(form[f.key]) : null;
    });
    const { error: err } = await supabase
      .from('body_measurements')
      .upsert(payload, { onConflict: 'profile_id,measured_at' });
    if (err) { setError(err.message); setSaving(false); return; }
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
            {existing ? 'Update Measurements' : 'Add Measurements'}
          </p>
          <button onClick={onClose}><X size={20} className="text-[#6B7280]" /></button>
        </div>

        <div className="p-5 grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
          {MEASUREMENT_FIELDS.map(f => (
            <div key={f.key}>
              <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                {f.label} ({f.unit})
              </label>
              <input
                type="number" inputMode="decimal" min={0} placeholder="—"
                value={form[f.key]}
                onChange={e => {
                  const v = e.target.value;
                  if (v === '' || v === '-') return setForm(p => ({ ...p, [f.key]: v }));
                  const n = parseFloat(v);
                  setForm(p => ({ ...p, [f.key]: (!isNaN(n) && n < 0) ? '0' : v }));
                }}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
              />
            </div>
          ))}
        </div>

        {error && <p className="text-[12px] text-red-400 px-5 pb-2">{error}</p>}

        <div className="px-5 pb-5">
          <button
            onClick={handleSave} disabled={saving}
            className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Saving…' : 'Save Measurements'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main ─────────────────────────────────────────────────────────────────────
export default function BodyMetrics() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  // Weight state
  const [weightLogs,    setWeightLogs]    = useState([]);
  const [chartData,     setChartData]     = useState([]);
  const [period,        setPeriod]        = useState(90);
  const [weightInput,   setWeightInput]   = useState('');
  const [loggingWeight, setLoggingWeight] = useState(false);
  const [weightError,   setWeightError]   = useState('');

  // Measurements state
  const [latestMeasurements, setLatestMeasurements] = useState(null);
  const [showMeasurements,   setShowMeasurements]   = useState(false);

  // Progress photos state
  const [photos,          setPhotos]          = useState([]);
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  const [uploadAngle,     setUploadAngle]     = useState('front');
  const [uploadFile,      setUploadFile]      = useState(null);
  const [uploading,       setUploading]       = useState(false);
  const [photoError,      setPhotoError]      = useState('');
  const [viewingPhoto,    setViewingPhoto]    = useState(null); // { url, angle, taken_at, id }
  const [deletingId,      setDeletingId]      = useState(null);
  const [expandedDate,    setExpandedDate]    = useState(null);

  const [loading, setLoading] = useState(true);

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const from = subDays(new Date(), period).toISOString().slice(0, 10);

    const [{ data: logs }, { data: meas }, { data: photoData }] = await Promise.all([
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
      supabase
        .from('progress_photos')
        .select('id, storage_path, view_angle, taken_at, is_private')
        .eq('profile_id', user.id)
        .order('taken_at', { ascending: false })
        .limit(30),
    ]);

    const allLogs = logs ?? [];
    setWeightLogs([...allLogs].reverse()); // reverse for history list
    setChartData(allLogs.map(l => ({
      date:   format(parseISO(l.logged_at), 'MMM d'),
      weight: parseFloat(l.weight_lbs),
    })));
    setLatestMeasurements(meas ?? null);
    const photosWithUrls = await Promise.all(
      (photoData ?? []).map(async (p) => {
        const { data } = await supabase.storage
          .from('progress-photos')
          .createSignedUrl(p.storage_path, 3600); // 1-hour expiry
        return { ...p, url: data?.signedUrl ?? '' };
      })
    );
    setPhotos(photosWithUrls);
    setLoading(false);
  }, [user, period]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Log weight ─────────────────────────────────────────────────────────────
  const handleLogWeight = async () => {
    const w = parseFloat(weightInput);
    if (!w || w <= 0) { setWeightError('Enter a valid weight'); return; }
    setLoggingWeight(true);
    setWeightError('');

    const { error } = await supabase
      .from('body_weight_logs')
      .upsert(
        { profile_id: user.id, gym_id: profile.gym_id, weight_lbs: w, logged_at: today() },
        { onConflict: 'profile_id,logged_at' }
      );

    if (error) { setWeightError(error.message); setLoggingWeight(false); return; }
    setWeightInput('');
    loadData();
    setLoggingWeight(false);
  };

  // ── Upload progress photo ───────────────────────────────────────────────────
  const compressImage = (file, { maxWidth = 1800, quality = 0.82 } = {}) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error('Compression failed')),
          'image/jpeg',
          quality,
        );
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });

  const handlePhotoUpload = async () => {
    if (!uploadFile) { setPhotoError('Please select a photo'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(uploadFile.type)) {
      setPhotoError('Only JPEG, PNG, WebP, or HEIC photos are allowed'); return;
    }
    setUploading(true);
    setPhotoError('');

    let fileToUpload;
    try {
      fileToUpload = await compressImage(uploadFile);
    } catch {
      fileToUpload = uploadFile; // fall back to original if compression fails
    }

    const path = `${user.id}/${Date.now()}-${uploadAngle}.jpg`;

    const { error: storageErr } = await supabase.storage
      .from('progress-photos')
      .upload(path, fileToUpload, { upsert: false, contentType: 'image/jpeg' });

    if (storageErr) { setPhotoError(storageErr.message); setUploading(false); return; }

    const { error: dbErr } = await supabase.from('progress_photos').insert({
      profile_id:   user.id,
      gym_id:       profile.gym_id,
      storage_path: path,
      view_angle:   uploadAngle,
      is_private:   true,
      taken_at:     new Date().toISOString(),
    });

    if (dbErr) { setPhotoError(dbErr.message); setUploading(false); return; }

    setUploadFile(null);
    setShowPhotoUpload(false);
    loadData();
    setUploading(false);
  };

  const handleDeletePhoto = async (photo) => {
    setDeletingId(photo.id);
    await supabase.storage.from('progress-photos').remove([photo.storage_path]);
    await supabase.from('progress_photos').delete().eq('id', photo.id);
    setViewingPhoto(null);
    setDeletingId(null);
    loadData();
  };

  // ── Derived stats ──────────────────────────────────────────────────────────
  const latest    = weightLogs[0]; // reversed, so index 0 = most recent
  const earliest  = weightLogs[weightLogs.length - 1];
  const currentW  = latest   ? parseFloat(latest.weight_lbs)   : null;
  const startingW = earliest ? parseFloat(earliest.weight_lbs) : null;
  const delta     = (currentW != null && startingW != null && weightLogs.length > 1)
    ? (currentW - startingW)
    : null;

  const DeltaIcon = delta == null ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const deltaColor = delta == null ? '#6B7280' : delta > 0 ? '#EF4444' : '#10B981';

  const yMin = chartData.length
    ? Math.floor(Math.min(...chartData.map(d => d.weight)) - 2)
    : undefined;
  const yMax = chartData.length
    ? Math.ceil(Math.max(...chartData.map(d => d.weight))  + 2)
    : undefined;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 md:px-6 pt-6 pb-28 md:pb-12 animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
        >
          <ArrowLeft size={18} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <div>
          <h1 className="text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>Body Metrics</h1>
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Weight & measurements over time</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* ── Stats row ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              {
                label: 'Current',
                value: currentW != null ? `${fmtW(currentW)} lbs` : '—',
                icon: Scale,
                color: '#D4AF37',
              },
              {
                label: `Change (${period}d)`,
                value: delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)} lbs` : '—',
                icon: DeltaIcon,
                color: deltaColor,
              },
              {
                label: 'Entries',
                value: weightLogs.length,
                icon: TrendingUp,
                color: '#60A5FA',
              },
            ].map(({ label, value, icon: Icon, color }) => (
              <div
                key={label}
                className="rounded-[14px] p-4 flex flex-col items-center gap-1.5 text-center"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
              >
                <Icon size={16} style={{ color }} strokeWidth={2} />
                <p className="text-[22px] font-black leading-none text-white">{value}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  {label}
                </p>
              </div>
            ))}
          </div>

          {/* ── Weight chart ───────────────────────────────────────────────── */}
          <div
            className="rounded-[14px] p-5 mb-5"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>Weight Trend</p>
              <div className="flex gap-1.5">
                {PERIOD_OPTIONS.map(opt => (
                  <button
                    key={opt.label}
                    onClick={() => setPeriod(opt.days)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors"
                    style={period === opt.days
                      ? { background: 'rgba(212,175,55,0.15)', color: '#D4AF37' }
                      : { background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {chartData.length < 2 ? (
              <div className="h-[160px] flex items-center justify-center">
                <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Log at least 2 entries to see a trend</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#D4AF37" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#D4AF37" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#6B7280' }}
                    tickLine={false} axisLine={false}
                    interval={Math.max(0, Math.floor(chartData.length / 5) - 1)}
                  />
                  <YAxis
                    domain={[yMin, yMax]}
                    tick={{ fontSize: 10, fill: '#6B7280' }}
                    tickLine={false} axisLine={false}
                  />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${v} lbs`, 'Weight']} />
                  <Area
                    type="monotone" dataKey="weight"
                    stroke="#D4AF37" strokeWidth={2}
                    fill="url(#wGrad)"
                    dot={false} activeDot={{ r: 4, fill: '#D4AF37' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── Log weight ─────────────────────────────────────────────────── */}
          <div
            className="rounded-[14px] p-5 mb-5"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
          >
            <p className="text-[14px] font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
              Log Today's Weight
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="number" inputMode="decimal" min={0}
                  placeholder="e.g. 185.5"
                  value={weightInput}
                  onChange={e => {
                    const v = e.target.value;
                    setWeightError('');
                    if (v === '' || v === '-') return setWeightInput(v);
                    const n = parseFloat(v);
                    setWeightInput((!isNaN(n) && n < 0) ? '0' : v);
                  }}
                  onKeyDown={e => e.key === 'Enter' && handleLogWeight()}
                  className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-3 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 pr-12"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
                  lbs
                </span>
              </div>
              <button
                onClick={handleLogWeight} disabled={loggingWeight}
                className="px-5 py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] disabled:opacity-50 transition-opacity flex items-center gap-2"
              >
                {loggingWeight ? (
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                ) : (
                  <Check size={16} strokeWidth={2.5} />
                )}
                Log
              </button>
            </div>
            {weightError && (
              <p className="text-[12px] text-red-400 mt-2">{weightError}</p>
            )}
            {weightLogs[0]?.logged_at === today() && (
              <p className="text-[12px] mt-2" style={{ color: 'var(--text-muted)' }}>
                Today's entry: <span style={{ color: '#D4AF37' }}>{fmtW(weightLogs[0].weight_lbs)} lbs</span> — saving again will update it.
              </p>
            )}
          </div>

          {/* ── Body measurements ───────────────────────────────────────────── */}
          <div
            className="rounded-[14px] p-5 mb-5"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>Measurements</p>
              <button
                onClick={() => setShowMeasurements(true)}
                className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-xl transition-colors"
                style={{ background: 'rgba(212,175,55,0.1)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.2)' }}
              >
                <Plus size={13} strokeWidth={2.5} />
                {latestMeasurements ? 'Update' : 'Add'}
              </button>
            </div>

            {latestMeasurements ? (
              <>
                <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
                  Last recorded {format(parseISO(latestMeasurements.measured_at), 'MMMM d, yyyy')}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {MEASUREMENT_FIELDS.filter(f => latestMeasurements[f.key] != null).map(f => (
                    <div
                      key={f.key}
                      className="rounded-xl p-3 text-center"
                      style={{ background: '#111827' }}
                    >
                      <p className="text-[18px] font-black text-white leading-none">
                        {parseFloat(latestMeasurements[f.key]).toFixed(1)}
                        <span className="text-[11px] font-medium ml-0.5" style={{ color: 'var(--text-muted)' }}>
                          {f.unit}
                        </span>
                      </p>
                      <p className="text-[10px] font-semibold uppercase tracking-wide mt-1.5" style={{ color: 'var(--text-muted)' }}>
                        {f.label}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="py-6 text-center">
                <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No measurements recorded yet</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-subtle)' }}>Track chest, waist, arms, and more</p>
              </div>
            )}
          </div>

          {/* ── Weight history ───────────────────────────────────────────────── */}
          {weightLogs.length > 0 && (
            <div
              className="rounded-[14px] overflow-hidden"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
            >
              <p className="text-[14px] font-semibold px-5 pt-4 pb-3" style={{ color: 'var(--text-primary)' }}>
                History
              </p>
              <div className="divide-y divide-white/4">
                {weightLogs.map((log, i) => {
                  const prev = weightLogs[i + 1];
                  const diff = prev ? parseFloat(log.weight_lbs) - parseFloat(prev.weight_lbs) : null;
                  return (
                    <div key={log.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-[13px] font-semibold text-[#E5E7EB]">
                          {format(parseISO(log.logged_at), 'EEE, MMM d')}
                        </p>
                        {log.notes && (
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{log.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {diff != null && (
                          <span
                            className="text-[11px] font-semibold"
                            style={{ color: diff === 0 ? '#6B7280' : diff > 0 ? '#EF4444' : '#10B981' }}
                          >
                            {diff > 0 ? '+' : ''}{diff.toFixed(1)}
                          </span>
                        )}
                        <p className="text-[15px] font-bold text-white">
                          {fmtW(log.weight_lbs)} <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>lbs</span>
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* ── Progress Photos ─────────────────────────────────────────────── */}
          <div
            className="rounded-[14px] p-5 mt-5"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>Progress Photos</p>
              <button
                onClick={() => { setShowPhotoUpload(v => !v); setPhotoError(''); setUploadFile(null); }}
                className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-xl transition-colors"
                style={{ background: 'rgba(212,175,55,0.1)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.2)' }}
              >
                <Camera size={13} strokeWidth={2.5} />
                Add Photo
              </button>
            </div>

            {/* Upload panel */}
            {showPhotoUpload && (
              <div className="mb-4 p-4 rounded-xl" style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-[12px] font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>View Angle</p>
                <div className="flex gap-2 mb-3">
                  {['front', 'side', 'back'].map(angle => (
                    <button
                      key={angle}
                      onClick={() => setUploadAngle(angle)}
                      className="flex-1 py-2 rounded-xl text-[12px] font-bold capitalize transition-all border"
                      style={uploadAngle === angle
                        ? { background: 'rgba(212,175,55,0.12)', borderColor: 'rgba(212,175,55,0.5)', color: '#D4AF37' }
                        : { background: 'transparent', borderColor: 'rgba(255,255,255,0.08)', color: 'var(--text-muted)' }}
                    >
                      {angle}
                    </button>
                  ))}
                </div>
                <label
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl cursor-pointer transition-colors"
                  style={{ border: '2px dashed rgba(255,255,255,0.1)', color: uploadFile ? '#10B981' : 'var(--text-muted)' }}
                >
                  <Upload size={16} />
                  <span className="text-[13px] font-medium">
                    {uploadFile ? uploadFile.name : 'Select photo'}
                  </span>
                  <input
                    type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="hidden"
                    onChange={e => { setUploadFile(e.target.files?.[0] ?? null); setPhotoError(''); }}
                  />
                </label>
                {photoError && <p className="text-[12px] text-red-400 mt-2">{photoError}</p>}
                <button
                  onClick={handlePhotoUpload} disabled={uploading || !uploadFile}
                  className="mt-3 w-full py-2.5 rounded-xl font-bold text-[13px] text-black transition-opacity disabled:opacity-50"
                  style={{ background: '#D4AF37' }}
                >
                  {uploading ? 'Uploading…' : 'Upload Photo'}
                </button>
              </div>
            )}

            {/* Date list — photos only load when row is expanded */}
            {photos.length === 0 ? (
              <div className="py-8 text-center">
                <Camera size={28} style={{ color: '#4B5563', margin: '0 auto 10px' }} strokeWidth={1.5} />
                <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No progress photos yet</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-subtle)' }}>Track your transformation over time</p>
              </div>
            ) : (() => {
              const byDate = {};
              photos.forEach(p => {
                const day = p.taken_at.slice(0, 10);
                if (!byDate[day]) byDate[day] = {};
                byDate[day][p.view_angle] = p;
              });
              const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
              return (
                <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                  {dates.map(day => {
                    const isOpen = expandedDate === day;
                    const angleCount = Object.keys(byDate[day]).length;
                    return (
                      <div key={day}>
                        {/* Collapsed row — date + photo count + chevron */}
                        <button
                          onClick={() => setExpandedDate(isOpen ? null : day)}
                          className="w-full flex items-center justify-between py-3 px-1 active:opacity-70 transition-opacity"
                        >
                          <div className="flex items-center gap-3">
                            <p className="text-[14px] font-semibold text-white">
                              {format(new Date(day + 'T12:00:00'), 'MMMM d, yyyy')}
                            </p>
                            <span className="text-[11px] px-2 py-0.5 rounded-full"
                              style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--text-muted)' }}>
                              {angleCount} photo{angleCount !== 1 ? 's' : ''}
                            </span>
                          </div>
                          {isOpen
                            ? <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
                            : <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
                          }
                        </button>

                        {/* Expanded — 3-column photo grid, images only mount when open */}
                        {isOpen && (
                          <div className="pb-4">
                            <div className="grid grid-cols-3 gap-2 mb-2">
                              {['Front', 'Side', 'Back'].map(a => (
                                <p key={a} className="text-center text-[10px] font-bold uppercase tracking-widest"
                                  style={{ color: 'var(--text-muted)' }}>{a}</p>
                              ))}
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              {['front', 'side', 'back'].map(angle => {
                                const photo = byDate[day][angle];
                                return photo ? (
                                  <button
                                    key={angle}
                                    onClick={() => setViewingPhoto(photo)}
                                    className="relative w-full rounded-xl overflow-hidden active:scale-95 transition-transform"
                                    style={{ aspectRatio: '3/4', background: '#111827' }}
                                  >
                                    <img
                                      src={photo.url}
                                      alt={`${angle} ${day}`}
                                      className="w-full h-full object-cover"
                                      onError={e => { e.target.style.display = 'none'; }}
                                    />
                                  </button>
                                ) : (
                                  <div
                                    key={angle}
                                    className="w-full rounded-xl flex items-center justify-center"
                                    style={{ aspectRatio: '3/4', background: '#111827', border: '1px dashed rgba(255,255,255,0.06)' }}
                                  >
                                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>—</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </>
      )}

      {/* ── Lightbox ──────────────────────────────────────────────────────── */}
      {viewingPhoto && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-sm"
          onClick={() => setViewingPhoto(null)}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-safe-top pt-4 pb-3" onClick={e => e.stopPropagation()}>
            <div>
              <p className="text-[13px] font-semibold capitalize text-white">{viewingPhoto.view_angle}</p>
              <p className="text-[11px] text-[#6B7280]">{format(new Date(viewingPhoto.taken_at), 'MMMM d, yyyy')}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleDeletePhoto(viewingPhoto)}
                disabled={deletingId === viewingPhoto.id}
                className="px-3 py-1.5 rounded-xl text-[12px] font-semibold text-red-400 border border-red-800/60 disabled:opacity-50"
              >
                {deletingId === viewingPhoto.id ? 'Deleting…' : 'Delete'}
              </button>
              <button onClick={() => setViewingPhoto(null)}>
                <X size={22} className="text-white" />
              </button>
            </div>
          </div>

          {/* Full-size image */}
          <div className="flex-1 flex items-center justify-center p-4" onClick={e => e.stopPropagation()}>
            <img
              src={viewingPhoto.url}
              alt=""
              className="max-h-full max-w-full object-contain rounded-2xl"
            />
          </div>
        </div>
      )}

      {showMeasurements && (
        <MeasurementsModal
          existing={latestMeasurements}
          gymId={profile.gym_id}
          profileId={user.id}
          onSaved={loadData}
          onClose={() => setShowMeasurements(false)}
        />
      )}
    </div>
  );
}
