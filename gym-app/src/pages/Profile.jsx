import React, { useState, useEffect } from 'react';
import { useCachedState, hasCachedState } from '../hooks/useCachedState';
import { tg } from '../lib/genderText';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Trophy, Dumbbell, Calendar,
  Lock, BarChart2, Star, LogOut, Edit2, Check, Scale, Flame,
  UtensilsCrossed, QrCode, Gift, Settings, ChevronRight, Trash2, AlertTriangle, Heart,
  Camera, X, Loader2, Sprout, Zap, Activity, Sparkles, Building2,
  Target, TrendingUp, UserPlus, Users, Brain, Medal, Gem, Rocket, RotateCw, CalendarCheck, Weight,
  Share2, Copy, Link, Clock, Repeat,
} from 'lucide-react';
import ViewSwitcherModal from '../components/ViewSwitcherModal';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { PROD_WEB_URL } from '../lib/appUrls';
import { validateImageFile } from '../lib/validateImage';
import { stripExif } from '../lib/stripExif';
import logger from '../lib/logger';
import AvatarPicker from '../components/AvatarPicker';
import UserAvatar from '../components/UserAvatar';
import ShareAchievementSheet from '../components/share/ShareAchievementSheet';
import ShareMonthSheet from '../components/share/ShareMonthSheet';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ACHIEVEMENT_DEFS, ACHIEVEMENT_CATEGORIES, fetchAchievementData, awardAchievements, customDefToDisplay } from '../lib/achievements';
import { getRewardTier, getUserPoints } from '../lib/rewardsEngine';
import { getLevel } from '../components/LevelBadge';
import { formatStatNumber, statFontSize } from '../lib/formatStatValue';
import { usePostHog } from '@posthog/react';

// Map achievement icon names → lucide components
const ICON_MAP = {
  Dumbbell, Flame, Zap, Star, Trophy, CalendarCheck, RotateCw, Rocket,
  Target, TrendingUp, UserPlus, Users, Brain, Medal, Weight, Gem,
  Shield: Lock, Crown: Trophy, Mountain: Activity, Award: Star, Heart, Megaphone: Sparkles, Swords: Zap, MapPin: QrCode, Apple: UtensilsCrossed,
};
const AchievementIcon = ({ name, size = 24, color }) => {
  const Icon = ICON_MAP[name];
  if (Icon) return <Icon size={size} style={{ color }} strokeWidth={2} />;
  // Gym-authored achievement_definitions store an emoji rather than a lucide
  // name — render it as text instead of falling back to the dumbbell.
  if (name && !/^[A-Za-z][A-Za-z0-9_ ]*$/.test(name)) {
    return <span style={{ fontSize: size, lineHeight: 1, userSelect: 'none' }}>{name}</span>;
  }
  return <Dumbbell size={size} style={{ color }} strokeWidth={2} />;
};

// Keys owned by the hardcoded engine — used to keep the summary-bar totals
// honest now that user_achievements also holds custom_<id> keys.
const HARDCODED_ACHIEVEMENT_KEYS = new Set(ACHIEVEMENT_DEFS.map(d => d.key));

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

const DISPLAY_FONT = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';

// ── Helpers ───────────────────────────────────────────────────────────────────

const buildWeeklyChart = (sessions, locale = 'en') => {
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

    const label = weekStart.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    return { week: label, volume: Math.round(volume) };
  });
};

// supabase-js never throws on network loss — it resolves { error } whose
// message is then "TypeError: Load failed". Raw DB/PostgREST messages must
// never render to members (same classification as Onboarding handleFinish):
// a PG/PostgREST error.code means the server rejected the write; anything
// code-less is connection trouble.
const isServerReject = (err) => {
  const code = String(err?.code || '').trim();
  if (/^[0-9A-Z]{5}$/.test(code) || /^PGRST/i.test(code)) return true;
  // Storage/edge errors carry an HTTP status instead of a PG code.
  const status = Number(err?.status ?? err?.statusCode);
  return Number.isFinite(status) && status >= 400;
};

const MUSCLE_COLORS = {
  Chest: '#EF4444', Back: '#3B82F6', Legs: '#10B981', Shoulders: '#F59E0B',
  Biceps: '#F59E0B', Triceps: '#F97316', Core: '#60A5FA', Glutes: '#A78BFA',
  Hamstrings: '#34D399', Quads: '#6EE7B7', Calves: '#FCD34D',
};

// ACHIEVEMENT_DEFS and ACHIEVEMENT_CATEGORIES are imported from ../lib/achievements

// ── Hero stat block ───────────────────────────────────────────────────────────
// Profile A style: large colored numeral (tabular nums), small uppercase label,
// vertical divider between cells (borderLeft via parent index).
const HeroStat = ({ label, value, sub, color, isFirst }) => {
  const display = typeof value === 'number' ? formatStatNumber(value) : value;
  const fontSize = statFontSize(display, 'text-[22px]');
  const valueColor = color || 'var(--color-accent)';
  return (
    <div
      className="flex flex-col items-center justify-center text-center px-1 min-w-0 overflow-hidden"
      style={{
        borderLeft: isFirst ? 'none' : '1px solid var(--color-border-subtle)',
      }}
    >
      <p
        className={`${fontSize} font-black leading-none flex items-baseline justify-center gap-0.5 truncate max-w-full`}
        style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '-0.6px', fontVariantNumeric: 'tabular-nums', color: valueColor }}
      >
        {display}
      </p>
      {sub && (
        <p className="text-[9px] font-bold mt-0.5 text-[var(--color-text-muted)] uppercase tracking-wider truncate max-w-full">{sub}</p>
      )}
      <p className="text-[10px] font-bold mt-1.5 text-[var(--color-text-muted)] uppercase tracking-[0.05em] truncate max-w-full">{label}</p>
    </div>
  );
};

