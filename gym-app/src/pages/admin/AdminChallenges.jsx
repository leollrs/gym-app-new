import { useEffect, useState } from 'react';
import { Plus, Trophy, ChevronDown, Users, Gift, Pencil, Trash2, Award, BarChart3, Flame, Dumbbell, Zap, TrendingUp, Timer, Crown } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { format, isPast, isFuture } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { es as esLocale } from 'date-fns/locale/es';
import { adminKeys } from '../../lib/adminQueryKeys';
import { logAdminAction } from '../../lib/adminAudit';
import { PageHeader, AdminCard, FadeIn, CardSkeleton, SectionLabel, AdminTabs, AdminPageShell, ErrorCard } from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import ChallengeModal from './components/ChallengeModal';
import ChallengeSuggestionCard from './components/ChallengeSuggestionCard';

// ── Participant list panel ─────────────────────────────────
const ParticipantList = ({ challengeId, gymId }) => {
  const { t } = useTranslation('pages');
  const { data: participants = [], isLoading } = useQuery({
    queryKey: [...adminKeys.challenges(gymId), 'participants', challengeId],
    queryFn: async () => {
      const { data } = await supabase
        .from('challenge_participants')
        .select('profile_id, joined_at, profiles(full_name, avatar_url)')
        .eq('challenge_id', challengeId)
        .eq('gym_id', gymId)
        .order('joined_at', { ascending: true });
      return data || [];
    },
  });

  if (isLoading) return (
    <div className="py-3 flex justify-center">
      <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)', borderTopColor: 'var(--color-accent)' }} />
    </div>
  );

  if (participants.length === 0) return (
    <p className="text-[12px] text-center py-2" style={{ color: 'var(--color-text-muted)' }}>{t('admin.challenges.noParticipants', 'No participants yet')}</p>
  );

  return (
    <div className="flex flex-wrap gap-2">
      {participants.map(p => {
        const name = p.profiles?.full_name ?? '?';
        const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        return (
          <div key={p.profile_id} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5" style={{ backgroundColor: 'var(--color-bg-card)' }}>
            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 20%, transparent)' }}>
              <span className="text-[9px] font-bold" style={{ color: 'var(--color-accent)' }}>{initials}</span>
            </div>
            <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{name}</span>
          </div>
        );
      })}
    </div>
  );
};

const CHALLENGE_COVERS = {
  fire:      { icon: Flame,      gradient: 'linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)' },
  power:     { icon: Dumbbell,   gradient: 'linear-gradient(135deg, #D4AF37 0%, #92751E 100%)' },
  endurance: { icon: Zap,        gradient: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)' },
  growth:    { icon: TrendingUp, gradient: 'linear-gradient(135deg, #10B981 0%, #047857 100%)' },
  compete:   { icon: Trophy,     gradient: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)' },
  team:      { icon: Users,      gradient: 'linear-gradient(135deg, #EC4899 0%, #BE185D 100%)' },
  speed:     { icon: Timer,      gradient: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' },
  champion:  { icon: Crown,      gradient: 'linear-gradient(135deg, #6366F1 0%, #4338CA 100%)' },
};

function ChallengeCoverBadge({ preset }) {
  if (!preset) return null;
  const cover = CHALLENGE_COVERS[preset];
  if (!cover) return null;
  const Icon = cover.icon;
  return (
    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: cover.gradient }}>
      <Icon size={17} className="text-white/90" />
    </div>
  );
}

const statusBadge = (c) => {
  if (isFuture(new Date(c.start_date))) return { labelKey: 'admin.challenges.upcoming', color: 'text-blue-400 bg-blue-500/10' };
  if (isPast(new Date(c.end_date)))     return { labelKey: 'admin.challenges.ended',    color: 'text-[#6B7280] bg-white/6' };
  return                                       { labelKey: 'admin.challenges.live',     color: 'text-emerald-400 bg-emerald-500/10' };
};

