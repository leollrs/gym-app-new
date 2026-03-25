import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Trophy, Megaphone, Dumbbell, Zap, UserPlus, CheckCheck, ChevronLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications, useInvalidate } from '../hooks/useSupabaseQuery';
import logger from '../lib/logger';
import { formatDistanceToNow } from 'date-fns';
import { sanitize } from '../lib/sanitize';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

const TYPE_META = {
  announcement: { icon: Megaphone, color: 'text-blue-400',    bg: 'bg-blue-500/10'   },
  pr:           { icon: Trophy,    color: 'text-[#D4AF37]',   bg: 'bg-[#D4AF37]/10'  },
  milestone:    { icon: Dumbbell,  color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  challenge:    { icon: Zap,       color: 'text-purple-400',  bg: 'bg-purple-500/10'  },
  friend:       { icon: UserPlus,  color: 'text-pink-400',    bg: 'bg-pink-500/10'    },
  default:      { icon: Bell,      color: 'text-[#9CA3AF]',   bg: 'bg-white/6'        },
};

const ANN_ACCENT = {
  event: '#D4AF37',
  challenge: '#10B981',
  maintenance: '#EF4444',
  news: '#3B82F6',
};

export default function Notifications() {
  const { user, profile, refreshNotifications } = useAuth();
  const navigate = useNavigate();
  const { data: queryItems, isLoading: queryLoading } = useNotifications(user?.id);
  const { invalidateNotifications } = useInvalidate();
  const [items, setItems]               = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [marking, setMarking]           = useState(false);

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

  // Mark a single notification as read
  const markRead = async (id) => {
    const now = new Date().toISOString();
    setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: now } : n));
    const { error } = await supabase.from('notifications').update({ read_at: now }).eq('id', id);
    if (error) console.error('[Notif] markRead failed:', error.message, error.code);
    else console.log('[Notif] markRead success:', id);
    refreshNotifications();
  };

  // Mark all as read
  const markAllRead = async () => {
    setMarking(true);
    const unread = items.filter(n => !n.read_at).map(n => n.id);
    if (unread.length) {
      const now = new Date().toISOString();
      setItems(prev => prev.map(n => ({ ...n, read_at: now })));
      const { error } = await supabase.from('notifications').update({ read_at: now }).eq('profile_id', user.id).is('read_at', null);
      if (error) console.error('[Notif] markAllRead failed:', error.message, error.code);
      else console.log('[Notif] markAllRead success:', unread.length, 'notifications');
      refreshNotifications();
    }
    setMarking(false);
  };

  const unreadCount = items.filter(n => !n.read_at).length;

  return (
    <div className="min-h-screen bg-[#05070B] pb-28 md:pb-12">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#05070B]/95 backdrop-blur-xl border-b border-white/6">
        <div className="max-w-2xl md:max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Go back"
              className="p-2 -ml-2 rounded-xl text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/5 transition-colors"
            >
              <ChevronLeft size={24} strokeWidth={2} />
            </button>
            <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center">
              <Bell size={18} className="text-[#D4AF37]" />
            </div>
            <div>
              <h1 className="text-[18px] font-bold text-[#E5E7EB]">Notifications</h1>
              {unreadCount > 0 && (
                <p className="text-[12px] text-[#D4AF37] font-medium">
                  {unreadCount} {unreadCount === 1 ? 'message' : 'messages'} not read
                </p>
              )}
            </div>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              disabled={marking}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-[#D4AF37] hover:text-[#E6C766] transition-colors disabled:opacity-50"
            >
              <CheckCheck size={14} /> Mark all read
            </button>
          )}
        </div>
      </div>

      <div className="max-w-2xl md:max-w-3xl mx-auto px-4 py-4">
        {/* Gym News */}
        {announcements.length > 0 && (
          <section className="mb-8">
            <h2 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Gym News</h2>
            <div className="flex flex-col gap-3">
              {announcements.map(ann => (
                <div
                  key={ann.id}
                  className="bg-[#0F172A] rounded-2xl border border-white/6 hover:border-white/12 transition-colors px-5 py-4 border-l-[3px]"
                  style={{ borderLeftColor: ANN_ACCENT[ann.type] ?? '#3B82F6' }}
                >
                  <p className="text-[15px] font-semibold text-[#E5E7EB] leading-snug">{sanitize(ann.title)}</p>
                  <p className="text-[13px] text-[#6B7280] mt-1.5 leading-relaxed">{sanitize(ann.message)}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Your notifications */}
        <section>
          <h2 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">
            Your notifications
          </h2>
        {loading ? (
          <Skeleton variant="list-item" count={4} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No notifications yet"
            description="You'll see workout milestones, PRs, and gym announcements here"
          />
        ) : (
          <div className="space-y-1.5">
            {items.map(n => {
              const meta = TYPE_META[n.type] ?? TYPE_META.default;
              const Icon = meta.icon;
              return (
                <button
                  key={n.id}
                  onClick={() => !n.read_at && markRead(n.id)}
                  className={`w-full text-left flex items-start gap-3 p-4 rounded-2xl border transition-all ${
                    n.read_at
                      ? 'bg-[#0F172A] border-white/4 opacity-60'
                      : 'bg-[#0F172A] border-white/8 hover:border-white/20 hover:bg-white/[0.03]'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.bg}`}>
                    <Icon size={16} className={meta.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-[13px] font-semibold leading-snug ${n.read_at ? 'text-[#9CA3AF]' : 'text-[#E5E7EB]'}`}>
                        {sanitize(n.title)}
                      </p>
                      {!n.read_at && (
                        <span className="w-2 h-2 rounded-full bg-[#D4AF37] flex-shrink-0 mt-1" />
                      )}
                    </div>
                    {n.body && (
                      <p className="text-[12px] text-[#6B7280] mt-0.5 leading-relaxed">{sanitize(n.body)}</p>
                    )}
                    <p className="text-[11px] text-[#4B5563] mt-1">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        </section>
      </div>
    </div>
  );
}