// ── Achievement card ──────────────────────────────────────────────────────────
// Shared by the hardcoded categories and the gym-authored (custom) section —
// `a` is an ACHIEVEMENT_DEFS entry or a customDefToDisplay() result, `stats`
// feeds the progress bar (fetchAchievementData shape).
const AchievementCard = ({ a, earned, earnedAt, stats, onShare, t, i18n }) => {
  // Progress calculation
  let progressValue = 0;
  let progressTarget = 1;
  let progressPct = earned ? 100 : 0;
  if (!earned && a.progressOf && stats) {
    progressValue = Math.min(
      stats[a.progressOf.key] ?? 0,
      a.progressOf.target
    );
    progressTarget = a.progressOf.target;
    progressPct = Math.min((progressValue / progressTarget) * 100, 100);
  }

  return (
    <div
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
        <AchievementIcon name={a.icon} size={24} color={earned ? a.color : 'var(--color-text-subtle)'} />
        {!earned && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-[13px]"
            style={{ background: 'color-mix(in srgb, var(--color-bg-primary) 55%, transparent)' }}
          >
            <Lock size={14} style={{ color: 'var(--color-text-subtle)' }} />
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
            {tg(t, a.labelKey, { defaultValue: a.label })}
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
                ? `${formatStatNumber(Math.round(progressValue))} / ${formatStatNumber(progressTarget)} lbs`
                : `${progressValue} / ${progressTarget}`}
            </p>
          </div>
        )}

        {/* Earned date */}
        {earned && earnedAt && (
          <p className="text-[11px] mt-1" style={{ color: `${a.color}99` }}>
            {t('profile.earned')} {new Date(earnedAt).toLocaleDateString(i18n.language || 'en', {
              month: 'short', day: 'numeric', year: 'numeric',
            })}
          </p>
        )}
      </div>

      {/* Share button (earned only) */}
      {earned && (
        <button
          type="button"
          aria-label={t('profile.share', 'Share')}
          onClick={(e) => {
            e.stopPropagation();
            onShare({
              key: a.key,
              label: tg(t, a.labelKey, { defaultValue: a.label }),
              description: t(a.descKey, a.desc),
              icon: a.icon,
              color: a.color,
              unlockedAt: earnedAt,
            });
          }}
          className="flex-shrink-0 flex items-center justify-center rounded-full transition-colors"
          style={{
            width: 36,
            height: 36,
            background: `${a.color}18`,
            border: `1px solid ${a.color}40`,
            color: a.color,
          }}
        >
          <Share2 size={16} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
const Profile = () => {
  const { t, i18n } = useTranslation('pages');
  const { user, profile, signOut, deleteAccount, refreshProfile, patchProfile, lifetimePoints: ctxLifetimePoints, gymConfig, availableRoles, gymLogoUrl } = useAuth();
  const hasMultipleViews = Array.isArray(availableRoles) && availableRoles.length > 1;
  const [showViewSwitcher, setShowViewSwitcher] = useState(false);
  const { showToast } = useToast();
  const navigate = useNavigate();
  const posthog = usePostHog();
  const [activeTab, setActiveTab] = useState('activity');

  useEffect(() => {
    const prev = document.title;
    document.title = `${t('profile.title', 'Profile')} | ${window.__APP_NAME || 'TuGymPR'}`;
    return () => { document.title = prev; };
  }, [t]);

  // Data state — useCachedState survives unmount so back-nav is instant
  const cacheKey = `profile-${user?.id}`;
  const hasCached = hasCachedState(`${cacheKey}-sessions`);
  const [gymName, setGymName]                         = useCachedState(`${cacheKey}-gymName`, '');
  const [sessions, setSessions]                       = useCachedState(`${cacheKey}-sessions`, []);
  const [prs, setPrs]                                 = useCachedState(`${cacheKey}-prs`, []);
  const [muscleBalance, setMuscleBalance]             = useCachedState(`${cacheKey}-muscle`, []);
  const [weeklyChart, setWeeklyChart]                 = useCachedState(`${cacheKey}-weekly`, []);
  const [loading, setLoading]                         = useState(!hasCached);
  const [unlockedAchievementIds, setUnlockedAchievementIds] = useCachedState(`${cacheKey}-unlocked`, new Set());
  // Map of achievement_key -> earned_at (ISO string) for earned ones
  const [earnedAchievements, setEarnedAchievements]   = useCachedState(`${cacheKey}-earned`, {});
  // Live achievement data for progress bars
  const [achievementStats, setAchievementStats]       = useCachedState(`${cacheKey}-achStats`, null);
  // Gym-authored achievement_definitions (gym + global), display shape
  const [customDefs, setCustomDefs]                   = useCachedState(`${cacheKey}-customDefs`, []);

  // Level / points
  const [userPoints, setUserPoints] = useState(ctxLifetimePoints ?? 0);
  useEffect(() => { if (ctxLifetimePoints != null) setUserPoints(ctxLifetimePoints); }, [ctxLifetimePoints]);
  const [gymInfo, setGymInfo] = useCachedState(`${cacheKey}-gymInfo`, null);

  // Goals state
  const [onboarding, setOnboarding]     = useCachedState(`${cacheKey}-onboarding`, null);
  const [editingGoals, setEditingGoals] = useState(false);
  const [goalsDraft, setGoalsDraft]     = useState(null);
  const [savingGoals, setSavingGoals]   = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [shareAchievement, setShareAchievement]   = useState(null);
  // Monthly recap share — drives the "Share month" pill under the lifetime
  // stats strip. We assemble the data inline from the same `sessions` /
  // `prs` arrays that feed the strip above, so the share matches what the
  // user sees on screen.
  const [monthlyShareOpen, setMonthlyShareOpen] = useState(false);
  // True lifetime totals for the stats strip. The sessions/prs arrays above
  // are capped at 50 rows (chart + lists only) — counting them would freeze
  // the strip at "50" forever.
  const [lifetimeStats, setLifetimeStats]         = useCachedState(`${cacheKey}-lifetimeStats`, null);
  const [showGymInfo, setShowGymInfo] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Activity pagination
  const [visibleActivity, setVisibleActivity] = useState(10);

  // Friend code & referral state
  const [friendCode, setFriendCode] = useState(profile?.friend_code ?? null);
  const [friendLinkCopied, setFriendLinkCopied] = useState(false);
  const [referralCount, setReferralCount] = useState(0);

  // Avatar upload state
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  // avatarInputRef removed — AvatarPicker handles its own file input

  // Name / username editing state
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [identityDraft, setIdentityDraft] = useState({ full_name: '', username: '', phone_number: '' });
  const [countryCode, setCountryCode] = useState('+1');
  const [savingIdentity, setSavingIdentity] = useState(false);

  // Lock body scroll while Gym Info modal is open
  useEffect(() => {
    if (!showGymInfo) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [showGymInfo]);

  // Declared before the load effect because that effect lists refreshKey in
  // its deps (const is not hoisted — referencing it earlier would TDZ-throw).
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    if (!user || !profile) return;

    const load = async () => {
      // Only show the skeleton on a genuine first-ever visit. If we have a
      // persisted cache (survives unmount + app restart), paint from it and
      // revalidate silently in the background.
      if (!hasCached) setLoading(true);

      try {
      // 1. Gym info + user points in parallel (independent queries)
      const [{ data: gym }, ptsData] = await Promise.all([
        supabase.from('gyms').select('id, name, slug, is_active').eq('id', profile.gym_id).single(),
        getUserPoints(user.id),
      ]);
      setGymName(gym?.name ?? '');
      setGymInfo(gym ?? null);
      setUserPoints(ptsData.lifetime_points || 0);

      // Friend code: check if profile has one, generate if not
      if (profile?.friend_code) {
        setFriendCode(profile.friend_code);
      } else if (!friendCode) {
        // Only generate once — guard against re-renders
        const arr = new Uint8Array(5);
        crypto.getRandomValues(arr);
        const code = Array.from(arr, b => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
        const { error: fcErr } = await supabase
          .from('profiles')
          .update({ friend_code: code })
          .eq('id', user.id);
        if (!fcErr) {
          setFriendCode(code);
        }
      }

      // Referral count (table may not exist yet if migrations haven't run)
      try {
        const { count: refCount } = await supabase
          .from('referrals')
          .select('id', { count: 'exact', head: true })
          .eq('referrer_id', user.id);
        setReferralCount(refCount ?? 0);
      } catch { setReferralCount(0); }

      // 2. Recent completed sessions (capped for performance)
      const { data: sessionData } = await supabase
        .from('workout_sessions')
        .select('id, name, completed_at, total_volume_lbs, duration_seconds')
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(50);

      const allSessions = sessionData ?? [];
      setSessions(allSessions);
      setWeeklyChart(buildWeeklyChart(allSessions, i18n.language || 'en'));

      // 3. Personal records — ordered by achieved_at DESC so the most recent PRs
      // are always in the first 50 rows. The monthly share card filters by date,
      // so any month-PRs that don't rank in the top-50 by 1RM would otherwise
      // be silently excluded from the share card count.
      const { data: prData } = await supabase
        .from('personal_records')
        .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name, muscle_group)')
        .eq('profile_id', user.id)
        .order('achieved_at', { ascending: false })
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

      // 5. Onboarding / goals — trainers/admins won't have a member_onboarding
      // row; .single() throws PGRST 406 in that case, .maybeSingle() returns null.
      const { data: ob } = await supabase
        .from('member_onboarding')
        .select('fitness_level, primary_goal, training_days_per_week, available_equipment, injuries_notes')
        .eq('profile_id', user.id)
        .maybeSingle();
      setOnboarding(ob ?? null);

      // 5b. Lifetime totals for the stats strip. head:true count queries
      // transfer zero rows; volume has no count shortcut and no lifetime RPC
      // exists (get_dashboard_data only returns the last 50 sessions), so we
      // pull just the total_volume_lbs column — capped at the 2000 most
      // recent sessions — and sum client-side.
      const [
        { count: workoutCount },
        { count: prCount },
        { count: checkInCount },
        { data: volRows },
      ] = await Promise.all([
        supabase.from('workout_sessions').select('id', { count: 'exact', head: true })
          .eq('profile_id', user.id).eq('status', 'completed'),
        supabase.from('personal_records').select('id', { count: 'exact', head: true })
          .eq('profile_id', user.id),
        supabase.from('check_ins').select('id', { count: 'exact', head: true })
          .eq('profile_id', user.id),
        supabase.from('workout_sessions').select('total_volume_lbs')
          .eq('profile_id', user.id).eq('status', 'completed')
          .order('completed_at', { ascending: false }).limit(2000),
      ]);
      // null = query failed → render falls back to the capped-array numbers.
      setLifetimeStats({
        workouts: workoutCount ?? null,
        prs: prCount ?? null,
        checkIns: checkInCount ?? null,
        volumeLbs: volRows
          ? volRows.reduce((sum, r) => sum + (parseFloat(r.total_volume_lbs) || 0), 0)
          : null,
      });

      // 6. Award any missing achievements, then load earned + stats
      await awardAchievements(user.id, profile.gym_id, supabase);

      const [{ data: dbUnlocked }, achStats, { data: customRows }] = await Promise.all([
        supabase
          .from('user_achievements')
          .select('achievement_key, earned_at')
          .eq('user_id', user.id)
          .eq('gym_id', profile.gym_id),
        fetchAchievementData(user.id, profile.gym_id, supabase),
        supabase
          .from('achievement_definitions')
          .select('id, gym_id, name, description, icon, category, criteria, key')
          .or(`gym_id.eq.${profile.gym_id},gym_id.is.null`)
          .order('sort_order', { ascending: true }),
      ]);

      const earnedMap = {};
      (dbUnlocked ?? []).forEach(row => {
        earnedMap[row.achievement_key] = row.earned_at;
      });
      setEarnedAchievements(earnedMap);
      setAchievementStats(achStats);
      // Rows with a `key` mirror hardcoded ACHIEVEMENT_DEFS entries (0019
      // seeds) — those already render in the hardcoded categories above.
      setCustomDefs((customRows ?? []).filter(r => !r.key).map(customDefToDisplay));
      setUnlockedAchievementIds(new Set(Object.keys(earnedMap)));
      } catch {
        // One rejected query must not strand the section skeletons forever.
      } finally {
        setLoading(false);
      }
    };

    load();
    // refreshKey re-runs the load: Profile is keep-alive, so after the member
    // completes a workout (stats/PRs/points/volume all change) the mounted page
    // would otherwise show pre-workout numbers until a full remount.
  }, [user, profile, refreshKey]);

  // Bump refreshKey on foreground + workout-changed to revalidate silently
  // (hasCached → no skeleton flash on the re-run).
  useEffect(() => {
    if (!user) return undefined;
    const bump = () => setRefreshKey(k => k + 1);
    const onVis = () => { if (document.visibilityState === 'visible') bump(); };
    window.addEventListener('tugympr:workouts-changed', bump);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('tugympr:workouts-changed', bump);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const { level, xpIntoLevel, xpForNext, progress: levelProgress } = getLevel(userPoints);
  const tier = getRewardTier(userPoints);
  // Lifetime numbers from the dedicated stat queries; fall back to the capped
  // 50-row arrays only while they haven't loaded yet (or a query failed).
  const totalVolume = lifetimeStats?.volumeLbs
    ?? sessions.reduce((sum, s) => sum + (parseFloat(s.total_volume_lbs) || 0), 0);
  const volumeStr   = formatStatNumber(Math.round(totalVolume));

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

  // Achievements summary — count only keys we actually display (hardcoded +
  // currently-existing custom defs) so the totals can't drift past 100% now
  // that user_achievements also holds custom_<id> keys.
  const customKeySet = new Set(customDefs.map(d => d.key));
  const totalAchievementCount = ACHIEVEMENT_DEFS.length + customDefs.length;
  const earnedAchievementCount = Object.keys(earnedAchievements)
    .filter(k => HARDCODED_ACHIEVEMENT_KEYS.has(k) || customKeySet.has(k)).length;
  // The `checkins` criteria stat isn't part of fetchAchievementData — splice
  // in the lifetime check-in count Profile already fetches for the stats strip.
  const customAchievementStats = achievementStats
    ? { ...achievementStats, totalCheckins: lifetimeStats?.checkIns ?? 0 }
    : null;

  // Short, member-safe reason for "Failed to …: {{message}}" toast templates.
  // The raw error stays in the console (logger) only.
  const friendlyReason = (err) => (isServerReject(err)
    ? t('toasts.reasonTryAgain', 'please try again')
    : t('toasts.reasonNoConnection', 'no connection'));

  // ── Save goals ──────────────────────────────────────────────────────────────
  const saveGoals = async () => {
    setSavingGoals(true);
    try {
      const { injury_areas, preferred_training_days, ...dbFields } = goalsDraft;
      const injuries_notes = (injury_areas ?? []).length > 0
        ? injury_areas.join(', ')
        : null;
      // Run both writes in parallel to reduce window where the two stores can
      // disagree (the streak protection logic reads from profiles).
      const [{ error }, { error: profileErr }] = await Promise.all([
        supabase
          .from('member_onboarding')
          .upsert({ profile_id: user.id, gym_id: profile.gym_id, ...dbFields, injuries_notes }),
        supabase
          .from('profiles')
          .update({ preferred_training_days: preferred_training_days || [] })
          .eq('id', user.id),
      ]);
      if (error || profileErr) {
        logger.error('saveGoals error:', error || profileErr);
        showToast(t('toasts.failedToSave', { message: friendlyReason(error || profileErr) }), 'error');
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
      // deleteAccount re-wraps the RPC error (code stripped), so sniff the
      // message for network markers; never surface the raw DB text.
      logger.error('Delete account error:', err);
      const offline = !navigator.onLine || /load failed|failed to fetch|network/i.test(String(err?.message || ''));
      showToast(offline
        ? t('progress.body.connectionError', 'No connection — try again when you’re back online.')
        : t('toasts.failedToDeleteAccount'), 'error');
      setDeleting(false);
    }
  };

  // ── Avatar save (from AvatarPicker) ──────────────────────────────────────
  const handleAvatarSave = async ({ type, value, file }) => {
    setUploadingAvatar(true);
    try {
      if (type === 'photo' && file) {
        // Validate file type via magic bytes (not just MIME which can be spoofed)
        const validation = await validateImageFile(file);
        if (!validation.valid) {
          // Map raw English error strings from validateImageFile to translated messages.
          const toastMsg = (() => {
            const e = validation.error || '';
            if (e.startsWith('Image must be under')) return t('validateImage.tooLarge', { defaultValue: `Image must be under 5 MB` });
            if (e.startsWith('Invalid WebP')) return t('validateImage.invalidWebp', { defaultValue: 'Invalid WebP file' });
            if (e.startsWith('Image dimensions')) return t('validateImage.tooBig', { defaultValue: 'Image dimensions must not exceed 4096×4096 pixels' });
            return t('validateImage.invalidType', { defaultValue: 'Invalid image file. Only PNG, JPEG, and WebP are allowed' });
          })();
          showToast(toastMsg, 'error');
          setUploadingAvatar(false);
          return;
        }

        // Strip EXIF metadata (GPS, device info) AND downscale before uploading.
        // Avatars never render larger than ~96px, but the default stripExif keeps
        // up to 2048px — a multi-MB image then re-downloaded everywhere it appears
        // (feed, leaderboard, member lists). 256px @ q0.85 is plenty for a retina
        // avatar and slashes transfer/decode cost across the app.
        const cleanFile = await stripExif(file, { maxDimension: 256, quality: 0.85 });
        const path = `${user.id}/${Date.now()}.jpg`;

        const { error: storageErr } = await supabase.storage
          .from('avatars')
          .upload(path, cleanFile, { upsert: true, contentType: 'image/jpeg' });
        if (storageErr) throw storageErr;

        const { data: urlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(path);

        const { error: updateErr } = await supabase
          .from('profiles')
          .update({ avatar_url: urlData.publicUrl, avatar_type: 'photo', avatar_value: null })
          .eq('id', user.id);
        if (updateErr) throw updateErr;

        // Optimistic local update so avatar renders instantly
        patchProfile({ avatar_url: urlData.publicUrl, avatar_type: 'photo', avatar_value: null });
      } else {
        // Color or design — just update type + value
        const { error: updateErr } = await supabase
          .from('profiles')
          .update({ avatar_type: type, avatar_value: value })
          .eq('id', user.id);
        if (updateErr) throw updateErr;

        // Optimistic local update so avatar renders instantly
        patchProfile({ avatar_type: type, avatar_value: value });
      }

      setAvatarPickerOpen(false);
      posthog?.capture('avatar_changed', { type });
      showToast(t('toasts.avatarUpdated'), 'success');
      // Also refresh from DB to ensure full consistency
      refreshProfile();
    } catch (err) {
      logger.error('Avatar upload error:', err);
      showToast(t('toasts.failedToUploadAvatar', { message: friendlyReason(err) }), 'error');
    } finally {
      setUploadingAvatar(false);
    }
  };

  // Legacy file-input handler removed — AvatarPicker handles photo uploads directly

  // ── Save name / username ──────────────────────────────────────────────────
  const saveIdentity = async () => {
    const trimmedName = identityDraft.full_name.trim();

    if (!trimmedName) {
      showToast(t('profile.nameEmpty'), 'error');
      return;
    }

    setSavingIdentity(true);
    try {
      const updatePayload = { full_name: trimmedName };
      // Normalize whatever the user typed using their chosen country code.
      // Strip non-digits from both the country code and local number, then
      // concatenate as +<cc><local>.
      const phoneRaw = identityDraft.phone_number?.trim() || '';
      let phone = null;
      if (phoneRaw) {
        const cc = (countryCode || '+1').trim();
        const ccDigits = cc.replace(/\D/g, '');
        const localDigits = phoneRaw.replace(/\D/g, '');
        if (!ccDigits) {
          showToast(t('profile.phoneInvalid', 'Phone number is invalid'), 'error');
          setSavingIdentity(false);
          return;
        }
        if (localDigits.length < 7) {
          showToast(t('profile.phoneInvalid', 'Phone number is invalid'), 'error');
          setSavingIdentity(false);
          return;
        }
        phone = '+' + ccDigits + localDigits;
      }
      updatePayload.phone_number = phone;

      const { error } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', user.id);
      if (error) {
        if (error.message?.includes('unique') || error.code === '23505') {
          showToast(t('profile.usernameTaken'), 'error');
        } else {
          logger.error('saveIdentity error:', error);
          showToast(t('profile.saveFailed') + ': ' + friendlyReason(error), 'error');
        }
        return;
      }
      refreshProfile();
      setEditingIdentity(false);
      showToast(t('profile.saved'), 'success');
    } catch (err) {
      logger.error('saveIdentity error:', err);
      showToast(t('profile.saveFailed') + ': ' + friendlyReason(err), 'error');
    } finally {
      setSavingIdentity(false);
    }
  };

  // ── Share friend link ──────────────────────────────────────────────────────
  const friendLink = friendCode ? `${PROD_WEB_URL}/add-friend/${friendCode}` : '';

  const handleShareFriendLink = async () => {
    if (!friendLink) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: t('profile.shareFriendLink'),
          text: t('profile.shareFriendLink'),
          url: friendLink,
        });
      } else {
        await navigator.clipboard.writeText(friendLink);
        setFriendLinkCopied(true);
        showToast(t('profile.friendCodeCopied'), 'success');
        setTimeout(() => setFriendLinkCopied(false), 2000);
      }
    } catch {
      // user cancelled share sheet
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] pb-28 md:pb-12">
      <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 lg:px-8 pt-6 pb-8">

      {/* ── Profile header card ──────────────────────────────────────────── */}
      <div className="rounded-[22px] bg-[var(--color-bg-card)] mb-4 overflow-hidden p-[18px]" style={{ boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }} data-tour="tour-profile-page">

        {/* Identity row — Profile A: avatar (w/ floating level badge) + name/pills + action */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0 flex-1">
            {/* Avatar with floating level badge */}
            <button
              type="button"
              onClick={() => setAvatarPickerOpen(true)}
              disabled={uploadingAvatar}
              className="relative flex-shrink-0 group focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none rounded-[22px]"
              aria-label={t('profile.changeAvatar', 'Change avatar')}
            >
              <UserAvatar
                user={profile}
                size={72}
                rounded="2xl"
                style={{ boxShadow: '0 6px 18px color-mix(in srgb, var(--color-accent) 22%, transparent)' }}
              />
              {/* Level badge — metallic silver/gold chip floating top-right */}
              <div
                className="absolute -top-1 -right-1 rounded-full flex items-center justify-center"
                style={{
                  width: 26, height: 26,
                  background: `linear-gradient(180deg, ${tier.color}33 0%, ${tier.color}66 100%)`,
                  color: tier.color,
                  fontSize: 11, fontWeight: 900, letterSpacing: '-0.5px',
                  border: '3px solid var(--color-bg-card)',
                  fontFamily: DISPLAY_FONT,
                }}
                aria-label={`${t('profile.level')} ${level}`}
              >
                {level}
              </div>
              {uploadingAvatar && (
                <div className="absolute inset-0 rounded-[22px] bg-black/40 flex items-center justify-center pointer-events-none">
                  <Loader2 size={18} className="text-white animate-spin" />
                </div>
              )}
            </button>

            {/* Name / username — view or edit */}
            {editingIdentity ? (
              <div className="flex flex-col gap-2 min-w-0 flex-1">
                <input
                  id="profile-full-name"
                  type="text"
                  value={identityDraft.full_name}
                  onChange={e => setIdentityDraft(d => ({ ...d, full_name: e.target.value }))}
                  placeholder={t('profile.fullName', 'Full name')}
                  aria-label={t('profile.fullName', 'Full name')}
                  maxLength={80}
                  className="w-full bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-lg px-2.5 py-1.5 text-[14px] font-bold text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
                <p className="text-[12px] text-[var(--color-text-muted)]">@{profile?.username}</p>
                {/* Phone — one grouped field: a fixed "+1" country-code segment on the
                    left, then the full number filling the rest of the row. */}
                <div className="flex items-stretch w-full rounded-lg overflow-hidden border border-[var(--color-border-subtle)] focus-within:ring-2 focus-within:ring-[var(--color-accent)]">
                  <input
                    type="tel"
                    inputMode="tel"
                    value={countryCode}
                    onChange={e => setCountryCode(e.target.value.replace(/[^+\d]/g, '').slice(0, 4))}
                    placeholder="+1"
                    aria-label={t('profile.countryCode', 'Country code')}
                    className="w-12 flex-shrink-0 bg-[var(--color-bg-elevated)] px-2 py-1.5 text-[14px] font-bold text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none text-center"
                  />
                  <span aria-hidden className="w-px self-stretch bg-[var(--color-border-subtle)]" />
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={identityDraft.phone_number}
                    onChange={e => setIdentityDraft(d => ({ ...d, phone_number: e.target.value }))}
                    placeholder="787 555 1234"
                    aria-label={t('profile.phoneNumber', 'Phone number')}
                    maxLength={20}
                    className="flex-1 min-w-0 bg-[var(--color-bg-input)] px-2.5 py-1.5 text-[14px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <button
                    type="button"
                    onClick={saveIdentity}
                    disabled={savingIdentity}
                    style={{ borderColor: 'color-mix(in srgb, var(--color-accent) 65%, #000)' }}
                    className="flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-bold bg-[var(--color-accent)] text-[var(--color-text-on-accent,#000)] border shadow-sm disabled:opacity-50 active:scale-95 transition-transform"
                  >
                    {savingIdentity ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} strokeWidth={2.5} />}
                    {t('profile.save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingIdentity(false)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-elevated)] transition-colors duration-200"
                  >
                    <X size={12} /> {t('profile.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="min-w-0 flex-1">
                <h1 className="text-[22px] leading-[1.1] truncate text-[var(--color-text-primary)]" style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '-0.5px' }}>
                  {loading ? '—' : profile?.full_name}
                </h1>
                {profile?.username && (
                  <p className="text-[12px] mt-0.5 text-[var(--color-text-muted)]">@{profile.username}</p>
                )}
                {/* Gym pill + tier chip row (Profile A) */}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {gymName && (
                    <span
                      className="inline-flex items-center gap-1 px-2.5 py-[3px] rounded-full text-[11px] font-extrabold whitespace-nowrap max-w-full"
                      style={{
                        background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
                        color: 'var(--color-accent)',
                        letterSpacing: '0.2px',
                      }}
                    >
                      <Dumbbell size={11} strokeWidth={2.4} className="flex-shrink-0" />
                      <span className="truncate">{gymName}</span>
                    </span>
                  )}
                  <span
                    className="inline-flex items-center px-2 py-[3px] rounded-full text-[10px] font-black uppercase whitespace-nowrap"
                    style={{
                      background: `linear-gradient(180deg, ${tier.color}22 0%, ${tier.color}55 100%)`,
                      color: tier.color,
                      letterSpacing: '0.6px',
                    }}
                  >
                    {t(`rewards.tiers.${tier.nameKey}`, tier.name)} · {t('profile.level')} {level}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={() => {
                // Parse existing phone into country code + local digits so the
                // user can edit either piece independently. "+17875551234" →
                // cc="+1", local="7875551234". Falls back to "+1" if nothing parses.
                const existing = profile?.phone_number ?? '';
                let parsedCc = '+1';
                let parsedLocal = existing;
                if (existing.startsWith('+')) {
                  const m = existing.match(/^(\+\d{1,3})(\d+)$/);
                  if (m) {
                    parsedCc = m[1];
                    parsedLocal = m[2];
                  }
                }
                setCountryCode(parsedCc);
                setIdentityDraft({
                  full_name: profile?.full_name ?? '',
                  username: profile?.username ?? '',
                  phone_number: parsedLocal,
                });
                setEditingIdentity(true);
              }}
              className="w-[34px] h-[34px] flex items-center justify-center rounded-[10px] transition-colors hover:opacity-80 active:scale-95 bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
              aria-label={t('profile.editNameUsername', 'Edit name & username')}
            >
              <Edit2 size={15} />
            </button>
            {hasMultipleViews && (
              <button
                type="button"
                onClick={() => setShowViewSwitcher(true)}
                className="w-[34px] h-[34px] flex items-center justify-center rounded-[10px] transition-colors hover:opacity-80 active:scale-95 bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                aria-label={t('common:viewSwitcher.title', 'Switch view')}
                title={t('common:viewSwitcher.title', 'Switch view')}
              >
                <Repeat size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="w-[34px] h-[34px] flex items-center justify-center rounded-[10px] transition-colors hover:opacity-80 active:scale-95 bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
              aria-label={t('profile.settings', 'Settings')}
            >
              <Settings size={15} />
            </button>
            <button
              type="button"
              onClick={signOut}
              className="w-[34px] h-[34px] flex items-center justify-center rounded-[10px] transition-colors hover:opacity-80 active:scale-95 bg-red-500/10 text-red-400 focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
              aria-label={t('profile.logOut', 'Log out')}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>

        {/* XP bar — Profile A: progress to next level with accent→warning gradient */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-[10px] font-black mb-1.5" style={{ letterSpacing: '0.6px' }}>
            <span className="text-[var(--color-text-muted)]">
              {t('profile.level')} {level} · {xpIntoLevel}/{xpForNext} XP
            </span>
            {joinDate && (
              <span className="text-[var(--color-text-muted)] flex items-center gap-1 normal-case font-semibold" style={{ letterSpacing: 0 }}>
                <Calendar size={10} /> {t('profile.memberSince')} {joinDate}
              </span>
            )}
          </div>
          <div className="h-[6px] rounded-full overflow-hidden bg-[var(--color-bg-elevated)]">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.max(4, Math.min(100, levelProgress ?? 0))}%`,
                background: 'linear-gradient(90deg, var(--color-accent) 0%, var(--color-warning) 100%)',
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Lifetime stats strip (Profile A): colored values, dividers ─────── */}
      <div className="rounded-[22px] bg-[var(--color-bg-card)] mb-4 p-4 grid grid-cols-4 gap-2" style={{ boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
        <HeroStat isFirst label={t('profile.workouts')} value={loading ? '—' : (lifetimeStats?.workouts ?? sessions.length)} color="var(--color-accent)" />
        <HeroStat label={t('profile.checkIns')} value={loading ? '—' : (lifetimeStats?.checkIns ?? 0)} color="#6D5FDB" />
        <HeroStat label={t('profile.volume')} value={loading ? '—' : volumeStr} sub={t('common:lbs')} color="var(--color-accent)" />
        <HeroStat label={t('profile.records')} value={loading ? '—' : (lifetimeStats?.prs ?? prs.length)} color="#FF5A2E" />
      </div>

      {/* Share-month pill — produces a recap card with the current month's
          workouts / volume / PRs / streak. Hidden while loading so the
          captured numbers always match what the stats strip just rendered. */}
      {!loading && sessions.length > 0 && (
        <button
          type="button"
          onClick={() => setMonthlyShareOpen(true)}
          className="w-full flex items-center justify-center gap-2 mb-4 py-2.5 rounded-[14px] active:scale-[0.98] transition-transform"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))',
            color: 'var(--color-text-primary)',
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          <Share2 size={14} />
          {t('profile.shareMonth', { defaultValue: 'Share this month' })}
        </button>
      )}

      {/* ── Referral banner (Profile A gradient pill) ────────────────────── */}
      <button
        type="button"
        onClick={() => navigate('/referrals')}
        className="w-full flex items-center gap-3 px-4 py-3.5 mb-4 rounded-[18px] transition-all duration-200 active:scale-[0.98]"
        style={{
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 14%, transparent) 0%, color-mix(in srgb, #6D5FDB 14%, transparent) 120%)',
        }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-bg-card)' }}
        >
          <Gift size={18} className="text-[var(--color-accent)]" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-[13px] font-extrabold text-[var(--color-text-primary)]" style={{ letterSpacing: '-0.2px' }}>
            {t('profile.referralProgram')}
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
            {t('profile.friendsReferred', { count: referralCount })}
          </p>
        </div>
        <ChevronRight size={16} className="flex-shrink-0 text-[var(--color-text-muted)]" />
      </button>

      {/* ── Quick-access cards (Profile A) ──────────────────────────────── */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2.5 mb-5 stagger-fade-in">
        {[
          { to: '/checkin',   icon: QrCode,    label: t('profile.checkIn'),     color: 'var(--color-accent)' },
          { to: '/my-gym',    icon: Building2, label: t('profile.myGym'),       color: '#6D5FDB' },
          { to: '/referrals', icon: UserPlus,  label: t('profile.inviteToGym'), color: '#FF5A2E' },
        ].map(item => (
          <button
            key={item.label}
            type="button"
            onClick={() => navigate(item.to)}
            className="flex flex-col items-center justify-center gap-2 py-3.5 rounded-[18px] bg-[var(--color-bg-card)] transition-all duration-150 active:scale-[0.97] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
            style={{ boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 6px 18px rgba(15,20,25,0.04)' }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: `color-mix(in srgb, ${item.color} 18%, transparent)` }}
            >
              <item.icon size={18} style={{ color: item.color }} strokeWidth={2.2} />
            </div>
            <span className="text-[12px] font-bold text-[var(--color-text-primary)] text-center leading-tight" style={{ letterSpacing: '-0.1px' }}>{item.label}</span>
          </button>
        ))}
      </div>

      {/* ── Mis Clases card (only if gym has classes enabled) ────────────── */}
      {gymConfig?.classesEnabled && (
        <button
          type="button"
          onClick={() => navigate('/classes')}
          className="w-full flex items-center gap-4 p-4 mb-4 rounded-2xl border border-[#60A5FA]/25 bg-gradient-to-r from-[#60A5FA]/10 to-[#60A5FA]/5 hover:from-[#60A5FA]/15 hover:to-[#60A5FA]/8 transition-all duration-200 active:scale-[0.98]"
        >
          <div className="w-11 h-11 rounded-xl bg-[#60A5FA]/15 flex items-center justify-center flex-shrink-0">
            <CalendarCheck size={20} className="text-[#60A5FA]" />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-[14px] font-bold text-[#60A5FA]">{t('profile.myClasses')}</p>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
              {t('profile.myClassesSubtitle')}
            </p>
          </div>
          <ChevronRight size={18} className="text-[#60A5FA]/60 flex-shrink-0" />
        </button>
      )}

      {/* ── Underline tabs (Profile A) ──────────────────────────────────── */}
      <div
        className="flex mb-5"
        style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
      >
        {[
          { key: 'activity',     label: t('profile.recentActivity') },
          { key: 'achievements', label: t('profile.achievements') },
          { key: 'goals',        label: t('profile.goals') },
        ].map(tab => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className="flex-1 text-center relative py-3 text-[13px] focus:outline-none"
              style={{
                fontFamily: DISPLAY_FONT,
                fontWeight: active ? 800 : 600,
                color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                letterSpacing: '-0.1px',
              }}
            >
              {tab.label}
              {active && (
                <span
                  className="absolute left-5 right-5 rounded-full"
                  style={{ bottom: -1, height: 2, background: 'var(--color-accent)' }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Activity Tab ────────────────────────────────────────────────── */}
      {activeTab === 'activity' && (
        <div className="flex flex-col gap-3 animate-fade-in">
          {loading ? (
            <div className="flex flex-col gap-3" aria-busy={true} aria-label={t('profile.loadingActivity', 'Loading activity')}>
              {[1, 2, 3].map(i => (
                <div key={i} className="h-20 rounded-[22px] bg-[var(--color-bg-card)] animate-pulse" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-[22px] bg-[var(--color-bg-card)] px-5 py-8 text-center">
              <Dumbbell size={28} className="mx-auto mb-3" style={{ color: 'var(--color-text-subtle)' }} />
              <p className="text-[14px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{t('profile.noActivityYet')}</p>
            </div>
          ) : (
            <>
              {/* Counter */}
              <div className="flex items-center justify-between px-1 mb-1">
                <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('profile.recentActivity')}
                </p>
                <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                  {t('profile.showingCount', { visible: Math.min(visibleActivity, sessions.length), total: sessions.length })}
                </p>
              </div>

              {/* Session list */}
              {sessions.slice(0, visibleActivity).map((s) => {
                const date = new Date(s.completed_at);
                const lang = i18n.language || 'en';
                const dateStr = date.toLocaleDateString(lang, { month: 'short', day: 'numeric' });
                const timeStr = date.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
                const volume = parseFloat(s.total_volume_lbs) || 0;
                const durationMin = s.duration_seconds ? Math.round(s.duration_seconds / 60) : null;
                return (
                  <div
                    key={s.id}
                    className="rounded-[22px] bg-[var(--color-bg-card)] px-4 py-3.5 flex items-center gap-3.5"
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--color-accent-alpha, rgba(212,175,55,0.12))' }}
                    >
                      <Dumbbell size={18} style={{ color: 'var(--color-accent, #2EC4C4)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                        {s.name || t('profile.workouts')}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                          {dateStr} {timeStr}
                        </span>
                        {durationMin != null && (
                          <span className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                            <Clock size={11} /> {durationMin} min
                          </span>
                        )}
                      </div>
                    </div>
                    {volume > 0 && (
                      <p className="text-[13px] font-bold flex-shrink-0" style={{ color: 'var(--color-accent, #2EC4C4)' }}>
                        {formatStatNumber(Math.round(volume))} <span className="text-[10px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>lbs</span>
                      </p>
                    )}
                  </div>
                );
              })}

              {/* Show more button */}
              {visibleActivity < sessions.length && (
                <button
                  type="button"
                  onClick={() => setVisibleActivity(prev => prev + 10)}
                  className="w-full py-3.5 rounded-2xl border border-[var(--color-border-subtle)] text-[14px] font-semibold hover:bg-[var(--color-bg-card)] transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {t('profile.showMore')}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Achievements Tab ─────────────────────────────────────────────── */}
      {activeTab === 'achievements' && (
        <div className="flex flex-col gap-8 animate-fade-in stagger-fade-in">
          {/* Summary bar */}
          {!loading && (
            <div className="rounded-[22px] bg-[var(--color-bg-card)] px-5 py-4 flex items-center justify-between">
              <div>
                <p className={`${statFontSize(earnedAchievementCount, 'text-[22px]')} font-black text-[var(--color-accent)] leading-none truncate`} style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '-0.3px', fontVariantNumeric: 'tabular-nums' }}>
                  {earnedAchievementCount}
                  <span className="text-[14px] font-semibold text-[var(--color-text-muted)] ml-1">
                    / {totalAchievementCount}
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
                      width: `${(earnedAchievementCount / totalAchievementCount) * 100}%`,
                      background: 'linear-gradient(90deg, var(--color-accent), var(--color-warning))',
                    }}
                  />
                </div>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1 text-right">
                  {Math.round((earnedAchievementCount / totalAchievementCount) * 100)}% {t('profile.complete')}
                </p>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col gap-4" aria-busy={true} aria-label={t('profile.loadingAchievements', 'Loading achievements')}>
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 rounded-[22px] bg-[var(--color-bg-card)] animate-pulse" />
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
                    <h3 className="text-[13px] text-[var(--color-text-muted)] uppercase tracking-widest" style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '0.05em' }}>
                      {t(`profile.achievementCategories.${category}`, category)}
                    </h3>
                    <span className="text-[11px] font-semibold text-[var(--color-text-muted)]">
                      {earnedInCategory}/{defs.length}
                    </span>
                  </div>

                  <div className="flex flex-col gap-3 stagger-fade-in">
                    {defs.map(a => (
                      <AchievementCard
                        key={a.key}
                        a={a}
                        earned={!!earnedAchievements[a.key]}
                        earnedAt={earnedAchievements[a.key]}
                        stats={achievementStats}
                        onShare={setShareAchievement}
                        t={t}
                        i18n={i18n}
                      />
                    ))}
                  </div>
                </section>
              );
            })
          )}

          {/* Gym-authored achievements (achievement_definitions rows; earned
              state keyed by custom_<id> in user_achievements) */}
          {!loading && customDefs.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[13px] text-[var(--color-text-muted)] uppercase tracking-widest" style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '0.05em' }}>
                  {t('profile.achievementCategories.gym', 'Gym achievements')}
                </h3>
                <span className="text-[11px] font-semibold text-[var(--color-text-muted)]">
                  {customDefs.filter(a => earnedAchievements[a.key]).length}/{customDefs.length}
                </span>
              </div>

              <div className="flex flex-col gap-3 stagger-fade-in">
                {customDefs.map(a => (
                  <AchievementCard
                    key={a.key}
                    a={a}
                    earned={!!earnedAchievements[a.key]}
                    earnedAt={earnedAchievements[a.key]}
                    stats={customAchievementStats}
                    onShare={setShareAchievement}
                    t={t}
                    i18n={i18n}
                  />
                ))}
              </div>
            </section>
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
                <h3 className="text-[13px] text-[var(--color-text-muted)] uppercase tracking-widest mb-3" style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '0.05em' }}>{t('profile.fitnessLevel')}</h3>
                <div className="flex flex-col gap-3">
                  {FITNESS_LEVELS.map(l => (
                    <button key={l.value} type="button"
                      onClick={() => setGoalsDraft(d => ({ ...d, fitness_level: l.value }))}
                      className={`w-full text-left flex items-center gap-4 px-5 py-4 rounded-2xl border transition-all ${
                        goalsDraft.fitness_level === l.value
                          ? 'bg-[var(--color-bg-elevated)] border-[color-mix(in_srgb,var(--color-accent)_50%,transparent)]'
                          : 'bg-[var(--color-bg-card)] border-[var(--color-border-subtle)]'
                      }`}
                    >
                      <l.icon size={22} className="text-[var(--color-accent)] flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-[15px] ${goalsDraft.fitness_level === l.value ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}>{t(`profile_options.fitnessLevels.${l.value}`)}</p>
                        <p className="text-[12px] mt-0.5 text-[var(--color-text-muted)]">{t(`profile_options.fitnessLevels.${l.value}_desc`)}</p>
                      </div>
                      {goalsDraft.fitness_level === l.value && <Check size={16} className="text-[var(--color-accent)] flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Primary Goal */}
              <div>
                <h3 className="text-[13px] text-[var(--color-text-muted)] uppercase tracking-widest mb-3" style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '0.05em' }}>{t('profile.primaryGoal')}</h3>
                <div className="flex flex-col gap-3">
                  {GOALS.map(g => (
                    <button key={g.value} type="button"
                      onClick={() => setGoalsDraft(d => ({ ...d, primary_goal: g.value }))}
                      className={`w-full text-left flex items-center gap-4 px-5 py-4 rounded-2xl border transition-all ${
                        goalsDraft.primary_goal === g.value
                          ? 'bg-[var(--color-bg-elevated)] border-[color-mix(in_srgb,var(--color-accent)_50%,transparent)]'
                          : 'bg-[var(--color-bg-card)] border-[var(--color-border-subtle)]'
                      }`}
                    >
                      <g.icon size={22} className="text-[var(--color-accent)] flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-[15px] ${goalsDraft.primary_goal === g.value ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}>{t(`profile_options.goals.${g.value}`)}</p>
                        <p className="text-[12px] mt-0.5 text-[var(--color-text-muted)]">{t(`profile_options.goals.${g.value}_desc`)}</p>
                      </div>
                      {goalsDraft.primary_goal === g.value && <Check size={16} className="text-[var(--color-accent)] flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Training Days */}
              <div>
                <h3 className="text-[13px] text-[var(--color-text-muted)] uppercase tracking-widest mb-3" style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '0.05em' }}>{t('profile.daysPerWeek')}</h3>
                <div className="flex gap-2">
                  {FREQUENCIES.map(n => (
                    <button key={n} type="button"
                      onClick={() => setGoalsDraft(d => ({ ...d, training_days_per_week: n }))}
                      className={`flex-1 py-3 rounded-xl text-[15px] font-bold transition-all border ${
                        goalsDraft.training_days_per_week === n
                          ? 'bg-[var(--color-bg-elevated)] border-[color-mix(in_srgb,var(--color-accent)_50%,transparent)] text-[var(--color-accent)]'
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
                <h3 className="text-[13px] text-[var(--color-text-muted)] uppercase tracking-widest mb-2" style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '0.05em' }}>{t('profile.trainingDays')}</h3>
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
                            ? 'bg-[var(--color-bg-elevated)] border-[color-mix(in_srgb,var(--color-accent)_50%,transparent)] text-[var(--color-accent)]'
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
                <h3 className="text-[13px] text-[var(--color-text-muted)] uppercase tracking-widest mb-3" style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '0.05em' }}>{t('profile.availableEquipment')}</h3>
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
                            ? 'bg-[var(--color-bg-elevated)] border-[color-mix(in_srgb,var(--color-accent)_50%,transparent)] text-[var(--color-accent)]'
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
                <h3 className="text-[13px] text-[var(--color-text-muted)] uppercase tracking-widest mb-3" style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '0.05em' }}>{t('profile.injuriesLimitations')}</h3>
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
                <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:gap-4" aria-busy={true} aria-label={t('profile.loadingGoals', 'Loading goals')}>
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-20 rounded-[22px] bg-[var(--color-bg-card)] animate-pulse" />
                  ))}
                </div>
              ) : (
                <>
                  {/* Fitness Level */}
                  <div className="rounded-[22px] bg-[var(--color-bg-card)] p-5">
                    <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">{t('profile.fitnessLevel')}</p>
                    {(() => {
                      const l = FITNESS_LEVELS.find(x => x.value === onboarding?.fitness_level);
                      return l ? (
                        <div className="flex items-center gap-3">
                          <l.icon size={22} className="text-[var(--color-accent)] flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-[15px] text-[var(--color-text-primary)]">{t(`profile_options.fitnessLevels.${l.value}`)}</p>
                            <p className="text-[12px] mt-0.5 text-[var(--color-text-muted)]">{t(`profile_options.fitnessLevels.${l.value}_desc`)}</p>
                          </div>
                        </div>
                      ) : <p className="text-[var(--color-text-muted)]">{t('profile.notSet')}</p>;
                    })()}
                  </div>

                  {/* Primary Goal */}
                  <div className="rounded-[22px] bg-[var(--color-bg-card)] p-5">
                    <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">{t('profile.primaryGoal')}</p>
                    {(() => {
                      const g = GOALS.find(x => x.value === onboarding?.primary_goal);
                      return g ? (
                        <div className="flex items-center gap-3">
                          <g.icon size={22} className="text-[var(--color-accent)] flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-[15px] text-[var(--color-text-primary)]">{t(`profile_options.goals.${g.value}`)}</p>
                            <p className="text-[12px] mt-0.5 text-[var(--color-text-muted)]">{t(`profile_options.goals.${g.value}_desc`)}</p>
                          </div>
                        </div>
                      ) : <p className="text-[var(--color-text-muted)]">{t('profile.notSet')}</p>;
                    })()}
                  </div>

                  {/* Training Frequency */}
                  <div className="rounded-[22px] bg-[var(--color-bg-card)] p-5">
                    <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-2">{t('profile.trainingFrequency')}</p>
                    <p className="font-semibold text-[15px] text-[var(--color-text-primary)]">
                      {onboarding?.training_days_per_week
                        ? t('profile.daysPerWeekValue', { count: onboarding.training_days_per_week })
                        : t('profile.notSet')}
                    </p>
                  </div>

                  {/* Training Days */}
                  <div className="rounded-[22px] bg-[var(--color-bg-card)] p-5">
                    <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">{t('profile.trainingDays')}</p>
                    {profile?.preferred_training_days?.length > 0 ? (
                      <div className="flex gap-1.5">
                        {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((fullName) => {
                          const active = profile.preferred_training_days.includes(fullName);
                          return (
                            <div key={fullName} className={`flex-1 py-2 rounded-lg text-center text-[11px] font-bold ${active ? 'bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)] text-[var(--color-accent)] border border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)]' : 'bg-[var(--color-bg-card)] text-[var(--color-text-muted)]'}`}>
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
                  <div className="rounded-[22px] bg-[var(--color-bg-card)] p-5">
                    <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">{t('profile.availableEquipment')}</p>
                    {onboarding?.available_equipment?.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {onboarding.available_equipment.map(eq => {
                          const found = EQUIPMENT_OPTIONS.find(e => e.value === eq);
                          return (
                            <span key={eq} className="text-[12px] font-semibold px-3 py-1.5 rounded-full bg-[var(--color-bg-elevated)] text-[var(--color-accent)] border border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)]">
                              {found ? t(`profile_options.equipment.${found.labelKey}`) : eq}
                            </span>
                          );
                        })}
                      </div>
                    ) : <p className="text-[var(--color-text-muted)]">{t('profile.notSet')}</p>}
                  </div>

                  {/* Injuries */}
                  <div className="rounded-[22px] bg-[var(--color-bg-card)] p-5">
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
            <div className="fixed bottom-[56px] md:bottom-0 left-0 right-0 z-50 flex gap-3 px-4 py-3 md:pb-[calc(0.75rem+var(--safe-area-bottom,env(safe-area-inset-bottom)))] bg-[var(--color-bg-primary)] border-t border-[var(--color-border-subtle)]">
              <button type="button"
                onClick={() => setEditingGoals(false)}
                className="flex-1 py-3.5 rounded-xl border border-[var(--color-border-subtle)] text-[15px] font-semibold text-[var(--color-text-primary)] bg-[var(--color-bg-elevated)]">
                {t('profile.cancel')}
              </button>
              <button type="button"
                onClick={saveGoals}
                disabled={savingGoals}
                className="flex-1 py-3.5 rounded-xl text-[15px] font-bold bg-[var(--color-accent)] text-[var(--color-text-on-accent,#000)] disabled:opacity-50">
                {savingGoals ? t('profile.savingEllipsis') : t('profile.saveChanges')}
              </button>
            </div>
          )}
        </div>
      )}


      </div>

      {/* ── Gym Info Modal ──────────────────────────────────────────────── */}
      {showGymInfo && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm" role="presentation" onClick={() => setShowGymInfo(false)}>
          <div className="w-full max-w-md mx-4 rounded-[24px] bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] shadow-2xl overflow-hidden" role="dialog" aria-modal="true" aria-label={t('profile.gymInfo')} onClick={e => e.stopPropagation()}>
            <div className="relative flex justify-center pt-4 pb-3">
              <div className="w-8 h-[3px] rounded-full bg-white/[0.08]" />
              <button type="button" onClick={() => setShowGymInfo(false)} aria-label={t('common:close', 'Close')} className="absolute right-4 top-3 w-8 h-8 rounded-full bg-[var(--color-bg-card)] flex items-center justify-center text-[var(--color-text-muted)]">
                <X size={16} />
              </button>
            </div>
            <div className="px-6 pb-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)] flex items-center justify-center">
                  <Building2 size={20} className="text-[var(--color-accent)]" />
                </div>
                <div>
                  <h3 className="text-[17px] text-[var(--color-text-primary)]" style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: '-0.3px' }}>{gymInfo?.name || gymName}</h3>
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
      {/* Avatar customization picker */}
      <AvatarPicker
        isOpen={avatarPickerOpen}
        onClose={() => setAvatarPickerOpen(false)}
        currentAvatar={{
          type: profile?.avatar_type || (profile?.avatar_url ? 'photo' : 'color'),
          value: profile?.avatar_value || '#6366F1',
        }}
        user={profile}
        onSave={handleAvatarSave}
        uploading={uploadingAvatar}
      />

      {/* Achievement share sheet */}
      {shareAchievement && (
        <ShareAchievementSheet
          open={!!shareAchievement}
          onClose={() => setShareAchievement(null)}
          achievement={shareAchievement}
        />
      )}

      {/* Monthly recap share — assembled inline from the same sessions/PRs
          arrays that power the lifetime stats strip above, so the share
          always matches what the user sees on screen. */}
      {monthlyShareOpen && (() => {
        const now = new Date();
        const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const inMonth = (iso) => {
          if (!iso) return false;
          const d = new Date(iso);
          return d >= mStart && d <= now;
        };
        const monthSessions = sessions.filter(s => inMonth(s.completed_at || s.started_at));
        const monthVolume = monthSessions.reduce((sum, s) => sum + (parseFloat(s.total_volume_lbs) || 0), 0);
        const monthPRList = prs.filter(p => inMonth(p.achieved_at || p.created_at));
        const monthPRs = monthPRList.length;
        const monthLabel = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase();
        return (
          <ShareMonthSheet
            open={monthlyShareOpen}
            onClose={() => setMonthlyShareOpen(false)}
            recap={{
              monthLabel,
              workouts: monthSessions.length,
              totalVolumeLbs: Math.round(monthVolume),
              prCount: monthPRs,
              streakDays: profile?.current_streak_days || 0,
            }}
            monthSessions={monthSessions}
            monthPRs={monthPRList}
            user={profile}
            gym={profile?.gym_name}
            gymLogoUrl={gymLogoUrl}
            shareLink={`${PROD_WEB_URL}/recap`}
          />
        );
      })()}

      <ViewSwitcherModal open={showViewSwitcher} onClose={() => setShowViewSwitcher(false)} />
    </div>
  );
};

export default Profile;
