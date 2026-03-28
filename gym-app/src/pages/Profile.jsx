import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Trophy, Dumbbell, Calendar,
  Lock, BarChart2, Star, LogOut, Edit2, Check, Scale, Flame,
  UtensilsCrossed, QrCode, Gift, Settings, ChevronRight, Trash2, AlertTriangle, Heart,
  Camera, X, Loader2, Sprout, Zap, Activity, Sparkles, Building2,
  Target, TrendingUp, UserPlus, Users, Brain, Medal, Gem, Rocket, RotateCw, CalendarCheck, Weight,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { validateImageFile } from '../lib/validateImage';
import logger from '../lib/logger';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ACHIEVEMENT_DEFS, ACHIEVEMENT_CATEGORIES, fetchAchievementData, awardAchievements, computeStreakFromSessions } from '../lib/achievements';
import { getRewardTier, getUserPoints } from '../lib/rewardsEngine';
import { getLevel } from '../components/LevelBadge';

// Map achievement icon names → lucide components
const ICON_MAP = {
  Dumbbell, Flame, Zap, Star, Trophy, CalendarCheck, RotateCw, Rocket,
  Target, TrendingUp, UserPlus, Users, Brain, Medal, Weight, Gem,
  Shield: Lock, Crown: Trophy, Mountain: Activity, Award: Star, Heart, Megaphone: Sparkles, Swords: Zap, MapPin: QrCode, Apple: UtensilsCrossed,
};
const AchievementIcon = ({ name, size = 24, color }) => {
  const Icon = ICON_MAP[name];
  if (Icon) return <Icon size={size} style={{ color }} strokeWidth={2} />;
  return <Dumbbell size={size} style={{ color }} strokeWidth={2} />;
};

// ── Setup option data ─────────────────────────────────────────────────────────
const FITNESS_LEVELS = [
  { value: 'beginner',     icon: Sprout },
  { value: 'intermediate', icon: Zap },
  { value: 'advanced',     icon: Trophy },
];

const GOALS = [
  { value: 'muscle_gain',     icon: Dumbbell },
  { value: 'fat_loss',        icon: Flame },
  { value: 'strength',        icon: Dumbbell },
  { value: 'endurance',       icon: Activity },
  { value: 'general_fitness', icon: Sparkles },
];

const FREQUENCIES = [1, 2, 3, 4, 5, 6, 7];

const EQUIPMENT_OPTIONS = [
  { value: 'Barbell',         labelKey: 'barbell' },
  { value: 'Dumbbell',        labelKey: 'dumbbells' },
  { value: 'Cable',           labelKey: 'cables' },
  { value: 'Machine',         labelKey: 'machines' },
  { value: 'Bodyweight',      labelKey: 'bodyweight' },
  { value: 'Kettlebell',      labelKey: 'kettlebells' },
  { value: 'Resistance Band', labelKey: 'resistance_bands' },
  { value: 'Smith Machine',   labelKey: 'smith_machine' },
];

