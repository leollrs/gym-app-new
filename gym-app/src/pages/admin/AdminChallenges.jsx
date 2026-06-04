import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { format, isPast, isFuture } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { es as esLocale } from 'date-fns/locale/es';
import { adminKeys } from '../../lib/adminQueryKeys';
import { logAdminAction } from '../../lib/adminAudit';
import posthog from 'posthog-js';
import { FadeIn, CardSkeleton, AdminPageShell, ErrorCard, AdminModal } from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import ChallengeModal from './components/ChallengeModal';
import ChallengeSuggestionCard from './components/ChallengeSuggestionCard';
import usePagedVisible from '../../hooks/usePagedVisible';
import PaginationFooter from '../../components/admin/PaginationFooter';
import {
  TK, FK, Ico, ICON, TYPE_ICON, Card, IconChip, Pill, OutPill, Label,
  PremiosBox, MiniAction, Avatar, PrimaryBtn, GhostBtn,
} from './components/retosKit';

// titleIcon adapter for AdminModal (it renders <TitleIcon size style/>; the kit
// Ico inherits the accent through currentColor via the passed style.color).
const SparkleIcon = (props) => <Ico ch={ICON.sparkle} {...props} />;

const parseRewards = (raw) => {
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
};

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
    <div style={{ padding: '12px 0', display: 'flex', justifyContent: 'center' }}>
      <span className="animate-spin" style={{ width: 16, height: 16, borderRadius: 99, border: `2px solid ${TK.borderSolid}`, borderTopColor: TK.accent, display: 'inline-block' }} />
    </div>
  );

  if (participants.length === 0) return (
    <div style={{ borderRadius: 13, border: `1px dashed ${TK.borderSolid}`, background: TK.surface2, padding: '26px 16px', textAlign: 'center', fontFamily: FK.body, fontSize: 13.5, color: TK.textFaint }}>
      {t('admin.challenges.noParticipants', 'No participants yet')}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {participants.map((p, i) => {
        const name = p.profiles?.full_name ?? '?';
        const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        return (
          <div key={p.profile_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '7px 14px 7px 7px', borderRadius: 999, background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
            <Avatar initials={initials} hue={i} size={26} />
            <span style={{ fontFamily: FK.body, fontSize: 13.5, fontWeight: 600, color: TK.text }}>{name}</span>
          </div>
        );
      })}
    </div>
  );
};

