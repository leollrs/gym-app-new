import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Bell, AlertTriangle, UserPlus, Calendar, MessageCircle,
  Star, ShieldAlert, TrendingDown, Gift, Lock, Award, Megaphone,
  Server, CheckCheck, Trash2, X, Filter, Inbox, SlidersHorizontal, ArrowLeft,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications, useInvalidate } from '../../hooks/useSupabaseQuery';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { sanitize } from '../../lib/sanitize';
import {
  AdminPageShell, PageHeader, AdminCard, StatCard,
  FadeIn, SectionLabel, AdminModal,
} from '../../components/admin';
import AdminNotificationPrefs from './AdminNotificationPrefs';
import AdminPagination from '../../components/admin/AdminPagination';
import { loadGymChurnScores } from '../../lib/churnScore';

// ── Admin-specific type metadata ────────────────────────────────────
const TYPE_META = {
  member_churn_alert:     { icon: TrendingDown,  tone: 'critical', cat: 'risk',     labelKey: 'churn_alert',   label: 'Churn alert' },
  low_attendance_alert:   { icon: AlertTriangle, tone: 'critical', cat: 'risk',     labelKey: 'attendance',    label: 'Attendance' },
  new_member_joined:      { icon: UserPlus,      tone: 'good',     cat: 'members',  labelKey: 'new_member',    label: 'New member' },
  trainer_added:          { icon: UserPlus,      tone: 'good',     cat: 'members',  labelKey: 'trainer',       label: 'Trainer' },
  class_waitlist_full:    { icon: Calendar,      tone: 'warn',     cat: 'classes',  labelKey: 'class',         label: 'Class' },
  nps_response:           { icon: Star,          tone: 'warn',     cat: 'feedback', labelKey: 'nps',           label: 'NPS' },
  moderation_flagged:     { icon: ShieldAlert,   tone: 'critical', cat: 'risk',     labelKey: 'moderation',    label: 'Moderation' },
  password_reset_request: { icon: Lock,          tone: 'warn',     cat: 'security', labelKey: 'reset_request', label: 'Reset request' },
  referral_redeemed:      { icon: Gift,          tone: 'good',     cat: 'members',  labelKey: 'referral',      label: 'Referral' },
  daily_digest:           { icon: Award,         tone: 'info',     cat: 'reports',  labelKey: 'digest',        label: 'Digest' },
  announcement:           { icon: Megaphone,     tone: 'info',     cat: 'reports',  labelKey: 'announcement',  label: 'Announcement' },
  system_alert:           { icon: Server,        tone: 'critical', cat: 'system',   labelKey: 'system',        label: 'System' },
  system:                 { icon: Server,        tone: 'info',     cat: 'system',   labelKey: 'system',        label: 'System' },
  churn_followup:         { icon: MessageCircle, tone: 'warn',     cat: 'risk',     labelKey: 'follow_up',     label: 'Follow-up' },
  admin_message:          { icon: Inbox,         tone: 'info',     cat: 'system',   labelKey: 'reminder',      label: 'Reminder' },
};

const TONE_BORDER = {
  critical: 'var(--color-danger)',
  warn:     '#E8A93A',
  good:     'var(--color-success)',
  info:     'var(--color-accent)',
};

const TONE_TEXT = {
  critical: 'var(--color-danger)',
  warn:     '#E8A93A',
  good:     'var(--color-success)',
  info:     'var(--color-accent)',
};

const TONE_BG = {
  critical: 'color-mix(in srgb, var(--color-danger) 12%, transparent)',
  warn:     'color-mix(in srgb, #E8A93A 14%, transparent)',
  good:     'color-mix(in srgb, var(--color-success) 12%, transparent)',
  info:     'color-mix(in srgb, var(--color-accent) 12%, transparent)',
};

const CATEGORIES = [
  { key: 'all',      labelKey: 'adminNotifications.tabs.all',      labelDefault: 'All' },
  { key: 'risk',     labelKey: 'adminNotifications.tabs.risk',     labelDefault: 'Risk & alerts' },
  { key: 'members',  labelKey: 'adminNotifications.tabs.members',  labelDefault: 'Members' },
  { key: 'classes',  labelKey: 'adminNotifications.tabs.classes',  labelDefault: 'Classes' },
  { key: 'feedback', labelKey: 'adminNotifications.tabs.feedback', labelDefault: 'Feedback' },
  { key: 'security', labelKey: 'adminNotifications.tabs.security', labelDefault: 'Security' },
  { key: 'reports',  labelKey: 'adminNotifications.tabs.reports',  labelDefault: 'Reports' },
  { key: 'system',   labelKey: 'adminNotifications.tabs.system',   labelDefault: 'System' },
];