const INJURY_OPTIONS = [
  { value: 'lower_back', labelKey: 'lower_back' },
  { value: 'knees',      labelKey: 'knees' },
  { value: 'shoulders',  labelKey: 'shoulders' },
  { value: 'wrists',     labelKey: 'wrists' },
  { value: 'elbows',     labelKey: 'elbows' },
  { value: 'hips',       labelKey: 'hips' },
  { value: 'neck',       labelKey: 'neck' },
  { value: 'ankles',     labelKey: 'ankles' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const buildWeeklyChart = (sessions) => {
  const now = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  sunday.setHours(0, 0, 0, 0);

  return Array.from({ length: 8 }, (_, wi) => {
    const weekStart = new Date(sunday);
    weekStart.setDate(sunday.getDate() - (7 - wi) * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const volume = sessions
      .filter(s => { const d = new Date(s.completed_at); return d >= weekStart && d < weekEnd; })
      .reduce((sum, s) => sum + (parseFloat(s.total_volume_lbs) || 0), 0);

    const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { week: label, volume: Math.round(volume) };
  });
};

const MUSCLE_COLORS = {
  Chest: '#EF4444', Back: '#3B82F6', Legs: '#10B981', Shoulders: '#D4AF37',
  Biceps: '#F59E0B', Triceps: '#F97316', Core: '#60A5FA', Glutes: '#A78BFA',
  Hamstrings: '#34D399', Quads: '#6EE7B7', Calves: '#FCD34D',
};

// ACHIEVEMENT_DEFS and ACHIEVEMENT_CATEGORIES are imported from ../lib/achievements

// ── Hero stat block ───────────────────────────────────────────────────────────
const HeroStat = ({ label, value, sub }) => (
  <div className="flex flex-col items-center justify-center text-center py-5 px-2 min-w-0 border-r border-[var(--color-border-subtle)] last:border-r-0">
    <p className="text-[32px] font-black leading-none text-[#D4AF37] flex items-baseline justify-center gap-1 flex-wrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
      {value}
      {sub && <span className="text-[12px] font-semibold text-[var(--color-text-muted)] normal-case">{sub}</span>}
    </p>
    <p className="text-[11px] font-medium mt-1.5 text-[var(--color-text-muted)] uppercase tracking-wider">{label}</p>
  </div>
);

// ── Main ──────────────────────────────────────────────────────────────────────
const Profile = () => {
  const { t } = useTranslation('pages');
  const { user, profile, signOut, deleteAccount, refreshProfile, lifetimePoints: ctxLifetimePoints } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('achievements');

  useEffect(() => { document.title = 'Profile | TuGymPR'; }, []);

  // Data state
  const [gymName, setGymName]                         = useState('');
  const [sessions, setSessions]                       = useState([]);
  const [prs, setPrs]                                 = useState([]);
  const [muscleBalance, setMuscleBalance]             = useState([]);
  const [weeklyChart, setWeeklyChart]                 = useState([]);
  const [loading, setLoading]                         = useState(true);
  const [unlockedAchievementIds, setUnlockedAchievementIds] = useState(new Set());
  // Map of achievement_key -> earned_at (ISO string) for earned ones
  const [earnedAchievements, setEarnedAchievements]   = useState({});
  // Live achievement data for progress bars
  const [achievementStats, setAchievementStats]       = useState(null);

  // Level / points
  const [userPoints, setUserPoints] = useState(ctxLifetimePoints ?? 0);
  useEffect(() => { if (ctxLifetimePoints != null) setUserPoints(ctxLifetimePoints); }, [ctxLifetimePoints]);
  const [gymInfo, setGymInfo] = useState(null);

  // Goals state
  const [onboarding, setOnboarding]     = useState(null);
  const [editingGoals, setEditingGoals] = useState(false);
  const [goalsDraft, setGoalsDraft]     = useState(null);
  const [savingGoals, setSavingGoals]   = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showGymInfo, setShowGymInfo] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Avatar upload state
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = React.useRef(null);

  // Name / username editing state
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [identityDraft, setIdentityDraft] = useState({ full_name: '', username: '' });
  const [savingIdentity, setSavingIdentity] = useState(false);

  useEffect(() => {
    if (!user || !profile) return;

    const load = async () => {
      setLoading(true);

      // 1. Gym info (select only needed columns)
      const { data: gym } = await supabase
        .from('gyms').select('id, name, slug, is_active').eq('id', profile.gym_id).single();
      setGymName(gym?.name ?? '');
      setGymInfo(gym ?? null);

      // Fetch user points for level display
      const ptsData = await getUserPoints(user.id);
      setUserPoints(ptsData.lifetime_points || 0);

      // 2. Recent completed sessions (capped for performance)
      const { data: sessionData } = await supabase
        .from('workout_sessions')
        .select('id, completed_at, total_volume_lbs')
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(50);

      const allSessions = sessionData ?? [];
      setSessions(allSessions);
      setWeeklyChart(buildWeeklyChart(allSessions));

      // 3. Personal records
      const { data: prData } = await supabase
        .from('personal_records')
        .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name, muscle_group)')
        .eq('profile_id', user.id)
        .order('estimated_1rm', { ascending: false })
        .limit(50);
      setPrs(prData ?? []);

      // 4. Muscle balance (this month)
      const startOfMonth = new Date();
      startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
      const monthIds = allSessions.filter(s => new Date(s.completed_at) >= startOfMonth).map(s => s.id);

      if (monthIds.length > 0) {
        const { data: seData } = await supabase
          .from('session_exercises')
          .select('exercises(muscle_group), session_sets(is_completed)')
          .in('session_id', monthIds);

        const muscleMap = {};
        seData?.forEach(se => {
          const group = se.exercises?.muscle_group ?? 'Other';
          const count = (se.session_sets ?? []).filter(s => s.is_completed).length;
          muscleMap[group] = (muscleMap[group] ?? 0) + count;
        });
        setMuscleBalance(Object.entries(muscleMap)
          .map(([muscle, sets]) => ({ muscle, sets }))
          .sort((a, b) => b.sets - a.sets));
      }

      // 5. Onboarding / goals
      const { data: ob } = await supabase
        .from('member_onboarding')
        .select('fitness_level, primary_goal, training_days_per_week, available_equipment, injuries_notes')
        .eq('profile_id', user.id)
        .single();
      setOnboarding(ob ?? null);

      // 6. Award any missing achievements, then load earned + stats
      await awardAchievements(user.id, profile.gym_id, supabase);

      const [{ data: dbUnlocked }, achStats] = await Promise.all([
        supabase
          .from('user_achievements')
          .select('achievement_key, earned_at')
          .eq('user_id', user.id)
          .eq('gym_id', profile.gym_id),
        fetchAchievementData(user.id, profile.gym_id, supabase),
      ]);

      const earnedMap = {};
      (dbUnlocked ?? []).forEach(row => {
        earnedMap[row.achievement_key] = row.earned_at;
      });
      setEarnedAchievements(earnedMap);
      setAchievementStats(achStats);
      setUnlockedAchievementIds(new Set(Object.keys(earnedMap)));

      setLoading(false);
    };

    load();
  }, [user, profile]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const { level } = getLevel(userPoints);
  const tier = getRewardTier(userPoints);
  const streak      = computeStreakFromSessions(sessions);
  const totalVolume = sessions.reduce((sum, s) => sum + (parseFloat(s.total_volume_lbs) || 0), 0);
  const volumeStr   = totalVolume >= 1_000_000
    ? `${(totalVolume / 1_000_000).toFixed(2)}M`
    : totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(0)}k`
    : `${Math.round(totalVolume)}`;

  const prGroups = prs.reduce((acc, pr) => {
    const group = pr.exercises?.muscle_group ?? 'Other';
    if (!acc[group]) acc[group] = [];
    acc[group].push(pr);
    return acc;
  }, {});

  const firstName = profile?.full_name?.split(' ')[0] ?? '';
  const joinDate  = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : '';
  const maxMuscleSets = muscleBalance[0]?.sets ?? 1;

  // ── Save goals ──────────────────────────────────────────────────────────────
  const saveGoals = async () => {
    setSavingGoals(true);
    try {
      const { injury_areas, preferred_training_days, ...dbFields } = goalsDraft;
      const injuries_notes = (injury_areas ?? []).length > 0
        ? injury_areas.join(', ')
        : null;
      const { error } = await supabase
        .from('member_onboarding')
        .upsert({ profile_id: user.id, gym_id: profile.gym_id, ...dbFields, injuries_notes });
      // Also save preferred_training_days to profiles table (used by streak logic)
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ preferred_training_days: preferred_training_days || [] })
        .eq('id', user.id);
      if (error || profileErr) {
        logger.error('saveGoals error:', error || profileErr);
        showToast(t('toasts.failedToSave', { message: (error || profileErr).message }), 'error');
      } else {
        setOnboarding({ ...dbFields, injuries_notes });
        refreshProfile();
        setEditingGoals(false);
        showToast(t('toasts.goalsSaved'), 'success');
      }
    } finally {
      setSavingGoals(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteInput !== 'DELETE') return;
    setDeleting(true);
    try {
      await deleteAccount();
    } catch (err) {
      showToast(err.message || t('toasts.failedToDeleteAccount'), 'error');
      setDeleting(false);
    }
  };

  // ── Avatar upload ──────────────────────────────────────────────────────────
  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type via magic bytes (not just MIME which can be spoofed)
    const validation = await validateImageFile(file);
    if (!validation.valid) {
      showToast(validation.error, 'error');
      return;
    }

    setUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/${Date.now()}.${ext}`;

      const { error: storageErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });
      if (storageErr) throw storageErr;

      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(path);

      const { error: updateErr } = await supabase
        .from('profiles')
        .update({ avatar_url: urlData.publicUrl })
        .eq('id', user.id);
      if (updateErr) throw updateErr;

      refreshProfile();
      showToast(t('toasts.avatarUpdated'), 'success');
    } catch (err) {
      logger.error('Avatar upload error:', err);
      showToast(t('toasts.failedToUploadAvatar', { message: err.message ?? 'Unknown error' }), 'error');
    } finally {
      setUploadingAvatar(false);
      // Reset the input so re-selecting the same file still triggers onChange
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  // ── Save name / username ──────────────────────────────────────────────────
  const saveIdentity = async () => {
    const trimmedName = identityDraft.full_name.trim();
    const trimmedUsername = identityDraft.username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

    if (!trimmedName) {
      showToast('Name cannot be empty', 'error');
      return;
    }
    if (!trimmedUsername) {
      showToast('Username cannot be empty', 'error');
      return;
    }
    if (trimmedUsername.length > 30) {
      showToast('Username must be 30 characters or less', 'error');
      return;
    }

    setSavingIdentity(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: trimmedName, username: trimmedUsername })
        .eq('id', user.id);
      if (error) {
        if (error.message?.includes('unique') || error.code === '23505') {
          showToast('That username is already taken', 'error');
        } else {
          showToast('Failed to save: ' + error.message, 'error');
        }
        return;
      }
      refreshProfile();
      setEditingIdentity(false);
      showToast('Profile updated', 'success');
    } catch (err) {
      showToast('Failed to save: ' + (err.message ?? 'Unknown error'), 'error');
    } finally {
      setSavingIdentity(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] pb-28 md:pb-12">
      <div className="max-w-[680px] md:max-w-4xl mx-auto px-4 pt-6 pb-8">

      {/* ── Profile header card ──────────────────────────────────────────── */}
      <div className="rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] mb-6 overflow-hidden" data-tour="tour-profile-page">

        {/* Identity row */}
        <div className="flex items-start justify-between p-6 pb-4">
          <div className="flex items-center gap-4">
            {/* Avatar with upload overlay */}
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="relative flex-shrink-0 group"
              title="Change avatar"
            >
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.full_name}
                  className="w-[72px] h-[72px] rounded-2xl object-cover border-2 border-[#D4AF37]/40"
                />
              ) : (
                <div className="w-[72px] h-[72px] rounded-2xl flex items-center justify-center font-black text-[28px] bg-amber-900/40 border-2 border-[#D4AF37]/30 text-[#D4AF37]">
                  {(profile?.full_name?.[0] ?? '?').toUpperCase()}
                </div>
              )}
              {/* Camera overlay */}
              <div className="absolute inset-0 rounded-2xl bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {uploadingAvatar ? (
                  <Loader2 size={20} className="text-white animate-spin" />
                ) : (
                  <Camera size={20} className="text-white" />
                )}
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
            </button>

            {/* Name / username — view or edit */}
            {editingIdentity ? (
              <div className="flex flex-col gap-1.5">
                <input
                  type="text"
                  value={identityDraft.full_name}
                  onChange={e => setIdentityDraft(d => ({ ...d, full_name: e.target.value }))}
                  placeholder="Full name"
                  className="bg-[#0B1220] border border-white/10 rounded-lg px-3 py-1.5 text-[16px] font-bold text-[var(--color-text-primary)] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/50 w-full max-w-[200px]"
                />
                <div className="flex items-center gap-1">
                  <span className="text-[13px] text-[var(--color-text-muted)]">@</span>
                  <input
                    type="text"
                    value={identityDraft.username}
                    onChange={e => setIdentityDraft(d => ({ ...d, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
                    maxLength={30}
                    placeholder="username"
                    className="bg-[#0B1220] border border-white/10 rounded-lg px-2 py-1 text-[13px] text-[var(--color-text-muted)] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/50 w-full max-w-[180px]"
                  />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={saveIdentity}
                    disabled={savingIdentity}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg text-[12px] font-semibold bg-[#D4AF37] text-black disabled:opacity-50 hover:bg-[#C5A030] transition-colors"
                  >
                    {savingIdentity ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    {t('profile.save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingIdentity(false)}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg text-[12px] font-semibold border border-white/10 text-[var(--color-text-muted)] hover:bg-white/[0.06] transition-colors duration-200"
                  >
                    <X size={12} /> {t('profile.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-[22px] font-bold leading-tight text-[var(--color-text-primary)]">
                    {loading ? '—' : profile?.full_name}
                  </h1>
                  <button
                    type="button"
                    onClick={() => {
                      setIdentityDraft({
                        full_name: profile?.full_name ?? '',
                        username: profile?.username ?? '',
                      });
                      setEditingIdentity(true);
                    }}
                    className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-white/[0.06] transition-colors duration-200 text-[var(--color-text-muted)] hover:text-[#D4AF37]"
                    title="Edit name & username"
                  >
                    <Edit2 size={13} />
                  </button>
                </div>
                <p className="text-[13px] mt-0.5 text-[var(--color-text-muted)]">@{profile?.username}</p>
                {gymName && (
                  <p className="text-[13px] mt-1.5 flex items-center gap-1.5 font-semibold text-[#D4AF37]">
                    <Dumbbell size={14} /> {gymName}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors hover:opacity-80 active:scale-95 bg-white/[0.06] border border-white/10 text-[var(--color-text-muted)]"
              title="Settings"
            >
              <Settings size={18} />
            </button>
            <button
              type="button"
              onClick={signOut}
              className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors hover:opacity-80 active:scale-95 bg-red-900/30 border border-red-800 text-red-400"
              title="Log out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>

        {joinDate && (
          <p className="text-[12px] flex items-center gap-1.5 px-6 pb-2 text-[var(--color-text-muted)]">
            <Calendar size={12} /> {t('profile.memberSince')} {joinDate}
          </p>
        )}

        {/* Level badge */}
        <div className="flex items-center gap-2 px-6 pb-4">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center font-black text-[12px]"
            style={{ backgroundColor: `${tier.color}20`, color: tier.color, border: `1.5px solid ${tier.color}40` }}
          >
            {level}
          </div>
          <span className="text-[13px] font-bold text-[var(--color-text-primary)]">{t('profile.level')} {level}</span>
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: `${tier.color}15`, color: tier.color }}
          >
            {t(`rewards.tiers.${tier.nameKey}`, tier.name)}
          </span>
        </div>

        {/* Hero stats */}
        <div className="border-t border-[var(--color-border-subtle)]">
          <div className="grid grid-cols-4 gap-0 w-full">
            <HeroStat label={t('profile.workouts')} value={loading ? '—' : sessions.length} />
            <HeroStat label={t('profile.streak')}   value={loading ? '—' : streak} sub={t('profile.days')} />
            <HeroStat label={t('profile.volume')}   value={loading ? '—' : volumeStr} sub="lbs" />
            <div className="flex flex-col items-center justify-center text-center py-5 px-2 min-w-0 border-r border-[var(--color-border-subtle)] last:border-r-0">
              <p className="text-[32px] font-black leading-none text-[#D4AF37]" style={{ fontVariantNumeric: 'tabular-nums' }}>{loading ? '—' : prs.length}</p>
              <p className="text-[11px] font-medium mt-1.5 text-[var(--color-text-muted)] uppercase tracking-wider">{t('profile.records')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Quick-access cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4 mb-6 stagger-fade-in">
        {[
          { to: '/checkin',    icon: QrCode,           label: t('profile.checkIn'),  color: '#3B82F6' },
          { to: '/nutrition',  icon: UtensilsCrossed,  label: t('dashboard.nutrition'), color: '#10B981' },
          { to: '/my-gym',     icon: Building2,        label: t('profile.myGym'),    color: '#D4AF37' },
        ].map(item => (
          <button
            key={item.label}
            type="button"
            onClick={() => navigate(item.to)}
            className="flex flex-col items-center gap-2 py-4 rounded-2xl bg-white/[0.04] border border-[var(--color-border-subtle)] hover:bg-white/[0.06] transition-colors duration-200 active:scale-[0.98] transition-transform duration-150"
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: `${item.color}18` }}
            >
              <item.icon size={18} style={{ color: item.color }} strokeWidth={2} />
            </div>
            <span className="text-[11px] font-semibold text-[var(--color-text-muted)]">{item.label}</span>
          </button>
        ))}
      </div>


      {/* ── Pill tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-6 bg-[var(--color-bg-deep)] p-1 rounded-xl">
        {[
          { key: 'achievements', label: t('profile.achievements') },
          { key: 'goals',        label: t('profile.goals') },
        ].map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${
              activeTab === t.key
                ? 'bg-[#D4AF37] text-black font-semibold'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-muted)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Achievements Tab ─────────────────────────────────────────────── */}
      {activeTab === 'achievements' && (
        <div className="flex flex-col gap-8 animate-fade-in stagger-fade-in">
          {/* Summary bar */}
          {!loading && (
            <div className="rounded-2xl bg-white/[0.04] border border-[var(--color-border-subtle)] px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-[22px] font-black text-[#D4AF37] leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {Object.keys(earnedAchievements).length}
                  <span className="text-[14px] font-semibold text-[var(--color-text-muted)] ml-1">
                    / {ACHIEVEMENT_DEFS.length}
                  </span>
                </p>
                <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mt-1">
                  {t('profile.achievementsEarned')}
                </p>
              </div>
              {/* Overall progress bar */}
              <div className="flex-1 mx-5">
                <div className="h-2 rounded-full bg-[var(--color-bg-deep)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${(Object.keys(earnedAchievements).length / ACHIEVEMENT_DEFS.length) * 100}%`,
                      background: 'linear-gradient(90deg, var(--color-accent), var(--color-warning))',
                    }}
                  />
                </div>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1 text-right">
                  {Math.round((Object.keys(earnedAchievements).length / ACHIEVEMENT_DEFS.length) * 100)}% {t('profile.complete')}
                </p>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 rounded-2xl bg-white/[0.04] border border-[var(--color-border-subtle)] animate-pulse" />
              ))}
            </div>
          ) : (
            ACHIEVEMENT_CATEGORIES.map(category => {
              const defs = ACHIEVEMENT_DEFS.filter(a => a.category === category);
              if (defs.length === 0) return null;
              const earnedInCategory = defs.filter(a => earnedAchievements[a.key]).length;
              return (
                <section key={category}>
                  {/* Category header */}
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">
                      {t(`profile.achievementCategories.${category}`, category)}
                    </h3>
                    <span className="text-[11px] font-semibold text-[var(--color-text-muted)]">
                      {earnedInCategory}/{defs.length}
                    </span>
                  </div>

                  <div className="flex flex-col gap-3 stagger-fade-in">
                    {defs.map(a => {
                      const earned = !!earnedAchievements[a.key];
                      const earnedAt = earnedAchievements[a.key];

                      // Progress calculation
                      let progressValue = 0;
                      let progressTarget = 1;
                      let progressPct = earned ? 100 : 0;
                      if (!earned && a.progressOf && achievementStats) {
                        progressValue = Math.min(
                          achievementStats[a.progressOf.key] ?? 0,
                          a.progressOf.target
                        );
                        progressTarget = a.progressOf.target;
                        progressPct = Math.min((progressValue / progressTarget) * 100, 100);
                      }

                      return (
                        <div
                          key={a.key}
                          className="rounded-2xl border flex items-center gap-4 px-4 py-4 transition-all"
                          style={{
                            background: earned ? 'var(--color-bg-card)' : 'var(--color-bg-secondary)',
                            borderColor: earned ? `${a.color}40` : 'var(--color-border-subtle)',
                            boxShadow: earned ? `0 0 20px ${a.color}12` : 'none',
                            opacity: earned ? 1 : 0.75,
                          }}
                        >
                          {/* Icon badge */}
                          <div
                            className="relative flex-shrink-0 flex items-center justify-center"
                            style={{
                              width: 52,
                              height: 52,
                              borderRadius: 14,
                              background: earned ? `${a.color}18` : 'var(--color-surface-hover)',
                              border: earned ? `1.5px solid ${a.color}40` : '1.5px solid var(--color-border-subtle)',
                              filter: earned ? 'none' : 'grayscale(1)',
                            }}
                          >
                            <AchievementIcon name={a.icon} size={24} color={earned ? a.color : '#6B7280'} />
                            {!earned && (
                              <div
                                className="absolute inset-0 flex items-center justify-center rounded-[13px]"
                                style={{ background: 'color-mix(in srgb, var(--color-bg-primary) 55%, transparent)' }}
                              >
                                <Lock size={14} style={{ color: '#6B7280' }} />
                              </div>
                            )}
                          </div>

                          {/* Text + progress */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p
                                className="font-semibold text-[14px] truncate"
                                style={{ color: earned ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}
                              >
                                {t(a.labelKey, a.label)}
                              </p>
                              {earned && (
                                <span
                                  className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                                  style={{
                                    background: `${a.color}20`,
                                    color: a.color,
                                    border: `1px solid ${a.color}40`,
                                  }}
                                >
                                  {t('profile.earned')}
                                </span>
                              )}
                            </div>
                            <p className="text-[12px] mt-0.5 leading-snug text-[var(--color-text-muted)]">
                              {t(a.descKey, a.desc)}
                            </p>

                            {/* Progress bar for countable achievements */}
                            {!earned && a.progressOf && progressValue > 0 && (
                              <div className="mt-2">
                                <div className="h-1.5 rounded-full bg-[var(--color-bg-deep)] overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-700"
                                    style={{
                                      width: `${progressPct}%`,
                                      background: `linear-gradient(90deg, ${a.color}88, ${a.color})`,
                                    }}
                                  />
                                </div>
                                <p className="text-[10px] mt-1" style={{ color: a.color + 'CC' }}>
                                  {a.progressOf.key === 'totalVolumeLbs'
                                    ? `${Math.round(progressValue).toLocaleString()} / ${progressTarget.toLocaleString()} lbs`
                                    : `${progressValue} / ${progressTarget}`}
                                </p>
                              </div>
                            )}

                            {/* Earned date */}
                            {earned && earnedAt && (
                              <p className="text-[11px] mt-1" style={{ color: `${a.color}99` }}>
                                {t('profile.earned')} {new Date(earnedAt).toLocaleDateString('en-US', {
                                  month: 'short', day: 'numeric', year: 'numeric',
                                })}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </div>
      )}

      {/* ── Goals Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'goals' && (
        <div className="animate-fade-in">
          {editingGoals && goalsDraft ? (
            /* ── EDIT MODE ─────────────────────────────────────────────── */
            <div className="flex flex-col gap-6 pb-2">

              {/* Fitness Level */}
              <div>
                <h3 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">{t('profile.fitnessLevel')}</h3>
                <div className="flex flex-col gap-3">
                  {FITNESS_LEVELS.map(l => (
                    <button key={l.value} type="button"
                      onClick={() => setGoalsDraft(d => ({ ...d, fitness_level: l.value }))}
                      className={`w-full text-left flex items-center gap-4 px-5 py-4 rounded-2xl border transition-all ${
                        goalsDraft.fitness_level === l.value
                          ? 'bg-amber-900/30 border-[#D4AF37]/50'
                          : 'bg-[var(--color-bg-card)] border-[var(--color-border-subtle)]'
                      }`}
                    >
                      <l.icon size={22} className="text-[#D4AF37] flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-[15px] ${goalsDraft.fitness_level === l.value ? 'text-[#D4AF37]' : 'text-[var(--color-text-primary)]'}`}>{t(`profile_options.fitnessLevels.${l.value}`)}</p>
                        <p className="text-[12px] mt-0.5 text-[var(--color-text-muted)]">{t(`profile_options.fitnessLevels.${l.value}_desc`)}</p>
                      </div>
                      {goalsDraft.fitness_level === l.value && <Check size={16} className="text-[#D4AF37] flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Primary Goal */}
              <div>
                <h3 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">{t('profile.primaryGoal')}</h3>
                <div className="flex flex-col gap-3">
                  {GOALS.map(g => (
                    <button key={g.value} type="button"
                      onClick={() => setGoalsDraft(d => ({ ...d, primary_goal: g.value }))}
                      className={`w-full text-left flex items-center gap-4 px-5 py-4 rounded-2xl border transition-all ${
                        goalsDraft.primary_goal === g.value
                          ? 'bg-amber-900/30 border-[#D4AF37]/50'
                          : 'bg-[var(--color-bg-card)] border-[var(--color-border-subtle)]'
                      }`}
                    >
                      <g.icon size={22} className="text-[#D4AF37] flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-[15px] ${goalsDraft.primary_goal === g.value ? 'text-[#D4AF37]' : 'text-[var(--color-text-primary)]'}`}>{t(`profile_options.goals.${g.value}`)}</p>
                        <p className="text-[12px] mt-0.5 text-[var(--color-text-muted)]">{t(`profile_options.goals.${g.value}_desc`)}</p>
                      </div>
                      {goalsDraft.primary_goal === g.value && <Check size={16} className="text-[#D4AF37] flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Training Days */}
              <div>
                <h3 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">{t('profile.daysPerWeek')}</h3>
                <div className="flex gap-2">
                  {FREQUENCIES.map(n => (
                    <button key={n} type="button"
                      onClick={() => setGoalsDraft(d => ({ ...d, training_days_per_week: n }))}
                      className={`flex-1 py-3 rounded-xl text-[15px] font-bold transition-all border ${
                        goalsDraft.training_days_per_week === n
                          ? 'bg-amber-900/40 border-[#D4AF37]/50 text-[#D4AF37]'
                          : 'bg-[var(--color-bg-deep)] border-[var(--color-border-subtle)] text-[var(--color-text-muted)]'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preferred Training Days */}
              <div>
                <h3 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-2">{t('profile.trainingDays')}</h3>
                <p className="text-[11px] text-[var(--color-text-muted)] mb-3">{t('profile.trainingDaysHint')}</p>
                <div className="flex gap-1.5">
                  {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(day => {
                    const short = t(`profile.dayShort.${day}`);
                    const active = (goalsDraft.preferred_training_days ?? []).includes(day);
                    return (
                      <button key={day} type="button"
                        onClick={() => setGoalsDraft(d => ({
                          ...d,
                          preferred_training_days: active
                            ? (d.preferred_training_days || []).filter(dd => dd !== day)
                            : [...(d.preferred_training_days || []), day],
                        }))}
                        className={`flex-1 py-2.5 rounded-xl text-[12px] font-bold transition-all border ${
                          active
                            ? 'bg-amber-900/40 border-[#D4AF37]/50 text-[#D4AF37]'
                            : 'bg-[var(--color-bg-deep)] border-[var(--color-border-subtle)] text-[var(--color-text-muted)]'
                        }`}
                      >
                        {short}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Equipment */}
              <div>
                <h3 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">{t('profile.availableEquipment')}</h3>
                <div className="flex flex-wrap gap-2">
                  {EQUIPMENT_OPTIONS.map(eq => {
                    const active = (goalsDraft.available_equipment ?? []).includes(eq.value);
                    return (
                      <button key={eq.value} type="button"
                        onClick={() => setGoalsDraft(d => ({
                          ...d,
                          available_equipment: active
                            ? (d.available_equipment ?? []).filter(e => e !== eq.value)
                            : [...(d.available_equipment ?? []), eq.value],
                        }))}
                        className={`text-[13px] font-semibold px-3.5 py-2 rounded-full border transition-all ${
                          active
                            ? 'bg-amber-900/40 border-[#D4AF37]/50 text-[#D4AF37]'
                            : 'bg-[var(--color-bg-deep)] border-[var(--color-border-subtle)] text-[var(--color-text-muted)]'
                        }`}
                      >
                        {t(`profile_options.equipment.${eq.labelKey}`)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Injuries */}
              <div>
                <h3 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">{t('profile.injuriesLimitations')}</h3>
                <div className="flex flex-wrap gap-2 mb-2">
                  {INJURY_OPTIONS.map(inj => {
                    const active = (goalsDraft.injury_areas ?? []).includes(inj.value);
                    return (
                      <button key={inj.value} type="button"
                        onClick={() => setGoalsDraft(d => ({
                          ...d,
                          injury_areas: active
                            ? (d.injury_areas ?? []).filter(v => v !== inj.value)
                            : [...(d.injury_areas ?? []), inj.value],
                        }))}
                        className={`text-[13px] font-semibold px-3.5 py-2 rounded-full border transition-all ${
                          active
                            ? 'bg-red-900/30 border-red-700 text-red-400'
                            : 'bg-[var(--color-bg-deep)] border-[var(--color-border-subtle)] text-[var(--color-text-muted)]'
                        }`}
                      >
                        {t(`profile_options.injuries.${inj.labelKey}`)}
                      </button>
                    );
                  })}
                </div>
                {(goalsDraft.injury_areas ?? []).length === 0 && (
                  <p className="text-[11px] text-[var(--color-text-muted)]">{t('profile.nothingSelectedAllExercises')}</p>
                )}
              </div>

              {/* Spacer so last field isn't hidden behind sticky bar */}
              <div className="h-24" />
            </div>
          ) : (
            /* ── VIEW MODE ─────────────────────────────────────────────── */
            <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:gap-4">
              {loading ? (
                <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:gap-4">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-20 rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] animate-pulse" />
                  ))}
                </div>
              ) : (
                <>
                  {/* Fitness Level */}
                  <div className="rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] p-5">
                    <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">{t('profile.fitnessLevel')}</p>
                    {(() => {
                      const l = FITNESS_LEVELS.find(x => x.value === onboarding?.fitness_level);
                      return l ? (
                        <div className="flex items-center gap-3">
                          <l.icon size={22} className="text-[#D4AF37] flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-[15px] text-[var(--color-text-primary)]">{t(`profile_options.fitnessLevels.${l.value}`)}</p>
                            <p className="text-[12px] mt-0.5 text-[var(--color-text-muted)]">{t(`profile_options.fitnessLevels.${l.value}_desc`)}</p>
                          </div>
                        </div>
                      ) : <p className="text-[var(--color-text-muted)]">{t('profile.notSet')}</p>;
                    })()}
                  </div>

                  {/* Primary Goal */}
                  <div className="rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] p-5">
                    <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">{t('profile.primaryGoal')}</p>
                    {(() => {
                      const g = GOALS.find(x => x.value === onboarding?.primary_goal);
                      return g ? (
                        <div className="flex items-center gap-3">
                          <g.icon size={22} className="text-[#D4AF37] flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-[15px] text-[var(--color-text-primary)]">{t(`profile_options.goals.${g.value}`)}</p>
                            <p className="text-[12px] mt-0.5 text-[var(--color-text-muted)]">{t(`profile_options.goals.${g.value}_desc`)}</p>
                          </div>
                        </div>
                      ) : <p className="text-[var(--color-text-muted)]">{t('profile.notSet')}</p>;
                    })()}
                  </div>

                  {/* Training Frequency */}
                  <div className="rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] p-5">
                    <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-2">{t('profile.trainingFrequency')}</p>
                    <p className="font-semibold text-[15px] text-[var(--color-text-primary)]">
                      {onboarding?.training_days_per_week
                        ? t('profile.daysPerWeekValue', { count: onboarding.training_days_per_week })
                        : t('profile.notSet')}
                    </p>
                  </div>

                  {/* Training Days */}
                  <div className="rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] p-5">
                    <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">{t('profile.trainingDays')}</p>
                    {profile?.preferred_training_days?.length > 0 ? (
                      <div className="flex gap-1.5">
                        {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((fullName) => {
                          const active = profile.preferred_training_days.includes(fullName);
                          return (
                            <div key={fullName} className={`flex-1 py-2 rounded-lg text-center text-[11px] font-bold ${active ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30' : 'bg-white/[0.04] text-[var(--color-text-muted)]'}`}>
                              {t(`profile.dayShort.${fullName}`)}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[13px] text-[var(--color-text-muted)]">{t('profile.trainingDaysNotSet')}</p>
                    )}
                  </div>

                  {/* Equipment */}
                  <div className="rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] p-5">
                    <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">{t('profile.availableEquipment')}</p>
                    {onboarding?.available_equipment?.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {onboarding.available_equipment.map(eq => {
                          const found = EQUIPMENT_OPTIONS.find(e => e.value === eq);
                          return (
                            <span key={eq} className="text-[12px] font-semibold px-3 py-1.5 rounded-full bg-amber-900/40 text-[#D4AF37] border border-[#D4AF37]/30">
                              {found ? t(`profile_options.equipment.${found.labelKey}`) : eq}
                            </span>
                          );
                        })}
                      </div>
                    ) : <p className="text-[var(--color-text-muted)]">{t('profile.notSet')}</p>}
                  </div>

                  {/* Injuries */}
                  <div className="rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] p-5">
                    <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">{t('profile.injuriesLimitations')}</p>
                    {(() => {
                      const areas = onboarding?.injuries_notes
                        ? onboarding.injuries_notes.split(',').map(s => s.trim()).filter(Boolean)
                        : [];
                      return areas.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {areas.map(area => {
                            const found = INJURY_OPTIONS.find(o => o.value === area);
                            return (
                              <span key={area} className="text-[12px] font-semibold px-3 py-1.5 rounded-full bg-red-900/30 text-red-400 border border-red-800">
                                {found ? t(`profile_options.injuries.${found.labelKey}`) : area}
                              </span>
                            );
                          })}
                        </div>
                      ) : <p className="text-[14px] text-[var(--color-text-muted)]">{t('profile.noneNoted')}</p>;
                    })()}
                  </div>

                  {/* Edit button */}
                  <button type="button"
                    onClick={() => {
                      const injury_areas = onboarding?.injuries_notes
                        ? onboarding.injuries_notes.split(',').map(s => s.trim()).filter(s => INJURY_OPTIONS.some(o => o.value === s))
                        : [];
                      setGoalsDraft({ ...onboarding, injury_areas, preferred_training_days: profile?.preferred_training_days || [] });
                      setEditingGoals(true);
                    }}
                    className="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl border border-[var(--color-border-subtle)] font-semibold text-[14px] text-[var(--color-text-muted)] bg-[var(--color-bg-card)] hover:bg-[var(--color-bg-deep)] transition-colors"
                  >
                    <Edit2 size={15} /> {t('profile.editGoalsSetup')}
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Sticky save bar ────────────────────────────────────── */}
          {editingGoals && goalsDraft && (
            <div className="fixed bottom-[56px] md:bottom-0 left-0 right-0 z-50 flex gap-3 px-4 py-3 md:pb-[calc(0.75rem+var(--safe-area-bottom,env(safe-area-inset-bottom)))] bg-[var(--color-bg-primary)] border-t border-white/10">
              <button type="button"
                onClick={() => setEditingGoals(false)}
                className="flex-1 py-3.5 rounded-xl border border-white/15 text-[15px] font-semibold text-[var(--color-text-primary)] bg-white/10">
                {t('profile.cancel')}
              </button>
              <button type="button"
                onClick={saveGoals}
                disabled={savingGoals}
                className="flex-1 py-3.5 rounded-xl text-[15px] font-bold bg-[#D4AF37] text-black disabled:opacity-50">
                {savingGoals ? t('profile.savingEllipsis') : t('profile.saveChanges')}
              </button>
            </div>
          )}
        </div>
      )}


      </div>

      {/* ── Gym Info Modal ──────────────────────────────────────────────── */}
      {showGymInfo && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowGymInfo(false)}>
          <div className="w-full max-w-md mx-4 rounded-[24px] bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="relative flex justify-center pt-4 pb-3">
              <div className="w-8 h-[3px] rounded-full bg-white/[0.08]" />
              <button onClick={() => setShowGymInfo(false)} className="absolute right-4 top-3 w-8 h-8 rounded-full bg-white/[0.04] flex items-center justify-center text-[var(--color-text-muted)]">
                <X size={16} />
              </button>
            </div>
            <div className="px-6 pb-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl bg-[#D4AF37]/15 flex items-center justify-center">
                  <Building2 size={20} className="text-[#D4AF37]" />
                </div>
                <div>
                  <h3 className="text-[17px] font-bold text-[var(--color-text-primary)]">{gymInfo?.name || gymName}</h3>
                  <p className="text-[12px] text-[var(--color-text-muted)]">{t('profile.gymInfo')}</p>
                </div>
              </div>
              <div className="space-y-3">
                {gymInfo?.address && (
                  <div className="flex items-start gap-3 text-[13px]">
                    <span className="text-[var(--color-text-muted)] w-20 shrink-0 font-medium">{t('profile.address')}</span>
                    <span className="text-[var(--color-text-muted)]">{gymInfo.address}</span>
                  </div>
                )}
                {gymInfo?.phone && (
                  <div className="flex items-start gap-3 text-[13px]">
                    <span className="text-[var(--color-text-muted)] w-20 shrink-0 font-medium">{t('profile.phone')}</span>
                    <span className="text-[var(--color-text-muted)]">{gymInfo.phone}</span>
                  </div>
                )}
                {gymInfo?.email && (
                  <div className="flex items-start gap-3 text-[13px]">
                    <span className="text-[var(--color-text-muted)] w-20 shrink-0 font-medium">{t('profile.email')}</span>
                    <span className="text-[var(--color-text-muted)]">{gymInfo.email}</span>
                  </div>
                )}
                {gymInfo?.opening_hours && (
                  <div className="flex items-start gap-3 text-[13px]">
                    <span className="text-[var(--color-text-muted)] w-20 shrink-0 font-medium">{t('profile.hours')}</span>
                    <span className="text-[var(--color-text-muted)] whitespace-pre-line">{gymInfo.opening_hours}</span>
                  </div>
                )}
                {gymInfo?.website && (
                  <div className="flex items-start gap-3 text-[13px]">
                    <span className="text-[var(--color-text-muted)] w-20 shrink-0 font-medium">{t('profile.website')}</span>
                    <span className="text-[var(--color-text-muted)]">{gymInfo.website}</span>
                  </div>
                )}
                {!gymInfo?.address && !gymInfo?.phone && !gymInfo?.opening_hours && (
                  <p className="text-[13px] text-[var(--color-text-muted)] text-center py-4">{t('profile.noGymInfoYet')}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile;
