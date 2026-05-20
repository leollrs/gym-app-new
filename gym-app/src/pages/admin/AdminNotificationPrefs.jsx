import { useState } from 'react';
import { Bell, BellOff, Users, Trophy, Shield, CalendarDays, ShoppingBag, GraduationCap, RotateCcw, ChevronDown, ChevronUp, Mail, Smartphone, Inbox, AlertTriangle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { logAdminAction } from '../../lib/adminAudit';
import { AdminCard, SectionLabel, FadeIn, CardSkeleton, AdminModal, Toggle } from '../../components/admin';

// ── Category definitions ──
const EVENT_CATEGORIES = [
  {
    key: 'members',
    icon: Users,
    events: ['new_member', 'member_churned', 'churn_score_spike'],
  },
  {
    key: 'engagement',
    icon: Trophy,
    events: ['challenge_completed', 'milestone_reached', 'low_attendance'],
  },
  {
    key: 'security',
    icon: Shield,
    events: ['password_reset_request', 'content_report'],
  },
  {
    key: 'classes',
    icon: CalendarDays,
    events: ['class_full'],
  },
  {
    key: 'store',
    icon: ShoppingBag,
    events: ['store_redemption', 'new_referral'],
  },
  {
    key: 'trainers',
    icon: GraduationCap,
    events: ['trainer_note'],
  },
];

const CHANNELS = [
  { key: 'in_app', icon: Inbox },
  { key: 'push', icon: Smartphone },
  { key: 'email', icon: Mail },
];

// ── Single event row ──
function EventRow({ pref, onToggle, onChannelsChange, t }) {
  const eventKey = pref.event_type;
  const name = t(`admin.notificationPrefs.events.${eventKey}`);
  const desc = t(`admin.notificationPrefs.events.${eventKey}_desc`);
  const [expanded, setExpanded] = useState(false);

  // channel is TEXT[] after migration, but could be a string for unmigrated rows
  const rawCh = pref.channel;
  const channels = Array.isArray(rawCh) ? rawCh : (typeof rawCh === 'string' && rawCh ? [rawCh] : ['in_app']);

  const toggleChannel = (ch) => {
    const next = channels.includes(ch)
      ? channels.filter(c => c !== ch)
      : [...channels, ch];
    if (next.length === 0) return;
    onChannelsChange(pref.id, next);
  };

  return (
    <div className="py-3 border-b border-white/6 last:border-b-0">
      {/* Row 1: name + toggle */}
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex-1 min-w-0 text-left md:pointer-events-none"
        >
          <p className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{name}</p>
        </button>
        <Toggle checked={pref.enabled} onChange={(val) => onToggle(pref.id, val)} label={name} />
      </div>
      {/* Row 2: channel pills */}
      <div className="flex items-center gap-1.5">
        {CHANNELS.map(ch => {
          const Icon = ch.icon;
          const isOn = channels.includes(ch.key);
          return (
            <button
              key={ch.key}
              onClick={(e) => { e.stopPropagation(); toggleChannel(ch.key); }}
              disabled={!pref.enabled}
              className={`flex-1 min-w-0 flex items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 sm:px-2 rounded-lg text-[10.5px] sm:text-[11px] font-semibold transition-all whitespace-nowrap ${
                !pref.enabled ? 'opacity-30 pointer-events-none' : 'active:scale-95'
              }`}
              style={isOn
                ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 20%, transparent)', color: 'var(--color-accent)', border: '2px solid color-mix(in srgb, var(--color-accent) 50%, transparent)' }
                : { backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-subtle)', border: '2px solid var(--color-border-subtle)' }
              }
              aria-label={t(`admin.notificationPrefs.channels.${ch.key}`)}
              aria-pressed={isOn}
            >
              <Icon size={13} />
              {t(`admin.notificationPrefs.channels.${ch.key}`)}
            </button>
          );
        })}
      </div>

      {/* Description — always visible on desktop, expandable on mobile */}
      <p
        className={`text-[11px] leading-snug mt-1 ${expanded ? '' : 'hidden md:block'}`}
        style={{ color: 'var(--color-text-muted)' }}
      >
        {desc}
      </p>
    </div>
  );
}

