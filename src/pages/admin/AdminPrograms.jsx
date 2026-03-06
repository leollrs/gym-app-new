import { useEffect, useState } from 'react';
import { Plus, Dumbbell, X, ChevronDown, ChevronRight, Trash2, Copy, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

// ── Data helpers ──────────────────────────────────────────
// weeks JSONB structure:
// { "1": [{ name: "Push Day", exercises: [{ id, sets, rest_seconds }] }] }

const DEFAULT_SETS = 3;
const DEFAULT_REST = 60;

const normalizeExercise = (ex) => {
  if (typeof ex === 'string') return { id: ex, sets: DEFAULT_SETS, rest_seconds: DEFAULT_REST };
  return { id: ex.id, sets: ex.sets ?? DEFAULT_SETS, rest_seconds: ex.rest_seconds ?? DEFAULT_REST };
};

const normalizeWeeks = (raw) => {
  const result = {};
  Object.entries(raw || {}).forEach(([wk, val]) => {
    if (!Array.isArray(val) || val.length === 0) { result[wk] = []; return; }
    // Old flat format (array of strings) → wrap in a single day
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

// Estimated time for one day in seconds: sum(sets * 45s + (sets-1) * rest)
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

// ── Create / Edit program modal ───────────────────────────
const ProgramModal = ({ program, onClose, onSaved, gymId, adminId }) => {
  const isEdit = !!program;
  const [name, setName]           = useState(program?.name ?? '');
  const [description, setDesc]    = useState(program?.description ?? '');
  const [durationWeeks, setDuration] = useState(program?.duration_weeks ?? 8);
  const [weeks, setWeeks]         = useState(() => normalizeWeeks(program?.weeks));
  const [exercises, setExercises] = useState([]);
  const [expandedWeeks, setExpandedWeeks] = useState(new Set([1]));
  const [copyWeekMenu, setCopyWeekMenu] = useState(null); // weekNum being copied
  const [copyDayMenu, setCopyDayMenu]   = useState(null); // { wk, di } being copied
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  useEffect(() => {
    supabase.from('exercises').select('id, name, muscle_group').order('name')
      .then(({ data }) => setExercises(data || []));
  }, []);

  const exName = (id) => exercises.find(e => e.id === id)?.name ?? id;

  // ── Week operations ──
  const toggleWeek = (wk) => setExpandedWeeks(prev => {
    const s = new Set(prev); s.has(wk) ? s.delete(wk) : s.add(wk); return s;
  });

  const copyWeekTo = (fromWk, toWk) => {
    setWeeks(prev => ({ ...prev, [toWk]: JSON.parse(JSON.stringify(prev[fromWk] || [])) }));
    setCopyWeekMenu(null);
    setExpandedWeeks(prev => new Set([...prev, toWk]));
  };

  // ── Day operations ──
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

  // ── Exercise operations ──
  const addExercise = (wk, di, id) => {
    if (!id) return;
    setWeeks(prev => ({
      ...prev,
      [wk]: prev[wk].map((d, i) => i === di
        ? { ...d, exercises: [...d.exercises, { id, sets: DEFAULT_SETS, rest_seconds: DEFAULT_REST }] }
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
      ? {
          ...d,
          exercises: d.exercises.map((ex, j) => j === ei ? { ...ex, [field]: val } : ex),
        }
      : d
    ),
  }));

  // ── Save ──
  const handleSave = async () => {
    if (!name.trim()) { setError('Program name is required.'); return; }
    setSaving(true);
    setError('');
    const payload = {
      gym_id: gymId,
      created_by: adminId,
      name: name.trim(),
      description: description.trim(),
      duration_weeks: durationWeeks,
      weeks,
      is_published: true,
    };
    const { error: err } = isEdit
      ? await supabase.from('gym_programs').update(payload).eq('id', program.id)
      : await supabase.from('gym_programs').insert(payload);
    if (err) { setError(err.message); setSaving(false); return; }
    onSaved();
    onClose();
  };

  const allWeekNums = Array.from({ length: durationWeeks }, (_, i) => i + 1);

  // All day targets for copy-day dropdown
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

  // Avg session time across all days
  const avgSessionSecs = (() => {
    const allDays = Object.values(weeks).flat();
    if (!allDays.length) return 0;
    return Math.round(allDays.reduce((s, d) => s + calcDaySeconds(d), 0) / allDays.length);
  })();

  const closeMenus = () => { setCopyWeekMenu(null); setCopyDayMenu(null); };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={closeMenus}
    >
      <div
        className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/6 flex-shrink-0">
          <div>
            <p className="text-[16px] font-bold text-[#E5E7EB]">{isEdit ? 'Edit Program' : 'New Program'}</p>
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

          {/* Name */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Program Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. 8-Week Strength Builder"
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Description</label>
            <textarea value={description} onChange={e => setDesc(e.target.value)} rows={2}
              placeholder="What will members achieve?"
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
                const isOpen   = expandedWeeks.has(wk);
                const days     = weeks[wk] || [];
                const showCopyWeek = copyWeekMenu === wk;
                const totalEx  = days.reduce((s, d) => s + d.exercises.length, 0);
                const wkTime   = days.reduce((s, d) => s + calcDaySeconds(d), 0);

                return (
                  <div key={wk} className="border border-white/8 rounded-xl overflow-visible">
                    {/* Week header */}
                    <div className="flex items-center bg-[#111827]/60 px-3 py-2.5 gap-2 rounded-xl">
                      <button
                        onClick={() => toggleWeek(wk)}
                        className="flex items-center gap-2 flex-1 text-left"
                      >
                        <ChevronDown size={14} className={`text-[#6B7280] transition-transform flex-shrink-0 ${isOpen ? '' : '-rotate-90'}`} />
                        <span className="text-[13px] font-semibold text-[#E5E7EB]">Week {wk}</span>
                        {!isOpen && (
                          <span className="text-[11px] text-[#4B5563] ml-1">
                            {days.length} day{days.length !== 1 ? 's' : ''}{totalEx > 0 ? ` · ${totalEx} ex` : ''}{wkTime > 0 ? ` · ~${fmtTime(wkTime / Math.max(days.length, 1))} avg` : ''}
                          </span>
                        )}
                      </button>

                      {/* Copy week menu */}
                      <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => { setCopyWeekMenu(showCopyWeek ? null : wk); setCopyDayMenu(null); }}
                          className="flex items-center gap-1 text-[11px] font-semibold text-[#6B7280] hover:text-[#9CA3AF] px-2 py-1 rounded-lg hover:bg-white/6 transition-colors"
                        >
                          <Copy size={11} /> Copy week
                        </button>
                        {showCopyWeek && (
                          <div className="absolute right-0 top-full mt-1 z-20 bg-[#1E293B] border border-white/10 rounded-xl shadow-xl overflow-hidden min-w-[130px]">
                            <p className="text-[10px] font-bold text-[#4B5563] uppercase tracking-widest px-3 pt-2 pb-1">Copy Wk {wk} to…</p>
                            {allWeekNums.filter(w => w !== wk).map(targetWk => (
                              <button
                                key={targetWk}
                                onClick={() => copyWeekTo(wk, targetWk)}
                                className="w-full text-left px-3 py-2 text-[12px] text-[#E5E7EB] hover:bg-white/6 transition-colors"
                              >
                                Week {targetWk}
                                {(weeks[targetWk] || []).length > 0 && (
                                  <span className="text-[#4B5563] ml-1">(overwrite)</span>
                                )}
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
                                <input
                                  value={day.name}
                                  onChange={e => updateDayName(wk, di, e.target.value)}
                                  placeholder={`Day ${di + 1}`}
                                  className="flex-1 bg-transparent text-[13px] font-semibold text-[#E5E7EB] placeholder-[#4B5563] outline-none"
                                />
                                {dayTime > 0 && (
                                  <span className="text-[10px] text-[#4B5563] flex items-center gap-0.5 flex-shrink-0">
                                    <Clock size={9} /> {fmtTime(dayTime)}
                                  </span>
                                )}
                                {/* Copy day menu */}
                                <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
                                  <button
                                    onClick={() => { setCopyDayMenu(showCopyDay ? null : { wk, di }); setCopyWeekMenu(null); }}
                                    className="text-[#4B5563] hover:text-[#9CA3AF] transition-colors p-0.5"
                                    title="Copy day"
                                  >
                                    <Copy size={12} />
                                  </button>
                                  {showCopyDay && (
                                    <div className="absolute right-0 top-full mt-1 z-20 bg-[#1E293B] border border-white/10 rounded-xl shadow-xl overflow-hidden min-w-[160px] max-h-48 overflow-y-auto">
                                      <p className="text-[10px] font-bold text-[#4B5563] uppercase tracking-widest px-3 pt-2 pb-1">Copy day to…</p>
                                      {dayTargets.map((t, idx) => (
                                        <button
                                          key={idx}
                                          onClick={() => copyDayTo(wk, di, t.wk, t.di)}
                                          className="w-full text-left px-3 py-2 text-[12px] text-[#E5E7EB] hover:bg-white/6 transition-colors"
                                        >
                                          {t.label}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <button
                                  onClick={() => removeDay(wk, di)}
                                  className="text-[#4B5563] hover:text-red-400 transition-colors flex-shrink-0"
                                >
                                  <X size={14} />
                                </button>
                              </div>

                              {/* Exercises */}
                              <div className="px-3 pb-3 pt-1 space-y-1">
                                {day.exercises.length === 0 && (
                                  <p className="text-[11px] text-[#4B5563] py-1">No exercises yet</p>
                                )}
                                {day.exercises.map((ex, ei) => (
                                  <div key={ei} className="flex items-center gap-2 py-1.5 border-b border-white/4 last:border-0">
                                    <span className="text-[12px] text-[#9CA3AF] flex-1 min-w-0 truncate">{exName(ex.id)}</span>
                                    {/* Sets */}
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                      <button
                                        onClick={() => updateExercise(wk, di, ei, 'sets', Math.max(1, (ex.sets ?? DEFAULT_SETS) - 1))}
                                        className="w-5 h-5 rounded-md bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[11px] flex items-center justify-center"
                                      >−</button>
                                      <span className="text-[11px] text-[#E5E7EB] w-5 text-center">{ex.sets ?? DEFAULT_SETS}</span>
                                      <button
                                        onClick={() => updateExercise(wk, di, ei, 'sets', (ex.sets ?? DEFAULT_SETS) + 1)}
                                        className="w-5 h-5 rounded-md bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[11px] flex items-center justify-center"
                                      >+</button>
                                      <span className="text-[10px] text-[#4B5563] w-5">sets</span>
                                    </div>
                                    {/* Rest */}
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                      <button
                                        onClick={() => updateExercise(wk, di, ei, 'rest_seconds', Math.max(0, (ex.rest_seconds ?? DEFAULT_REST) - 15))}
                                        className="w-5 h-5 rounded-md bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[11px] flex items-center justify-center"
                                      >−</button>
                                      <span className="text-[11px] text-[#E5E7EB] w-7 text-center">{ex.rest_seconds ?? DEFAULT_REST}s</span>
                                      <button
                                        onClick={() => updateExercise(wk, di, ei, 'rest_seconds', (ex.rest_seconds ?? DEFAULT_REST) + 15)}
                                        className="w-5 h-5 rounded-md bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[11px] flex items-center justify-center"
                                      >+</button>
                                      <span className="text-[10px] text-[#4B5563] w-5">rest</span>
                                    </div>
                                    <button
                                      onClick={() => removeExercise(wk, di, ei)}
                                      className="text-[#4B5563] hover:text-red-400 transition-colors ml-1 flex-shrink-0"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  </div>
                                ))}

                                {/* Add exercise picker */}
                                <select
                                  value=""
                                  onChange={e => { addExercise(wk, di, e.target.value); e.target.value = ''; }}
                                  className="w-full bg-transparent border border-white/6 rounded-lg px-3 py-1.5 text-[11px] text-[#6B7280] outline-none mt-1"
                                >
                                  <option value="">+ Add exercise</option>
                                  {exercises.map(ex => (
                                    <option key={ex.id} value={ex.id}>{ex.name}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          );
                        })}

                        <button
                          onClick={() => addDay(wk)}
                          className="w-full py-2 text-[12px] font-semibold text-[#D4AF37] border border-[#D4AF37]/20 rounded-xl hover:bg-[#D4AF37]/5 transition-colors"
                        >
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
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Program'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────
export default function AdminPrograms() {
  const { profile, user } = useAuth();
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]   = useState(null);

  const load = async () => {
    if (!profile?.gym_id) return;
    const { data } = await supabase
      .from('gym_programs')
      .select('*')
      .eq('gym_id', profile.gym_id)
      .order('created_at', { ascending: false });
    setPrograms(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [profile?.gym_id]);

  const handleDelete = async (id) => {
    if (!confirm('Delete this program?')) return;
    await supabase.from('gym_programs').delete().eq('id', id);
    load();
  };

  return (
    <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">Programs</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">Gym-branded workout programs for members</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#D4AF37] text-black font-bold text-[13px] rounded-xl hover:bg-[#C4A030] transition-colors">
          <Plus size={15} /> New Program
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : programs.length === 0 ? (
        <div className="text-center py-20">
          <Dumbbell size={32} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">No programs yet</p>
          <p className="text-[12px] text-[#4B5563] mt-1">Create structured programs for your members to follow</p>
        </div>
      ) : (
        <div className="space-y-3">
          {programs.map(p => {
            const wks = normalizeWeeks(p.weeks);
            const allDays = Object.values(wks).flat();
            const totalDays = allDays.length;
            const totalEx   = allDays.reduce((s, d) => s + d.exercises.length, 0);
            const avgTime   = totalDays > 0
              ? Math.round(allDays.reduce((s, d) => s + calcDaySeconds(d), 0) / totalDays)
              : 0;
            return (
              <div key={p.id} className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                      <Dumbbell size={17} className="text-[#D4AF37]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{p.name}</p>
                      <p className="text-[11px] text-[#6B7280]">
                        {p.duration_weeks}w · {totalDays} days · {totalEx} exercises
                        {avgTime > 0 && ` · ~${fmtTime(avgTime)}/session`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${p.is_published ? 'text-emerald-400 bg-emerald-500/10' : 'text-[#6B7280] bg-white/6'}`}>
                      {p.is_published ? 'Published' : 'Draft'}
                    </span>
                    <button onClick={() => setEditing(p)} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors p-1">
                      <ChevronRight size={16} />
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="text-[#6B7280] hover:text-red-400 transition-colors p-1">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {p.description && (
                  <p className="text-[12px] text-[#6B7280] mt-2 ml-12 line-clamp-2">{p.description}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <ProgramModal onClose={() => setShowCreate(false)} onSaved={load} gymId={profile.gym_id} adminId={user.id} />
      )}
      {editing && (
        <ProgramModal program={editing} onClose={() => setEditing(null)} onSaved={load} gymId={profile.gym_id} adminId={user.id} />
      )}
    </div>
  );
}
