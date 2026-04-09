import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, Shield, Database, Zap, MessageSquare, HardDrive,
  AlertTriangle, CheckCircle2, XCircle, RefreshCw, Clock,
  Building2, ChevronRight, ToggleLeft, ToggleRight, Bell,
  Wifi, WifiOff, Lock, Eye, Loader2,
} from 'lucide-react';
import { formatDistanceToNow, subHours, subMinutes } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import logger from '../../lib/logger';
import FadeIn from '../../components/platform/FadeIn';
import PlatformSpinner from '../../components/platform/PlatformSpinner';

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
function IncidentCard({ severity, area, message, gymsAffected, startedAt, onAcknowledge, t }) {
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
              {formatDistanceToNow(new Date(startedAt), { addSuffix: true })}
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
function KillSwitch({ label, description, enabled, onToggle, loading: busy }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/4 last:border-0">
      <div className="min-w-0 flex-1 mr-4">
        <p className="text-[13px] font-medium text-[#E5E7EB]">{label}</p>
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

// ── Main component ───────────────────────────────────────────
export default function Operations() {
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
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

  // Blast radius
  const [affectedGyms, setAffectedGyms] = useState([]);
  const [affectedFeatures, setAffectedFeatures] = useState([]);

  // Kill switches
  const [features, setFeatures] = useState({
    referrals: true,
    classes: true,
    social: true,
    messaging: true,
    qr: true,
    challenges: true,
    nutrition: true,
  });
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [savingFeature, setSavingFeature] = useState(null);

  // Confirmation modal
  const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', onConfirm: null });

  // Stats
  const [stats, setStats] = useState({
    totalErrors24h: 0,
    activeUsers1h: 0,
    totalGyms: 0,
    activeGyms: 0,
  });

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

    // 4. Edge functions — invoke a function and check if runtime is reachable
    try {
      const start = performance.now();
      const { error } = await supabase.functions.invoke('health-check', { method: 'POST' });
      const elapsed = Math.round(performance.now() - start);
      if (error) {
        // A 404 (function not found) or 401 still means the edge runtime responded
        const msg = error.message || '';
        const isRuntimeReachable = msg.includes('404') || msg.includes('not found')
          || msg.includes('401') || msg.includes('403') || msg.includes('Invalid');
        if (isRuntimeReachable) {
          newHealth.edge = elapsed > 3000 ? 'degraded' : 'healthy';
          details.edge = elapsed > 3000 ? `Slow: ${elapsed}ms` : `${elapsed}ms`;
        } else {
          newHealth.edge = 'degraded';
          details.edge = msg || 'Unexpected error';
        }
      } else {
        newHealth.edge = elapsed > 3000 ? 'degraded' : 'healthy';
        details.edge = `${elapsed}ms`;
      }
    } catch (err) {
      // Network/connection error — runtime unreachable
      newHealth.edge = 'failing';
      details.edge = err.message || 'Connection failed';
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
      const { data: recentErrors } = await supabase
        .from('error_logs')
        .select('type, gym_id, created_at, message, page')
        .gte('created_at', twoHoursAgo)
        .order('created_at', { ascending: false })
        .limit(200);

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
          message: `Auth failures up ${authErrors.length}x in last 2h`,
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

      const { data: maint } = await supabase
        .from('platform_config')
        .select('value')
        .eq('key', 'maintenance_mode')
        .maybeSingle();
      setMaintenanceMode(maint?.value === 'true' || maint?.value === true);
    } catch {
      setConfigWarning(t('platform.ops.configWarning', 'platform_config table not available — using default feature flags.'));
    }
  }, [t]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([checkHealth(), fetchIncidents(), fetchFeatureFlags()]);
    setLastRefresh(new Date());
    setRefreshing(false);
  }, [checkHealth, fetchIncidents, fetchFeatureFlags]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([checkHealth(), fetchIncidents(), fetchFeatureFlags()]);
      setLastRefresh(new Date());
      setLoading(false);
    };
    init();
  }, [checkHealth, fetchIncidents, fetchFeatureFlags]);

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(() => {
      handleRefresh();
    }, 60000);
    return () => clearInterval(interval);
  }, [handleRefresh]);

  const executeToggleFeature = async (key) => {
    setSavingFeature(key);
    const newVal = !features[key];
    setFeatures(prev => ({ ...prev, [key]: newVal }));

    try {
      await supabase.from('platform_config').upsert({
        key: `feature_${key}`,
        value: String(newVal),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
      logAdminAction('toggle_feature_flag', 'platform_config', null, { flag: key, enabled: newVal });
    } catch {
      setFeatures(prev => ({ ...prev, [key]: !newVal }));
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
        message: t('platform.ops.confirmAffectsAllGyms'),
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

  const executeToggleMaintenance = async () => {
    const newVal = !maintenanceMode;
    setMaintenanceMode(newVal);
    try {
      await supabase.from('platform_config').upsert({
        key: 'maintenance_mode',
        value: String(newVal),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    } catch {
      setMaintenanceMode(!newVal);
    }
  };

  const toggleMaintenance = () => {
    const titleKey = maintenanceMode ? 'platform.ops.confirmDisableMaintenanceTitle' : 'platform.ops.confirmEnableMaintenanceTitle';
    setConfirmModal({
      open: true,
      title: t(titleKey),
      message: t('platform.ops.confirmAffectsAll'),
      onConfirm: () => {
        setConfirmModal(prev => ({ ...prev, open: false }));
        executeToggleMaintenance();
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
              Updated {formatDistanceToNow(lastRefresh, { addSuffix: true })}
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
              {incidents.length > 0 && (
                <span className="ml-2 text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded-full text-[10px] normal-case">
                  {incidents.length}
                </span>
              )}
            </p>
          </div>

          {incidents.length === 0 ? (
            <div className="bg-[#0F172A] border border-emerald-500/20 rounded-xl p-6 text-center">
              <CheckCircle2 size={28} className="mx-auto text-emerald-400 mb-2" />
              <p className="text-[13px] font-medium text-emerald-400">{t('platform.ops.allSystemsOperational')}</p>
              <p className="text-[11px] text-[#6B7280] mt-1">{t('platform.ops.noActiveIncidents')}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {incidents.map((inc) => (
                <IncidentCard key={inc.id} {...inc} t={t} />
              ))}
            </div>
          )}
        </div>
      </FadeIn>

      {/* Blast radius (only show when there are incidents) */}
      {incidents.length > 0 && (
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

          {/* Maintenance mode banner */}
          <div className={`bg-[#0F172A] border rounded-xl p-4 mb-3 ${
            maintenanceMode ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/6'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  maintenanceMode ? 'bg-amber-500/15' : 'bg-white/5'
                }`}>
                  <AlertTriangle size={16} className={maintenanceMode ? 'text-amber-400' : 'text-[#6B7280]'} />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-[#E5E7EB]">{t('platform.ops.maintenanceMode')}</p>
                  <p className="text-[11px] text-[#6B7280]">
                    {maintenanceMode
                      ? t('platform.ops.maintenanceActive')
                      : t('platform.ops.maintenanceDisabled')}
                  </p>
                </div>
              </div>
              <button
                onClick={toggleMaintenance}
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

          {/* Feature kill switches */}
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
            <p className="text-[12px] font-semibold text-[#9CA3AF] mb-3">{t('platform.ops.featureKillSwitches')}</p>
            <KillSwitch
              label={t('platform.ops.killReferrals')}
              description={t('platform.ops.killReferralsDesc')}
              enabled={features.referrals}
              onToggle={() => toggleFeature('referrals', t('platform.ops.killReferrals'))}
              loading={savingFeature === 'referrals'}
            />
            <KillSwitch
              label={t('platform.ops.killClasses')}
              description={t('platform.ops.killClassesDesc')}
              enabled={features.classes}
              onToggle={() => toggleFeature('classes', t('platform.ops.killClasses'))}
              loading={savingFeature === 'classes'}
            />
            <KillSwitch
              label={t('platform.ops.killSocial')}
              description={t('platform.ops.killSocialDesc')}
              enabled={features.social}
              onToggle={() => toggleFeature('social', t('platform.ops.killSocial'))}
              loading={savingFeature === 'social'}
            />
            <KillSwitch
              label={t('platform.ops.killMessaging')}
              description={t('platform.ops.killMessagingDesc')}
              enabled={features.messaging}
              onToggle={() => toggleFeature('messaging', t('platform.ops.killMessaging'))}
              loading={savingFeature === 'messaging'}
            />
            <KillSwitch
              label={t('platform.ops.killQr')}
              description={t('platform.ops.killQrDesc')}
              enabled={features.qr}
              onToggle={() => toggleFeature('qr', t('platform.ops.killQr'))}
              loading={savingFeature === 'qr'}
            />
            <KillSwitch
              label={t('platform.ops.killChallenges')}
              description={t('platform.ops.killChallengesDesc')}
              enabled={features.challenges}
              onToggle={() => toggleFeature('challenges', t('platform.ops.killChallenges'))}
              loading={savingFeature === 'challenges'}
            />
            <KillSwitch
              label={t('platform.ops.killNutrition')}
              description={t('platform.ops.killNutritionDesc')}
              enabled={features.nutrition}
              onToggle={() => toggleFeature('nutrition', t('platform.ops.killNutrition'))}
              loading={savingFeature === 'nutrition'}
            />
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
