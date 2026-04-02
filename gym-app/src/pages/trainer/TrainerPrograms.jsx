import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Dumbbell, ChevronDown, Clock, Search, X, UserPlus, Check, ArrowUpDown, Calendar } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from 'react-i18next';

const DEFAULT_SETS = 3;
const DEFAULT_REST = 60;

const fmtTime = (secs) => {
  if (secs < 60) return `${secs}s`;
  const m = Math.round(secs / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

const calcDaySeconds = (day) =>
  (day.exercises || []).reduce((sum, ex) => {
    const s = ex.sets ?? DEFAULT_SETS;
    const r = ex.rest_seconds ?? DEFAULT_REST;
    return sum + s * 45 + (s - 1) * r;
  }, 0);

const SORT_OPTIONS = ['name', 'duration', 'recent'];

export default function TrainerPrograms() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation('pages');

  const [programs,     setPrograms]     = useState([]);
  const [exercises,    setExercises]    = useState({});
  const [loading,      setLoading]      = useState(true);
  const [expanded,     setExpanded]     = useState(null);
  const [search,       setSearch]       = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy,       setSortBy]       = useState('name');
  const [showSort,     setShowSort]     = useState(false);

  // Assign flow
  const [assigningFor,   setAssigningFor]   = useState(null); // program id
  const [clients,        setClients]        = useState([]);
  const [enrollments,    setEnrollments]    = useState([]); // { program_id, profile_id }
  const [assigning,      setAssigning]      = useState(false);
  const [clientsLoaded,  setClientsLoaded]  = useState(false);

  const sortRef = useRef(null);

  useEffect(() => { document.title = `${t('trainerPrograms.title')} | TuGymPR`; }, [t]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Close sort dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (sortRef.current && !sortRef.current.contains(e.target)) setShowSort(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Load programs + exercises
  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      const [{ data: progs }, { data: exRows }] = await Promise.all([
        supabase
          .from('gym_programs')
          .select('*')
          .eq('gym_id', profile.gym_id)
          .eq('is_published', true)
          .order('name'),
        supabase
          .from('exercises')
          .select('id, name'),
      ]);
      setPrograms(progs || []);
      const exMap = {};
      (exRows || []).forEach(e => { exMap[e.id] = e.name; });
      setExercises(exMap);
      setLoading(false);
    };
    load();
  }, [profile?.gym_id]);

  // Load clients + enrollments for assign flow
  const loadClientsAndEnrollments = useCallback(async () => {
    if (clientsLoaded || !profile?.id || !profile?.gym_id) return;
    const [clientsRes, enrollRes] = await Promise.all([
      supabase
        .from('trainer_clients')
        .select('client_id, profiles!trainer_clients_client_id_fkey(id, full_name)')
        .eq('trainer_id', profile.id)
        .eq('is_active', true),
      supabase
        .from('gym_program_enrollments')
        .select('program_id, profile_id')
        .eq('gym_id', profile.gym_id),
    ]);
    setClients((clientsRes.data || []).map(tc => tc.profiles).filter(Boolean));
    setEnrollments(enrollRes.data || []);
    setClientsLoaded(true);
  }, [profile?.id, profile?.gym_id, clientsLoaded]);

  const exName = (id) => exercises[id] ?? id;

  // Filter + sort
  const filtered = useMemo(() => {
    let list = programs;
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }
    list = [...list];
    if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'duration') list.sort((a, b) => (a.duration_weeks || 0) - (b.duration_weeks || 0));
    else if (sortBy === 'recent') list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return list;
  }, [programs, debouncedSearch, sortBy]);

  const isEnrolled = (programId, clientId) =>
    enrollments.some(e => e.program_id === programId && e.profile_id === clientId);

  const handleAssign = async (programId, clientId) => {
    if (isEnrolled(programId, clientId)) {
      showToast(t('trainerPrograms.alreadyEnrolled'), 'info');
      return;
    }
    setAssigning(true);
    const { error } = await supabase.from('gym_program_enrollments').insert({
      program_id: programId,
      profile_id: clientId,
      gym_id: profile.gym_id,
    });
    setAssigning(false);
    if (error) {
      if (error.code === '23505') {
        showToast(t('trainerPrograms.alreadyEnrolled'), 'info');
      } else {
        showToast(error.message, 'error');
      }
      return;
    }
    setEnrollments(prev => [...prev, { program_id: programId, profile_id: clientId }]);
    showToast(t('trainerPrograms.assignSuccess'), 'success');
    setAssigningFor(null);
  };

  const openAssign = async (programId) => {
    if (assigningFor === programId) { setAssigningFor(null); return; }
    setAssigningFor(programId);
    if (!clientsLoaded) await loadClientsAndEnrollments();
  };

  const programStats = (p) => {
    const weeks = p.weeks ?? {};
    const allDays  = Object.values(weeks).flat();
    const totalEx  = allDays.reduce((s, d) => s + (d.exercises || []).length, 0);
    const avgSecs  = allDays.length > 0
      ? Math.round(allDays.reduce((s, d) => s + calcDaySeconds(d), 0) / allDays.length)
      : 0;
    return { weeks, allDays, totalEx, avgSecs };
  };

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-[22px] font-bold text-[#E5E7EB] truncate">{t('trainerPrograms.title')}</h1>
        <p className="text-[13px] text-[#6B7280] mt-0.5">{t('trainerPrograms.subtitle')}</p>
      </div>

      {/* Search + Sort */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('trainerPrograms.searchPlaceholder')}
            className="w-full h-11 pl-9 pr-9 bg-[#111827] border border-white/[0.06] rounded-xl text-[14px] text-[#E5E7EB] placeholder:text-[#4B5563] focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#9CA3AF] transition-colors"
              aria-label={t('trainerPrograms.clearSearch')}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="relative" ref={sortRef}>
          <button
            onClick={() => setShowSort(!showSort)}
            className="h-11 px-3 bg-[#111827] border border-white/[0.06] rounded-xl flex items-center gap-1.5 text-[13px] text-[#9CA3AF] hover:border-white/10 transition-colors min-w-[44px] justify-center"
            aria-label={t('trainerPrograms.sort')}
          >
            <ArrowUpDown size={14} />
            <span className="hidden md:inline">{t(`trainerPrograms.sort_${sortBy}`)}</span>
          </button>
          {showSort && (
            <div className="absolute right-0 top-full mt-1 bg-[#111827] border border-white/[0.08] rounded-xl overflow-hidden z-20 min-w-[160px] shadow-xl">
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt}
                  onClick={() => { setSortBy(opt); setShowSort(false); }}
                  className={`w-full text-left px-4 py-2.5 text-[13px] transition-colors ${
                    sortBy === opt ? 'text-[#D4AF37] bg-[#D4AF37]/5' : 'text-[#9CA3AF] hover:bg-white/[0.03]'
                  }`}
                >
                  {t(`trainerPrograms.sort_${opt}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Results count */}
      {!loading && debouncedSearch && (
        <p className="text-[12px] text-[#6B7280] mb-3">
          {filtered.length} {filtered.length === 1 ? t('trainerPrograms.resultSingular') : t('trainerPrograms.resultPlural')}
        </p>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : programs.length === 0 ? (
        <div className="text-center py-20">
          <Dumbbell size={32} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">{t('trainerPrograms.emptyTitle')}</p>
          <p className="text-[12px] text-[#4B5563] mt-1">{t('trainerPrograms.emptyDesc')}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Search size={28} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">{t('trainerPrograms.noResults')}</p>
          <p className="text-[12px] text-[#4B5563] mt-1">{t('trainerPrograms.noResultsHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(p => {
            const { weeks, allDays, totalEx, avgSecs } = programStats(p);
            const isOpen = expanded === p.id;
            const isAssigning = assigningFor === p.id;

            return (
              <div key={p.id} className="bg-[#111827] border border-white/[0.06] rounded-2xl overflow-hidden hover:border-white/[0.12] transition-all">
                {/* Card header */}
                <button
                  className="w-full text-left p-4 transition-colors"
                  onClick={() => setExpanded(isOpen ? null : p.id)}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Dumbbell size={17} className="text-[#D4AF37]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold text-[#E5E7EB] truncate">{p.name}</p>
                      {p.description && (
                        <p className="text-[12px] text-[#6B7280] mt-1 line-clamp-2 leading-relaxed">{p.description}</p>
                      )}
                    </div>
                    <ChevronDown size={16} className={`text-[#6B7280] transition-transform flex-shrink-0 mt-1 ${isOpen ? 'rotate-180' : ''}`} />
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-3 mt-3 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#9CA3AF] bg-white/[0.04] px-2 py-1 rounded-lg">
                      <Calendar size={11} />
                      {p.duration_weeks} {t('trainerPrograms.weeks')}
                    </span>
                    <span className="text-[11px] text-[#6B7280]">
                      {allDays.length} {t('trainerPrograms.days')} · {totalEx} {t('trainerPrograms.exercises')}
                    </span>
                    {avgSecs > 0 && (
                      <span className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                        <Clock size={10} /> ~{fmtTime(avgSecs)}/{t('trainerPrograms.session')}
                      </span>
                    )}
                  </div>
                </button>

                {/* Expanded detail */}
                {isOpen && (
                  <div className="border-t border-white/[0.04]">
                    {/* Week/day/exercise tree */}
                    <div className="px-4 pb-3 space-y-3 mt-3">
                      {Object.entries(weeks).map(([wk, days]) => (
                        <div key={wk}>
                          <p className="text-[11px] font-bold uppercase tracking-wider text-[#6B7280] mb-2">
                            {t('trainerPrograms.weekLabel', { week: wk })}
                          </p>
                          <div className="space-y-2">
                            {(days || []).map((day, di) => (
                              <div key={di} className="bg-[#0F172A] rounded-xl p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-[13px] font-semibold text-[#E5E7EB]">{day.name || `Day ${di + 1}`}</p>
                                  {calcDaySeconds(day) > 0 && (
                                    <span className="flex items-center gap-1 text-[10px] text-[#4B5563]">
                                      <Clock size={9} /> {fmtTime(calcDaySeconds(day))}
                                    </span>
                                  )}
                                </div>
                                {(day.exercises || []).length === 0 ? (
                                  <p className="text-[11px] text-[#4B5563]">{t('trainerPrograms.noExercises')}</p>
                                ) : (
                                  <div className="space-y-1">
                                    {(day.exercises || []).map((ex, ei) => (
                                      <div key={ei} className="flex items-center justify-between text-[12px]">
                                        <span className="text-[#9CA3AF] truncate flex-1 mr-2">{exName(ex.id)}</span>
                                        <span className="text-[#6B7280] flex-shrink-0 font-mono text-[11px]">
                                          {ex.sets ?? DEFAULT_SETS} x {ex.min_reps && ex.max_reps && ex.min_reps !== ex.max_reps ? `${ex.min_reps}-${ex.max_reps}` : (ex.reps ?? ex.min_reps ?? '?')}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Assign CTA */}
                    <div className="px-4 pb-4">
                      <button
                        onClick={(e) => { e.stopPropagation(); openAssign(p.id); }}
                        className={`w-full h-11 rounded-xl font-medium text-[13px] flex items-center justify-center gap-2 transition-all ${
                          isAssigning
                            ? 'bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20'
                            : 'bg-[#D4AF37] text-[#0F172A] hover:bg-[#D4AF37]/90'
                        }`}
                      >
                        <UserPlus size={15} />
                        {t('trainerPrograms.assignToClient')}
                      </button>

                      {/* Client picker */}
                      {isAssigning && (
                        <div className="mt-2 bg-[#0F172A] border border-white/[0.06] rounded-xl overflow-hidden">
                          {!clientsLoaded ? (
                            <div className="flex justify-center py-4">
                              <div className="w-5 h-5 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
                            </div>
                          ) : clients.length === 0 ? (
                            <p className="text-[12px] text-[#6B7280] text-center py-4">{t('trainerPrograms.noClients')}</p>
                          ) : (
                            <div className="max-h-[200px] overflow-y-auto">
                              {clients.map(client => {
                                const enrolled = isEnrolled(p.id, client.id);
                                return (
                                  <button
                                    key={client.id}
                                    disabled={assigning || enrolled}
                                    onClick={() => handleAssign(p.id, client.id)}
                                    className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors border-b border-white/[0.03] last:border-0 min-h-[44px] ${
                                      enrolled
                                        ? 'opacity-50 cursor-not-allowed'
                                        : 'hover:bg-white/[0.03] active:bg-white/[0.05]'
                                    }`}
                                  >
                                    <span className="text-[13px] text-[#E5E7EB] truncate">{client.full_name}</span>
                                    {enrolled ? (
                                      <span className="flex items-center gap-1 text-[11px] text-emerald-400 flex-shrink-0">
                                        <Check size={12} />
                                        {t('trainerPrograms.enrolled')}
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-[#D4AF37] flex-shrink-0">{t('trainerPrograms.assign')}</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
