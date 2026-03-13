import { useEffect, useState } from 'react';
import { Plus, Trophy, X, ChevronDown, Users, Clock, Gift } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, isPast, isFuture } from 'date-fns';

// ── Participant list panel ─────────────────────────────────
const ParticipantList = ({ challengeId, gymId }) => {
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('challenge_participants')
        .select('profile_id, joined_at, profiles(full_name, avatar_url)')
        .eq('challenge_id', challengeId)
        .eq('gym_id', gymId)
        .order('joined_at', { ascending: true });
      setParticipants(data || []);
      setLoading(false);
    };
    fetch();
  }, [challengeId, gymId]);

  if (loading) return (
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

const CHALLENGE_TYPES = [
  { value: 'consistency', label: 'Consistency',    desc: 'Most workouts logged in the period' },
  { value: 'volume',      label: 'Total Volume',   desc: 'Most total weight lifted' },
  { value: 'pr_count',    label: 'PR Hunter',      desc: 'Most new personal records set' },
];

const statusBadge = (c) => {
  if (isFuture(new Date(c.start_date))) return { label: 'Upcoming', color: 'text-blue-400 bg-blue-500/10' };
  if (isPast(new Date(c.end_date)))     return { label: 'Ended',    color: 'text-[#6B7280] bg-white/6' };
  return                                       { label: 'Live',     color: 'text-emerald-400 bg-emerald-500/10' };
};

// ── Create modal ──────────────────────────────────────────
const CreateModal = ({ onClose, onCreated, gymId, adminId }) => {
  const [form, setForm] = useState({
    name: '', type: 'consistency', starts_at: '', ends_at: '', description: '',
    enableRewards: false,
    rewards: [
      { place: '1st', points: 500, prize: '' },
      { place: '2nd', points: 300, prize: '' },
      { place: '3rd', points: 150, prize: '' },
    ],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.name || !form.starts_at || !form.ends_at) {
      setError('Name, start date, and end date are required.');
      return;
    }
    setSaving(true);
    setError('');
    const rewardData = form.enableRewards
      ? JSON.stringify(form.rewards.map(r => ({ place: r.place, points: r.points, prize: r.prize || null })))
      : null;

    const { error: err } = await supabase.from('challenges').insert({
      gym_id:     gymId,
      created_by: adminId,
      name:       form.name,
      type:       form.type,
      description: form.description,
      reward_description: rewardData,
      start_date: new Date(form.starts_at).toISOString(),
      end_date:   new Date(form.ends_at).toISOString(),
      status:     'active',
    });
    if (err) { setError(err.message); setSaving(false); return; }
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/6">
          <p className="text-[16px] font-bold text-[#E5E7EB]">New Challenge</p>
          <button onClick={onClose}><X size={20} className="text-[#6B7280]" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Challenge Name</label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. March Volume Wars"
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Type</label>
            <div className="space-y-2">
              {CHALLENGE_TYPES.map(t => (
                <label key={t.value} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  form.type === t.value ? 'border-[#D4AF37]/40 bg-[#D4AF37]/5' : 'border-white/6 hover:border-white/12'
                }`}>
                  <input type="radio" name="type" value={t.value} checked={form.type === t.value}
                    onChange={e => set('type', e.target.value)} className="mt-0.5 accent-[#D4AF37]" />
                  <div>
                    <p className="text-[13px] font-semibold text-[#E5E7EB]">{t.label}</p>
                    <p className="text-[11px] text-[#6B7280]">{t.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Start Date</label>
              <input type="datetime-local" value={form.starts_at} onChange={e => set('starts_at', e.target.value)}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">End Date</label>
              <input type="datetime-local" value={form.ends_at} onChange={e => set('ends_at', e.target.value)}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Description (optional)</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              rows={2} placeholder="Tell members what this challenge is about…"
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none" />
          </div>

          {/* ── Rewards toggle ── */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className={`relative w-10 h-[22px] rounded-full transition-colors ${form.enableRewards ? 'bg-[#D4AF37]' : 'bg-[#1E293B]'}`}
                onClick={() => set('enableRewards', !form.enableRewards)}>
                <div className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-all ${form.enableRewards ? 'left-[22px]' : 'left-[3px]'}`} />
              </div>
              <div className="flex items-center gap-2">
                <Gift size={15} className={form.enableRewards ? 'text-[#D4AF37]' : 'text-[#6B7280]'} />
                <span className="text-[13px] font-medium text-[#E5E7EB]">Add Rewards</span>
              </div>
            </label>
            <p className="text-[11px] text-[#6B7280] mt-1 ml-[52px]">Incentivize participation with points and prizes</p>
          </div>

          {form.enableRewards && (
            <div className="space-y-3 bg-[#111827] rounded-xl p-4 border border-white/6">
              <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide">Reward per placement</p>
              {form.rewards.map((r, i) => {
                const medals = ['🥇', '🥈', '🥉'];
                return (
                  <div key={r.place} className="flex items-center gap-3">
                    <span className="text-[16px] w-6 text-center">{medals[i]}</span>
                    <div className="flex-1 flex gap-2">
                      <div className="w-24">
                        <input
                          type="number" min={0} value={r.points}
                          onChange={e => {
                            const updated = [...form.rewards];
                            updated[i] = { ...r, points: parseInt(e.target.value) || 0 };
                            set('rewards', updated);
                          }}
                          className="w-full bg-[#0F172A] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 text-center"
                        />
                        <p className="text-[10px] text-[#4B5563] text-center mt-0.5">points</p>
                      </div>
                      <div className="flex-1">
                        <input
                          value={r.prize}
                          onChange={e => {
                            const updated = [...form.rewards];
                            updated[i] = { ...r, prize: e.target.value };
                            set('rewards', updated);
                          }}
                          placeholder="e.g. Free smoothie, 1 PT session…"
                          className="w-full bg-[#0F172A] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
                        />
                        <p className="text-[10px] text-[#4B5563] mt-0.5">prize (optional)</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {error && <p className="text-[12px] text-red-400">{error}</p>}

          <button onClick={handleSave} disabled={saving}
            className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] disabled:opacity-50 transition-opacity">
            {saving ? 'Creating…' : 'Create Challenge'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Leaderboard panel ─────────────────────────────────────
const ChallengeLeaderboard = ({ challenge, gymId }) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchScores = async () => {
      setLoading(true);
      // Score based on challenge type
      if (challenge.type === 'consistency' || challenge.type === 'volume') {
        const { data } = await supabase
          .from('workout_sessions')
          .select('profile_id, total_volume_lbs, profiles(full_name)')
          .eq('gym_id', gymId)
          .eq('status', 'completed')
          .gte('started_at', challenge.start_date)
          .lte('started_at', challenge.end_date);

        // Aggregate per member
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
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expanded, setExpanded]     = useState(null);
  const [participantCounts, setParticipantCounts] = useState({});

  const load = async () => {
    if (!profile?.gym_id) return;
    const { data } = await supabase
      .from('challenges')
      .select('*')
      .eq('gym_id', profile.gym_id)
      .order('start_date', { ascending: false });
    setChallenges(data || []);
    setLoading(false);

    // Load participant counts for all challenges
    const { data: parts } = await supabase
      .from('challenge_participants')
      .select('challenge_id')
      .eq('gym_id', profile.gym_id);
    const counts = {};
    (parts || []).forEach(r => { counts[r.challenge_id] = (counts[r.challenge_id] || 0) + 1; });
    setParticipantCounts(counts);
  };

  useEffect(() => { load(); }, [profile?.gym_id]);

  return (
    <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">Challenges</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">Create and manage gym challenges</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#D4AF37] text-black font-bold text-[13px] rounded-xl hover:bg-[#C4A030] transition-colors">
          <Plus size={15} /> New Challenge
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : challenges.length === 0 ? (
        <div className="text-center py-20">
          <Trophy size={32} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">No challenges yet</p>
          <p className="text-[12px] text-[#4B5563] mt-1">Create your first challenge to get members competing</p>
        </div>
      ) : (
        <div className="space-y-3">
          {challenges.map(c => {
            const badge = statusBadge(c);
            const isOpen = expanded === c.id;
            return (
              <div key={c.id} className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
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
                    <span>{participantCounts[c.id] ?? 0}</span>
                  </div>
                  <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${badge.color} flex-shrink-0`}>
                    {badge.label}
                  </span>
                  <ChevronDown size={16} className={`text-[#6B7280] transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 border-t border-white/4">
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
                      <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide mb-2">
                        Participants · {participantCounts[c.id] ?? 0}
                      </p>
                      <ParticipantList challengeId={c.id} gymId={profile.gym_id} />
                    </div>

                    {/* Leaderboard */}
                    <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide mb-2">Leaderboard</p>
                    <ChallengeLeaderboard challenge={c} gymId={profile.gym_id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={load}
          gymId={profile.gym_id}
          adminId={user.id}
        />
      )}
    </div>
  );
}
