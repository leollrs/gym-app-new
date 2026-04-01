import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { X, Dumbbell, Flame, Trophy, Zap, Activity, Sparkles, Sprout, Calendar, Target, Award, MessageCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';
import { ACHIEVEMENT_DEFS } from '../lib/achievements';
import UserAvatar from './UserAvatar';

// Goal display config
const GOAL_META = {
  muscle_gain:     { icon: Dumbbell },
  fat_loss:        { icon: Flame },
  strength:        { icon: Dumbbell },
  endurance:       { icon: Activity },
  general_fitness: { icon: Sparkles },
};

const LEVEL_META = {
  beginner:     { icon: Sprout },
  intermediate: { icon: Zap },
  advanced:     { icon: Trophy },
};

const ProfilePreview = ({ userId, isOpen, onClose }) => {
  const { t } = useTranslation('pages');
  const navigate = useNavigate();
  const [profileData, setProfileData] = useState(null);
  const [stats, setStats]             = useState({ workouts: 0, streak: 0, prs: 0 });
  const [latestAchievement, setLatestAchievement] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [visible, setVisible]         = useState(false);
  const backdropRef = useRef(null);

  // Animate in — use a short timeout for reliable rendering in Capacitor WebView
  useEffect(() => {
    if (isOpen) {
      setVisible(false);
      setLoading(true);
      const timer = setTimeout(() => setVisible(true), 30);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  // Fetch data when opened
  useEffect(() => {
    if (!isOpen || !userId) return;

    const fetchData = async () => {
      setLoading(true);

      const { data, error } = await supabase.rpc('get_profile_preview', { p_user_id: userId });

      if (error || !data?.profile) {
        setLoading(false);
        return;
      }

      setProfileData(data.profile);

      setStats({
        workouts: data.workouts ?? 0,
        streak:   data.streak ?? 0,
        prs:      data.prs ?? 0,
      });

      if (data.latest_achievement) {
        const def = ACHIEVEMENT_DEFS.find(a => a.key === data.latest_achievement);
        setLatestAchievement(def ?? null);
      } else {
        setLatestAchievement(null);
      }

      setLoading(false);
    };

    fetchData();
  }, [isOpen, userId]);

  // Close on backdrop click
  const handleBackdropClick = (e) => {
    if (e.target === backdropRef.current) {
      onClose();
    }
  };

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const displayName = profileData?.full_name || profileData?.username || 'Member';
  const username = profileData?.username;
  const avatarUrl = profileData?.avatar_url;
  const initial = (displayName ?? '?')[0].toUpperCase();
  const goalMeta = (profileData?.goal || profileData?.primary_goal) ? GOAL_META[profileData.goal || profileData.primary_goal] : null;
  const levelMeta = profileData?.fitness_level ? LEVEL_META[profileData.fitness_level] : null;
  const memberSince = profileData?.created_at
    ? new Date(profileData.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null;

  return createPortal(
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className={`fixed inset-0 z-[200] flex items-center justify-center px-4 transition-all duration-300 ${
        visible ? 'bg-black/60 backdrop-blur-sm' : 'bg-black/0'
      }`}
      style={{ pointerEvents: isOpen ? 'auto' : 'none' }}
    >
      <div
        className={`relative w-full max-w-[360px] rounded-2xl border border-white/[0.06] shadow-2xl shadow-black/50 overflow-hidden transition-all duration-300 ${
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
        style={{ background: 'var(--color-bg-card)' }}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="absolute top-4 right-4 z-10 w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/[0.06] transition-colors"
          style={{ color: 'var(--color-text-subtle)' }}
        >
          <X size={18} />
        </button>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-[#D4AF37]/20 border-t-[#D4AF37] rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-6 pt-5">
            {/* Avatar + Name */}
            <div className="flex items-center gap-4 mb-5">
              <UserAvatar user={profileData} size={60} />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[17px] truncate leading-snug" style={{ color: 'var(--color-text-primary)' }}>
                  {displayName}
                </p>
                {username && (
                  <p className="text-[13px] mt-0.5 truncate" style={{ color: 'var(--color-text-subtle)' }}>@{username}</p>
                )}
                {memberSince && (
                  <p className="text-[11px] mt-1 flex items-center gap-1" style={{ color: 'var(--color-text-subtle)' }}>
                    <Calendar size={11} /> {t('profile.preview.memberSince', { date: memberSince })}
                  </p>
                )}
              </div>
            </div>

            {/* Goal + Level pills */}
            {(goalMeta || levelMeta) && (
              <div className="flex flex-wrap gap-2 mb-5">
                {goalMeta && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold bg-white/[0.05] text-[#D4AF37] border border-[#D4AF37]/20">
                    <goalMeta.icon size={13} />
                    {t(`profile.preview.goals.${profileData.goal || profileData.primary_goal}`)}
                  </span>
                )}
                {levelMeta && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold bg-white/[0.04] border border-white/[0.06]" style={{ color: 'var(--color-text-muted)' }}>
                    <levelMeta.icon size={13} />
                    {t(`profile.preview.levels.${profileData.fitness_level}`)}
                  </span>
                )}
              </div>
            )}

            {/* Latest achievement */}
            {latestAchievement && (
              <div className="flex items-center gap-3 mb-5 px-3.5 py-3 rounded-xl bg-purple-500/10 border border-purple-500/20">
                <div className="w-9 h-9 rounded-lg bg-purple-500/15 flex items-center justify-center flex-shrink-0">
                  <Award size={18} className="text-purple-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-purple-300 uppercase tracking-wider">{t('profile.preview.latestAchievement')}</p>
                  <p className="text-[13px] font-bold truncate mt-0.5" style={{ color: 'var(--color-text-primary)' }}>{latestAchievement.labelKey ? t(latestAchievement.labelKey, latestAchievement.label) : latestAchievement.label}</p>
                </div>
              </div>
            )}

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="text-center py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <p className="text-[18px] font-black leading-none" style={{ color: 'var(--color-text-primary)' }}>{stats.workouts}</p>
                <p className="text-[11px] mt-1.5 font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t('profile.preview.workouts')}</p>
              </div>
              <div className="text-center py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <p className="text-[18px] font-black text-[#D4AF37] leading-none">{stats.streak}</p>
                <p className="text-[11px] mt-1.5 font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t('profile.preview.streak')}</p>
              </div>
              <div className="text-center py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <p className="text-[18px] font-black leading-none" style={{ color: 'var(--color-text-primary)' }}>{stats.prs}</p>
                <p className="text-[11px] mt-1.5 font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t('profile.preview.prs')}</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  const { data: convId } = await supabase.rpc('get_or_create_conversation', { p_other_user: userId });
                  onClose();
                  if (convId) navigate(`/messages/${convId}`);
                }}
                className="flex-1 py-3 rounded-xl text-[14px] font-semibold text-center transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
                style={{ backgroundColor: 'var(--color-accent, #D4AF37)', color: '#000' }}
              >
                <MessageCircle size={16} />
                {t('messages.message', { ns: 'pages' })}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 rounded-xl text-[14px] font-semibold text-center transition-colors border border-white/[0.06] hover:bg-white/[0.06] active:scale-[0.98]"
                style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
              >
                {t('profile.preview.close')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ProfilePreview;
