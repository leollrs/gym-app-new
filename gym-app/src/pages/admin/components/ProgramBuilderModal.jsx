/**
 * Create / Edit program modal with full week/day/exercise builder.
 */
import { useEffect, useState } from 'react';
import { X, ChevronDown, Trash2, Copy, Clock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import {
  DEFAULT_SETS,
  DEFAULT_REST,
  normalizeWeeks,
  calcDaySeconds,
  fmtTime,
} from './programHelpers';

export default function ProgramBuilderModal({ program, initialData, onClose, onSave, saving, saveError }) {
  const isEdit = !!program;
  const init = program || initialData || {};
  const [name, setName]           = useState(init.name ?? '');
  const [description, setDesc]    = useState(init.description ?? '');
  const [durationWeeks, setDuration] = useState(init.duration_weeks ?? 8);
  const [weeks, setWeeks]         = useState(() => normalizeWeeks(init.weeks));
  const [expandedWeeks, setExpandedWeeks] = useState(new Set([1]));
  const [copyWeekMenu, setCopyWeekMenu] = useState(null);
  const [copyDayMenu, setCopyDayMenu]   = useState(null);
  const [localError, setLocalError]     = useState('');

  // Fetch exercises for the picker
  const { data: exercises = [] } = useQuery({
    queryKey: ['exercises-library'],
    queryFn: async () => {
      const { data } = await supabase
        .from('exercises')
        .select('id, name, muscle_group')
        .order('name');
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

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
  const handleSave = () => {
    if (!name.trim()) { setLocalError('Program name is required.'); return; }
    setLocalError('');
    onSave({ name: name.trim(), description: description.trim(), durationWeeks, weeks });
  };

  const allWeekNums = Array.from({ length: durationWeeks }, (_, i) => i + 1);

  const allDayTargets = (fromWk, fromDi) => {
    const targets = [];
    allWeekNums.forEach(wk => {
      const days = weeks[wk] || [];
      days.forEach((d, di) => {
        if (wk === fromWk && di === fromDi) return;
        targets.push({ wk, di, label: `Wk ${wk} \u00b7 ${d.name || `Day ${di + 1}`}` });
      });
      targets.push({ wk, di: 'new', label: `Wk ${wk} \u00b7 New day` });
    });
    return targets;
  };

  const avgSessionSecs = (() => {
    const allDays = Object.values(weeks).flat();
    if (!allDays.length) return 0;
    return Math.round(allDays.reduce((s, d) => s + calcDaySeconds(d), 0) / allDays.length);
  })();

  const closeMenus = () => { setCopyWeekMenu(null); setCopyDayMenu(null); };
  const error = localError || saveError;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={closeMenus}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-program-title"
        className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/6 flex-shrink-0">
          <div>
            <p id="edit-program-title" className="text-[16px] font-bold text-[#E5E7EB]">{isEdit ? 'Edit Program' : 'New Program'}</p>
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
                            {days.length} day{days.length !== 1 ? 's' : ''}{totalEx > 0 ? ` \u00b7 ${totalEx} ex` : ''}{wkTime > 0 ? ` \u00b7 ~${fmtTime(wkTime / Math.max(days.length, 1))} avg` : ''}
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
                            <p className="text-[10px] font-bold text-[#4B5563] uppercase tracking-widest px-3 pt-2 pb-1">Copy Wk {wk} to...</p>
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
                                      <p className="text-[10px] font-bold text-[#4B5563] uppercase tracking-widest px-3 pt-2 pb-1">Copy day to...</p>
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
                                  <div key={ei} className="flex items-center gap-2 md:gap-3 py-1.5 border-b border-white/4 last:border-0">
                                    <span className="text-[12px] text-[#9CA3AF] flex-1 min-w-0 truncate md:min-w-[200px]">{exName(ex.id)}</span>
                                    {/* Sets */}
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                      <button
                                        onClick={() => updateExercise(wk, di, ei, 'sets', Math.max(1, (ex.sets ?? DEFAULT_SETS) - 1))}
                                        className="w-5 h-5 rounded-md bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[11px] flex items-center justify-center"
                                      >{'\u2212'}</button>
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
                                      >{'\u2212'}</button>
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
            {saving ? 'Saving\u2026' : isEdit ? 'Save Changes' : 'Create Program'}
          </button>
        </div>
      </div>
    </div>
  );
}
