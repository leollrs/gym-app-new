import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft, Bell, CheckCheck, Trash2, X,
  Dumbbell, Trophy, AlertTriangle, Star, UserPlus,
  Calendar, MessageSquare, Activity, BookOpen, Users,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es as esLocale, enUS as enLocale } from 'date-fns/locale';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications, useInvalidate } from '../../hooks/useSupabaseQuery';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { sanitize } from '../../lib/sanitize';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { TT, TFont } from './components/designTokens';
import {
  TCard, TEyebrow, TPageTitle, TIconButton,
  TPrimaryButton, TPill, TTabPill,
} from './components/designPrimitives';

// ── Trainer-specific type metadata ──────────────────────────────────
// Maps each notification type to an icon, accent tone, and category.
// Categories drive the filter pills at the top of the page.
const TYPE_META = {
  client_workout_logged: { icon: Dumbbell,      tone: TT.accent, bg: TT.accentSoft, ink: TT.accentInk, cat: 'activity' },
  client_pr:             { icon: Trophy,        tone: TT.hot,    bg: TT.hotSoft,    ink: TT.hot,       cat: 'activity' },
  client_no_show:        { icon: AlertTriangle, tone: TT.warn,   bg: TT.warnSoft,   ink: TT.warnInk,   cat: 'alerts' },
  client_review:         { icon: Star,          tone: TT.coach,  bg: TT.coachSoft,  ink: TT.coach,     cat: 'activity' },
  client_adherence_drop: { icon: Activity,      tone: TT.warn,   bg: TT.warnSoft,   ink: TT.warnInk,   cat: 'alerts' },
  client_message:        { icon: MessageSquare, tone: TT.accent, bg: TT.accentSoft, ink: TT.accentInk, cat: 'messages' },
  new_client_assigned:   { icon: UserPlus,      tone: TT.good,   bg: TT.goodSoft,   ink: TT.goodInk,   cat: 'clients' },
  session_rescheduled:   { icon: Calendar,      tone: TT.warn,   bg: TT.warnSoft,   ink: TT.warnInk,   cat: 'schedule' },
  class_booking:         { icon: BookOpen,      tone: TT.accent, bg: TT.accentSoft, ink: TT.accentInk, cat: 'schedule' },
  trainer_message:       { icon: MessageSquare, tone: TT.accent, bg: TT.accentSoft, ink: TT.accentInk, cat: 'messages' },
  announcement:          { icon: Users,         tone: TT.coach,  bg: TT.coachSoft,  ink: TT.coach,     cat: 'alerts' },
  system:                { icon: Bell,          tone: TT.textSub,bg: TT.surface2,   ink: TT.textSub,   cat: 'alerts' },
};

const CATEGORIES = [
  { key: 'all',      labelKey: 'trainerNotifications.tabs.all',      labelDefault: 'All' },
  { key: 'activity', labelKey: 'trainerNotifications.tabs.activity', labelDefault: 'Client activity' },
  { key: 'alerts',   labelKey: 'trainerNotifications.tabs.alerts',   labelDefault: 'Alerts' },
  { key: 'schedule', labelKey: 'trainerNotifications.tabs.schedule', labelDefault: 'Schedule' },
  { key: 'messages', labelKey: 'trainerNotifications.tabs.messages', labelDefault: 'Messages' },
];

const metaFor = (type) => TYPE_META[type] || {
  icon: Bell, tone: TT.textSub, bg: TT.surface2, ink: TT.textSub, cat: 'alerts',
};

