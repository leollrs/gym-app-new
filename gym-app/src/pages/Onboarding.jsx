import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronLeft, Check, Dumbbell } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ── DATA ───────────────────────────────────────────────────
const FITNESS_LEVELS = [
  {
    value: 'beginner',
    label: 'Just getting started',
    desc: 'Less than a year of regular training, or getting back after a long break',
    badge: 'Beginner',
    icon: '🌱',
  },
  {
    value: 'intermediate',
    label: 'I train consistently',
    desc: '1–3 years of regular training, comfortable with the basics',
    badge: 'Intermediate',
    icon: '⚡',
  },
  {
    value: 'advanced',
    label: 'I know what I\'m doing',
    desc: '3+ years of structured training, comfortable with complex lifts',
    badge: 'Advanced',
    icon: '🏆',
  },
];

const GOALS = [
  { value: 'muscle_gain',     label: 'Build Muscle',    desc: 'Get bigger and more defined',         icon: '💪' },
  { value: 'fat_loss',        label: 'Lose Fat',         desc: 'Burn fat while keeping your muscle',  icon: '🔥' },
  { value: 'strength',        label: 'Get Stronger',     desc: 'Lift heavier, hit new personal bests', icon: '🏋️' },
  { value: 'endurance',       label: 'Build Endurance',  desc: 'Improve cardio and stamina',           icon: '🏃' },
  { value: 'general_fitness', label: 'Stay in Shape',    desc: 'Stay active, healthy and consistent',  icon: '✨' },
];

const FREQUENCIES = [1, 2, 3, 4, 5, 6, 7];

const EQUIPMENT_OPTIONS = [
  { value: 'Barbell',         label: 'Barbell' },
  { value: 'Dumbbell',        label: 'Dumbbells' },
  { value: 'Cable',           label: 'Cables' },
  { value: 'Machine',         label: 'Machines' },
  { value: 'Bodyweight',      label: 'Bodyweight' },
  { value: 'Kettlebell',      label: 'Kettlebells' },
  { value: 'Resistance Band', label: 'Resistance Bands' },
  { value: 'Smith Machine',   label: 'Smith Machine' },
];

const INJURY_OPTIONS = [
  { value: 'lower_back',  label: 'Lower Back' },
  { value: 'knees',       label: 'Knees' },
  { value: 'shoulders',   label: 'Shoulders' },
  { value: 'wrists',      label: 'Wrists' },
  { value: 'elbows',      label: 'Elbows' },
  { value: 'hips',        label: 'Hips' },
  { value: 'neck',        label: 'Neck' },
  { value: 'ankles',      label: 'Ankles' },
];

const TOTAL_STEPS = 4;

// ── STEP INDICATOR ─────────────────────────────────────────
const StepDots = ({ current }) => (
  <div className="flex items-center gap-2 justify-center mb-8">
    {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
      <div
        key={i}
        className={`rounded-full transition-all duration-300 ${
          i < current
            ? 'w-5 h-2 bg-[#D4AF37]'
            : i === current
            ? 'w-8 h-2 bg-[#D4AF37]'
            : 'w-2 h-2 bg-white/15'
        }`}
      />
    ))}
  </div>
);

