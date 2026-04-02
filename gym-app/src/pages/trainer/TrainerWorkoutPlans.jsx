import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  Plus, X, ChevronDown, ChevronRight, Trash2, Copy, Clock, Dumbbell, Users,
  ClipboardList, Search, ToggleLeft, ToggleRight, ArrowLeft, StickyNote,
  ChevronUp, FileText, Calendar,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import { useTranslation } from 'react-i18next';

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

// ── Exercise Search Panel ────────────────────────────────
const ExerciseSearchPanel = ({ exercises, exSearch, setExSearch, onAdd, t }) => {
  const filteredExercises = useMemo(() => {
    if (!exSearch.trim()) return exercises;
    const q = exSearch.toLowerCase();
    return exercises.filter(e =>
      e.name.toLowerCase().includes(q) || e.muscle_group?.toLowerCase().includes(q)
    );
  }, [exercises, exSearch]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
        <input
          value={exSearch}
          onChange={e => setExSearch(e.target.value)}
          placeholder={t('trainerPlans.searchExercises', 'Search exercises...')}
          className="w-full bg-[#111827] border border-white/6 rounded-xl pl-9 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40"
        />
      </div>
      <div className="space-y-0.5 max-h-[320px] overflow-y-auto overscroll-contain">
        {filteredExercises.length === 0 && (
          <p className="text-[12px] text-[#6B7280] text-center py-4">{t('trainerPlans.noExercisesFound', 'No exercises found')}</p>
        )}
        {filteredExercises.map(ex => (
          <button
            key={ex.id}
            onClick={() => onAdd(ex.id)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-white/6 transition-colors group min-h-[44px]"
          >
            <Plus size={14} className="text-[#6B7280] group-hover:text-[#D4AF37] flex-shrink-0 transition-colors" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-[#E5E7EB] truncate">{ex.name}</p>
              {ex.muscle_group && (
                <p className="text-[10px] text-[#6B7280]">{ex.muscle_group}</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

// ── Day Card (within builder) ────────────────────────────
const DayCard = ({ day, di, wk, exercises, exName, updateDayName, removeDay, addExercise, removeExercise, updateExercise, copyDayMenu, setCopyDayMenu, setCopyWeekMenu, allDayTargets, copyDayTo, weeks, t }) => {
  const dayTime = calcDaySeconds(day);
  const showCopyDay = copyDayMenu?.wk === wk && copyDayMenu?.di === di;
  const dayTargets = allDayTargets(wk, di);
  const [expanded, setExpanded] = useState(true);
  const [showExSearch, setShowExSearch] = useState(false);
  const [exSearch, setExSearch] = useState('');

  return (
    <div className="border border-white/6 rounded-2xl overflow-visible bg-[#0F172A]/60">
      {/* Day header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-[#111827]/40 rounded-t-2xl">
        <button onClick={() => setExpanded(!expanded)} className="flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2">
          <ChevronDown size={14} className={`text-[#6B7280] transition-transform ${expanded ? '' : '-rotate-90'}`} />
        </button>
        <input value={day.name} onChange={e => updateDayName(wk, di, e.target.value)}
          placeholder={`Day ${di + 1}`}
          className="flex-1 bg-transparent text-[14px] font-semibold text-[#E5E7EB] placeholder-[#6B7280] outline-none min-w-0" />
        {dayTime > 0 && (
          <span className="text-[11px] text-[#6B7280] flex items-center gap-1 flex-shrink-0">
            <Clock size={10} /> {fmtTime(dayTime)}
          </span>
        )}
        <span className="text-[11px] text-[#6B7280] flex-shrink-0">
          {day.exercises.length} {t('trainerPlans.ex', 'ex')}
        </span>
        <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => { setCopyDayMenu(showCopyDay ? null : { wk, di }); setCopyWeekMenu(null); }}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#6B7280] hover:text-[#9CA3AF] transition-colors" title={t('trainerPlans.copyDay', 'Copy day')}>
            <Copy size={13} />
          </button>
          {showCopyDay && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-[#1E293B] border border-white/10 rounded-xl shadow-xl overflow-hidden min-w-[180px] max-h-48 overflow-y-auto">
              <p className="text-[10px] font-bold text-[#6B7280] uppercase tracking-widest px-3 pt-2 pb-1">{t('trainerPlans.copyDayTo', 'Copy day to...')}</p>
              {dayTargets.map((target, idx) => (
                <button key={idx} onClick={() => copyDayTo(wk, di, target.wk, target.di)}
                  className="w-full text-left px-3 py-2 text-[12px] text-[#E5E7EB] hover:bg-white/6 transition-colors min-h-[44px] flex items-center">
                  {target.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => removeDay(wk, di)}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#6B7280] hover:text-red-400 transition-colors flex-shrink-0">
          <Trash2 size={13} />
        </button>
      </div>

      {/* Exercises */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 space-y-1">
          {day.exercises.length === 0 && (
            <p className="text-[12px] text-[#6B7280] py-2 text-center">{t('trainerPlans.noExercisesYet', 'No exercises yet')}</p>
          )}
          {day.exercises.map((ex, ei) => (
            <div key={ei} className="py-2.5 border-b border-white/4 last:border-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] text-[#E5E7EB] flex-1 min-w-0 truncate font-medium">{exName(ex.id)}</span>
                {/* Sets */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => updateExercise(wk, di, ei, 'sets', Math.max(1, (ex.sets ?? DEFAULT_SETS) - 1))}
                    className="w-7 h-7 rounded-lg bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[12px] flex items-center justify-center">−</button>
                  <span className="text-[12px] text-[#E5E7EB] w-5 text-center">{ex.sets ?? DEFAULT_SETS}</span>
                  <button onClick={() => updateExercise(wk, di, ei, 'sets', (ex.sets ?? DEFAULT_SETS) + 1)}
                    className="w-7 h-7 rounded-lg bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[12px] flex items-center justify-center">+</button>
                  <span className="text-[10px] text-[#6B7280] w-6">{t('trainerPlans.sets', 'sets')}</span>
                </div>
                {/* Reps */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <input value={ex.reps ?? DEFAULT_REPS}
                    onChange={e => updateExercise(wk, di, ei, 'reps', e.target.value)}
                    className="w-12 bg-white/6 rounded-lg px-2 py-1 text-[12px] text-[#E5E7EB] text-center outline-none focus:bg-white/10"
                    placeholder="8-12" />
                  <span className="text-[10px] text-[#6B7280] w-6">{t('trainerPlans.reps', 'reps')}</span>
                </div>
                {/* Rest */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => updateExercise(wk, di, ei, 'rest_seconds', Math.max(0, (ex.rest_seconds ?? DEFAULT_REST) - 15))}
                    className="w-7 h-7 rounded-lg bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[12px] flex items-center justify-center">−</button>
                  <span className="text-[12px] text-[#E5E7EB] w-8 text-center">{ex.rest_seconds ?? DEFAULT_REST}s</span>
                  <button onClick={() => updateExercise(wk, di, ei, 'rest_seconds', (ex.rest_seconds ?? DEFAULT_REST) + 15)}
                    className="w-7 h-7 rounded-lg bg-white/6 text-[#9CA3AF] hover:bg-white/10 text-[12px] flex items-center justify-center">+</button>
                  <span className="text-[10px] text-[#6B7280] w-6">{t('trainerPlans.rest', 'rest')}</span>
                </div>
                <button onClick={() => removeExercise(wk, di, ei)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#6B7280] hover:text-red-400 transition-colors flex-shrink-0">
                  <Trash2 size={12} />
                </button>
              </div>
              {/* Exercise notes */}
              <input
                value={ex.notes || ''}
                onChange={e => updateExercise(wk, di, ei, 'notes', e.target.value)}
                maxLength={500}
                placeholder={t('trainerPlans.trainerNotes', 'Trainer notes (e.g. tempo 3-1-2, pause at bottom)')}
                className="mt-2 w-full bg-transparent border-b border-white/4 text-[11px] text-[#6B7280] placeholder-[#374151] outline-none focus:border-[#D4AF37]/30 pb-0.5"
              />
            </div>
          ))}

          {/* Add exercise - searchable panel */}
          {showExSearch ? (
            <div className="mt-2 border border-white/8 rounded-xl p-3 bg-[#111827]/60">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[12px] font-semibold text-[#9CA3AF]">{t('trainerPlans.addExercise', 'Add Exercise')}</p>
                <button onClick={() => { setShowExSearch(false); setExSearch(''); }}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#6B7280] hover:text-[#9CA3AF] -mr-2">
                  <X size={14} />
                </button>
              </div>
              <ExerciseSearchPanel
                exercises={exercises}
                exSearch={exSearch}
                setExSearch={setExSearch}
                onAdd={(id) => { addExercise(wk, di, id); }}
                t={t}
              />
            </div>
          ) : (
            <button onClick={() => setShowExSearch(true)}
              className="w-full py-2.5 mt-1 text-[12px] font-semibold text-[#D4AF37] border border-[#D4AF37]/20 rounded-xl hover:bg-[#D4AF37]/5 transition-colors flex items-center justify-center gap-1.5 min-h-[44px]">
              <Plus size={14} /> {t('trainerPlans.addExercise', 'Add Exercise')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ── Plan Builder (full-page workspace) ───────────────────
const PlanBuilder = ({ plan, clients, onClose, onSaved, trainerId, gymId, t }) => {
  const isEdit = !!plan;
  const init = plan || {};
  const [clientId, setClientId]     = useState(init.client_id || '');
  const [name, setName]             = useState(init.name ?? '');
  const [description, setDesc]      = useState(init.description ?? '');
  const [durationWeeks, setDuration]= useState(init.duration_weeks ?? 4);
  const [weeks, setWeeks]           = useState(() => normalizeWeeks(init.weeks));
  const [exercises, setExercises]   = useState([]);
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [copyWeekMenu, setCopyWeekMenu]   = useState(null);
  const [copyDayMenu, setCopyDayMenu]     = useState(null);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    supabase.from('exercises').select('id, name, muscle_group').order('name')
      .then(({ data }) => setExercises(data || []));
  }, []);

  const exName = (id) => exercises.find(e => e.id === id)?.name ?? id;

  // Week operations
  const copyWeekTo = (fromWk, toWk) => {
    setWeeks(prev => ({ ...prev, [toWk]: JSON.parse(JSON.stringify(prev[fromWk] || [])) }));
    setCopyWeekMenu(null);
    setSelectedWeek(toWk);
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
    setSelectedWeek(toWk);
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
    if (!clientId) { setError(t('trainerPlans.selectClientError', 'Please select a client.')); return; }
    if (!name.trim()) { setError(t('trainerPlans.nameRequired', 'Plan name is required.')); return; }
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
        targets.push({ wk, di, label: `${t('trainerPlans.wkAbbrev', 'Wk')} ${wk} · ${d.name || `Day ${di + 1}`}` });
      });
      targets.push({ wk, di: 'new', label: `${t('trainerPlans.wkAbbrev', 'Wk')} ${wk} · ${t('trainerPlans.newDay', 'New day')}` });
    });
    return targets;
  };

  const currentDays = weeks[selectedWeek] || [];
  const showCopyWeek = copyWeekMenu === selectedWeek;

  const closeMenus = () => { setCopyWeekMenu(null); setCopyDayMenu(null); };

  // Stats for week rail
  const weekStats = (wk) => {
    const days = weeks[wk] || [];
    const exCount = days.reduce((s, d) => s + (d.exercises?.length || 0), 0);
    return { dayCount: days.length, exCount };
  };

  return (
    <div className="min-h-screen bg-[#0F172A]" onClick={closeMenus}>
      {/* ── Sticky top header ── */}
      <div className="sticky top-0 z-30 bg-[#0F172A]/95 backdrop-blur-md border-b border-white/6">
        <div className="max-w-[480px] mx-auto md:max-w-5xl px-4 py-3 flex items-center gap-3">
          <button onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-white/6 transition-colors flex-shrink-0"
            aria-label={t('trainerPlans.backToList', 'Back to plans')}>
            <ArrowLeft size={20} className="text-[#9CA3AF]" />
          </button>
          <div className="flex-1 min-w-0">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('trainerPlans.planNamePlaceholder', 'Plan name...')}
              className="w-full bg-transparent text-[18px] font-bold text-[#E5E7EB] placeholder-[#6B7280] outline-none truncate"
            />
            <div className="flex items-center gap-2 mt-0.5">
              <select value={clientId} onChange={e => setClientId(e.target.value)} disabled={isEdit}
                className="bg-transparent text-[12px] text-[#9CA3AF] outline-none disabled:opacity-60 max-w-[160px] truncate cursor-pointer">
                <option value="">{t('trainerPlans.selectClient', 'Select client...')}</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                (plan?.is_active ?? true) ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/4 text-[#6B7280]'
              }`}>
                {(plan?.is_active ?? true) ? t('trainerPlans.active', 'Active') : t('trainerPlans.inactive', 'Inactive')}
              </span>
            </div>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2.5 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] disabled:opacity-50 hover:bg-[#C4A030] transition-colors flex-shrink-0 whitespace-nowrap min-h-[44px]">
            {saving ? t('trainerPlans.saving', 'Saving...') : isEdit ? t('trainerPlans.saveChanges', 'Save Changes') : t('trainerPlans.createPlan', 'Create Plan')}
          </button>
        </div>

        {/* Collapsible details */}
        <div className="max-w-[480px] mx-auto md:max-w-5xl px-4">
          <button onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1.5 text-[11px] text-[#6B7280] hover:text-[#9CA3AF] transition-colors py-1.5 min-h-[44px]">
            <FileText size={11} />
            {t('trainerPlans.details', 'Details')}
            <ChevronDown size={11} className={`transition-transform ${showDetails ? '' : '-rotate-90'}`} />
          </button>
          {showDetails && (
            <div className="pb-3">
              <textarea value={description} onChange={e => setDesc(e.target.value)} rows={2}
                placeholder={t('trainerPlans.descPlaceholder', 'Goals and approach for this plan...')}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 resize-none" />
            </div>
          )}
        </div>

        {/* Mobile: week selector as horizontal scroll pills */}
        <div className="md:hidden max-w-[480px] mx-auto px-4 pb-2">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            {allWeekNums.map(wk => {
              const stats = weekStats(wk);
              return (
                <button key={wk} onClick={() => setSelectedWeek(wk)}
                  className={`flex-shrink-0 px-3 py-2 rounded-xl text-[12px] font-semibold transition-colors min-h-[44px] ${
                    selectedWeek === wk
                      ? 'bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30'
                      : 'bg-[#111827] text-[#6B7280] border border-white/6'
                  }`}>
                  <span className="block">{t('trainerPlans.weekAbbrev', 'Wk')} {wk}</span>
                  <span className="block text-[10px] mt-0.5 opacity-70">{stats.dayCount}d · {stats.exCount}ex</span>
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="max-w-[480px] mx-auto md:max-w-5xl px-4 pb-2">
            <p className="text-[12px] text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
          </div>
        )}
      </div>

      {/* ── Main content: 2 col desktop, 1 col mobile ── */}
      <div className="max-w-[480px] mx-auto md:max-w-5xl md:flex md:min-h-[calc(100vh-140px)]">
        {/* ── Left rail (desktop only) ── */}
        <div className="hidden md:block w-64 flex-shrink-0 border-r border-white/6 bg-[#111827]/60 sticky top-[140px] self-start max-h-[calc(100vh-140px)] overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Duration selector */}
            <div>
              <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-2">{t('trainerPlans.duration', 'Duration')}</p>
              <div className="flex gap-1.5">
                {[4, 6, 8, 10, 12].map(w => (
                  <button key={w} onClick={() => setDuration(w)}
                    className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors min-h-[36px] ${
                      durationWeeks === w ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'bg-[#0F172A]/60 text-[#6B7280] hover:text-[#9CA3AF]'
                    }`}>
                    {w}w
                  </button>
                ))}
              </div>
            </div>

            {/* Week list */}
            <div>
              <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-2">{t('trainerPlans.weeks', 'Weeks')}</p>
              <div className="space-y-1">
                {allWeekNums.map(wk => {
                  const stats = weekStats(wk);
                  const isActive = selectedWeek === wk;
                  return (
                    <div key={wk} className="flex items-center gap-1">
                      <button
                        onClick={() => setSelectedWeek(wk)}
                        className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-colors min-h-[44px] ${
                          isActive
                            ? 'bg-[#D4AF37]/10 text-[#D4AF37] border-l-2 border-[#D4AF37]'
                            : 'text-[#9CA3AF] hover:bg-white/4 border-l-2 border-transparent'
                        }`}
                      >
                        <Calendar size={13} className={isActive ? 'text-[#D4AF37]' : 'text-[#6B7280]'} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium">{t('trainerPlans.weekLabel', 'Week')} {wk}</p>
                          <p className="text-[10px] text-[#6B7280]">{stats.dayCount} {t('trainerPlans.daysAbbrev', 'days')} · {stats.exCount} {t('trainerPlans.ex', 'ex')}</p>
                        </div>
                      </button>
                      <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => { setCopyWeekMenu(copyWeekMenu === wk ? null : wk); setCopyDayMenu(null); }}
                          className="min-w-[36px] min-h-[36px] flex items-center justify-center text-[#6B7280] hover:text-[#9CA3AF] rounded-lg hover:bg-white/6 transition-colors"
                          title={t('trainerPlans.copyWeek', 'Copy week')}>
                          <Copy size={11} />
                        </button>
                        {copyWeekMenu === wk && (
                          <div className="absolute left-0 top-full mt-1 z-20 bg-[#1E293B] border border-white/10 rounded-xl shadow-xl overflow-hidden min-w-[140px]">
                            <p className="text-[10px] font-bold text-[#6B7280] uppercase tracking-widest px-3 pt-2 pb-1">
                              {t('trainerPlans.copyWkTo', 'Copy Wk {{wk}} to...', { wk })}
                            </p>
                            {allWeekNums.filter(w => w !== wk).map(targetWk => (
                              <button key={targetWk} onClick={() => copyWeekTo(wk, targetWk)}
                                className="w-full text-left px-3 py-2 text-[12px] text-[#E5E7EB] hover:bg-white/6 transition-colors min-h-[44px] flex items-center">
                                {t('trainerPlans.weekLabel', 'Week')} {targetWk}
                                {(weeks[targetWk] || []).length > 0 && <span className="text-[#6B7280] ml-1">({t('trainerPlans.overwrite', 'overwrite')})</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── Main panel ── */}
        <div className="flex-1 px-4 py-4 md:py-6 md:px-6 pb-28 md:pb-12">
          {/* Mobile: duration selector */}
          <div className="md:hidden mb-4">
            <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-2">{t('trainerPlans.duration', 'Duration')}</p>
            <div className="flex gap-2">
              {[4, 6, 8, 10, 12].map(w => (
                <button key={w} onClick={() => setDuration(w)}
                  className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors min-h-[44px] ${
                    durationWeeks === w ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'bg-[#111827] border border-white/6 text-[#6B7280]'
                  }`}>
                  {w}w
                </button>
              ))}
            </div>
          </div>

          {/* Week heading + copy action (mobile shows selected week, desktop shows too) */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] font-bold text-[#E5E7EB]">{t('trainerPlans.weekLabel', 'Week')} {selectedWeek}</h2>
              <span className="text-[12px] text-[#6B7280]">
                {currentDays.length} {t('trainerPlans.daysAbbrev', 'days')}
              </span>
            </div>
            {/* Mobile copy week */}
            <div className="relative md:hidden" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => { setCopyWeekMenu(showCopyWeek ? null : selectedWeek); setCopyDayMenu(null); }}
                className="flex items-center gap-1 text-[12px] font-semibold text-[#6B7280] hover:text-[#9CA3AF] px-3 py-2 rounded-xl hover:bg-white/6 transition-colors min-h-[44px]">
                <Copy size={12} /> {t('trainerPlans.copy', 'Copy')}
              </button>
              {showCopyWeek && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-[#1E293B] border border-white/10 rounded-xl shadow-xl overflow-hidden min-w-[140px]">
                  <p className="text-[10px] font-bold text-[#6B7280] uppercase tracking-widest px-3 pt-2 pb-1">
                    {t('trainerPlans.copyWkTo', 'Copy Wk {{wk}} to...', { wk: selectedWeek })}
                  </p>
                  {allWeekNums.filter(w => w !== selectedWeek).map(targetWk => (
                    <button key={targetWk} onClick={() => copyWeekTo(selectedWeek, targetWk)}
                      className="w-full text-left px-3 py-2 text-[12px] text-[#E5E7EB] hover:bg-white/6 transition-colors min-h-[44px] flex items-center">
                      {t('trainerPlans.weekLabel', 'Week')} {targetWk}
                      {(weeks[targetWk] || []).length > 0 && <span className="text-[#6B7280] ml-1">({t('trainerPlans.overwrite', 'overwrite')})</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Days for selected week */}
          <div className="space-y-3">
            {currentDays.length === 0 && (
              <div className="text-center py-12">
                <ClipboardList size={28} className="text-[#374151] mx-auto mb-2" />
                <p className="text-[13px] text-[#6B7280]">{t('trainerPlans.noDaysYet', 'No days yet — add one below')}</p>
              </div>
            )}

            {currentDays.map((day, di) => (
              <DayCard
                key={di}
                day={day}
                di={di}
                wk={selectedWeek}
                exercises={exercises}
                exName={exName}
                updateDayName={updateDayName}
                removeDay={removeDay}
                addExercise={addExercise}
                removeExercise={removeExercise}
                updateExercise={updateExercise}
                copyDayMenu={copyDayMenu}
                setCopyDayMenu={setCopyDayMenu}
                setCopyWeekMenu={setCopyWeekMenu}
                allDayTargets={allDayTargets}
                copyDayTo={copyDayTo}
                weeks={weeks}
                t={t}
              />
            ))}

            <button onClick={() => addDay(selectedWeek)}
              className="w-full py-3 text-[13px] font-semibold text-[#D4AF37] border border-[#D4AF37]/20 rounded-2xl hover:bg-[#D4AF37]/5 transition-colors min-h-[44px] flex items-center justify-center gap-1.5">
              <Plus size={15} /> {t('trainerPlans.addDay', 'Add Day')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────
export default function TrainerWorkoutPlans() {
  const { profile } = useAuth();
  const { t } = useTranslation('pages');
  const [plans, setPlans]       = useState([]);
  const [clients, setClients]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [view, setView]         = useState('list'); // 'list' | 'builder'
  const [editing, setEditing]   = useState(null);
  const [filterClient, setFilterClient] = useState('all');
  const [filterStatus, setFilterStatus] = useState('active'); // 'active' | 'all' | 'archived'
  const [expandedPlan, setExpandedPlan] = useState(null);
  const [adherenceMap, setAdherenceMap] = useState({});

  useEffect(() => { document.title = 'Trainer - Workout Plans | TuGymPR'; }, []);

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
    const loadedPlans = plansRes.data || [];
    setPlans(loadedPlans);
    setClients((clientsRes.data || []).map(tc => tc.profiles).filter(Boolean));

    // Compute adherence for active plans with assigned clients
    const activePlans = loadedPlans.filter(p => p.is_active && p.client_id);
    if (activePlans.length > 0) {
      const now = new Date();
      const wkStart = startOfWeek(now, { weekStartsOn: 1 }).toISOString();
      const wkEnd = endOfWeek(now, { weekStartsOn: 1 }).toISOString();
      const clientIds = [...new Set(activePlans.map(p => p.client_id))];

      const { data: weekSessions } = await supabase
        .from('workout_sessions')
        .select('profile_id')
        .in('profile_id', clientIds)
        .eq('status', 'completed')
        .gte('started_at', wkStart)
        .lte('started_at', wkEnd);

      const sessionCounts = {};
      (weekSessions || []).forEach(s => {
        sessionCounts[s.profile_id] = (sessionCounts[s.profile_id] || 0) + 1;
      });

      const newAdherence = {};
      activePlans.forEach(p => {
        const allDays = Object.values(p.weeks || {}).flat();
        const totalWeeks = Object.keys(p.weeks || {}).length || 1;
        const expectedPerWeek = Math.round(allDays.length / totalWeeks) || 3;
        newAdherence[p.id] = {
          completed: sessionCounts[p.client_id] || 0,
          expected: expectedPerWeek,
        };
      });
      setAdherenceMap(newAdherence);
    }

    setLoading(false);
  };

  const handleSaved = () => {
    setView('list');
    setEditing(null);
    loadData();
  };

  const openBuilder = (plan = null) => {
    setEditing(plan);
    setView('builder');
  };

  const closeBuilder = () => {
    setView('list');
    setEditing(null);
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
    if (!confirm(t('trainerPlans.confirmDelete', 'Delete "{{name}}"?', { name: plan.name }))) return;
    await supabase.from('trainer_workout_plans').delete().eq('id', plan.id);
    loadData();
  };

  const filtered = useMemo(() => {
    let result = plans;
    // Status filter
    if (filterStatus === 'active') result = result.filter(p => p.is_active);
    else if (filterStatus === 'archived') result = result.filter(p => !p.is_active);
    // Client filter
    if (filterClient !== 'all') result = result.filter(p => p.client_id === filterClient);
    return result;
  }, [plans, filterClient, filterStatus]);

  const countExercises = (plan) => {
    const allDays = Object.values(plan.weeks || {}).flat();
    return allDays.reduce((sum, d) => sum + (d.exercises?.length || 0), 0);
  };

  // ── Builder view ──
  if (view === 'builder') {
    return (
      <PlanBuilder
        plan={editing}
        clients={clients}
        onClose={closeBuilder}
        onSaved={handleSaved}
        trainerId={profile.id}
        gymId={profile.gym_id}
        t={t}
      />
    );
  }

  // ── List view ──
  if (loading) {
    return (
      <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
        <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-6 truncate">{t('trainerPlans.title', 'Workout Plans')}</h1>
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-bold text-[#E5E7EB] truncate">{t('trainerPlans.title', 'Workout Plans')}</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">
            {t('trainerPlans.planCount', '{{count}} plan', { count: plans.length })}{plans.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => openBuilder()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[14px] font-bold bg-[#D4AF37] hover:bg-[#C4A030] text-black transition-colors flex-shrink-0 whitespace-nowrap min-h-[44px]"
        >
          <Plus size={16} /> {t('trainerPlans.createPlan', 'Create Plan')}
        </button>
      </div>

      {/* Filters row */}
      <div className="space-y-3 mb-5">
        {/* Status filter */}
        <div className="flex items-center gap-1.5 bg-[#111827] rounded-xl p-1 w-fit">
          {(['active', 'all', 'archived']).map(status => (
            <button key={status} onClick={() => setFilterStatus(status)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors min-h-[36px] ${
                filterStatus === status ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'text-[#6B7280] hover:text-[#9CA3AF]'
              }`}>
              {status === 'active' ? t('trainerPlans.statusActive', 'Active')
                : status === 'all' ? t('trainerPlans.statusAll', 'All')
                : t('trainerPlans.statusArchived', 'Archived')}
            </button>
          ))}
        </div>

        {/* Client filter pills */}
        {clients.length > 0 && plans.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setFilterClient('all')}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors min-h-[36px] ${
                filterClient === 'all' ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'bg-[#111827] text-[#6B7280] hover:text-[#9CA3AF]'
              }`}>
              {t('trainerPlans.allClients', 'All Clients')}
            </button>
            {clients.map(c => (
              <button key={c.id} onClick={() => setFilterClient(c.id)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors min-h-[36px] ${
                  filterClient === c.id ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'bg-[#111827] text-[#6B7280] hover:text-[#9CA3AF]'
                }`}>
                {c.full_name?.split(' ')[0]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Plans list */}
      {filtered.length === 0 ? (
        <div className="text-center py-20">
          <ClipboardList size={32} className="text-[#6B7280] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">
            {plans.length === 0
              ? t('trainerPlans.noPlansYet', 'No workout plans yet')
              : t('trainerPlans.noPlansFiltered', 'No plans match these filters')}
          </p>
          {plans.length === 0 && (
            <p className="text-[12px] text-[#6B7280] mt-1">{t('trainerPlans.createHint', 'Create a custom workout plan for your clients')}</p>
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
              <div key={plan.id} className="bg-[#0F172A] border border-white/[0.06] rounded-2xl overflow-hidden hover:border-white/20 hover:bg-white/[0.03] transition-all">
                {/* Plan header */}
                <button onClick={() => setExpandedPlan(isExpanded ? null : plan.id)}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/2 transition-colors min-h-[44px]">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    plan.is_active ? 'bg-[#D4AF37]/12' : 'bg-white/4'
                  }`}>
                    <Dumbbell size={18} className={plan.is_active ? 'text-[#D4AF37]' : 'text-[#6B7280]'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{plan.name}</p>
                      {!plan.is_active && (
                        <span className="text-[9px] font-bold text-[#6B7280] bg-white/4 px-1.5 py-0.5 rounded-full flex-shrink-0">{t('trainerPlans.inactiveBadge', 'INACTIVE')}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#6B7280]">
                      {plan.profiles?.full_name || t('trainerPlans.client', 'Client')} · {plan.duration_weeks}w · {totalDays} {t('trainerPlans.daysAbbrev', 'days')} · {totalEx} {t('trainerPlans.ex', 'ex')}
                    </p>
                    {/* Adherence indicator */}
                    {adherenceMap[plan.id] && (() => {
                      const { completed, expected } = adherenceMap[plan.id];
                      const pct = expected > 0 ? Math.round((completed / expected) * 100) : 0;
                      const color = pct >= 80 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400';
                      const dotColor = pct >= 80 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
                      return (
                        <p className={`text-[11px] font-medium ${color} flex items-center gap-1.5 mt-0.5`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${dotColor} flex-shrink-0`} />
                          {t('trainer.clientCompletedXOfY', '{{completed}} of {{expected}} sessions this week', { completed, expected })}
                        </p>
                      );
                    })()}
                    {/* Last updated */}
                    {plan.updated_at && plan.updated_at !== plan.created_at && (
                      <p className="text-[10px] text-[#374151] mt-0.5">
                        {t('trainerPlans.updated', 'Updated')} {format(new Date(plan.updated_at), 'MMM d')}
                      </p>
                    )}
                  </div>
                  <ChevronDown size={16} className={`text-[#6B7280] transition-transform flex-shrink-0 ${isExpanded ? '' : '-rotate-90'}`} />
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
                          <p className="text-[11px] font-semibold text-[#6B7280] mb-1">{t('trainerPlans.weekLabel', 'Week')} {wk}</p>
                          <div className="flex gap-1.5 flex-wrap">
                            {(days || []).map((d, di) => (
                              <span key={di} className="px-2.5 py-1 bg-[#111827] rounded-lg text-[11px] text-[#9CA3AF]">
                                {d.name || `Day ${di + 1}`}
                                <span className="text-[#6B7280] ml-1">({d.exercises?.length || 0} {t('trainerPlans.ex', 'ex')})</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                      {Object.keys(plan.weeks || {}).length > 2 && (
                        <p className="text-[10px] text-[#6B7280]">+ {Object.keys(plan.weeks).length - 2} {t('trainerPlans.moreWeeks', 'more weeks')}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t border-white/4 flex-wrap">
                      <button onClick={() => openBuilder(plan)}
                        className="px-3 py-1.5 rounded-xl text-[12px] font-medium bg-[#D4AF37]/15 text-[#D4AF37] hover:bg-[#D4AF37]/25 transition-colors min-h-[44px]">
                        {t('trainerPlans.edit', 'Edit')}
                      </button>
                      <button onClick={() => duplicatePlan(plan)}
                        className="px-3 py-1.5 rounded-xl text-[12px] font-medium bg-white/4 text-[#9CA3AF] hover:bg-white/8 transition-colors flex items-center gap-1 min-h-[44px]">
                        <Copy size={11} /> {t('trainerPlans.duplicate', 'Duplicate')}
                      </button>
                      <button onClick={() => toggleActive(plan)}
                        className="px-3 py-1.5 rounded-xl text-[12px] font-medium bg-white/4 text-[#9CA3AF] hover:bg-white/8 transition-colors flex items-center gap-1 min-h-[44px]">
                        {plan.is_active
                          ? <><ToggleRight size={12} /> {t('trainerPlans.deactivate', 'Deactivate')}</>
                          : <><ToggleLeft size={12} /> {t('trainerPlans.activate', 'Activate')}</>}
                      </button>
                      <div className="flex-1" />
                      <button onClick={() => deletePlan(plan)}
                        className="px-3 py-1.5 rounded-xl text-[12px] font-medium text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors min-h-[44px]">
                        <Trash2 size={12} />
                      </button>
                    </div>

                    <p className="text-[10px] text-[#374151]">
                      {t('trainerPlans.created', 'Created')} {format(new Date(plan.created_at), 'MMM d, yyyy')}
                      {plan.updated_at !== plan.created_at && ` · ${t('trainerPlans.updated', 'Updated')} ${format(new Date(plan.updated_at), 'MMM d, yyyy')}`}
                    </p>
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
