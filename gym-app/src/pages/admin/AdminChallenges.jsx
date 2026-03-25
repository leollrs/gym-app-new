import { useEffect, useState } from 'react';
import { Plus, Trophy, ChevronDown, Users, Gift, Pencil, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { format, isPast, isFuture } from 'date-fns';
import { adminKeys } from '../../lib/adminQueryKeys';
import { PageHeader, AdminCard, FadeIn, CardSkeleton, SectionLabel } from '../../components/admin';
import ChallengeModal from './components/ChallengeModal';

// ── Participant list panel ─────────────────────────────────
const ParticipantList = ({ challengeId, gymId }) => {
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
      <div className="w-4 h-4 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
    </div>
  );

  if (participants.length === 0) return (
    <p className="text-[12px] text-[#6B7280] text-center py-2">No participants yet</p>
  );

  return (
    <div className="flex flex-wrap gap-2">
      {participants.map(p => {
        const name = p.profiles?.full_name ?? '?';
        const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        return (
          <div key={p.profile_id} className="flex items-center gap-1.5 bg-[#111827] rounded-xl px-2.5 py-1.5">
            <div className="w-6 h-6 rounded-full bg-[#D4AF37]/20 flex items-center justify-center flex-shrink-0">
              <span className="text-[9px] font-bold text-[#D4AF37]">{initials}</span>
            </div>
            <span className="text-[11px] font-medium text-[#E5E7EB]">{name}</span>
          </div>
        );
      })}
    </div>
  );
};

const statusBadge = (c) => {
  if (isFuture(new Date(c.start_date))) return { label: 'Upcoming', color: 'text-blue-400 bg-blue-500/10' };
  if (isPast(new Date(c.end_date)))     return { label: 'Ended',    color: 'text-[#6B7280] bg-white/6' };
  return                                       { label: 'Live',     color: 'text-emerald-400 bg-emerald-500/10' };
};

