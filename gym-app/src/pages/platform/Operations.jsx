import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, Database, Zap, HardDrive,
  AlertTriangle, CheckCircle2, XCircle, RefreshCw, Clock,
  Building2, ChevronRight, Bell,
  Wifi, Lock, Sparkles,
} from 'lucide-react';
import { formatDistanceToNow, subHours } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import logger from '../../lib/logger';
import FadeIn from '../../components/platform/FadeIn';
import PlatformSpinner from '../../components/platform/PlatformSpinner';

// ── Incident mute store (localStorage, 2h expiry) ────────────
// Acknowledging an incident mutes that incident type for 2 hours on this
// device — it drops out of the list and comes back automatically if the
// errors are still spiking after the window.
const MUTED_INCIDENTS_KEY = 'platform_ops_muted_incidents';
const MUTE_DURATION_MS = 2 * 60 * 60 * 1000;

function readMutedIncidents() {
  try {
    const raw = JSON.parse(localStorage.getItem(MUTED_INCIDENTS_KEY) || '{}');
    const now = Date.now();
    const live = {};
    Object.entries(raw).forEach(([id, exp]) => {
      if (typeof exp === 'number' && exp > now) live[id] = exp;
    });
    return live;
  } catch {
    return {};
  }
}

function writeMutedIncidents(map) {
  try {
    localStorage.setItem(MUTED_INCIDENTS_KEY, JSON.stringify(map));
  } catch { /* storage full/blocked — mute just won't persist */ }
}

