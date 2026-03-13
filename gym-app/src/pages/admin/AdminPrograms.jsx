import { useEffect, useState } from 'react';
import { Plus, Dumbbell, X, ChevronDown, ChevronRight, Trash2, Copy, Clock, LayoutTemplate, Sparkles, Users } from 'lucide-react';
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

// ── Program Templates ─────────────────────────────────────
const PROGRAM_TEMPLATES = [
  {
    id: 'ppl',
    name: 'Push / Pull / Legs',
    description: 'Classic 6-day split targeting all muscle groups twice per week. Best for intermediate lifters focused on hypertrophy.',
    goal: 'Muscle Gain',
    level: 'Intermediate',
    daysPerWeek: 6,
    durationWeeks: 8,
    weekPattern: [
      { name: 'Push', exercises: [
        { id: 'ex_bp',   sets: 4, rest_seconds: 120 },
        { id: 'ex_ibp',  sets: 3, rest_seconds: 90 },
        { id: 'ex_dbp',  sets: 3, rest_seconds: 90 },
        { id: 'ex_ohp',  sets: 3, rest_seconds: 90 },
        { id: 'ex_lr',   sets: 3, rest_seconds: 60 },
        { id: 'ex_tpd',  sets: 3, rest_seconds: 60 },
        { id: 'ex_ske',  sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Pull', exercises: [
        { id: 'ex_dl',   sets: 3, rest_seconds: 180 },
        { id: 'ex_bbr',  sets: 4, rest_seconds: 120 },
        { id: 'ex_lp',   sets: 3, rest_seconds: 90 },
        { id: 'ex_cbr',  sets: 3, rest_seconds: 90 },
        { id: 'ex_bbc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_hc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_rfly', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Legs', exercises: [
        { id: 'ex_sq',   sets: 4, rest_seconds: 180 },
        { id: 'ex_rdl',  sets: 3, rest_seconds: 120 },
        { id: 'ex_lp_l', sets: 3, rest_seconds: 90 },
        { id: 'ex_le',   sets: 3, rest_seconds: 60 },
        { id: 'ex_lc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_scr',  sets: 4, rest_seconds: 45 },
      ]},
      { name: 'Push', exercises: [
        { id: 'ex_idbp', sets: 4, rest_seconds: 90 },
        { id: 'ex_dfly', sets: 3, rest_seconds: 60 },
        { id: 'ex_dips', sets: 3, rest_seconds: 90 },
        { id: 'ex_dbop', sets: 3, rest_seconds: 90 },
        { id: 'ex_fr',   sets: 3, rest_seconds: 60 },
        { id: 'ex_oe',   sets: 3, rest_seconds: 60 },
        { id: 'ex_cgp',  sets: 3, rest_seconds: 90 },
      ]},
      { name: 'Pull', exercises: [
        { id: 'ex_pu',   sets: 4, rest_seconds: 120 },
        { id: 'ex_dbr',  sets: 4, rest_seconds: 90 },
        { id: 'ex_cbr',  sets: 3, rest_seconds: 90 },
        { id: 'ex_fcu',  sets: 3, rest_seconds: 60 },
        { id: 'ex_dbc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_cc',   sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Legs', exercises: [
        { id: 'ex_sq',   sets: 4, rest_seconds: 180 },
        { id: 'ex_bdl',  sets: 3, rest_seconds: 90 },
        { id: 'ex_hth',  sets: 3, rest_seconds: 90 },
        { id: 'ex_le',   sets: 3, rest_seconds: 60 },
        { id: 'ex_lc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_secr', sets: 4, rest_seconds: 45 },
      ]},
    ],
  },
  {
    id: 'upper_lower',
    name: 'Upper / Lower Split',
    description: '4-day split alternating upper and lower body. Balances strength and hypertrophy. Great for beginners and intermediates.',
    goal: 'Strength & Size',
    level: 'Beginner–Intermediate',
    daysPerWeek: 4,
    durationWeeks: 8,
    weekPattern: [
      { name: 'Upper A (Strength)', exercises: [
        { id: 'ex_bp',   sets: 4, rest_seconds: 120 },
        { id: 'ex_bbr',  sets: 4, rest_seconds: 120 },
        { id: 'ex_ohp',  sets: 3, rest_seconds: 90 },
        { id: 'ex_pu',   sets: 3, rest_seconds: 120 },
        { id: 'ex_bbc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_cgp',  sets: 3, rest_seconds: 90 },
      ]},
      { name: 'Lower A (Strength)', exercises: [
        { id: 'ex_sq',    sets: 4, rest_seconds: 180 },
        { id: 'ex_rdl',   sets: 3, rest_seconds: 120 },
        { id: 'ex_lunge', sets: 3, rest_seconds: 90 },
        { id: 'ex_lc',    sets: 3, rest_seconds: 60 },
        { id: 'ex_scr',   sets: 4, rest_seconds: 45 },
      ]},
      { name: 'Upper B (Hypertrophy)', exercises: [
        { id: 'ex_idbp', sets: 3, rest_seconds: 90 },
        { id: 'ex_dbr',  sets: 4, rest_seconds: 90 },
        { id: 'ex_dbop', sets: 3, rest_seconds: 90 },
        { id: 'ex_lp',   sets: 3, rest_seconds: 90 },
        { id: 'ex_dbc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_tpd',  sets: 3, rest_seconds: 60 },
        { id: 'ex_lr',   sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Lower B (Hypertrophy)', exercises: [
        { id: 'ex_lp_l', sets: 4, rest_seconds: 90 },
        { id: 'ex_bdl',  sets: 3, rest_seconds: 90 },
        { id: 'ex_hth',  sets: 4, rest_seconds: 90 },
        { id: 'ex_le',   sets: 3, rest_seconds: 60 },
        { id: 'ex_lc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_secr', sets: 4, rest_seconds: 45 },
      ]},
    ],
  },
  {
    id: 'full_body',
    name: 'Full Body 3×/Week',
    description: 'Three full-body sessions per week. Ideal for beginners, time-crunched members, or anyone building a base.',
    goal: 'General Fitness',
    level: 'Beginner',
    daysPerWeek: 3,
    durationWeeks: 8,
    weekPattern: [
      { name: 'Full Body A', exercises: [
        { id: 'ex_sq',  sets: 3, rest_seconds: 180 },
        { id: 'ex_bp',  sets: 3, rest_seconds: 120 },
        { id: 'ex_bbr', sets: 3, rest_seconds: 120 },
        { id: 'ex_ohp', sets: 3, rest_seconds: 90 },
        { id: 'ex_bbc', sets: 3, rest_seconds: 60 },
        { id: 'ex_tpd', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Full Body B', exercises: [
        { id: 'ex_dl',  sets: 3, rest_seconds: 180 },
        { id: 'ex_dbp', sets: 3, rest_seconds: 90 },
        { id: 'ex_pu',  sets: 3, rest_seconds: 120 },
        { id: 'ex_rdl', sets: 3, rest_seconds: 120 },
        { id: 'ex_hc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_oe',  sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Full Body C', exercises: [
        { id: 'ex_sq',   sets: 3, rest_seconds: 180 },
        { id: 'ex_idbp', sets: 3, rest_seconds: 90 },
        { id: 'ex_lp',   sets: 3, rest_seconds: 90 },
        { id: 'ex_lunge',sets: 3, rest_seconds: 60 },
        { id: 'ex_cbr',  sets: 3, rest_seconds: 90 },
        { id: 'ex_plank',sets: 3, rest_seconds: 60 },
      ]},
    ],
  },
  {
    id: 'strength_531',
    name: '5/3/1 Strength',
    description: "Jim Wendler's proven powerlifting-style program built around the squat, bench, deadlift, and overhead press. 4 days/week.",
    goal: 'Strength',
    level: 'Intermediate–Advanced',
    daysPerWeek: 4,
    durationWeeks: 12,
    weekPattern: [
      { name: 'Squat Day', exercises: [
        { id: 'ex_sq',    sets: 5, rest_seconds: 180 },
        { id: 'ex_lp_l',  sets: 3, rest_seconds: 90 },
        { id: 'ex_le',    sets: 3, rest_seconds: 60 },
        { id: 'ex_lc',    sets: 3, rest_seconds: 60 },
        { id: 'ex_plank', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Bench Day', exercises: [
        { id: 'ex_bp',   sets: 5, rest_seconds: 180 },
        { id: 'ex_idbp', sets: 3, rest_seconds: 90 },
        { id: 'ex_tpd',  sets: 3, rest_seconds: 60 },
        { id: 'ex_bbc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_lr',   sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Deadlift Day', exercises: [
        { id: 'ex_dl',  sets: 5, rest_seconds: 180 },
        { id: 'ex_bbr', sets: 3, rest_seconds: 120 },
        { id: 'ex_cbr', sets: 3, rest_seconds: 90 },
        { id: 'ex_hc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_llr', sets: 3, rest_seconds: 60 },
      ]},
      { name: 'OHP Day', exercises: [
        { id: 'ex_ohp',  sets: 5, rest_seconds: 180 },
        { id: 'ex_dbop', sets: 3, rest_seconds: 90 },
        { id: 'ex_fcu',  sets: 3, rest_seconds: 60 },
        { id: 'ex_ske',  sets: 3, rest_seconds: 60 },
        { id: 'ex_rfly', sets: 3, rest_seconds: 60 },
      ]},
    ],
  },
  {
    id: 'bro_split',
    name: 'Classic Bro Split',
    description: 'One muscle group per day. High volume isolation work. 5 days/week. Popular for dedicated gym-goers focused on aesthetics.',
    goal: 'Muscle Gain',
    level: 'Intermediate',
    daysPerWeek: 5,
    durationWeeks: 8,
    weekPattern: [
      { name: 'Chest', exercises: [
        { id: 'ex_bp',   sets: 4, rest_seconds: 120 },
        { id: 'ex_ibp',  sets: 3, rest_seconds: 90 },
        { id: 'ex_idbp', sets: 3, rest_seconds: 90 },
        { id: 'ex_cfly', sets: 3, rest_seconds: 60 },
        { id: 'ex_dips', sets: 3, rest_seconds: 90 },
      ]},
      { name: 'Back', exercises: [
        { id: 'ex_dl',  sets: 4, rest_seconds: 180 },
        { id: 'ex_bbr', sets: 4, rest_seconds: 120 },
        { id: 'ex_pu',  sets: 3, rest_seconds: 120 },
        { id: 'ex_lp',  sets: 3, rest_seconds: 90 },
        { id: 'ex_cbr', sets: 3, rest_seconds: 90 },
      ]},
      { name: 'Shoulders', exercises: [
        { id: 'ex_ohp',  sets: 4, rest_seconds: 120 },
        { id: 'ex_dbop', sets: 3, rest_seconds: 90 },
        { id: 'ex_lr',   sets: 4, rest_seconds: 60 },
        { id: 'ex_fr',   sets: 3, rest_seconds: 60 },
        { id: 'ex_rfly', sets: 3, rest_seconds: 60 },
        { id: 'ex_fcu',  sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Arms', exercises: [
        { id: 'ex_bbc', sets: 4, rest_seconds: 60 },
        { id: 'ex_dbc', sets: 3, rest_seconds: 60 },
        { id: 'ex_hc',  sets: 3, rest_seconds: 60 },
        { id: 'ex_tpd', sets: 4, rest_seconds: 60 },
        { id: 'ex_ske', sets: 3, rest_seconds: 60 },
        { id: 'ex_oe',  sets: 3, rest_seconds: 60 },
      ]},
      { name: 'Legs', exercises: [
        { id: 'ex_sq',   sets: 4, rest_seconds: 180 },
        { id: 'ex_rdl',  sets: 3, rest_seconds: 120 },
        { id: 'ex_lp_l', sets: 3, rest_seconds: 90 },
        { id: 'ex_le',   sets: 3, rest_seconds: 60 },
        { id: 'ex_lc',   sets: 3, rest_seconds: 60 },
        { id: 'ex_hth',  sets: 3, rest_seconds: 90 },
        { id: 'ex_scr',  sets: 4, rest_seconds: 45 },
      ]},
    ],
  },
];

const buildWeeksFromPattern = (pattern, durationWeeks) => {
  const weeks = {};
  for (let w = 1; w <= durationWeeks; w++) {
    weeks[w] = JSON.parse(JSON.stringify(pattern));
  }
  return weeks;
};

// ── Templates Modal ───────────────────────────────────────
const GOAL_BADGE = {
  'Muscle Gain':      'bg-purple-500/15 text-purple-400',
  'Strength':         'bg-red-500/15 text-red-400',
  'General Fitness':  'bg-emerald-500/15 text-emerald-400',
  'Strength & Size':  'bg-blue-500/15 text-blue-400',
};

const TemplatesModal = ({ onClose, onSelect, onStartFromScratch }) => {
  const [tab, setTab] = useState('templates');

  // Auto-generate form state
  const [genGoal, setGenGoal]   = useState('Muscle Gain');
  const [genLevel, setGenLevel] = useState('Intermediate');
  const [genDays, setGenDays]   = useState(4);

  const pickTemplate = (goal, level, days) => {
    if (level === 'Beginner') return PROGRAM_TEMPLATES.find(t => t.id === 'full_body');
    if (goal === 'Fat Loss')  return PROGRAM_TEMPLATES.find(t => t.id === 'full_body');
    if (level === 'Intermediate') {
      if (goal === 'Strength') return PROGRAM_TEMPLATES.find(t => t.id === 'strength_531');
      if (goal === 'Muscle Gain' && days >= 5) return PROGRAM_TEMPLATES.find(t => t.id === 'ppl');
      if (goal === 'Muscle Gain') return PROGRAM_TEMPLATES.find(t => t.id === 'upper_lower');
      return PROGRAM_TEMPLATES.find(t => t.id === 'upper_lower');
    }
    if (level === 'Advanced') {
      if (goal === 'Strength') return PROGRAM_TEMPLATES.find(t => t.id === 'strength_531');
      if (goal === 'Muscle Gain') return days >= 6
        ? PROGRAM_TEMPLATES.find(t => t.id === 'bro_split')
        : PROGRAM_TEMPLATES.find(t => t.id === 'ppl');
      return PROGRAM_TEMPLATES.find(t => t.id === 'ppl');
    }
    return PROGRAM_TEMPLATES.find(t => t.id === 'full_body');
  };

  const handleGenerate = () => {
    const match = pickTemplate(genGoal, genLevel, Number(genDays));
    if (match) onSelect(match);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-program-title"
        className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-2xl md:max-w-3xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/6 flex-shrink-0">
          <p id="new-program-title" className="text-[16px] font-bold text-[#E5E7EB]">New Program</p>
          <div className="flex items-center gap-2">
            {onStartFromScratch && (
              <button
                onClick={onStartFromScratch}
                className="text-[12px] font-semibold text-[#6B7280] hover:text-[#9CA3AF] px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
              >
                Start from scratch
              </button>
            )}
            <button onClick={onClose}><X size={20} className="text-[#6B7280]" /></button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-4 flex-shrink-0">
          <button
            onClick={() => setTab('templates')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors ${
              tab === 'templates'
                ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                : 'text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/4'
            }`}
          >
            <LayoutTemplate size={13} /> Templates
          </button>
          <button
            onClick={() => setTab('generate')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors ${
              tab === 'generate'
                ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                : 'text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/4'
            }`}
          >
            <Sparkles size={13} /> Auto-generate
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ── Templates tab ── */}
          {tab === 'templates' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {PROGRAM_TEMPLATES.map(t => {
                const totalDays = t.weekPattern.length;
                return (
                  <div key={t.id} className="bg-[#111827] border border-white/6 rounded-[14px] p-4 flex flex-col gap-3">
                    <div>
                      <p className="text-[14px] font-bold text-[#E5E7EB] mb-2">{t.name}</p>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${GOAL_BADGE[t.goal] ?? 'bg-white/8 text-[#9CA3AF]'}`}>
                          {t.goal}
                        </span>
                        <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-white/8 text-[#9CA3AF]">
                          {t.level}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#4B5563]">
                        {t.daysPerWeek} days/week · {t.durationWeeks} weeks · {totalDays * t.durationWeeks} days total
                      </p>
                    </div>
                    <p className="text-[12px] text-[#6B7280] leading-relaxed flex-1">{t.description}</p>
                    <button
                      onClick={() => onSelect(t)}
                      className="w-full py-2 rounded-xl text-[13px] font-bold text-black bg-[#D4AF37] hover:bg-[#C4A030] transition-colors"
                    >
                      Use Template
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Auto-generate tab ── */}
          {tab === 'generate' && (
            <div className="max-w-sm mx-auto space-y-5 pt-2">
              <p className="text-[13px] text-[#6B7280]">
                Tell us your goal and we'll pick the best matching template to pre-fill a new program.
              </p>

              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Goal</label>
                <select
                  value={genGoal}
                  onChange={e => setGenGoal(e.target.value)}
                  className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
                >
                  <option>Muscle Gain</option>
                  <option>Strength</option>
                  <option>Fat Loss</option>
                  <option>General Fitness</option>
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Experience Level</label>
                <select
                  value={genLevel}
                  onChange={e => setGenLevel(e.target.value)}
                  className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
                >
                  <option>Beginner</option>
                  <option>Intermediate</option>
                  <option>Advanced</option>
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Days Per Week</label>
                <select
                  value={genDays}
                  onChange={e => setGenDays(Number(e.target.value))}
                  className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
                >
                  <option value={3}>3 days</option>
                  <option value={4}>4 days</option>
                  <option value={5}>5 days</option>
                  <option value={6}>6 days</option>
                </select>
              </div>

              {/* Preview matched template */}
              {(() => {
                const match = pickTemplate(genGoal, genLevel, genDays);
                return match ? (
                  <div className="bg-[#111827] border border-white/6 rounded-xl p-3.5">
                    <p className="text-[11px] font-bold text-[#4B5563] uppercase tracking-widest mb-2">Best match</p>
                    <p className="text-[13px] font-semibold text-[#E5E7EB] mb-1">{match.name}</p>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${GOAL_BADGE[match.goal] ?? 'bg-white/8 text-[#9CA3AF]'}`}>
                        {match.goal}
                      </span>
                      <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-white/8 text-[#9CA3AF]">
                        {match.level}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#4B5563]">
                      {match.daysPerWeek} days/week · {match.durationWeeks} weeks
                    </p>
                  </div>
                ) : null;
              })()}

              <button
                onClick={handleGenerate}
                className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] hover:bg-[#C4A030] transition-colors"
              >
                Generate Program
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Create / Edit program modal ───────────────────────────
const ProgramModal = ({ program, initialData, onClose, onSaved, gymId, adminId }) => {
  const isEdit = !!program;
  const init = program || initialData || {};
  const [name, setName]           = useState(init.name ?? '');
  const [description, setDesc]    = useState(init.description ?? '');
  const [durationWeeks, setDuration] = useState(init.duration_weeks ?? 8);
  const [weeks, setWeeks]         = useState(() => normalizeWeeks(init.weeks));
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
                                  <div key={ei} className="flex items-center gap-2 md:gap-3 py-1.5 border-b border-white/4 last:border-0">
                                    <span className="text-[12px] text-[#9CA3AF] flex-1 min-w-0 truncate md:min-w-[200px]">{exName(ex.id)}</span>
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
  const [showTemplates, setShowTemplates] = useState(false);
  const [prefillProgram, setPrefillProgram] = useState(null);
  const [enrollmentCounts, setEnrollmentCounts] = useState({});
  const [enrolledMembers, setEnrolledMembers] = useState({}); // programId → [{name}]
  const [expandedEnroll, setExpandedEnroll] = useState(null);
  const [programStats, setProgramStats] = useState({ totalPrograms: 0, activeEnrollments: 0, completionRate: 0, topProgram: '—' });

  const load = async () => {
    if (!profile?.gym_id) return;
    const { data } = await supabase
      .from('gym_programs')
      .select('*')
      .eq('gym_id', profile.gym_id)
      .order('created_at', { ascending: false });
    setPrograms(data || []);
    setLoading(false);

    // Load enrollment counts
    const { data: enrolls } = await supabase
      .from('gym_program_enrollments')
      .select('program_id, completed_at')
      .eq('gym_id', profile.gym_id);
    const counts = {};
    (enrolls || []).forEach(r => { counts[r.program_id] = (counts[r.program_id] || 0) + 1; });
    setEnrollmentCounts(counts);

    // Compute program analytics
    const allPrograms = data || [];
    const allEnrolls = enrolls || [];
    const publishedCount = allPrograms.filter(p => p.is_published).length;
    const activeCount = allEnrolls.filter(e => !e.completed_at).length;
    const completedCount = allEnrolls.filter(e => e.completed_at).length;
    const compRate = allEnrolls.length > 0 ? Math.round((completedCount / allEnrolls.length) * 100) : 0;

    // Most popular program
    let topName = '—';
    if (Object.keys(counts).length > 0) {
      const topId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      const topProg = allPrograms.find(p => p.id === topId);
      topName = topProg?.name || '—';
    }

    setProgramStats({ totalPrograms: publishedCount, activeEnrollments: activeCount, completionRate: compRate, topProgram: topName });
  };

  const loadEnrolledMembers = async (programId) => {
    if (enrolledMembers[programId]) return; // already fetched
    const { data } = await supabase
      .from('gym_program_enrollments')
      .select('profile_id, enrolled_at, profiles(full_name)')
      .eq('program_id', programId)
      .eq('gym_id', profile.gym_id)
      .order('enrolled_at', { ascending: true });
    setEnrolledMembers(prev => ({ ...prev, [programId]: data || [] }));
  };

  const toggleEnroll = (programId) => {
    if (expandedEnroll === programId) {
      setExpandedEnroll(null);
    } else {
      setExpandedEnroll(programId);
      loadEnrolledMembers(programId);
    }
  };

  useEffect(() => { load(); }, [profile?.gym_id]);

  const handleDelete = async (id) => {
    if (!confirm('Delete this program?')) return;
    await supabase.from('gym_programs').delete().eq('id', id);
    load();
  };

  const handleTemplateSelect = (template) => {
    const builtWeeks = buildWeeksFromPattern(template.weekPattern, template.durationWeeks);
    setPrefillProgram({
      name: template.name,
      description: template.description,
      duration_weeks: template.durationWeeks,
      weeks: builtWeeks,
    });
    setShowTemplates(false);
  };

  return (
    <div className="px-4 md:px-8 py-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">Programs</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">Gym-branded workout programs for members</p>
        </div>
        <button onClick={() => { setPrefillProgram(null); setShowTemplates(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#D4AF37] text-black font-bold text-[13px] rounded-xl hover:bg-[#C4A030] transition-colors">
          <Plus size={15} /> New Program
        </button>
      </div>

      {/* Program Analytics Summary */}
      {!loading && programs.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4">
            <p className="text-[22px] font-bold text-[#E5E7EB]">{programStats.totalPrograms}</p>
            <p className="text-[12px] text-[#9CA3AF]">Published Programs</p>
          </div>
          <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4">
            <p className="text-[22px] font-bold text-[#E5E7EB]">{programStats.activeEnrollments}</p>
            <p className="text-[12px] text-[#9CA3AF]">Active Enrollments</p>
          </div>
          <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4">
            <p className="text-[22px] font-bold text-[#E5E7EB]">{programStats.completionRate}%</p>
            <p className="text-[12px] text-[#9CA3AF]">Completion Rate</p>
          </div>
          <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4">
            <p className="text-[22px] font-bold text-[#E5E7EB] truncate text-[16px]">{programStats.topProgram}</p>
            <p className="text-[12px] text-[#9CA3AF]">Most Popular</p>
          </div>
        </div>
      )}

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
              <div key={p.id} className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden hover:border-white/20 hover:bg-white/[0.03] transition-all">
                <div className="p-4">
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

                  {/* Enrollment toggle */}
                  <button
                    onClick={() => toggleEnroll(p.id)}
                    className="ml-12 mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
                  >
                    <Users size={11} />
                    <span>{enrollmentCounts[p.id] ?? 0} enrolled</span>
                    <ChevronDown size={11} className={`transition-transform ${expandedEnroll === p.id ? 'rotate-180' : ''}`} />
                  </button>
                </div>

                {/* Enrolled members panel */}
                {expandedEnroll === p.id && (
                  <div className="px-4 pb-4 border-t border-white/4 pt-3">
                    <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide mb-2">Enrolled Members</p>
                    {!enrolledMembers[p.id] ? (
                      <div className="flex justify-center py-3">
                        <div className="w-4 h-4 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
                      </div>
                    ) : enrolledMembers[p.id].length === 0 ? (
                      <p className="text-[12px] text-[#6B7280] text-center py-2">No members enrolled yet</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {enrolledMembers[p.id].map(e => {
                          const name = e.profiles?.full_name ?? '?';
                          const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                          return (
                            <div key={e.profile_id} className="flex items-center gap-1.5 bg-[#111827] rounded-xl px-2.5 py-1.5">
                              <div className="w-6 h-6 rounded-full bg-[#D4AF37]/20 flex items-center justify-center flex-shrink-0">
                                <span className="text-[9px] font-bold text-[#D4AF37]">{initials}</span>
                              </div>
                              <span className="text-[11px] font-medium text-[#E5E7EB]">{name}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showTemplates && (
        <TemplatesModal
          onClose={() => setShowTemplates(false)}
          onSelect={handleTemplateSelect}
          onStartFromScratch={() => { setShowTemplates(false); setShowCreate(true); }}
        />
      )}
      {(showCreate || prefillProgram) && !editing && (
        <ProgramModal
          initialData={prefillProgram}
          onClose={() => { setShowCreate(false); setPrefillProgram(null); }}
          onSaved={load}
          gymId={profile.gym_id}
          adminId={user.id}
        />
      )}
      {editing && (
        <ProgramModal program={editing} onClose={() => setEditing(null)} onSaved={load} gymId={profile.gym_id} adminId={user.id} />
      )}
    </div>
  );
}