// ── Leaderboard panel ─────────────────────────────────────
const ChallengeLeaderboard = ({ challenge, gymId }) => {
  const { t } = useTranslation('pages');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchScores = async () => {
      setLoading(true);
      // Source of truth: challenge_participants.score (maintained by award/score
      // engine). Fall back to live aggregation if no participant rows exist yet.
      const { data: participants } = await supabase
        .from('challenge_participants')
        .select('profile_id, score, profiles(full_name)')
        .eq('challenge_id', challenge.id)
        .order('score', { ascending: false })
        .limit(10);

      if (participants && participants.length > 0) {
        setEntries(participants.map(p => ({
          id: p.profile_id,
          name: p.profiles?.full_name ?? '—',
          score: p.score ?? 0,
        })));
        setLoading(false);
        return;
      }

      // Fallback: live recompute (only over enrolled members)
      const { data: enrolled } = await supabase
        .from('challenge_participants')
        .select('profile_id')
        .eq('challenge_id', challenge.id);
      const enrolledIds = new Set((enrolled || []).map(e => e.profile_id));

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
          if (enrolledIds.size > 0 && !enrolledIds.has(s.profile_id)) return;
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
          if (enrolledIds.size > 0 && !enrolledIds.has(r.profile_id)) return;
          if (!agg[r.profile_id]) agg[r.profile_id] = { name: r.profiles?.full_name ?? '—', score: 0 };
          agg[r.profile_id].score++;
        });
        setEntries(Object.entries(agg).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.score - a.score).slice(0, 10));
      }
      setLoading(false);
    };

    // Subscribe to realtime changes — Supabase realtime can't filter by challenge_id
    // here (workout_sessions has no challenge_id column), so we debounce the
    // recompute to avoid running it on every single workout insert in the gym.
    let debounceHandle = null;
    const channel = supabase.channel(`challenge-${challenge.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'workout_sessions', filter: `gym_id=eq.${gymId}` },
        () => {
          if (debounceHandle) clearTimeout(debounceHandle);
          debounceHandle = setTimeout(() => fetchScores(), 1500);
        }
      )
      // Also listen for direct score updates on challenge_participants — those are
      // authoritative once the score engine runs. Filtered to this challenge only.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'challenge_participants', filter: `challenge_id=eq.${challenge.id}` },
        () => fetchScores()
      )
      .subscribe();

    fetchScores();
    return () => {
      if (debounceHandle) clearTimeout(debounceHandle);
      supabase.removeChannel(channel);
    };
    // Depend on challenge.id, not the whole object — a parent refetch that
    // produces a new challenge reference (same id) would otherwise tear down +
    // re-subscribe the channel. id/type/dates are immutable for a challenge.
  }, [challenge.id, gymId]);

  const scoreLabel = challenge.type === 'volume' ? t('admin.challenges.scoreLbs', 'lbs') : challenge.type === 'consistency' ? t('admin.challenges.scoreWorkouts', 'workouts') : t('admin.challenges.scorePRs', 'PRs');

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {loading ? (
        <div style={{ padding: '16px 0', display: 'flex', justifyContent: 'center' }}>
          <span className="animate-spin" style={{ width: 18, height: 18, borderRadius: 99, border: `2px solid ${TK.borderSolid}`, borderTopColor: TK.accent, display: 'inline-block' }} />
        </div>
      ) : entries.length === 0 ? (
        <div style={{ padding: '20px 0', textAlign: 'center', fontFamily: FK.body, fontSize: 13.5, color: TK.textFaint }}>{t('admin.challenges.noActivity', 'No activity yet')}</div>
      ) : (
        entries.map((e, i) => (
          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
            <span style={{ fontFamily: FK.display, fontSize: 14, fontWeight: 800, width: 22, textAlign: 'center', color: i === 0 ? TK.accent : i === 1 ? TK.textSub : i === 2 ? '#C77B3E' : TK.textMute }}>{i + 1}</span>
            <span style={{ flex: 1, fontFamily: FK.body, fontSize: 13.5, fontWeight: 600, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
            <span style={{ fontFamily: FK.mono, fontSize: 12.5, fontWeight: 700, color: TK.textSub, whiteSpace: 'nowrap' }}>{e.score.toLocaleString()} {scoreLabel}</span>
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
  const ord = (n) => isEs ? `${n}º` : `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n] || 'th'}`;
  const placeWord = t('admin.challenges.place', 'place');

  const [showCreate, setShowCreate] = useState(false);
  const [editChallenge, setEditChallenge] = useState(null);
  const [expanded, setExpanded]     = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [tab, setTab] = useState('active');
  // Single pager shared across tabs — SwipeableTabContent only renders one
  // tab at a time, and we reset to the initial view on tab change so the
  // count starts fresh after a switch.
  const challengePager = usePagedVisible({ initial: 10, step: 10 });
  useEffect(() => { challengePager.reset(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [awardingId, setAwardingId] = useState(null);
  const [leaderboardOpen, setLeaderboardOpen] = useState({});
  const [showTemplates, setShowTemplates] = useState(false);

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
      posthog?.capture('admin_challenge_deleted');
      queryClient.invalidateQueries({ queryKey: adminKeys.challenges(gymId) });
      showToast(t('admin.challenges.challengeDeleted', 'Challenge deleted'), 'success');
      setDeleteConfirm(null);
      if (expanded === deleteConfirm) setExpanded(null);
    },
    onError: (err) => { showToast(err.message, 'error'); setDeleteConfirm(null); },
  });

  // ── one challenge card ──
  const renderCard = (c, idx) => {
    const isOpen = expanded === c.id;
    const start = new Date(c.start_date);
    const end = new Date(c.end_date);
    const isEnded = isPast(end);
    const isUpcoming = isFuture(start);
    const isLive = !isUpcoming && !isEnded;
    const dates = `${format(start, 'MMM d', dateFnsLocale)} – ${format(end, 'MMM d, yyyy', dateFnsLocale)}`;
    const rewards = parseRewards(c.reward_description);
    const typeLabel = t(`admin.challengeTypes.${c.type}`, (c.type || '').replace('_', ' '));
    const typeIcon = TYPE_ICON[c.type] || ICON.target;

    const hasRewardConfig = (() => {
      if (!c.reward_description) return false;
      try { const parsed = JSON.parse(c.reward_description); if (Array.isArray(parsed)) return parsed.length > 0; } catch {}
      return String(c.reward_description).trim().length > 0;
    })();

    const statusEl = isUpcoming
      ? <OutPill tone="accent">{t('admin.challenges.upcoming', 'Upcoming')}</OutPill>
      : isEnded
        ? <OutPill>{t('admin.challenges.ended', 'Ended')}</OutPill>
        : <OutPill tone="good" dot>{t('admin.challenges.live', 'Live')}</OutPill>;

    let prizeEl = null;
    if (isEnded) {
      if (c._prizesAwarded) prizeEl = <OutPill tone="good">{t('admin.challenges.pillPrizesAwarded', 'Prizes awarded')}</OutPill>;
      else if (hasRewardConfig) prizeEl = <OutPill tone="warn">{t('admin.challenges.pillAwaitingPrize', 'Awaiting prize award')}</OutPill>;
      else prizeEl = <OutPill>{t('admin.challenges.pillNoPrizes', 'No prizes set')}</OutPill>;
    }

    const awarding = awardPrizesMutation.isPending && awardingId === c.id;

    return (
      <FadeIn key={c.id} delay={idx * 40}>
        <Card style={{ overflow: 'hidden' }}>
          {/* header (toggles expand) */}
          <button type="button" onClick={() => setExpanded(isOpen ? null : c.id)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 16, padding: '18px 20px', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <IconChip ch={ICON.trophy} tone="accent" size={46} r={14} strokeW={1.9} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FK.display, fontSize: 17.5, fontWeight: 800, color: TK.text, letterSpacing: -0.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
              <div style={{ fontFamily: FK.mono, fontSize: 13, color: TK.textMute, marginTop: 4 }}>{dates}</div>
              {/* mobile-only status row */}
              <div className="sm:hidden" style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>{statusEl}{prizeEl}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, flexShrink: 0 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FK.mono, fontSize: 13.5, fontWeight: 700, color: TK.textSub }}>
                <Ico ch={ICON.users} size={15} color={TK.textMute} stroke={2} />{c._participantCount}
              </span>
              {prizeEl && <span className="hidden sm:inline-flex">{prizeEl}</span>}
              <span className="hidden sm:inline-flex">{statusEl}</span>
              <span style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${TK.borderSolid}`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Ico ch={isOpen ? ICON.chevU : ICON.chevD} size={17} color={TK.textMute} stroke={2} />
              </span>
            </div>
          </button>

          {/* expanded body */}
          {isOpen && (
            <div style={{ borderTop: `1px solid ${TK.divider}`, padding: '20px 20px 22px' }}>
              {/* awarded banner */}
              {isEnded && c._prizesAwarded && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, height: 50, borderRadius: 13, marginBottom: 18, background: 'var(--color-success-soft)', border: '1px solid color-mix(in srgb, var(--color-success) 35%, transparent)', fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: 'var(--color-success-ink, var(--color-success))' }}>
                  <Ico ch={ICON.medal} size={18} color="var(--color-success)" stroke={2} />{t('admin.challenges.prizesAwarded', 'Prizes awarded!')}
                </div>
              )}
              {/* award button */}
              {isEnded && hasRewardConfig && !c._prizesAwarded && (
                <button type="button" onClick={() => { setAwardingId(c.id); awardPrizesMutation.mutate(c.id); }} disabled={awarding}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, height: 50, borderRadius: 13, marginBottom: 18, border: 'none', cursor: awarding ? 'default' : 'pointer', background: TK.accent, color: '#fff', fontFamily: FK.body, fontSize: 14.5, fontWeight: 800, boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)', opacity: awarding ? 0.6 : 1 }}>
                  <Ico ch={ICON.award} size={18} color="#fff" stroke={2.2} />{awarding ? '…' : t('admin.challenges.awardPrizes', 'Award Prizes')}
                </button>
              )}

              {/* actions row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                <MiniAction icon={ICON.edit} onClick={() => setEditChallenge(c)}>{t('admin.challenges.edit', 'Edit')}</MiniAction>
                {deleteConfirm === c.id ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: FK.body, fontSize: 12.5, color: 'var(--color-danger)' }}>{t('admin.challenges.deleteConfirm')}</span>
                    <button type="button" onClick={() => deleteMutation.mutate(c.id)} disabled={deleteMutation.isPending}
                      style={{ padding: '8px 14px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: FK.body, fontSize: 12.5, fontWeight: 800, color: '#fff', background: 'var(--color-danger)', opacity: deleteMutation.isPending ? 0.6 : 1 }}>
                      {deleteMutation.isPending ? t('admin.challenges.deleting', 'Deleting…') : t('admin.challenges.confirm', 'Confirm')}
                    </button>
                    <button type="button" onClick={() => setDeleteConfirm(null)}
                      style={{ padding: '8px 14px', borderRadius: 999, cursor: 'pointer', fontFamily: FK.body, fontSize: 12.5, fontWeight: 700, color: TK.textSub, background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
                      {t('admin.challenges.cancel', 'Cancel')}
                    </button>
                  </span>
                ) : (
                  <MiniAction icon={ICON.trash} danger onClick={() => setDeleteConfirm(c.id)}>{t('admin.challenges.delete', 'Delete')}</MiniAction>
                )}
                <span style={{ flex: 1 }} />
                {isLive && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: FK.body, fontSize: 13, fontWeight: 700, color: 'var(--color-success)' }}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--color-success)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--color-success) 18%, transparent)' }} />
                    {t('admin.challenges.liveScoring', 'Live scoring')}
                  </span>
                )}
                <Pill tone="neutral" icon={typeIcon}>{typeLabel}</Pill>
              </div>

              {/* description */}
              {c.description && (
                <p style={{ margin: '18px 0 0', fontFamily: FK.body, fontSize: 15, color: TK.text, lineHeight: 1.5, fontWeight: 500 }}>{c.description}</p>
              )}

              {/* prizes */}
              {rewards.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <PremiosBox rewards={rewards} title={t('admin.challenges.rewards', 'Prizes')} placeWord={placeWord} ordinal={ord} />
                </div>
              )}

              {/* participants */}
              <div style={{ marginTop: 20 }}>
                <Label style={{ marginBottom: 12 }}>{t('admin.challenges.participants', 'Participants')} · {c._participantCount}</Label>
                <ParticipantList challengeId={c.id} gymId={gymId} />
              </div>

              {/* leaderboard */}
              <div style={{ marginTop: 18, borderRadius: 13, border: `1px solid ${TK.borderSolid}`, background: TK.surface2, overflow: 'hidden' }}>
                <button type="button" onClick={() => setLeaderboardOpen(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', cursor: 'pointer', background: 'transparent', border: 'none' }}>
                  <Ico ch={ICON.bar} size={17} color={TK.accent} stroke={2.1} />
                  <span style={{ flex: 1, textAlign: 'left', fontFamily: FK.body, fontSize: 14, fontWeight: 700, color: TK.text }}>{t('admin.challenges.viewLeaderboard', 'View Leaderboard')}</span>
                  <Ico ch={leaderboardOpen[c.id] ? ICON.chevU : ICON.chevD} size={18} color={TK.textMute} stroke={2} />
                </button>
                {leaderboardOpen[c.id] && (
                  <div style={{ borderTop: `1px solid ${TK.divider}`, padding: '4px 14px 14px' }}>
                    <ChallengeLeaderboard challenge={c} gymId={gymId} />
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      </FadeIn>
    );
  };

  return (
    <AdminPageShell>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="admin-page-title" style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>{t('admin.challenges.title', 'Challenges')}</h1>
          <div style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, marginTop: 9 }}>{t('admin.challenges.subtitle', 'Create and manage gym challenges')}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, flexShrink: 0, flexWrap: 'wrap' }}>
          <GhostBtn icon={ICON.sparkle} accentIcon onClick={() => setShowTemplates(true)}>{t('admin.challenges.quickTemplates', 'Quick Templates')}</GhostBtn>
          <PrimaryBtn icon={ICON.plus} onClick={() => setShowCreate(true)}>{t('admin.challenges.newChallenge', 'New Challenge')}</PrimaryBtn>
        </div>
      </div>

      {/* AI Suggestion (self-spaces with marginTop; renders null when none) */}
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
            posthog?.capture('admin_challenge_created', { source: 'ai_suggestion', type: suggestion.challenge_type });
            queryClient.invalidateQueries({ queryKey: adminKeys.challenges(gymId) });
            showToast(t('admin.challenges.challengeCreated', 'Reto creado'), 'success');
          } catch (err) {
            showToast(err.message || 'Error', 'error');
          }
        }}
      />

      {/* Tabs + content */}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 22 }}>
              {[0, 1, 2].map(i => <CardSkeleton key={i} h="h-[84px]" />)}
            </div>
          );
          if (isError) return (
            <div style={{ marginTop: 22 }}><ErrorCard message={t('common:failedToLoadData')} onRetry={refetch} /></div>
          );
          if (filtered.length === 0) return (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <Ico ch={ICON.trophy} size={34} color={TK.textMute} stroke={1.6} style={{ margin: '0 auto 12px' }} />
              <p style={{ fontFamily: FK.body, fontSize: 14, color: TK.textMute, margin: 0 }}>{emptyMsgMap[tabKey]}</p>
              <p style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textFaint, margin: '4px 0 18px' }}>{t('admin.challenges.noChallengesHint', 'Create your first challenge to get members competing')}</p>
              <div style={{ display: 'inline-flex' }}>
                <PrimaryBtn icon={ICON.plus} onClick={() => setShowCreate(true)}>{t('admin.challenges.createFirst', 'Create your first challenge')}</PrimaryBtn>
              </div>
            </div>
          );
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 22 }}>
              {filtered.slice(0, challengePager.visibleCount).map((c, idx) => renderCard(c, idx))}
              <PaginationFooter pager={challengePager} total={filtered.length} />
            </div>
          );
        };

        return <>
          {/* RetoTab row */}
          <div style={{ display: 'flex', marginTop: 24, borderBottom: `1px solid ${TK.borderSolid}` }}>
            {tabs.map(tb => {
              const on = tab === tb.key;
              return (
                <button key={tb.key} type="button" onClick={() => setTab(tb.key)}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, paddingBottom: 16, position: 'relative', cursor: 'pointer', background: 'transparent', border: 'none' }}>
                  <span style={{ fontFamily: FK.body, fontSize: 14.5, fontWeight: on ? 700 : 600, color: on ? TK.accent : TK.textMute }}>{tb.label}</span>
                  <span style={{ minWidth: 22, height: 22, padding: '0 7px', borderRadius: 999, display: 'grid', placeItems: 'center', fontFamily: FK.mono, fontSize: 12, fontWeight: 800, background: on ? TK.accentSoft : TK.surface2, color: on ? TK.accentInk : TK.textFaint, border: `1px solid ${on ? TK.accentLine : TK.borderSolid}` }}>{tb.count}</span>
                  {on && <span style={{ position: 'absolute', left: '34%', right: '34%', bottom: -1, height: 2.5, borderRadius: 99, background: TK.accent }} />}
                </button>
              );
            })}
          </div>
          <SwipeableTabContent tabs={tabs} active={tab} onChange={setTab}>
            {(tabKey) => renderChallengeList(filterMap[tabKey] || [], tabKey)}
          </SwipeableTabContent>
        </>;
      })()}

      {/* Quick Templates modal */}
      <AdminModal
        isOpen={showTemplates}
        onClose={() => setShowTemplates(false)}
        title={t('admin.challenges.quickTemplates', 'Quick Templates')}
        titleIcon={SparkleIcon}
        subtitle={t('admin.challenges.quickTemplatesSub', 'Launch a challenge in seconds')}
        size="md"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { id: 'streak5', icon: ICON.flame, tone: 'hot', title: t('admin.challenges.tpl5Streak', '5-Day Streak'), desc: t('admin.challenges.tpl5StreakDesc', 'Visit 5 days in a row') },
            { id: 'prparty', icon: ICON.trophy, tone: 'warn', title: t('admin.challenges.tplPRParty', 'PR Party'), desc: t('admin.challenges.tplPRPartyDesc', 'Set any PR this week') },
            { id: 'bringfriend', icon: ICON.users, tone: 'coach', title: t('admin.challenges.tplBringFriend', 'Bring a Friend'), desc: t('admin.challenges.tplBringFriendDesc', 'Referral bonus doubled') },
          ].map((tpl) => (
            <button key={tpl.id} type="button" onClick={() => { setShowTemplates(false); setShowCreate(true); }}
              style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', borderRadius: 16, padding: '18px 18px 16px', background: TK.surface2, border: `1px solid ${TK.borderSolid}`, cursor: 'pointer' }}>
              <IconChip ch={tpl.icon} tone={tpl.tone} size={44} r={13} strokeW={2} />
              <div style={{ fontFamily: FK.display, fontSize: 16.5, fontWeight: 800, color: TK.text, letterSpacing: -0.3, marginTop: 14 }}>{tpl.title}</div>
              <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, lineHeight: 1.45, marginTop: 6, flex: 1 }}>{tpl.desc}</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${TK.divider}`, fontFamily: FK.body, fontSize: 13, fontWeight: 800, color: TK.accent }}>
                <Ico ch={ICON.sparkle} size={14} color={TK.accent} stroke={2.2} />{t('admin.challenges.useTemplate', 'Use template')}
              </div>
            </button>
          ))}
        </div>
      </AdminModal>

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
