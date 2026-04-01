import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Trophy, Megaphone, Dumbbell, Zap, UserPlus, CheckCheck, ChevronLeft, X, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications, useInvalidate } from '../hooks/useSupabaseQuery';
import logger from '../lib/logger';
import { formatDistanceToNow, differenceInDays } from 'date-fns';
import { sanitize } from '../lib/sanitize';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { useTranslation } from 'react-i18next';

const TYPE_META = {
  announcement: { icon: Megaphone, color: 'text-blue-400',    bg: 'bg-blue-500/10'   },
  pr:           { icon: Trophy,    color: 'text-[#D4AF37]',   bg: 'bg-[#D4AF37]/10'  },
  milestone:    { icon: Dumbbell,  color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  challenge:    { icon: Zap,       color: 'text-purple-400',  bg: 'bg-purple-500/10'  },
  friend:       { icon: UserPlus,  color: 'text-pink-400',    bg: 'bg-pink-500/10'    },
  default:      { icon: Bell,      color: 'text-[var(--color-text-muted)]', bg: 'bg-white/6' },
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
  const { t } = useTranslation('pages');
  const { data: queryItems, isLoading: queryLoading } = useNotifications(user?.id);
  const { invalidateNotifications } = useInvalidate();
  const [items, setItems]               = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [marking, setMarking]           = useState(false);
  const [displayLimit, setDisplayLimit]   = useState(5);

  // Sync TanStack Query data into local state (needed for optimistic updates)
  const loading = queryLoading && items.length === 0;
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
        if (payload.new) {
          setItems(prev => [payload.new, ...prev].slice(0, 50));
        }
      })
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [user?.id]);

  // Auto-clear notifications older than 14 days
  useEffect(() => {
    if (!user?.id) return;
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    supabase
      .from('notifications')
      .delete()
      .eq('profile_id', user.id)
      .lt('created_at', fourteenDaysAgo.toISOString())
      .then(({ error }) => {
        if (error) logger.error('Notifications: auto-cleanup failed:', error);
        else invalidateNotifications(user.id);
      });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Delete a single notification (with confirmation)
  const deleteNotification = useCallback(async (id) => {
    const confirmed = window.confirm(t('notifications.deleteConfirm'));
    if (!confirmed) return;
    setItems(prev => prev.filter(n => n.id !== id));
    const { error } = await supabase.from('notifications').delete().eq('id', id);
    if (error) {
      console.error('[Notif] delete failed:', error.message, error.code);
      invalidateNotifications(user.id);
    } else {
      invalidateNotifications(user.id);
      refreshNotifications();
    }
  }, [user?.id, invalidateNotifications, refreshNotifications]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear all notifications
  const clearAllNotifications = useCallback(async () => {
    if (!items.length) return;
    const confirmed = window.confirm(t('notifications.deleteAllConfirm', { count: items.length }));
    if (!confirmed) return;
    setItems([]);
    const { error } = await supabase.from('notifications').delete().eq('profile_id', user.id);
    if (error) {
      console.error('[Notif] clearAll failed:', error.message, error.code);
    }
    invalidateNotifications(user.id);
    refreshNotifications();
  }, [user?.id, items.length, invalidateNotifications, refreshNotifications]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mark a single notification as read
  const markRead = async (id) => {
    const now = new Date().toISOString();
    // Optimistic update
    setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: now } : n));
    const { error } = await supabase.from('notifications').update({ read_at: now }).eq('id', id);
    if (error) {
      console.error('[Notif] markRead failed:', error.message, error.code);
      // Revert optimistic update on failure
      setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: null } : n));
    } else {
      console.log('[Notif] markRead success:', id);
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
        console.error('[Notif] markAllRead failed:', error.message, error.code);
        // Revert optimistic update on failure
        setItems(prev => prev.map(n => unread.includes(n.id) ? { ...n, read_at: null } : n));
      } else {
        console.log('[Notif] markAllRead success:', unread.length, 'notifications');
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
        <div className="max-w-[480px] md:max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Go back"
              className="p-2 -ml-2 rounded-xl transition-colors flex-shrink-0"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <ChevronLeft size={24} strokeWidth={2} />
            </button>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(var(--color-accent), 0.1)', background: 'var(--color-accent-glow)' }}>
              <Bell size={18} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div className="min-w-0">
              <h1 className="text-[18px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{t('notifications.title')}</h1>
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
              className="flex items-center gap-1.5 text-[12px] font-semibold whitespace-nowrap flex-shrink-0 transition-colors disabled:opacity-50 min-h-[44px] px-2 rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ color: 'var(--color-accent)' }}
            >
              <CheckCheck size={14} />{' '}{t('notifications.markAllRead')}
            </button>
          )}
        </div>
      </div>

      <div className="max-w-[480px] md:max-w-4xl mx-auto px-4 py-4">
        {/* Gym News */}
        {announcements.length > 0 && (
          <section className="mb-8">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-muted)' }}>{t('notifications.gymNews')}</h2>
            <div className="flex flex-col gap-3">
              {announcements.map(ann => (
                <div
                  key={ann.id}
                  className="rounded-2xl overflow-hidden transition-colors px-5 py-4 border-l-[3px]"
                  style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', borderLeftColor: ANN_ACCENT[ann.type] ?? 'var(--color-blue)' }}
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
            <h2 className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
              {t('notifications.yourNotifications')}
            </h2>
            {items.length > 0 && (
              <button
                onClick={clearAllNotifications}
                className="flex items-center gap-1.5 text-[11px] font-semibold transition-colors min-h-[44px] px-2 rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                style={{ color: 'var(--color-danger)' }}
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
                    className={`group relative w-full text-left flex items-start gap-3 p-4 rounded-2xl border overflow-hidden transition-all ${
                      n.read_at
                        ? 'border-[var(--color-border-subtle)] opacity-60'
                        : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-hover)]'
                    }`}
                    style={{ backgroundColor: 'var(--color-bg-card)' }}
                  >
                    <button
                      onClick={() => !n.read_at && markRead(n.id)}
                      className="absolute inset-0 rounded-2xl"
                      aria-label={n.read_at ? t('notifications.alreadyRead') : t('notifications.markAsRead')}
                    />
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
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
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
                  className="text-[13px] font-semibold px-5 py-2 rounded-xl transition-colors"
                  style={{
                    color: 'var(--color-accent)',
                    border: '1px solid var(--color-border-default)',
                    backgroundColor: 'var(--color-bg-card)',
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
