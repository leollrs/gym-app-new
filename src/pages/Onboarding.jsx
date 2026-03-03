import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronLeft, Check, Dumbbell } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ── DATA ───────────────────────────────────────────────────
const FITNESS_LEVELS = [
  {
    value: 'beginner',
    label: 'Beginner',
    desc: 'Less than 1 year of consistent training',
    icon: '🌱',
  },
  {
    value: 'intermediate',
    label: 'Intermediate',
    desc: '1–3 years of consistent training',
    icon: '⚡',
  },
  {
    value: 'advanced',
    label: 'Advanced',
    desc: '3+ years, comfortable with complex movements',
    icon: '🏆',
  },
];

const GOALS = [
  { value: 'muscle_gain',      label: 'Build Muscle',     desc: 'Maximize hypertrophy and size',       icon: '💪' },
  { value: 'fat_loss',         label: 'Lose Fat',          desc: 'Burn fat while preserving muscle',    icon: '🔥' },
  { value: 'strength',         label: 'Get Stronger',      desc: 'Increase 1RMs and raw strength',      icon: '🏋️' },
  { value: 'endurance',        label: 'Build Endurance',   desc: 'Improve stamina and conditioning',    icon: '🏃' },
  { value: 'general_fitness',  label: 'General Fitness',   desc: 'Stay active, healthy and consistent', icon: '✨' },
];

const FREQUENCIES = [1, 2, 3, 4, 5, 6, 7];

const EQUIPMENT_OPTIONS = [
  { value: 'Barbell',          label: 'Barbell' },
  { value: 'Dumbbell',         label: 'Dumbbells' },
  { value: 'Cable',            label: 'Cables' },
  { value: 'Machine',          label: 'Machines' },
  { value: 'Bodyweight',       label: 'Bodyweight' },
  { value: 'Kettlebell',       label: 'Kettlebells' },
  { value: 'Resistance Band',  label: 'Resistance Bands' },
  { value: 'Smith Machine',    label: 'Smith Machine' },
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
const OptionCard = ({ selected, onClick, icon, label, desc }) => (
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
      <p className={`font-semibold text-[15px] ${selected ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>{label}</p>
      {desc && <p className="text-[12px] text-[#6B7280] mt-0.5">{desc}</p>}
    </div>
    {selected && <Check size={16} className="text-[#D4AF37] flex-shrink-0" />}
  </button>
);

// ── MAIN COMPONENT ─────────────────────────────────────────
const Onboarding = () => {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [data, setData] = useState({
    fitness_level:          null,
    primary_goal:           null,
    training_days_per_week: 4,
    available_equipment:    ['Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight'],
    initial_weight_lbs:     '',
    injuries_notes:         '',
  });

  const set = (field, value) => setData(d => ({ ...d, [field]: value }));

  const toggleEquipment = (val) => {
    setData(d => ({
      ...d,
      available_equipment: d.available_equipment.includes(val)
        ? d.available_equipment.filter(e => e !== val)
        : [...d.available_equipment, val],
    }));
  };

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
      // Upsert onboarding data
      const { error: onboardingErr } = await supabase
        .from('member_onboarding')
        .upsert({
          profile_id:             user.id,
          gym_id:                 (await supabase.from('profiles').select('gym_id').eq('id', user.id).single()).data.gym_id,
          fitness_level:          data.fitness_level,
          primary_goal:           data.primary_goal,
          training_days_per_week: data.training_days_per_week,
          available_equipment:    data.available_equipment,
          injuries_notes:         data.injuries_notes || null,
          initial_weight_lbs:     data.initial_weight_lbs ? parseFloat(data.initial_weight_lbs) : null,
          completed_at:           new Date().toISOString(),
        });

      if (onboardingErr) throw onboardingErr;

      // Mark profile as onboarded
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ is_onboarded: true })
        .eq('id', user.id);

      if (profileErr) throw profileErr;

      // Log initial weight if provided
      if (data.initial_weight_lbs) {
        const gymId = (await supabase.from('profiles').select('gym_id').eq('id', user.id).single()).data.gym_id;
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
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">Set up your profile</h1>
          <p className="text-[13px] text-[#6B7280] mt-1">
            This helps us build your perfect program
          </p>
        </div>

        <StepDots current={step} />

        {/* ── STEP 0: FITNESS LEVEL ── */}
        {step === 0 && (
          <div className="animate-fade-in">
            <h2 className="text-[18px] font-bold text-[#E5E7EB] mb-1">What's your experience level?</h2>
            <p className="text-[13px] text-[#6B7280] mb-6">Be honest — this shapes your progressive overload plan.</p>
            <div className="flex flex-col gap-3">
              {FITNESS_LEVELS.map(l => (
                <OptionCard
                  key={l.value}
                  selected={data.fitness_level === l.value}
                  onClick={() => set('fitness_level', l.value)}
                  icon={l.icon}
                  label={l.label}
                  desc={l.desc}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 1: GOAL ── */}
        {step === 1 && (
          <div className="animate-fade-in">
            <h2 className="text-[18px] font-bold text-[#E5E7EB] mb-1">What's your primary goal?</h2>
            <p className="text-[13px] text-[#6B7280] mb-6">We'll optimize your workouts and progression around this.</p>
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
            <h2 className="text-[18px] font-bold text-[#E5E7EB] mb-1">Training schedule</h2>
            <p className="text-[13px] text-[#6B7280] mb-6">How often can you train, and what do you have access to?</p>

            {/* Days per week */}
            <div className="mb-7">
              <p className="text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-3">
                Days per week
              </p>
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
            </div>

            {/* Equipment */}
            <div>
              <p className="text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-3">
                Available equipment
              </p>
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

        {/* ── STEP 3: BODY STATS (OPTIONAL) ── */}
        {step === 3 && (
          <div className="animate-fade-in">
            <h2 className="text-[18px] font-bold text-[#E5E7EB] mb-1">Body stats <span className="text-[#4B5563] font-normal text-[15px]">(optional)</span></h2>
            <p className="text-[13px] text-[#6B7280] mb-6">Used to track your progress and set accurate goals. You can skip this.</p>

            {/* Weight */}
            <div className="mb-5">
              <label className="block text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                Current Weight (lbs)
              </label>
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
              <label className="block text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                Injuries or Limitations <span className="text-[#4B5563] font-normal normal-case tracking-normal">(optional)</span>
              </label>
              <textarea
                rows={3}
                placeholder="e.g. bad left knee, avoid overhead pressing"
                value={data.injuries_notes}
                onChange={e => set('injuries_notes', e.target.value)}
                className="w-full bg-[#0B1220] border border-white/8 rounded-xl px-4 py-3 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/40 transition-colors resize-none"
              />
              <p className="text-[11px] text-[#4B5563] mt-1.5">
                We'll substitute or skip exercises that affect these areas.
              </p>
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

        {/* Skip on optional step */}
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
