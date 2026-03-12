import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Activity, Dumbbell, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ── Helpers ─────────────────────────────────────────────────────────────────
const fmtNumber = (n) => {
  if (!n) return '0';
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
};

const todayRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  return { start, end };
};

const getInitials = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

// ── Mini avatar ─────────────────────────────────────────────────────────────
const MiniAvatar = ({ src, name, index }) => (
  <div
    className="relative flex-shrink-0 rounded-full border-2 border-[#0F172A] bg-amber-900/40 flex items-center justify-center overflow-hidden"
    style={{
      width: 32,
      height: 32,
      marginLeft: index === 0 ? 0 : -8,
      zIndex: 10 - index,
    }}
  >
    {src ? (
      <img src={src} alt={name} className="w-full h-full object-cover rounded-full" />
    ) : (
      <span className="text-[11px] font-bold text-[#D4AF37]">{getInitials(name)}</span>
    )}
  </div>
);

// ── Pulsing dot ─────────────────────────────────────────────────────────────
const PulsingDot = ({ color = 'bg-emerald-400', size = 'w-2 h-2' }) => (
  <span className="relative flex items-center justify-center">
    <span className={`absolute inline-flex ${size} rounded-full ${color} opacity-50 animate-ping`} />
    <span className={`relative inline-flex ${size} rounded-full ${color}`} />
  </span>
);

// ── GymPulse ────────────────────────────────────────────────────────────────
const GymPulse = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [membersToday, setMembersToday]     = useState(0);
  const [volumeToday, setVolumeToday]       = useState(0);
  const [activeNow, setActiveNow]           = useState(0);
  const [recentTrainers, setRecentTrainers] = useState([]);
  const [loading, setLoading]               = useState(true);

  useEffect(() => {
    if (!user || !profile?.gym_id) return;

    const fetchPulse = async () => {
      const gymId = profile.gym_id;
      const { start, end } = todayRange();

      // Fetch today's workout sessions for this gym via a join on profiles
      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('profile_id, status, total_volume_lbs, completed_at, profiles!inner(gym_id, full_name, avatar_url)')
        .eq('profiles.gym_id', gymId)
        .gte('started_at', start)
        .lt('started_at', end);

      if (!sessions) {
        setLoading(false);
        return;
      }

      // Unique members who trained today
      const uniqueProfileIds = new Set(sessions.map(s => s.profile_id));
      setMembersToday(uniqueProfileIds.size);

      // Total volume
      const totalVol = sessions.reduce((sum, s) => sum + (s.total_volume_lbs ?? 0), 0);
      setVolumeToday(totalVol);

      // Active now — sessions still in_progress
      const activeSessions = sessions.filter(s => s.status === 'in_progress');
      const activeProfileIds = new Set(activeSessions.map(s => s.profile_id));
      setActiveNow(activeProfileIds.size);

      // 5 most recent unique trainers (by completed_at descending, or started_at)
      const seen = new Set();
      const recent = [];
      const sorted = [...sessions]
        .sort((a, b) => new Date(b.completed_at ?? 0) - new Date(a.completed_at ?? 0));
      for (const s of sorted) {
        if (seen.has(s.profile_id)) continue;
        seen.add(s.profile_id);
        recent.push({
          id: s.profile_id,
          full_name: s.profiles?.full_name,
          avatar_url: s.profiles?.avatar_url,
        });
        if (recent.length >= 5) break;
      }
      setRecentTrainers(recent);
      setLoading(false);
    };

    fetchPulse();

    // Refresh every 2 minutes
    const interval = setInterval(fetchPulse, 120_000);
    return () => clearInterval(interval);
  }, [user, profile?.gym_id]);

  if (!profile?.gym_id) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      onClick={() => navigate('/social')}
      className="rounded-[14px] bg-[#0F172A] border border-white/8 p-5 cursor-pointer hover:border-white/12 transition-colors"
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-[10px] bg-amber-900/40 flex items-center justify-center">
          <Activity size={18} className="text-[#D4AF37]" />
        </div>
        <h3 className="text-[15px] font-bold text-[#E5E7EB] flex-1">Gym Pulse</h3>
        <PulsingDot color="bg-[#D4AF37]" size="w-2.5 h-2.5" />
      </div>

      {loading ? (
        <div className="h-20 rounded-xl bg-[#111827] animate-pulse" />
      ) : (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {/* Members today */}
            <div className="rounded-xl bg-[#111827] p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Users size={13} className="text-[#9CA3AF]" />
                <span className="text-[11px] font-medium text-[#6B7280] uppercase tracking-wide">Trained</span>
              </div>
              <p className="text-[20px] font-bold text-[#E5E7EB] leading-none">{membersToday}</p>
              <p className="text-[10px] text-[#6B7280] mt-0.5">today</p>
            </div>

            {/* Volume today */}
            <div className="rounded-xl bg-[#111827] p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Dumbbell size={13} className="text-[#9CA3AF]" />
                <span className="text-[11px] font-medium text-[#6B7280] uppercase tracking-wide">Volume</span>
              </div>
              <p className="text-[20px] font-bold text-[#E5E7EB] leading-none">{fmtNumber(volumeToday)}</p>
              <p className="text-[10px] text-[#6B7280] mt-0.5">lbs today</p>
            </div>

            {/* Active now */}
            <div className="rounded-xl bg-[#111827] p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <PulsingDot color="bg-emerald-400" size="w-1.5 h-1.5" />
                <span className="text-[11px] font-medium text-[#6B7280] uppercase tracking-wide">Active</span>
              </div>
              <motion.p
                key={activeNow}
                initial={{ scale: 1.2 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="text-[20px] font-bold text-emerald-400 leading-none"
              >
                {activeNow}
              </motion.p>
              <p className="text-[10px] text-[#6B7280] mt-0.5">right now</p>
            </div>
          </div>

          {/* Recent trainers avatar row */}
          {recentTrainers.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex items-center">
                {recentTrainers.map((t, i) => (
                  <MiniAvatar key={t.id} src={t.avatar_url} name={t.full_name} index={i} />
                ))}
              </div>
              <p className="text-[12px] text-[#9CA3AF] flex-1 min-w-0 truncate">
                {recentTrainers[0]?.full_name?.split(' ')[0]}
                {recentTrainers.length > 1 && ` and ${recentTrainers.length - 1} other${recentTrainers.length > 2 ? 's' : ''}`}
                {' '}trained today
              </p>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
};

export default GymPulse;
