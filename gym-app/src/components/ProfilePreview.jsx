import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { X, Dumbbell, Flame, Trophy, Zap, Activity, Sparkles, Sprout, Calendar, Target, Award, MessageCircle, MoreHorizontal, Ban, Flag } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useTranslation } from 'react-i18next';
import { ACHIEVEMENT_DEFS } from '../lib/achievements';
import UserAvatar from './UserAvatar';
import ReportContentModal from './ReportContentModal';
import posthogClient from 'posthog-js';

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
  const { user } = useAuth();
  const { showToast } = useToast();
  const [profileData, setProfileData] = useState(null);
  const [stats, setStats]             = useState({ workouts: 0, streak: 0, prs: 0 });
  const [statsAvailable, setStatsAvailable] = useState(false);
  const [latestAchievement, setLatestAchievement] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [visible, setVisible]         = useState(false);
  const [showMenu, setShowMenu]       = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reportOpen, setReportOpen]   = useState(false);
  const [blocking, setBlocking]       = useState(false);
  const backdropRef = useRef(null);
  const menuRef = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  const handleBlock = async () => {
    if (!userId || !user?.id || blocking) return;
    setBlocking(true);
    const { error: blockError } = await supabase.from('blocked_users').upsert(
      { blocker_id: user.id, blocked_id: userId },
      { onConflict: 'blocker_id,blocked_id' }
    );
    if (blockError) {
      // Block didn't persist — keep the confirm modal open so the user can retry
      showToast(t('common:somethingWentWrong'), 'error');
      setBlocking(false);
      return;
    }
    const { error: friendshipError } = await supabase.from('friendships').delete()
      .or(`and(requester_id.eq.${user.id},addressee_id.eq.${userId}),and(requester_id.eq.${userId},addressee_id.eq.${user.id})`);
    if (friendshipError) {
      // Block is in place but the friendship removal failed — retry is idempotent
      showToast(t('common:somethingWentWrong'), 'error');
      setBlocking(false);
      return;
    }
    posthogClient?.capture('user_blocked', { source: 'profile_preview' });
    showToast(t('social.userBlocked', { name: profileData?.full_name?.split(' ')[0] ?? '' }), 'success');
    setBlocking(false);
    setConfirmBlock(false);
    onClose();
  };

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

    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);
      setStatsAvailable(false);

      const { data, error } = await supabase.rpc('get_profile_preview', { p_user_id: userId });

      if (cancelled) return;
      if (error || !data?.profile) {
        // RPC blocked (e.g. a private profile we're not yet allowed to fully
        // view, pre-0562) or failed. Fall back to the same-gym safe view so the
        // friend's name + avatar still render instead of an empty "Member" card.
        // Stats stay hidden (—) until get_profile_preview can return them.
        const { data: safe } = await supabase
          .from('gym_member_profiles_safe')
          .select('id, full_name, username, avatar_url, avatar_type, avatar_value, created_at')
          .eq('id', userId)
          .maybeSingle();
        if (cancelled) return;
        if (safe) setProfileData(safe);
        setLatestAchievement(null);
        setLoading(false);
        return;
      }

      setProfileData(data.profile);

      setStats({
        workouts: data.workouts ?? 0,
        streak:   data.streak ?? 0,
        prs:      data.prs ?? 0,
      });
      setStatsAvailable(true);

      if (data.latest_achievement) {
        const def = ACHIEVEMENT_DEFS.find(a => a.key === data.latest_achievement);
        setLatestAchievement(def ?? null);
      } else {
        setLatestAchievement(null);
      }

      setLoading(false);
    };

    fetchData();
    return () => { cancelled = true; };
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

  const displayName = profileData?.full_name || profileData?.username || t('profilePreview.memberFallback', { defaultValue: 'Member' });
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
      role="button"
      tabIndex={-1}
      aria-label={t('profilePreview.closePreview', { defaultValue: 'Close preview' })}
      onClick={handleBackdropClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClose(); }}
      className={`fixed inset-0 z-[200] flex items-center justify-center px-4 transition-all duration-300 ${
        visible ? 'bg-black/60 backdrop-blur-sm' : 'bg-black/0'
      }`}
      style={{ pointerEvents: isOpen ? 'auto' : 'none' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-busy={loading}
        aria-label={loading ? t('profilePreview.loadingProfile', { defaultValue: 'Loading profile' }) : (profileData?.full_name || t('profilePreview.profilePreview', { defaultValue: 'Profile preview' }))}
        className={`relative w-full max-w-[360px] rounded-2xl border border-white/[0.06] shadow-2xl shadow-black/50 overflow-hidden transition-all duration-300 ${
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
        style={{ background: 'var(--color-bg-card)' }}
      >
        {/* Close + overflow menu */}
        <div className="absolute top-4 right-4 z-10 flex items-center gap-1">
          {!loading && profileData && userId !== user?.id && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setShowMenu(s => !s)}
                aria-label={t('social.moreOptions')}
                aria-haspopup="menu"
                aria-expanded={showMenu}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                style={{ color: 'var(--color-text-subtle)' }}
              >
                <MoreHorizontal size={18} />
              </button>
              {showMenu && (
                <div
                  role="menu"
                  className="absolute right-0 top-11 w-48 rounded-xl border border-white/10 shadow-xl overflow-hidden"
                  style={{ background: 'var(--color-bg-card)' }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setShowMenu(false); setReportOpen(true); }}
                    className="flex items-center gap-2.5 w-full px-4 py-3 text-[13px] hover:bg-white/[0.04] transition-colors text-left"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    <Flag size={15} style={{ color: 'var(--color-text-muted)' }} />
                    {t('moderation.menu.report', { defaultValue: 'Report' })}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setShowMenu(false); setConfirmBlock(true); }}
                    className="flex items-center gap-2.5 w-full px-4 py-3 text-[13px] text-red-400 hover:bg-red-500/10 transition-colors text-left"
                    style={{ borderTop: '1px solid var(--color-border-subtle, rgba(127,127,127,0.12))' }}
                  >
                    <Ban size={15} className="text-red-400" />
                    {t('social.blockUser', { name: profileData?.full_name?.split(' ')[0] ?? '' })}
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('profilePreview.closePreview', { defaultValue: 'Close preview' })}
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/[0.06] transition-colors"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            <X size={18} />
          </button>
        </div>

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
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="font-bold text-[17px] truncate leading-snug" style={{ color: 'var(--color-text-primary)' }}>
                    {displayName}
                  </p>
                  {profileData?.role && profileData.role !== 'member' && (
                    <span
                      className="text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded-md flex-shrink-0"
                      style={{
                        background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
                        color: 'var(--color-accent, #D4AF37)',
                        fontWeight: 700,
                      }}
                    >
                      {profileData.role === 'super_admin'
                        ? t('messages.superAdmin', { defaultValue: 'Super Admin' })
                        : profileData.role === 'admin'
                          ? t('messages.admin', { defaultValue: 'Admin' })
                          : t('messages.trainer', { defaultValue: 'Trainer' })}
                    </span>
                  )}
                </div>
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
                <p className="text-[18px] font-black leading-none" style={{ color: 'var(--color-text-primary)' }}>{statsAvailable ? stats.workouts : '—'}</p>
                <p className="text-[11px] mt-1.5 font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t('profile.preview.workouts')}</p>
              </div>
              <div className="text-center py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <p className="text-[18px] font-black text-[#D4AF37] leading-none">{statsAvailable ? stats.streak : '—'}</p>
                <p className="text-[11px] mt-1.5 font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t('profile.preview.streak')}</p>
              </div>
              <div className="text-center py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <p className="text-[18px] font-black leading-none" style={{ color: 'var(--color-text-primary)' }}>{statsAvailable ? stats.prs : '—'}</p>
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
                style={{ backgroundColor: 'var(--color-accent, #D4AF37)', color: 'var(--color-text-on-accent, #000)' }}
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

      {/* Report User (center-aligned) */}
      <ReportContentModal
        isOpen={reportOpen}
        onClose={() => setReportOpen(false)}
        contentType="profile"
        contentId={userId}
        targetUserId={userId}
      />

      {/* Block User Confirm (center-aligned) */}
      {confirmBlock && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-label={t('social.confirmBlock.title', { name: profileData?.full_name?.split(' ')[0] ?? '' })}
          onClick={() => !blocking && setConfirmBlock(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="presentation" />
          <div
            className="relative w-full max-w-[420px] rounded-[28px] border border-white/10 overflow-hidden"
            style={{ background: 'var(--color-bg-card)', boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-5 pt-5 pb-3">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
                <Ban size={20} className="text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                  {t('social.confirmBlock.title', { name: profileData?.full_name?.split(' ')[0] ?? '' })}
                </h3>
                <p className="text-[13px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  {t('social.confirmBlock.subtitle')}
                </p>
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmBlock(false)}
                disabled={blocking}
                className="flex-1 py-3 rounded-xl text-[14px] font-semibold bg-white/[0.06] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('social.report.cancel')}
              </button>
              <button
                type="button"
                onClick={handleBlock}
                disabled={blocking}
                className="flex-1 py-3 rounded-xl text-[14px] font-semibold transition-colors disabled:opacity-50"
                style={{ background: 'rgb(220,38,38)', color: '#fff' }}
              >
                {blocking ? t('social.report.submitting') : t('social.confirmBlock.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default ProfilePreview;
