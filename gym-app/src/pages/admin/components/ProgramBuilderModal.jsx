/**
 * Create / Edit program modal with full week/day/exercise builder.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronLeft, ChevronRight, Trash2, Copy, Clock, MoreHorizontal } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { exName as exNameLocalized } from '../../../lib/exerciseName';
import {
  DEFAULT_SETS,
  DEFAULT_REST,
  normalizeWeeks,
  calcDaySeconds,
  fmtTime,
} from './programHelpers';

export default function ProgramBuilderModal({ program, initialData, onClose, onSave, saving, saveError }) {
  const { t } = useTranslation('pages');
  const isEdit = !!program;
  const init = program || initialData || {};
  const [name, setName]           = useState(init.name ?? '');
  const [description, setDesc]    = useState(init.description ?? '');
  const [durationWeeks, setDuration] = useState(init.duration_weeks ?? 8);
  const [weeks, setWeeks]         = useState(() => normalizeWeeks(init.weeks));
  const [currentWeek, setCurrentWeek] = useState(1);
  const [copyWeekMenu, setCopyWeekMenu] = useState(null);
  const [copyDayMenu, setCopyDayMenu]   = useState(null);
  const [localError, setLocalError]     = useState('');

  // Fetch exercises for the picker
  const { data: exercises = [] } = useQuery({
    queryKey: ['exercises-library'],
    queryFn: async () => {
      const { data } = await supabase
        .from('exercises')
        .select('id, name, name_es, muscle_group')
        .order('name');
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const exName = (id) => {
    const ex = exercises.find(e => e.id === id);
    return ex ? exNameLocalized(ex) : id;
  };

  // ── Week operations ──
  const copyWeekTo = (fromWk, toWk) => {
    setWeeks(prev => ({ ...prev, [toWk]: JSON.parse(JSON.stringify(prev[fromWk] || [])) }));
    setCopyWeekMenu(null);
    setCurrentWeek(toWk);
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
    setCurrentWeek(toWk);
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
    if (!name.trim()) { setLocalError(t('admin.programs.builder.nameRequired', 'Program name is required.')); return; }
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
        targets.push({ wk, di, label: `${t('admin.programs.builder.weekShort', 'Wk')} ${wk} \u00b7 ${d.name || `${t('admin.programs.builder.dayN', 'Day')} ${di + 1}`}` });
      });
      targets.push({ wk, di: 'new', label: `${t('admin.programs.builder.weekShort', 'Wk')} ${wk} \u00b7 ${t('admin.programs.builder.newDay', 'New day')}` });
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
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      style={{ bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))', padding: '16px' }}
      onClick={closeMenus}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-program-title"
        className="rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div>
            <p id="edit-program-title" className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{isEdit ? t('admin.programs.builder.editProgram', 'Edit Program') : t('admin.programs.builder.newProgram', 'New Program')}</p>
            {avgSessionSecs > 0 && (
              <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                <Clock size={10} /> {t('admin.programs.builder.avgPerSession', 'avg {{time}} per session', { time: fmtTime(avgSessionSecs) })}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label="Close dialog" className="min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-lg"><X size={20} className="text-[#6B7280]" /></button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Name */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.programs.builder.programName', 'Program Name')}</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder={t('admin.programs.builder.programNamePlaceholder', 'e.g. 8-Week Strength Builder')}
              className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none transition-colors"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.programs.builder.description', 'Description')}</label>
            <textarea value={description} onChange={e => setDesc(e.target.value)} rows={2}
              placeholder={t('admin.programs.builder.descriptionPlaceholder', 'What will members achieve?')}
              className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none resize-none transition-colors"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
          </div>

          {/* Duration */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.programs.builder.duration', 'Duration')}</label>
            <div className="flex gap-2">
              {[4, 6, 8, 10, 12].map(w => (
                <button key={w} onClick={() => setDuration(w)}
                  className="flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors"
                  style={durationWeeks === w
                    ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }
                    : { backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }
                  }>
                  {w}{t('admin.programs.weeksShort', 'w')}
                </button>
              ))}
            </div>
          </div>

          {/* Weekly schedule */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-3">{t('admin.programs.builder.weeklySchedule', 'Weekly Schedule')}</label>

            {/* Week navigator */}
            <div className="flex items-center justify-between rounded-xl px-3 py-2.5 mb-3" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
              <button onClick={() => setCurrentWeek(w => Math.max(1, w - 1))} disabled={currentWeek <= 1}
                aria-label={t('admin.programs.builder.previousWeek', 'Previous week')}
                className="p-1.5 rounded-lg disabled:opacity-30 transition-colors text-[#6B7280] hover:text-[#E5E7EB]">
                <ChevronLeft size={18} />
              </button>
              <div className="text-center flex items-center gap-1">
                <span className="text-[14px] font-bold text-[#E5E7EB]">
                  {t('admin.programs.builder.weekN', 'Week {{n}}', { n: currentWeek })}
                </span>
                <span className="text-[12px] text-[#6B7280]">/ {durationWeeks}</span>
                {/* Copy week menu (... button) */}
                <div className="relative ml-2" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => { setCopyWeekMenu(copyWeekMenu === currentWeek ? null : currentWeek); setCopyDayMenu(null); }}
                    className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/6 transition-colors"
                    title={t('admin.programs.builder.copyWeek', 'Copy week')}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {copyWeekMenu === currentWeek && (
                    <div className="absolute right-0 top-full mt-1 z-20 rounded-xl shadow-xl overflow-hidden min-w-[130px]" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                      <p className="text-[10px] font-bold text-[#6B7280] uppercase tracking-widest px-3 pt-2 pb-1">{t('admin.programs.builder.copyWkTo', 'Copy Wk {{n}} to...', { n: currentWeek })}</p>
                      {allWeekNums.filter(w => w !== currentWeek).map(targetWk => (
                        <button
                          key={targetWk}
                          onClick={() => copyWeekTo(currentWeek, targetWk)}
                          className="w-full text-left px-3 py-2 text-[12px] text-[#E5E7EB] hover:bg-white/6 transition-colors"
                        >
                          {t('admin.programs.builder.weekN', 'Week {{n}}', { n: targetWk })}
                          {(weeks[targetWk] || []).length > 0 && (
                            <span className="text-[#6B7280] ml-1">({t('admin.programs.builder.overwrite', 'overwrite')})</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <button onClick={() => setCurrentWeek(w => Math.min(durationWeeks, w + 1))} disabled={currentWeek >= durationWeeks}
                aria-label={t('admin.programs.builder.nextWeek', 'Next week')}
                className="p-1.5 rounded-lg disabled:opacity-30 transition-colors text-[#6B7280] hover:text-[#E5E7EB]">
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Days for current week */}
            <div className="space-y-2">
              {(weeks[currentWeek] || []).length === 0 && (
                <p className="text-[12px] text-[#6B7280] text-center py-2">{t('admin.programs.builder.noDaysYet', 'No days yet — add one below')}</p>
              )}

              {(weeks[currentWeek] || []).map((day, di) => {
                const dayTime = calcDaySeconds(day);
                const showCopyDay = copyDayMenu?.wk === currentWeek && copyDayMenu?.di === di;
                const dayTargets = allDayTargets(currentWeek, di);

                return (
                  <div key={di} className="border border-white/6 rounded-xl overflow-visible">
                    {/* Day header */}
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-t-xl" style={{ backgroundColor: 'var(--color-bg-deep)' }}>
                      <input
                        value={day.name}
                        onChange={e => updateDayName(currentWeek, di, e.target.value)}
                        placeholder={`Day ${di + 1}`}
                        aria-label={`${t('admin.programs.dayName', 'Day name')} ${di + 1}`}
                        className="flex-1 bg-transparent text-[13px] font-semibold text-[#E5E7EB] placeholder-[#9CA3AF] outline-none"
                      />
                      {dayTime > 0 && (
                        <span className="text-[10px] text-[#6B7280] flex items-center gap-0.5 flex-shrink-0">
                          <Clock size={9} /> {fmtTime(dayTime)}
                        </span>
                      )}
                      {/* Copy day menu */}
                      <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => { setCopyDayMenu(showCopyDay ? null : { wk: currentWeek, di }); setCopyWeekMenu(null); }}
                          className="text-[#6B7280] hover:text-[#9CA3AF] transition-colors p-0.5"
                          title={t('admin.programs.builder.copyDay', 'Copy day')}
                        >
                          <Copy size={12} />
                        </button>
                        {showCopyDay && (
                          <div className="absolute right-0 top-full mt-1 z-20 rounded-xl shadow-xl overflow-hidden min-w-[160px] max-h-48 overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                            <p className="text-[10px] font-bold text-[#6B7280] uppercase tracking-widest px-3 pt-2 pb-1">{t('admin.programs.builder.copyDayTo', 'Copy day to...')}</p>
                            {dayTargets.map((target, idx) => (
                              <button
                                key={idx}
                                onClick={() => copyDayTo(currentWeek, di, target.wk, target.di)}
                                className="w-full text-left px-3 py-2 text-[12px] text-[#E5E7EB] hover:bg-white/6 transition-colors"
                              >
                                {target.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeDay(currentWeek, di)}
                        aria-label={t('admin.programs.builder.removeDay', 'Remove day')}
                        className="text-[#6B7280] hover:text-red-400 transition-colors flex-shrink-0"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {/* Exercises */}
                    <div className="px-3 pb-3 pt-1 space-y-1">
                      {day.exercises.length === 0 && (
                        <p className="text-[11px] text-[#6B7280] py-1">{t('admin.programs.builder.noExercisesYet', 'No exercises yet')}</p>
                      )}
                      {day.exercises.map((ex, ei) => (
                        <div key={ei} className="flex items-center gap-2 md:gap-3 py-1.5 border-b border-white/4 last:border-0">
                          <span className="text-[12px] text-[#9CA3AF] flex-1 min-w-0 truncate md:min-w-[200px]">{exName(ex.id)}</span>
                          {/* Sets */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => updateExercise(currentWeek, di, ei, 'sets', Math.max(1, (ex.sets ?? DEFAULT_SETS) - 1))}
                              className="w-5 h-5 rounded-md bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[11px] flex items-center justify-center"
                            >{'\u2212'}</button>
                            <span className="text-[11px] text-[#E5E7EB] w-5 text-center">{ex.sets ?? DEFAULT_SETS}</span>
                            <button
                              onClick={() => updateExercise(currentWeek, di, ei, 'sets', (ex.sets ?? DEFAULT_SETS) + 1)}
                              className="w-5 h-5 rounded-md bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[11px] flex items-center justify-center"
                            >+</button>
                            <span className="text-[10px] text-[#6B7280] w-5">{t('admin.programs.builder.sets', 'sets')}</span>
                          </div>
                          {/* Rest */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => updateExercise(currentWeek, di, ei, 'rest_seconds', Math.max(0, (ex.rest_seconds ?? DEFAULT_REST) - 15))}
                              className="w-5 h-5 rounded-md bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[11px] flex items-center justify-center"
                            >{'\u2212'}</button>
                            <span className="text-[11px] text-[#E5E7EB] w-7 text-center">{ex.rest_seconds ?? DEFAULT_REST}s</span>
                            <button
                              onClick={() => updateExercise(currentWeek, di, ei, 'rest_seconds', (ex.rest_seconds ?? DEFAULT_REST) + 15)}
                              className="w-5 h-5 rounded-md bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[11px] flex items-center justify-center"
                            >+</button>
                            <span className="text-[10px] text-[#6B7280] w-5">{t('admin.programs.builder.rest', 'rest')}</span>
                          </div>
                          <button
                            onClick={() => removeExercise(currentWeek, di, ei)}
                            aria-label={t('admin.programs.builder.removeExercise', 'Remove exercise')}
                            className="text-[#6B7280] hover:text-red-400 transition-colors ml-1 flex-shrink-0"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}

                      {/* Add exercise picker */}
                      <select
                        value=""
                        onChange={e => { addExercise(currentWeek, di, e.target.value); e.target.value = ''; }}
                        className="w-full bg-transparent border border-white/6 rounded-lg px-3 py-1.5 text-[11px] text-[#6B7280] outline-none mt-1"
                      >
                        <option value="">{t('admin.programs.builder.addExercise', '+ Add exercise')}</option>
                        {exercises.map(ex => (
                          <option key={ex.id} value={ex.id}>{exNameLocalized(ex)}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}

              <button
                onClick={() => addDay(currentWeek)}
                className="w-full py-2 text-[12px] font-semibold text-[#D4AF37] border border-[#D4AF37]/20 rounded-xl hover:bg-[#D4AF37]/5 transition-colors whitespace-nowrap"
              >
                {t('admin.programs.builder.addDay', '+ Add Day')}
              </button>
            </div>
          </div>

        </div>

        {/* Footer — always visible at bottom */}
        <div className="px-5 pt-4 flex-shrink-0" style={{ backgroundColor: 'var(--color-bg-card)', borderTop: '1px solid var(--color-border-subtle)', paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))' }}>
          {error && <p className="text-[12px] text-red-400 mb-3">{error}</p>}
          <button onClick={handleSave} disabled={saving}
            className="w-full py-3.5 rounded-xl font-bold text-[14px] disabled:opacity-50 transition-colors"
            style={{ backgroundColor: 'var(--color-accent)', color: '#000' }}>
            {saving ? t('admin.programs.builder.saving', 'Guardando…') : isEdit ? t('admin.programs.builder.saveChanges', 'Guardar Cambios') : t('admin.programs.builder.createProgram', 'Crear Programa')}
          </button>
        </div>
      </div>
    </div>
  );
}