export default function TrainerNotifications() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(['pages', 'common']);
  const dateFnsLocale = i18n.language?.startsWith('es') ? esLocale : enLocale;
  const { user, refreshNotifications } = useAuth();
  const { showToast } = useToast();
  const { data: queryItems, isLoading } = useNotifications(user?.id, 'trainer');
  const { invalidateNotifications } = useInvalidate();

  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const [marking, setMarking] = useState(false);

  useEffect(() => { document.title = `${t('pages:trainerNotifications.title', 'Trainer alerts')} | TuGymPR`; }, [t]);

  useEffect(() => { if (queryItems) setItems(queryItems); }, [queryItems]);

  // Realtime: only append rows targeted at the trainer view.
  useEffect(() => {
    if (!user?.id) return;
    const ch = supabase
      .channel('trainer-notifications-page')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `profile_id=eq.${user.id}`,
      }, (payload) => {
        if (payload.new?.audience === 'trainer') {
          setItems(prev => {
            if (prev.some(p => p.id === payload.new.id)) return prev;
            return [payload.new, ...prev].slice(0, 200);
          });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  const counts = useMemo(() => {
    const c = { all: items.length, activity: 0, alerts: 0, schedule: 0, messages: 0, clients: 0 };
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

  const unreadCount = items.filter(n => !n.read_at).length;

  const markRead = async (id) => {
    const now = new Date().toISOString();
    setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: now } : n));
    const { error } = await supabase.from('notifications').update({ read_at: now }).eq('id', id);
    if (error) {
      logger.error('TrainerNotifications: markRead failed:', error);
      showToast(t('pages:notifications.markFailed', 'Couldn\'t mark as read'), 'error');
      setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: null } : n));
    }
    invalidateNotifications(user.id);
    refreshNotifications();
  };

  const markAllRead = async () => {
    if (!unreadCount) return;
    setMarking(true);
    const now = new Date().toISOString();
    const unreadIds = items.filter(n => !n.read_at).map(n => n.id);
    setItems(prev => prev.map(n => n.read_at ? n : { ...n, read_at: now }));
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: now })
      .eq('profile_id', user.id)
      .eq('audience', 'trainer')
      .is('read_at', null);
    if (error) {
      logger.error('TrainerNotifications: markAllRead failed:', error);
      showToast(t('pages:notifications.markFailed', 'Couldn\'t mark as read'), 'error');
      setItems(prev => prev.map(n => unreadIds.includes(n.id) ? { ...n, read_at: null } : n));
    }
    invalidateNotifications(user.id);
    refreshNotifications();
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
      logger.error('TrainerNotifications: dismiss failed:', error);
      showToast(t('pages:notifications.dismissFailed', 'Couldn\'t dismiss'), 'error');
      setItems(snapshot);
    }
    invalidateNotifications(user.id);
    refreshNotifications();
  }, [items, user?.id, invalidateNotifications, refreshNotifications, showToast, t]);

  const clearAll = useCallback(async () => {
    if (!items.length) return;
    const snapshot = items;
    setItems([]);
    const now = new Date().toISOString();
    let { error } = await supabase
      .from('notifications')
      .update({ dismissed_at: now, read_at: now })
      .eq('profile_id', user.id)
      .eq('audience', 'trainer')
      .is('dismissed_at', null);
    if (error && /dismissed_at/i.test(error.message || '')) {
      ({ error } = await supabase.from('notifications').delete()
        .eq('profile_id', user.id).eq('audience', 'trainer'));
    }
    if (error) {
      logger.error('TrainerNotifications: clearAll failed:', error);
      showToast(t('pages:notifications.dismissFailed', 'Couldn\'t dismiss'), 'error');
      setItems(snapshot);
    }
    invalidateNotifications(user.id);
    refreshNotifications();
  }, [items, user?.id, invalidateNotifications, refreshNotifications, showToast, t]);

  // Tap a notification → mark read + navigate to whatever the data column says.
  const handleTap = (n) => {
    if (!n.read_at) markRead(n.id);
    const route = n.data?.route;
    if (route) navigate(route);
  };

  return (
    <div style={{ background: TT.bg, minHeight: '100%', paddingBottom: 120 }}>
      {/* Header */}
      <div className="max-w-3xl mx-auto"
        style={{ padding: '12px 16px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <TIconButton ariaLabel={t('common:back', 'Back')} onClick={() => navigate(-1)} size={36}>
          <ChevronLeft size={18} color={TT.text} />
        </TIconButton>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TEyebrow>{t('pages:trainerNotifications.eyebrow', 'Coaching alerts')}</TEyebrow>
          <TPageTitle>
            {t('pages:trainerNotifications.title', 'Trainer alerts')}
          </TPageTitle>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            disabled={marking}
            style={{
              fontSize: 12, fontWeight: 700, color: TT.accentInk,
              background: TT.accentSoft, border: 'none', borderRadius: 999,
              padding: '8px 12px', display: 'inline-flex', alignItems: 'center', gap: 6,
              cursor: marking ? 'default' : 'pointer', opacity: marking ? 0.6 : 1,
              fontFamily: TFont.body,
            }}
          >
            <CheckCheck size={13} /> {t('pages:notifications.markAllRead', 'Mark all read')}
          </button>
        )}
      </div>

      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px' }}>
        {/* Stat strip */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <TCard padded={12} style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: TT.textSub, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              {t('pages:trainerNotifications.stats.unread', 'Unread')}
            </div>
            <div style={{ fontFamily: TFont.display, fontSize: 24, fontWeight: 800, color: TT.text, marginTop: 4, letterSpacing: -0.5 }}>
              {unreadCount}
            </div>
          </TCard>
          <TCard padded={12} style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: TT.textSub, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              {t('pages:trainerNotifications.stats.alerts', 'Alerts')}
            </div>
            <div style={{ fontFamily: TFont.display, fontSize: 24, fontWeight: 800, color: TT.hot, marginTop: 4, letterSpacing: -0.5 }}>
              {counts.alerts}
            </div>
          </TCard>
          <TCard padded={12} style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: TT.textSub, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              {t('pages:trainerNotifications.stats.activity', 'Activity')}
            </div>
            <div style={{ fontFamily: TFont.display, fontSize: 24, fontWeight: 800, color: TT.accent, marginTop: 4, letterSpacing: -0.5 }}>
              {counts.activity}
            </div>
          </TCard>
        </div>

        {/* Filter pills */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 14, WebkitOverflowScrolling: 'touch' }}>
          {CATEGORIES.map(c => (
            <TTabPill
              key={c.key}
              active={filter === c.key}
              onClick={() => setFilter(c.key)}
              count={counts[c.key]}
              accent={c.key === 'alerts'}
            >
              {t(`pages:${c.labelKey}`, c.labelDefault)}
            </TTabPill>
          ))}
        </div>

        {/* Clear all */}
        {items.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button
              type="button"
              onClick={clearAll}
              style={{
                fontSize: 11, fontWeight: 700, color: TT.hot,
                background: 'transparent', border: 'none',
                display: 'inline-flex', alignItems: 'center', gap: 5,
                cursor: 'pointer', padding: '4px 6px', borderRadius: 8,
              }}
            >
              <Trash2 size={12} /> {t('pages:notifications.clearAll', 'Clear all')}
            </button>
          </div>
        )}

        {/* List */}
        {isLoading && items.length === 0 ? (
          <Skeleton variant="list-item" count={4} />
        ) : filtered.length === 0 ? (
          <TCard padded={28}>
            <EmptyState
              icon={Bell}
              title={
                filter === 'all'
                  ? t('pages:trainerNotifications.empty.title', 'No alerts yet')
                  : t('pages:trainerNotifications.emptyFilter.title', 'Nothing in this category')
              }
              description={
                filter === 'all'
                  ? t('pages:trainerNotifications.empty.body', 'Client PRs, no-shows, reviews, and adherence drops will appear here.')
                  : t('pages:trainerNotifications.emptyFilter.body', 'Switch tabs to see other alerts.')
              }
            />
          </TCard>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(n => {
              const meta = metaFor(n.type);
              const Icon = meta.icon;
              const isUnread = !n.read_at;
              return (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleTap(n)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleTap(n);
                    }
                  }}
                  style={{
                    background: TT.surface,
                    borderRadius: 16,
                    border: `1px solid ${isUnread ? TT.borderStrong : TT.border}`,
                    padding: 14,
                    boxShadow: TT.shadow,
                    display: 'flex',
                    gap: 12,
                    cursor: 'pointer',
                    opacity: isUnread ? 1 : 0.78,
                    position: 'relative',
                  }}
                >
                  <div style={{
                    width: 38, height: 38, borderRadius: 10,
                    background: meta.bg, color: meta.ink,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Icon size={17} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{
                        fontSize: 13, fontWeight: 700, color: TT.text,
                        fontFamily: TFont.body, lineHeight: 1.3,
                      }}>{sanitize(n.title)}</span>
                      {isUnread && (
                        <span style={{
                          width: 7, height: 7, borderRadius: 999, background: meta.tone, flexShrink: 0,
                        }} />
                      )}
                    </div>
                    {n.body && (
                      <p style={{
                        fontSize: 12.5, color: TT.textSub, margin: 0,
                        lineHeight: 1.4,
                      }}>{sanitize(n.body)}</p>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <TPill tone={meta.cat === 'alerts' ? 'hot' : meta.cat === 'activity' ? 'teal' : 'neutral'} size="s">
                        {t(`pages:trainerNotifications.tabs.${meta.cat}`, meta.cat)}
                      </TPill>
                      <span style={{ fontSize: 10.5, color: TT.textMute }}>
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: dateFnsLocale })}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                    aria-label={t('pages:notifications.dismiss', 'Dismiss')}
                    style={{
                      width: 26, height: 26, borderRadius: 8,
                      background: 'transparent', border: 'none',
                      color: TT.textMute, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer hint */}
        {items.length > 0 && (
          <p style={{
            textAlign: 'center', fontSize: 11, color: TT.textMute,
            marginTop: 18,
          }}>
            {t('pages:trainerNotifications.footerHint', 'Alerts auto-dismiss after 14 days.')}
          </p>
        )}
      </div>
    </div>
  );
}
