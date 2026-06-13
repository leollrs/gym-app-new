import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
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

    // Read the live presence table. RLS already limits rows to the caller's
    // accepted friends (+ self), so no separate friendships query is needed.
    // Only count rows heartbeated within the last 2h — a row left behind by an
    // app-kill goes stale instead of showing "training" forever.
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: rows } = await supabase
      .from('live_training_sessions')
      .select('profile_id, routine_name, updated_at')
      .neq('profile_id', user.id)
      .gt('updated_at', since)
      .order('updated_at', { ascending: false });

    if (!rows?.length) {
      setActiveTrainers([]);
      return;
    }

    // Resolve names/avatars via the same-gym-safe view — a direct profiles join
    // is RLS-blocked for member-to-member reads (migration 0289).
    const ids = [...new Set(rows.map((r) => r.profile_id))];
    const { data: profs } = await supabase
      .from('gym_member_profiles_safe')
      .select('id, full_name, avatar_url')
      .in('id', ids);
    const byId = new Map((profs || []).map((p) => [p.id, p]));

    const trainers = rows
      .map((r) => ({
        id: r.profile_id,
        full_name: byId.get(r.profile_id)?.full_name,
        avatar_url: byId.get(r.profile_id)?.avatar_url,
        routine_name: r.routine_name ?? null,
      }))
      .filter((tr) => tr.full_name); // drop anyone we can't resolve

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
