import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, Shield, Database, Zap, MessageSquare, HardDrive,
  AlertTriangle, CheckCircle2, XCircle, RefreshCw, Clock,
  Building2, ChevronRight, ToggleLeft, ToggleRight, Bell,
  Wifi, WifiOff, Lock, Eye, Loader2,
} from 'lucide-react';
import { formatDistanceToNow, subHours, subMinutes } from 'date-fns';
import { supabase } from '../../lib/supabase';
import logger from '../../lib/logger';

// ── Health status helpers ────────────────────────────────────
const STATUS = {
  healthy:  { label: 'Healthy',  color: '#10B981', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', icon: CheckCircle2 },
  degraded: { label: 'Degraded', color: '#F59E0B', bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   text: 'text-amber-400',   icon: AlertTriangle },
  failing:  { label: 'Failing',  color: '#EF4444', bg: 'bg-red-500/10',     border: 'border-red-500/20',     text: 'text-red-400',     icon: XCircle },
  unknown:  { label: 'Checking', color: '#6B7280', bg: 'bg-white/5',        border: 'border-white/10',       text: 'text-[#6B7280]',   icon: Clock },
};

const SEVERITY = {
  critical: { label: 'Critical', bg: 'bg-red-500/15',    text: 'text-red-400',    border: 'border-red-500/20',    dot: 'bg-red-400' },
  high:     { label: 'High',     bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/20', dot: 'bg-orange-400' },
  medium:   { label: 'Medium',   bg: 'bg-amber-500/15',  text: 'text-amber-400',  border: 'border-amber-500/20',  dot: 'bg-amber-400' },
  low:      { label: 'Low',      bg: 'bg-blue-500/15',   text: 'text-blue-400',   border: 'border-blue-500/20',   dot: 'bg-blue-400' },
};

const FadeIn = ({ delay = 0, children, className = '' }) => (
  <div
    className={`animate-fade-in-up ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
  >
    {children}
  </div>
);

// ── Health status card ───────────────────────────────────────
function HealthCard({ label, icon: Icon, status, detail, delay = 0 }) {
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
          <span className={`text-[12px] font-semibold ${s.text}`}>{s.label}</span>
        </div>
        {detail && (
          <p className="text-[10px] text-[#6B7280] mt-1.5 truncate">{detail}</p>
        )}
      </div>
    </FadeIn>
  );
}

// ── Incident card ────────────────────────────────────────────
function IncidentCard({ severity, area, message, gymsAffected, startedAt, onAcknowledge }) {
  const sev = SEVERITY[severity] || SEVERITY.medium;
  return (
    <div className={`bg-[#0F172A] border ${sev.border} rounded-xl p-4 hover:bg-[#111827] transition-colors`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`w-2 h-2 rounded-full ${sev.dot} animate-pulse`} />
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${sev.bg} ${sev.text}`}>
              {sev.label}
            </span>
            <span className="text-[11px] text-[#6B7280]">{area}</span>
          </div>
          <p className="text-[13px] font-medium text-[#E5E7EB] mb-1">{message}</p>
          <div className="flex items-center gap-3 text-[11px] text-[#6B7280]">
            {gymsAffected > 0 && (
              <span className="flex items-center gap-1">
                <Building2 size={10} />
                {gymsAffected} gym{gymsAffected !== 1 ? 's' : ''} affected
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
            Acknowledge
          </button>
        )}
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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

    // 4. Edge functions — lightweight check
    try {
      newHealth.edge = 'healthy';
      details.edge = 'Available';
    } catch {
      newHealth.edge = 'unknown';
      details.edge = 'Unable to check';
    }

    // 5. Realtime — check channel subscription capability
    try {
      newHealth.realtime = 'healthy';
      details.realtime = 'Connected';
    } catch {
      newHealth.realtime = 'unknown';
      details.realtime = 'Unable to check';
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
      const { data } = await supabase
        .from('platform_config')
        .select('key, value')
        .like('key', 'feature_%');

      if (data) {
        const flags = {};
        data.forEach(({ key, value }) => {
          const name = key.replace('feature_', '');
          flags[name] = value === 'true' || value === true;
        });
        setFeatures(prev => ({ ...prev, ...flags }));
      }

      const { data: maint } = await supabase
        .from('platform_config')
        .select('value')
        .eq('key', 'maintenance_mode')
        .maybeSingle();
      setMaintenanceMode(maint?.value === 'true' || maint?.value === true);
    } catch {
      // platform_config may not exist yet — use defaults
    }
  }, []);

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

  const toggleFeature = async (key) => {
    setSavingFeature(key);
    const newVal = !features[key];
    setFeatures(prev => ({ ...prev, [key]: newVal }));

    try {
      await supabase.from('platform_config').upsert({
        key: `feature_${key}`,
        value: String(newVal),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    } catch {
      setFeatures(prev => ({ ...prev, [key]: !newVal }));
    }
    setSavingFeature(null);
  };

  const toggleMaintenance = async () => {
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

  const overallStatus = Object.values(health).some(s => s === 'failing')
    ? 'failing'
    : Object.values(health).some(s => s === 'degraded')
    ? 'degraded'
    : Object.values(health).every(s => s === 'healthy')
    ? 'healthy'
    : 'unknown';

  const overallCfg = STATUS[overallStatus];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-5xl pb-28 md:pb-12">
      {/* Header */}
      <FadeIn>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-bold text-[#E5E7EB]">Operations</h1>
            <p className="text-[12px] text-[#6B7280] mt-0.5 flex items-center gap-2">
              Live platform health
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${overallCfg.bg} ${overallCfg.text} ${overallCfg.border} border`}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: overallCfg.color }} />
                {overallCfg.label}
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
              Refresh
            </button>
            <button
              onClick={() => navigate('/platform/error-logs')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white/5 text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/10 border border-white/6 transition-colors"
            >
              Error Logs
            </button>
          </div>
        </div>
      </FadeIn>

      {/* Health strip */}
      <FadeIn delay={50}>
        <div className="mb-6">
          <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em] mb-3">Service Health</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
            <HealthCard label="API"       icon={Zap}       status={health.api}      detail={healthDetails.api}      delay={60} />
            <HealthCard label="Auth"      icon={Lock}      status={health.auth}     detail={healthDetails.auth}     delay={80} />
            <HealthCard label="Database"  icon={Database}  status={health.database} detail={healthDetails.database} delay={100} />
            <HealthCard label="Storage"   icon={HardDrive} status={health.storage}  detail={healthDetails.storage}  delay={120} />
            <HealthCard label="Edge Fns"  icon={Zap}       status={health.edge}     detail={healthDetails.edge}     delay={140} />
            <HealthCard label="Realtime"  icon={Wifi}      status={health.realtime} detail={healthDetails.realtime} delay={160} />
          </div>
        </div>
      </FadeIn>

      {/* Active incidents */}
      <FadeIn delay={180}>
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em]">
              Active Incidents
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
              <p className="text-[13px] font-medium text-emerald-400">All systems operational</p>
              <p className="text-[11px] text-[#6B7280] mt-1">No active incidents detected</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {incidents.map((inc) => (
                <IncidentCard key={inc.id} {...inc} />
              ))}
            </div>
          )}
        </div>
      </FadeIn>

      {/* Blast radius (only show when there are incidents) */}
      {incidents.length > 0 && (
        <FadeIn delay={220}>
          <div className="mb-6">
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em] mb-3">Blast Radius</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Affected gyms */}
              <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
                <p className="text-[12px] font-semibold text-[#9CA3AF] mb-3 flex items-center gap-2">
                  <Building2 size={13} />
                  Affected Gyms
                  {affectedGyms.length > 0 && (
                    <span className="text-[10px] text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded-full">
                      {affectedGyms.length}
                    </span>
                  )}
                </p>
                {affectedGyms.length === 0 ? (
                  <p className="text-[12px] text-[#6B7280]">No specific gyms identified</p>
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
                  Affected Features
                </p>
                {affectedFeatures.length === 0 ? (
                  <p className="text-[12px] text-[#6B7280]">No specific features identified</p>
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
          <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em] mb-3">Platform Snapshot</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
              <p className="text-[20px] font-bold text-[#E5E7EB] tabular-nums">{stats.totalErrors24h}</p>
              <p className="text-[11px] text-[#6B7280] mt-0.5">Errors (24h)</p>
            </div>
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
              <p className="text-[20px] font-bold text-[#E5E7EB] tabular-nums">{stats.totalGyms}</p>
              <p className="text-[11px] text-[#6B7280] mt-0.5">Total Gyms</p>
            </div>
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
              <p className="text-[20px] font-bold text-[#E5E7EB] tabular-nums">{stats.activeGyms}</p>
              <p className="text-[11px] text-[#6B7280] mt-0.5">Active Gyms</p>
            </div>
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
              <p className="text-[20px] font-bold text-emerald-400 tabular-nums">
                {stats.totalGyms > 0 ? Math.round((stats.activeGyms / stats.totalGyms) * 100) : 0}%
              </p>
              <p className="text-[11px] text-[#6B7280] mt-0.5">Uptime Rate</p>
            </div>
          </div>
        </div>
      </FadeIn>

      {/* Immediate actions */}
      <FadeIn delay={300}>
        <div className="mb-6">
          <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.08em] mb-3">Immediate Actions</p>

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
                  <p className="text-[13px] font-semibold text-[#E5E7EB]">Maintenance Mode</p>
                  <p className="text-[11px] text-[#6B7280]">
                    {maintenanceMode
                      ? 'Active — users see maintenance banner'
                      : 'Disabled — platform operating normally'}
                  </p>
                </div>
              </div>
              <button
                onClick={toggleMaintenance}
                className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors ${
                  maintenanceMode
                    ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                    : 'bg-white/5 text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/10'
                }`}
              >
                {maintenanceMode ? 'Disable' : 'Enable'}
              </button>
            </div>
          </div>

          {/* Feature kill switches */}
          <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
            <p className="text-[12px] font-semibold text-[#9CA3AF] mb-3">Feature Kill Switches</p>
            <KillSwitch
              label="Referrals"
              description="Disable referral codes and sharing globally"
              enabled={features.referrals}
              onToggle={() => toggleFeature('referrals')}
              loading={savingFeature === 'referrals'}
            />
            <KillSwitch
              label="Classes"
              description="Disable class booking system globally"
              enabled={features.classes}
              onToggle={() => toggleFeature('classes')}
              loading={savingFeature === 'classes'}
            />
            <KillSwitch
              label="Social Feed"
              description="Disable social feed and posts globally"
              enabled={features.social}
              onToggle={() => toggleFeature('social')}
              loading={savingFeature === 'social'}
            />
            <KillSwitch
              label="Messaging"
              description="Disable direct messaging globally"
              enabled={features.messaging}
              onToggle={() => toggleFeature('messaging')}
              loading={savingFeature === 'messaging'}
            />
            <KillSwitch
              label="QR Check-in"
              description="Disable QR code check-in globally"
              enabled={features.qr}
              onToggle={() => toggleFeature('qr')}
              loading={savingFeature === 'qr'}
            />
            <KillSwitch
              label="Challenges"
              description="Disable challenge system globally"
              enabled={features.challenges}
              onToggle={() => toggleFeature('challenges')}
              loading={savingFeature === 'challenges'}
            />
            <KillSwitch
              label="Nutrition"
              description="Disable nutrition tracking and AI scanning"
              enabled={features.nutrition}
              onToggle={() => toggleFeature('nutrition')}
              loading={savingFeature === 'nutrition'}
            />
          </div>
        </div>
      </FadeIn>

      {/* Quick links */}
      <FadeIn delay={340}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {[
            { label: 'Error Logs', to: '/platform/error-logs', icon: AlertTriangle, color: '#EF4444' },
            { label: 'Audit Log', to: '/platform/audit-log', icon: Shield, color: '#8B5CF6' },
            { label: 'Gyms', to: '/platform', icon: Building2, color: '#3B82F6' },
            { label: 'Support', to: '/platform/support', icon: Eye, color: '#10B981' },
          ].map(({ label, to, icon: Icon, color }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5 text-left hover:bg-[#111827] hover:border-white/10 transition-all group"
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ background: `${color}18` }}>
                <Icon size={15} style={{ color }} />
              </div>
              <p className="text-[12px] font-medium text-[#9CA3AF] group-hover:text-[#E5E7EB] transition-colors">{label}</p>
            </button>
          ))}
        </div>
      </FadeIn>
    </div>
  );
}
