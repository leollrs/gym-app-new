import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import RewardPicker from './RewardPicker';

// ── ReferralRewardBanner ────────────────────────────────────────────────────
// Shows a gold celebration banner when the user has unseen referral rewards.
// Slides in from top with a spring animation and auto-dismisses after 8s.
export default function ReferralRewardBanner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation('pages');

  const [rewards, setRewards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  // Fetch unseen referral rewards on mount
  useEffect(() => {
    if (!user?.id) return;

    const fetchRewards = async () => {
      try {
        const { data, error } = await supabase
          .from('referral_rewards')
          .select('id, reward_type, reward_value, referral_id, seen, choice_status, gym_id')
          .eq('profile_id', user.id)
          .or('seen.eq.false,choice_status.eq.pending')
          .order('created_at', { ascending: false });

        if (!error && data?.length > 0) {
          setRewards(data);
          setVisible(true);
        }
      } catch { /* table may not exist yet */ }
    };

    fetchRewards();
  }, [user?.id]);

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      handleDismiss();
    }, 8000);
    return () => clearTimeout(timer);
  }, [visible, currentIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const markAsSeen = useCallback(async (rewardId) => {
    await supabase
      .from('referral_rewards')
      .update({ seen: true })
      .eq('id', rewardId);
  }, []);

  const handleDismiss = useCallback(async () => {
    const current = rewards[currentIndex];
    if (current) {
      await markAsSeen(current.id);
    }

    if (currentIndex + 1 < rewards.length) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setVisible(false);
      // Navigate to rewards page if the reward type is points
      if (current?.reward_type === 'points') {
        navigate('/rewards');
      }
    }
  }, [currentIndex, rewards, markAsSeen, navigate]);

  if (!rewards.length || !visible) return null;

  const current = rewards[currentIndex];
  if (!current) return null;

  const isPendingChoice = current.choice_status === 'pending';
  const rewardDisplay = isPendingChoice
    ? t('referralReward.pickYourReward', 'Pick your reward!')
    : current.reward_type === 'points'
      ? `${current.reward_value?.points || current.reward_value} pts`
      : (current.reward_value?.name || current.reward_value || '');

  return (
    <>
    <AnimatePresence>
      {visible && (
        <motion.div
          aria-live="polite"
          initial={{ y: -120, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -120, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 190,
            background: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-dark) 100%)',
            borderBottomLeftRadius: 20,
            borderBottomRightRadius: 20,
            boxShadow: '0 8px 32px var(--color-accent-glow), 0 2px 8px rgba(0,0,0,0.3)',
            overflow: 'hidden',
          }}
        >
          {/* Confetti-like accent dots */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            {[...Array(12)].map((_, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  width: 4 + (i % 3) * 3,
                  height: 4 + (i % 3) * 3,
                  borderRadius: '50%',
                  background: i % 2 === 0
                    ? 'rgba(255, 255, 255, 0.25)'
                    : 'rgba(255, 223, 100, 0.35)',
                  left: `${(i * 8.5) % 100}%`,
                  top: `${(i * 13 + 10) % 90}%`,
                  animation: `referral-sparkle ${1.5 + (i % 3) * 0.5}s ease-in-out infinite alternate`,
                  animationDelay: `${i * 0.15}s`,
                }}
              />
            ))}
          </div>

          {/* Content */}
          <div
            style={{
              position: 'relative',
              padding: '52px 20px 18px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {/* Party emoji */}
            <span style={{ fontSize: 32, lineHeight: 1, userSelect: 'none' }}>
              {'\u{1F389}'}
            </span>

            {/* Message */}
            <p
              style={{
                color: '#FFFFFF',
                fontSize: 15,
                fontWeight: 700,
                textAlign: 'center',
                lineHeight: 1.4,
                margin: 0,
                textShadow: '0 1px 2px rgba(0,0,0,0.15)',
              }}
            >
              {isPendingChoice
                ? t('referralReward.referralComplete', 'Your referral is complete!')
                : t('referralReward.youEarned', { reward: rewardDisplay })}
            </p>

            {/* Reward amount or pick prompt */}
            <p
              style={{
                color: '#FFFFFF',
                fontSize: isPendingChoice ? 18 : 22,
                fontWeight: 900,
                textAlign: 'center',
                lineHeight: 1.2,
                margin: '2px 0 0',
                letterSpacing: '-0.02em',
                textShadow: '0 2px 4px rgba(0,0,0,0.2)',
              }}
            >
              {rewardDisplay}
            </p>

            {/* Action button */}
            <button
              onClick={isPendingChoice ? () => setShowPicker(true) : handleDismiss}
              style={{
                marginTop: 10,
                padding: '8px 28px',
                borderRadius: 12,
                border: '2px solid rgba(255,255,255,0.5)',
                background: 'rgba(255,255,255,0.18)',
                color: '#FFFFFF',
                fontSize: 14,
                fontWeight: 800,
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                transition: 'background 200ms ease, transform 150ms ease',
                letterSpacing: '0.02em',
                minHeight: 44,
              }}
              className="focus:ring-2 focus:ring-white focus:outline-none"
              onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.95)'; }}
              onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            >
              {isPendingChoice ? t('referralReward.chooseNow', 'Choose Now') : t('referralReward.claim')}
            </button>

            {/* Multiple rewards indicator */}
            {rewards.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
                {rewards.map((_, i) => (
                  <div
                    key={i}
                    style={{
                      width: i === currentIndex ? 14 : 5,
                      height: 5,
                      borderRadius: 99,
                      background: i === currentIndex ? '#FFFFFF' : 'rgba(255,255,255,0.35)',
                      transition: 'width 300ms ease, background 300ms ease',
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <style>{`
            @keyframes referral-sparkle {
              from { opacity: 0.2; transform: scale(0.7); }
              to { opacity: 0.9; transform: scale(1.4); }
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>

      {/* Reward Picker Modal */}
      {showPicker && current && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowPicker(false)}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
            onClick={e => e.stopPropagation()}>
            <div className="p-5">
              <RewardPicker
                rewardId={current.id}
                gymId={current.gym_id}
                onChosen={() => {
                  setShowPicker(false);
                  handleDismiss();
                }}
                onSkip={() => {
                  setShowPicker(false);
                  handleDismiss();
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
