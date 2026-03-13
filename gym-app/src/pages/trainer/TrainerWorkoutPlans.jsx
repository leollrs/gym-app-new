import { useEffect, useState, useMemo } from 'react';
import {
  Plus, X, ChevronDown, ChevronRight, Trash2, Copy, Clock, Dumbbell, Users,
  ClipboardList, Search, ToggleLeft, ToggleRight, ArrowLeft, StickyNote,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format } from 'date-fns';

// ── Data helpers ──────────────────────────────────────────
const DEFAULT_SETS = 3;
const DEFAULT_REPS = '8-12';
const DEFAULT_REST = 60;

const normalizeExercise = (ex) => {
  if (typeof ex === 'string') return { id: ex, sets: DEFAULT_SETS, reps: DEFAULT_REPS, rest_seconds: DEFAULT_REST, notes: '' };
  return {
    id: ex.id,
    sets: ex.sets ?? DEFAULT_SETS,
    reps: ex.reps ?? DEFAULT_REPS,
    rest_seconds: ex.rest_seconds ?? DEFAULT_REST,
    notes: ex.notes ?? '',
  };
};

const normalizeWeeks = (raw) => {
  const result = {};
  Object.entries(raw || {}).forEach(([wk, val]) => {
    if (!Array.isArray(val) || val.length === 0) { result[wk] = []; return; }
    if (typeof val[0] === 'string') {
      result[wk] = [{ name: 'Day 1', exercises: val.map(normalizeExercise) }];
    } else {
      result[wk] = val.map(day => ({
        ...day,
        exercises: (day.exercises || []).map(normalizeExercise),
      }));
    }
  });
  return result;
};

const calcDaySeconds = (day) =>
  (day.exercises || []).reduce((sum, ex) => {
    const s = ex.sets ?? DEFAULT_SETS;
    const r = ex.rest_seconds ?? DEFAULT_REST;
    return sum + s * 45 + (s - 1) * r;
  }, 0);

