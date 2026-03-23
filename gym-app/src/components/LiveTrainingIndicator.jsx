import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import logger from '../lib/logger';

// ── Helpers ─────────────────────────────────────────────────────────────────
const getInitials = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const firstName = (name) => {
  if (!name) return '';
  return name.trim().split(/\s+/)[0];
};

// ── Pulsing avatar with green border ────────────────────────────────────────
const TrainingAvatar = ({ friend, index, onTap }) => (
  <motion.button
    type="button"
    initial={{ opacity: 0, scale: 0.7 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ delay: index * 0.06, type: 'spring', stiffness: 400, damping: 25 }}
    onClick={() => onTap(friend)}
    className="flex flex-col items-center gap-1.5 flex-shrink-0 min-w-[64px] max-w-[72px]"
  >
    {/* Avatar with pulsing green ring */}
    <div className="relative">
      <span className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping opacity-30" />
      <div className="relative w-11 h-11 rounded-full border-2 border-emerald-400 flex items-center justify-center overflow-hidden bg-amber-900/40">
        {friend.avatar_url ? (
          <img
            src={friend.avatar_url}
            alt={friend.full_name}
            className="w-full h-full object-cover rounded-full"
          />
        ) : (
          <span className="text-[13px] font-bold text-[#D4AF37]">
            {getInitials(friend.full_name)}
          </span>
        )}
      </div>
      {/* Green active dot */}
      <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0F172A]" />
    </div>

    {/* Name */}
    <p className="text-[11px] font-semibold text-[#E5E7EB] truncate w-full text-center leading-tight">
      {firstName(friend.full_name)}
    </p>

    {/* Routine / workout name */}
    {friend.routine_name && (
      <p className="text-[10px] text-[#6B7280] truncate w-full text-center -mt-0.5 leading-tight">
        {friend.routine_name}
      </p>
    )}
  </motion.button>
);

// ── LiveTrainingIndicator ───────────────────────────────────────────────────
const LiveTrainingIndicator = () => {
  const { user } = useAuth();
  const [activeTrainers, setActiveTrainers] = useState([]);
  const intervalRef = useRef(null);

  const fetchActiveTrainers = async () => {
    if (!user) return;

    // 1. Get accepted friendships
    const { data: friendships } = await supabase
      .from('friendships')
      .select('id, requester_id, addressee_id, status')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .eq('status', 'accepted');

    if (!friendships?.length) {
      setActiveTrainers([]);
      return;
    }

    // 2. Extract friend IDs
    const friendIds = friendships.map(f =>
      f.requester_id === user.id ? f.addressee_id : f.requester_id
    );

    // 3. Fetch in-progress sessions for these friends
    const { data: sessions } = await supabase
      .from('workout_sessions')
      .select('id, profile_id, routine_name, started_at, profiles!inner(full_name, avatar_url)')
      .in('profile_id', friendIds)
      .eq('status', 'in_progress')
      .order('started_at', { ascending: false });

    if (!sessions?.length) {
      setActiveTrainers([]);
      return;
    }

    // Deduplicate by profile_id (take most recent session)
    const seen = new Set();
    const trainers = [];
    for (const s of sessions) {
      if (seen.has(s.profile_id)) continue;
      seen.add(s.profile_id);
      trainers.push({
        id: s.profile_id,
        session_id: s.id,
        full_name: s.profiles?.full_name,
        avatar_url: s.profiles?.avatar_url,
        routine_name: s.routine_name ?? null,
      });
    }

    setActiveTrainers(trainers);
  };

  useEffect(() => {
    if (!user) return;

    fetchActiveTrainers();

    // Refresh every 60 seconds
    intervalRef.current = setInterval(fetchActiveTrainers, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user]);

  // Placeholder action for tapping a friend avatar
  const handleTapFriend = (friend) => {
    // Future: navigate to friend profile
    logger.log('Navigate to profile:', friend.id);
  };

  // Show nothing if no friends are training
  if (activeTrainers.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="rounded-[14px] bg-[#0F172A] border border-white/8 p-4"
      aria-live="polite"
      aria-label="Friends currently training"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="relative flex items-center justify-center">
          <span className="absolute inline-flex w-2 h-2 rounded-full bg-emerald-400 opacity-50 animate-ping" />
          <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-400" />
        </span>
        <p className="text-[13px] font-semibold text-[#E5E7EB]">
          {activeTrainers.length} friend{activeTrainers.length !== 1 ? 's' : ''} training now
        </p>
      </div>

      {/* Scrollable avatar row */}
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch' }}>
        {activeTrainers.map((friend, i) => (
          <TrainingAvatar
            key={friend.id}
            friend={friend}
            index={i}
            onTap={handleTapFriend}
          />
        ))}
      </div>
    </motion.div>
  );
};

export default LiveTrainingIndicator;
