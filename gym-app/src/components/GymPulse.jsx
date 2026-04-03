import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Activity, Dumbbell, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatStatNumber, statFontSize } from '../lib/formatStatValue';
import UserAvatar from './UserAvatar';
import ProfilePreview from './ProfilePreview';

// ── Helpers ─────────────────────────────────────────────────────────────────
const fmtNumber = (n) => {
  if (!n) return '0';
  return formatStatNumber(n);
};

const todayRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  return { start, end };
};

// ── Mini avatar ─────────────────────────────────────────────────────────────
const MiniAvatar = ({ src, name, index, avatarType, avatarValue }) => (
  <div
    className="relative flex-shrink-0 rounded-full overflow-hidden border-2 border-[#0F172A]"
    style={{
      width: 44,
      height: 44,
      marginLeft: index === 0 ? 0 : -10,
      zIndex: 10 - index,
    }}
  >
    <UserAvatar user={{ avatar_url: src, full_name: name, avatar_type: avatarType, avatar_value: avatarValue }} size={40} />
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
  const { t } = useTranslation('pages');

  const [membersToday, setMembersToday]     = useState(0);
  const [volumeToday, setVolumeToday]       = useState(0);
  const [activeNow, setActiveNow]           = useState(0);
  const [recentTrainers, setRecentTrainers] = useState([]);
  const [loading, setLoading]               = useState(true);
  const [showDetail, setShowDetail]         = useState(false);
  const [todaySessions, setTodaySessions]   = useState([]);
  const [previewUserId, setPreviewUserId]   = useState(null);

  useEffect(() => {
    if (!user || !profile?.gym_id) return;

    const fetchPulse = async () => {
      const gymId = profile.gym_id;
      const { start, end } = todayRange();

      // Fetch today's workout sessions for this gym via a join on profiles
      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('profile_id, status, total_volume_lbs, completed_at, started_at, profiles!inner(gym_id, full_name, avatar_url, avatar_type, avatar_value)')
        .eq('profiles.gym_id', gymId)
        .gte('started_at', start)
        .lt('started_at', end);

      // Fetch today's check-ins for this gym
      const { data: checkIns } = await supabase
        .from('check_ins')
        .select('profile_id, checked_in_at, profiles!inner(gym_id, full_name, avatar_url, avatar_type, avatar_value)')
        .eq('profiles.gym_id', gymId)
        .gte('checked_in_at', start)
        .lt('checked_in_at', end);

      const allSessions = sessions || [];
      const allCheckIns = checkIns || [];

      if (allSessions.length === 0 && allCheckIns.length === 0) {
        setLoading(false);
        return;
      }

      // Members today — union of workout sessions + check-ins (deduplicated)
      const uniqueProfileIds = new Set([
        ...allSessions.map(s => s.profile_id),
        ...allCheckIns.map(c => c.profile_id),
      ]);
      setMembersToday(uniqueProfileIds.size);

      // Total volume (workout sessions only)
      const totalVol = allSessions.reduce((sum, s) => sum + (s.total_volume_lbs ?? 0), 0);
      setVolumeToday(totalVol);

      // Active now — in_progress sessions + check-ins within last 90 minutes (deduplicated)
      const ninetyMinAgo = new Date(Date.now() - 90 * 60 * 1000).toISOString();
      const activeFromSessions = allSessions
        .filter(s => s.status === 'in_progress')
        .map(s => s.profile_id);
      const activeFromCheckIns = allCheckIns
        .filter(c => c.checked_in_at >= ninetyMinAgo)
        .map(c => c.profile_id);
      const activeProfileIds = new Set([...activeFromSessions, ...activeFromCheckIns]);
      setActiveNow(activeProfileIds.size);

      // 5 most recent unique people (sessions by completed_at, check-ins by checked_in_at)
      const combined = [
        ...allSessions.map(s => ({
          id: s.profile_id,
          full_name: s.profiles?.full_name,
          avatar_url: s.profiles?.avatar_url,
          avatar_type: s.profiles?.avatar_type,
          avatar_value: s.profiles?.avatar_value,
          sortDate: s.completed_at || s.started_at || '1970-01-01',
          volume: s.total_volume_lbs,
          status: s.status,
        })),
        ...allCheckIns.map(c => ({
          id: c.profile_id,
          full_name: c.profiles?.full_name,
          avatar_url: c.profiles?.avatar_url,
          avatar_type: c.profiles?.avatar_type,
          avatar_value: c.profiles?.avatar_value,
          sortDate: c.checked_in_at,
          volume: null,
          status: activeProfileIds.has(c.profile_id) ? 'checked_in' : 'completed',
        })),
      ].sort((a, b) => new Date(b.sortDate) - new Date(a.sortDate));

      const seen = new Set();
      const recent = [];
      for (const s of combined) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        recent.push({ id: s.id, full_name: s.full_name, avatar_url: s.avatar_url, avatar_type: s.avatar_type, avatar_value: s.avatar_value });
        if (recent.length >= 5) break;
      }
      setRecentTrainers(recent);

      // Deduplicated session list for the detail modal
      const sessionMap = new Map();
      for (const s of allSessions) {
        sessionMap.set(s.profile_id, {
          id: s.profile_id,
          name: s.profiles?.full_name || 'Member',
          avatar: s.profiles?.avatar_url,
          avatar_type: s.profiles?.avatar_type,
          avatar_value: s.profiles?.avatar_value,
          volume: s.total_volume_lbs,
          status: s.status,
          completedAt: s.completed_at,
        });
      }
      for (const c of allCheckIns) {
        if (!sessionMap.has(c.profile_id)) {
          sessionMap.set(c.profile_id, {
            id: c.profile_id,
            name: c.profiles?.full_name || 'Member',
            avatar: c.profiles?.avatar_url,
            avatar_type: c.profiles?.avatar_type,
            avatar_value: c.profiles?.avatar_value,
            volume: null,
            status: c.checked_in_at >= ninetyMinAgo ? 'checked_in' : 'completed',
            completedAt: c.checked_in_at,
          });
        }
      }
      setTodaySessions(Array.from(sessionMap.values()));
      setLoading(false);
    };

    fetchPulse();

    // Realtime — listen for workout sessions + check-ins so the feed
    // refreshes when someone starts/finishes a workout or checks in.
    // Filtered by gym_id so we only receive events for the current gym.
    const gymId = profile.gym_id;
    let debounceTimer;
    const debouncedFetch = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchPulse(), 2000);
    };
    const channel = supabase
      .channel('gym-pulse-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'workout_sessions',
        filter: `gym_id=eq.${gymId}`,
      }, debouncedFetch)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'workout_sessions',
        filter: `gym_id=eq.${gymId}`,
      }, debouncedFetch)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'check_ins',
        filter: `gym_id=eq.${gymId}`,
      }, debouncedFetch)
      .subscribe();

    // Fallback polling every 2 minutes in case realtime misses an event
    const interval = setInterval(fetchPulse, 120_000);

    return () => {
      clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [user, profile?.gym_id]);

  if (!profile?.gym_id) return null;

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      onClick={() => setShowDetail(true)}
      className="rounded-[14px] bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] p-5 cursor-pointer hover:border-[var(--color-border-subtle)] transition-colors overflow-hidden"
      aria-live="polite"
      aria-label="Gym activity pulse"
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-[10px] flex items-center justify-center border border-white/[0.08]" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
          <Activity size={18} style={{ color: 'var(--color-accent, #D4AF37)' }} />
        </div>
        <h3 className="text-[15px] font-bold text-[var(--color-text-primary)] flex-1">{t('dashboard.gymActivity')}</h3>
        <PulsingDot color="bg-[#D4AF37]" size="w-2.5 h-2.5" />
      </div>

      {loading ? (
        <div className="h-20 rounded-xl bg-[var(--color-surface-hover)] animate-pulse" />
      ) : (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {/* Members today */}
            <div className="rounded-xl bg-[var(--color-surface-hover)] p-3 text-center overflow-hidden min-w-0">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Users size={13} className="text-[var(--color-text-muted)] flex-shrink-0" />
                <span className="text-[11px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide truncate">{t('dashboard.trained')}</span>
              </div>
              <p className={`${statFontSize(membersToday, 'text-[20px]')} font-bold text-[var(--color-text-primary)] leading-none truncate`}>{fmtNumber(membersToday)}</p>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5 truncate">{t('dashboard.todayLabel')}</p>
            </div>

            {/* Volume today */}
            <div className="rounded-xl bg-[var(--color-surface-hover)] p-3 text-center overflow-hidden min-w-0">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Dumbbell size={13} className="text-[var(--color-text-muted)] flex-shrink-0" />
                <span className="text-[11px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide truncate">{t('dashboard.volume')}</span>
              </div>
              <p className={`${statFontSize(fmtNumber(volumeToday), 'text-[20px]')} font-bold text-[var(--color-text-primary)] leading-none truncate`}>{fmtNumber(volumeToday)}</p>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5 truncate">{t('dashboard.lbsToday')}</p>
            </div>

            {/* Active now */}
            <div className="rounded-xl bg-[var(--color-surface-hover)] p-3 text-center overflow-hidden min-w-0">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <PulsingDot color="bg-emerald-400" size="w-1.5 h-1.5" />
                <span className="text-[11px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide truncate">{t('dashboard.active')}</span>
              </div>
              <motion.p
                key={activeNow}
                initial={{ scale: 1.2 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className={`${statFontSize(activeNow, 'text-[20px]')} font-bold text-emerald-400 leading-none truncate`}
              >
                {activeNow}
              </motion.p>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5 truncate">{t('dashboard.rightNow')}</p>
            </div>
          </div>

          {/* Recent trainers avatar row */}
          {recentTrainers.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex items-center">
                {recentTrainers.map((t, i) => (
                  <MiniAvatar key={t.id} src={t.avatar_url} name={t.full_name} index={i} avatarType={t.avatar_type} avatarValue={t.avatar_value} />
                ))}
              </div>
              <p className="text-[12px] text-[var(--color-text-muted)] flex-1 min-w-0 truncate">
                {recentTrainers[0]?.full_name?.split(' ')[0]}
                {recentTrainers.length > 1 && ` ${t('dashboard.andXOthers', { count: recentTrainers.length - 1 })}`}
                {' '}{t('dashboard.trainedToday', { count: recentTrainers.length })}
              </p>
            </div>
          )}
        </>
      )}
    </motion.div>

    {/* Detail Modal */}
    {showDetail && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDetail(false)}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="gym-pulse-detail-title"
          className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-[24px] bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] shadow-2xl overflow-hidden mx-4"
          onClick={e => e.stopPropagation()}
        >
          {/* Handle + Close */}
          <div className="relative flex justify-center pt-4 pb-3 shrink-0">
            <div className="w-8 h-[3px] rounded-full bg-[var(--color-border-subtle)]" />
            <button
              onClick={() => setShowDetail(false)}
              className="absolute right-4 top-3 w-11 h-11 rounded-full bg-[var(--color-surface-hover)] flex items-center justify-center text-[var(--color-text-muted)] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              aria-label="Close"
            >
              <span className="text-[16px]">{'\u2715'}</span>
            </button>
          </div>

          {/* Header */}
          <div className="px-5 pb-3 border-b border-[var(--color-border-subtle)]">
            <div className="flex items-center gap-2">
              <Activity size={18} className="text-[#D4AF37]" />
              <h2 id="gym-pulse-detail-title" className="text-[17px] font-bold text-[var(--color-text-primary)] truncate">{t('dashboard.todaysActivity')}</h2>
            </div>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-[12px] text-[var(--color-text-muted)]">{t('dashboard.xTrained', { count: membersToday })}</span>
              <span className="text-[12px] text-[var(--color-text-muted)]">{t('dashboard.xLbsTotal', { count: fmtNumber(volumeToday) })}</span>
              {activeNow > 0 && (
                <span className="flex items-center gap-1 text-[12px] text-emerald-400">
                  <PulsingDot color="bg-emerald-400" size="w-1.5 h-1.5" />
                  {t('dashboard.xActiveNow', { count: activeNow })}
                </span>
              )}
            </div>
          </div>

          {/* Member list */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
            {todaySessions
              .filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i)
              .sort((a, b) => (a.status === 'in_progress' ? -1 : 1) - (b.status === 'in_progress' ? -1 : 1))
              .map((s, i) => (
                <div key={`${s.id}-${i}`} className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-[var(--color-surface-hover)] border border-[var(--color-border-subtle)]">
                  {/* Avatar — tappable for profile preview */}
                  <button
                    type="button"
                    onClick={() => setPreviewUserId(s.id)}
                    className="flex-shrink-0 rounded-full focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                    aria-label={`View ${s.name}'s profile`}
                  >
                    <UserAvatar user={{ avatar_url: s.avatar, full_name: s.name, avatar_type: s.avatar_type, avatar_value: s.avatar_value }} size={40} />
                  </button>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-semibold text-[var(--color-text-primary)] truncate">{s.name}</p>
                      {(s.status === 'in_progress' || s.status === 'checked_in') && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                          <PulsingDot color="bg-emerald-400" size="w-1.5 h-1.5" />
                          {t('dashboard.active')}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                      {s.status === 'in_progress'
                        ? t('dashboard.workingOutNow')
                        : s.status === 'checked_in'
                          ? t('dashboard.checkedIn', 'Checked in')
                          : s.volume
                            ? t('dashboard.xLbsLifted', { count: fmtNumber(s.volume) })
                            : t('dashboard.completedWorkout')
                      }
                    </p>
                  </div>
                </div>
              ))
            }

            {todaySessions.length === 0 && (
              <div className="text-center py-8">
                <p className="text-[14px] text-[var(--color-text-muted)]">{t('dashboard.noOneTrainedYet')}</p>
                <p className="text-[12px] text-[var(--color-text-muted)] mt-1">{t('dashboard.beTheFirst')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Profile Preview popup */}
    <ProfilePreview
      userId={previewUserId}
      isOpen={!!previewUserId}
      onClose={() => setPreviewUserId(null)}
    />
    </>
  );
};

export default GymPulse;