const fmtTime = (secs) => {
  if (secs < 60) return `${secs}s`;
  const m = Math.round(secs / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

// ── Plan Builder (fullscreen editor) ─────────────────────
const PlanBuilder = ({ plan, clients, onClose, onSaved, trainerId, gymId }) => {
  const isEdit = !!plan;
  const init = plan || {};
  const [clientId, setClientId]     = useState(init.client_id || '');
  const [name, setName]             = useState(init.name ?? '');
  const [description, setDesc]      = useState(init.description ?? '');
  const [durationWeeks, setDuration]= useState(init.duration_weeks ?? 4);
  const [weeks, setWeeks]           = useState(() => normalizeWeeks(init.weeks));
  const [exercises, setExercises]   = useState([]);
  const [expandedWeeks, setExpandedWeeks] = useState(new Set([1]));
  const [copyWeekMenu, setCopyWeekMenu]   = useState(null);
  const [copyDayMenu, setCopyDayMenu]     = useState(null);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [exSearch, setExSearch]     = useState('');

  useEffect(() => {
    supabase.from('exercises').select('id, name, muscle_group').order('name')
      .then(({ data }) => setExercises(data || []));
  }, []);

  const exName = (id) => exercises.find(e => e.id === id)?.name ?? id;

  const filteredExercises = useMemo(() => {
    if (!exSearch.trim()) return exercises;
    const q = exSearch.toLowerCase();
    return exercises.filter(e =>
      e.name.toLowerCase().includes(q) || e.muscle_group?.toLowerCase().includes(q)
    );
  }, [exercises, exSearch]);

  // Week operations
  const toggleWeek = (wk) => setExpandedWeeks(prev => {
    const s = new Set(prev); s.has(wk) ? s.delete(wk) : s.add(wk); return s;
  });
  const copyWeekTo = (fromWk, toWk) => {
    setWeeks(prev => ({ ...prev, [toWk]: JSON.parse(JSON.stringify(prev[fromWk] || [])) }));
    setCopyWeekMenu(null);
    setExpandedWeeks(prev => new Set([...prev, toWk]));
  };

  // Day operations
  const addDay = (wk) => setWeeks(prev => ({
    ...prev,
    [wk]: [...(prev[wk] || []), { name: `Day ${(prev[wk] || []).length + 1}`, exercises: [] }],
  }));
  const removeDay = (wk, di) => setWeeks(prev => ({
    ...prev,
    [wk]: prev[wk].filter((_, i) => i !== di),
  }));
  const updateDayName = (wk, di, val) => setWeeks(prev => ({
    ...prev,
    [wk]: prev[wk].map((d, i) => i === di ? { ...d, name: val } : d),
  }));
  const copyDayTo = (fromWk, fromDi, toWk, toDi) => {
    const cloned = JSON.parse(JSON.stringify(weeks[fromWk][fromDi]));
    setWeeks(prev => {
      const targetDays = [...(prev[toWk] || [])];
      if (toDi === 'new') {
        targetDays.push({ ...cloned, name: `Day ${targetDays.length + 1}` });
      } else {
        targetDays[toDi] = { ...cloned };
      }
      return { ...prev, [toWk]: targetDays };
    });
    setCopyDayMenu(null);
    setExpandedWeeks(prev => new Set([...prev, toWk]));
  };

  // Exercise operations
  const addExercise = (wk, di, id) => {
    if (!id) return;
    setWeeks(prev => ({
      ...prev,
      [wk]: prev[wk].map((d, i) => i === di
        ? { ...d, exercises: [...d.exercises, { id, sets: DEFAULT_SETS, reps: DEFAULT_REPS, rest_seconds: DEFAULT_REST, notes: '' }] }
        : d
      ),
    }));
  };
  const removeExercise = (wk, di, ei) => setWeeks(prev => ({
    ...prev,
    [wk]: prev[wk].map((d, i) => i === di
      ? { ...d, exercises: d.exercises.filter((_, j) => j !== ei) }
      : d
    ),
  }));
  const updateExercise = (wk, di, ei, field, val) => setWeeks(prev => ({
    ...prev,
    [wk]: prev[wk].map((d, i) => i === di
      ? { ...d, exercises: d.exercises.map((ex, j) => j === ei ? { ...ex, [field]: val } : ex) }
      : d
    ),
  }));

  // Save
  const handleSave = async () => {
    if (!clientId) { setError('Please select a client.'); return; }
    if (!name.trim()) { setError('Plan name is required.'); return; }
    setSaving(true);
    setError('');
    const payload = {
      gym_id: gymId,
      trainer_id: trainerId,
      client_id: clientId,
      name: name.trim(),
      description: description.trim(),
      duration_weeks: durationWeeks,
      weeks,
      is_active: plan?.is_active ?? true,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = isEdit
      ? await supabase.from('trainer_workout_plans').update(payload).eq('id', plan.id)
      : await supabase.from('trainer_workout_plans').insert(payload);
    if (err) { setError(err.message); setSaving(false); return; }
    onSaved();
  };

  const allWeekNums = Array.from({ length: durationWeeks }, (_, i) => i + 1);

  const allDayTargets = (fromWk, fromDi) => {
    const targets = [];
    allWeekNums.forEach(wk => {
      const days = weeks[wk] || [];
      days.forEach((d, di) => {
        if (wk === fromWk && di === fromDi) return;
        targets.push({ wk, di, label: `Wk ${wk} · ${d.name || `Day ${di + 1}`}` });
      });
      targets.push({ wk, di: 'new', label: `Wk ${wk} · New day` });
    });
    return targets;
  };

  const avgSessionSecs = (() => {
    const allDays = Object.values(weeks).flat();
    if (!allDays.length) return 0;
    return Math.round(allDays.reduce((s, d) => s + calcDaySeconds(d), 0) / allDays.length);
  })();

  const closeMenus = () => { setCopyWeekMenu(null); setCopyDayMenu(null); };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={closeMenus}>
      <div role="dialog" aria-modal="true" aria-labelledby="workout-plan-title" className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-xl md:max-w-3xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/6 flex-shrink-0">
          <div>
            <p id="workout-plan-title" className="text-[16px] font-bold text-[#E5E7EB]">{isEdit ? 'Edit Plan' : 'New Workout Plan'}</p>
            {avgSessionSecs > 0 && (
              <p className="text-[11px] text-[#6B7280] mt-0.5 flex items-center gap-1">
                <Clock size={10} /> avg {fmtTime(avgSessionSecs)} per session
              </p>
            )}
          </div>
          <button onClick={onClose}><X size={20} className="text-[#6B7280]" /></button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Client */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Client</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)}
              disabled={isEdit}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 disabled:opacity-50">
              <option value="">Select client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
          </div>

          {/* Name */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Plan Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. 8-Week Strength Builder"
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Description</label>
            <textarea value={description} onChange={e => setDesc(e.target.value)} rows={2}
              placeholder="Goals and approach for this plan…"
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none" />
          </div>

          {/* Duration */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Duration</label>
            <div className="flex gap-2">
              {[4, 6, 8, 10, 12].map(w => (
                <button key={w} onClick={() => setDuration(w)}
                  className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                    durationWeeks === w ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'bg-[#111827] border border-white/6 text-[#9CA3AF]'
                  }`}>
                  {w}w
                </button>
              ))}
            </div>
          </div>

          {/* Weekly schedule */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-3">Weekly Schedule</label>
            <div className="space-y-2">
              {allWeekNums.map(wk => {
                const isOpen = expandedWeeks.has(wk);
                const days = weeks[wk] || [];
                const showCopyWeek = copyWeekMenu === wk;
                const totalEx = days.reduce((s, d) => s + d.exercises.length, 0);
                const wkTime = days.reduce((s, d) => s + calcDaySeconds(d), 0);

                return (
                  <div key={wk} className="border border-white/8 rounded-xl overflow-visible">
                    {/* Week header */}
                    <div className="flex items-center bg-[#111827]/60 px-3 py-2.5 gap-2 rounded-xl">
                      <button onClick={() => toggleWeek(wk)} className="flex items-center gap-2 flex-1 text-left">
                        <ChevronDown size={14} className={`text-[#6B7280] transition-transform flex-shrink-0 ${isOpen ? '' : '-rotate-90'}`} />
                        <span className="text-[13px] font-semibold text-[#E5E7EB]">Week {wk}</span>
                        {!isOpen && (
                          <span className="text-[11px] text-[#4B5563] ml-1">
                            {days.length} day{days.length !== 1 ? 's' : ''}{totalEx > 0 ? ` · ${totalEx} ex` : ''}{wkTime > 0 ? ` · ~${fmtTime(wkTime / Math.max(days.length, 1))} avg` : ''}
                          </span>
                        )}
                      </button>
                      <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => { setCopyWeekMenu(showCopyWeek ? null : wk); setCopyDayMenu(null); }}
                          className="flex items-center gap-1 text-[11px] font-semibold text-[#6B7280] hover:text-[#9CA3AF] px-2 py-1 rounded-lg hover:bg-white/6 transition-colors">
                          <Copy size={11} /> Copy
                        </button>
                        {showCopyWeek && (
                          <div className="absolute right-0 top-full mt-1 z-20 bg-[#1E293B] border border-white/10 rounded-xl shadow-xl overflow-hidden min-w-[130px]">
                            <p className="text-[10px] font-bold text-[#4B5563] uppercase tracking-widest px-3 pt-2 pb-1">Copy Wk {wk} to…</p>
                            {allWeekNums.filter(w => w !== wk).map(targetWk => (
                              <button key={targetWk} onClick={() => copyWeekTo(wk, targetWk)}
                                className="w-full text-left px-3 py-2 text-[12px] text-[#E5E7EB] hover:bg-white/6 transition-colors">
                                Week {targetWk}
                                {(weeks[targetWk] || []).length > 0 && <span className="text-[#4B5563] ml-1">(overwrite)</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Week body */}
                    {isOpen && (
                      <div className="p-3 space-y-2">
                        {days.length === 0 && (
                          <p className="text-[12px] text-[#4B5563] text-center py-2">No days yet — add one below</p>
                        )}

                        {days.map((day, di) => {
                          const dayTime = calcDaySeconds(day);
                          const showCopyDay = copyDayMenu?.wk === wk && copyDayMenu?.di === di;
                          const dayTargets = allDayTargets(wk, di);

                          return (
                            <div key={di} className="border border-white/6 rounded-xl overflow-visible">
                              {/* Day header */}
                              <div className="flex items-center gap-2 px-3 py-2.5 bg-[#111827]/40 rounded-t-xl">
                                <input value={day.name} onChange={e => updateDayName(wk, di, e.target.value)}
                                  placeholder={`Day ${di + 1}`}
                                  className="flex-1 bg-transparent text-[13px] font-semibold text-[#E5E7EB] placeholder-[#4B5563] outline-none" />
                                {dayTime > 0 && (
                                  <span className="text-[10px] text-[#4B5563] flex items-center gap-0.5 flex-shrink-0">
                                    <Clock size={9} /> {fmtTime(dayTime)}
                                  </span>
                                )}
                                <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
                                  <button
                                    onClick={() => { setCopyDayMenu(showCopyDay ? null : { wk, di }); setCopyWeekMenu(null); }}
                                    className="text-[#4B5563] hover:text-[#9CA3AF] transition-colors p-0.5" title="Copy day">
                                    <Copy size={12} />
                                  </button>
                                  {showCopyDay && (
                                    <div className="absolute right-0 top-full mt-1 z-20 bg-[#1E293B] border border-white/10 rounded-xl shadow-xl overflow-hidden min-w-[160px] max-h-48 overflow-y-auto">
                                      <p className="text-[10px] font-bold text-[#4B5563] uppercase tracking-widest px-3 pt-2 pb-1">Copy day to…</p>
                                      {dayTargets.map((t, idx) => (
                                        <button key={idx} onClick={() => copyDayTo(wk, di, t.wk, t.di)}
                                          className="w-full text-left px-3 py-2 text-[12px] text-[#E5E7EB] hover:bg-white/6 transition-colors">
                                          {t.label}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <button onClick={() => removeDay(wk, di)}
                                  className="text-[#4B5563] hover:text-red-400 transition-colors flex-shrink-0">
                                  <X size={14} />
                                </button>
                              </div>

                              {/* Exercises */}
                              <div className="px-3 pb-3 pt-1 space-y-1">
                                {day.exercises.length === 0 && (
                                  <p className="text-[11px] text-[#4B5563] py-1">No exercises yet</p>
                                )}
                                {day.exercises.map((ex, ei) => (
                                  <div key={ei} className="py-2 border-b border-white/4 last:border-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[12px] text-[#9CA3AF] flex-1 min-w-0 truncate">{exName(ex.id)}</span>
                                      {/* Sets */}
                                      <div className="flex items-center gap-1 flex-shrink-0">
                                        <button onClick={() => updateExercise(wk, di, ei, 'sets', Math.max(1, (ex.sets ?? DEFAULT_SETS) - 1))}
                                          className="w-5 h-5 rounded-md bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[11px] flex items-center justify-center">−</button>
                                        <span className="text-[11px] text-[#E5E7EB] w-5 text-center">{ex.sets ?? DEFAULT_SETS}</span>
                                        <button onClick={() => updateExercise(wk, di, ei, 'sets', (ex.sets ?? DEFAULT_SETS) + 1)}
                                          className="w-5 h-5 rounded-md bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[11px] flex items-center justify-center">+</button>
                                        <span className="text-[10px] text-[#4B5563] w-5">sets</span>
                                      </div>
                                      {/* Reps */}
                                      <div className="flex items-center gap-1 flex-shrink-0">
                                        <input value={ex.reps ?? DEFAULT_REPS}
                                          onChange={e => updateExercise(wk, di, ei, 'reps', e.target.value)}
                                          className="w-10 bg-white/6 rounded-md px-1.5 py-0.5 text-[11px] text-[#E5E7EB] text-center outline-none focus:bg-white/10"
                                          placeholder="8-12" />
                                        <span className="text-[10px] text-[#4B5563] w-5">reps</span>
                                      </div>
                                      {/* Rest */}
                                      <div className="flex items-center gap-1 flex-shrink-0">
                                        <button onClick={() => updateExercise(wk, di, ei, 'rest_seconds', Math.max(0, (ex.rest_seconds ?? DEFAULT_REST) - 15))}
                                          className="w-5 h-5 rounded-md bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[11px] flex items-center justify-center">−</button>
                                        <span className="text-[11px] text-[#E5E7EB] w-7 text-center">{ex.rest_seconds ?? DEFAULT_REST}s</span>
                                        <button onClick={() => updateExercise(wk, di, ei, 'rest_seconds', (ex.rest_seconds ?? DEFAULT_REST) + 15)}
                                          className="w-5 h-5 rounded-md bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[11px] flex items-center justify-center">+</button>
                                        <span className="text-[10px] text-[#4B5563] w-5">rest</span>
                                      </div>
                                      <button onClick={() => removeExercise(wk, di, ei)}
                                        className="text-[#4B5563] hover:text-red-400 transition-colors ml-1 flex-shrink-0">
                                        <Trash2 size={11} />
                                      </button>
                                    </div>
                                    {/* Exercise notes */}
                                    <input
                                      value={ex.notes || ''}
                                      onChange={e => updateExercise(wk, di, ei, 'notes', e.target.value)}
                                      placeholder="Trainer notes (e.g. tempo 3-1-2, pause at bottom)"
                                      className="mt-1.5 w-full bg-transparent border-b border-white/4 text-[10px] text-[#6B7280] placeholder-[#374151] outline-none focus:border-[#D4AF37]/30 pb-0.5"
                                    />
                                  </div>
                                ))}

                                {/* Add exercise picker */}
                                <select value=""
                                  onChange={e => { addExercise(wk, di, e.target.value); e.target.value = ''; }}
                                  className="w-full bg-transparent border border-white/6 rounded-lg px-3 py-1.5 text-[11px] text-[#6B7280] outline-none mt-1">
                                  <option value="">+ Add exercise</option>
                                  {exercises.map(ex => (
                                    <option key={ex.id} value={ex.id}>{ex.name} ({ex.muscle_group})</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          );
                        })}

                        <button onClick={() => addDay(wk)}
                          className="w-full py-2 text-[12px] font-semibold text-[#D4AF37] border border-[#D4AF37]/20 rounded-xl hover:bg-[#D4AF37]/5 transition-colors">
                          + Add Day
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {error && <p className="text-[12px] text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-white/6 flex-shrink-0">
          <button onClick={handleSave} disabled={saving}
            className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] disabled:opacity-50 hover:bg-[#C4A030] transition-colors">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Plan'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────
export default function TrainerWorkoutPlans() {
  const { profile } = useAuth();
  const [plans, setPlans]       = useState([]);
  const [clients, setClients]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [filterClient, setFilterClient] = useState('all');
  const [expandedPlan, setExpandedPlan] = useState(null);

  useEffect(() => {
    if (!profile?.id) return;
    loadData();
  }, [profile?.id]);

  const loadData = async () => {
    setLoading(true);
    const [plansRes, clientsRes] = await Promise.all([
      supabase
        .from('trainer_workout_plans')
        .select('*, profiles!trainer_workout_plans_client_id_fkey(full_name)')
        .eq('trainer_id', profile.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('trainer_clients')
        .select('client_id, profiles!trainer_clients_client_id_fkey(id, full_name)')
        .eq('trainer_id', profile.id)
        .eq('is_active', true),
    ]);
    setPlans(plansRes.data || []);
    setClients((clientsRes.data || []).map(tc => tc.profiles).filter(Boolean));
    setLoading(false);
  };

  const handleSaved = () => {
    setShowBuilder(false);
    setEditing(null);
    loadData();
  };

  const toggleActive = async (plan) => {
    await supabase.from('trainer_workout_plans')
      .update({ is_active: !plan.is_active, updated_at: new Date().toISOString() })
      .eq('id', plan.id);
    loadData();
  };

  const duplicatePlan = async (plan) => {
    const { id, profiles, created_at, updated_at, ...rest } = plan;
    await supabase.from('trainer_workout_plans').insert({
      ...rest,
      name: `${plan.name} (Copy)`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    loadData();
  };

  const deletePlan = async (plan) => {
    if (!confirm(`Delete "${plan.name}"?`)) return;
    await supabase.from('trainer_workout_plans').delete().eq('id', plan.id);
    loadData();
  };

  const filtered = useMemo(() => {
    if (filterClient === 'all') return plans;
    return plans.filter(p => p.client_id === filterClient);
  }, [plans, filterClient]);

  // Count exercises in a plan
  const countExercises = (plan) => {
    const allDays = Object.values(plan.weeks || {}).flat();
    return allDays.reduce((sum, d) => sum + (d.exercises?.length || 0), 0);
  };

  if (loading) {
    return (
      <div className="px-4 md:px-8 py-6 max-w-5xl mx-auto">
        <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-6">Workout Plans</h1>
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-8 py-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">Workout Plans</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">{plans.length} plan{plans.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowBuilder(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold bg-[#D4AF37] hover:bg-[#C4A030] text-black transition-colors"
        >
          <Plus size={16} /> New Plan
        </button>
      </div>

      {/* Client filter */}
      {clients.length > 0 && plans.length > 0 && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <button onClick={() => setFilterClient('all')}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
              filterClient === 'all' ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'bg-[#111827] text-[#6B7280] hover:text-[#9CA3AF]'
            }`}>
            All Clients
          </button>
          {clients.map(c => (
            <button key={c.id} onClick={() => setFilterClient(c.id)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                filterClient === c.id ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'bg-[#111827] text-[#6B7280] hover:text-[#9CA3AF]'
              }`}>
              {c.full_name?.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      {/* Plans list */}
      {filtered.length === 0 ? (
        <div className="text-center py-20">
          <ClipboardList size={32} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">
            {plans.length === 0 ? 'No workout plans yet' : 'No plans for this client'}
          </p>
          {plans.length === 0 && (
            <p className="text-[12px] text-[#4B5563] mt-1">Create a custom workout plan for your clients</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(plan => {
            const isExpanded = expandedPlan === plan.id;
            const totalEx = countExercises(plan);
            const allDays = Object.values(plan.weeks || {}).flat();
            const totalDays = allDays.length;

            return (
              <div key={plan.id} className="bg-[#0F172A] border border-white/[0.06] rounded-[14px] overflow-hidden hover:border-white/20 hover:bg-white/[0.03] transition-all">
                {/* Plan header */}
                <button onClick={() => setExpandedPlan(isExpanded ? null : plan.id)}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/2 transition-colors">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    plan.is_active ? 'bg-[#D4AF37]/12' : 'bg-white/4'
                  }`}>
                    <Dumbbell size={18} className={plan.is_active ? 'text-[#D4AF37]' : 'text-[#4B5563]'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{plan.name}</p>
                      {!plan.is_active && (
                        <span className="text-[9px] font-bold text-[#4B5563] bg-white/4 px-1.5 py-0.5 rounded-full flex-shrink-0">INACTIVE</span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#6B7280]">
                      {plan.profiles?.full_name || 'Client'} · {plan.duration_weeks}w · {totalDays} day{totalDays !== 1 ? 's' : ''} · {totalEx} exercise{totalEx !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <ChevronDown size={16} className={`text-[#4B5563] transition-transform flex-shrink-0 ${isExpanded ? '' : '-rotate-90'}`} />
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-white/4 p-4 space-y-3">
                    {plan.description && (
                      <p className="text-[12px] text-[#9CA3AF]">{plan.description}</p>
                    )}

                    {/* Week preview */}
                    <div className="space-y-1.5">
                      {Object.entries(plan.weeks || {}).slice(0, 2).map(([wk, days]) => (
                        <div key={wk}>
                          <p className="text-[11px] font-semibold text-[#6B7280] mb-1">Week {wk}</p>
                          <div className="flex gap-1.5 flex-wrap">
                            {(days || []).map((d, di) => (
                              <span key={di} className="px-2.5 py-1 bg-[#111827] rounded-lg text-[11px] text-[#9CA3AF]">
                                {d.name || `Day ${di + 1}`}
                                <span className="text-[#4B5563] ml-1">({d.exercises?.length || 0} ex)</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                      {Object.keys(plan.weeks || {}).length > 2 && (
                        <p className="text-[10px] text-[#4B5563]">+ {Object.keys(plan.weeks).length - 2} more weeks</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t border-white/4">
                      <button onClick={() => setEditing(plan)}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#D4AF37]/15 text-[#D4AF37] hover:bg-[#D4AF37]/25 transition-colors">
                        Edit
                      </button>
                      <button onClick={() => duplicatePlan(plan)}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white/4 text-[#9CA3AF] hover:bg-white/8 transition-colors flex items-center gap-1">
                        <Copy size={11} /> Duplicate
                      </button>
                      <button onClick={() => toggleActive(plan)}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white/4 text-[#9CA3AF] hover:bg-white/8 transition-colors flex items-center gap-1">
                        {plan.is_active ? <><ToggleRight size={12} /> Deactivate</> : <><ToggleLeft size={12} /> Activate</>}
                      </button>
                      <div className="flex-1" />
                      <button onClick={() => deletePlan(plan)}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                        <Trash2 size={12} />
                      </button>
                    </div>

                    <p className="text-[10px] text-[#374151]">
                      Created {format(new Date(plan.created_at), 'MMM d, yyyy')}
                      {plan.updated_at !== plan.created_at && ` · Updated ${format(new Date(plan.updated_at), 'MMM d, yyyy')}`}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Builder modal */}
      {(showBuilder || editing) && (
        <PlanBuilder
          plan={editing}
          clients={clients}
          onClose={() => { setShowBuilder(false); setEditing(null); }}
          onSaved={handleSaved}
          trainerId={profile.id}
          gymId={profile.gym_id}
        />
      )}
    </div>
  );
}
