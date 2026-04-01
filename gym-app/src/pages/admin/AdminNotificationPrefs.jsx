import { useState } from 'react';
import { Bell, BellOff, Users, Trophy, Shield, CalendarDays, ShoppingBag, GraduationCap, RotateCcw, ChevronDown, ChevronUp, Mail, Smartphone, Inbox, AlertTriangle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { AdminCard, SectionLabel, FadeIn, CardSkeleton, AdminModal } from '../../components/admin';

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

// ── Toggle switch (matches AdminSettings pattern) ──
function Toggle({ checked, onChange, label }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-9 h-5 rounded-full relative flex-shrink-0 transition-colors"
      style={{ backgroundColor: checked ? 'var(--color-accent)' : 'var(--color-text-faint)' }}
      aria-label={label}
    >
      <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
        style={{ left: checked ? 'calc(100% - 18px)' : '2px' }} />
    </button>
  );
}

// ── Single event row ──
function EventRow({ pref, onToggle, onChannelChange, t }) {
  const eventKey = pref.event_type;
  return (
    <div className="flex items-center gap-3 py-3 border-b border-white/6 last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-[#E5E7EB] truncate">
          {t(`admin.notificationPrefs.events.${eventKey}.name`)}
        </p>
        <p className="text-[11px] text-[#6B7280] leading-snug mt-0.5">
          {t(`admin.notificationPrefs.events.${eventKey}.desc`)}
        </p>
      </div>

      {/* Channel selector */}
      <select
        value={pref.channel}
        onChange={(e) => onChannelChange(pref.id, e.target.value)}
        disabled={!pref.enabled}
        className="bg-[#111827] border border-white/6 rounded-lg px-2 py-1 text-[11px] text-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 disabled:opacity-40 appearance-none min-w-[72px]"
      >
        {CHANNELS.map(ch => (
          <option key={ch.key} value={ch.key}>
            {t(`admin.notificationPrefs.channels.${ch.key}`)}
          </option>
        ))}
      </select>

      <Toggle
        checked={pref.enabled}
        onChange={(val) => onToggle(pref.id, val)}
        label={t(`admin.notificationPrefs.events.${eventKey}.name`)}
      />
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

  // ── Channel change mutation ──
  const channelMutation = useMutation({
    mutationFn: async ({ id, channel }) => {
      const { error } = await supabase
        .from('admin_notification_prefs')
        .update({ channel, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onMutate: async ({ id, channel }) => {
      const qk = adminKeys.notificationPrefs(gymId);
      await queryClient.cancelQueries({ queryKey: qk });
      const previous = queryClient.getQueryData(qk);
      queryClient.setQueryData(qk, (old) =>
        old?.map(p => p.id === id ? { ...p, channel } : p)
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
      queryClient.invalidateQueries({ queryKey: adminKeys.notificationPrefs(gymId) });
    },
  });

  const handleToggle = (id, enabled) => {
    toggleMutation.mutate({ id, enabled });
  };

  const handleChannelChange = (id, channel) => {
    channelMutation.mutate({ id, channel });
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
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-[#D4AF37]" />
          <SectionLabel>{t('admin.notificationPrefs.sectionTitle')}</SectionLabel>
        </div>
        <button
          onClick={() => setShowResetConfirm(true)}
          disabled={resetMutation.isPending}
          className="flex items-center gap-1.5 text-[11px] text-[#6B7280] hover:text-[#D4AF37] transition-colors disabled:opacity-40"
        >
          <RotateCcw size={12} className={resetMutation.isPending ? 'animate-spin' : ''} />
          {t('admin.notificationPrefs.resetDefaults')}
        </button>
      </div>

      <p className="text-[12px] text-[#6B7280] -mt-2">
        {t('admin.notificationPrefs.description')}
      </p>

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
                <div className="w-7 h-7 rounded-lg bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                  <Icon size={14} className="text-[#D4AF37]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[#E5E7EB]">
                    {t(`admin.notificationPrefs.categories.${cat.key}`)}
                  </p>
                  <p className="text-[11px] text-[#6B7280]">
                    {enabledCount}/{catPrefs.length} {t('admin.notificationPrefs.active')}
                  </p>
                </div>
                {isExpanded
                  ? <ChevronUp size={16} className="text-[#6B7280]" />
                  : <ChevronDown size={16} className="text-[#6B7280]" />
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
                      onChannelChange={handleChannelChange}
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
              className="flex-1 py-2 rounded-lg text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors whitespace-nowrap"
            >
              {tc('cancel')}
            </button>
            <button
              onClick={() => { setShowResetConfirm(false); resetMutation.mutate(); }}
              disabled={resetMutation.isPending}
              className="flex-1 py-2 rounded-lg text-[12px] font-semibold bg-[#EF4444] text-white hover:bg-[#DC2626] transition-colors whitespace-nowrap disabled:opacity-40"
            >
              {t('admin.notificationPrefs.resetDefaults')}
            </button>
          </>
        }
      >
        <p className="text-[12px] text-[#9CA3AF] text-center">
          {t('admin.notificationPrefs.confirmResetMessage', { defaultValue: 'This will delete all your custom notification preferences and restore the default settings. This action cannot be undone.' })}
        </p>
      </AdminModal>
    </div>
  );
}
