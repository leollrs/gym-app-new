import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Trophy, Megaphone, Dumbbell, Zap, UserPlus, CheckCheck, ChevronLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';

const TYPE_META = {
  announcement: { icon: Megaphone, color: 'text-blue-400',     bg: 'bg-blue-500/10'    },
  pr:           { icon: Trophy,    color: 'text-[#D4AF37]',    bg: 'bg-[#D4AF37]/10'  },
  milestone:    { icon: Dumbbell,  color: 'text-emerald-400',  bg: 'bg-emerald-500/10' },
  challenge:    { icon: Zap,       color: 'text-purple-400',   bg: 'bg-purple-500/10'  },
  friend:       { icon: UserPlus,  color: 'text-pink-400',     bg: 'bg-pink-500/10'    },
  default:      { icon: Bell,      color: 'text-[#9CA3AF]',    bg: 'bg-white/6'        },
};

const ANN_ACCENT = {
  event: '#D4AF37',
  challenge: '#10B981',
  maintenance: '#EF4444',
  news: '#3B82F6',
};

export default function Notifications() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [items, setItems]       = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [marking, setMarking]   = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('profile_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setItems(data || []);
    setLoading(false);
  }, [user?.id]);

  // Load announcements (gym news)
  useEffect(() => {
    if (!profile?.gym_id) return;
    const loadAnnouncements = async () => {
      const { data } = await supabase
        .from('announcements')
        .select('id, title, message, type')
        .eq('gym_id', profile.gym_id)
        .lte('published_at', new Date().toISOString())
        .order('published_at', { ascending: false })
        .limit(10);
      setAnnouncements(data || []);
    };
    loadAnnouncements();
  }, [profile?.gym_id]);

  useEffect(() => {
    load();

    // Realtime — new notification arrives
    const ch = supabase
      .channel('notifications-page')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `profile_id=eq.${user?.id}`,
      }, () => load())
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [load, user?.id]);

  // Mark a single notification as read
  const markRead = async (id) => {
    const now = new Date().toISOString();
    setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: now } : n));
    await supabase.from('notifications').update({ read_at: now }).eq('id', id);
  };

  // Mark all as read
  const markAllRead = async () => {
    setMarking(true);
    const unread = items.filter(n => !n.read_at).map(n => n.id);
    if (unread.length) {
      const now = new Date().toISOString();
      setItems(prev => prev.map(n => ({ ...n, read_at: now })));
      await supabase.from('notifications').update({ read_at: now }).eq('profile_id', user.id).is('read_at', null);
    }
    setMarking(false);
  };

  const unreadCount = items.filter(n => !n.read_at).length;

  return (
    <div className="min-h-screen bg-[#05070B] pb-24 md:pb-8">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#05070B]/95 dark:bg-[#0F172A]/95 backdrop-blur-xl border-b border-white/6 dark:border-white/10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Go back"
              className="p-2 -ml-2 rounded-xl text-[#9CA3AF] dark:text-slate-400 hover:text-[#E5E7EB] dark:hover:text-slate-200 hover:bg-white/5 dark:hover:bg-white/10 transition-colors"
            >
              <ChevronLeft size={24} strokeWidth={2} />
            </button>
            <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center">
              <Bell size={18} className="text-[#D4AF37]" />
            </div>
            <div>
              <h1 className="text-[18px] font-bold text-[#E5E7EB] dark:text-slate-100">Notifications</h1>
              {unreadCount > 0 && (
                <p className="text-[12px] text-[#D4AF37] dark:text-amber-400 font-medium">
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

      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Gym News */}
        {announcements.length > 0 && (
          <section className="mb-8">
            <h2 className="text-[11px] font-semibold text-[#6B7280] dark:text-slate-400 uppercase tracking-widest mb-3">Gym News</h2>
            <div className="flex flex-col gap-3">
              {announcements.map(ann => (
                <div
                  key={ann.id}
                  className="bg-[#0F172A] dark:bg-slate-800 rounded-[14px] border border-white/6 dark:border-white/10 hover:border-white/12 dark:hover:border-white/20 transition-colors px-5 py-4 border-l-[3px]"
                  style={{ borderLeftColor: ANN_ACCENT[ann.type] ?? '#3B82F6' }}
                >
                  <p className="text-[15px] font-semibold text-[#E5E7EB] dark:text-slate-100 leading-snug">{ann.title}</p>
                  <p className="text-[13px] text-[#6B7280] dark:text-slate-400 mt-1.5 leading-relaxed">{ann.message}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Your notifications */}
        <section>
          <h2 className="text-[11px] font-semibold text-[#6B7280] dark:text-slate-400 uppercase tracking-widest mb-3">
            Your notifications
          </h2>
        {loading ? (
          <div className="flex justify-center py-24">
            <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-24">
            <Bell size={32} className="text-[#4B5563] dark:text-slate-500 mx-auto mb-3" />
            <p className="text-[14px] text-[#6B7280] dark:text-slate-400">No notifications yet</p>
            <p className="text-[12px] text-[#4B5563] dark:text-slate-500 mt-1">You'll see workout milestones, PRs, and gym announcements here</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {items.map(n => {
              const meta = TYPE_META[n.type] ?? TYPE_META.default;
              const Icon = meta.icon;
              return (
                <button
                  key={n.id}
                  onClick={() => !n.read_at && markRead(n.id)}
                  className={`w-full text-left flex items-start gap-3 p-4 rounded-[14px] border transition-all ${
                    n.read_at
                      ? 'bg-[#0F172A] border-white/4 opacity-60'
                      : 'bg-[#0F172A] border-white/8 hover:border-white/14'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.bg}`}>
                    <Icon size={16} className={meta.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-[13px] font-semibold leading-snug ${n.read_at ? 'text-[#9CA3AF]' : 'text-[#E5E7EB]'}`}>
                        {n.title}
                      </p>
                      {!n.read_at && (
                        <span className="w-2 h-2 rounded-full bg-[#D4AF37] flex-shrink-0 mt-1" />
                      )}
                    </div>
                    {n.body && (
                      <p className="text-[12px] text-[#6B7280] mt-0.5 leading-relaxed">{n.body}</p>
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