// ── Leaderboard panel ─────────────────────────────────────
const ChallengeLeaderboard = ({ challenge, gymId }) => {
  const { t } = useTranslation('pages');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchScores = async () => {
      setLoading(true);
      if (challenge.type === 'consistency' || challenge.type === 'volume') {
        const { data } = await supabase
          .from('workout_sessions')
          .select('profile_id, total_volume_lbs, profiles(full_name)')
          .eq('gym_id', gymId)
          .eq('status', 'completed')
          .gte('started_at', challenge.start_date)
          .lte('started_at', challenge.end_date);

        const agg = {};
        (data || []).forEach(s => {
          if (!agg[s.profile_id]) agg[s.profile_id] = { name: s.profiles?.full_name ?? '—', count: 0, volume: 0 };
          agg[s.profile_id].count++;
          agg[s.profile_id].volume += parseFloat(s.total_volume_lbs || 0);
        });

        const list = Object.entries(agg)
          .map(([id, v]) => ({
            id, name: v.name,
            score: challenge.type === 'volume' ? Math.round(v.volume) : v.count,
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 10);

        setEntries(list);
      } else if (challenge.type === 'pr_count') {
        const { data } = await supabase
          .from('pr_history')
          .select('profile_id, profiles(full_name)')
          .eq('gym_id', gymId)
          .gte('achieved_at', challenge.start_date)
          .lte('achieved_at', challenge.end_date);

        const agg = {};
        (data || []).forEach(r => {
          if (!agg[r.profile_id]) agg[r.profile_id] = { name: r.profiles?.full_name ?? '—', score: 0 };
          agg[r.profile_id].score++;
        });
        setEntries(Object.entries(agg).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.score - a.score).slice(0, 10));
      }
      setLoading(false);
    };

    // Subscribe to realtime changes
    const channel = supabase.channel(`challenge-${challenge.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'workout_sessions', filter: `gym_id=eq.${gymId}` },
        () => fetchScores()
      )
      .subscribe();

    fetchScores();
    return () => supabase.removeChannel(channel);
  }, [challenge, gymId]);

  const scoreLabel = challenge.type === 'volume' ? t('admin.challenges.scoreLbs', 'lbs') : challenge.type === 'consistency' ? t('admin.challenges.scoreWorkouts', 'workouts') : t('admin.challenges.scorePRs', 'PRs');

  return (
    <div className="mt-3 space-y-2">
      {loading ? (
        <div className="py-4 flex justify-center">
          <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)', borderTopColor: 'var(--color-accent)' }} />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-[12px] text-center py-3" style={{ color: 'var(--color-text-muted)' }}>{t('admin.challenges.noActivity', 'No activity yet')}</p>
      ) : (
        entries.map((e, i) => (
          <div key={e.id} className="flex items-center gap-3 py-2 px-3 rounded-xl" style={{ backgroundColor: 'var(--color-bg-card)' }}>
            <span className="text-[13px] font-bold w-5 text-center" style={{ color: i === 0 ? 'var(--color-accent)' : i === 1 ? 'var(--color-text-secondary)' : i === 2 ? '#B45309' : 'var(--color-text-muted)' }}>
              {i + 1}
            </span>
            <p className="flex-1 text-[13px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{e.name}</p>
            <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
              {e.score.toLocaleString()} {scoreLabel}
            </p>
          </div>
        ))
      )}
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────
export default function AdminChallenges() {
  const { t, i18n } = useTranslation('pages');
  const { profile, user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;

  const [showCreate, setShowCreate] = useState(false);
  const [editChallenge, setEditChallenge] = useState(null);
  const [expanded, setExpanded]     = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [tab, setTab] = useState('active');
  const [awardingId, setAwardingId] = useState(null);
  const [leaderboardOpen, setLeaderboardOpen] = useState({});

  useEffect(() => { document.title = t('admin.challenges.title', 'Challenges') + ' | ' + (window.__APP_NAME || 'TuGymPR'); }, [t]);

  // ── Fetch challenges ──
  const { data: challenges = [], isLoading, isError, refetch } = useQuery({
    queryKey: adminKeys.challenges(gymId),
    queryFn: async () => {
      const [{ data: challengeData }, { data: parts }, { data: prizes }] = await Promise.all([
        supabase
          .from('challenges')
          .select('*')
          .eq('gym_id', gymId)
          .order('start_date', { ascending: false }),
        supabase
          .from('challenge_participants')
          .select('challenge_id')
          .eq('gym_id', gymId),
        supabase
          .from('challenge_prizes')
          .select('challenge_id')
          .eq('gym_id', gymId),
      ]);
      // Attach participant counts and prize status to each challenge
      const counts = {};
      (parts || []).forEach(r => { counts[r.challenge_id] = (counts[r.challenge_id] || 0) + 1; });
      const awardedSet = new Set((prizes || []).map(p => p.challenge_id));
      return (challengeData || []).map(c => ({ ...c, _participantCount: counts[c.id] || 0, _prizesAwarded: awardedSet.has(c.id) }));
    },
    enabled: !!gymId,
  });

  // ── Award prizes mutation ──
  const awardPrizesMutation = useMutation({
    mutationFn: async (challengeId) => {
      const { data, error } = await supabase.rpc('award_challenge_prizes', { p_challenge_id: challengeId });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, challengeId) => {
      logAdminAction('award_prizes', 'challenge', challengeId);
      queryClient.invalidateQueries({ queryKey: adminKeys.challenges(gymId) });
      showToast(t('admin.challenges.prizesAwarded', 'Prizes awarded!'), 'success');
      setAwardingId(null);
    },
    onError: (err) => { showToast(err.message, 'error'); setAwardingId(null); },
  });

  // ── Delete mutation ──
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.rpc('admin_delete_challenge', { p_challenge_id: id });
      if (error) throw error;
    },
    onSuccess: (_, challengeId) => {
      logAdminAction('delete_challenge', 'challenge', challengeId);
      queryClient.invalidateQueries({ queryKey: adminKeys.challenges(gymId) });
      showToast(t('admin.challenges.challengeDeleted', 'Challenge deleted'), 'success');
      setDeleteConfirm(null);
      if (expanded === deleteConfirm) setExpanded(null);
    },
    onError: (err) => { showToast(err.message, 'error'); setDeleteConfirm(null); },
  });

  return (
    <AdminPageShell>
      <PageHeader
        title={t('admin.challenges.title', 'Challenges')}
        subtitle={t('admin.challenges.subtitle', 'Create and manage gym challenges')}
        actions={
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-black font-bold text-[13px] rounded-xl transition-colors" style={{ backgroundColor: 'var(--color-accent)' }}>
            <Plus size={15} /> {t('admin.challenges.newChallenge', 'New Challenge')}
          </button>
        }
        className="mb-6"
      />

      {/* AI Suggestion */}
      <ChallengeSuggestionCard
        gymId={gymId}
        onCreateFromSuggestion={async (suggestion) => {
          try {
            const now = new Date();
            const endDate = new Date(now);
            endDate.setDate(endDate.getDate() + (suggestion.duration_days || 14));
            const payload = {
              gym_id: gymId,
              created_by: profile?.id,
              name: isEs ? (suggestion.suggested_name_es || suggestion.suggested_name_en) : (suggestion.suggested_name_en || suggestion.suggested_name_es),
              type: suggestion.challenge_type || 'consistency',
              description: isEs ? (suggestion.description_es || suggestion.description_en || '') : (suggestion.description_en || suggestion.description_es || ''),
              start_date: now.toISOString(),
              end_date: endDate.toISOString(),
              status: 'active',
            };
            const { error } = await supabase.from('challenges').insert(payload);
            if (error) throw error;
            logAdminAction('create_challenge', 'challenge', null, { source: 'ai_suggestion' });
            queryClient.invalidateQueries({ queryKey: adminKeys.challenges(gymId) });
            showToast(t('admin.challenges.challengeCreated', 'Reto creado'), 'success');
          } catch (err) {
            showToast(err.message || 'Error', 'error');
          }
        }}
      />

      {/* Tabs */}
      {(() => {
        const activeChallenges = challenges.filter(c => !isFuture(new Date(c.start_date)) && !isPast(new Date(c.end_date)));
        const upcomingChallenges = challenges.filter(c => isFuture(new Date(c.start_date)));
        const pastChallenges = challenges.filter(c => isPast(new Date(c.end_date)));
        const tabs = [
          { key: 'active', label: t('admin.challenges.tabActive', 'Active'), count: activeChallenges.length },
          { key: 'upcoming', label: t('admin.challenges.tabUpcoming', 'Upcoming'), count: upcomingChallenges.length },
          { key: 'past', label: t('admin.challenges.tabPast', 'Past'), count: pastChallenges.length },
        ];
        const filterMap = { active: activeChallenges, upcoming: upcomingChallenges, past: pastChallenges };
        const emptyMsgMap = {
          active: t('admin.challenges.noActive', 'No active challenges'),
          upcoming: t('admin.challenges.noUpcoming', 'No upcoming challenges'),
          past: t('admin.challenges.noPast', 'No past challenges'),
        };

        const renderChallengeList = (filtered, tabKey) => {
          if (isLoading) return (
            <div className="space-y-3">
              {[0, 1, 2].map(i => <CardSkeleton key={i} h="h-[80px]" />)}
            </div>
          );
          if (isError) return (
            <ErrorCard message={t('common:failedToLoadData')} onRetry={refetch} />
          );
          if (filtered.length === 0) return (
            <div className="text-center py-20">
              <Trophy size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
              <p className="text-[14px]" style={{ color: 'var(--color-text-muted)' }}>{emptyMsgMap[tabKey]}</p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.challenges.noChallengesHint', 'Create your first challenge to get members competing')}</p>
            </div>
          );
          return (
            <div className="space-y-3">
              {filtered.map((c, idx) => {
                const badge = statusBadge(c);
                const isOpen = expanded === c.id;
                return (
                  <FadeIn key={c.id} delay={idx * 40}>
                    <AdminCard hover className="overflow-hidden !p-0">
                      <button className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/2 transition-colors"
                        onClick={() => setExpanded(isOpen ? null : c.id)}>
                        {c.cover_preset ? (
                          <ChallengeCoverBadge preset={c.cover_preset} />
                        ) : (
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}>
                            <Trophy size={17} style={{ color: 'var(--color-accent)' }} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{c.name}</p>
                          <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                            {format(new Date(c.start_date), 'MMM d', dateFnsLocale)} – {format(new Date(c.end_date), 'MMM d, yyyy', dateFnsLocale)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                          <Users size={11} />
                          <span>{c._participantCount}</span>
                        </div>
                        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${badge.color} flex-shrink-0`}>
                          {t(badge.labelKey)}
                        </span>
                        <ChevronDown size={16} className={`transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-muted)' }} />
                      </button>
                      {/* Award Prizes — surfaced prominently on ended challenges */}
                      {isPast(new Date(c.end_date)) && c.reward_description && !c._prizesAwarded && (
                        <div className="px-4 pb-3 -mt-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); setAwardingId(c.id); awardPrizesMutation.mutate(c.id); }}
                            disabled={awardPrizesMutation.isPending && awardingId === c.id}
                            className="flex items-center gap-2 px-4 py-2.5 text-black font-bold text-[13px] rounded-xl transition-colors disabled:opacity-50 w-full justify-center"
                            style={{ backgroundColor: 'var(--color-accent)' }}
                          >
                            <Award size={15} />
                            {awardPrizesMutation.isPending && awardingId === c.id
                              ? '...'
                              : t('admin.challenges.awardPrizes', 'Award Prizes')}
                          </button>
                        </div>
                      )}
                      {isPast(new Date(c.end_date)) && c._prizesAwarded && (
                        <div className="px-4 pb-3 -mt-1">
                          <div className="flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                            <Award size={14} className="text-emerald-400" />
                            <span className="text-[12px] font-semibold text-emerald-400">
                              {t('admin.challenges.prizesAwarded', 'Prizes awarded!')}
                            </span>
                          </div>
                        </div>
                      )}
                      {isOpen && (
                        <div className="px-4 pb-4 border-t border-white/4">
                          {/* Edit / Delete buttons */}
                          <div className="flex items-center gap-2 mt-3 mb-3">
                            <button onClick={(e) => { e.stopPropagation(); setEditChallenge(c); }}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium bg-white/5 hover:bg-white/10 border rounded-lg transition-colors" style={{ color: 'var(--color-text-primary)', borderColor: 'var(--color-border-subtle)' }}>
                              <Pencil size={12} /> {t('admin.challenges.edit', 'Edit')}
                            </button>
                            {deleteConfirm === c.id ? (
                              <div className="flex items-center gap-2">
                                <span className="text-[12px] text-red-400">{t('admin.challenges.deleteConfirm')}</span>
                                <button onClick={() => deleteMutation.mutate(c.id)} disabled={deleteMutation.isPending}
                                  className="px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-50"
                                  style={{ backgroundColor: 'var(--color-danger, #EF4444)', color: '#fff' }}>
                                  {deleteMutation.isPending ? t('admin.challenges.deleting', 'Eliminando...') : t('admin.challenges.confirm', 'Confirmar')}
                                </button>
                                <button onClick={() => setDeleteConfirm(null)}
                                  className="px-3 py-1.5 text-[12px] font-medium rounded-lg transition-colors"
                                  style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-hover)', border: '1px solid var(--color-border-subtle)' }}>
                                  {t('admin.challenges.cancel', 'Cancelar')}
                                </button>
                              </div>
                            ) : (
                              <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(c.id); }}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-red-400 bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 rounded-lg transition-colors">
                                <Trash2 size={12} /> {t('admin.challenges.delete', 'Delete')}
                              </button>
                            )}
                          </div>

                          {c.description && (
                            <p className="text-[12px] mt-3 mb-2" style={{ color: 'var(--color-text-secondary)' }}>{c.description}</p>
                          )}
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-[11px] bg-white/5 px-2 py-0.5 rounded-lg capitalize" style={{ color: 'var(--color-text-muted)' }}>{c.type.replace('_', ' ')}</span>
                            {badge.labelKey === 'admin.challenges.live' && (
                              <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                {t('admin.challenges.liveScoring', 'Live scoring')}
                              </span>
                            )}
                          </div>

                          {/* Rewards display */}
                          {(() => {
                            let rewards = null;
                            try { rewards = c.reward_description ? JSON.parse(c.reward_description) : null; } catch {}
                            if (!rewards || !Array.isArray(rewards)) return null;
                            const medals = ['🥇', '🥈', '🥉'];
                            return (
                              <div className="mb-4 rounded-xl p-3 border" style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}>
                                <div className="flex items-center gap-1.5 mb-2">
                                  <Gift size={12} style={{ color: 'var(--color-accent)' }} />
                                  <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-accent)' }}>{t('admin.challenges.rewards', 'Rewards')}</p>
                                </div>
                                <div className="space-y-1.5">
                                  {rewards.map((r, i) => (
                                    <div key={i} className="flex items-center gap-2 text-[12px]">
                                      <span>{medals[i]}</span>
                                      <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{r.points} pts</span>
                                      {r.prize && <span style={{ color: 'var(--color-text-secondary)' }}>+ {r.prize}</span>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Enrolled members */}
                          <div className="mb-4">
                            <SectionLabel className="mb-2">
                              {t('admin.challenges.participants', 'Participants')} · {c._participantCount}
                            </SectionLabel>
                            <ParticipantList challengeId={c.id} gymId={gymId} />
                          </div>

                          {/* Leaderboard — collapsed by default */}
                          <div>
                            <button
                              onClick={() => setLeaderboardOpen(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
                              className="flex items-center gap-2 w-full py-2.5 px-3 rounded-xl bg-white/4 hover:bg-white/6 border border-white/6 transition-colors"
                            >
                              <BarChart3 size={14} style={{ color: 'var(--color-accent)' }} />
                              <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('admin.challenges.viewLeaderboard', 'View Leaderboard')}</span>
                              <ChevronDown size={14} className={`ml-auto transition-transform ${leaderboardOpen[c.id] ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-muted)' }} />
                            </button>
                            {leaderboardOpen[c.id] && (
                              <ChallengeLeaderboard challenge={c} gymId={gymId} />
                            )}
                          </div>
                        </div>
                      )}
                    </AdminCard>
                  </FadeIn>
                );
              })}
            </div>
          );
        };

        return <>
          <AdminTabs tabs={tabs} active={tab} onChange={setTab} className="mb-5" />
          <SwipeableTabContent tabs={tabs} active={tab} onChange={setTab}>
            {(tabKey) => renderChallengeList(filterMap[tabKey] || [], tabKey)}
          </SwipeableTabContent>
        </>;
      })()}

      {/* Create modal */}
      {showCreate && (
        <ChallengeModal
          isOpen={showCreate}
          onClose={() => setShowCreate(false)}
          gymId={gymId}
          adminId={user.id}
        />
      )}

      {/* Edit modal */}
      {editChallenge && (
        <ChallengeModal
          isOpen={!!editChallenge}
          onClose={() => setEditChallenge(null)}
          gymId={gymId}
          adminId={user.id}
          challenge={editChallenge}
        />
      )}
    </AdminPageShell>
  );
}
