/**
 * Template selector modal for creating new programs.
 * Includes a templates gallery tab and an auto-generate tab
 * powered by the real program generator algorithm.
 */
import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutTemplate, Sparkles, Clock, RotateCcw, Dumbbell, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { AdminModal } from '../../../components/admin';
import { PROGRAM_TEMPLATES, TEMPLATE_CATEGORIES, GOAL_BADGE, buildWeeksFromPattern } from './programHelpers';
import { generateProgram, estimateDuration } from '../../../lib/workoutGenerator';
import { exercises as allExercises } from '../../../data/exercises';
import { exName as exNameLocalized, localizeRoutineName } from '../../../lib/exerciseName';

// ── Translation maps for template badge labels ─────────────────────────────
const GOAL_LABEL_KEYS = {
  'Muscle Gain':      'admin.programs.generate.goals.muscle_gain',
  'Strength':         'admin.programs.generate.goals.strength',
  'General Fitness':  'admin.programs.generate.goals.general_fitness',
  'Strength & Size':  'admin.programs.generate.goalLabels.strength_size',
};

const LEVEL_LABEL_KEYS = {
  'Beginner':                  'admin.programs.generate.levels.beginner',
  'Intermediate':              'admin.programs.generate.levels.intermediate',
  'Advanced':                  'admin.programs.generate.levels.advanced',
  'Beginner\u2013Intermediate': 'admin.programs.generate.levelLabels.beginner_intermediate',
  'Intermediate\u2013Advanced': 'admin.programs.generate.levelLabels.intermediate_advanced',
};

// ── Goal value map (display label → generator key) ──────────────────────────
const GOAL_OPTIONS = [
  { labelKey: 'admin.programs.generate.goals.muscle_gain',     label: 'Muscle Gain',     value: 'muscle_gain' },
  { labelKey: 'admin.programs.generate.goals.strength',        label: 'Strength',        value: 'strength' },
  { labelKey: 'admin.programs.generate.goals.fat_loss',        label: 'Fat Loss',        value: 'fat_loss' },
  { labelKey: 'admin.programs.generate.goals.endurance',       label: 'Endurance',       value: 'endurance' },
  { labelKey: 'admin.programs.generate.goals.general_fitness', label: 'General Fitness', value: 'general_fitness' },
];

const LEVEL_OPTIONS = [
  { labelKey: 'admin.programs.generate.levels.beginner',     label: 'Beginner',     value: 'beginner' },
  { labelKey: 'admin.programs.generate.levels.intermediate', label: 'Intermediate', value: 'intermediate' },
  { labelKey: 'admin.programs.generate.levels.advanced',     label: 'Advanced',     value: 'advanced' },
];

const DAYS_OPTIONS = [3, 4, 5, 6];
const DURATION_OPTIONS = [4, 6, 8, 10, 12];

const ALL_EQUIPMENT_KEYS = [
  { key: 'Barbell',         labelKey: 'admin.programs.generate.equipment.barbell' },
  { key: 'Dumbbell',        labelKey: 'admin.programs.generate.equipment.dumbbell' },
  { key: 'Cable',           labelKey: 'admin.programs.generate.equipment.cable' },
  { key: 'Machine',         labelKey: 'admin.programs.generate.equipment.machine' },
  { key: 'Bodyweight',      labelKey: 'admin.programs.generate.equipment.bodyweight' },
  { key: 'Kettlebell',      labelKey: 'admin.programs.generate.equipment.kettlebell' },
  { key: 'Resistance Band', labelKey: 'admin.programs.generate.equipment.resistance_band' },
  { key: 'Smith Machine',   labelKey: 'admin.programs.generate.equipment.smith_machine' },
];

// Keep flat array for state init (equipment keys must match exercise data)
const ALL_EQUIPMENT = ALL_EQUIPMENT_KEYS.map(e => e.key);