// ── Leaderboard panel ─────────────────────────────────────
const ChallengeLeaderboard = ({ challenge, gymId }) => {
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

  const scoreLabel = challenge.type === 'volume' ? 'lbs' : challenge.type === 'consistency' ? 'workouts' : 'PRs';

  return (
    <div className="mt-3 space-y-2">
      {loading ? (
        <div className="py-4 flex justify-center">
          <div className="w-5 h-5 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-[12px] text-[#6B7280] text-center py-3">No activity yet</p>
      ) : (
        entries.map((e, i) => (
          <div key={e.id} className="flex items-center gap-3 py-2 px-3 bg-[#111827] rounded-xl">
            <span className={`text-[13px] font-bold w-5 text-center ${i === 0 ? 'text-[#D4AF37]' : i === 1 ? 'text-[#9CA3AF]' : i === 2 ? 'text-amber-700' : 'text-[#4B5563]'}`}>
              {i + 1}
            </span>
            <p className="flex-1 text-[13px] font-medium text-[#E5E7EB] truncate">{e.name}</p>
            <p className="text-[12px] font-semibold text-[#9CA3AF]">
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
  const { profile, user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  const [showCreate, setShowCreate] = useState(false);
  const [editChallenge, setEditChallenge] = useState(null);
  const [expanded, setExpanded]     = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => { document.title = 'Admin - Challenges | TuGymPR'; }, []);

  // ── Fetch challenges ──
  const { data: challenges = [], isLoading } = useQuery({
    queryKey: adminKeys.challenges(gymId),
    queryFn: async () => {
      const [{ data: challengeData }, { data: parts }] = await Promise.all([
        supabase
          .from('challenges')
          .select('*')
          .eq('gym_id', gymId)
          .order('start_date', { ascending: false }),
        supabase
          .from('challenge_participants')
          .select('challenge_id')
          .eq('gym_id', gymId),
      ]);
      // Attach participant counts to each challenge
      const counts = {};
      (parts || []).forEach(r => { counts[r.challenge_id] = (counts[r.challenge_id] || 0) + 1; });
      return (challengeData || []).map(c => ({ ...c, _participantCount: counts[c.id] || 0 }));
    },
    enabled: !!gymId,
  });

  // ── Delete mutation ──
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await supabase.from('challenge_participants').delete().eq('challenge_id', id);
      const { error } = await supabase.from('challenges').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.challenges(gymId) });
      showToast('Challenge deleted', 'success');
      setDeleteConfirm(null);
      if (expanded === deleteConfirm) setExpanded(null);
    },
    onError: (err) => { showToast(err.message, 'error'); setDeleteConfirm(null); },
  });

  return (
    <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
      <PageHeader
        title="Challenges"
        subtitle="Create and manage gym challenges"
        actions={
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#D4AF37] text-black font-bold text-[13px] rounded-xl hover:bg-[#C4A030] transition-colors">
            <Plus size={15} /> New Challenge
          </button>
        }
        className="mb-6"
      />

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <CardSkeleton key={i} h="h-[80px]" />)}
        </div>
      ) : challenges.length === 0 ? (
        <div className="text-center py-20">
          <Trophy size={32} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">No challenges yet</p>
          <p className="text-[12px] text-[#4B5563] mt-1">Create your first challenge to get members competing</p>
        </div>
      ) : (
        <div className="space-y-3">
          {challenges.map((c, idx) => {
            const badge = statusBadge(c);
            const isOpen = expanded === c.id;
            return (
              <FadeIn key={c.id} delay={idx * 40}>
                <AdminCard hover className="overflow-hidden !p-0">
                  <button className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/2 transition-colors"
                    onClick={() => setExpanded(isOpen ? null : c.id)}>
                    <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                      <Trophy size={17} className="text-[#D4AF37]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{c.name}</p>
                      <p className="text-[11px] text-[#6B7280]">
                        {format(new Date(c.start_date), 'MMM d')} – {format(new Date(c.end_date), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-[#6B7280] flex-shrink-0">
                      <Users size={11} />
                      <span>{c._participantCount}</span>
                    </div>
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${badge.color} flex-shrink-0`}>
                      {badge.label}
                    </span>
                    <ChevronDown size={16} className={`text-[#6B7280] transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-white/4">
                      {/* Edit / Delete buttons */}
                      <div className="flex items-center gap-2 mt-3 mb-3">
                        <button onClick={(e) => { e.stopPropagation(); setEditChallenge(c); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-[#E5E7EB] bg-white/5 hover:bg-white/10 border border-white/6 rounded-lg transition-colors">
                          <Pencil size={12} /> Edit
                        </button>
                        {deleteConfirm === c.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] text-red-400">Delete this challenge?</span>
                            <button onClick={() => deleteMutation.mutate(c.id)} disabled={deleteMutation.isPending}
                              className="px-3 py-1.5 text-[12px] font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50">
                              {deleteMutation.isPending ? 'Deleting...' : 'Confirm'}
                            </button>
                            <button onClick={() => setDeleteConfirm(null)}
                              className="px-3 py-1.5 text-[12px] font-medium text-[#9CA3AF] bg-white/5 hover:bg-white/10 rounded-lg transition-colors">
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(c.id); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-red-400 bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 rounded-lg transition-colors">
                            <Trash2 size={12} /> Delete
                          </button>
                        )}
                      </div>

                      {c.description && (
                        <p className="text-[12px] text-[#9CA3AF] mt-3 mb-2">{c.description}</p>
                      )}
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-[11px] text-[#6B7280] bg-white/5 px-2 py-0.5 rounded-lg capitalize">{c.type.replace('_', ' ')}</span>
                        {badge.label === 'Live' && (
                          <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Live scoring
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
                          <div className="mb-4 bg-[#111827] rounded-xl p-3 border border-[#D4AF37]/10">
                            <div className="flex items-center gap-1.5 mb-2">
                              <Gift size={12} className="text-[#D4AF37]" />
                              <p className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-wide">Rewards</p>
                            </div>
                            <div className="space-y-1.5">
                              {rewards.map((r, i) => (
                                <div key={i} className="flex items-center gap-2 text-[12px]">
                                  <span>{medals[i]}</span>
                                  <span className="text-[#E5E7EB] font-medium">{r.points} pts</span>
                                  {r.prize && <span className="text-[#9CA3AF]">+ {r.prize}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Enrolled members */}
                      <div className="mb-4">
                        <SectionLabel className="mb-2">
                          Participants · {c._participantCount}
                        </SectionLabel>
                        <ParticipantList challengeId={c.id} gymId={gymId} />
                      </div>

                      {/* Leaderboard */}
                      <SectionLabel className="mb-2">Leaderboard</SectionLabel>
                      <ChallengeLeaderboard challenge={c} gymId={gymId} />
                    </div>
                  )}
                </AdminCard>
              </FadeIn>
            );
          })}
        </div>
      )}

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
    </div>
  );
}
