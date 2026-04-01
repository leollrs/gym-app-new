import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, X, Trophy, Dumbbell, ChevronRight, FileText, Search, Filter, SortAsc, BarChart3 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { format, formatDistanceToNow, subDays, startOfWeek, endOfWeek, differenceInWeeks } from 'date-fns';
import { useTranslation } from 'react-i18next';

// ── Client detail modal ─────────────────────────────────────────────────────
const ClientModal = ({ client, gymId, onClose, onViewProfile }) => {
  const { t } = useTranslation('pages');
  const [tab,      setTab]      = useState('workouts');
  const [sessions, setSessions] = useState([]);
  const [prs,      setPrs]      = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [assignedId, setAssignedId] = useState(client.assigned_program_id ?? null);
  const [programProgress, setProgramProgress] = useState(null); // { name, currentWeek, totalWeeks, completedThisWeek, expectedThisWeek }

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
      if (sessRes.error) logger.error('ClientModal: failed to load sessions:', sessRes.error);
      if (prRes.error) logger.error('ClientModal: failed to load PRs:', prRes.error);
      if (progRes.error) logger.error('ClientModal: failed to load programs:', progRes.error);
      setSessions(sessRes.data || []);
      setPrs(prRes.data || []);
      setPrograms(progRes.data || []);

      // Load program progress if client has an assigned program
      const currentProgramId = client.assigned_program_id;
      if (currentProgramId) {
        // Try gym_program_enrollments first, then gym_programs directly
        const { data: enrollment } = await supabase
          .from('gym_program_enrollments')
          .select('started_at, gym_programs(name, duration_weeks, days_per_week)')
          .eq('profile_id', client.id)
          .eq('program_id', currentProgramId)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        let progName = '';
        let totalWeeks = 0;
        let daysPerWeek = 3;
        let programStart = null;

        if (enrollment?.gym_programs) {
          progName = enrollment.gym_programs.name;
          totalWeeks = enrollment.gym_programs.duration_weeks || 0;
          daysPerWeek = enrollment.gym_programs.days_per_week || 3;
          programStart = enrollment.started_at ? new Date(enrollment.started_at) : null;
        } else {
          // Fallback: fetch program directly
          const { data: prog } = await supabase
            .from('gym_programs')
            .select('name, duration_weeks, days_per_week')
            .eq('id', currentProgramId)
            .maybeSingle();
          if (prog) {
            progName = prog.name;
            totalWeeks = prog.duration_weeks || 0;
            daysPerWeek = prog.days_per_week || 3;
          }
        }

        if (progName) {
          const now = new Date();
          const currentWeek = programStart
            ? Math.min(Math.max(differenceInWeeks(now, programStart) + 1, 1), totalWeeks || 1)
            : 1;

          // Count completed sessions this week
          const weekStart = startOfWeek(now, { weekStartsOn: 1 });
          const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
          const { count: completedThisWeek } = await supabase
            .from('workout_sessions')
            .select('id', { count: 'exact', head: true })
            .eq('profile_id', client.id)
            .eq('status', 'completed')
            .gte('started_at', weekStart.toISOString())
            .lte('started_at', weekEnd.toISOString());

          setProgramProgress({
            name: progName,
            currentWeek,
            totalWeeks: totalWeeks || currentWeek,
            completedThisWeek: completedThisWeek || 0,
            expectedThisWeek: daysPerWeek,
          });
        }
      }

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
      <div role="dialog" aria-modal="true" aria-labelledby="client-detail-title" className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-lg md:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/6 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#D4AF37]/12 flex items-center justify-center flex-shrink-0">
              <span className="text-[15px] font-bold text-[#D4AF37]">{(client.full_name || 'U')[0]}</span>
            </div>
            <div>
              <p id="client-detail-title" className="text-[15px] font-bold text-[#E5E7EB]">{client.full_name}</p>
              <p className="text-[11px] text-[#6B7280]">
                @{client.username}
                {daysInactive !== null
                  ? ` · active ${daysInactive === 0 ? 'today' : `${daysInactive}d ago`}`
                  : ' · never active'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onViewProfile} className="text-[11px] font-medium text-[#D4AF37] hover:text-[#E5C94B] flex items-center gap-1 transition-colors">
              <FileText size={13} /> Full Profile
            </button>
            <button onClick={onClose} aria-label="Close client detail" className="text-[#6B7280] hover:text-[#E5E7EB] min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"><X size={20} /></button>
          </div>
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
                      <Trophy size={13} className={i < 3 ? 'text-[#D4AF37]' : 'text-[#6B7280]'} />
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
              {/* Program Progress section */}
              {programProgress ? (
                <div className="mb-5 bg-[#111827] rounded-xl p-4 border border-white/6">
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 size={14} className="text-[#D4AF37]" />
                    <p className="text-[13px] font-semibold text-[#E5E7EB]">{t('trainer.programProgress', 'Program Progress')}</p>
                  </div>
                  <p className="text-[12px] text-[#9CA3AF] mb-1">{programProgress.name}</p>
                  <p className="text-[11px] text-[#6B7280] mb-2">
                    {t('trainer.weekXOfY', 'Week {{current}} of {{total}}', { current: programProgress.currentWeek, total: programProgress.totalWeeks })}
                  </p>
                  {/* Week progress bar */}
                  <div className="w-full h-2 bg-white/6 rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full bg-[#D4AF37] rounded-full transition-all duration-500"
                      style={{ width: `${Math.round((programProgress.currentWeek / programProgress.totalWeeks) * 100)}%` }}
                    />
                  </div>
                  {/* Sessions this week */}
                  {(() => {
                    const pct = programProgress.expectedThisWeek > 0
                      ? Math.round((programProgress.completedThisWeek / programProgress.expectedThisWeek) * 100)
                      : 0;
                    const color = pct >= 80 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400';
                    return (
                      <div className="flex items-center justify-between">
                        <p className="text-[12px] text-[#9CA3AF]">
                          {t('trainer.sessionsThisWeek', 'Sessions this week')}
                        </p>
                        <p className={`text-[13px] font-bold ${color}`}>
                          {programProgress.completedThisWeek} / {programProgress.expectedThisWeek}
                          <span className="text-[11px] font-normal text-[#6B7280] ml-1">({pct}%)</span>
                        </p>
                      </div>
                    );
                  })()}
                </div>
              ) : !loading && !assignedId ? (
                <div className="mb-5 bg-[#111827]/50 rounded-xl p-4 border border-white/4 text-center">
                  <Dumbbell size={20} className="text-[#6B7280] mx-auto mb-2" />
                  <p className="text-[12px] text-[#6B7280]">{t('trainer.noProgramAssigned', 'No program assigned')}</p>
                  <button onClick={() => setTab('program')} className="text-[12px] text-[#D4AF37] mt-1 hover:text-[#E5C94B] transition-colors">
                    {t('trainer.assignOne', 'Assign one')}
                  </button>
                </div>
              ) : null}

              <p className="text-[12px] text-[#6B7280] mb-4">
                Assign a gym program for {(client.full_name || 'this client').split(' ')[0]} to follow.
                The program will appear in their Workouts tab.
              </p>
              {programs.length === 0 ? (
                <div className="text-center py-8">
                  <Dumbbell size={24} className="text-[#6B7280] mx-auto mb-2" />
                  <p className="text-[13px] text-[#6B7280]">No published programs yet</p>
                  <p className="text-[11px] text-[#6B7280] mt-1">Ask your admin to create programs first</p>
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

// ── Filter / sort constants ──────────────────────────────────────────────────
const FILTERS = [
  { key: 'all',        label: 'All' },
  { key: 'active',     label: 'Active' },
  { key: 'at_risk',    label: 'At Risk' },
  { key: 'has_program',label: 'Has Program' },
  { key: 'no_program', label: 'No Program' },
];

const SORTS = [
  { key: 'last_active', label: 'Last Active' },
  { key: 'name',        label: 'Name' },
  { key: 'workouts',    label: 'Recent Workouts' },
];

// ── Main ───────────────────────────────────────────────────────────────────
export default function TrainerClients() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [clients,  setClients]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState(null);
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('all');
  const [sortBy,   setSortBy]   = useState('last_active');
  const [showFilters, setShowFilters] = useState(false);
  const [churnScores, setChurnScores] = useState({});

  function getChurnLevel(score) {
    if (score >= 80) return { label: 'Critical', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' };
    if (score >= 55) return { label: 'High', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' };
    return { label: 'Medium', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' };
  }

  useEffect(() => { document.title = 'Trainer - Clients | TuGymPR'; }, []);

  useEffect(() => {
    if (!profile?.gym_id || !profile?.id) return;
    const load = async () => {
      setLoading(true);
      const fourteenDaysAgo = subDays(new Date(), 14).toISOString();

      // Fetch only assigned clients via trainer_clients join
      const { data: tcRows, error: tcError } = await supabase
        .from('trainer_clients')
        .select(`
          client_id,
          notes,
          profiles!trainer_clients_client_id_fkey (
            id, full_name, username, last_active_at, created_at, assigned_program_id
          )
        `)
        .eq('trainer_id', profile.id)
        .eq('is_active', true);
      if (tcError) logger.error('TrainerClients: failed to load clients:', tcError);

      const assignedClients = (tcRows || [])
        .map(tc => tc.profiles)
        .filter(Boolean);

      if (assignedClients.length === 0) {
        setClients([]);
        setLoading(false);
        return;
      }

      const clientIds = assignedClients.map(c => c.id);

      const { data: recentSessions, error: recSessError } = await supabase
        .from('workout_sessions')
        .select('profile_id')
        .in('profile_id', clientIds)
        .eq('status', 'completed')
        .gte('started_at', fourteenDaysAgo);
      if (recSessError) logger.error('TrainerClients: failed to load recent sessions:', recSessError);

      const recentCounts = {};
      (recentSessions || []).forEach(s => {
        recentCounts[s.profile_id] = (recentCounts[s.profile_id] || 0) + 1;
      });

      // Fetch churn risk scores
      const { data: churnRows, error: churnError } = await supabase
        .from('churn_risk_scores')
        .select('profile_id, score, key_signals, computed_at')
        .in('profile_id', clientIds);
      if (churnError) logger.error('TrainerClients: failed to load churn scores:', churnError);

      const churnMap = {};
      (churnRows || []).forEach(row => { churnMap[row.profile_id] = row; });
      setChurnScores(churnMap);

      setClients(assignedClients.map(m => ({ ...m, recentWorkouts: recentCounts[m.id] ?? 0 })));
      setLoading(false);
    };
    load();
  }, [profile?.gym_id, profile?.id]);

  // Client-side search, filter, sort
  const filtered = useMemo(() => {
    let list = [...clients];

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.full_name?.toLowerCase().includes(q) ||
        c.username?.toLowerCase().includes(q)
      );
    }

    // Filter
    const now = Date.now();
    if (filter === 'active') {
      list = list.filter(c => c.last_active_at && (now - new Date(c.last_active_at)) / 86400000 <= 7);
    } else if (filter === 'at_risk') {
      list = list.filter(c => {
        const churn = churnScores[c.id];
        if (churn) return churn.score >= 30;
        return !c.last_active_at || (now - new Date(c.last_active_at)) / 86400000 > 14;
      });
    } else if (filter === 'has_program') {
      list = list.filter(c => c.assigned_program_id);
    } else if (filter === 'no_program') {
      list = list.filter(c => !c.assigned_program_id);
    }

    // Sort
    if (sortBy === 'name') {
      list.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    } else if (sortBy === 'workouts') {
      list.sort((a, b) => b.recentWorkouts - a.recentWorkouts);
    } else {
      list.sort((a, b) => {
        const aT = a.last_active_at ? new Date(a.last_active_at).getTime() : 0;
        const bT = b.last_active_at ? new Date(b.last_active_at).getTime() : 0;
        return bT - aT;
      });
    }

    return list;
  }, [clients, search, filter, sortBy, churnScores]);

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#E5E7EB] truncate">My Clients</h1>
        <p className="text-[13px] text-[#6B7280] mt-0.5">{clients.length} assigned client{clients.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Search + Filter bar */}
      {!loading && clients.length > 0 && (
        <div className="mb-4 space-y-3 md:sticky md:top-0 md:z-10 md:bg-[#05070B] md:pb-2">
          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6B7280]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search clients…"
              aria-label="Search clients"
              className="w-full bg-[#0F172A] border border-white/6 rounded-xl pl-10 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
          </div>

          {/* Filter / Sort row */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                filter !== 'all'
                  ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                  : 'bg-[#111827] text-[#9CA3AF] hover:text-[#E5E7EB]'
              }`}
            >
              <Filter size={12} />
              {FILTERS.find(f => f.key === filter)?.label || 'Filter'}
            </button>
            <button
              onClick={() => {
                const idx = SORTS.findIndex(s => s.key === sortBy);
                setSortBy(SORTS[(idx + 1) % SORTS.length].key);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#111827] text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors"
            >
              <SortAsc size={12} />
              {SORTS.find(s => s.key === sortBy)?.label}
            </button>
          </div>

          {/* Filter pills */}
          {showFilters && (
            <div className="flex gap-1.5 flex-wrap">
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  onClick={() => { setFilter(f.key); setShowFilters(false); }}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                    filter === f.key
                      ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                      : 'bg-[#111827] text-[#6B7280] hover:text-[#9CA3AF]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : clients.length === 0 ? (
        <div className="text-center py-20">
          <Users size={32} className="text-[#6B7280] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">No clients assigned yet</p>
          <p className="text-[12px] text-[#6B7280] mt-1">Ask your admin to assign clients to you</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Search size={24} className="text-[#6B7280] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">No clients match your filters</p>
          <button onClick={() => { setSearch(''); setFilter('all'); }}
            className="text-[12px] text-[#D4AF37] mt-2 hover:text-[#E5C94B] transition-colors">
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">

            {filtered.map(c => {
              const daysInactive = c.last_active_at
                ? Math.floor((Date.now() - new Date(c.last_active_at)) / 86400000)
                : null;
              const isActive = daysInactive !== null && daysInactive <= 7;
              const churn = churnScores[c.id];
              const isAtRisk = churn
                ? churn.score >= 30
                : (daysInactive === null || daysInactive > 14);
              const riskLevel = churn && churn.score >= 30 ? getChurnLevel(churn.score) : null;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 bg-[#0F172A] border border-white/[0.06] rounded-2xl hover:border-white/20 hover:bg-white/[0.03] transition-all text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-[#1E293B] flex items-center justify-center flex-shrink-0 relative">
                    <span className="text-[13px] font-bold text-[#9CA3AF]">{(c.full_name || 'U')[0]}</span>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#05070B] ${
                      isActive ? 'bg-emerald-400' : isAtRisk ? 'bg-amber-400' : 'bg-[#374151]'
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{c.full_name}</p>
                      {riskLevel && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${riskLevel.bg} ${riskLevel.color}`}>
                          {Math.round(churn.score)}
                        </span>
                      )}
                    </div>
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
                    <ChevronRight size={14} className="text-[#6B7280]" />
                  </div>
                </button>
              );
            })}

        </div>
      )}

      {selected && (
        <ClientModal
          client={selected}
          gymId={profile.gym_id}
          onClose={() => setSelected(null)}
          onViewProfile={() => {
            setSelected(null);
            navigate(`/trainer/client/${selected.id}`);
          }}
        />
      )}
    </div>
  );
}