const INJURY_REGIONS = [
  { labelKey: 'admin.programs.generate.injuries.lower_back', label: 'Lower Back', value: 'lower_back' },
  { labelKey: 'admin.programs.generate.injuries.shoulders',  label: 'Shoulders',  value: 'shoulders' },
  { labelKey: 'admin.programs.generate.injuries.knees',      label: 'Knees',      value: 'knees' },
  { labelKey: 'admin.programs.generate.injuries.wrists',     label: 'Wrists',     value: 'wrists' },
];

// ── Pill button component ───────────────────────────────────────────────────
const Pill = ({ selected, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors ${
      selected
        ? 'bg-[#D4AF37]/20 text-[#D4AF37] ring-1 ring-[#D4AF37]/40'
        : 'bg-white/[0.04] text-[#9CA3AF] hover:bg-white/[0.06]'
    }`}
  >
    {children}
  </button>
);

// ── Checkbox component ──────────────────────────────────────────────────────
const CheckItem = ({ checked, onChange, label }) => (
  <label className="flex items-center gap-2 cursor-pointer group">
    <span className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${
      checked
        ? 'bg-[#D4AF37] border-[#D4AF37]'
        : 'border-white/20 group-hover:border-white/30'
    }`}>
      {checked && (
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l2.5 2.5L9 1" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      )}
    </span>
    <span className="text-[12px] text-[#E5E7EB]">{label}</span>
  </label>
);

// ── Preview Browser — browse all weeks/days/exercises ──────────────────
function PreviewBrowser({ preview, genDays, allExercises, estimateDuration, onUse, onRegenerate, onBack, t }) {
  const [week, setWeek] = useState(1);
  const [expandedDay, setExpandedDay] = useState(0);

  const exMap = useMemo(() => {
    const m = {};
    allExercises.forEach(e => { m[e.id] = e; });
    return m;
  }, [allExercises]);

  const days = preview.allWeeks?.[week] || preview.routinesA?.map(r => ({
    name: r.label || r.name,
    exercises: r.exercises.map(ex => ({ id: ex.exerciseId, sets: ex.sets, reps: ex.reps || '8-12', rest_seconds: ex.restSeconds })),
  })) || [];

  const totalWeeks = preview.durationWeeks || Object.keys(preview.allWeeks || {}).length;

  return (
    <div className="space-y-3">
      {/* Header badges */}
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles size={15} className="text-[#D4AF37]" />
        <span className="text-[14px] font-bold text-[#E5E7EB]">{localizeRoutineName(preview.splitLabel)}</span>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${GOAL_BADGE[preview.goalLabel] ?? 'bg-white/8 text-[#9CA3AF]'}`}>
          {GOAL_LABEL_KEYS[preview.goalLabel] ? t(GOAL_LABEL_KEYS[preview.goalLabel], preview.goalLabel) : preview.goalLabel}
        </span>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/8 text-[#9CA3AF]">
          {totalWeeks} {t('admin.programs.generate.weeksLabel', 'weeks')} · {genDays} {t('admin.programs.generate.daysPerWeekShort', 'days/week')}
        </span>
      </div>

      {/* Week navigator */}
      <div className="flex items-center justify-between bg-[#111827] border border-white/6 rounded-xl px-3 py-2">
        <button onClick={() => setWeek(w => Math.max(1, w - 1))} disabled={week <= 1}
          aria-label={t('admin.programs.builder.previousWeek', 'Previous week')}
          className="p-1 rounded-lg text-[#6B7280] hover:text-[#E5E7EB] disabled:opacity-30 transition-colors">
          <ChevronLeft size={16} />
        </button>
        <span className="text-[13px] font-bold text-[#E5E7EB]">{t('admin.programs.generate.weekN', 'Week {{n}}', { n: week })} <span className="text-[#6B7280] font-normal">/ {totalWeeks}</span></span>
        <button onClick={() => setWeek(w => Math.min(totalWeeks, w + 1))} disabled={week >= totalWeeks}
          aria-label={t('admin.programs.builder.nextWeek', 'Next week')}
          className="p-1 rounded-lg text-[#6B7280] hover:text-[#E5E7EB] disabled:opacity-30 transition-colors">
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Days list */}
      <div className="space-y-1.5 max-h-[340px] overflow-y-auto">
        {days.map((day, di) => {
          const isOpen = expandedDay === di;
          return (
            <div key={di} className="bg-[#0F172A] border border-white/6 rounded-xl overflow-hidden">
              <button onClick={() => setExpandedDay(isOpen ? -1 : di)}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-2">
                  <Dumbbell size={13} className="text-[#D4AF37]" />
                  <span className="text-[13px] font-semibold text-[#E5E7EB]">{localizeRoutineName(day.name)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-[#6B7280]">{day.exercises.length} {t('admin.programs.generate.exercises', 'exercises')}</span>
                  {isOpen ? <ChevronUp size={13} className="text-[#6B7280]" /> : <ChevronDown size={13} className="text-[#6B7280]" />}
                </div>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 space-y-1">
                  {day.exercises.map((ex, ei) => {
                    const info = exMap[ex.id];
                    return (
                      <div key={ei} className="flex items-center justify-between py-1.5 px-2.5 bg-white/[0.02] rounded-lg">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-[10px] font-bold text-[#4B5563] w-4 text-right">{ei + 1}</span>
                          <span className="text-[12px] text-[#E5E7EB] truncate">{info ? exNameLocalized(info) : ex.id}</span>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="text-[11px] font-semibold text-[#D4AF37]">{ex.sets} × {ex.reps || info?.defaultReps || '8-12'}</span>
                          <span className="text-[10px] text-[#4B5563]">{ex.rest_seconds}s</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button onClick={onRegenerate}
          className="flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl border border-white/6 text-[13px] font-semibold text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/[0.04] transition-colors">
          <RotateCcw size={14} /> {t('admin.programs.generate.regenerate', 'Regenerate')}
        </button>
        <button onClick={onUse}
          className="flex-1 py-2.5 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] hover:bg-[#C4A030] transition-colors">
          {t('admin.programs.generate.useThisProgram', 'Use This Program')}
        </button>
      </div>
      <button onClick={onBack} className="w-full text-center text-[12px] text-[#6B7280] hover:text-[#9CA3AF] py-1 transition-colors">
        {t('admin.programs.generate.backToSettings', 'Back to settings')}
      </button>
    </div>
  );
}

export default function TemplatesModal({ onClose, onSelect, onStartFromScratch }) {
  const { t } = useTranslation('pages');
  const [tab, setTab] = useState('templates');
  const [templateCat, setTemplateCat] = useState('all');

  // Generator form state
  const [genGoal, setGenGoal]         = useState('muscle_gain');
  const [genLevel, setGenLevel]       = useState('intermediate');
  const [genDays, setGenDays]         = useState(4);
  const [genDuration, setGenDuration] = useState(8);
  const [genEquipment, setGenEquipment] = useState(new Set(ALL_EQUIPMENT));
  const [genInjuries, setGenInjuries]   = useState(new Set());

  // Generated result
  const [preview, setPreview] = useState(null);

  const toggleEquipment = (eq) => {
    setGenEquipment(prev => {
      const next = new Set(prev);
      next.has(eq) ? next.delete(eq) : next.add(eq);
      return next;
    });
  };

  const toggleInjury = (inj) => {
    setGenInjuries(prev => {
      const next = new Set(prev);
      next.has(inj) ? next.delete(inj) : next.add(inj);
      return next;
    });
  };

  const handleGenerate = useCallback(() => {
    const onboarding = {
      fitness_level: genLevel,
      primary_goal: genGoal,
      training_days_per_week: genDays,
      available_equipment: [...genEquipment],
      injuries_notes: [...genInjuries].join(', '),
    };

    const result = generateProgram(onboarding);

    const goalLabel = GOAL_OPTIONS.find(g => g.value === genGoal)?.label || genGoal;

    // Build all weeks — combine A + B variants to fill the requested days/week
    const allWeeks = {};
    const routinesA = result.routinesA || [];
    const routinesB = result.routinesB || routinesA;

    const mapRoutine = (r) => ({
      name: r.label || r.name,
      exercises: r.exercises.map(ex => ({
        id: ex.exerciseId,
        sets: ex.sets,
        reps: ex.reps || '8-12',
        rest_seconds: ex.restSeconds,
      })),
    });

    // Build exercise pool by muscle group for swapping
    const exByMuscle = {};
    allExercises.forEach(e => {
      if (!genEquipment.has(e.equipment)) return;
      if (!exByMuscle[e.muscle]) exByMuscle[e.muscle] = [];
      exByMuscle[e.muscle].push(e);
    });

    // Find N swap candidates for an exercise (same muscle, different exercise)
    const findSwaps = (exId, usedIds, count) => {
      const orig = allExercises.find(e => e.id === exId);
      if (!orig) return [];
      const candidates = (exByMuscle[orig.muscle] || []).filter(e =>
        e.id !== exId && !usedIds.has(e.id)
      );
      // Return up to `count` candidates, deterministically shuffled
      return candidates.slice(0, count);
    };

    // Build a week from a source (routinesA or routinesB), filling to genDays
    const buildFromSource = (sourceA, sourceB) => {
      const weekDays = [];
      for (const r of sourceA) weekDays.push(mapRoutine(r));
      const remaining = genDays - weekDays.length;
      if (remaining > 0) {
        for (let i = 0; i < Math.min(remaining, sourceB.length); i++) {
          const mapped = mapRoutine(sourceB[i]);
          if (weekDays.some(d => d.name === mapped.name)) {
            mapped.name = mapped.name.replace(/ [AB]$/, '') + ' B';
          }
          weekDays.push(mapped);
        }
      }
      return weekDays;
    };

    // Two distinct base weeks — odd weeks use base A, even weeks use base B
    // Base A: routinesA first, fill from routinesB
    // Base B: routinesB first, fill from routinesA (reversed order = different exercises lead)
    const baseWeekA = buildFromSource(routinesA, routinesB);
    const baseWeekB = buildFromSource(routinesB, routinesA);

    const buildWeek = (weekNum) => {
      const isDeload = weekNum > 1 && weekNum % (result.goalConfig?.deloadEvery || 4) === 0;
      const isOdd = weekNum % 2 === 1;

      // Alternate base weeks: odd = A, even = B (so week 1 ≠ week 2, week 1 ≈ week 3)
      const base = isOdd ? baseWeekA : baseWeekB;

      // Deep clone
      const weekDays = base.map(day => ({
        name: day.name,
        exercises: day.exercises.map(ex => ({ ...ex })),
      }));

      // Progressive swaps: every 4 weeks, swap more exercises so program evolves
      // Week 1-4: 0 extra swaps, Week 5-8: 1 swap/day, Week 9-12: 2 swaps/day
      const swapCount = Math.floor((weekNum - 1) / 4);
      if (swapCount > 0) {
        for (const day of weekDays) {
          const usedIds = new Set(day.exercises.map(e => e.id));
          let swapped = 0;
          // Swap from end (isolations) first, preserve compounds at top
          for (let i = day.exercises.length - 1; i >= 1 && swapped < swapCount; i--) {
            const ex = day.exercises[i];
            const swaps = findSwaps(ex.id, usedIds, 3);
            // Pick based on weekNum so different weeks get different swaps
            const pick = swaps[(weekNum + i) % swaps.length];
            if (pick) {
              usedIds.delete(ex.id);
              usedIds.add(pick.id);
              day.exercises[i] = { ...ex, id: pick.id };
              swapped++;
            }
          }
        }
      }

      // Deload weeks: reduce sets by ~40%
      if (isDeload) {
        for (const day of weekDays) {
          for (const ex of day.exercises) {
            ex.sets = Math.max(2, Math.round(ex.sets * 0.6));
          }
        }
      }

      // Progressive overload: +1 set on first compound every 2 weeks after week 2
      if (!isDeload && weekNum > 2 && weekNum % 2 === 0 && weekDays[0]?.exercises[0]) {
        weekDays[0].exercises[0].sets = Math.min(6, weekDays[0].exercises[0].sets + 1);
      }

      return weekDays;
    };

    for (let w = 1; w <= genDuration; w++) {
      allWeeks[w] = buildWeek(w);
    }

    setPreview({
      splitLabel: result.splitLabel,
      goalLabel,
      durationWeeks: genDuration,
      routinesA: result.routinesA,
      allWeeks,
    });
  }, [genGoal, genLevel, genDays, genDuration, genEquipment, genInjuries]);

  const handleUseProgram = () => {
    if (!preview) return;
    const goalLabel = preview.goalLabel;
    const name = `${preview.splitLabel} - ${goalLabel} (${preview.durationWeeks} weeks)`;
    const description = `Auto-generated ${preview.splitLabel} program for ${goalLabel.toLowerCase()}. ${preview.durationWeeks} weeks, ${genDays} days/week.`;

    // Use allWeeks directly — already has the right days per week, periodization, deloads
    onSelect({
      name,
      description,
      durationWeeks: preview.durationWeeks,
      weeks: preview.allWeeks,
    });
  };

  return (
    <AdminModal
      isOpen
      onClose={onClose}
      title={t('admin.programs.newProgram', 'New Program')}
      size="lg"
    >
      {/* Start from scratch link */}
      {onStartFromScratch && (
        <div className="flex justify-end -mt-2 mb-3">
          <button
            onClick={onStartFromScratch}
            className="text-[12px] font-semibold text-[#6B7280] hover:text-[#9CA3AF] px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors whitespace-nowrap"
          >
            {t('admin.programs.generate.startFromScratch', 'Start from scratch')}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        <button
          onClick={() => setTab('templates')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors ${
            tab === 'templates'
              ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
              : 'text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/4'
          }`}
        >
          <LayoutTemplate size={13} /> {t('admin.programs.generate.tabTemplates', 'Templates')}
        </button>
        <button
          onClick={() => setTab('generate')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors ${
            tab === 'generate'
              ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
              : 'text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/4'
          }`}
        >
          <Sparkles size={13} /> {t('admin.programs.generate.tabAutoGenerate', 'Auto-generate')}
        </button>
      </div>

      {/* Templates tab */}
      {tab === 'templates' && (
        <div>
          {/* Category filter */}
          <div className="flex gap-1 mb-4 flex-wrap">
            {TEMPLATE_CATEGORIES.map(c => (
              <button key={c.key} onClick={() => setTemplateCat(c.key)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                  templateCat === c.key
                    ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
                    : 'bg-white/[0.04] text-[#6B7280] border border-white/6 hover:text-[#E5E7EB]'
                }`}>
                {t(c.labelKey, c.label)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PROGRAM_TEMPLATES.filter(tpl => templateCat === 'all' || tpl.category === templateCat).map(tpl => {
            const totalDays = tpl.weekPattern.length;
            return (
              <div key={tpl.id} className="bg-[#111827] border border-white/6 rounded-2xl p-4 flex flex-col gap-3 overflow-hidden">
                <div>
                  <p className="text-[14px] font-bold text-[#E5E7EB] mb-2 truncate">{t(tpl.nameKey, tpl.name)}</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${GOAL_BADGE[tpl.goal] ?? 'bg-white/8 text-[#9CA3AF]'}`}>
                      {GOAL_LABEL_KEYS[tpl.goal] ? t(GOAL_LABEL_KEYS[tpl.goal], tpl.goal) : tpl.goal}
                    </span>
                    <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-white/8 text-[#9CA3AF]">
                      {LEVEL_LABEL_KEYS[tpl.level] ? t(LEVEL_LABEL_KEYS[tpl.level], tpl.level) : tpl.level}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#4B5563]">
                    {tpl.daysPerWeek} {t('admin.programs.generate.daysPerWeekShort', 'days/week')} · {tpl.durationWeeks} {t('admin.programs.generate.weeksLabel', 'weeks')} · {totalDays * tpl.durationWeeks} {t('admin.programs.generate.daysTotal', 'days total')}
                  </p>
                </div>
                <p className="text-[12px] text-[#6B7280] leading-relaxed flex-1">{t(tpl.descKey, tpl.description)}</p>
                <button
                  onClick={() => onSelect(tpl)}
                  className="w-full py-2 rounded-xl text-[13px] font-bold text-black bg-[#D4AF37] hover:bg-[#C4A030] transition-colors whitespace-nowrap"
                >
                  {t('admin.programs.generate.useTemplate', 'Use Template')}
                </button>
              </div>
            );
          })}
          </div>
        </div>
      )}

      {/* Auto-generate tab */}
      {tab === 'generate' && (
        <div className="space-y-5 pt-2">
          {!preview ? (
            <>
              <p className="text-[13px] text-[#6B7280]">
                {t('admin.programs.generate.configureHint', "Configure your parameters and we'll generate a complete program using the real workout algorithm.")}
              </p>

              {/* Goal */}
              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.programs.generate.goal', 'Goal')}</label>
                <select
                  value={genGoal}
                  onChange={e => setGenGoal(e.target.value)}
                  className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
                >
                  {GOAL_OPTIONS.map(g => (
                    <option key={g.value} value={g.value}>{t(g.labelKey, g.label)}</option>
                  ))}
                </select>
              </div>

              {/* Level */}
              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.programs.generate.level', 'Experience Level')}</label>
                <select
                  value={genLevel}
                  onChange={e => setGenLevel(e.target.value)}
                  className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
                >
                  {LEVEL_OPTIONS.map(l => (
                    <option key={l.value} value={l.value}>{t(l.labelKey, l.label)}</option>
                  ))}
                </select>
              </div>

              {/* Days per week — pills */}
              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2">{t('admin.programs.generate.daysPerWeek', 'Days Per Week')}</label>
                <div className="flex gap-2">
                  {DAYS_OPTIONS.map(d => (
                    <Pill key={d} selected={genDays === d} onClick={() => setGenDays(d)}>{d}</Pill>
                  ))}
                </div>
              </div>

              {/* Duration — pills */}
              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2">{t('admin.programs.generate.duration', 'Duration (weeks)')}</label>
                <div className="flex flex-wrap gap-2">
                  {DURATION_OPTIONS.map(w => (
                    <Pill key={w} selected={genDuration === w} onClick={() => setGenDuration(w)}>
                      {w} {t('admin.programs.weeksShort', 'w')}
                    </Pill>
                  ))}
                </div>
              </div>

              {/* Equipment — checkboxes */}
              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2">{t('admin.programs.generate.equipmentLabel', 'Equipment')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_EQUIPMENT_KEYS.map(eq => (
                    <CheckItem
                      key={eq.key}
                      checked={genEquipment.has(eq.key)}
                      onChange={() => toggleEquipment(eq.key)}
                      label={t(eq.labelKey, eq.key)}
                    />
                  ))}
                </div>
              </div>

              {/* Injuries — pill toggles */}
              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2">{t('admin.programs.generate.injuriesLabel', 'Injuries to avoid')} <span className="text-[#4B5563]">({t('admin.programs.generate.optional', 'optional')})</span></label>
                <div className="flex flex-wrap gap-2">
                  {INJURY_REGIONS.map(inj => (
                    <Pill
                      key={inj.value}
                      selected={genInjuries.has(inj.value)}
                      onClick={() => toggleInjury(inj.value)}
                    >
                      {t(inj.labelKey, inj.label)}
                    </Pill>
                  ))}
                </div>
              </div>

              {/* Generate button */}
              <button
                onClick={handleGenerate}
                disabled={genEquipment.size === 0}
                className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] hover:bg-[#C4A030] disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                {t('admin.programs.generate.generateProgram', 'Generate Program')}
              </button>
            </>
          ) : (
            /* ── Full Preview ── */
            <PreviewBrowser preview={preview} genDays={genDays} allExercises={allExercises} estimateDuration={estimateDuration}
              onUse={handleUseProgram} onRegenerate={() => { setPreview(null); handleGenerate(); }} onBack={() => setPreview(null)} t={t} />
          )}
        </div>
      )}
    </AdminModal>
  );
}