const metaFor = (type) => TYPE_META[type] || {
  icon: Bell, tone: 'info', cat: 'system', labelKey: type, label: type,
};

// How many notifications to show per page in the inbox.
const PAGE_SIZE = 6;

export default function AdminNotifications() {
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const { user, profile, refreshNotifications, refreshAdminNotifications } = useAuth();
  const { showToast } = useToast();
  const { data: queryItems, isLoading } = useNotifications(user?.id, 'admin');
  const { invalidateNotifications } = useInvalidate();

  const [searchParams, setSearchParams] = useSearchParams();
  // Local tab state — deep-linkable via ?tab=preferences
  const [tab, setTab] = useState(() => (searchParams.get('tab') === 'preferences' ? 'preferences' : 'inbox'));

  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [marking, setMarking] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Changing the category resets to the first page (inline, not in an effect —
  // an effect would race and briefly slice with the old filter + stale page).
  const changeFilter = useCallback((key) => { setFilter(key); setPage(0); }, []);

  // At-risk headcount (same source as the Churn page) — turns an empty
  // inbox from a dead-end into a pointer toward today's retention work.
  const [atRiskCount, setAtRiskCount] = useState(0);

  useEffect(() => {
    const gid = profile?.gym_id;
    if (!gid) return;
    let cancelled = false;
    (async () => {
      try {
        const scored = await loadGymChurnScores(gid, supabase);
        if (!cancelled) {
          setAtRiskCount((scored || []).filter(m => (m.churnScore ?? 0) >= 55).length);
        }
      } catch (err) {
        logger.error('AdminNotifications: at-risk count failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.gym_id]);

  // Keep URL in sync when user changes tab from inside the page.
  useEffect(() => {
    const current = searchParams.get('tab');
    if (tab === 'preferences' && current !== 'preferences') {
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'preferences');
      setSearchParams(next, { replace: true });
    } else if (tab === 'inbox' && current) {
      const next = new URLSearchParams(searchParams);
      next.delete('tab');
      setSearchParams(next, { replace: true });
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const pageTitle = tab === 'preferences'
    ? t('admin.notifications.preferencesTitle', 'Notification preferences')
    : t('adminNotifications.title', 'Notifications & Alerts');

  useEffect(() => { document.title = `${pageTitle} | TuGymPR`; }, [pageTitle]);

  useEffect(() => { if (queryItems) setItems(queryItems); }, [queryItems]);

  // Realtime: append admin/super_admin-targeted rows.
  useEffect(() => {
    if (!user?.id) return;
    const ch = supabase
      .channel('admin-notifications-page')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `profile_id=eq.${user.id}`,
      }, (payload) => {
        const aud = payload.new?.audience;
        if (aud === 'admin' || aud === 'super_admin') {
          // Cap matches member-side & trainer-side notification list (200) per audit memo.
          setItems(prev => [payload.new, ...prev].slice(0, 200));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  const counts = useMemo(() => {
    const c = { all: items.length };
    CATEGORIES.forEach(cat => { if (cat.key !== 'all') c[cat.key] = 0; });
    items.forEach(n => {
      const cat = metaFor(n.type).cat;
      if (c[cat] != null) c[cat]++;
    });
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter(n => metaFor(n.type).cat === filter);
  }, [items, filter]);

  // Paginate the filtered list. safePage guards against a stale page index
  // after the list shrinks (dismiss / clear / realtime removal).
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => { if (page > pageCount - 1) setPage(pageCount - 1); }, [page, pageCount]);

  const unreadCount = items.filter(n => !n.read_at).length;
  const criticalCount = items.filter(n => !n.read_at && metaFor(n.type).tone === 'critical').length;
  const todayCount = items.filter(n => {
    const created = new Date(n.created_at);
    const today = new Date();
    return created.toDateString() === today.toDateString();
  }).length;

  const markRead = async (id) => {
    const now = new Date().toISOString();
    setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: now } : n));
    const { error } = await supabase.from('notifications').update({ read_at: now }).eq('id', id);
    if (error) {
      logger.error('AdminNotifications: markRead failed:', error);
      showToast(t('notifications.markFailed', 'Couldn\'t mark as read'), 'error');
      setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: null } : n));
    }
    invalidateNotifications(user.id);
    refreshNotifications();
    refreshAdminNotifications();
  };

  const markAllRead = async () => {
    if (!unreadCount) return;
    setMarking(true);
    const now = new Date().toISOString();
    const unreadIds = items.filter(n => !n.read_at).map(n => n.id);
    setItems(prev => prev.map(n => n.read_at ? n : { ...n, read_at: now }));
    const isSuperAdmin = profile?.role === 'super_admin' || (profile?.additional_roles || []).includes('super_admin');
    const audValues = isSuperAdmin ? ['admin', 'super_admin'] : ['admin'];
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: now })
      .eq('profile_id', user.id)
      .in('audience', audValues)
      .is('read_at', null);
    if (error) {
      logger.error('AdminNotifications: markAllRead failed:', error);
      showToast(t('notifications.markFailed', 'Couldn\'t mark as read'), 'error');
      setItems(prev => prev.map(n => unreadIds.includes(n.id) ? { ...n, read_at: null } : n));
    }
    invalidateNotifications(user.id);
    refreshNotifications();
    refreshAdminNotifications();
    setMarking(false);
  };

  const dismiss = useCallback(async (id) => {
    const snapshot = items;
    setItems(prev => prev.filter(n => n.id !== id));
    let { error } = await supabase
      .from('notifications')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', id);
    if (error && /dismissed_at/i.test(error.message || '')) {
      ({ error } = await supabase.from('notifications').delete().eq('id', id));
    }
    if (error) {
      logger.error('AdminNotifications: dismiss failed:', error);
      showToast(t('notifications.dismissFailed', 'Couldn\'t dismiss'), 'error');
      setItems(snapshot);
    }
    invalidateNotifications(user.id);
    refreshNotifications();
    refreshAdminNotifications();
  }, [items, user?.id, invalidateNotifications, refreshNotifications, refreshAdminNotifications, showToast, t]);

  const clearAll = useCallback(async () => {
    if (!items.length) return;
    const snapshot = items;
    setItems([]);
    const now = new Date().toISOString();
    const isSuperAdmin = profile?.role === 'super_admin' || (profile?.additional_roles || []).includes('super_admin');
    const audValues = isSuperAdmin ? ['admin', 'super_admin'] : ['admin'];
    let { error } = await supabase
      .from('notifications')
      .update({ dismissed_at: now, read_at: now })
      .eq('profile_id', user.id)
      .in('audience', audValues)
      .is('dismissed_at', null);
    if (error && /dismissed_at/i.test(error.message || '')) {
      ({ error } = await supabase.from('notifications').delete()
        .eq('profile_id', user.id).in('audience', audValues));
    }
    if (error) {
      logger.error('AdminNotifications: clearAll failed:', error);
      showToast(t('notifications.dismissFailed', 'Couldn\'t dismiss'), 'error');
      setItems(snapshot);
    }
    invalidateNotifications(user.id);
    refreshNotifications();
    refreshAdminNotifications();
  }, [items, user?.id, profile?.role, invalidateNotifications, refreshNotifications, refreshAdminNotifications, showToast, t]);

  const handleTap = (n) => {
    if (!n.read_at) markRead(n.id);
    const route = n.data?.route;
    if (route) navigate(route);
  };

  const subtitle = tab === 'preferences'
    ? t('admin.notifications.preferencesSubtitle', 'Choose which alerts you want to receive and how.')
    : t('adminNotifications.subtitle', 'Real-time alerts about your gym, members, classes, and system health.');

  return (
    <AdminPageShell>
      <PageHeader
        title={pageTitle}
        subtitle={subtitle}
        actions={
          tab === 'inbox' ? (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Back-to-settings appears only when the admin reached this tab
                  from the Settings hub (deep-link adds ?from=settings). On the
                  inbox tab the link is hidden — admins on the main alerts page
                  don't need a Settings escape hatch. */}
              {searchParams.get('from') === 'settings' && (
                <Link
                  to="/admin/settings"
                  className="admin-pill admin-pill--outline flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap"
                  style={{ color: 'var(--color-text-muted)', borderColor: 'var(--color-border-subtle)' }}
                >
                  <ArrowLeft size={13} />
                  {t('admin.settings.title', 'Configuración')}
                </Link>
              )}
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={marking}
                  className="admin-pill admin-pill--outline flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap disabled:opacity-50"
                  style={{ color: 'var(--color-accent)', borderColor: 'color-mix(in srgb, var(--color-accent) 25%, transparent)' }}
                >
                  <CheckCheck size={13} />
                  {t('notifications.markAllRead', 'Mark all read')}
                </button>
              )}
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(true)}
                  className="admin-pill admin-pill--outline flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap"
                  style={{ color: 'var(--color-danger)', borderColor: 'color-mix(in srgb, var(--color-danger) 25%, transparent)' }}
                >
                  <Trash2 size={13} />
                  {t('notifications.clearAll', 'Clear all')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setTab('preferences')}
                className="admin-pill admin-pill--outline flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap"
                style={{ color: 'var(--color-text-muted)', borderColor: 'var(--color-border-subtle)' }}
              >
                <SlidersHorizontal size={13} />
                {t('admin.notifications.tabs.preferences', 'Preferences')}
              </button>
            </div>
          ) : (
            // Preferences tab — always show a back link to the inbox; if we
            // arrived from Settings, prefer that as the back target so the
            // mental model "I came from Settings" is honored.
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                to={searchParams.get('from') === 'settings' ? '/admin/settings' : '/admin/notifications'}
                onClick={() => searchParams.get('from') !== 'settings' && setTab('inbox')}
                className="admin-pill admin-pill--outline flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap"
                style={{ color: 'var(--color-text-muted)', borderColor: 'var(--color-border-subtle)' }}
              >
                <ArrowLeft size={13} />
                {searchParams.get('from') === 'settings'
                  ? t('admin.settings.title', 'Configuración')
                  : t('admin.notifications.tabs.inbox', 'Bandeja')}
              </Link>
            </div>
          )
        }
      />

      {tab === 'preferences' ? (
        <FadeIn delay={0.1} className="mt-4">
          <AdminNotificationPrefs />
        </FadeIn>
      ) : (
        <>
      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-3 mt-6 mb-6">
        <StatCard
          label={t('adminNotifications.stats.today', 'Today')}
          value={todayCount}
          icon={Calendar}
          borderColor="var(--color-success)"
          delay={0}
        />
        <StatCard
          label={t('adminNotifications.stats.unread', 'Unread')}
          value={unreadCount}
          icon={Bell}
          borderColor="var(--color-accent)"
          delay={0.05}
        />
        <StatCard
          label={t('adminNotifications.stats.total', 'Total')}
          value={items.length}
          icon={Filter}
          borderColor="var(--color-text-subtle)"
          delay={0.1}
          onClick={() => changeFilter('all')}
        />
        <StatCard
          label={t('adminNotifications.stats.atRisk', 'At risk')}
          value={counts.risk}
          icon={AlertTriangle}
          borderColor="var(--color-danger)"
          delay={0.15}
          onClick={() => changeFilter('risk')}
        />
      </div>

      {/* Category tabs */}
      <FadeIn delay={0.2}>
        <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0"
          style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
          {CATEGORIES.map(c => {
            const active = filter === c.key;
            const count = counts[c.key] ?? 0;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => changeFilter(c.key)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap transition-colors flex-shrink-0"
                style={{
                  background: active ? 'var(--color-accent)' : 'var(--color-bg-card)',
                  color: active ? 'var(--color-text-on-accent)' : 'var(--color-text-muted)',
                  border: active ? 'none' : '1px solid var(--color-border-subtle)',
                }}
              >
                {t(`adminNotifications.tabs.${c.key}`, c.labelDefault)}
                {count > 0 && (
                  <span className="text-[10px] font-bold opacity-70">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </FadeIn>

      {/* List */}
      <FadeIn delay={0.25} className="mt-4">
        {isLoading && items.length === 0 ? (
          <AdminCard padding="p-8" className="text-center">
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('common:loading', 'Loading...')}
            </p>
          </AdminCard>
        ) : filtered.length === 0 ? (
          filter === 'all' && atRiskCount > 0 ? (
            <AdminCard padding="p-8" className="text-center" borderLeft={TONE_BORDER.critical}>
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl flex items-center justify-center"
                style={{ background: TONE_BG.critical, color: TONE_TEXT.critical }}>
                <TrendingDown size={22} />
              </div>
              <p className="text-[15px] font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                {t('adminNotifications.atRiskPointer.title', 'No new alerts')}
              </p>
              <p className="text-[13px] mb-4 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                {t('adminNotifications.atRiskPointer.body', { count: atRiskCount, defaultValue: '{{count}} members are at risk of churning. Review and reach out from the Churn page.' })}
              </p>
              <Link
                to="/admin/churn"
                className="admin-pill inline-flex items-center gap-1.5 whitespace-nowrap"
                style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)', borderColor: 'transparent' }}
              >
                <TrendingDown size={14} />
                {t('adminNotifications.atRiskPointer.cta', 'Review at-risk members')}
              </Link>
            </AdminCard>
          ) : (
            <AdminCard padding="p-12" className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl flex items-center justify-center"
                style={{ background: 'var(--color-bg-hover)' }}>
                <Bell size={20} style={{ color: 'var(--color-text-subtle)' }} />
              </div>
              <p className="text-[15px] font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                {filter === 'all'
                  ? t('adminNotifications.empty.title', 'You\'re all caught up')
                  : t('adminNotifications.emptyFilter.title', 'Nothing in this category')}
              </p>
              <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
                {filter === 'all'
                  ? t('adminNotifications.empty.body', 'Churn risks, NPS responses, moderation flags, and gym alerts will appear here.')
                  : t('adminNotifications.emptyFilter.body', 'Switch tabs to see other notifications.')}
              </p>
            </AdminCard>
          )
        ) : (
          <div className="space-y-2">
            <SectionLabel>{t('adminNotifications.recent', 'Recent')}</SectionLabel>
            {visible.map(n => {
              const meta = metaFor(n.type);
              const Icon = meta.icon;
              const isUnread = !n.read_at;
              return (
                <AdminCard
                  key={n.id}
                  padding="p-0"
                  borderLeft={TONE_BORDER[meta.tone]}
                  hover
                  onClick={() => handleTap(n)}
                >
                  <div className="flex items-start gap-3 p-4">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: TONE_BG[meta.tone], color: TONE_TEXT[meta.tone] }}
                    >
                      <Icon size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                              style={{ background: TONE_BG[meta.tone], color: TONE_TEXT[meta.tone] }}
                            >
                              {t(`adminNotifications.typeMeta.${meta.labelKey}`, meta.label)}
                            </span>
                            {isUnread && (
                              <span className="w-2 h-2 rounded-full" style={{ background: TONE_TEXT[meta.tone] }} />
                            )}
                            <span className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
                              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                            </span>
                          </div>
                          <p
                            className="text-[14px] font-semibold mt-1.5 leading-snug"
                            style={{ color: isUnread ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}
                          >
                            {sanitize(n.title)}
                          </p>
                          {n.body && (
                            <p
                              className="text-[12.5px] mt-1 leading-relaxed"
                              style={{ color: 'var(--color-text-muted)' }}
                            >
                              {sanitize(n.body)}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                          aria-label={t('notifications.dismiss', 'Dismiss')}
                          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
                          style={{ color: 'var(--color-text-subtle)' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; e.currentTarget.style.color = 'var(--color-danger)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-subtle)'; }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </AdminCard>
              );
            })}
            <AdminPagination
              page={safePage + 1}
              pageSize={PAGE_SIZE}
              total={filtered.length}
              onPageChange={(n) => setPage(n - 1)}
            />
            <p className="text-center text-[11px] mt-4" style={{ color: 'var(--color-text-subtle)' }}>
              {t('adminNotifications.footerHint', 'Notifications auto-dismiss after 14 days.')}
            </p>
          </div>
        )}
      </FadeIn>
        </>
      )}

      {/* Clear-all confirmation */}
      <AdminModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        title={t('adminNotifications.clearConfirmTitle', 'Clear all notifications?')}
        titleIcon={Trash2}
        size="sm"
        footer={
          <>
            <button
              onClick={() => setShowClearConfirm(false)}
              className="flex-1 py-2 rounded-lg text-[12px] font-medium transition-colors whitespace-nowrap"
              style={{ backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
            >
              {tc('cancel', 'Cancel')}
            </button>
            <button
              onClick={() => { setShowClearConfirm(false); clearAll(); }}
              className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors whitespace-nowrap"
              style={{ backgroundColor: 'var(--color-danger)', color: 'var(--color-text-on-accent, #fff)' }}
            >
              {t('notifications.clearAll', 'Clear all')}
            </button>
          </>
        }
      >
        <p className="text-[12px] text-center" style={{ color: 'var(--color-text-muted)' }}>
          {t('adminNotifications.clearConfirmMessage', 'This permanently dismisses every notification in your inbox. This can\'t be undone.')}
        </p>
      </AdminModal>
    </AdminPageShell>
  );
}
