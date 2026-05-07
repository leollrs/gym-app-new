import React from 'react';
import { MessageSquare, ChevronRight } from 'lucide-react';
// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import UserAvatar from '../../../components/UserAvatar';

/**
 * Single client row inside an adherence group.
 *
 * Props:
 *   client        — { client_id, client_name, client_avatar, client_username, plan_name,
 *                     planned_count, completed_count, last_session_at, status }
 *   index         — used for staggered enter animation
 *   onMessage     — () => void — opens the chat thread for this client
 *   onOpen        — () => void — navigates to the client detail page
 *   relativeLabel — pre-formatted "2 days ago" string (locale-aware caller)
 *   t             — translation fn (pages namespace)
 *
 * Status colors come from Tailwind (theme-aware in dark+light mode).
 */
const STATUS_TONE = {
  on_track: {
    bar:    'bg-emerald-500',
    pillBg: 'bg-emerald-500/10',
    pillFg: 'text-emerald-500',
    ring:   'ring-emerald-500/20',
  },
  at_risk: {
    bar:    'bg-amber-500',
    pillBg: 'bg-amber-500/10',
    pillFg: 'text-amber-500',
    ring:   'ring-amber-500/20',
  },
  behind: {
    bar:    'bg-rose-500',
    pillBg: 'bg-rose-500/10',
    pillFg: 'text-rose-500',
    ring:   'ring-rose-500/20',
  },
  inactive: {
    bar:    'bg-zinc-500',
    pillBg: 'bg-zinc-500/10',
    pillFg: 'text-zinc-500',
    ring:   'ring-zinc-500/20',
  },
};

export default function AdherenceClientRow({
  client,
  index = 0,
  onMessage,
  onOpen,
  relativeLabel,
  t,
}) {
  const tone = STATUS_TONE[client.status] || STATUS_TONE.inactive;
  const planned = Math.max(client.planned_count || 0, 0);
  const done = Math.max(client.completed_count || 0, 0);
  const pct = planned > 0 ? Math.min(100, Math.round((done / planned) * 100)) : 0;

  const STATUS_DEFAULTS = {
    on_track: 'On track',
    at_risk: 'At risk',
    behind: 'Behind',
    inactive: 'Inactive',
  };
  const STATUS_KEY_MAP = {
    on_track: 'onTrack',
    at_risk: 'atRisk',
    behind: 'behind',
    inactive: 'inactive',
  };
  const statusLabel = t(`trainerHome.adherence.status_${STATUS_KEY_MAP[client.status] || client.status}`, STATUS_DEFAULTS[client.status] || client.status);

  // Render-friendly user object for UserAvatar
  const avatarUser = {
    avatar_url: client.client_avatar,
    full_name: client.client_name,
    username: client.client_username,
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04, ease: 'easeOut' }}
      className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--color-surface-hover,rgba(0,0,0,0.03))]"
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex items-center gap-3 min-w-0 flex-1 text-left"
        aria-label={t('trainerHome.adherence.viewClientAria', { name: client.client_name, defaultValue: 'View client' })}
      >
        <div className={`shrink-0 ring-2 ${tone.ring} rounded-full`}>
          <UserAvatar user={avatarUser} size={40} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
              {client.client_name}
            </p>
            <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${tone.pillBg} ${tone.pillFg}`}>
              {statusLabel}
            </span>
          </div>
          <p className="text-[12px] truncate" style={{ color: 'var(--color-text-muted)' }}>
            {planned > 0
              ? t('trainerHome.adherence.sessionsXofY', { done, total: planned, defaultValue: '{{done}} of {{total}} sessions' })
              : t('trainerHome.adherence.noPlanAssigned', 'No plan assigned')}
            {relativeLabel ? (
              <>
                <span className="mx-1.5 opacity-50">·</span>
                {t('trainerHome.adherence.lastSession', { when: relativeLabel, defaultValue: 'Last: {{when}}' })}
              </>
            ) : null}
          </p>
          {/* Progress bar */}
          <div className="mt-1.5 h-1 w-full rounded-full overflow-hidden" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.06))' }}>
            <div
              className={`h-full ${tone.bar} transition-all`}
              style={{ width: `${pct}%` }}
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('trainerHome.adherence.progressAria', { pct, defaultValue: 'Progress' })}
            />
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onMessage?.(); }}
        className="shrink-0 min-w-[44px] min-h-[44px] h-10 px-3 rounded-xl flex items-center gap-1.5 transition-colors"
        style={{
          background: 'var(--color-accent-soft, color-mix(in srgb, var(--color-accent) 14%, transparent))',
          color: 'var(--color-accent)',
        }}
        aria-label={t('trainerHome.adherence.messageAria', { name: client.client_name, defaultValue: 'Message client' })}
      >
        <MessageSquare size={14} />
        <span className="text-[12px] font-bold hidden sm:inline">{t('trainerHome.adherence.messageBtn', 'Message')}</span>
      </button>
      <ChevronRight size={16} style={{ color: 'var(--color-text-muted)' }} className="shrink-0 hidden sm:block" />
    </motion.div>
  );
}