// ── OPTION CARD ────────────────────────────────────────────
const OptionCard = ({ selected, onClick, icon, label, desc, badge }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full text-left flex items-center gap-4 px-5 py-4 rounded-[14px] border transition-all ${
      selected
        ? 'bg-[#D4AF37]/12 border-[#D4AF37]/50 shadow-[0_0_0_1px_rgba(212,175,55,0.3)]'
        : 'bg-[#0F172A] border-white/6 hover:border-white/14'
    }`}
  >
    <span className="text-2xl flex-shrink-0">{icon}</span>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className={`font-semibold text-[15px] ${selected ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>{label}</p>
        {badge && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            selected ? 'bg-[#D4AF37]/20 text-[#D4AF37]' : 'bg-white/6 text-[#6B7280]'
          }`}>{badge}</span>
        )}
      </div>
      {desc && <p className="text-[12px] text-[#6B7280] mt-0.5">{desc}</p>}
    </div>
    {selected && <Check size={16} className="text-[#D4AF37] flex-shrink-0" />}
  </button>
);

// ── CONTEXT HINT ───────────────────────────────────────────
const Hint = ({ children }) => (
  <div className="bg-[#D4AF37]/6 border border-[#D4AF37]/15 rounded-xl px-4 py-3 mb-5">
    <p className="text-[12px] text-[#9CA3AF] leading-relaxed">{children}</p>
  </div>
);

// ── MAIN COMPONENT ─────────────────────────────────────────
const Onboarding = () => {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [step, setStep]     = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const [data, setData] = useState({
    fitness_level:          null,
    primary_goal:           null,
    training_days_per_week: 4,
    available_equipment:    ['Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight'],
    initial_weight_lbs:     '',
    injury_areas:           [],   // array of injury_option values
  });

  const set = (field, value) => setData(d => ({ ...d, [field]: value }));

  const toggleEquipment = (val) =>
    setData(d => ({
      ...d,
      available_equipment: d.available_equipment.includes(val)
        ? d.available_equipment.filter(e => e !== val)
        : [...d.available_equipment, val],
    }));

  const toggleInjury = (val) =>
    setData(d => ({
      ...d,
      injury_areas: d.injury_areas.includes(val)
        ? d.injury_areas.filter(e => e !== val)
        : [...d.injury_areas, val],
    }));

  const canAdvance = () => {
    if (step === 0) return !!data.fitness_level;
    if (step === 1) return !!data.primary_goal;
    if (step === 2) return data.available_equipment.length > 0;
    return true;
  };

  const handleFinish = async () => {
    setError('');
    setSaving(true);
    try {
      const { data: profileRow } = await supabase
        .from('profiles').select('gym_id').eq('id', user.id).single();
      const gymId = profileRow.gym_id;

      const injuriesNotes = data.injury_areas.length > 0
        ? data.injury_areas.join(', ')
        : null;

      const { error: onboardingErr } = await supabase
        .from('member_onboarding')
        .upsert({
          profile_id:             user.id,
          gym_id:                 gymId,
          fitness_level:          data.fitness_level,
          primary_goal:           data.primary_goal,
          training_days_per_week: data.training_days_per_week,
          available_equipment:    data.available_equipment,
          injuries_notes:         injuriesNotes,
          initial_weight_lbs:     data.initial_weight_lbs ? parseFloat(data.initial_weight_lbs) : null,
          completed_at:           new Date().toISOString(),
        });

      if (onboardingErr) throw onboardingErr;

      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ is_onboarded: true })
        .eq('id', user.id);

      if (profileErr) throw profileErr;

      if (data.initial_weight_lbs) {
        await supabase.from('body_weight_logs').insert({
          profile_id: user.id,
          gym_id:     gymId,
          weight_lbs: parseFloat(data.initial_weight_lbs),
          notes:      'Initial weight at signup',
        });
      }

      refreshProfile();
      navigate('/');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#05070B] px-5 py-10 flex flex-col items-center">
      <div className="w-full max-w-[460px]">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#D4AF37]/15 border border-[#D4AF37]/25 mb-4">
            <Dumbbell size={22} className="text-[#D4AF37]" strokeWidth={2} />
          </div>
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">Let's set you up</h1>
          <p className="text-[13px] text-[#6B7280] mt-1">
            A few quick questions so we can build your perfect plan
          </p>
        </div>

        <StepDots current={step} />

        {/* ── STEP 0: FITNESS LEVEL ── */}
        {step === 0 && (
          <div className="animate-fade-in">
            <h2 className="text-[18px] font-bold text-[#E5E7EB] mb-1">How experienced are you?</h2>
            <p className="text-[13px] text-[#6B7280] mb-4">Pick the one that sounds most like you.</p>
            <Hint>
              This sets how fast we push your weights up and how technical the exercises get. Honest is better — starting too heavy causes injury, starting too light just means faster progression.
            </Hint>
            <div className="flex flex-col gap-3">
              {FITNESS_LEVELS.map(l => (
                <OptionCard
                  key={l.value}
                  selected={data.fitness_level === l.value}
                  onClick={() => set('fitness_level', l.value)}
                  icon={l.icon}
                  label={l.label}
                  desc={l.desc}
                  badge={l.badge}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 1: GOAL ── */}
        {step === 1 && (
          <div className="animate-fade-in">
            <h2 className="text-[18px] font-bold text-[#E5E7EB] mb-1">What's your main goal?</h2>
            <p className="text-[13px] text-[#6B7280] mb-4">This shapes your rep ranges and progression style.</p>
            <Hint>
              Your goal changes how we program your sets and reps. For example, strength training uses lower reps with heavier weight, while muscle building uses moderate weight with more volume. You can always change this later.
            </Hint>
            <div className="flex flex-col gap-3">
              {GOALS.map(g => (
                <OptionCard
                  key={g.value}
                  selected={data.primary_goal === g.value}
                  onClick={() => set('primary_goal', g.value)}
                  icon={g.icon}
                  label={g.label}
                  desc={g.desc}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 2: FREQUENCY + EQUIPMENT ── */}
        {step === 2 && (
          <div className="animate-fade-in">
            <h2 className="text-[18px] font-bold text-[#E5E7EB] mb-1">Training setup</h2>
            <p className="text-[13px] text-[#6B7280] mb-5">How often do you train, and what equipment do you have?</p>

            {/* Days per week */}
            <div className="mb-7">
              <p className="text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
                Days per week
              </p>
              <p className="text-[12px] text-[#4B5563] mb-3">How many days can you realistically commit to?</p>
              <div className="flex gap-2">
                {FREQUENCIES.map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => set('training_days_per_week', n)}
                    className={`flex-1 py-3 rounded-xl text-[15px] font-bold transition-all ${
                      data.training_days_per_week === n
                        ? 'bg-[#D4AF37] text-black'
                        : 'bg-[#0F172A] border border-white/6 text-[#9CA3AF] hover:border-white/14'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[#4B5563] mt-2 text-center">
                {data.training_days_per_week <= 2 && 'Full body sessions work best'}
                {data.training_days_per_week === 3 && 'Great for push/pull/legs or upper/lower splits'}
                {data.training_days_per_week === 4 && 'Upper/lower split works great here'}
                {data.training_days_per_week === 5 && 'Push/pull/legs + 2 extra days'}
                {data.training_days_per_week >= 6 && 'High frequency — make sure you\'re recovering well'}
              </p>
            </div>

            {/* Equipment */}
            <div>
              <p className="text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
                Available equipment
              </p>
              <p className="text-[12px] text-[#4B5563] mb-3">Select everything you have access to at your gym.</p>
              <div className="flex flex-wrap gap-2">
                {EQUIPMENT_OPTIONS.map(eq => {
                  const active = data.available_equipment.includes(eq.value);
                  return (
                    <button
                      key={eq.value}
                      type="button"
                      onClick={() => toggleEquipment(eq.value)}
                      className={`text-[13px] font-semibold px-3.5 py-2 rounded-full border transition-all ${
                        active
                          ? 'bg-[#D4AF37]/15 border-[#D4AF37]/40 text-[#D4AF37]'
                          : 'bg-[#0F172A] border-white/8 text-[#6B7280] hover:border-white/16 hover:text-[#9CA3AF]'
                      }`}
                    >
                      {eq.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 3: BODY STATS + INJURIES ── */}
        {step === 3 && (
          <div className="animate-fade-in">
            <h2 className="text-[18px] font-bold text-[#E5E7EB] mb-1">
              Almost done <span className="text-[#4B5563] font-normal text-[15px]">(optional)</span>
            </h2>
            <p className="text-[13px] text-[#6B7280] mb-5">Skip anything you don't want to fill in — you can always add it later.</p>

            {/* Weight */}
            <div className="mb-6">
              <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
                Current Weight (lbs)
              </label>
              <p className="text-[12px] text-[#4B5563] mb-2">Used to track your progress over time.</p>
              <input
                type="number"
                step="0.1"
                min="50"
                max="700"
                placeholder="e.g. 175"
                value={data.initial_weight_lbs}
                onChange={e => set('initial_weight_lbs', e.target.value)}
                className="w-full bg-[#0B1220] border border-white/8 rounded-xl px-4 py-3 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
              />
            </div>

            {/* Injuries */}
            <div className="mb-5">
              <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
                Any pain or limitations?
              </label>
              <p className="text-[12px] text-[#4B5563] mb-3">
                We'll avoid exercises that stress these areas and suggest safer alternatives.
              </p>
              <div className="flex flex-wrap gap-2 mb-2">
                {INJURY_OPTIONS.map(inj => {
                  const active = data.injury_areas.includes(inj.value);
                  return (
                    <button
                      key={inj.value}
                      type="button"
                      onClick={() => toggleInjury(inj.value)}
                      className={`text-[13px] font-semibold px-3.5 py-2 rounded-full border transition-all ${
                        active
                          ? 'bg-red-500/15 border-red-500/40 text-red-400'
                          : 'bg-[#0F172A] border-white/8 text-[#6B7280] hover:border-white/16 hover:text-[#9CA3AF]'
                      }`}
                    >
                      {inj.label}
                    </button>
                  );
                })}
              </div>
              {data.injury_areas.length === 0 && (
                <p className="text-[11px] text-[#4B5563]">Nothing selected — all exercises available.</p>
              )}
              {data.injury_areas.length > 0 && (
                <p className="text-[11px] text-[#9CA3AF]">
                  {data.injury_areas.length} area{data.injury_areas.length > 1 ? 's' : ''} flagged — we'll work around these.
                </p>
              )}
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4">
                <p className="text-[13px] text-red-400">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* ── NAV BUTTONS ── */}
        <div className="flex gap-3 mt-8">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(s => s - 1)}
              className="flex items-center gap-1.5 px-5 py-3.5 rounded-xl border border-white/10 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/20 transition-all text-[14px] font-semibold"
            >
              <ChevronLeft size={17} /> Back
            </button>
          )}

          {step < TOTAL_STEPS - 1 ? (
            <button
              type="button"
              onClick={() => setStep(s => s + 1)}
              disabled={!canAdvance()}
              className="flex-1 flex items-center justify-center gap-1.5 bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-30 disabled:cursor-not-allowed text-black font-bold text-[15px] py-3.5 rounded-xl transition-all"
            >
              Continue <ChevronRight size={17} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold text-[15px] py-3.5 rounded-xl transition-all"
            >
              {saving ? 'Saving…' : (
                <><Check size={17} strokeWidth={2.5} /> Let's go!</>
              )}
            </button>
          )}
        </div>

        {/* Skip on last step */}
        {step === 3 && (
          <button
            type="button"
            onClick={handleFinish}
            disabled={saving}
            className="w-full text-center text-[12px] text-[#4B5563] hover:text-[#6B7280] mt-3 py-2 transition-colors"
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
};

export default Onboarding;
