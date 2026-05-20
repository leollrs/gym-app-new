import { ChevronRight, CalendarCheck, Dumbbell, UserPlus, MessageSquare } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Avatar, AdminPageShell, CardSkeleton } from '../../../components/admin';

/**
 * Five small presentational helpers used only by AdminOverview. Bundled in
 * one file because they're each ~10–40 lines and share no state with the
 * parent — just props in, JSX out.
 */

export function OverviewSkeleton() {
  return (
    <AdminPageShell className="space-y-6">
      <div className="h-8 rounded-lg w-64 animate-pulse" style={{ background: 'var(--color-admin-panel)' }} />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 md:gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="admin-card p-3 sm:p-4 md:p-5 h-[80px] md:h-[90px] animate-pulse" />
        ))}
      </div>
      <div className="grid lg:grid-cols-[1fr_340px] gap-5">
        <CardSkeleton h="h-[360px]" />
        <CardSkeleton h="h-[360px]" />
      </div>
    </AdminPageShell>
  );
}

export function AlertBanner({ icon: Icon, text, actionLabel, color, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-left
        transition-all duration-200 hover:brightness-110 hover:translate-x-0.5
        active:scale-[0.995]"
      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)' }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
          transition-transform duration-200 group-hover:scale-110"
        style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }}
      >
        <Icon size={14} style={{ color }} />
      </div>
      <p className="flex-1 text-[12.5px] leading-snug" style={{ color: 'var(--color-admin-text)' }}>{text}</p>
      <span
        className="text-[11px] font-semibold flex items-center gap-0.5 flex-shrink-0
          transition-transform duration-200 hover:translate-x-0.5"
        style={{ color }}
      >
        {actionLabel} <ChevronRight size={11} />
      </span>
    </button>
  );
}

export function ActivityItem({ item, dateFnsLocale, t, onClick }) {
  const actionMap = {
    checkin: { label: t('admin.overview.actions.checkin', 'checked in'), color: 'var(--color-coach)', icon: CalendarCheck },
    workout: { label: t('admin.overview.actions.workout', 'completed workout'), color: 'var(--color-info)', icon: Dumbbell },
    signup: { label: t('admin.overview.actions.joined', 'joined'), color: 'var(--color-success)', icon: UserPlus },
  };
  const meta = actionMap[item.type] || actionMap.checkin;
  const Icon = meta.icon;
  const displayName = item.memberName || t('admin.overview.unknownMember', 'Unknown');

  return (
    <button
      type="button"
      onClick={() => onClick?.(item)}
      className="w-full flex items-center gap-3 py-2.5 group -mx-1 px-1 rounded-lg transition-colors duration-150 hover:bg-[color:var(--color-admin-panel)] text-left"
    >
      <div className="relative flex-shrink-0">
        <Avatar name={displayName} size="sm" src={item.avatarUrl} />
        <div
          className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center border-2"
          style={{ background: `color-mix(in srgb, ${meta.color} 20%, transparent)`, borderColor: 'var(--color-bg-card)' }}
        >
          <Icon size={8} style={{ color: meta.color }} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] truncate" style={{ color: 'var(--color-admin-text)' }}>
          <span className="font-medium">{displayName}</span>
          <span className="ml-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>{meta.label}</span>
        </p>
      </div>
      <span className="admin-mono text-[10px] flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity duration-150"
        style={{ color: 'var(--color-admin-text-faint)' }}>
        {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true, ...(dateFnsLocale || {}) })}
      </span>
    </button>
  );
}

export function WatchlistRow({ member, t, onMessage, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(member)}
      className="w-full flex items-center gap-3 py-2.5 -mx-1 px-1 rounded-lg transition-colors duration-150 hover:bg-[color:var(--color-admin-panel)] text-left"
    >
      <Avatar name={member.full_name} size="sm" src={member.avatar_url} />
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--color-admin-text)' }}>{member.full_name}</p>
        <p className="text-[10.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>
          {member.neverActive
            ? t('admin.overview.neverLogged')
            : t('admin.overview.daysInactive', { count: member.daysInactive })}
        </p>
      </div>
      <span
        onClick={(e) => { e.stopPropagation(); onMessage?.(member); }}
        role="button"
        tabIndex={0}
        className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center
          active:scale-95 transition-all duration-150 cursor-pointer"
        style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}
        title={t('admin.overview.navMessages', 'Message')}
      >
        <MessageSquare size={12} style={{ color: 'var(--color-admin-text-sub)' }} />
      </span>
      <span
        className="admin-pill admin-pill--hot admin-mono flex-shrink-0"
      >
        {member.score}%
      </span>
    </button>
  );
}

export function formatDelta(current, previous, label) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return { text: `↑ ${label}`, positive: true };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: `— ${label}`, positive: null };
  return {
    text: `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% ${label}`,
    positive: pct > 0,
  };
}

export function DeltaSub({ delta, invert = false }) {
  if (!delta) return null;
  const isPositive = invert ? !delta.positive : delta.positive;
  const color = delta.positive === null
    ? 'var(--color-admin-text-muted)'
    : isPositive ? 'var(--color-success)' : 'var(--color-danger)';
  return (
    <span className="admin-mono text-[10.5px] font-medium" style={{ color }}>
      {delta.text}
    </span>
  );
}

export function QuickActionButton({ icon: Icon, label, onClick, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="admin-pill admin-pill--outline flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-px active:translate-y-0"
    >
      <Icon size={12.5} />
      {label}
    </button>
  );
}
