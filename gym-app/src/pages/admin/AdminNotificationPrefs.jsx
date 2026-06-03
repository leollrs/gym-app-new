import { useState } from 'react';
import { Users, Shield, CalendarDays, TrendingDown, Star, FileText, RotateCcw, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { logAdminAction } from '../../lib/adminAudit';
import { AdminCard, FadeIn, CardSkeleton, AdminModal, Toggle } from '../../components/admin';

// ── Category definitions ──
// event keys === the real notification_type strings, so the backend
// (admin_pref_allows, migration 0505) gates each alert directly. Only
// events that have a live producer are listed here.
const EVENT_CATEGORIES = [
  {
    key: 'members',
    icon: Users,
    events: ['new_member_joined', 'referral_redeemed', 'trainer_added'],
  },
  {
    key: 'retention',
    icon: TrendingDown,
    events: ['member_churn_alert', 'low_attendance_alert', 'admin_message'],
  },
  {
    key: 'security',
    icon: Shield,
    events: ['password_reset_request', 'moderation_flagged'],
  },
  {
    key: 'feedback',
    icon: Star,
    events: ['nps_response'],
  },
  {
    key: 'classes',
    icon: CalendarDays,
    events: ['class_waitlist_full'],
  },
  {
    key: 'reports',
    icon: FileText,
    events: ['daily_digest'],
  },
];

// ── Single event row ──
function EventRow({ pref, onToggle, t }) {
  const eventKey = pref.event_type;
  const name = t(`admin.notificationPrefs.events.${eventKey}`, eventKey);
  const desc = t(`admin.notificationPrefs.events.${eventKey}_desc`, '');
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="py-3 border-b border-white/6 last:border-b-0">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex-1 min-w-0 text-left md:pointer-events-none"
        >
          <p className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{name}</p>
        </button>
        <Toggle checked={pref.enabled} onChange={(val) => onToggle(pref.id, val)} label={name} />
      </div>
      {desc && (
        <p
          className={`text-[11px] leading-snug mt-1 ${expanded ? '' : 'hidden md:block'}`}
          style={{ color: 'var(--color-text-muted)' }}
        >
          {desc}
        </p>
      )}
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
      {/* Intro + reset — title lives in the parent page header (AdminNotifications) */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] leading-snug" style={{ color: 'var(--color-text-muted)' }}>
          {t('admin.notificationPrefs.intro', { defaultValue: 'Turn off any alert you don’t want in your inbox. New alerts default to on.' })}
        </p>
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
        if (catPrefs.length === 0) return null;
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
                    {t(`admin.notificationPrefs.categories.${cat.key}`, cat.key)}
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
              {isExpanded && (
                <div className="px-4 pb-3">
                  {catPrefs.map(pref => (
                    <EventRow
                      key={pref.id}
                      pref={pref}
                      onToggle={handleToggle}
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
