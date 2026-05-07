import { motion } from 'framer-motion';
import { ChevronRight, MessageSquare, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

/**
 * Trainer-side client list row. Avatar + name + churn badge + last seen + actions.
 * Mirrors AdminMembers row pattern with the warmer trainer palette.
 *
 * Props:
 *   client       — { id, full_name, username, last_active_at, recentWorkouts, ... }
 *   churnScore   — optional churn row { score }
 *   onClick      — opens client preview
 *   onMessage    — message handler (event-stop already bubbled by us)
 *   selected     — visual selected state (bulk select)
 *   delay        — Framer Motion stagger delay (seconds)
 *   locale       — date-fns locale
 *   t            — i18n translator
 */
export default function TrainerClientCard({
  client,
  churnScore,
  onClick,
  onMessage,
  selected = false,
  delay = 0,
  locale,
  t,
}) {
  const daysInactive = client.last_active_at
    ? Math.floor((Date.now() - new Date(client.last_active_at)) / 86400000)
    : null;
  const isActive = daysInactive !== null && daysInactive <= 7;
  const score = churnScore?.score;
  const hasChurn = score != null && score >= 30;

  const churnTone = score >= 80
    ? { color: '#EF4444', tint: 'rgba(239,68,68,0.12)', label: t?.('trainerClients.churnCritical', 'Critical') ?? 'Critical' }
    : score >= 55
      ? { color: '#F97316', tint: 'rgba(249,115,22,0.12)', label: t?.('trainerClients.churnHigh', 'High') ?? 'High' }
      : { color: '#F59E0B', tint: 'rgba(245,158,11,0.12)', label: t?.('trainerClients.churnMedium', 'Medium') ?? 'Medium' };

  const dotColor = isActive
    ? '#10B981'
    : hasChurn
      ? churnTone.color
      : 'var(--color-text-faint)';

  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
      whileTap={{ scale: 0.99 }}
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
      style={{
        background: 'var(--color-bg-card)',
        border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
      }}
    >
      {/* Avatar with online dot */}
      <div className="relative flex-shrink-0">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{ background: 'var(--color-bg-elevated)' }}
        >
          <span className="text-[14px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>
            {(client.full_name || client.username || '?')[0]?.toUpperCase()}
          </span>
        </div>
        <span
          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
          style={{ background: dotColor, border: '2px solid var(--color-bg-card)' }}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p
            className="text-[14px] font-semibold truncate"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {client.full_name || client.username || '—'}
          </p>
          {hasChurn && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider flex-shrink-0"
              style={{ background: churnTone.tint, color: churnTone.color }}
            >
              <AlertTriangle size={9} strokeWidth={2.6} />
              {Math.round(score)}
            </span>
          )}
        </div>
        <p className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>
          {client.last_active_at
            ? formatDistanceToNow(new Date(client.last_active_at), { addSuffix: true, locale })
            : (t?.('trainerClients.neverActive', 'Never active') ?? 'Never active')}
          {client.recentWorkouts != null && (
            <>
              <span className="mx-1.5" style={{ color: 'var(--color-text-faint)' }}>·</span>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {client.recentWorkouts}w
              </span>
            </>
          )}
        </p>
      </div>

      {onMessage && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onMessage(client); }}
          aria-label={t?.('trainerClients.message', 'Message') ?? 'Message'}
          className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--color-bg-hover)]"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <MessageSquare size={15} />
        </button>
      )}
      <ChevronRight
        size={16}
        className="flex-shrink-0"
        style={{ color: 'var(--color-text-faint)' }}
      />
    </motion.button>
  );
}
