import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Trophy, Megaphone, Dumbbell, Zap, UserPlus, CheckCheck, ChevronLeft, X, Trash2, Calendar, Gift, Target, TrendingUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications, useInvalidate } from '../hooks/useSupabaseQuery';
import logger from '../lib/logger';
import { formatDistanceToNow, differenceInDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { sanitize } from '../lib/sanitize';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { useCachedState, hasCachedState } from '../hooks/useCachedState';
import { useTranslation } from 'react-i18next';
import { useToast } from '../contexts/ToastContext';

const DISPLAY_FONT = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';
const CARD_SHADOW = '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)';

const TYPE_META = {
  announcement: { icon: Megaphone, color: 'text-blue-400',    bg: 'bg-blue-500/10'   },
  pr:           { icon: Trophy,    color: 'text-[#FF5A2E]',   bg: 'bg-[#FF5A2E]/10'  },
  pr_beaten:    { icon: Trophy,    color: 'text-[#FF5A2E]',   bg: 'bg-[#FF5A2E]/10'  },
  milestone:    { icon: Dumbbell,  color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  challenge:    { icon: Zap,       color: 'text-[#6D5FDB]',   bg: 'bg-[#6D5FDB]/10'  },
  challenge_update: { icon: Zap,   color: 'text-[#6D5FDB]',   bg: 'bg-[#6D5FDB]/10'  },
  friend:       { icon: UserPlus,  color: 'text-pink-400',    bg: 'bg-pink-500/10'    },
  friend_activity:  { icon: UserPlus, color: 'text-pink-400',    bg: 'bg-pink-500/10'    },
  class_booking:    { icon: Calendar, color: 'text-blue-400',    bg: 'bg-blue-500/10'    },
  session_reminder: { icon: Calendar, color: 'text-blue-400',    bg: 'bg-blue-500/10'    },
  reward:           { icon: Gift,     color: 'text-amber-400',   bg: 'bg-amber-500/10'   },
  goal:             { icon: Target,   color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  weekly_summary:   { icon: TrendingUp, color: 'text-[var(--color-accent)]', bg: 'bg-[var(--color-accent)]/10' },
  default:      { icon: Bell,      color: 'text-[var(--color-text-muted)]', bg: 'bg-[var(--color-bg-card)]' },
};

const ANN_ACCENT = {
  event: 'var(--color-accent)',
  challenge: 'var(--color-success)',
  maintenance: 'var(--color-danger)',
  news: 'var(--color-blue)',
};

export default function Notifications() {
  const { user, profile, refreshNotifications } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');
  const dfLocale = i18n.language?.startsWith('es') ? esLocale : undefined;
  const { showToast } = useToast();
  const { data: queryItems, isLoading: queryLoading } = useNotifications(user?.id, 'member');
  const { invalidateNotifications } = useInvalidate();
  const cacheKey = `notifications-items-${user?.id || 'anon'}`;
  const [items, setItems]               = useCachedState(cacheKey, []);
  const [announcements, setAnnouncements] = useState([]);
  const [marking, setMarking]           = useState(false);
  const [displayLimit, setDisplayLimit]   = useState(5);

  useEffect(() => { document.title = `${t('notifications.title')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  // Sync TanStack Query data into local state (needed for optimistic updates)
  // Only show a skeleton on the VERY first visit — any cached data (from
  // previous visit or React Query persist cache) paints immediately.
  const loading = queryLoading && items.length === 0 && !hasCachedState(cacheKey);
  useEffect(() => {
    if (queryItems) setItems(queryItems);
  }, [queryItems]);

  // Load announcements (gym news)
  useEffect(() => {
    if (!profile?.gym_id) return;
    const loadAnnouncements = async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, message, type')
        .eq('gym_id', profile.gym_id)
        .lte('published_at', new Date().toISOString())
        .order('published_at', { ascending: false })
        .limit(10);
      if (error) { logger.error('Notifications: failed to load announcements:', error); }
      setAnnouncements(data || []);
    };
    loadAnnouncements();
  }, [profile?.gym_id]);

  useEffect(() => {
    if (!user?.id) return;

    // Realtime — new notification arrives (append delta instead of full refetch)
    const ch = supabase
      .channel('notifications-page')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `profile_id=eq.${user?.id}`,
      }, (payload) => {
        if (!payload.new) return;
        // Only append rows targeted at the member view (legacy rows had NULL audience).
        const aud = payload.new.audience;
        if (aud && aud !== 'member') return;
        // Dedup by id, keep up to 200 items so realtime inserts don't push
        // already-loaded older notifications out of the visible list.
        setItems(prev => {
          if (prev.some(p => p.id === payload.new.id)) return prev;
          return [payload.new, ...prev].slice(0, 200);
        });
      })
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [user?.id]);

  // Auto-dismiss notifications older than 14 days (soft-delete)
  useEffect(() => {
    if (!user?.id) return;
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    supabase
      .from('notifications')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('profile_id', user.id)
      .is('dismissed_at', null)
      .lt('created_at', fourteenDaysAgo.toISOString())
      .then(({ error }) => {
        if (error) logger.error('Notifications: auto-cleanup failed:', error);
        else invalidateNotifications(user.id);
      });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dismiss a single notification. Tries soft-delete (dismissed_at) first,
  // falls back to hard DELETE if the column isn't present on this DB.
  const deleteNotification = useCallback(async (id) => {
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
      logger.error('Notifications: dismiss failed:', error);
      showToast(t('common:somethingWentWrong'), 'error');
      setItems(snapshot); // revert
    }
    invalidateNotifications(user.id);
    refreshNotifications();
  }, [user?.id, items, invalidateNotifications, refreshNotifications]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear all notifications.
  const clearAllNotifications = useCallback(async () => {
    if (!items.length) return;
    const snapshot = items;
    setItems([]);

    // Mark dismissed AND read so the badge clears regardless of which filter
    // the count query uses (server-side RPCs historically only checked read_at).
    const now = new Date().toISOString();
    let { error } = await supabase
      .from('notifications')
      .update({ dismissed_at: now, read_at: now })
      .eq('profile_id', user.id)
      .is('dismissed_at', null);

    if (error && /dismissed_at/i.test(error.message || '')) {
      ({ error } = await supabase
        .from('notifications')
        .delete()
        .eq('profile_id', user.id));
    }

    if (error) {
      logger.error('Notifications: clearAll failed:', error);
      showToast(t('common:somethingWentWrong'), 'error');
      setItems(snapshot); // revert
    }
    invalidateNotifications(user.id);
    refreshNotifications();
  }, [user?.id, items, invalidateNotifications, refreshNotifications]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mark a single notification as read
  const markRead = async (id) => {
    const now = new Date().toISOString();
    // Optimistic update
    setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: now } : n));
    const { error } = await supabase.from('notifications').update({ read_at: now }).eq('id', id);
    if (error) {
      logger.error('Notifications: markRead failed:', error);
      showToast(t('common:somethingWentWrong'), 'error');
      // Revert optimistic update on failure
      setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: null } : n));
    }
    // Invalidate the query cache so TanStack Query doesn't overwrite with stale data
    invalidateNotifications(user.id);
    refreshNotifications();
  };

  // Mark all as read
  const markAllRead = async () => {
    setMarking(true);
    const unread = items.filter(n => !n.read_at).map(n => n.id);
    if (unread.length) {
      const now = new Date().toISOString();
      // Optimistic update
      setItems(prev => prev.map(n => n.read_at ? n : { ...n, read_at: now }));
      const { error } = await supabase.from('notifications').update({ read_at: now }).eq('profile_id', user.id).is('read_at', null);
      if (error) {
        logger.error('Notifications: markAllRead failed:', error);
        showToast(t('common:somethingWentWrong'), 'error');
        // Revert optimistic update on failure
        setItems(prev => prev.map(n => unread.includes(n.id) ? { ...n, read_at: null } : n));
      }
      // Invalidate the query cache so TanStack Query doesn't overwrite with stale data
      invalidateNotifications(user.id);
      refreshNotifications();
    }
    setMarking(false);
  };

  const unreadCount = items.filter(n => !n.read_at).length;

  return (
    <div className="min-h-screen pb-28 md:pb-12" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-xl" style={{ backgroundColor: 'var(--color-bg-nav)', borderBottom: '1px solid var(--color-border-default)' }}>
        <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label={t('notifications.goBack', { defaultValue: 'Go back' })}
              className="p-2 -ml-2 rounded-xl transition-colors flex-shrink-0"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <ChevronLeft size={24} strokeWidth={2} />
            </button>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(var(--color-accent), 0.1)', background: 'var(--color-accent-glow)' }}>
              <Bell size={18} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div className="min-w-0">
              <h1 className="text-[28px] truncate" style={{ color: 'var(--color-text-primary)', fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '-0.4px' }}>{t('notifications.title')}</h1>
              {unreadCount > 0 && (
                <p className="text-[12px] font-medium" style={{ color: 'var(--color-accent)' }}>
                  {t('notifications.messagesUnread', { count: unreadCount })}
                </p>
              )}
            </div>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              disabled={marking}
              className="flex items-center gap-1.5 text-[12px] font-semibold whitespace-nowrap flex-shrink-0 transition-colors disabled:opacity-50 min-h-[44px] px-4 rounded-full focus:ring-2 focus:outline-none"
              style={{ color: 'var(--color-accent, #2EC4C4)', borderColor: 'var(--color-accent, #2EC4C4)', '--tw-ring-color': 'var(--color-accent, #2EC4C4)' }}
            >
              <CheckCheck size={14} />{' '}{t('notifications.markAllRead')}
            </button>
          )}
        </div>
      </div>

      <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 py-4">
        {/* Gym News */}
        {announcements.length > 0 && (
          <section className="mb-8">
            <h2 className="text-[17px] uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-muted)', fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '-0.3px' }}>{t('notifications.gymNews')}</h2>
            <div className="flex flex-col gap-3">
              {announcements.map(ann => (
                <div
                  key={ann.id}
                  className="rounded-[18px] overflow-hidden transition-colors px-5 py-4 border-l-[3px]"
                  style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', borderLeftColor: ANN_ACCENT[ann.type] ?? 'var(--color-blue)', boxShadow: CARD_SHADOW }}
                >
                  <p className="text-[15px] font-semibold leading-snug" style={{ color: 'var(--color-text-primary)' }}>{sanitize(ann.title)}</p>
                  <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{sanitize(ann.message)}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Your notifications */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[17px] uppercase tracking-widest" style={{ color: 'var(--color-text-muted)', fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '-0.3px' }}>
              {t('notifications.yourNotifications')}
            </h2>
            {items.length > 0 && (
              <button
                onClick={clearAllNotifications}
                className="flex items-center gap-1.5 text-[11px] font-semibold transition-colors min-h-[44px] px-4 rounded-full focus:ring-2 focus:outline-none"
                style={{ color: 'var(--color-danger)', '--tw-ring-color': 'var(--color-accent, #2EC4C4)' }}
              >
                <Trash2 size={12} />{' '}{t('notifications.clearAll')}
              </button>
            )}
          </div>
        {loading ? (
          <Skeleton variant="list-item" count={4} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={t('notifications.noNotificationsYet')}
            description={t('notifications.noNotificationsHint')}
          />
        ) : (
          <>
            <div className="space-y-1.5">
              {items.slice(0, displayLimit).map(n => {
                const meta = TYPE_META[n.type] ?? TYPE_META.default;
                const Icon = meta.icon;
                return (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => !n.read_at && markRead(n.id)}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && !n.read_at) {
                        e.preventDefault();
                        markRead(n.id);
                      }
                    }}
                    aria-label={n.read_at ? t('notifications.alreadyRead') : t('notifications.markAsRead')}
                    className={`group relative w-full text-left flex items-start gap-3 p-4 rounded-[18px] overflow-hidden transition-all cursor-pointer ${
                      n.read_at ? 'opacity-60' : ''
                    }`}
                    style={{
                      backgroundColor: 'var(--color-bg-card)',
                      boxShadow: CARD_SHADOW,
                      border: n.read_at
                        ? '1px solid var(--color-border-subtle)'
                        : '1px solid var(--color-border-default)',
                    }}
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.bg}`}>
                      <Icon size={16} className={meta.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[13px] font-semibold leading-snug"
                           style={{ color: n.read_at ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}
                        >
                          {sanitize(n.title)}
                        </p>
                        {!n.read_at && (
                          <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: 'var(--color-accent)' }} />
                        )}
                      </div>
                      {n.body && (
                        <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{sanitize(n.body)}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: dfLocale })}
                        </p>
                        <span className="text-[11px]" style={{ color: 'var(--color-text-faint)' }}>
                          · {t('notifications.expiresIn', { days: Math.max(0, 14 - differenceInDays(new Date(), new Date(n.created_at))) })}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                      className="relative z-10 p-1.5 rounded-lg transition-colors flex-shrink-0"
                      style={{ color: 'var(--color-danger)' }}
                      aria-label={t('notifications.deleteNotification')}
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>

            {items.length > displayLimit && (
              <div className="flex flex-col items-center gap-2 mt-4">
                <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                  {t('notifications.showing', { shown: Math.min(displayLimit, items.length), total: items.length })}
                </p>
                <button
                  onClick={() => setDisplayLimit(prev => prev + 5)}
                  className="text-[13px] font-semibold px-5 py-2 rounded-full transition-colors"
                  style={{
                    color: 'var(--color-accent, #2EC4C4)',
                    border: '1px solid var(--color-border-default)',
                    backgroundColor: 'var(--color-bg-card)',
                    boxShadow: CARD_SHADOW,
                  }}
                >
                  {t('notifications.seeMore')}
                </button>
              </div>
            )}
            {items.length > 0 && items.length <= displayLimit && (
              <p className="text-center text-[12px] mt-4" style={{ color: 'var(--color-text-muted)' }}>
                {t('notifications.showingAll', { count: items.length })}
              </p>
            )}
          </>
        )}
        </section>
      </div>
    </div>
  );
}
