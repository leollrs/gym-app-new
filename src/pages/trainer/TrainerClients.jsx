import { useEffect, useState } from 'react';
import { Users, X, Trophy, Dumbbell, ChevronRight, Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, formatDistanceToNow, subDays } from 'date-fns';

// ── Client detail modal ─────────────────────────────────────────────────────
const ClientModal = ({ client, gymId, onClose }) => {
  const [tab,      setTab]      = useState('workouts');
  const [sessions, setSessions] = useState([]);
  const [prs,      setPrs]      = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [assignedId, setAssignedId] = useState(client.assigned_program_id ?? null);

  useEffect(() => {
    const load = async () => {
      const [sessRes, prRes, progRes] = await Promise.all([
        supabase
          .from('workout_sessions')
          .select('id, name, started_at, total_volume_lbs, duration_seconds')
          .eq('profile_id', client.id)
          .eq('status', 'completed')
          .order('started_at', { ascending: false })
          .limit(12),
        supabase
          .from('personal_records')
          .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name)')
          .eq('profile_id', client.id)
          .order('estimated_1rm', { ascending: false })
          .limit(8),
        supabase
          .from('gym_programs')
          .select('id, name, duration_weeks')
          .eq('gym_id', gymId)
          .eq('is_published', true)
          .order('name'),
      ]);
      setSessions(sessRes.data || []);
      setPrs(prRes.data || []);
      setPrograms(progRes.data || []);
      setLoading(false);
    };
    load();
  }, [client.id, gymId]);

  const handleAssign = async (programId) => {
    setAssigning(true);
    await supabase.from('profiles').update({ assigned_program_id: programId || null }).eq('id', client.id);
    setAssignedId(programId || null);
    setAssigning(false);
  };

  const daysInactive = client.last_active_at
    ? Math.floor((Date.now() - new Date(client.last_active_at)) / 86400000)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/6 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#D4AF37]/12 flex items-center justify-center flex-shrink-0">
              <span className="text-[15px] font-bold text-[#D4AF37]">{client.full_name[0]}</span>
            </div>
            <div>
              <p className="text-[15px] font-bold text-[#E5E7EB]">{client.full_name}</p>
              <p className="text-[11px] text-[#6B7280]">
                @{client.username}
                {daysInactive !== null
                  ? ` · active ${daysInactive === 0 ? 'today' : `${daysInactive}d ago`}`
                  : ' · never active'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#E5E7EB]"><X size={20} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/6 flex-shrink-0">
          {[
            { key: 'workouts', label: 'Workouts' },
            { key: 'prs',      label: 'PRs' },
            { key: 'program',  label: 'Program' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 text-[13px] font-semibold transition-colors ${
                tab === t.key
                  ? 'text-[#D4AF37] border-b-2 border-[#D4AF37] -mb-px'
                  : 'text-[#6B7280] hover:text-[#9CA3AF]'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
            </div>
          ) : tab === 'workouts' ? (
            sessions.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] text-center py-8">No workouts logged yet</p>
            ) : (
              <div className="space-y-2">
                {sessions.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-[#111827] rounded-xl">
                    <div>
                      <p className="text-[13px] font-medium text-[#E5E7EB]">{s.name || 'Workout'}</p>
                      <p className="text-[11px] text-[#6B7280]">{format(new Date(s.started_at), 'EEE, MMM d · h:mm a')}</p>
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
          ) : tab === 'prs' ? (
            prs.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] text-center py-8">No PRs recorded yet</p>
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
                        <p className="text-[10px] text-[#6B7280]">{Math.round(pr.estimated_1rm)} lbs e1RM</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            /* Program assignment */
            <div>
              <p className="text-[12px] text-[#6B7280] mb-4">
                Assign a gym program for {client.full_name.split(' ')[0]} to follow.
                The program will appear in their Workouts tab.
              </p>
              {programs.length === 0 ? (
                <div className="text-center py-8">
                  <Dumbbell size={24} className="text-[#4B5563] mx-auto mb-2" />
                  <p className="text-[13px] text-[#6B7280]">No published programs yet</p>
                  <p className="text-[11px] text-[#4B5563] mt-1">Ask your admin to create programs first</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* None option */}
                  <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    !assignedId ? 'border-[#D4AF37]/40 bg-[#D4AF37]/5' : 'border-white/6 hover:border-white/12'
                  }`}>
                    <input type="radio" name="program" checked={!assignedId} onChange={() => handleAssign(null)}
                      className="accent-[#D4AF37]" disabled={assigning} />
                    <div>
                      <p className="text-[13px] font-semibold text-[#E5E7EB]">No program assigned</p>
                      <p className="text-[11px] text-[#6B7280]">Client trains on their own schedule</p>
                    </div>
                  </label>
                  {programs.map(p => (
                    <label key={p.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      assignedId === p.id ? 'border-[#D4AF37]/40 bg-[#D4AF37]/5' : 'border-white/6 hover:border-white/12'
                    }`}>
                      <input type="radio" name="program" checked={assignedId === p.id} onChange={() => handleAssign(p.id)}
                        className="accent-[#D4AF37]" disabled={assigning} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">{p.name}</p>
                        <p className="text-[11px] text-[#6B7280]">{p.duration_weeks} weeks</p>
                      </div>
                      {assignedId === p.id && (
                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full flex-shrink-0">
                          Assigned
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
              {assigning && (
                <p className="text-[12px] text-[#6B7280] mt-3 text-center animate-pulse">Saving…</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Main ───────────────────────────────────────────────────────────────────
export default function TrainerClients() {
  const { profile } = useAuth();
  const [clients,  setClients]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoading(true);
      const fourteenDaysAgo = subDays(new Date(), 14).toISOString();

      const { data: memberRows } = await supabase
        .from('profiles')
        .select('id, full_name, username, last_active_at, created_at, assigned_program_id')
        .eq('gym_id', profile.gym_id)
        .eq('role', 'member')
        .order('last_active_at', { ascending: false, nullsFirst: false });

      const { data: recentSessions } = await supabase
        .from('workout_sessions')
        .select('profile_id')
        .eq('gym_id', profile.gym_id)
        .eq('status', 'completed')
        .gte('started_at', fourteenDaysAgo);

      const recentCounts = {};
      (recentSessions || []).forEach(s => {
        recentCounts[s.profile_id] = (recentCounts[s.profile_id] || 0) + 1;
      });

      setClients((memberRows || []).map(m => ({ ...m, recentWorkouts: recentCounts[m.id] ?? 0 })));
      setLoading(false);
    };
    load();
  }, [profile?.gym_id]);

  return (
    <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#E5E7EB]">Clients</h1>
        <p className="text-[13px] text-[#6B7280] mt-0.5">{clients.length} members · tap to view progress or assign a program</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : clients.length === 0 ? (
        <div className="text-center py-20">
          <Users size={32} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">No members yet</p>
        </div>
      ) : (
        <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
          <div className="divide-y divide-white/4">
            {clients.map(c => {
              const daysInactive = c.last_active_at
                ? Math.floor((Date.now() - new Date(c.last_active_at)) / 86400000)
                : null;
              const isActive = daysInactive !== null && daysInactive <= 7;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/2 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-[#1E293B] flex items-center justify-center flex-shrink-0 relative">
                    <span className="text-[13px] font-bold text-[#9CA3AF]">{c.full_name[0]}</span>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#05070B] ${isActive ? 'bg-emerald-400' : 'bg-[#374151]'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{c.full_name}</p>
                    <p className="text-[11px] text-[#6B7280]">
                      {c.last_active_at
                        ? `Active ${formatDistanceToNow(new Date(c.last_active_at), { addSuffix: true })}`
                        : 'Never active'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-right hidden sm:block">
                      <p className="text-[12px] font-semibold text-[#9CA3AF]">{c.recentWorkouts}w / 14d</p>
                      {c.assigned_program_id && (
                        <p className="text-[10px] text-[#D4AF37]">Program assigned</p>
                      )}
                    </div>
                    <ChevronRight size={14} className="text-[#4B5563]" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selected && (
        <ClientModal
          client={selected}
          gymId={profile.gym_id}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
