import React, { useEffect, useMemo, useState } from 'react';
import { Activity, ShieldAlert, AlertTriangle, MoonStar, RefreshCw } from 'lucide-react';
import { startOfWeek, endOfWeek, format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { enUS } from 'date-fns/locale/en-US';
// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import AnimatedCounter from '../../../components/AnimatedCounter';
import EmptyState from '../../../components/EmptyState';
import { supabase } from '../../../lib/supabase';
import logger from '../../../lib/logger';
import AdherenceClientRow from './AdherenceClientRow';

const STATUS_ORDER = ['behind', 'at_risk', 'on_track', 'inactive'];

const STATUS_META = {
  on_track: {
    icon: Activity,
    pillBg: 'bg-emerald-500/10',
    pillFg: 'text-emerald-500',
    border: 'border-emerald-500/30',
    leftBar: '#10B981',
  },
  at_risk: {
    icon: ShieldAlert,
    pillBg: 'bg-amber-500/10',
    pillFg: 'text-amber-500',
    border: 'border-amber-500/30',
    leftBar: '#F59E0B',
  },
  behind: {
    icon: AlertTriangle,
    pillBg: 'bg-rose-500/10',
    pillFg: 'text-rose-500',
    border: 'border-rose-500/30',
    leftBar: '#F43F5E',
  },
  inactive: {
    icon: MoonStar,
    pillBg: 'bg-zinc-500/10',
    pillFg: 'text-zinc-500',
    border: 'border-zinc-500/30',
    leftBar: '#71717A',
  },
};

/**
 * Plan Adherence hero panel.
 *
 * Fetches `get_trainer_adherence(p_trainer_id, p_week_start)` and renders:
 *   – 4 stat cards (counts per status)
 *   – Grouped client list (Behind → At-risk → On track → Inactive)
 *
 * The "Message" quick action navigates to /trainer/messages/{conversationId}.
 */
export default function AdherencePanel({ trainerId, t, locale }) {
  const navigate = useNavigate();
  const dateLocale = locale === 'es' ? es : enUS;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openingThread, setOpeningThread] = useState(null);

  const weekStart = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 1 }), []);
  const weekEnd   = useMemo(() => endOfWeek(new Date(),   { weekStartsOn: 1 }), []);
  const weekStartIso = useMemo(() => format(weekStart, 'yyyy-MM-dd'), [weekStart]);

  const fetchAdherence = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_trainer_adherence', {
        p_trainer_id: trainerId,
        p_week_start: weekStartIso,
      });
      if (rpcError) throw rpcError;
      setRows(data || []);
    } catch (err) {
      logger.error('AdherencePanel: failed to fetch adherence', err);
      setError(err?.message || 'Failed to load adherence');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [trainerId, weekStartIso]);

  useEffect(() => {
    if (!trainerId) return;
    fetchAdherence();
  }, [trainerId, fetchAdherence]);

  const counts = useMemo(() => {
    const c = { on_track: 0, at_risk: 0, behind: 0, inactive: 0 };
    rows.forEach(r => { if (c[r.status] !== undefined) c[r.status] += 1; });
    return c;
  }, [rows]);

  const grouped = useMemo(() => {
    const out = { on_track: [], at_risk: [], behind: [], inactive: [] };
    rows.forEach(r => { if (out[r.status]) out[r.status].push(r); });
    return out;
  }, [rows]);

  const handleMessage = async (clientId) => {
    if (openingThread) return;
    setOpeningThread(clientId);
    try {
      const { data: convId, error: rpcError } = await supabase.rpc('get_or_create_conversation', { p_other_user: clientId });
      if (rpcError) throw rpcError;
      if (convId) navigate(`/trainer/messages/${convId}`);
    } catch (err) {
      logger.error('AdherencePanel: failed to open conversation', err);
    } finally {
      setOpeningThread(null);
    }
  };

  const handleOpenClient = (clientId) => {
    navigate(`/trainer/clients/${clientId}`);
  };

  // Stat-card config
  const statCards = [
    { key: 'on_track', label: t('trainerHome.adherence.stat_onTrack', 'On track') },
    { key: 'at_risk',  label: t('trainerHome.adherence.stat_atRisk', 'At risk') },
    { key: 'behind',   label: t('trainerHome.adherence.stat_behind', 'Behind') },
    { key: 'inactive', label: t('trainerHome.adherence.stat_total', 'Total clients') },
  ];

  const subtitle = `${format(weekStart, 'MMM d', { locale: dateLocale })} — ${format(weekEnd, 'MMM d', { locale: dateLocale })}`;

  return (
    <section aria-labelledby="adherence-heading">
      {/* Section header */}
      <div className="flex items-end justify-between mb-3 gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] mb-0.5" style={{ color: 'var(--color-accent)' }}>
            {t('trainerHome.adherence.eyebrow', 'Adherence')}
          </p>
          <h2 id="adherence-heading" className="text-[20px] md:text-[22px] font-black tracking-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: 'var(--color-text-primary)' }}>
            {t('trainerHome.adherence.title', 'How your clients are doing')}
          </h2>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={fetchAdherence}
          disabled={loading}
          className="shrink-0 min-h-[36px] h-9 px-3 rounded-xl flex items-center gap-1.5 transition-colors text-[12px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
          aria-label={t('trainerHome.adherence.refresh', 'Refresh')}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">{t('trainerHome.adherence.refresh', 'Refresh')}</span>
        </button>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 mb-4">
        {statCards.map((c, idx) => {
          const meta = STATUS_META[c.key];
          const Icon = meta.icon;
          return (
            <motion.div
              key={c.key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: idx * 0.04, ease: 'easeOut' }}
              className="rounded-2xl p-4 border-l-2"
              style={{
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border-subtle)',
                borderLeftColor: meta.leftBar,
                borderLeftWidth: 2,
              }}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-[22px] sm:text-[26px] font-black leading-none tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                    <AnimatedCounter value={counts[c.key]} duration={600} />
                  </p>
                  <p className="text-[12px] font-medium mt-1.5 truncate" style={{ color: 'var(--color-text-muted)' }}>{c.label}</p>
                </div>
                <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center shrink-0 ${meta.pillBg}`}>
                  <Icon size={16} className={meta.pillFg} />
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="h-16 rounded-2xl animate-pulse"
              style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))', border: '1px solid var(--color-border-subtle)' }}
            />
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-2xl p-4 flex items-start gap-3 bg-rose-500/10 border border-rose-500/20">
          <AlertTriangle size={16} className="text-rose-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-rose-500">{t('trainerHome.adherence.errorTitle', "Couldn't load adherence")}</p>
            <p className="text-[12px] text-rose-500/80 mt-0.5 truncate">{error}</p>
          </div>
          <button
            type="button"
            onClick={fetchAdherence}
            className="shrink-0 text-[12px] font-bold text-rose-500 hover:text-rose-400 px-2 py-1 rounded-lg hover:bg-rose-500/10"
          >
            {t('trainerHome.adherence.retry', 'Retry')}
          </button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && rows.length === 0 && (
        <EmptyState
          icon={Activity}
          title={t('trainerHome.adherence.emptyTitle', 'No clients yet')}
          description={t('trainerHome.adherence.emptyDesc', "Once you have clients, you'll see their adherence here")}
          compact
        />
      )}

      {/* Grouped client list */}
      {!loading && !error && rows.length > 0 && (
        <div className="space-y-3">
          {STATUS_ORDER.map(statusKey => {
            const list = grouped[statusKey];
            if (!list || list.length === 0) return null;
            const meta = STATUS_META[statusKey];
            return (
              <div
                key={statusKey}
                className="rounded-2xl overflow-hidden"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}
              >
                <div
                  className="flex items-center justify-between px-4 py-2.5"
                  style={{ borderBottom: '1px solid var(--color-border-subtle)', background: 'var(--color-surface-hover, transparent)' }}
                >
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${meta.pillBg} ${meta.pillFg}`}>
                      {t(`trainerHome.adherence.group_${{ on_track: 'onTrack', at_risk: 'atRisk', behind: 'behind', inactive: 'inactive' }[statusKey] || statusKey}`, { defaultValue: { on_track: 'On track', at_risk: 'At risk', behind: 'Behind', inactive: 'Inactive' }[statusKey] || statusKey })}
                    </span>
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                      {t('trainerHome.adherence.clientCount', { count: list.length, defaultValue: '{{count}} clients' })}
                    </span>
                  </div>
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
                  {list.map((c, i) => {
                    const relativeLabel = c.last_session_at
                      ? formatDistanceToNow(new Date(c.last_session_at), { addSuffix: true, locale: dateLocale })
                      : null;
                    return (
                      <AdherenceClientRow
                        key={c.client_id}
                        client={c}
                        index={i}
                        onMessage={() => handleMessage(c.client_id)}
                        onOpen={() => handleOpenClient(c.client_id)}
                        relativeLabel={relativeLabel}
                        t={t}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
