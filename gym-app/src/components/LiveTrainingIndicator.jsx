import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import logger from '../lib/logger';
import { selectInBatches } from '../lib/churn/batchedSelect';

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
      <div className="relative w-11 h-11 rounded-full border-2 border-emerald-400 flex items-center justify-center overflow-hidden bg-white/[0.06]">
        {friend.avatar_url ? (
          <img
            src={friend.avatar_url}
            alt={friend.full_name}
            className="w-full h-full object-cover rounded-full"
          />
        ) : (
          <span className="text-[13px] font-bold" style={{ color: 'var(--color-accent)' }}>
            {getInitials(friend.full_name)}
          </span>
        )}
      </div>
      {/* Green active dot — border matches the card bg so it reads as a cutout in both themes */}
      <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2" style={{ borderColor: 'var(--color-bg-card)' }} />
    </div>

    {/* Name */}
    <p className="text-[11px] font-semibold truncate w-full text-center leading-tight" style={{ color: 'var(--color-text-primary)' }}>
      {firstName(friend.full_name)}
    </p>

    {/* Routine / workout name */}
    {friend.routine_name && (
      <p className="text-[10px] truncate w-full text-center -mt-0.5 leading-tight" style={{ color: 'var(--color-text-muted)' }}>
        {friend.routine_name}
      </p>
    )}
  </motion.button>
);

// ── LiveTrainingIndicator ───────────────────────────────────────────────────
const LiveTrainingIndicator = ({ onFriendTap }) => {
  const { user } = useAuth();
  const { t } = useTranslation('pages');
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
    const { data: sessions } = await selectInBatches(
      (ids) => supabase
        .from('workout_sessions')
        .select('id, profile_id, routine_name, started_at, profiles!inner(full_name, avatar_url)')
        .in('profile_id', ids)
        .eq('status', 'in_progress')
        .order('started_at', { ascending: false }),
      friendIds
    );

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

  // Tapping a friend opens the parent's profile preview (SocialFeed passes
  // setPreviewUserId). Falls back to a debug log if mounted without a handler.
  const handleTapFriend = (friend) => {
    if (onFriendTap) onFriendTap(friend.id);
    else logger.log('LiveTrainingIndicator tap (no handler):', friend.id);
  };

  // Show nothing if no friends are training
  if (activeTrainers.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="rounded-[14px] p-4 mb-6"
      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}
      aria-live="polite"
      aria-label={t('liveTraining.ariaLabel', { defaultValue: 'Friends currently training' })}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="relative flex items-center justify-center">
          <span className="absolute inline-flex w-2 h-2 rounded-full bg-emerald-400 opacity-50 animate-ping" />
          <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-400" />
        </span>
        <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {t('liveTraining.friendsTraining', {
            count: activeTrainers.length,
            defaultValue: '{{count}} friend training now',
            defaultValue_plural: '{{count}} friends training now',
          })}
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