// ── Main component ──
export default function AdminNotificationPrefs() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const gymId = profile?.gym_id;

  const [expandedCategories, setExpandedCategories] = useState(
    () => new Set(EVENT_CATEGORIES.map(c => c.key))
  );
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const toggleCategory = (key) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── Fetch prefs via RPC (auto-seeds defaults) ──
  const { data: prefs, isLoading } = useQuery({
    queryKey: adminKeys.notificationPrefs(gymId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_admin_notification_prefs');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!gymId,
  });

  // ── Optimistic toggle mutation ──
  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }) => {
      const { error } = await supabase
        .from('admin_notification_prefs')
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onMutate: async ({ id, enabled }) => {
      const qk = adminKeys.notificationPrefs(gymId);
      await queryClient.cancelQueries({ queryKey: qk });
      const previous = queryClient.getQueryData(qk);
      queryClient.setQueryData(qk, (old) =>
        old?.map(p => p.id === id ? { ...p, enabled } : p)
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(adminKeys.notificationPrefs(gymId), context?.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.notificationPrefs(gymId) });
    },
  });

  // ── Channels change mutation (multi-select, TEXT[] column) ──
  const channelMutation = useMutation({
    mutationFn: async ({ id, channels }) => {
      const { error } = await supabase
        .from('admin_notification_prefs')
        .update({ channel: channels, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onMutate: async ({ id, channels }) => {
      const qk = adminKeys.notificationPrefs(gymId);
      await queryClient.cancelQueries({ queryKey: qk });
      const previous = queryClient.getQueryData(qk);
      queryClient.setQueryData(qk, (old) =>
        old?.map(p => p.id === id ? { ...p, channel: channels } : p)
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(adminKeys.notificationPrefs(gymId), context?.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.notificationPrefs(gymId) });
    },
  });

  // ── Reset to defaults ──
  const resetMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('admin_notification_prefs')
        .delete()
        .eq('profile_id', profile.id);
      if (error) throw error;
      // Re-fetch will trigger seed via RPC
    },
    onSuccess: () => {
      logAdminAction('reset_notification_prefs', 'admin_notification_prefs', null, { profile_id: profile.id });
      queryClient.invalidateQueries({ queryKey: adminKeys.notificationPrefs(gymId) });
    },
  });

  const handleToggle = (id, enabled) => {
    toggleMutation.mutate({ id, enabled });
  };

  const handleChannelsChange = (id, channels) => {
    channelMutation.mutate({ id, channels });
  };

  // Build lookup map
  const prefMap = {};
  prefs?.forEach(p => { prefMap[p.event_type] = p; });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Reset button — title now lives in the parent page header (AdminNotifications) */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => setShowResetConfirm(true)}
          disabled={resetMutation.isPending}
          className="admin-pill admin-pill--outline flex-shrink-0 flex items-center gap-1.5 disabled:opacity-40"
        >
          <RotateCcw size={12} className={resetMutation.isPending ? 'animate-spin' : ''} />
          {t('admin.notificationPrefs.resetDefaults')}
        </button>
      </div>

      {EVENT_CATEGORIES.map((cat, idx) => {
        const Icon = cat.icon;
        const isExpanded = expandedCategories.has(cat.key);
        const catPrefs = cat.events.map(e => prefMap[e]).filter(Boolean);
        const enabledCount = catPrefs.filter(p => p.enabled).length;

        return (
          <FadeIn key={cat.key} delay={idx * 40}>
            <AdminCard padding="p-0">
              {/* Category header */}
              <button
                onClick={() => toggleCategory(cat.key)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
                >
                  <Icon size={14} style={{ color: 'var(--color-accent)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {t(`admin.notificationPrefs.categories.${cat.key}`)}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    <span className="admin-mono">{enabledCount}/{catPrefs.length}</span>
                    {' '}
                    {t('admin.notificationPrefs.activeSuffix', { defaultValue: 'active' })}
                  </p>
                </div>
                {isExpanded
                  ? <ChevronUp size={16} style={{ color: 'var(--color-text-muted)' }} />
                  : <ChevronDown size={16} style={{ color: 'var(--color-text-muted)' }} />
                }
              </button>

              {/* Event rows */}
              {isExpanded && catPrefs.length > 0 && (
                <div className="px-4 pb-3">
                  {catPrefs.map(pref => (
                    <EventRow
                      key={pref.id}
                      pref={pref}
                      onToggle={handleToggle}
                      onChannelsChange={handleChannelsChange}
                      t={t}
                    />
                  ))}
                </div>
              )}
            </AdminCard>
          </FadeIn>
        );
      })}

      {/* Reset confirmation modal */}
      <AdminModal
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        title={t('admin.notificationPrefs.confirmResetTitle', { defaultValue: 'Reset Preferences' })}
        titleIcon={AlertTriangle}
        size="sm"
        footer={
          <>
            <button
              onClick={() => setShowResetConfirm(false)}
              className="flex-1 py-2 rounded-lg text-[12px] font-medium transition-colors whitespace-nowrap"
              style={{
                backgroundColor: 'var(--color-bg-deep)',
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              {tc('cancel')}
            </button>
            <button
              onClick={() => { setShowResetConfirm(false); resetMutation.mutate(); }}
              disabled={resetMutation.isPending}
              className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors whitespace-nowrap disabled:opacity-40"
              style={{
                backgroundColor: 'var(--color-danger)',
                color: 'var(--color-text-on-accent, #fff)',
              }}
            >
              {t('admin.notificationPrefs.resetDefaults')}
            </button>
          </>
        }
      >
        <p className="text-[12px] text-center" style={{ color: 'var(--color-text-muted)' }}>
          {t('admin.notificationPrefs.confirmResetMessage', { defaultValue: 'This will delete all your custom notification preferences and restore the default settings. This action cannot be undone.' })}
        </p>
      </AdminModal>
    </div>
  );
}
