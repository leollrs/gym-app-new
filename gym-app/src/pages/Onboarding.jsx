import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronLeft, Check, Dumbbell, Sprout, Zap, Trophy, Flame, Activity, Sparkles, Sunrise, Sun, Moon, Heart, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Capacitor } from '@capacitor/core';
import { isAvailable as healthAvailable, requestPermissions as healthRequest } from '../lib/healthSync';

// ── DATA ───────────────────────────────────────────────────
// values are stored in DB; labels come from translation files
const FITNESS_LEVELS = [
  { value: 'beginner',     key: 'beginner',     icon: Sprout },
  { value: 'intermediate', key: 'intermediate', icon: Zap },
  { value: 'advanced',     key: 'advanced',     icon: Trophy },
];

const GOALS = [
  { value: 'muscle_gain',     key: 'muscle_gain',     icon: Dumbbell },
  { value: 'fat_loss',        key: 'fat_loss',        icon: Flame },
  { value: 'strength',        key: 'strength',        icon: Dumbbell },
  { value: 'endurance',       key: 'endurance',       icon: Activity },
  { value: 'general_fitness', key: 'general_fitness', icon: Sparkles },
];

const FREQUENCIES = [1, 2, 3, 4, 5, 6, 7];

const EQUIPMENT_OPTIONS = [
  { value: 'Barbell',         key: 'barbell' },
  { value: 'Dumbbell',        key: 'dumbbells' },
  { value: 'Cable',           key: 'cables' },
  { value: 'Machine',         key: 'machines' },
  { value: 'Bodyweight',      key: 'bodyweight' },
  { value: 'Kettlebell',      key: 'kettlebells' },
  { value: 'Resistance Band', key: 'resistanceBands' },
  { value: 'Smith Machine',   key: 'smithMachine' },
];

const INJURY_OPTIONS = [
  { value: 'lower_back',  key: 'lowerBack' },
  { value: 'knees',       key: 'knees' },
  { value: 'shoulders',   key: 'shoulders' },
  { value: 'wrists',      key: 'wrists' },
  { value: 'elbows',      key: 'elbows' },
  { value: 'hips',        key: 'hips' },
  { value: 'neck',        key: 'neck' },
  { value: 'ankles',      key: 'ankles' },
];

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const SHORT_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const TIME_PREFERENCES = [
  { value: 'morning',   key: 'morning',   subKey: 'morningSub',   icon: Sunrise },
  { value: 'afternoon', key: 'afternoon', subKey: 'afternoonSub', icon: Sun },
  { value: 'evening',   key: 'evening',   subKey: 'eveningSub',   icon: Moon },
];

// Returns a pre-selected set of day keys (english full names for DB storage) based on training frequency
function getDefaultDays(freq) {
  const allDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  if (freq <= 1) return ['Monday'];
  if (freq === 2) return ['Monday', 'Thursday'];
  if (freq === 3) return ['Monday', 'Wednesday', 'Friday'];
  if (freq === 4) return ['Monday', 'Wednesday', 'Friday', 'Sunday'];
  if (freq === 5) return ['Monday', 'Tuesday', 'Thursday', 'Friday', 'Saturday'];
  if (freq === 6) return allDays.filter(d => d !== 'Sunday');
  return allDays;
}

// Map English day names to index for display
const DAY_NAME_TO_INDEX = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6 };

const TOTAL_STEPS = 9; // invite code step 0, language step 1, health step 7

// ── STEP INDICATOR ─────────────────────────────────────────
const STEP_LABELS = ['Invite', 'Language', 'Level', 'Goals', 'Schedule', 'Equipment', 'Injuries', 'Health', 'Metrics'];