// ── Health status helpers ────────────────────────────────────
const STATUS = {
  healthy:  { labelKey: 'platform.ops.statusHealthy',  fallback: 'Healthy',  color: '#10B981', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', icon: CheckCircle2 },
  degraded: { labelKey: 'platform.ops.statusDegraded', fallback: 'Degraded', color: '#F59E0B', bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   text: 'text-amber-400',   icon: AlertTriangle },
  failing:  { labelKey: 'platform.ops.statusFailing',  fallback: 'Failing',  color: '#EF4444', bg: 'bg-red-500/10',     border: 'border-red-500/20',     text: 'text-red-400',     icon: XCircle },
  unknown:  { labelKey: 'platform.ops.statusChecking', fallback: 'Checking', color: '#6B7280', bg: 'bg-white/5',        border: 'border-white/10',       text: 'text-[#6B7280]',   icon: Clock },
};

const SEVERITY = {
  critical: { labelKey: 'platform.ops.sevCritical', fallback: 'Critical', bg: 'bg-red-500/15',    text: 'text-red-400',    border: 'border-red-500/20',    dot: 'bg-red-400' },
  high:     { labelKey: 'platform.ops.sevHigh',     fallback: 'High',     bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/20', dot: 'bg-orange-400' },
  medium:   { labelKey: 'platform.ops.sevMedium',   fallback: 'Medium',   bg: 'bg-amber-500/15',  text: 'text-amber-400',  border: 'border-amber-500/20',  dot: 'bg-amber-400' },
  low:      { labelKey: 'platform.ops.sevLow',      fallback: 'Low',      bg: 'bg-blue-500/15',   text: 'text-blue-400',   border: 'border-blue-500/20',   dot: 'bg-blue-400' },
};

// ── Health status card ───────────────────────────────────────
function HealthCard({ label, icon: Icon, status, detail, delay = 0, t }) {
  const s = STATUS[status] || STATUS.unknown;
  const StatusIcon = s.icon;
  return (
    <FadeIn delay={delay}>
      <div className={`bg-[#0F172A] border ${s.border} rounded-xl p-3.5 hover:bg-[#111827] transition-all duration-300 group`}>
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${s.color}18` }}>
              <Icon size={14} style={{ color: s.color }} />
            </div>
            <span className="text-[12px] font-medium text-[#9CA3AF] group-hover:text-[#D1D5DB] transition-colors">{label}</span>
          </div>
          <StatusIcon size={14} className={s.text} />
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full`} style={{ backgroundColor: s.color }} />
          <span className={`text-[12px] font-semibold ${s.text}`}>{t(s.labelKey, s.fallback)}</span>
        </div>
        {detail && (
          <p className="text-[10px] text-[#6B7280] mt-1.5 truncate">{detail}</p>
        )}
      </div>
    </FadeIn>
  );
}

// ── Incident card ────────────────────────────────────────────
function IncidentCard({ severity, area, message, gymsAffected, startedAt, onAcknowledge, t, dateFnsLocale }) {
  const sev = SEVERITY[severity] || SEVERITY.medium;
  return (
    <div className={`bg-[#0F172A] border ${sev.border} rounded-xl p-4 hover:bg-[#111827] transition-colors`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`w-2 h-2 rounded-full ${sev.dot} animate-pulse`} />
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${sev.bg} ${sev.text}`}>
              {t(sev.labelKey, sev.fallback)}
            </span>
            <span className="text-[11px] text-[#6B7280]">{area}</span>
          </div>
          <p className="text-[13px] font-medium text-[#E5E7EB] mb-1">{message}</p>
          <div className="flex items-center gap-3 text-[11px] text-[#6B7280]">
            {gymsAffected > 0 && (
              <span className="flex items-center gap-1">
                <Building2 size={10} />
                {t('platform.ops.gymsAffected', { count: gymsAffected })}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock size={10} />
              {formatDistanceToNow(new Date(startedAt), { addSuffix: true, ...(dateFnsLocale || {}) })}
            </span>
          </div>
        </div>
        {onAcknowledge && (
          <button
            onClick={onAcknowledge}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white/5 text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/10 border border-white/6 transition-colors"
          >
            {t('platform.ops.acknowledge')}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Confirmation modal ──────────────────────────────────────
function ConfirmModal({ open, title, message, onConfirm, onCancel }) {
  const { t } = useTranslation('pages');
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-[#0F172A] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <h3 className="text-[15px] font-bold text-[#E5E7EB] mb-2">{title}</h3>
        <p className="text-[13px] text-[#9CA3AF] leading-relaxed mb-6">{message}</p>
        <div className="flex items-center gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-white/5 text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/10 border border-white/6 transition-colors"
          >
            {t('platform.ops.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/20 transition-colors"
          >
            {t('platform.ops.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Kill switch toggle ───────────────────────────────────────
function KillSwitch({ icon: Icon, label, description, enabled, onToggle, loading: busy }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/4 last:border-0">
      <div className="min-w-0 flex-1 mr-4">
        <p className="text-[13px] font-medium text-[#E5E7EB] flex items-center gap-1.5">
          {Icon && <Icon size={13} className="text-[#D4AF37] flex-shrink-0" />}
          {label}
        </p>
        <p className="text-[11px] text-[#6B7280] mt-0.5">{description}</p>
      </div>
      <button
        onClick={onToggle}
        disabled={busy}
        role="switch"
        aria-checked={enabled}
        className={`flex-shrink-0 w-10 h-5.5 rounded-full transition-colors duration-200 relative ${
          enabled ? 'bg-emerald-500/30' : 'bg-white/10'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4.5 h-4.5 rounded-full transition-all duration-200 ${
            enabled
              ? 'left-[calc(100%-20px)] bg-emerald-400'
              : 'left-0.5 bg-[#6B7280]'
          }`}
          style={{ width: 18, height: 18, top: 2 }}
        />
      </button>
    </div>
  );
}

// ── Per-flag display meta ────────────────────────────────────
// Order + labels for the kill-switch list. The flag set itself comes from
// platform_config feature_% rows merged over the state defaults, so a future
// flag with no entry here still renders via the humanized fallback below.
// Only 'ai' carries inline fallbacks — the other keys predate it in locales.
const FLAG_ORDER = ['referrals', 'classes', 'social', 'messaging', 'qr', 'challenges', 'nutrition', 'ai'];
const FLAG_META = {
  referrals:  { labelKey: 'platform.ops.killReferrals',  descKey: 'platform.ops.killReferralsDesc' },
  classes:    { labelKey: 'platform.ops.killClasses',    descKey: 'platform.ops.killClassesDesc' },
  social:     { labelKey: 'platform.ops.killSocial',     descKey: 'platform.ops.killSocialDesc' },
  messaging:  { labelKey: 'platform.ops.killMessaging',  descKey: 'platform.ops.killMessagingDesc' },
  qr:         { labelKey: 'platform.ops.killQr',         descKey: 'platform.ops.killQrDesc' },
  challenges: { labelKey: 'platform.ops.killChallenges', descKey: 'platform.ops.killChallengesDesc' },
  nutrition:  { labelKey: 'platform.ops.killNutrition',  descKey: 'platform.ops.killNutritionDesc' },
  ai: {
    icon: Sparkles, // the one switch that directly stops paid API spend
    labelKey: 'platform.ops.killAi',
    labelFallback: 'AI photo analysis',
    descKey: 'platform.ops.killAiDesc',
    descFallback: 'Food, menu & body photo scanning (OpenAI). Turning this off stops all paid AI calls app-wide.',
  },
};

// ── Maintenance setup modal ──────────────────────────────────
// Enable/edit flow: the message every locked-out user will see + an
// estimated duration that MaintenanceGate renders as "back around ~X".
const MAINT_DURATIONS = [15, 30, 60, 120];

function MaintenanceSetupModal({ open, onClose, onSave, saving, isActive, initialMessage, initialEta, t }) {
  const [message, setMessage] = useState('');
  const [durMin, setDurMin] = useState(30); // number | 'custom' | null (no estimate)
  const [customMin, setCustomMin] = useState('');

  useEffect(() => {
    if (!open) return;
    setMessage(initialMessage || t('platform.ops.maintenanceDefaultMsg', 'El app está en mantenimiento. Volvemos pronto 💪'));
    // Editing an active window with a future ETA → seed the remaining minutes
    // so "save" without touching duration keeps roughly the same ETA.
    const eta = initialEta ? new Date(initialEta) : null;
    const remaining = eta && !Number.isNaN(eta.getTime()) ? Math.round((eta.getTime() - Date.now()) / 60000) : null;
    if (remaining && remaining > 0) {
      if (MAINT_DURATIONS.includes(remaining)) { setDurMin(remaining); setCustomMin(''); }
      else { setDurMin('custom'); setCustomMin(String(remaining)); }
    } else if (isActive && initialEta) {
      setDurMin(null); setCustomMin('');
    } else {
      setDurMin(30); setCustomMin('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const resolvedMinutes = durMin === 'custom'
    ? (Number.parseInt(customMin, 10) > 0 ? Number.parseInt(customMin, 10) : null)
    : durMin;

  const handleSave = () => {
    const etaIso = resolvedMinutes ? new Date(Date.now() + resolvedMinutes * 60000).toISOString() : null;
    onSave({ message: message.trim(), etaIso });
  };

  const pill = (active) => `px-3 py-2 rounded-lg text-[12px] font-semibold transition-colors ${
    active ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-white/5 text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/10 border border-white/6'
  }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={saving ? undefined : onClose} />
      <div className="relative bg-[#0F172A] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h3 className="text-[15px] font-bold text-[#E5E7EB] mb-1">
          {isActive ? t('platform.ops.maintenanceEditTitle', 'Edit maintenance window') : t('platform.ops.maintenanceSetupTitle', 'Enable maintenance mode')}
        </h3>
        <p className="text-[12px] text-[#6B7280] leading-relaxed mb-4">{t('platform.ops.confirmAffectsAll')}</p>

        <label className="block text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-[0.06em] mb-1.5">
          {t('platform.ops.maintenanceMessageLabel', 'Internal note (optional)')}
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          maxLength={220}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-amber-500/40 resize-none mb-1.5"
        />
        <p className="text-[11px] text-[#6B7280] leading-relaxed mb-4">
          {t('platform.ops.maintenanceMessageHint', 'Users always see the standard maintenance copy in their own language (EN/ES) — this note is stored for the ops record only.')}
        </p>

        <label className="block text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-[0.06em] mb-1.5">
          {t('platform.ops.maintenanceEtaLabel', 'Estimated duration')}
        </label>
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {MAINT_DURATIONS.map((m) => (
            <button key={m} type="button" onClick={() => { setDurMin(m); setCustomMin(''); }} className={pill(durMin === m)}>
              {t('platform.ops.maintenanceMin', '{{n}} min', { n: m })}
            </button>
          ))}
          <input
            type="number"
            min="1"
            max="1440"
            value={customMin}
            onChange={(e) => { setCustomMin(e.target.value); setDurMin('custom'); }}
            onFocus={() => setDurMin('custom')}
            placeholder={t('platform.ops.maintenanceCustomMin', 'Other (min)')}
            className={`w-24 bg-white/5 border rounded-lg px-3 py-2 text-[12px] text-[#E5E7EB] placeholder-[#4B5563] outline-none ${durMin === 'custom' ? 'border-amber-500/40' : 'border-white/10'}`}
          />
          <button type="button" onClick={() => { setDurMin(null); setCustomMin(''); }} className={pill(durMin === null)}>
            {t('platform.ops.maintenanceNoEta', 'No estimate')}
          </button>
        </div>

        <div className="flex items-center gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-white/5 text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/10 border border-white/6 transition-colors"
          >
            {t('platform.ops.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (durMin === 'custom' && !resolvedMinutes)}
            className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/20 transition-colors disabled:opacity-50"
          >
            {saving
              ? t('platform.ops.maintenanceSaving', 'Saving…')
              : isActive ? t('platform.ops.maintenanceUpdate', 'Save changes') : t('platform.ops.maintenanceActivate', 'Enable maintenance')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────
export default function Operations() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;

  useEffect(() => {
    document.title = `${t('platform.ops.title', 'Operations')} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [t]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [configWarning, setConfigWarning] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  // Health checks
  const [health, setHealth] = useState({
    api: 'unknown',
    auth: 'unknown',
    database: 'unknown',
    storage: 'unknown',
    edge: 'unknown',
    realtime: 'unknown',
  });
  const [healthDetails, setHealthDetails] = useState({});

  // Incidents (derived from errors + health)
  const [incidents, setIncidents] = useState([]);
  const [incidentsError, setIncidentsError] = useState(false);
  const [mutedIncidents, setMutedIncidents] = useState(() => readMutedIncidents());

  // Blast radius
  const [affectedGyms, setAffectedGyms] = useState([]);
  const [affectedFeatures, setAffectedFeatures] = useState([]);

  // Kill switches — defaults; real values are the platform_config feature_%
  // rows merged over these in fetchFeatureFlags. 'ai' (0551) gates the only
  // direct per-call spend (OpenAI photo analysis).
  const [features, setFeatures] = useState({
    referrals: true,
    classes: true,
    social: true,
    messaging: true,
    qr: true,
    challenges: true,
    nutrition: true,
    ai: true,
  });
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [maintenanceEta, setMaintenanceEta] = useState(null); // ISO string | null
  const [maintModalOpen, setMaintModalOpen] = useState(false);
  const [maintSaving, setMaintSaving] = useState(false);
  const [savingFeature, setSavingFeature] = useState(null);

  // Confirmation modal
  const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', onConfirm: null });

  // Stats
  const [stats, setStats] = useState({
    totalErrors24h: 0,
    totalGyms: 0,
    activeGyms: 0,
  });

  // Gyms whose member activity is dropping/silent (same rule as Gym Health).
  const [goingQuietCount, setGoingQuietCount] = useState(0);

  const checkHealth = useCallback(async () => {
    const newHealth = {};
    const details = {};

    // 1. Database / API health — try a simple query
    try {
      const start = performance.now();
      const { error } = await supabase.from('gyms').select('id').limit(1);
      const elapsed = Math.round(performance.now() - start);
      if (error) {
        newHealth.database = 'failing';
        details.database = error.message;
      } else if (elapsed > 3000) {
        newHealth.database = 'degraded';
        details.database = `Slow: ${elapsed}ms`;
      } else {
        newHealth.database = 'healthy';
        details.database = `${elapsed}ms`;
      }
      newHealth.api = newHealth.database; // API health piggybacks on DB
      details.api = details.database;
    } catch (err) {
      newHealth.database = 'failing';
      newHealth.api = 'failing';
      details.database = err.message;
      details.api = err.message;
    }

    // 2. Auth health — check session
    try {
      const start = performance.now();
      const { error } = await supabase.auth.getSession();
      const elapsed = Math.round(performance.now() - start);
      if (error) {
        newHealth.auth = 'failing';
        details.auth = error.message;
      } else if (elapsed > 2000) {
        newHealth.auth = 'degraded';
        details.auth = `Slow: ${elapsed}ms`;
      } else {
        newHealth.auth = 'healthy';
        details.auth = `${elapsed}ms`;
      }
    } catch (err) {
      newHealth.auth = 'failing';
      details.auth = err.message;
    }

    // 3. Storage health — check bucket listing
    try {
      const start = performance.now();
      const { error } = await supabase.storage.listBuckets();
      const elapsed = Math.round(performance.now() - start);
      if (error) {
        newHealth.storage = 'failing';
        details.storage = error.message;
      } else if (elapsed > 3000) {
        newHealth.storage = 'degraded';
        details.storage = `Slow: ${elapsed}ms`;
      } else {
        newHealth.storage = 'healthy';
        details.storage = `${elapsed}ms`;
      }
    } catch (err) {
      newHealth.storage = 'failing';
      details.storage = err.message;
    }

    // 4. Edge functions — invoke the health-check function. If it
    // hasn't been deployed yet (CORS / network failure), fall back to
    // 'unknown' silently rather than surfacing a raw English error.
    try {
      const start = performance.now();
      const { error } = await supabase.functions.invoke('health-check', { method: 'POST' });
      const elapsed = Math.round(performance.now() - start);
      if (error) {
        const msg = error.message || '';
        // 4xx response means runtime is reachable — count as healthy.
        const isRuntimeReachable = msg.includes('404') || msg.includes('not found')
          || msg.includes('401') || msg.includes('403') || msg.includes('Invalid');
        if (isRuntimeReachable) {
          newHealth.edge = elapsed > 3000 ? 'degraded' : 'healthy';
          details.edge = elapsed > 3000 ? `Slow: ${elapsed}ms` : `${elapsed}ms`;
        } else {
          newHealth.edge = 'unknown';
          details.edge = null;
        }
      } else {
        newHealth.edge = elapsed > 3000 ? 'degraded' : 'healthy';
        details.edge = `${elapsed}ms`;
      }
    } catch {
      newHealth.edge = 'unknown';
      details.edge = null;
    }

    // 5. Realtime — check channel subscription capability
    try {
      const realtimeResult = await new Promise((resolve) => {
        const channel = supabase.channel('health-check-' + Date.now());
        const timeout = setTimeout(() => {
          channel.unsubscribe();
          supabase.removeChannel(channel);
          resolve({ status: 'degraded', detail: 'Timeout (5s)' });
        }, 5000);

        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timeout);
            channel.unsubscribe();
            supabase.removeChannel(channel);
            resolve({ status: 'healthy', detail: 'Connected' });
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            clearTimeout(timeout);
            channel.unsubscribe();
            supabase.removeChannel(channel);
            resolve({ status: 'failing', detail: `Status: ${status}` });
          }
        });
      });
      newHealth.realtime = realtimeResult.status;
      details.realtime = realtimeResult.detail;
    } catch (err) {
      newHealth.realtime = 'failing';
      details.realtime = err.message || 'Connection failed';
    }

    setHealth(newHealth);
    setHealthDetails(details);
    return newHealth;
  }, []);

  const fetchIncidents = useCallback(async () => {
    try {
      // Get recent errors (last 2 hours) to detect incidents
      const twoHoursAgo = subHours(new Date(), 2).toISOString();
      const { data: recentErrors, error: incErr } = await supabase
        .from('error_logs')
        .select('type, gym_id, created_at, message, page')
        .gte('created_at', twoHoursAgo)
        .order('created_at', { ascending: false })
        .limit(200);

      if (incErr) {
        // A failed error_logs read must NOT fall through to the green "all
        // systems operational" panel — incident detection is blind, so flag a
        // degraded state instead (mirrors Attention/ErrorLogs honest-failure).
        logger.error('fetchIncidents: error_logs query failed:', incErr);
        setIncidentsError(true);
        return;
      }
      setIncidentsError(false);

      const errors = recentErrors || [];
      const derived = [];

      // Group errors by type and check for spikes
      const byType = {};
      errors.forEach(e => {
        byType[e.type] = byType[e.type] || [];
        byType[e.type].push(e);
      });

      // Auth errors spike
      const authErrors = byType.auth_error || [];
      if (authErrors.length >= 5) {
        const affectedGymIds = [...new Set(authErrors.map(e => e.gym_id).filter(Boolean))];
        derived.push({
          id: 'auth-spike',
          severity: authErrors.length >= 20 ? 'critical' : 'high',
          area: 'Authentication',
          message: `${authErrors.length} auth failures in last 2h`,
          gymsAffected: affectedGymIds.length,
          startedAt: authErrors[authErrors.length - 1]?.created_at || new Date().toISOString(),
        });
      }

      // API/network errors
      const apiErrors = [...(byType.api_error || []), ...(byType.network_error || [])];
      if (apiErrors.length >= 10) {
        const affectedGymIds = [...new Set(apiErrors.map(e => e.gym_id).filter(Boolean))];
        derived.push({
          id: 'api-spike',
          severity: apiErrors.length >= 30 ? 'critical' : 'high',
          area: 'API',
          message: `${apiErrors.length} API/network errors in last 2h`,
          gymsAffected: affectedGymIds.length,
          startedAt: apiErrors[apiErrors.length - 1]?.created_at || new Date().toISOString(),
        });
      }

      // React crashes
      const crashes = byType.react_crash || [];
      if (crashes.length >= 3) {
        derived.push({
          id: 'crash-spike',
          severity: 'high',
          area: 'App Stability',
          message: `${crashes.length} React crashes in last 2h`,
          gymsAffected: [...new Set(crashes.map(e => e.gym_id).filter(Boolean))].length,
          startedAt: crashes[crashes.length - 1]?.created_at || new Date().toISOString(),
        });
      }

      // Slow API
      const slowAPIs = byType.slow_api || [];
      if (slowAPIs.length >= 5) {
        derived.push({
          id: 'slow-api',
          severity: 'medium',
          area: 'Performance',
          message: `${slowAPIs.length} slow API responses in last 2h`,
          gymsAffected: [...new Set(slowAPIs.map(e => e.gym_id).filter(Boolean))].length,
          startedAt: slowAPIs[slowAPIs.length - 1]?.created_at || new Date().toISOString(),
        });
      }

      setIncidents(derived);

      // Build blast radius from incidents
      const allGymIds = [...new Set(errors.map(e => e.gym_id).filter(Boolean))];
      if (allGymIds.length > 0) {
        const { data: gyms } = await supabase
          .from('gyms')
          .select('id, name, slug')
          .in('id', allGymIds.slice(0, 20));
        setAffectedGyms(gyms || []);
      } else {
        setAffectedGyms([]);
      }

      // Affected features from error pages
      const affectedPages = [...new Set(errors.map(e => e.page).filter(Boolean))];
      setAffectedFeatures(affectedPages.slice(0, 10));

      // Stats
      const { count: errorCount } = await supabase
        .from('error_logs')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', subHours(new Date(), 24).toISOString());

      const { count: gymCount } = await supabase
        .from('gyms')
        .select('id', { count: 'exact', head: true });

      const { count: activeGymCount } = await supabase
        .from('gyms')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true);

      setStats(prev => ({
        ...prev,
        totalErrors24h: errorCount || 0,
        totalGyms: gymCount || 0,
        activeGyms: activeGymCount || 0,
      }));
    } catch (err) {
      logger.error('Failed to fetch incidents:', err);
      setIncidentsError(true);
    }
  }, []);

  // Member-activity "going quiet" count — mirrors the Gym Health watchlist
  // rule so the daily Operations sweep flags gyms cooling off before churn.
  const fetchGoingQuiet = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('platform_gym_activity_pulse', { p_window_days: 14 });
      if (error || !data) { setGoingQuietCount(0); return; }
      const now = new Date().getTime();
      const count = data.filter((g) => {
        const cur = Number(g.cur_checkins) + Number(g.cur_workouts);
        const prior = Number(g.prior_checkins) + Number(g.prior_workouts);
        const declinePct = prior > 0 ? Math.round(((prior - cur) / prior) * 100) : (cur === 0 ? 100 : 0);
        const daysSince = g.last_activity ? Math.floor((now - new Date(g.last_activity).getTime()) / 86400000) : null;
        return daysSince !== null && (daysSince >= 7 || (declinePct >= 40 && prior >= 3));
      }).length;
      setGoingQuietCount(count);
    } catch {
      setGoingQuietCount(0);
    }
  }, []);

  const fetchFeatureFlags = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('platform_config')
        .select('key, value')
        .like('key', 'feature_%');

      if (error) {
        setConfigWarning(t('platform.ops.configWarning', 'platform_config table not available — using default feature flags.'));
      } else {
        setConfigWarning(null);
        if (data) {
          const flags = {};
          data.forEach(({ key, value }) => {
            const name = key.replace('feature_', '');
            flags[name] = value === 'true' || value === true;
          });
          setFeatures(prev => ({ ...prev, ...flags }));
        }
      }

      const { data: maintRows } = await supabase
        .from('platform_config')
        .select('key, value')
        .in('key', ['maintenance_mode', 'maintenance_message', 'maintenance_eta']);
      const maintMap = Object.fromEntries((maintRows || []).map((r) => [r.key, r.value]));
      setMaintenanceMode(maintMap.maintenance_mode === 'true' || maintMap.maintenance_mode === true);
      setMaintenanceMessage(typeof maintMap.maintenance_message === 'string' ? maintMap.maintenance_message : '');
      setMaintenanceEta(typeof maintMap.maintenance_eta === 'string' && maintMap.maintenance_eta ? maintMap.maintenance_eta : null);
    } catch {
      setConfigWarning(t('platform.ops.configWarning', 'platform_config table not available — using default feature flags.'));
    }
  }, [t]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([checkHealth(), fetchIncidents(), fetchFeatureFlags(), fetchGoingQuiet()]);
    setLastRefresh(new Date());
    setRefreshing(false);
  }, [checkHealth, fetchIncidents, fetchFeatureFlags, fetchGoingQuiet]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([checkHealth(), fetchIncidents(), fetchFeatureFlags(), fetchGoingQuiet()]);
      setLastRefresh(new Date());
      setLoading(false);
    };
    init();
  }, [checkHealth, fetchIncidents, fetchFeatureFlags, fetchGoingQuiet]);

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(() => {
      handleRefresh();
    }, 60000);
    return () => clearInterval(interval);
  }, [handleRefresh]);

  // supabase-js v2 never throws from .from() — the old try/catch was dead
  // code and a failed write left the switch lying. Check { error }, revert
  // the optimistic flip and warn instead.
  const executeToggleFeature = async (key) => {
    setSavingFeature(key);
    const newVal = !features[key];
    setFeatures(prev => ({ ...prev, [key]: newVal }));

    const { error } = await supabase.from('platform_config').upsert({
      key: `feature_${key}`,
      value: String(newVal),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });

    if (error) {
      setFeatures(prev => ({ ...prev, [key]: !newVal }));
      setConfigWarning(t('platform.ops.flagSaveFailed', "Couldn't save the feature flag — nothing was changed. Try again."));
    } else {
      // Write landed → the table is reachable; clear any stale warning.
      setConfigWarning(null);
      logAdminAction('toggle_feature_flag', 'platform_config', null, { flag: key, enabled: newVal });
    }
    setSavingFeature(null);
  };

  const toggleFeature = (key, label) => {
    const isEnabled = features[key];
    if (isEnabled) {
      // Disabling a feature — requires confirmation
      setConfirmModal({
        open: true,
        title: t('platform.ops.confirmDisableTitle', { feature: label }),
        message: `${t('platform.ops.confirmAffectsAllGyms')} ${t('platform.ops.killSwitchPropagation', 'Changes take about a minute to reach member apps.')}`,
        onConfirm: () => {
          setConfirmModal(prev => ({ ...prev, open: false }));
          executeToggleFeature(key);
        },
      });
    } else {
      // Re-enabling is safe — no confirmation needed
      executeToggleFeature(key);
    }
  };

  // ── Incident acknowledge → 2h mute (localStorage) ──────────
  const acknowledgeIncident = useCallback((incidentId) => {
    setMutedIncidents(prev => {
      const next = { ...readMutedIncidents(), ...prev, [incidentId]: Date.now() + MUTE_DURATION_MS };
      writeMutedIncidents(next);
      return next;
    });
  }, []);

  const now = Date.now();
  const visibleIncidents = incidents.filter((inc) => !(mutedIncidents[inc.id] > now));
  const mutedCount = incidents.length - visibleIncidents.length;

  // Writes all three maintenance keys in one upsert. supabase-js never throws
  // from .from(), so the result's { error } is the only failure signal — the
  // old try/catch version could show "maintenance on" after a failed write.
  const saveMaintenance = async ({ enabled, message, etaIso }) => {
    setMaintSaving(true);
    const now = new Date().toISOString();
    const { error } = await supabase.from('platform_config').upsert([
      { key: 'maintenance_mode',    value: String(enabled), updated_at: now },
      { key: 'maintenance_message', value: message ?? '',   updated_at: now },
      { key: 'maintenance_eta',     value: etaIso ?? '',    updated_at: now },
    ], { onConflict: 'key' });
    setMaintSaving(false);
    if (error) {
      setConfigWarning(t('platform.ops.maintenanceSaveFailed', "Couldn't save maintenance mode — try again."));
      return false;
    }
    setMaintenanceMode(enabled);
    setMaintenanceMessage(message ?? '');
    setMaintenanceEta(etaIso ?? null);
    logAdminAction('toggle_maintenance', 'platform_config', null, { enabled, eta: etaIso || null });
    return true;
  };

  const disableMaintenance = () => {
    setConfirmModal({
      open: true,
      title: t('platform.ops.confirmDisableMaintenanceTitle'),
      message: t('platform.ops.confirmAffectsAll'),
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, open: false }));
        await saveMaintenance({ enabled: false, message: maintenanceMessage, etaIso: null });
      },
    });
  };

  const overallStatus = Object.values(health).some(s => s === 'failing')
    ? 'failing'
    : Object.values(health).some(s => s === 'degraded')
    ? 'degraded'
    : Object.values(health).every(s => s === 'healthy')
    ? 'healthy'
    : 'unknown';

  const overallCfg = STATUS[overallStatus];

  if (loading) {
    return <PlatformSpinner />;
  }

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-5xl pb-28 md:pb-12">
      {/* Header */}
      <FadeIn>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-bold text-[#E5E7EB]">{t('platform.ops.title')}</h1>
            <p className="text-[12px] text-[#6B7280] mt-0.5 flex items-center gap-2">
              {t('platform.ops.subtitle')}
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${overallCfg.bg} ${overallCfg.text} ${overallCfg.border} border`}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: overallCfg.color }} />
                {t(overallCfg.labelKey, overallCfg.fallback)}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#4B5563] hidden sm:block">
              {t('platform.ops.updatedPrefix', 'Updated')} {formatDistanceToNow(lastRefresh, { addSuffix: true, ...(dateFnsLocale || {}) })}
            </span>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white/5 text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/10 border border-white/6 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              {t('platform.ops.refresh')}
            </button>
            <button
              onClick={() => navigate('/platform/error-logs')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white/5 text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/10 border border-white/6 transition-colors"
            >
              {t('platform.ops.errorLogs')}
            </button>
          </div>
        </div>
      </FadeIn>

      {/* Config warning banner */}
      {configWarning && (
        <div className="mb-4 flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-amber-500/8 border border-amber-500/20 text-amber-400 text-[12px]">
          <AlertTriangle size={14} className="flex-shrink-0" />
          <span>{configWarning}</span>
        </div>
      )}

      {/* Health strip */}
      <FadeIn delay={50}>
        <div className="mb-6">
          <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em] mb-3">{t('platform.ops.serviceHealth')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
            <HealthCard label={t('platform.ops.labelApi')}      icon={Zap}       status={health.api}      detail={healthDetails.api}      delay={60}  t={t} />
            <HealthCard label={t('platform.ops.labelAuth')}     icon={Lock}      status={health.auth}     detail={healthDetails.auth}     delay={80}  t={t} />
            <HealthCard label={t('platform.ops.labelDatabase')} icon={Database}  status={health.database} detail={healthDetails.database} delay={100} t={t} />
            <HealthCard label={t('platform.ops.labelStorage')}  icon={HardDrive} status={health.storage}  detail={healthDetails.storage}  delay={120} t={t} />
            <HealthCard label={t('platform.ops.labelEdgeFns')}  icon={Zap}       status={health.edge}     detail={healthDetails.edge}     delay={140} t={t} />
            <HealthCard label={t('platform.ops.labelRealtime')} icon={Wifi}      status={health.realtime} detail={healthDetails.realtime} delay={160} t={t} />
          </div>
        </div>
      </FadeIn>

      {/* Active incidents */}
      <FadeIn delay={180}>
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em]">
              {t('platform.ops.activeIncidents')}
              {visibleIncidents.length > 0 && (
                <span className="ml-2 text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded-full text-[10px] normal-case">
                  {visibleIncidents.length}
                </span>
              )}
              {mutedCount > 0 && (
                <span className="ml-2 text-[#9CA3AF] bg-white/5 px-1.5 py-0.5 rounded-full text-[10px] normal-case border border-white/6">
                  {t('platform.ops.mutedCount', 'muted ({{count}})', { count: mutedCount })}
                </span>
              )}
            </p>
          </div>

          {visibleIncidents.length === 0 ? (
            incidentsError ? (
              <div className="bg-[#0F172A] border border-amber-500/20 rounded-xl p-6 text-center">
                <AlertTriangle size={28} className="mx-auto text-amber-400 mb-2" />
                <p className="text-[13px] font-medium text-amber-400">
                  {t('platform.ops.incidentsUnavailable', 'Could not evaluate incidents')}
                </p>
                <p className="text-[11px] text-[#6B7280] mt-1">
                  {t('platform.ops.incidentsUnavailableDesc', 'The error feed could not be read, so incident detection is blind this cycle — this is not an all-clear. Retry shortly.')}
                </p>
              </div>
            ) : mutedCount > 0 ? (
              <div className="bg-[#0F172A] border border-white/10 rounded-xl p-6 text-center">
                <Bell size={28} className="mx-auto text-[#9CA3AF] mb-2" />
                <p className="text-[13px] font-medium text-[#E5E7EB]">
                  {t('platform.ops.allIncidentsMuted', 'No unacknowledged incidents')}
                </p>
                <p className="text-[11px] text-[#6B7280] mt-1">
                  {t('platform.ops.allIncidentsMutedDesc', '{{count}} acknowledged — muted for 2 hours, they come back if still firing.', { count: mutedCount })}
                </p>
              </div>
            ) : (
              <div className="bg-[#0F172A] border border-emerald-500/20 rounded-xl p-6 text-center">
                <CheckCircle2 size={28} className="mx-auto text-emerald-400 mb-2" />
                <p className="text-[13px] font-medium text-emerald-400">{t('platform.ops.allSystemsOperational')}</p>
                <p className="text-[11px] text-[#6B7280] mt-1">{t('platform.ops.noActiveIncidents')}</p>
              </div>
            )
          ) : (
            <div className="space-y-2.5">
              {visibleIncidents.map((inc) => (
                <IncidentCard
                  key={inc.id}
                  {...inc}
                  onAcknowledge={() => acknowledgeIncident(inc.id)}
                  t={t}
                  dateFnsLocale={dateFnsLocale}
                />
              ))}
            </div>
          )}
        </div>
      </FadeIn>

      {/* Gyms going quiet — member-activity early-warning, links to the
          full watchlist on Gym Health. Only shown when there's something. */}
      {goingQuietCount > 0 && (
        <FadeIn delay={170}>
          <button
            onClick={() => navigate('/platform/gym-health')}
            className="w-full mb-6 flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/8 border border-amber-500/20 hover:bg-amber-500/12 transition-colors text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0">
              <Activity size={16} className="text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-[#E5E7EB]">
                {t('platform.ops.goingQuiet', { count: goingQuietCount, defaultValue: '{{count}} gyms going quiet' })}
              </p>
              <p className="text-[11px] text-[#6B7280]">
                {t('platform.ops.goingQuietDesc', 'Member activity dropping or silent — review on Gym Health')}
              </p>
            </div>
            <ChevronRight size={14} className="text-[#6B7280] group-hover:text-amber-400 transition-colors flex-shrink-0" />
          </button>
        </FadeIn>
      )}

      {/* Blast radius (only show when there are unmuted incidents) */}
      {visibleIncidents.length > 0 && (
        <FadeIn delay={220}>
          <div className="mb-6">
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em] mb-3">{t('platform.ops.blastRadius')}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Affected gyms */}
              <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
                <p className="text-[12px] font-semibold text-[#9CA3AF] mb-3 flex items-center gap-2">
                  <Building2 size={13} />
                  {t('platform.ops.affectedGyms')}
                  {affectedGyms.length > 0 && (
                    <span className="text-[10px] text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded-full">
                      {affectedGyms.length}
                    </span>
                  )}
                </p>
                {affectedGyms.length === 0 ? (
                  <p className="text-[12px] text-[#6B7280]">{t('platform.ops.noGymsIdentified')}</p>
                ) : (
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                    {affectedGyms.map((gym) => (
                      <button
                        key={gym.id}
                        onClick={() => navigate(`/platform/gym/${gym.id}`)}
                        className="w-full flex items-center justify-between py-1.5 px-2 rounded-lg text-left hover:bg-white/[0.03] transition-colors group"
                      >
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium text-[#E5E7EB] truncate group-hover:text-white">{gym.name}</p>
                          <p className="text-[10px] text-[#6B7280]">{gym.slug}</p>
                        </div>
                        <ChevronRight size={12} className="text-[#4B5563] group-hover:text-[#D4AF37] transition-colors flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Affected features */}
              <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
                <p className="text-[12px] font-semibold text-[#9CA3AF] mb-3 flex items-center gap-2">
                  <AlertTriangle size={13} />
                  {t('platform.ops.affectedFeatures')}
                </p>
                {affectedFeatures.length === 0 ? (
                  <p className="text-[12px] text-[#6B7280]">{t('platform.ops.noFeaturesIdentified')}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {affectedFeatures.map((feature) => (
                      <span
                        key={feature}
                        className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 border border-red-500/15"
                      >
                        {feature}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </FadeIn>
      )}

      {/* Quick stats */}
      <FadeIn delay={260}>
        <div className="mb-6">
          <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em] mb-3">{t('platform.ops.platformSnapshot')}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
              <p className="text-[20px] font-bold text-[#E5E7EB] tabular-nums">{stats.totalErrors24h}</p>
              <p className="text-[11px] text-[#6B7280] mt-0.5">{t('platform.ops.errors24h')}</p>
            </div>
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
              <p className="text-[20px] font-bold text-[#E5E7EB] tabular-nums">{stats.totalGyms}</p>
              <p className="text-[11px] text-[#6B7280] mt-0.5">{t('platform.ops.totalGyms')}</p>
            </div>
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
              <p className="text-[20px] font-bold text-[#E5E7EB] tabular-nums">{stats.activeGyms}</p>
              <p className="text-[11px] text-[#6B7280] mt-0.5">{t('platform.ops.activeGyms')}</p>
            </div>
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
              <p className="text-[20px] font-bold text-emerald-400 tabular-nums">
                {stats.totalGyms > 0 ? Math.round((stats.activeGyms / stats.totalGyms) * 100) : 0}%
              </p>
              <p className="text-[11px] text-[#6B7280] mt-0.5">{t('platform.ops.activeGymRate')}</p>
            </div>
          </div>
        </div>
      </FadeIn>

      {/* Immediate actions */}
      <FadeIn delay={300}>
        <div className="mb-6">
          <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em] mb-3">{t('platform.ops.immediateActions')}</p>

          {/* Maintenance mode banner — enable opens the setup modal (message +
              estimated duration); disable keeps the confirm step. */}
          <div className={`bg-[#0F172A] border rounded-xl p-4 mb-3 ${
            maintenanceMode ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/6'
          }`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  maintenanceMode ? 'bg-amber-500/15' : 'bg-white/5'
                }`}>
                  <AlertTriangle size={16} className={maintenanceMode ? 'text-amber-400' : 'text-[#6B7280]'} />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[#E5E7EB]">{t('platform.ops.maintenanceMode')}</p>
                  <p className="text-[11px] text-[#6B7280]">
                    {maintenanceMode
                      ? t('platform.ops.maintenanceActive')
                      : t('platform.ops.maintenanceDisabled')}
                  </p>
                  {maintenanceMode && (
                    <div className="mt-1.5 space-y-0.5">
                      {maintenanceMessage && (
                        <p className="text-[11px] text-amber-200/80 truncate">“{maintenanceMessage}”</p>
                      )}
                      {maintenanceEta && !Number.isNaN(new Date(maintenanceEta).getTime()) && (
                        <p className="text-[11px] font-semibold text-amber-400">
                          {t('platform.ops.maintenanceUntilApprox', 'Until ~{{time}}', {
                            time: new Date(maintenanceEta).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
                          })}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {maintenanceMode && (
                  <button
                    onClick={() => setMaintModalOpen(true)}
                    className="px-3 py-2 rounded-lg text-[12px] font-semibold bg-white/5 text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/10 transition-colors"
                  >
                    {t('platform.ops.maintenanceEdit', 'Edit')}
                  </button>
                )}
                <button
                  onClick={() => (maintenanceMode ? disableMaintenance() : setMaintModalOpen(true))}
                  role="switch"
                  aria-checked={maintenanceMode}
                  className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors ${
                    maintenanceMode
                      ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                      : 'bg-white/5 text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/10'
                  }`}
                >
                  {maintenanceMode ? t('platform.ops.disable') : t('platform.ops.enable')}
                </button>
              </div>
            </div>
          </div>

          <MaintenanceSetupModal
            open={maintModalOpen}
            onClose={() => setMaintModalOpen(false)}
            saving={maintSaving}
            isActive={maintenanceMode}
            initialMessage={maintenanceMessage}
            initialEta={maintenanceEta}
            t={t}
            onSave={async (payload) => {
              const ok = await saveMaintenance({ enabled: true, ...payload });
              if (ok) setMaintModalOpen(false);
            }}
          />

          {/* Feature kill switches */}
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
            <p className="text-[12px] font-semibold text-[#9CA3AF] mb-1">{t('platform.ops.featureKillSwitches')}</p>
            <p className="text-[11px] text-[#6B7280] mb-3">
              {t('platform.ops.killSwitchPropagation', 'Changes take about a minute to reach member apps.')}
            </p>
            {[
              ...FLAG_ORDER.filter(key => key in features),
              ...Object.keys(features).filter(key => !FLAG_ORDER.includes(key)).sort(),
            ].map(key => {
              const meta = FLAG_META[key];
              // Unknown flag (a future feature_% row with no meta entry):
              // humanize the key and render a generic description.
              const label = meta
                ? t(meta.labelKey, meta.labelFallback)
                : key.replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
              const description = meta
                ? t(meta.descKey, meta.descFallback)
                : t('platform.ops.killUnknownDesc', 'Platform feature flag ({{key}}). No description registered for this switch.', { key: `feature_${key}` });
              return (
                <KillSwitch
                  key={key}
                  icon={meta?.icon}
                  label={label}
                  description={description}
                  enabled={features[key]}
                  onToggle={() => toggleFeature(key, label)}
                  loading={savingFeature === key}
                />
              );
            })}
          </div>
        </div>
      </FadeIn>

      {/* Confirmation modal for dangerous toggles */}
      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal(prev => ({ ...prev, open: false }))}
      />
    </div>
  );
}
