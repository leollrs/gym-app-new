import { useEffect, useState, useMemo } from 'react';
import { Search, X, ChevronRight, Trophy, FileText, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, subDays, formatDistanceToNow } from 'date-fns';
import { churnScore, riskLabel } from './AdminOverview';

// ── Member detail modal ────────────────────────────────────
const MemberModal = ({ member, onClose, onNoteSaved }) => {
  const [sessions,   setSessions]   = useState([]);
  const [prs,        setPrs]        = useState([]);
  const [challenges, setChallenges] = useState(0);
  const [note,       setNote]       = useState(member.admin_note ?? '');
  const [noteSaving, setNoteSaving] = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [tab,        setTab]        = useState('workouts');

  useEffect(() => {
    const load = async () => {
      const [sessRes, prRes, chalRes] = await Promise.all([
        supabase
          .from('workout_sessions')
          .select('id, name, started_at, duration_seconds, total_volume_lbs')
          .eq('profile_id', member.id)
          .eq('status', 'completed')
          .order('started_at', { ascending: false })
          .limit(10),
        supabase
          .from('personal_records')
          .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name)')
          .eq('profile_id', member.id)
          .order('estimated_1rm', { ascending: false })
          .limit(8),
        supabase
          .from('challenge_participants')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', member.id),
      ]);
      setSessions(sessRes.data || []);
      setPrs(prRes.data || []);
      setChallenges(chalRes.count ?? 0);
      setLoading(false);
    };
    load();
  }, [member.id]);

  const handleSaveNote = async () => {
    setNoteSaving(true);
    await supabase.from('profiles').update({ admin_note: note || null }).eq('id', member.id);
    setNoteSaving(false);
    onNoteSaved(member.id, note);
  };

  const risk = riskLabel(member.score);
  const daysInactive = member.last_active_at
    ? Math.floor((Date.now() - new Date(member.last_active_at)) / 86400000)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/6 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#1E293B] flex items-center justify-center flex-shrink-0">
              <span className="text-[15px] font-bold text-[#9CA3AF]">{member.full_name[0]}</span>
            </div>
            <div>
              <p className="text-[15px] font-bold text-[#E5E7EB]">{member.full_name}</p>
              <p className="text-[11px] text-[#6B7280]">@{member.username} · joined {format(new Date(member.created_at), 'MMM yyyy')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 border-b border-white/6 flex-shrink-0">
          {[
            { label: 'Risk',       value: <span className={risk.color}>{risk.label}</span>, sub: `score ${member.score}` },
            { label: 'Inactive',   value: daysInactive !== null ? `${daysInactive}d` : '—', sub: 'days' },
            { label: 'Workouts',   value: member.recentWorkouts ?? 0, sub: 'last 14d' },
            { label: 'Challenges', value: challenges, sub: 'joined' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="py-3 px-2 text-center border-r border-white/4 last:border-0">
              <p className="text-[15px] font-bold text-[#E5E7EB] leading-none">{value}</p>
              <p className="text-[10px] text-[#6B7280] mt-0.5">{label}</p>
              <p className="text-[10px] text-[#4B5563]">{sub}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/6 flex-shrink-0">
          {[{ key: 'workouts', label: 'Workouts' }, { key: 'prs', label: 'PRs' }].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 text-[13px] font-semibold transition-colors ${
                tab === t.key
                  ? 'text-[#D4AF37] border-b-2 border-[#D4AF37] -mb-px'
                  : 'text-[#6B7280] hover:text-[#9CA3AF]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
            </div>
          ) : tab === 'workouts' ? (
            sessions.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] text-center py-6">No workouts logged</p>
            ) : (
              <div className="space-y-2">
                {sessions.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-[#111827] rounded-xl">
                    <div>
                      <p className="text-[13px] font-medium text-[#E5E7EB]">{s.name || 'Workout'}</p>
                      <p className="text-[11px] text-[#6B7280]">{format(new Date(s.started_at), 'MMM d, yyyy')}</p>
                    </div>
                    <div className="text-right">
                      {s.total_volume_lbs > 0 && (
                        <p className="text-[12px] font-semibold text-[#9CA3AF]">{Math.round(s.total_volume_lbs).toLocaleString()} lbs</p>
                      )}
                      {s.duration_seconds > 0 && (
                        <p className="text-[11px] text-[#6B7280]">{Math.floor(s.duration_seconds / 60)}m</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            prs.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] text-center py-6">No PRs recorded yet</p>
            ) : (
              <div className="space-y-2">
                {prs.map((pr, i) => (
                  <div key={pr.exercise_id} className="flex items-center gap-3 p-3 bg-[#111827] rounded-xl">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${i < 3 ? 'bg-[#D4AF37]/12' : 'bg-white/4'}`}>
                      <Trophy size={13} className={i < 3 ? 'text-[#D4AF37]' : 'text-[#4B5563]'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{pr.exercises?.name ?? pr.exercise_id}</p>
                      {pr.achieved_at && (
                        <p className="text-[11px] text-[#6B7280]">{format(new Date(pr.achieved_at), 'MMM d, yyyy')}</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[13px] font-bold text-[#E5E7EB]">{pr.weight_lbs} lbs × {pr.reps}</p>
                      {pr.estimated_1rm > 0 && (
                        <p className="text-[10px] text-[#6B7280]">{Math.round(pr.estimated_1rm)} lbs est. 1RM</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Admin note — always visible regardless of tab */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <FileText size={12} className="text-[#6B7280]" />
              <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">Admin Note</p>
            </div>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder="e.g. Reached out Jan 5 — no response. At risk of churning."
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none transition-colors"
            />
            <button
              onClick={handleSaveNote}
              disabled={noteSaving || note === (member.admin_note ?? '')}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-40"
              style={{ background: 'rgba(212,175,55,0.12)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.25)' }}
            >
              <Save size={12} /> {noteSaving ? 'Saving…' : 'Save Note'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────
export default function AdminMembers() {
  const { profile } = useAuth();
  const [members, setMembers]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState('all');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoading(true);
      const gymId = profile.gym_id;

      const { data: memberRows } = await supabase
        .from('profiles')
        .select('id, full_name, username, last_active_at, created_at, admin_note')
        .eq('gym_id', gymId)
        .eq('role', 'member')
        .order('last_active_at', { ascending: false, nullsFirst: false });

      const fourteenDaysAgo = subDays(new Date(), 14).toISOString();
      const { data: recentSessions } = await supabase
        .from('workout_sessions')
        .select('profile_id')
        .eq('gym_id', gymId)
        .eq('status', 'completed')
        .gte('started_at', fourteenDaysAgo);

      const recentCounts = {};
      (recentSessions || []).forEach(s => {
        recentCounts[s.profile_id] = (recentCounts[s.profile_id] || 0) + 1;
      });

      const scored = (memberRows || []).map(m => ({
        ...m,
        recentWorkouts: recentCounts[m.id] ?? 0,
        score: churnScore(m, recentCounts[m.id] ?? 0),
      }));

      setMembers(scored);
      setLoading(false);
    };
    load();
  }, [profile?.gym_id]);

  const handleNoteSaved = (memberId, newNote) => {
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, admin_note: newNote } : m));
    setSelected(prev => prev?.id === memberId ? { ...prev, admin_note: newNote } : prev);
  };

  const atRiskCount  = members.filter(m => m.score >= 61).length;
  const watchCount   = members.filter(m => m.score >= 31 && m.score < 61).length;
  const healthyCount = members.filter(m => m.score < 31).length;

  const filtered = useMemo(() => {
    let list = members;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        m.full_name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q)
      );
    }
    if (filter === 'at-risk') list = list.filter(m => m.score >= 61);
    else if (filter === 'watch')   list = list.filter(m => m.score >= 31 && m.score < 61);
    else if (filter === 'healthy') list = list.filter(m => m.score < 31);
    return list;
  }, [members, search, filter]);

  const filters = [
    { key: 'all',      label: `All (${members.length})` },
    { key: 'at-risk',  label: `At Risk (${atRiskCount})` },
    { key: 'watch',    label: `Watch (${watchCount})` },
    { key: 'healthy',  label: `Healthy (${healthyCount})` },
  ];

  return (
    <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#E5E7EB]">Members</h1>
        <p className="text-[13px] text-[#6B7280] mt-0.5">{members.length} total · {atRiskCount} at risk</p>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
          <input
            type="text"
            placeholder="Search members…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#0F172A] border border-white/6 rounded-xl pl-9 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-2 rounded-xl text-[12px] font-medium transition-colors ${
                filter === f.key
                  ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                  : 'bg-[#0F172A] border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Member list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[#6B7280] text-[14px]">No members found</p>
        </div>
      ) : (
        <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
          <div className="divide-y divide-white/4">
            {filtered.map(m => {
              const risk = riskLabel(m.score);
              return (
                <button
                  key={m.id}
                  onClick={() => setSelected(m)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/2 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-[#1E293B] flex items-center justify-center flex-shrink-0">
                    <span className="text-[13px] font-bold text-[#9CA3AF]">{m.full_name[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{m.full_name}</p>
                      {m.admin_note && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]/60 flex-shrink-0" title="Has note" />
                      )}
                    </div>
                    <p className="text-[11px] text-[#6B7280]">
                      {m.last_active_at
                        ? `Active ${formatDistanceToNow(new Date(m.last_active_at), { addSuffix: true })}`
                        : 'Never active'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5 flex-shrink-0">
                    <div className="text-right hidden sm:block">
                      <p className="text-[12px] font-semibold text-[#9CA3AF]">{m.recentWorkouts}w / 14d</p>
                    </div>
                    <span className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${risk.color} ${risk.bg}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${risk.dot}`} />
                      {m.score}
                    </span>
                    <ChevronRight size={14} className="text-[#4B5563]" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selected && (
        <MemberModal
          member={selected}
          onClose={() => setSelected(null)}
          onNoteSaved={handleNoteSaved}
        />
      )}
    </div>
  );
}