const StepIndicator = ({ current }) => (
  <div className="flex items-center justify-between mb-8 px-2">
    {STEP_LABELS.map((label, i) => (
      <div key={i} className="flex flex-col items-center gap-1.5">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold transition-all duration-300 ${
          i < current ? 'bg-[#D4AF37] text-black' :
          i === current ? 'bg-[#D4AF37]/20 text-[#D4AF37] ring-2 ring-[#D4AF37]' :
          'bg-white/[0.04] text-[#4B5563]'
        }`}>
          {i < current ? <Check size={14} /> : i + 1}
        </div>
        <span className={`text-[9px] font-medium tracking-wide ${
          i <= current ? 'text-[#D4AF37]' : 'text-[#4B5563]'
        }`}>{label}</span>
      </div>
    ))}
  </div>
);

// ── OPTION CARD ────────────────────────────────────────────
const OptionCard = ({ selected, onClick, icon: Icon, label, desc, badge }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full text-left flex items-center gap-4 px-5 py-4 rounded-2xl border transition-all ${
      selected
        ? 'bg-[#D4AF37]/12 border-[#D4AF37]/50 shadow-[0_0_0_1px_rgba(212,175,55,0.3)]'
        : 'bg-[#0F172A] border-white/[0.06] hover:border-white/14'
    }`}
  >
    <span className="flex-shrink-0">
      <Icon size={20} className={selected ? 'text-[#D4AF37]' : 'text-[#9CA3AF]'} />
    </span>
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
  const { t, i18n } = useTranslation(['onboarding', 'common']);

  const [step, setStep]     = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  // Invite code state
  const [inviteCode, setInviteCode] = useState('');
  const [inviteStatus, setInviteStatus] = useState('idle'); // idle | verifying | success | error
  const [inviteError, setInviteError] = useState('');

  const [data, setData] = useState({
    language:                   i18n.language || 'en',
    fitness_level:              null,
    primary_goal:               null,
    training_days_per_week:     4,
    available_equipment:        ['Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight'],
    sex:                        null,
    age:                        '',
    height_feet:                '',
    height_inches:              '',
    initial_weight_lbs:         '',
    injury_areas:               [],
    preferred_training_days:    getDefaultDays(4),
    preferred_training_time:    null,
    has_workout_buddy:          null,
    workout_buddy_username:     '',
    health_linked:              false,
    known_maxes:                { ex_bp: '', ex_sq: '', ex_dl: '', ex_ohp: '' },
  });

  const set = (field, value) => setData(d => ({ ...d, [field]: value }));
  const setMax = (exerciseId, value) =>
    setData(d => ({ ...d, known_maxes: { ...d.known_maxes, [exerciseId]: value } }));

  const selectLanguage = (lang) => {
    set('language', lang);
    i18n.changeLanguage(lang);
  };

  const handleInviteCodeChange = (val) => {
    // Strip dashes and spaces, uppercase
    setInviteCode(val.replace(/[-\s]/g, '').toUpperCase());
    // Reset error when user types
    if (inviteStatus === 'error') {
      setInviteStatus('idle');
      setInviteError('');
    }
  };

  const handleVerifyInviteCode = async () => {
    if (!inviteCode.trim()) return;
    setInviteStatus('verifying');
    setInviteError('');
    try {
      const { data: result, error: rpcError } = await supabase.rpc('claim_invite_code', {
        p_invite_code: inviteCode.trim(),
      });
      if (rpcError) throw rpcError;
      // Check for error codes in the RPC response
      if (result?.error) {
        setInviteStatus('error');
        const code = result.error;
        const errorKeys = {
          INVALID_CODE: 'inviteCode.errors.invalidCode',
          ALREADY_USED: 'inviteCode.errors.alreadyUsed',
          EXPIRED: 'inviteCode.errors.expired',
          WRONG_GYM: 'inviteCode.errors.wrongGym',
        };
        setInviteError(t(errorKeys[code] || 'inviteCode.errors.invalidCode'));
        return;
      }
      setInviteStatus('success');
      await refreshProfile();
      // Auto-advance after 1.5s
      setTimeout(() => setStep(1), 1500);
    } catch (err) {
      setInviteStatus('error');
      setInviteError(err.message || t('inviteCode.errors.invalidCode'));
    }
  };

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

  const toggleTrainingDay = (fullDay) =>
    setData(d => ({
      ...d,
      preferred_training_days: d.preferred_training_days.includes(fullDay)
        ? d.preferred_training_days.filter(day => day !== fullDay)
        : [...d.preferred_training_days, fullDay],
    }));

  // When frequency changes on step 3, also reset the pre-selected days
  const setFrequency = (n) => {
    setData(d => ({
      ...d,
      training_days_per_week:  n,
      preferred_training_days: getDefaultDays(n),
    }));
  };

  const [healthStatus, setHealthStatus] = useState('idle'); // idle | linking | linked | unavailable | error
  const platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
  const healthPlatformName = platform === 'ios' ? 'Apple Health' : platform === 'android' ? 'Health Connect' : 'Health';

  const handleLinkHealth = async () => {
    setHealthStatus('linking');
    try {
      const available = await healthAvailable();
      if (!available) {
        setHealthStatus('unavailable');
        return;
      }
      const { granted } = await healthRequest();
      if (granted) {
        setHealthStatus('linked');
        set('health_linked', true);
      } else {
        setHealthStatus('error');
      }
    } catch {
      setHealthStatus('error');
    }
  };

  const canAdvance = () => {
    if (step === 0) return true; // invite code step — always allow (skip or verify)
    if (step === 1) return !!data.language;
    if (step === 2) return !!data.fitness_level;
    if (step === 3) return !!data.primary_goal;
    if (step === 4) return data.available_equipment.length > 0;
    if (step === 5) return data.preferred_training_days.length > 0 && !!data.preferred_training_time;
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
          sex:                    data.sex || 'male',
          age:                    data.age ? parseInt(data.age) : null,
          height_inches:          data.height_feet || data.height_inches
                                    ? (parseInt(data.height_feet || 0) * 12) + parseInt(data.height_inches || 0)
                                    : null,
          initial_weight_lbs:     data.initial_weight_lbs ? parseFloat(data.initial_weight_lbs) : null,
          completed_at:           new Date().toISOString(),
        });

      if (onboardingErr) throw onboardingErr;

      const profileUpdate = {
        is_onboarded:             true,
        preferred_training_days:  data.preferred_training_days,
        preferred_training_time:  data.preferred_training_time,
        workout_buddy_username:   data.workout_buddy_username?.trim() || null,
        preferred_language:       data.language,
      };

      const { error: profileErr } = await supabase
        .from('profiles')
        .update(profileUpdate)
        .eq('id', user.id);

      if (profileErr) throw profileErr;

      if (data.initial_weight_lbs) {
        await supabase.from('body_weight_logs').insert({
          profile_id: user.id,
          gym_id:     gymId,
          weight_lbs: parseFloat(data.initial_weight_lbs),
          notes:      t('initialWeightNote'),
        });
      }

      // Save known maxes as personal records so the overload engine can suggest weights
      const maxEntries = Object.entries(data.known_maxes)
        .filter(([, val]) => val && parseFloat(val) > 0)
        .map(([exerciseId, val]) => {
          const weight = parseFloat(val);
          return {
            profile_id:    user.id,
            gym_id:        gymId,
            exercise_id:   exerciseId,
            weight_lbs:    weight,
            reps:          1,
            estimated_1rm: weight,
            achieved_at:   new Date().toISOString(),
          };
        });

      if (maxEntries.length > 0) {
        await supabase
          .from('personal_records')
          .upsert(maxEntries, { onConflict: 'profile_id,exercise_id' });
      }

      refreshProfile();
      navigate('/welcome');
    } catch (err) {
      setError(err.message || t('common:somethingWentWrong'));
    } finally {
      setSaving(false);
    }
  };

  // Helper to get translated day name abbreviation
  const dayShort = (index) => t(`common:days.${SHORT_DAY_KEYS[index]}`);
  // English full day names used as DB values
  const FULL_DAYS_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return (
    <div className="min-h-screen bg-[#05070B] px-5 py-10 flex flex-col items-center">
      <div className="w-full max-w-[460px]">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#D4AF37]/15 border border-[#D4AF37]/25 mb-4">
            <Dumbbell size={22} className="text-[#D4AF37]" strokeWidth={2} />
          </div>
          <h1 className="text-[28px] font-bold text-[#E5E7EB]">{t('title')}</h1>
          <p className="text-[13px] text-[#6B7280] mt-1">{t('subtitle')}</p>
        </div>

        <StepIndicator current={step} />

        {/* ── STEP 0: INVITE CODE ── */}
        {step === 0 && (
          <div className="animate-fade-in">
            <h2 className="text-[20px] font-semibold text-[#E5E7EB] mb-1">{t('inviteCode.title')}</h2>
            <p className="text-[13px] text-[#6B7280] mb-6">{t('inviteCode.subtitle')}</p>

            <div className="flex flex-col items-center gap-4">
              <input
                type="text"
                value={inviteCode}
                onChange={e => handleInviteCodeChange(e.target.value)}
                placeholder="e.g. ABC123"
                disabled={inviteStatus === 'verifying' || inviteStatus === 'success'}
                className="w-full bg-[#0B1220] border border-white/[0.06] rounded-xl px-4 py-4 text-center text-[20px] font-mono font-bold tracking-[0.2em] uppercase text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/40 transition-colors disabled:opacity-50"
              />

              {/* Verify button */}
              {inviteStatus !== 'success' && (
                <button
                  type="button"
                  onClick={handleVerifyInviteCode}
                  disabled={!inviteCode.trim() || inviteStatus === 'verifying'}
                  className="w-full flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-30 disabled:cursor-not-allowed text-black font-bold text-[15px] py-3.5 rounded-xl transition-all"
                >
                  {inviteStatus === 'verifying'
                    ? t('inviteCode.verifying')
                    : t('inviteCode.verify')}
                </button>
              )}

              {/* Success state */}
              {inviteStatus === 'success' && (
                <div className="w-full flex items-center justify-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl py-3.5">
                  <Check size={18} className="text-emerald-400" />
                  <span className="text-[14px] font-semibold text-emerald-400">
                    {t('inviteCode.success')}
                  </span>
                </div>
              )}

              {/* Error state */}
              {inviteStatus === 'error' && inviteError && (
                <div className="w-full bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                  <p className="text-[13px] text-red-400 text-center">{inviteError}</p>
                </div>
              )}

              {/* Skip button */}
              {inviteStatus !== 'success' && (
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="w-full text-center text-[13px] text-[#6B7280] hover:text-[#9CA3AF] py-2 transition-colors"
                >
                  {t('inviteCode.skip')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 1: LANGUAGE SELECTION ── */}
        {step === 1 && (
          <div className="animate-fade-in">
            <h2 className="text-[20px] font-semibold text-[#E5E7EB] mb-1">{t('langStep.title')}</h2>
            <p className="text-[13px] text-[#6B7280] mb-6">{t('langStep.subtitle')}</p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => selectLanguage('en')}
                className={`w-full flex items-center gap-4 px-5 py-5 rounded-2xl border transition-all ${
                  data.language === 'en'
                    ? 'bg-[#D4AF37]/12 border-[#D4AF37]/50 shadow-[0_0_0_1px_rgba(212,175,55,0.3)]'
                    : 'bg-[#0F172A] border-white/[0.06] hover:border-white/14'
                }`}
              >
                <span className="text-3xl">🇺🇸</span>
                <div className="flex-1 text-left">
                  <p className={`font-bold text-[17px] ${data.language === 'en' ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>English</p>
                </div>
                {data.language === 'en' && <Check size={18} className="text-[#D4AF37] flex-shrink-0" />}
              </button>
              <button
                type="button"
                onClick={() => selectLanguage('es')}
                className={`w-full flex items-center gap-4 px-5 py-5 rounded-2xl border transition-all ${
                  data.language === 'es'
                    ? 'bg-[#D4AF37]/12 border-[#D4AF37]/50 shadow-[0_0_0_1px_rgba(212,175,55,0.3)]'
                    : 'bg-[#0F172A] border-white/[0.06] hover:border-white/14'
                }`}
              >
                <span className="text-3xl">🇵🇷</span>
                <div className="flex-1 text-left">
                  <p className={`font-bold text-[17px] ${data.language === 'es' ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>Español</p>
                </div>
                {data.language === 'es' && <Check size={18} className="text-[#D4AF37] flex-shrink-0" />}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: FITNESS LEVEL ── */}
        {step === 2 && (
          <div className="animate-fade-in">
            <h2 className="text-[20px] font-semibold text-[#E5E7EB] mb-1">{t('fitnessLevel.title')}</h2>
            <p className="text-[13px] text-[#6B7280] mb-4">{t('fitnessLevel.subtitle')}</p>
            <Hint>{t('fitnessLevel.hint')}</Hint>
            <div className="flex flex-col gap-3">
              {FITNESS_LEVELS.map(l => (
                <OptionCard
                  key={l.value}
                  selected={data.fitness_level === l.value}
                  onClick={() => set('fitness_level', l.value)}
                  icon={l.icon}
                  label={t(`fitnessLevel.${l.key}.label`)}
                  desc={t(`fitnessLevel.${l.key}.desc`)}
                  badge={t(`fitnessLevel.${l.key}.badge`)}
                />
              ))}
            </div>

            {/* ── Known maxes for intermediate / advanced ── */}
            {(data.fitness_level === 'intermediate' || data.fitness_level === 'advanced') && (
              <div className="mt-6 animate-fade-in">
                <div className="bg-[#D4AF37]/6 border border-[#D4AF37]/15 rounded-xl px-4 py-3 mb-4">
                  <p className="text-[13px] text-[#E5E7EB] font-semibold mb-0.5">
                    {t('fitnessLevel.maxes.title')}
                  </p>
                  <p className="text-[12px] text-[#9CA3AF] leading-relaxed">
                    {t('fitnessLevel.maxes.subtitle')}
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  {[
                    { id: 'ex_bp',  label: t('fitnessLevel.maxes.bench'),    icon: '🏋️' },
                    { id: 'ex_sq',  label: t('fitnessLevel.maxes.squat'),    icon: '🦵' },
                    { id: 'ex_dl',  label: t('fitnessLevel.maxes.deadlift'), icon: '🔥' },
                    { id: 'ex_ohp', label: t('fitnessLevel.maxes.ohp'),      icon: '🙌' },
                  ].map(lift => (
                    <div key={lift.id} className="bg-[#0F172A] border border-white/[0.06] rounded-xl px-4 py-3 flex items-center gap-3">
                      <span className="text-lg flex-shrink-0">{lift.icon}</span>
                      <div className="flex-1 min-w-0">
                        <label className="block text-[13px] font-semibold text-[#E5E7EB] mb-1">{lift.label}</label>
                        <div className="relative">
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            max="1500"
                            placeholder="—"
                            value={data.known_maxes[lift.id]}
                            onChange={e => setMax(lift.id, e.target.value)}
                            className="w-full bg-[#0B1220] border border-white/[0.06] rounded-lg px-3 py-2 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/40 transition-colors pr-10"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#4B5563] font-medium">lbs</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-[11px] text-[#4B5563] mt-3 text-center">
                  {t('fitnessLevel.maxes.hint')}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: GOAL ── */}
        {step === 3 && (
          <div className="animate-fade-in">
            <h2 className="text-[20px] font-semibold text-[#E5E7EB] mb-1">{t('goal.title')}</h2>
            <p className="text-[13px] text-[#6B7280] mb-4">{t('goal.subtitle')}</p>
            <Hint>{t('goal.hint')}</Hint>
            <div className="flex flex-col gap-3">
              {GOALS.map(g => (
                <OptionCard
                  key={g.value}
                  selected={data.primary_goal === g.value}
                  onClick={() => set('primary_goal', g.value)}
                  icon={g.icon}
                  label={t(`goal.${g.key}.label`)}
                  desc={t(`goal.${g.key}.desc`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 4: FREQUENCY + EQUIPMENT ── */}
        {step === 4 && (
          <div className="animate-fade-in">
            <h2 className="text-[20px] font-semibold text-[#E5E7EB] mb-1">{t('training.title')}</h2>
            <p className="text-[13px] text-[#6B7280] mb-5">{t('training.subtitle')}</p>

            {/* Days per week */}
            <div className="mb-7">
              <p className="text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
                {t('training.daysPerWeek')}
              </p>
              <p className="text-[12px] text-[#4B5563] mb-3">{t('training.daysCommit')}</p>
              <div className="flex gap-2">
                {FREQUENCIES.map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setFrequency(n)}
                    className={`flex-1 py-3 rounded-xl text-[15px] font-bold transition-all ${
                      data.training_days_per_week === n
                        ? 'bg-[#D4AF37] text-black'
                        : 'bg-[#0F172A] border border-white/[0.06] text-[#9CA3AF] hover:border-white/14'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[#4B5563] mt-2 text-center">
                {data.training_days_per_week <= 2 && t('training.freq1')}
                {data.training_days_per_week === 3 && t('training.freq3')}
                {data.training_days_per_week === 4 && t('training.freq4')}
                {data.training_days_per_week === 5 && t('training.freq5')}
                {data.training_days_per_week >= 6 && t('training.freq6')}
              </p>
            </div>

            {/* Equipment */}
            <div>
              <p className="text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
                {t('training.equipment')}
              </p>
              <p className="text-[12px] text-[#4B5563] mb-3">{t('training.equipmentHint')}</p>
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
                          : 'bg-[#0F172A] border-white/[0.06] text-[#6B7280] hover:border-white/16 hover:text-[#9CA3AF]'
                      }`}
                    >
                      {t(`training.${eq.key}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 5: LOCK IN YOUR SCHEDULE ── */}
        {step === 5 && (
          <div className="animate-fade-in">
            <h2 className="text-[20px] font-semibold text-[#E5E7EB] mb-1">{t('schedule.title')}</h2>
            <p className="text-[13px] text-[#6B7280] mb-5">{t('schedule.subtitle')}</p>

            {/* Day selector */}
            <div className="mb-7">
              <p className="text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
                {t('schedule.whichDays')}
              </p>
              <p className="text-[12px] text-[#4B5563] mb-3">{t('schedule.daysPrefilled')}</p>
              <div className="flex gap-2">
                {FULL_DAYS_EN.map((dayEN, idx) => {
                  const active = data.preferred_training_days.includes(dayEN);
                  return (
                    <button
                      key={dayEN}
                      type="button"
                      onClick={() => toggleTrainingDay(dayEN)}
                      className={`flex-1 py-2.5 rounded-xl text-[12px] font-bold transition-all ${
                        active
                          ? 'bg-[#D4AF37] text-black'
                          : 'bg-[#0F172A] border border-white/[0.06] text-[#6B7280] hover:border-white/14 hover:text-[#9CA3AF]'
                      }`}
                    >
                      {dayShort(idx)}
                    </button>
                  );
                })}
              </div>
              {data.preferred_training_days.length === 0 && (
                <p className="text-[11px] text-red-400 mt-2 text-center">{t('schedule.selectAtLeast')}</p>
              )}
              {data.preferred_training_days.length > 0 && (
                <p className="text-[11px] text-[#4B5563] mt-2 text-center">
                  {t('schedule.daysSelected', { count: data.preferred_training_days.length })}
                </p>
              )}
            </div>

            {/* Time preference */}
            <div className="mb-7">
              <p className="text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
                {t('schedule.preferTime')}
              </p>
              <p className="text-[12px] text-[#4B5563] mb-3">{t('schedule.timeHint')}</p>
              <div className="flex flex-col gap-2">
                {TIME_PREFERENCES.map(tp => {
                  const active = data.preferred_training_time === tp.value;
                  return (
                    <button
                      key={tp.value}
                      type="button"
                      onClick={() => set('preferred_training_time', tp.value)}
                      className={`w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl border transition-all ${
                        active
                          ? 'bg-[#D4AF37]/12 border-[#D4AF37]/50 shadow-[0_0_0_1px_rgba(212,175,55,0.3)]'
                          : 'bg-[#0F172A] border-white/[0.06] hover:border-white/14'
                      }`}
                    >
                      <tp.icon size={20} className={active ? 'text-[#D4AF37]' : 'text-[#9CA3AF]'} />
                      <div className="flex-1 text-left">
                        <p className={`font-semibold text-[14px] ${active ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                          {t(`schedule.${tp.key}`)}
                        </p>
                        <p className="text-[12px] text-[#6B7280]">{t(`schedule.${tp.subKey}`)}</p>
                      </div>
                      {active && <Check size={16} className="text-[#D4AF37] flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Workout buddy prompt */}
            <div>
              <p className="text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
                {t('schedule.workoutPartner')}
              </p>
              <p className="text-[12px] text-[#4B5563] mb-3">{t('schedule.partnerQuestion')}</p>
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => set('has_workout_buddy', true)}
                  className={`flex-1 py-2.5 rounded-xl text-[13px] font-bold border transition-all ${
                    data.has_workout_buddy === true
                      ? 'bg-[#D4AF37]/12 border-[#D4AF37]/50 text-[#D4AF37]'
                      : 'bg-[#0F172A] border-white/[0.06] text-[#6B7280] hover:border-white/14 hover:text-[#9CA3AF]'
                  }`}
                >
                  {t('common:yes')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    set('has_workout_buddy', false);
                    set('workout_buddy_username', '');
                  }}
                  className={`flex-1 py-2.5 rounded-xl text-[13px] font-bold border transition-all ${
                    data.has_workout_buddy === false
                      ? 'bg-[#D4AF37]/12 border-[#D4AF37]/50 text-[#D4AF37]'
                      : 'bg-[#0F172A] border-white/[0.06] text-[#6B7280] hover:border-white/14 hover:text-[#9CA3AF]'
                  }`}
                >
                  {t('common:no')}
                </button>
              </div>
              {data.has_workout_buddy === true && (
                <input
                  type="text"
                  placeholder={t('schedule.partnerPlaceholder')}
                  value={data.workout_buddy_username}
                  onChange={e => set('workout_buddy_username', e.target.value)}
                  className="w-full bg-[#0B1220] border border-white/[0.06] rounded-xl px-4 py-3 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
                />
              )}
              {data.has_workout_buddy === false && (
                <div className="bg-[#0F172A] border border-white/[0.06] rounded-xl px-4 py-3 text-center">
                  <p className="text-[13px] text-[#9CA3AF]">{t('schedule.findPartner')}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 6: BODY STATS + INJURIES ── */}
        {step === 6 && (
          <div className="animate-fade-in">
            <h2 className="text-[20px] font-semibold text-[#E5E7EB] mb-1">
              {t('bodyStats.title')} <span className="text-[#4B5563] font-normal text-[15px]">({t('common:optional')})</span>
            </h2>
            <p className="text-[13px] text-[#6B7280] mb-5">{t('bodyStats.subtitle')}</p>

            {/* Sex */}
            <div className="mb-5">
              <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                {t('bodyStats.sex')}
              </label>
              <div className="flex gap-2">
                {[{ value: 'male', label: t('bodyStats.male') }, { value: 'female', label: t('bodyStats.female') }].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set('sex', opt.value)}
                    className={`flex-1 py-3 rounded-xl text-[14px] font-semibold border transition-all ${
                      data.sex === opt.value
                        ? 'bg-[#D4AF37]/15 border-[#D4AF37]/40 text-[#D4AF37]'
                        : 'bg-[#0F172A] border-white/[0.06] text-[#6B7280]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[#4B5563] mt-1.5">{t('bodyStats.sexHint')}</p>
            </div>

            {/* Age */}
            <div className="mb-5">
              <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
                {t('bodyStats.age')}
              </label>
              <input
                type="number"
                inputMode="numeric"
                min="13"
                max="99"
                placeholder="25"
                value={data.age}
                onChange={e => set('age', e.target.value)}
                className="w-full bg-[#0B1220] border border-white/[0.06] rounded-xl px-4 py-3 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
              />
            </div>

            {/* Height */}
            <div className="mb-5">
              <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
                {t('bodyStats.height')}
              </label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="3"
                    max="8"
                    placeholder="5"
                    value={data.height_feet}
                    onChange={e => set('height_feet', e.target.value)}
                    className="w-full bg-[#0B1220] border border-white/[0.06] rounded-xl px-4 py-3 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#4B5563]">ft</span>
                </div>
                <div className="flex-1 relative">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="11"
                    placeholder="10"
                    value={data.height_inches}
                    onChange={e => set('height_inches', e.target.value)}
                    className="w-full bg-[#0B1220] border border-white/[0.06] rounded-xl px-4 py-3 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#4B5563]">in</span>
                </div>
              </div>
            </div>

            {/* Weight */}
            <div className="mb-6">
              <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
                {t('bodyStats.weight')}
              </label>
              <p className="text-[12px] text-[#4B5563] mb-2">{t('bodyStats.weightHint')}</p>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="50"
                max="700"
                placeholder={t('bodyStats.weightPlaceholder')}
                value={data.initial_weight_lbs}
                onChange={e => set('initial_weight_lbs', e.target.value)}
                className="w-full bg-[#0B1220] border border-white/[0.06] rounded-xl px-4 py-3 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
              />
            </div>

            {/* Injuries */}
            <div className="mb-5">
              <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
                {t('bodyStats.injuries')}
              </label>
              <p className="text-[12px] text-[#4B5563] mb-3">{t('bodyStats.injuriesHint')}</p>
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
                          : 'bg-[#0F172A] border-white/[0.06] text-[#6B7280] hover:border-white/16 hover:text-[#9CA3AF]'
                      }`}
                    >
                      {t(`bodyStats.${inj.key}`)}
                    </button>
                  );
                })}
              </div>
              {data.injury_areas.length === 0 && (
                <p className="text-[11px] text-[#4B5563]">{t('bodyStats.noneSelected')}</p>
              )}
              {data.injury_areas.length > 0 && (
                <p className="text-[11px] text-[#9CA3AF]">
                  {t('bodyStats.areasCount', { count: data.injury_areas.length })}
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

        {/* ── STEP 7: HEALTH INTEGRATION ── */}
        {step === 7 && (
          <div className="animate-fade-in">
            <h2 className="text-[20px] font-semibold text-[#E5E7EB] mb-1">{t('health.title')}</h2>
            <p className="text-[13px] text-[#6B7280] mb-6">{t('health.subtitle')}</p>

            <Hint>{t('health.hint')}</Hint>

            {/* Platform illustration */}
            <div className="bg-white/[0.04] rounded-2xl border border-white/[0.06] p-6 mb-6 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#D4AF37]/10 border border-[#D4AF37]/20 mb-4">
                <Heart size={28} className="text-[#D4AF37]" />
              </div>
              <p className="text-[15px] font-semibold text-[#E5E7EB] mb-1">
                {platform === 'web' ? t('health.webTitle') : healthPlatformName}
              </p>
              <p className="text-[12px] text-[#6B7280] mb-5">
                {platform === 'web'
                  ? t('health.webDesc')
                  : t('health.nativeDesc')}
              </p>

              {/* Data types we sync */}
              <div className="flex justify-center gap-3 mb-5">
                {[
                  { label: t('health.steps'), icon: '👟' },
                  { label: t('health.heartRate'), icon: '❤️' },
                  { label: t('health.calories'), icon: '🔥' },
                  { label: t('health.weight'), icon: '⚖️' },
                ].map(item => (
                  <div key={item.label} className="flex flex-col items-center gap-1.5">
                    <div className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-lg">
                      {item.icon}
                    </div>
                    <span className="text-[10px] text-[#6B7280] font-medium">{item.label}</span>
                  </div>
                ))}
              </div>

              {/* Connect button */}
              {platform !== 'web' && healthStatus !== 'linked' && (
                <button
                  type="button"
                  onClick={handleLinkHealth}
                  disabled={healthStatus === 'linking'}
                  className="w-full flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-50 text-black font-bold text-[14px] py-3.5 rounded-xl transition-all"
                >
                  {healthStatus === 'linking' ? (
                    <>{t('health.connecting')}</>
                  ) : (
                    <><Smartphone size={16} /> {t('health.connect', { healthPlatformName })}</>
                  )}
                </button>
              )}

              {/* Success state */}
              {healthStatus === 'linked' && (
                <div className="flex items-center justify-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl py-3.5">
                  <Check size={18} className="text-emerald-400" />
                  <span className="text-[14px] font-semibold text-emerald-400">
                    {t('health.connected', { healthPlatformName })}
                  </span>
                </div>
              )}

              {/* Unavailable state */}
              {healthStatus === 'unavailable' && (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3">
                  <p className="text-[13px] text-yellow-400">{t('health.unavailable', { healthPlatformName })}</p>
                </div>
              )}

              {/* Error state */}
              {healthStatus === 'error' && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mt-3">
                  <p className="text-[13px] text-red-400">{t('health.error')}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 8: FIND YOUR GYM SQUAD (final step) ── */}
        {step === 8 && (
          <div className="animate-fade-in">
            <h2 className="text-[20px] font-semibold text-[#E5E7EB] mb-1">{t('social.title')}</h2>
            <p className="text-[13px] text-[#6B7280] mb-6">{t('social.subtitle')}</p>

            <Hint>{t('social.hint')}</Hint>

            {/* Social feed mockup */}
            <div className="mb-6">
              <p className="text-[11px] font-semibold text-[#4B5563] uppercase tracking-wider mb-3">
                {t('social.feedPreview')}
              </p>
              <div className="flex flex-col gap-2.5">
                {/* Mock activity card 1 */}
                <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] px-4 py-3.5 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#D4AF37]/20 border border-[#D4AF37]/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-[13px]">A</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-[13px] font-semibold text-[#E5E7EB]">Alex</p>
                      <p className="text-[12px] text-[#4B5563]">{t('social.mockPR')}</p>
                      <span className="text-[13px] text-[#D4AF37] font-bold">PR</span>
                    </div>
                    <p className="text-[12px] text-[#6B7280]">Bench Press — 225 lbs × 5 reps</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[11px] text-[#4B5563]">{t('social.minAgo')}</span>
                      <button className="text-[11px] text-[#6B7280] hover:text-[#D4AF37] transition-colors">👏 {t('social.nice')}</button>
                    </div>
                  </div>
                </div>

                {/* Mock activity card 2 */}
                <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] px-4 py-3.5 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-[13px]">J</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-[13px] font-semibold text-[#E5E7EB]">Jordan</p>
                      <p className="text-[12px] text-[#4B5563]">{t('social.mockSession')}</p>
                      <span className="text-[13px] text-[#D4AF37] font-bold">·</span>
                    </div>
                    <p className="text-[12px] text-[#6B7280]">Upper Body — 14 sets · 42 min</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[11px] text-[#4B5563]">{t('social.minAgo18')}</span>
                      <button className="text-[11px] text-[#6B7280] hover:text-[#D4AF37] transition-colors">{t('social.crushIt')}</button>
                    </div>
                  </div>
                </div>

                {/* Mock activity card 3 */}
                <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] px-4 py-3.5 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-[13px]">M</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-[13px] font-semibold text-[#E5E7EB]">Morgan</p>
                      <p className="text-[12px] text-[#4B5563]">{t('social.mockStreak')}</p>
                      <p className="text-[13px] font-bold text-[#D4AF37]">{t('social.mockStreakDays')}</p>
                      <span className="text-[13px] text-[#D4AF37] font-bold">·</span>
                    </div>
                    <p className="text-[12px] text-[#6B7280]">{t('social.mockStreakDesc')}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[11px] text-[#4B5563]">{t('social.hrAgo')}</span>
                      <button className="text-[11px] text-[#6B7280] hover:text-[#D4AF37] transition-colors">🙌 {t('social.insane')}</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4">
                <p className="text-[13px] text-red-400">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Health disclaimer ── */}
        {step === TOTAL_STEPS - 1 && (
          <p className="text-[11px] text-[#6B7280] text-center leading-relaxed mt-4">
            {t('disclaimer')}
          </p>
        )}

        {/* ── NAV BUTTONS (hidden on invite code step which has its own buttons) ── */}
        {step > 0 && (
        <div className="flex gap-3 mt-8">
          <button
            type="button"
            onClick={() => setStep(s => s - 1)}
            className="flex items-center gap-1.5 px-5 py-3.5 rounded-xl border border-white/[0.06] text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/[0.06] transition-colors duration-200 text-[14px] font-semibold"
          >
            <ChevronLeft size={17} /> {t('common:back')}
          </button>

          {step < TOTAL_STEPS - 1 ? (
            <button
              type="button"
              onClick={() => setStep(s => s + 1)}
              disabled={!canAdvance()}
              className="flex-1 flex items-center justify-center gap-1.5 bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-30 disabled:cursor-not-allowed text-black font-bold text-[15px] py-3.5 rounded-xl transition-all"
            >
              {t('common:continue')} <ChevronRight size={17} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold text-[15px] py-3.5 rounded-xl transition-all"
            >
              {saving ? t('common:saving') : (
                <>{t('finish')} <ChevronRight size={17} /></>
              )}
            </button>
          )}
        </div>
        )}

        {/* Skip on body stats or health step */}
        {(step === 6 || step === 7) && (
          <button
            type="button"
            onClick={() => setStep(s => s + 1)}
            className="w-full text-center text-[12px] text-[#4B5563] hover:text-[#6B7280] mt-3 py-2 transition-colors"
          >
            {step === 7 ? t('health.skip') : t('common:skip')}
          </button>
        )}
      </div>
    </div>
  );
};

export default Onboarding;
