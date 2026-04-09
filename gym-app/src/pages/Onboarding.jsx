import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronLeft, Check, Dumbbell, Sprout, Zap, Trophy, Flame, Activity, Sparkles, Sunrise, Sun, Moon, Heart, Smartphone, Loader2, UtensilsCrossed, Search, X, AlertTriangle, MapPin, Camera, BarChart3, Shield, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePostHog } from '@posthog/react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Capacitor } from '@capacitor/core';
import { isAvailable as healthAvailable, requestPermissions as healthRequest, readLatestWeight, readHeight, readBiologicalSex, readDateOfBirth } from '../lib/healthSync';
import { generateProgram } from '../lib/workoutGenerator';
import { calculateMacros } from '../lib/macroCalculator';
import { generateWeekPlan } from '../lib/mealPlanner';
import { MEALS } from '../data/meals';
import { isMealAllergenSafe, isMealDietaryCompliant } from '../lib/mealPreferences';
import RewardPicker from '../components/RewardPicker';

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

const TOTAL_STEPS = 10; // invite code step 0, language step 1, data consent step 7, health step 8 (core onboarding steps)
const TOTAL_STEPS_WITH_PLANS = 12; // includes workout plan (step 10) and meal plan (step 11)

// ── STEP INDICATOR ─────────────────────────────────────────
const STEP_LABELS = ['Invite', 'Language', 'Level', 'Goals', 'Schedule', 'Equipment', 'Injuries', 'Privacy', 'Health', 'Metrics', 'Program', 'Nutrition'];

// Analytics step names (used for PostHog events and DB tracking)
const STEP_NAMES = ['invite', 'language', 'fitness_level', 'goal', 'equipment', 'schedule', 'body_stats', 'data_consent', 'health_sync', 'social'];

const StepIndicator = ({ current, total }) => {
  const labels = total ? STEP_LABELS.slice(0, total) : STEP_LABELS;
  return (
    <nav aria-label="Onboarding progress" className="flex items-center justify-between mb-8 px-1">
      {labels.map((label, i) => (
        <div key={i} className="flex flex-col items-center gap-1" aria-current={i === current ? 'step' : undefined}>
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${
              i < current ? 'bg-[#D4AF37] text-black' :
              i === current ? 'bg-[#D4AF37]/20 text-[#D4AF37] ring-2 ring-[#D4AF37]' :
              'bg-white/[0.04] text-[var(--color-text-muted)]'
            }`}
            aria-label={i < current ? `${label} - completed` : i === current ? `${label} - current step` : `${label} - step ${i + 1}`}
          >
            {i < current ? <Check size={12} aria-hidden="true" /> : i + 1}
          </div>
          <span className={`text-[8px] font-medium tracking-wide ${
            i <= current ? 'text-[#D4AF37]' : 'text-[var(--color-text-muted)]'
          }`}>{label}</span>
        </div>
      ))}
    </nav>
  );
};

// ── OPTION CARD ────────────────────────────────────────────
const OptionCard = ({ selected, onClick, icon: Icon, label, desc, badge }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full text-left flex items-center gap-4 px-5 py-4 rounded-2xl border transition-all ${
      selected
        ? 'bg-[#D4AF37]/12 border-[#D4AF37]/50 shadow-[0_0_0_1px_rgba(212,175,55,0.3)]'
        : 'bg-[var(--color-bg-card)] border-white/[0.06] hover:border-white/14'
    }`}
  >
    <span className="flex-shrink-0">
      <Icon size={20} className={selected ? 'text-[#D4AF37]' : 'text-[var(--color-text-muted)]'} />
    </span>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className={`font-semibold text-[15px] ${selected ? 'text-[#D4AF37]' : 'text-[var(--color-text-primary)]'}`}>{label}</p>
        {badge && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            selected ? 'bg-[#D4AF37]/20 text-[#D4AF37]' : 'bg-white/6 text-[var(--color-text-subtle)]'
          }`}>{badge}</span>
        )}
      </div>
      {desc && <p className="text-[12px] mt-0.5" style={{ color: "var(--color-text-subtle)" }}>{desc}</p>}
    </div>
    {selected && <Check size={16} className="text-[#D4AF37] flex-shrink-0" />}
  </button>
);

// ── HEALTH DATA BADGE ─────────────────────────────────────
const HealthBadge = ({ visible, t }) => {
  if (!visible) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 ml-2">
      <Heart size={10} /> {t('bodyStats.fromHealth')}
    </span>
  );
};

// ── CONTEXT HINT ───────────────────────────────────────────
const Hint = ({ children }) => (
  <div className="bg-[#D4AF37]/6 border border-[#D4AF37]/15 rounded-xl px-4 py-3 mb-5">
    <p className="text-[12px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>{children}</p>
  </div>
);

// ── MAIN COMPONENT ─────────────────────────────────────────
const Onboarding = () => {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(['onboarding', 'common']);
  const posthog = usePostHog();

  const [step, setStep]     = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  // Invite code state
  const [inviteCode, setInviteCode] = useState('');
  const [inviteStatus, setInviteStatus] = useState('idle'); // idle | verifying | success | error
  const [showRewardPicker, setShowRewardPicker] = useState(false);
  const [referredRewardId, setReferredRewardId] = useState(null);
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

  // Generate plan screen state (shown after onboarding completes)
  const [showGeneratePlan, setShowGeneratePlan] = useState(false); // 'ask' | 'generating' | 'done' | false
  const [generateError, setGenerateError] = useState('');

  // Meal plan flow state (shown after workout plan)
  const [showMealPlan, setShowMealPlan] = useState(false); // 'ask' | 'prefs' | 'generating' | 'done' | false
  const [mealPlanError, setMealPlanError] = useState('');
  const [dietaryRestrictions, setDietaryRestrictions] = useState([]);
  const [foodAllergies, setFoodAllergies] = useState([]);
  const [dislikedIngredients, setDislikedIngredients] = useState([]);
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [generatedMealPlan, setGeneratedMealPlan] = useState(null);
  const [mealPlanMacros, setMealPlanMacros] = useState(null);

  const set = (field, value) => setData(d => ({ ...d, [field]: value }));
  const setMax = (exerciseId, value) =>
    setData(d => ({ ...d, known_maxes: { ...d.known_maxes, [exerciseId]: value } }));

  // ── ONBOARDING ANALYTICS ──────────────────────────────────
  const prevStepRef = useRef(0);

  useEffect(() => {
    if (step === prevStepRef.current) return;
    const prevStep = prevStepRef.current;
    prevStepRef.current = step;

    // When moving forward, the previous step was "completed"
    if (step > prevStep) {
      posthog?.capture('onboarding_step_completed', {
        step: prevStep,
        step_name: STEP_NAMES[prevStep],
      });
    }

    // Persist current step to DB so admins can query drop-off
    if (user?.id) {
      supabase
        .from('profiles')
        .update({ onboarding_step: step })
        .eq('id', user.id)
        .then();
    }
  }, [step, user?.id, posthog]);

  // Track abandonment on unmount (if onboarding not finished)
  useEffect(() => {
    return () => {
      const lastStep = prevStepRef.current;
      if (lastStep < TOTAL_STEPS - 1) {
        posthog?.capture('onboarding_abandoned', {
          last_step: lastStep,
          step_name: STEP_NAMES[lastStep],
        });
      }
    };
  }, [posthog]);

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

      // Check if invite had a linked referral → show reward picker
      if (result?.has_referral && result?.referred_reward_id) {
        setReferredRewardId(result.referred_reward_id);
        setTimeout(() => setShowRewardPicker(true), 1000);
      } else {
        // Auto-advance after 1.5s
        setTimeout(() => setStep(1), 1500);
      }
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

  // Data consent state
  const [consentDeclined, setConsentDeclined] = useState(false);

  const [healthStatus, setHealthStatus] = useState('idle'); // idle | linking | linked | unavailable | error
  const [healthPrefill, setHealthPrefill] = useState({}); // tracks which fields came from Health: { weight: true, height: true, age: true, sex: true }
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

        // Read health data to pre-fill body stats (only fill empty fields)
        const prefilled = {};
        const [weightData, heightData, sexData, dobData] = await Promise.allSettled([
          readLatestWeight(),
          readHeight(),
          readBiologicalSex(),
          readDateOfBirth(),
        ]);

        setData(prev => {
          const updates = { ...prev };

          // Weight (lbs) — only pre-fill if empty
          if (weightData.status === 'fulfilled' && weightData.value?.value && !prev.initial_weight_lbs) {
            updates.initial_weight_lbs = String(Math.round(weightData.value.value));
            prefilled.weight = true;
          }

          // Height (inches) — only pre-fill if both feet and inches are empty
          if (heightData.status === 'fulfilled' && heightData.value?.value && !prev.height_feet && !prev.height_inches) {
            const totalInches = heightData.value.value;
            updates.height_feet = String(Math.floor(totalInches / 12));
            updates.height_inches = String(Math.round(totalInches % 12));
            prefilled.height = true;
          }

          // Biological sex — only pre-fill if not yet selected
          if (sexData.status === 'fulfilled' && sexData.value && !prev.sex) {
            updates.sex = sexData.value;
            prefilled.sex = true;
          }

          // Age from date of birth — only pre-fill if empty
          if (dobData.status === 'fulfilled' && dobData.value?.age && !prev.age) {
            updates.age = String(dobData.value.age);
            prefilled.age = true;
          }

          return updates;
        });

        setHealthPrefill(prefilled);
      } else {
        setHealthStatus('error');
      }
    } catch {
      setHealthStatus('error');
    }
  };

  const handleConsentAgree = async () => {
    setConsentDeclined(false);
    try {
      await supabase
        .from('profiles')
        .update({ data_consent_at: new Date().toISOString(), data_consent_version: '1.0' })
        .eq('id', user.id);
    } catch {
      // Don't block onboarding if consent save fails — will retry on next app load
    }
    setStep(s => s + 1);
  };

  const handleConsentDecline = () => {
    setConsentDeclined(true);
  };

  const handleConsentDeclineContinue = () => {
    setConsentDeclined(false);
    setStep(s => s + 1);
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

      // Mark onboarding fully complete for analytics
      await supabase
        .from('profiles')
        .update({ onboarding_step: TOTAL_STEPS })
        .eq('id', user.id);

      posthog?.capture('onboarding_step_completed', {
        step: TOTAL_STEPS - 1,
        step_name: STEP_NAMES[TOTAL_STEPS - 1],
      });
      posthog?.capture('onboarding_completed', { total_steps: TOTAL_STEPS });

      refreshProfile();
      // Show the generate plan offer instead of navigating directly
      setShowGeneratePlan('ask');
    } catch (err) {
      setError(err.message || t('common:somethingWentWrong'));
    } finally {
      setSaving(false);
    }
  };

  // ── GENERATE PERSONAL PLAN ──────────────────────────────────
  const handleGeneratePlan = async () => {
    setShowGeneratePlan('generating');
    setGenerateError('');
    try {
      const { data: profileRow } = await supabase
        .from('profiles').select('gym_id').eq('id', user.id).single();
      const gymId = profileRow?.gym_id;

      // Map onboarding goal values to generator format
      const onboardingForGenerator = {
        fitness_level: data.fitness_level || 'beginner',
        primary_goal: data.primary_goal || 'general_fitness',
        training_days_per_week: data.training_days_per_week || 3,
        available_equipment: data.available_equipment?.length > 0
          ? data.available_equipment
          : ['Bodyweight'],
        injuries_notes: data.injury_areas?.length > 0
          ? data.injury_areas.join(', ')
          : '',
        sex: data.sex || 'male',
        age: data.age ? parseInt(data.age) : 30,
      };

      const result = generateProgram(onboardingForGenerator);

      // Save routines A set as personal routines
      for (const routine of result.routinesA) {
        const { data: saved, error: rErr } = await supabase
          .from('routines')
          .insert({
            name: routine.name,
            gym_id: gymId,
            created_by: user.id,
          })
          .select('id')
          .single();
        if (rErr) throw rErr;

        if (routine.exercises.length > 0) {
          const rows = routine.exercises.map((ex, i) => ({
            routine_id: saved.id,
            exercise_id: ex.exerciseId,
            position: i + 1,
            target_sets: ex.sets,
            target_reps: ex.reps,
            rest_seconds: ex.restSeconds,
          }));
          const { error: exErr } = await supabase.from('routine_exercises').insert(rows);
          if (exErr) throw exErr;
        }
      }

      posthog?.capture('onboarding_plan_generated', {
        split: result.splitLabel,
        goal: data.primary_goal,
        days: data.training_days_per_week,
        routines_count: result.routinesA.length,
      });

      setShowGeneratePlan('done');
    } catch (err) {
      setGenerateError(err.message || t('common:somethingWentWrong'));
      setShowGeneratePlan('ask');
    }
  };

  const handleSkipGeneratePlan = () => {
    setShowGeneratePlan(false);
    setShowMealPlan('ask');
  };

  const handlePlanDone = () => {
    setShowGeneratePlan(false);
    setShowMealPlan('ask');
  };

  // ── MEAL PLAN FLOW ───────────────────────────────────────────

  const DIETARY_OPTIONS = [
    { value: 'vegan',       key: 'vegan' },
    { value: 'vegetarian',  key: 'vegetarian' },
    { value: 'pescatarian', key: 'pescatarian' },
    { value: 'keto',        key: 'keto' },
    { value: 'gluten_free', key: 'gluten_free' },
    { value: 'dairy_free',  key: 'dairy_free' },
    { value: 'halal',       key: 'halal' },
  ];

  const ALLERGY_OPTIONS = [
    { value: 'nuts',      key: 'allergyNuts' },
    { value: 'shellfish', key: 'allergyShellfish' },
    { value: 'dairy',     key: 'allergyDairy' },
    { value: 'eggs',      key: 'allergyEggs' },
    { value: 'soy',       key: 'allergySoy' },
    { value: 'wheat',     key: 'allergyWheat' },
    { value: 'fish',      key: 'allergyFish' },
  ];

  // Common ingredients for dislike selection (readable names)
  const COMMON_INGREDIENTS = [
    'chicken_breast', 'salmon_fillet', 'ground_turkey', 'lean_ground_beef',
    'tofu', 'shrimp', 'eggs', 'greek_yogurt', 'oats', 'brown_rice',
    'quinoa', 'sweet_potato', 'broccoli', 'spinach', 'avocado',
    'peanut_butter', 'cottage_cheese', 'tuna', 'mushrooms', 'bell_pepper',
    'black_beans', 'chickpeas', 'lentils', 'kale', 'cauliflower',
    'zucchini', 'asparagus', 'brussels_sprouts', 'coconut_milk',
    'soy_sauce', 'olive_oil',
  ];

  // Compute how many meals match current restrictions
  const availableMealCount = useMemo(() => {
    return MEALS.filter(m =>
      isMealAllergenSafe(m, foodAllergies) &&
      isMealDietaryCompliant(m, dietaryRestrictions) &&
      !(m.ingredients || []).some(i => dislikedIngredients.includes(i))
    ).length;
  }, [foodAllergies, dietaryRestrictions, dislikedIngredients]);

  const filteredCommonIngredients = useMemo(() => {
    if (!ingredientSearch.trim()) return COMMON_INGREDIENTS;
    const q = ingredientSearch.toLowerCase();
    return COMMON_INGREDIENTS.filter(i => i.replace(/_/g, ' ').includes(q));
  }, [ingredientSearch]);

  const toggleRestriction = (val) =>
    setDietaryRestrictions(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    );

  const toggleAllergy = (val) =>
    setFoodAllergies(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    );

  const toggleDislike = (val) =>
    setDislikedIngredients(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    );

  const formatIngredient = (ing) =>
    ing.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const handleSkipMealPlan = () => {
    navigate('/welcome');
  };

  const handleMealPlanPrefs = () => {
    setShowMealPlan('prefs');
  };

  const handleGenerateMealPlan = async () => {
    setShowMealPlan('generating');
    setMealPlanError('');
    try {
      const { data: profileRow } = await supabase
        .from('profiles').select('gym_id').eq('id', user.id).single();
      const gymId = profileRow?.gym_id;

      // Calculate macros from onboarding data
      const heightInches = data.height_feet || data.height_inches
        ? (parseInt(data.height_feet || 0) * 12) + parseInt(data.height_inches || 0)
        : 70; // default 5'10"
      const macros = calculateMacros({
        weightLbs: parseFloat(data.initial_weight_lbs) || 170,
        heightInches,
        age: parseInt(data.age) || 25,
        sex: data.sex || 'male',
        trainingDays: data.training_days_per_week || 4,
        goal: data.primary_goal || 'general_fitness',
      });
      setMealPlanMacros(macros);

      // Save dietary preferences to DB
      await supabase
        .from('member_onboarding')
        .update({
          dietary_restrictions: dietaryRestrictions,
          food_allergies: foodAllergies,
        })
        .eq('profile_id', user.id);

      // Save disliked ingredients
      if (dislikedIngredients.length > 0) {
        const dislikeRows = dislikedIngredients.map(ing => ({
          profile_id: user.id,
          gym_id: gymId,
          food_name: ing,
        }));
        await supabase
          .from('disliked_foods')
          .upsert(dislikeRows, { onConflict: 'profile_id,food_name', ignoreDuplicates: true });
      }

      // Generate the 7-day meal plan
      const weekPlan = generateWeekPlan({
        targets: macros,
        favorites: [],
        allergies: foodAllergies,
        restrictions: dietaryRestrictions,
        affinities: {},
      });

      setGeneratedMealPlan(weekPlan);

      // Store generated plan in DB
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1); // Monday
      await supabase
        .from('generated_meal_plans')
        .upsert({
          profile_id: user.id,
          gym_id: gymId,
          week_start: startOfWeek.toISOString().split('T')[0],
          plan_data: weekPlan,
          macro_targets: macros,
          is_active: true,
        }, { onConflict: 'profile_id,week_start' });

      // Save macro targets to nutrition_targets if table exists
      await supabase
        .from('nutrition_targets')
        .upsert({
          profile_id: user.id,
          gym_id: gymId,
          calories: macros.calories,
          protein_g: macros.protein,
          carbs_g: macros.carbs,
          fat_g: macros.fat,
        }, { onConflict: 'profile_id' })
        .then(() => {}) // ignore errors if table doesn't exist yet
        .catch(() => {});

      posthog?.capture('onboarding_meal_plan_generated', {
        restrictions: dietaryRestrictions,
        allergies: foodAllergies,
        dislikes_count: dislikedIngredients.length,
        meals_available: availableMealCount,
        goal: data.primary_goal,
        calories: macros.calories,
        protein: macros.protein,
      });

      setShowMealPlan('done');
    } catch (err) {
      setMealPlanError(err.message || t('common:somethingWentWrong'));
      setShowMealPlan('prefs');
    }
  };

  const handleMealPlanDone = () => {
    navigate('/welcome');
  };

  // Helper to get translated day name abbreviation
  const dayShort = (index) => t(`common:days.${SHORT_DAY_KEYS[index]}`);
  // English full day names used as DB values
  const FULL_DAYS_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return (
    <main className="min-h-screen px-4 py-10 pb-28 md:pb-12 flex flex-col items-center" style={{ backgroundColor: "var(--color-bg-primary)" }}>
      <div className="w-full max-w-[480px] mx-auto md:max-w-4xl">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#D4AF37]/15 border border-[#D4AF37]/25 mb-4">
            <Dumbbell size={22} className="text-[#D4AF37]" strokeWidth={2} aria-hidden="true" />
          </div>
          <h1 className="text-[22px] font-bold truncate" style={{ color: "var(--color-text-primary)" }}>{t('title')}</h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--color-text-subtle)" }}>{t('subtitle')}</p>
        </div>

        {/* Step indicator — shows all steps including program + nutrition */}
        {!showGeneratePlan && !showMealPlan && <StepIndicator current={step} total={TOTAL_STEPS_WITH_PLANS} />}
        {showGeneratePlan && <StepIndicator current={TOTAL_STEPS} total={TOTAL_STEPS_WITH_PLANS} />}
        {showMealPlan && <StepIndicator current={TOTAL_STEPS + 1} total={TOTAL_STEPS_WITH_PLANS} />}

        {/* ── STEP 0: INVITE CODE ── */}
        {step === 0 && (
          <div className="animate-fade-in">
            <h2 className="text-[18px] font-semibold truncate mb-1" style={{ color: "var(--color-text-primary)" }}>{t('inviteCode.title')}</h2>
            <p className="text-[13px] mb-6" style={{ color: "var(--color-text-subtle)" }}>{t('inviteCode.subtitle')}</p>

            <div className="flex flex-col items-center gap-4">
              <input
                type="text"
                value={inviteCode}
                onChange={e => handleInviteCodeChange(e.target.value)}
                placeholder="e.g. ABC123"
                disabled={inviteStatus === 'verifying' || inviteStatus === 'success'}
                aria-label={t('inviteCode.title')}
                className="w-full bg-[var(--color-bg-input)] border border-white/[0.06] rounded-xl px-4 py-4 text-center text-[20px] font-mono font-bold tracking-[0.2em] uppercase placeholder-[var(--color-text-muted)] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none transition-colors disabled:opacity-50" style={{ color: "var(--color-text-primary)" }}
              />

              {/* Verify button */}
              {inviteStatus !== 'success' && (
                <button
                  type="button"
                  onClick={handleVerifyInviteCode}
                  disabled={!inviteCode.trim() || inviteStatus === 'verifying'}
                  className="w-full flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-30 disabled:cursor-not-allowed text-black font-bold text-[14px] whitespace-nowrap py-3.5 rounded-xl transition-all"
                >
                  {inviteStatus === 'verifying'
                    ? t('inviteCode.verifying')
                    : t('inviteCode.verify')}
                </button>
              )}

              {/* Success state */}
              {inviteStatus === 'success' && !showRewardPicker && (
                <div className="w-full flex items-center justify-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl py-3.5">
                  <Check size={18} className="text-emerald-400" />
                  <span className="text-[14px] font-semibold text-emerald-400">
                    {t('inviteCode.success')}
                  </span>
                </div>
              )}

              {/* Referral reward picker — shown after invite claim if referral was linked */}
              {showRewardPicker && referredRewardId && (
                <RewardPicker
                  rewardId={referredRewardId}
                  gymId={profile?.gym_id}
                  onChosen={() => { setShowRewardPicker(false); setTimeout(() => setStep(1), 800); }}
                  onSkip={() => { setShowRewardPicker(false); setStep(1); }}
                  className="w-full"
                />
              )}

              {/* Error state */}
              {inviteStatus === 'error' && inviteError && (
                <div role="alert" className="w-full bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                  <p className="text-[13px] text-red-400 text-center">{inviteError}</p>
                </div>
              )}

              {/* Skip button */}
              {inviteStatus !== 'success' && (
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="w-full text-center text-[13px] py-2 transition-colors" style={{ color: "var(--color-text-muted)" }}
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
            <h2 className="text-[18px] font-semibold truncate mb-1" style={{ color: "var(--color-text-primary)" }}>{t('langStep.title')}</h2>
            <p className="text-[13px] mb-6" style={{ color: "var(--color-text-subtle)" }}>{t('langStep.subtitle')}</p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => selectLanguage('en')}
                className={`w-full flex items-center gap-4 px-5 py-5 rounded-2xl border transition-all ${
                  data.language === 'en'
                    ? 'bg-[#D4AF37]/12 border-[#D4AF37]/50 shadow-[0_0_0_1px_rgba(212,175,55,0.3)]'
                    : 'bg-[var(--color-bg-card)] border-white/[0.06] hover:border-white/14'
                }`}
              >
                <span className="text-3xl">🇺🇸</span>
                <div className="flex-1 text-left">
                  <p className={`font-bold text-[17px] ${data.language === 'en' ? 'text-[#D4AF37]' : 'text-[var(--color-text-primary)]'}`}>English</p>
                </div>
                {data.language === 'en' && <Check size={18} className="text-[#D4AF37] flex-shrink-0" />}
              </button>
              <button
                type="button"
                onClick={() => selectLanguage('es')}
                className={`w-full flex items-center gap-4 px-5 py-5 rounded-2xl border transition-all ${
                  data.language === 'es'
                    ? 'bg-[#D4AF37]/12 border-[#D4AF37]/50 shadow-[0_0_0_1px_rgba(212,175,55,0.3)]'
                    : 'bg-[var(--color-bg-card)] border-white/[0.06] hover:border-white/14'
                }`}
              >
                <span className="text-3xl">🇵🇷</span>
                <div className="flex-1 text-left">
                  <p className={`font-bold text-[17px] ${data.language === 'es' ? 'text-[#D4AF37]' : 'text-[var(--color-text-primary)]'}`}>Español</p>
                </div>
                {data.language === 'es' && <Check size={18} className="text-[#D4AF37] flex-shrink-0" />}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: FITNESS LEVEL ── */}
        {step === 2 && (
          <div className="animate-fade-in">
            <h2 className="text-[18px] font-semibold truncate mb-1" style={{ color: "var(--color-text-primary)" }}>{t('fitnessLevel.title')}</h2>
            <p className="text-[13px] mb-4" style={{ color: "var(--color-text-subtle)" }}>{t('fitnessLevel.subtitle')}</p>
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
                  <p className="text-[13px] font-semibold mb-0.5" style={{ color: "var(--color-text-primary)" }}>
                    {t('fitnessLevel.maxes.title')}
                  </p>
                  <p className="text-[12px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
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
                    <div key={lift.id} className="border border-white/[0.06] rounded-xl px-4 py-3 flex items-center gap-3 overflow-hidden" style={{ backgroundColor: "var(--color-bg-card)" }}>
                      <span className="text-lg flex-shrink-0">{lift.icon}</span>
                      <div className="flex-1 min-w-0">
                        <label className="block text-[13px] font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>{lift.label}</label>
                        <div className="relative">
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            max="1500"
                            placeholder="—"
                            aria-label={lift.label}
                            value={data.known_maxes[lift.id]}
                            onChange={e => setMax(lift.id, e.target.value)}
                            className="w-full bg-[var(--color-bg-input)] border border-white/[0.06] rounded-lg px-3 py-2 text-[14px] placeholder-[var(--color-text-muted)] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none transition-colors pr-10" style={{ color: "var(--color-text-primary)" }}
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium" style={{ color: "var(--color-text-muted)" }}>lbs</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-[11px] mt-3 text-center" style={{ color: "var(--color-text-muted)" }}>
                  {t('fitnessLevel.maxes.hint')}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: GOAL ── */}
        {step === 3 && (
          <div className="animate-fade-in">
            <h2 className="text-[18px] font-semibold truncate mb-1" style={{ color: "var(--color-text-primary)" }}>{t('goal.title')}</h2>
            <p className="text-[13px] mb-4" style={{ color: "var(--color-text-subtle)" }}>{t('goal.subtitle')}</p>
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
            <h2 className="text-[18px] font-semibold truncate mb-1" style={{ color: "var(--color-text-primary)" }}>{t('training.title')}</h2>
            <p className="text-[13px] mb-5" style={{ color: "var(--color-text-subtle)" }}>{t('training.subtitle')}</p>

            {/* Days per week */}
            <div className="mb-7">
              <p className="text-[12px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>
                {t('training.daysPerWeek')}
              </p>
              <p className="text-[12px] mb-3" style={{ color: "var(--color-text-muted)" }}>{t('training.daysCommit')}</p>
              <div className="flex gap-2">
                {FREQUENCIES.map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setFrequency(n)}
                    aria-label={`${n} ${n === 1 ? 'day' : 'days'} per week`}
                    aria-pressed={data.training_days_per_week === n}
                    className={`flex-1 py-3 rounded-xl text-[14px] font-bold whitespace-nowrap transition-all ${
                      data.training_days_per_week === n
                        ? 'bg-[#D4AF37] text-black'
                        : 'bg-[var(--color-bg-card)] border border-white/[0.06] text-[var(--color-text-muted)] hover:border-white/14'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-[11px] mt-2 text-center" style={{ color: "var(--color-text-muted)" }}>
                {data.training_days_per_week <= 2 && t('training.freq1')}
                {data.training_days_per_week === 3 && t('training.freq3')}
                {data.training_days_per_week === 4 && t('training.freq4')}
                {data.training_days_per_week === 5 && t('training.freq5')}
                {data.training_days_per_week >= 6 && t('training.freq6')}
              </p>
            </div>

            {/* Equipment */}
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>
                {t('training.equipment')}
              </p>
              <p className="text-[12px] mb-3" style={{ color: "var(--color-text-muted)" }}>{t('training.equipmentHint')}</p>
              <div className="flex flex-wrap gap-2">
                {EQUIPMENT_OPTIONS.map(eq => {
                  const active = data.available_equipment.includes(eq.value);
                  return (
                    <button
                      key={eq.value}
                      type="button"
                      onClick={() => toggleEquipment(eq.value)}
                      aria-pressed={active}
                      className={`text-[13px] font-semibold px-3.5 py-2 rounded-full border transition-all ${
                        active
                          ? 'bg-[#D4AF37]/15 border-[#D4AF37]/40 text-[#D4AF37]'
                          : 'bg-[var(--color-bg-card)] border-white/[0.06] text-[var(--color-text-subtle)] hover:border-white/16 hover:text-[var(--color-text-muted)]'
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
            <h2 className="text-[18px] font-semibold truncate mb-1" style={{ color: "var(--color-text-primary)" }}>{t('schedule.title')}</h2>
            <p className="text-[13px] mb-5" style={{ color: "var(--color-text-subtle)" }}>{t('schedule.subtitle')}</p>

            {/* Day selector */}
            <div className="mb-7">
              <p className="text-[12px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>
                {t('schedule.whichDays')}
              </p>
              <p className="text-[12px] mb-3" style={{ color: "var(--color-text-muted)" }}>{t('schedule.daysPrefilled')}</p>
              <div className="flex gap-2">
                {FULL_DAYS_EN.map((dayEN, idx) => {
                  const active = data.preferred_training_days.includes(dayEN);
                  return (
                    <button
                      key={dayEN}
                      type="button"
                      onClick={() => toggleTrainingDay(dayEN)}
                      aria-label={dayEN}
                      aria-pressed={active}
                      className={`flex-1 py-2.5 rounded-xl text-[12px] font-bold transition-all ${
                        active
                          ? 'bg-[#D4AF37] text-black'
                          : 'bg-[var(--color-bg-card)] border border-white/[0.06] text-[var(--color-text-subtle)] hover:border-white/14 hover:text-[var(--color-text-muted)]'
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
                <p className="text-[11px] mt-2 text-center" style={{ color: "var(--color-text-muted)" }}>
                  {t('schedule.daysSelected', { count: data.preferred_training_days.length })}
                </p>
              )}
            </div>

            {/* Time preference */}
            <div className="mb-7">
              <p className="text-[12px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>
                {t('schedule.preferTime')}
              </p>
              <p className="text-[12px] mb-3" style={{ color: "var(--color-text-muted)" }}>{t('schedule.timeHint')}</p>
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
                          : 'bg-[var(--color-bg-card)] border-white/[0.06] hover:border-white/14'
                      }`}
                    >
                      <tp.icon size={20} className={active ? 'text-[#D4AF37]' : 'text-[var(--color-text-muted)]'} />
                      <div className="flex-1 text-left">
                        <p className={`font-semibold text-[14px] ${active ? 'text-[#D4AF37]' : 'text-[var(--color-text-primary)]'}`}>
                          {t(`schedule.${tp.key}`)}
                        </p>
                        <p className="text-[12px]" style={{ color: "var(--color-text-subtle)" }}>{t(`schedule.${tp.subKey}`)}</p>
                      </div>
                      {active && <Check size={16} className="text-[#D4AF37] flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Workout buddy prompt */}
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>
                {t('schedule.workoutPartner')}
              </p>
              <p className="text-[12px] mb-3" style={{ color: "var(--color-text-muted)" }}>{t('schedule.partnerQuestion')}</p>
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => set('has_workout_buddy', true)}
                  aria-pressed={data.has_workout_buddy === true}
                  className={`flex-1 py-2.5 rounded-xl text-[13px] font-bold border transition-all ${
                    data.has_workout_buddy === true
                      ? 'bg-[#D4AF37]/12 border-[#D4AF37]/50 text-[#D4AF37]'
                      : 'bg-[var(--color-bg-card)] border-white/[0.06] text-[var(--color-text-subtle)] hover:border-white/14 hover:text-[var(--color-text-muted)]'
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
                  aria-pressed={data.has_workout_buddy === false}
                  className={`flex-1 py-2.5 rounded-xl text-[13px] font-bold border transition-all ${
                    data.has_workout_buddy === false
                      ? 'bg-[#D4AF37]/12 border-[#D4AF37]/50 text-[#D4AF37]'
                      : 'bg-[var(--color-bg-card)] border-white/[0.06] text-[var(--color-text-subtle)] hover:border-white/14 hover:text-[var(--color-text-muted)]'
                  }`}
                >
                  {t('common:no')}
                </button>
              </div>
              {data.has_workout_buddy === true && (
                <input
                  type="text"
                  placeholder={t('schedule.partnerPlaceholder')}
                  aria-label={t('schedule.workoutPartner')}
                  value={data.workout_buddy_username}
                  onChange={e => set('workout_buddy_username', e.target.value)}
                  className="w-full bg-[var(--color-bg-input)] border border-white/[0.06] rounded-xl px-4 py-3 text-[14px] placeholder-[var(--color-text-muted)] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none transition-colors" style={{ color: "var(--color-text-primary)" }}
                />
              )}
              {data.has_workout_buddy === false && (
                <div className="border border-white/[0.06] rounded-xl px-4 py-3 text-center" style={{ backgroundColor: "var(--color-bg-card)" }}>
                  <p className="text-[13px]" style={{ color: "var(--color-text-muted)" }}>{t('schedule.findPartner')}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 6: BODY STATS + INJURIES ── */}
        {step === 6 && (
          <div className="animate-fade-in">
            <h2 className="text-[18px] font-semibold truncate mb-1" style={{ color: "var(--color-text-primary)" }}>
              {t('bodyStats.title')} <span className="font-normal text-[15px]" style={{ color: "var(--color-text-muted)" }}>({t('common:optional')})</span>
            </h2>
            <p className="text-[13px] mb-5" style={{ color: "var(--color-text-subtle)" }}>{t('bodyStats.subtitle')}</p>

            {/* Sex */}
            <div className="mb-5">
              <label className="flex items-center text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-muted)" }}>
                {t('bodyStats.sex')}
                <HealthBadge visible={healthPrefill.sex} t={t} />
              </label>
              <div className="flex gap-2">
                {[{ value: 'male', label: t('bodyStats.male') }, { value: 'female', label: t('bodyStats.female') }].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set('sex', opt.value)}
                    aria-pressed={data.sex === opt.value}
                    className={`flex-1 py-3 rounded-xl text-[14px] font-semibold border transition-all ${
                      data.sex === opt.value
                        ? 'bg-[#D4AF37]/15 border-[#D4AF37]/40 text-[#D4AF37]'
                        : 'bg-[var(--color-bg-card)] border-white/[0.06] text-[var(--color-text-subtle)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: "var(--color-text-muted)" }}>{t('bodyStats.sexHint')}</p>
            </div>

            {/* Age */}
            <div className="mb-5">
              <label className="flex items-center text-[12px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>
                {t('bodyStats.age')}
                <HealthBadge visible={healthPrefill.age} t={t} />
              </label>
              <input
                type="number"
                inputMode="numeric"
                min="13"
                max="99"
                placeholder="25"
                aria-label={t('bodyStats.age')}
                value={data.age}
                onChange={e => set('age', e.target.value)}
                className="w-full bg-[var(--color-bg-input)] border border-white/[0.06] rounded-xl px-4 py-3 text-[14px] placeholder-[var(--color-text-muted)] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none transition-colors" style={{ color: "var(--color-text-primary)" }}
              />
            </div>

            {/* Height */}
            <div className="mb-5">
              <label className="flex items-center text-[12px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>
                {t('bodyStats.height')}
                <HealthBadge visible={healthPrefill.height} t={t} />
              </label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="3"
                    max="8"
                    placeholder="5"
                    aria-label={t('bodyStats.height') + ' (ft)'}
                    value={data.height_feet}
                    onChange={e => set('height_feet', e.target.value)}
                    className="w-full bg-[var(--color-bg-input)] border border-white/[0.06] rounded-xl px-4 py-3 text-[14px] placeholder-[var(--color-text-muted)] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none transition-colors" style={{ color: "var(--color-text-primary)" }}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px]" style={{ color: "var(--color-text-muted)" }}>ft</span>
                </div>
                <div className="flex-1 relative">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="11"
                    placeholder="10"
                    aria-label={t('bodyStats.height') + ' (in)'}
                    value={data.height_inches}
                    onChange={e => set('height_inches', e.target.value)}
                    className="w-full bg-[var(--color-bg-input)] border border-white/[0.06] rounded-xl px-4 py-3 text-[14px] placeholder-[var(--color-text-muted)] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none transition-colors" style={{ color: "var(--color-text-primary)" }}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px]" style={{ color: "var(--color-text-muted)" }}>in</span>
                </div>
              </div>
            </div>

            {/* Weight */}
            <div className="mb-6">
              <label className="flex items-center text-[12px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>
                {t('bodyStats.weight')}
                <HealthBadge visible={healthPrefill.weight} t={t} />
              </label>
              <p className="text-[12px] mb-2" style={{ color: "var(--color-text-muted)" }}>{t('bodyStats.weightHint')}</p>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="50"
                max="700"
                placeholder={t('bodyStats.weightPlaceholder')}
                aria-label={t('bodyStats.weight')}
                value={data.initial_weight_lbs}
                onChange={e => set('initial_weight_lbs', e.target.value)}
                className="w-full bg-[var(--color-bg-input)] border border-white/[0.06] rounded-xl px-4 py-3 text-[14px] placeholder-[var(--color-text-muted)] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none transition-colors" style={{ color: "var(--color-text-primary)" }}
              />
            </div>

            {/* Injuries */}
            <div className="mb-5">
              <label className="block text-[12px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>
                {t('bodyStats.injuries')}
              </label>
              <p className="text-[12px] mb-3" style={{ color: "var(--color-text-muted)" }}>{t('bodyStats.injuriesHint')}</p>
              <div className="flex flex-wrap gap-2 mb-2">
                {INJURY_OPTIONS.map(inj => {
                  const active = data.injury_areas.includes(inj.value);
                  return (
                    <button
                      key={inj.value}
                      type="button"
                      onClick={() => toggleInjury(inj.value)}
                      aria-pressed={active}
                      className={`text-[13px] font-semibold px-3.5 py-2 rounded-full border transition-all ${
                        active
                          ? 'bg-red-500/15 border-red-500/40 text-red-400'
                          : 'bg-[var(--color-bg-card)] border-white/[0.06] text-[var(--color-text-subtle)] hover:border-white/16 hover:text-[var(--color-text-muted)]'
                      }`}
                    >
                      {t(`bodyStats.${inj.key}`)}
                    </button>
                  );
                })}
              </div>
              {data.injury_areas.length === 0 && (
                <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>{t('bodyStats.noneSelected')}</p>
              )}
              {data.injury_areas.length > 0 && (
                <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  {t('bodyStats.areasCount', { count: data.injury_areas.length })}
                </p>
              )}
            </div>

            {error && (
              <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4">
                <p className="text-[13px] text-red-400">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 7: DATA CONSENT / DISCLOSURE ── */}
        {step === 7 && (
          <div className="animate-fade-in">
            <div className="flex items-center gap-3 mb-1">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#D4AF37]/10 border border-[#D4AF37]/20 flex-shrink-0">
                <Shield size={20} className="text-[#D4AF37]" />
              </div>
              <div>
                <h2 className="text-[18px] font-semibold truncate" style={{ color: "var(--color-text-primary)" }}>{t('dataConsent.title')}</h2>
                <p className="text-[13px]" style={{ color: "var(--color-text-subtle)" }}>{t('dataConsent.subtitle')}</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 mt-6">
              {/* Health & Fitness */}
              <div className="flex items-start gap-3.5 bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3.5">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0 mt-0.5">
                  <Activity size={16} className="text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold mb-0.5" style={{ color: "var(--color-text-primary)" }}>
                    {i18n.language === 'es' ? 'Salud y Fitness' : 'Health & Fitness'}
                  </p>
                  <p className="text-[12px] leading-relaxed" style={{ color: "var(--color-text-subtle)" }}>{t('dataConsent.health')}</p>
                </div>
              </div>

              {/* Location */}
              <div className="flex items-start gap-3.5 bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3.5">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex-shrink-0 mt-0.5">
                  <MapPin size={16} className="text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold mb-0.5" style={{ color: "var(--color-text-primary)" }}>
                    {i18n.language === 'es' ? 'Ubicaci\u00f3n' : 'Location'}
                  </p>
                  <p className="text-[12px] leading-relaxed" style={{ color: "var(--color-text-subtle)" }}>{t('dataConsent.location')}</p>
                </div>
              </div>

              {/* Camera & Photos */}
              <div className="flex items-start gap-3.5 bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3.5">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex-shrink-0 mt-0.5">
                  <Camera size={16} className="text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold mb-0.5" style={{ color: "var(--color-text-primary)" }}>
                    {i18n.language === 'es' ? 'C\u00e1mara y Fotos' : 'Camera & Photos'}
                  </p>
                  <p className="text-[12px] leading-relaxed" style={{ color: "var(--color-text-subtle)" }}>{t('dataConsent.camera')}</p>
                </div>
              </div>

              {/* Analytics */}
              <div className="flex items-start gap-3.5 bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3.5">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#D4AF37]/10 border border-[#D4AF37]/20 flex-shrink-0 mt-0.5">
                  <BarChart3 size={16} className="text-[#D4AF37]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold mb-0.5" style={{ color: "var(--color-text-primary)" }}>
                    {i18n.language === 'es' ? 'An\u00e1litica' : 'Analytics'}
                  </p>
                  <p className="text-[12px] leading-relaxed" style={{ color: "var(--color-text-subtle)" }}>{t('dataConsent.analytics')}</p>
                </div>
              </div>
            </div>

            {/* Privacy policy link */}
            <div className="mt-5 text-center">
              <a
                href="https://tugympr.com/privacidad"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#D4AF37] hover:text-[#E6C766] transition-colors"
              >
                {t('dataConsent.privacyLink')} <ExternalLink size={13} />
              </a>
            </div>

            {/* Decline warning */}
            {consentDeclined && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 mt-4">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={15} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[12px] text-yellow-400 leading-relaxed">{t('dataConsent.declineWarning')}</p>
                    <button
                      type="button"
                      onClick={handleConsentDeclineContinue}
                      className="text-[12px] font-semibold text-yellow-400 hover:text-yellow-300 mt-2 transition-colors"
                    >
                      {t('common:continue')} &rarr;
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={handleConsentDecline}
                className="flex-1 flex items-center justify-center gap-1.5 px-5 py-3.5 rounded-xl border border-white/[0.06] hover:bg-white/[0.06] transition-colors duration-200 text-[14px] font-semibold"
                style={{ color: "var(--color-text-primary)" }}
              >
                {t('dataConsent.decline')}
              </button>
              <button
                type="button"
                onClick={handleConsentAgree}
                className="flex-1 flex items-center justify-center gap-1.5 bg-[#D4AF37] hover:bg-[#E6C766] text-black font-bold text-[14px] whitespace-nowrap py-3.5 rounded-xl transition-all"
              >
                {t('dataConsent.agree')}
              </button>
            </div>

            <p className="text-[11px] text-center mt-3" style={{ color: "var(--color-text-muted)" }}>
              {t('dataConsent.changeAnytime')}
            </p>
          </div>
        )}

        {/* ── STEP 8: HEALTH INTEGRATION ── */}
        {step === 8 && (
          <div className="animate-fade-in">
            <h2 className="text-[18px] font-semibold truncate mb-1" style={{ color: "var(--color-text-primary)" }}>{t('health.title')}</h2>
            <p className="text-[13px] mb-6" style={{ color: "var(--color-text-subtle)" }}>{t('health.subtitle')}</p>

            <Hint>{t('health.hint')}</Hint>

            {/* Platform illustration */}
            <div className="bg-white/[0.04] rounded-2xl border border-white/[0.06] p-6 mb-6 text-center overflow-hidden">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#D4AF37]/10 border border-[#D4AF37]/20 mb-4">
                <Heart size={28} className="text-[#D4AF37]" />
              </div>
              <p className="text-[15px] font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>
                {platform === 'web' ? t('health.webTitle') : healthPlatformName}
              </p>
              <p className="text-[12px] mb-5" style={{ color: "var(--color-text-subtle)" }}>
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
                    <span className="text-[10px] font-medium" style={{ color: "var(--color-text-subtle)" }}>{item.label}</span>
                  </div>
                ))}
              </div>

              {/* Connect button */}
              {platform !== 'web' && healthStatus !== 'linked' && (
                <button
                  type="button"
                  onClick={handleLinkHealth}
                  disabled={healthStatus === 'linking'}
                  className="w-full flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-50 text-black font-bold text-[14px] whitespace-nowrap py-3.5 rounded-xl transition-all"
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
                <div className="space-y-3">
                  <div className="flex items-center justify-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl py-3.5">
                    <Check size={18} className="text-emerald-400" />
                    <span className="text-[14px] font-semibold text-emerald-400">
                      {t('health.connected', { healthPlatformName })}
                    </span>
                  </div>

                  {/* Health data pre-fill summary */}
                  {Object.keys(healthPrefill).length > 0 && (
                    <div className="bg-[#D4AF37]/8 border border-[#D4AF37]/20 rounded-xl px-4 py-3">
                      <p className="text-[12px] font-semibold text-[#D4AF37] mb-2">{t('health.prefillTitle')}</p>
                      <div className="flex flex-wrap gap-2">
                        {healthPrefill.weight && (
                          <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-[#D4AF37]/10 text-[#D4AF37]">
                            {t('health.prefillWeight', { value: data.initial_weight_lbs })}
                          </span>
                        )}
                        {healthPrefill.height && (
                          <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-[#D4AF37]/10 text-[#D4AF37]">
                            {t('health.prefillHeight', { feet: data.height_feet, inches: data.height_inches })}
                          </span>
                        )}
                        {healthPrefill.age && (
                          <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-[#D4AF37]/10 text-[#D4AF37]">
                            {t('health.prefillAge', { value: data.age })}
                          </span>
                        )}
                        {healthPrefill.sex && (
                          <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-[#D4AF37]/10 text-[#D4AF37]">
                            {t('health.prefillSex', { value: t(`bodyStats.${data.sex}`) })}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-muted)' }}>{t('health.prefillHint')}</p>
                    </div>
                  )}
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

        {/* ── STEP 9: FIND YOUR GYM SQUAD (final step) ── */}
        {step === 9 && (
          <div className="animate-fade-in">
            <h2 className="text-[18px] font-semibold truncate mb-1" style={{ color: "var(--color-text-primary)" }}>{t('social.title')}</h2>
            <p className="text-[13px] mb-6" style={{ color: "var(--color-text-subtle)" }}>{t('social.subtitle')}</p>

            <Hint>{t('social.hint')}</Hint>

            {/* Social feed mockup */}
            <div className="mb-6">
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--color-text-muted)" }}>
                {t('social.feedPreview')}
              </p>
              <div className="flex flex-col gap-2.5">
                {/* Mock activity card 1 */}
                <div className="rounded-2xl border border-white/[0.06] px-4 py-3.5 flex items-start gap-3 overflow-hidden" style={{ backgroundColor: "var(--color-bg-card)" }}>
                  <div className="w-8 h-8 rounded-full bg-[#D4AF37]/20 border border-[#D4AF37]/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-[13px]">A</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-[13px] font-semibold" style={{ color: "var(--color-text-primary)" }}>Alex</p>
                      <p className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>{t('social.mockPR')}</p>
                      <span className="text-[13px] text-[#D4AF37] font-bold">PR</span>
                    </div>
                    <p className="text-[12px]" style={{ color: "var(--color-text-subtle)" }}>Bench Press — 225 lbs × 5 reps</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>{t('social.minAgo')}</span>
                      <span className="text-[11px]" style={{ color: "var(--color-text-subtle)" }}>👏 {t('social.nice')}</span>
                    </div>
                  </div>
                </div>

                {/* Mock activity card 2 */}
                <div className="rounded-2xl border border-white/[0.06] px-4 py-3.5 flex items-start gap-3 overflow-hidden" style={{ backgroundColor: "var(--color-bg-card)" }}>
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-[13px]">J</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-[13px] font-semibold" style={{ color: "var(--color-text-primary)" }}>Jordan</p>
                      <p className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>{t('social.mockSession')}</p>
                      <span className="text-[13px] text-[#D4AF37] font-bold">·</span>
                    </div>
                    <p className="text-[12px]" style={{ color: "var(--color-text-subtle)" }}>Upper Body — 14 sets · 42 min</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>{t('social.minAgo18')}</span>
                      <span className="text-[11px]" style={{ color: "var(--color-text-subtle)" }}>{t('social.crushIt')}</span>
                    </div>
                  </div>
                </div>

                {/* Mock activity card 3 */}
                <div className="rounded-2xl border border-white/[0.06] px-4 py-3.5 flex items-start gap-3 overflow-hidden" style={{ backgroundColor: "var(--color-bg-card)" }}>
                  <div className="w-8 h-8 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-[13px]">M</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-[13px] font-semibold" style={{ color: "var(--color-text-primary)" }}>Morgan</p>
                      <p className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>{t('social.mockStreak')}</p>
                      <p className="text-[13px] font-bold text-[#D4AF37]">{t('social.mockStreakDays')}</p>
                      <span className="text-[13px] text-[#D4AF37] font-bold">·</span>
                    </div>
                    <p className="text-[12px]" style={{ color: "var(--color-text-subtle)" }}>{t('social.mockStreakDesc')}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>{t('social.hrAgo')}</span>
                      <span className="text-[11px]" style={{ color: "var(--color-text-subtle)" }}>🙌 {t('social.insane')}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4">
                <p className="text-[13px] text-red-400">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Health disclaimer ── */}
        {step === TOTAL_STEPS - 1 && !showGeneratePlan && !showMealPlan && (
          <p className="text-[11px] text-center leading-relaxed mt-4" style={{ color: "var(--color-text-subtle)" }}>
            {t('disclaimer')}
          </p>
        )}

        {/* ── NAV BUTTONS (hidden on invite code step, data consent step, generate plan, and meal plan screens) ── */}
        {step > 0 && step !== 7 && !showGeneratePlan && !showMealPlan && (
        <div className="flex gap-3 mt-8">
          <button
            type="button"
            onClick={() => setStep(s => s - 1)}
            className="flex items-center gap-1.5 px-5 py-3.5 rounded-xl border border-white/[0.06] hover:bg-white/[0.06] transition-colors duration-200 text-[14px] font-semibold" style={{ color: "var(--color-text-primary)" }}
          >
            <ChevronLeft size={17} /> {t('common:back')}
          </button>

          {step < TOTAL_STEPS - 1 ? (
            <button
              type="button"
              onClick={() => setStep(s => s + 1)}
              disabled={!canAdvance()}
              className="flex-1 flex items-center justify-center gap-1.5 bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-30 disabled:cursor-not-allowed text-black font-bold text-[14px] whitespace-nowrap py-3.5 rounded-xl transition-all"
            >
              {t('common:continue')} <ChevronRight size={17} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold text-[14px] whitespace-nowrap py-3.5 rounded-xl transition-all"
            >
              {saving ? t('common:saving') : (
                <>{t('finish')} <ChevronRight size={17} /></>
              )}
            </button>
          )}
        </div>
        )}

        {/* Skip on body stats or health step (step 7 = data consent has its own buttons) */}
        {(step === 6 || step === 8) && !showGeneratePlan && !showMealPlan && (
          <button
            type="button"
            onClick={() => setStep(s => s + 1)}
            className="w-full text-center text-[12px] mt-3 py-2 transition-colors" style={{ color: "var(--color-text-muted)" }}
          >
            {step === 8 ? t('health.skip') : t('common:skip')}
          </button>
        )}

        {/* ── GENERATE PLAN: Ask screen ── */}
        {showGeneratePlan === 'ask' && (
          <div className="animate-fade-in flex flex-col items-center text-center gap-6 py-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#D4AF37]/15 border border-[#D4AF37]/25">
              <Sparkles size={28} className="text-[#D4AF37]" />
            </div>
            <div>
              <h2 className="text-[20px] font-bold mb-2" style={{ color: "var(--color-text-primary)" }}>
                {t('generatePlan.title')}
              </h2>
              <p className="text-[14px] leading-relaxed max-w-sm mx-auto" style={{ color: "var(--color-text-subtle)" }}>
                {t('generatePlan.desc')}
              </p>
            </div>

            {generateError && (
              <div role="alert" className="w-full bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                <p className="text-[13px] text-red-400 text-center">{generateError}</p>
              </div>
            )}

            <div className="w-full space-y-3">
              <button
                type="button"
                onClick={handleGeneratePlan}
                className="w-full flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#E6C766] text-black font-bold text-[14px] whitespace-nowrap py-3.5 rounded-xl transition-all"
              >
                <Sparkles size={16} /> {t('generatePlan.generate')}
              </button>
              <button
                type="button"
                onClick={handleSkipGeneratePlan}
                className="w-full text-center text-[13px] py-2.5 transition-colors" style={{ color: "var(--color-text-muted)" }}
              >
                {t('generatePlan.skip')}
              </button>
            </div>
          </div>
        )}

        {/* ── GENERATE PLAN: Generating screen ── */}
        {showGeneratePlan === 'generating' && (
          <div role="status" aria-live="polite" className="animate-fade-in flex flex-col items-center text-center gap-6 py-12">
            <Loader2 size={36} className="text-[#D4AF37] animate-spin" aria-hidden="true" />
            <p className="text-[15px] font-semibold" style={{ color: "var(--color-text-primary)" }}>
              {t('generatePlan.generating')}
            </p>
          </div>
        )}

        {/* ── GENERATE PLAN: Done screen ── */}
        {showGeneratePlan === 'done' && (
          <div className="animate-fade-in flex flex-col items-center text-center gap-6 py-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/25">
              <Check size={28} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-[20px] font-bold mb-2" style={{ color: "var(--color-text-primary)" }}>
                {t('generatePlan.ready')}
              </h2>
              <p className="text-[14px] leading-relaxed max-w-sm mx-auto" style={{ color: "var(--color-text-subtle)" }}>
                {t('generatePlan.readyDesc')}
              </p>
            </div>
            <button
              type="button"
              onClick={handlePlanDone}
              className="w-full max-w-xs flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#E6C766] text-black font-bold text-[14px] whitespace-nowrap py-3.5 rounded-xl transition-all"
            >
              {t('common:continue')} <ChevronRight size={17} />
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            MEAL PLAN FLOW (after workout plan)
            ══════════════════════════════════════════════════════ */}

        {/* ── MEAL PLAN: Ask screen ── */}
        {showMealPlan === 'ask' && (
          <div className="animate-fade-in flex flex-col items-center text-center gap-6 py-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/25">
              <UtensilsCrossed size={28} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-[20px] font-bold mb-2" style={{ color: "var(--color-text-primary)" }}>
                {t('mealPlan.askTitle')}
              </h2>
              <p className="text-[14px] leading-relaxed max-w-sm mx-auto" style={{ color: "var(--color-text-subtle)" }}>
                {t('mealPlan.askDesc')}
              </p>
            </div>

            <div className="w-full space-y-3">
              <button
                type="button"
                onClick={handleMealPlanPrefs}
                className="w-full flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#E6C766] text-black font-bold text-[14px] whitespace-nowrap py-3.5 rounded-xl transition-all"
              >
                <UtensilsCrossed size={16} /> {t('mealPlan.generate')}
              </button>
              <button
                type="button"
                onClick={handleSkipMealPlan}
                className="w-full text-center text-[13px] py-2.5 transition-colors" style={{ color: "var(--color-text-muted)" }}
              >
                {t('mealPlan.skip')}
              </button>
            </div>
          </div>
        )}

        {/* ── MEAL PLAN: Dietary Preferences screen ── */}
        {showMealPlan === 'prefs' && (
          <div className="animate-fade-in py-4">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/25 mb-3">
                <UtensilsCrossed size={22} className="text-emerald-400" />
              </div>
              <h2 className="text-[20px] font-bold mb-1" style={{ color: "var(--color-text-primary)" }}>
                {t('mealPlan.prefsTitle')}
              </h2>
              <p className="text-[13px]" style={{ color: "var(--color-text-subtle)" }}>
                {t('mealPlan.prefsSubtitle')}
              </p>
            </div>

            {/* Dietary restrictions */}
            <div className="mb-6">
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>
                {t('mealPlan.restrictionsLabel')}
              </p>
              <p className="text-[12px] mb-3" style={{ color: "var(--color-text-muted)" }}>
                {t('mealPlan.restrictionsHint')}
              </p>
              <div className="flex flex-wrap gap-2">
                {DIETARY_OPTIONS.map(opt => {
                  const active = dietaryRestrictions.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleRestriction(opt.value)}
                      aria-pressed={active}
                      className={`text-[13px] font-semibold px-3.5 py-2 rounded-full border transition-all ${
                        active
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                          : 'bg-[var(--color-bg-card)] border-white/[0.06] text-[var(--color-text-subtle)] hover:border-white/16'
                      }`}
                    >
                      {t(`mealPlan.${opt.key}`)}
                    </button>
                  );
                })}
              </div>
              {dietaryRestrictions.length === 0 && (
                <p className="text-[11px] mt-2" style={{ color: "var(--color-text-muted)" }}>{t('mealPlan.none')}</p>
              )}
            </div>

            {/* Food allergies */}
            <div className="mb-6">
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>
                {t('mealPlan.allergiesLabel')}
              </p>
              <p className="text-[12px] mb-3" style={{ color: "var(--color-text-muted)" }}>
                {t('mealPlan.allergiesHint')}
              </p>
              <div className="flex flex-wrap gap-2">
                {ALLERGY_OPTIONS.map(opt => {
                  const active = foodAllergies.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleAllergy(opt.value)}
                      aria-pressed={active}
                      className={`text-[13px] font-semibold px-3.5 py-2 rounded-full border transition-all ${
                        active
                          ? 'bg-red-500/15 border-red-500/40 text-red-400'
                          : 'bg-[var(--color-bg-card)] border-white/[0.06] text-[var(--color-text-subtle)] hover:border-white/16'
                      }`}
                    >
                      {t(`mealPlan.${opt.key}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Disliked ingredients */}
            <div className="mb-6">
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>
                {t('mealPlan.dislikesLabel')}
              </p>
              <p className="text-[12px] mb-3" style={{ color: "var(--color-text-muted)" }}>
                {t('mealPlan.dislikesHint')}
              </p>

              {/* Search */}
              <div className="relative mb-3">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-text-muted)" }} />
                <input
                  type="text"
                  value={ingredientSearch}
                  onChange={e => setIngredientSearch(e.target.value)}
                  placeholder={t('mealPlan.dislikePlaceholder')}
                  aria-label={t('mealPlan.dislikesLabel')}
                  className="w-full bg-[var(--color-bg-input)] border border-white/[0.06] rounded-xl pl-9 pr-4 py-2.5 text-[13px] placeholder-[var(--color-text-muted)] focus:ring-2 focus:ring-emerald-500/40 focus:outline-none transition-colors"
                  style={{ color: "var(--color-text-primary)" }}
                />
                {ingredientSearch && (
                  <button
                    type="button"
                    onClick={() => setIngredientSearch('')}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                  >
                    <X size={14} style={{ color: "var(--color-text-muted)" }} />
                  </button>
                )}
              </div>

              {/* Selected dislikes chips */}
              {dislikedIngredients.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {dislikedIngredients.map(ing => (
                    <button
                      key={ing}
                      type="button"
                      onClick={() => toggleDislike(ing)}
                      aria-label={`Remove ${formatIngredient(ing)} from dislikes`}
                      className="flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 transition-all hover:bg-red-500/25"
                    >
                      {formatIngredient(ing)} <X size={12} />
                    </button>
                  ))}
                </div>
              )}

              {/* Ingredient grid */}
              <div className="flex flex-wrap gap-2 max-h-[160px] overflow-y-auto">
                {filteredCommonIngredients
                  .filter(i => !dislikedIngredients.includes(i))
                  .map(ing => (
                    <button
                      key={ing}
                      type="button"
                      onClick={() => toggleDislike(ing)}
                      className="text-[12px] font-medium px-3 py-1.5 rounded-full bg-[var(--color-bg-card)] border border-white/[0.06] text-[var(--color-text-subtle)] hover:border-white/16 transition-all"
                    >
                      {formatIngredient(ing)}
                    </button>
                  ))}
              </div>
              <p className="text-[11px] mt-2" style={{ color: "var(--color-text-muted)" }}>
                {dislikedIngredients.length > 0
                  ? t('mealPlan.selectedDislikes', { count: dislikedIngredients.length })
                  : t('mealPlan.noDislikes')}
              </p>
            </div>

            {/* Available meals count */}
            <div className={`rounded-xl px-4 py-3 mb-5 border ${
              availableMealCount < 30
                ? 'bg-yellow-500/8 border-yellow-500/20'
                : 'bg-emerald-500/8 border-emerald-500/20'
            }`}>
              <div className="flex items-center gap-2">
                {availableMealCount < 30 && <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0" />}
                <p className={`text-[13px] font-semibold ${
                  availableMealCount < 30 ? 'text-yellow-400' : 'text-emerald-400'
                }`}>
                  {t('mealPlan.mealsAvailable', { count: availableMealCount })}
                </p>
              </div>
              {availableMealCount < 30 && (
                <p className="text-[12px] mt-1" style={{ color: "var(--color-text-muted)" }}>
                  {t('mealPlan.tooFewMeals')}
                </p>
              )}
            </div>

            {mealPlanError && (
              <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4">
                <p className="text-[13px] text-red-400 text-center">{mealPlanError}</p>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowMealPlan('ask')}
                className="flex items-center gap-1.5 px-5 py-3.5 rounded-xl border border-white/[0.06] hover:bg-white/[0.06] transition-colors duration-200 text-[14px] font-semibold"
                style={{ color: "var(--color-text-primary)" }}
              >
                <ChevronLeft size={17} /> {t('common:back')}
              </button>
              <button
                type="button"
                onClick={handleGenerateMealPlan}
                disabled={availableMealCount < 10}
                className="flex-1 flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-30 disabled:cursor-not-allowed text-black font-bold text-[14px] whitespace-nowrap py-3.5 rounded-xl transition-all"
              >
                <UtensilsCrossed size={16} /> {t('mealPlan.continueToGenerate')}
              </button>
            </div>
          </div>
        )}

        {/* ── MEAL PLAN: Generating screen ── */}
        {showMealPlan === 'generating' && (
          <div role="status" aria-live="polite" className="animate-fade-in flex flex-col items-center text-center gap-6 py-12">
            <Loader2 size={36} className="text-emerald-400 animate-spin" aria-hidden="true" />
            <p className="text-[15px] font-semibold" style={{ color: "var(--color-text-primary)" }}>
              {t('mealPlan.generating')}
            </p>
          </div>
        )}

        {/* ── MEAL PLAN: Done screen ── */}
        {showMealPlan === 'done' && (
          <div className="animate-fade-in flex flex-col items-center text-center gap-5 py-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/25">
              <Check size={28} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-[20px] font-bold mb-2" style={{ color: "var(--color-text-primary)" }}>
                {t('mealPlan.ready')}
              </h2>
              <p className="text-[14px] leading-relaxed max-w-sm mx-auto mb-2" style={{ color: "var(--color-text-subtle)" }}>
                {t('mealPlan.readyDesc')}
              </p>
              {mealPlanMacros && (
                <p className="text-[12px] font-medium" style={{ color: "var(--color-text-muted)" }}>
                  {t('mealPlan.readyMacros', {
                    calories: mealPlanMacros.calories,
                    protein: mealPlanMacros.protein,
                    carbs: mealPlanMacros.carbs,
                    fat: mealPlanMacros.fat,
                  })}
                </p>
              )}
            </div>

            {/* Preview: 7-day plan summary */}
            {generatedMealPlan && (
              <div className="w-full space-y-2 text-left max-h-[240px] overflow-y-auto">
                {generatedMealPlan.map((day, idx) => (
                  <div key={idx} className="rounded-xl border border-white/[0.06] px-4 py-3" style={{ backgroundColor: "var(--color-bg-card)" }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[13px] font-bold" style={{ color: "var(--color-text-primary)" }}>
                        {t('mealPlan.dayLabel', { day: idx + 1 })}
                      </p>
                      <p className="text-[11px] font-medium" style={{ color: "var(--color-text-muted)" }}>
                        {day.totals.calories} cal · {day.totals.protein}g P
                      </p>
                    </div>
                    <div className="flex flex-col gap-1">
                      {day.meals.map((meal, mi) => (
                        <p key={mi} className="text-[12px] truncate" style={{ color: "var(--color-text-subtle)" }}>
                          {data.language === 'es' && meal.title_es ? meal.title_es : meal.title}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={handleMealPlanDone}
              className="w-full max-w-xs flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#E6C766] text-black font-bold text-[14px] whitespace-nowrap py-3.5 rounded-xl transition-all mt-2"
            >
              {t('mealPlan.goToDashboard')} <ChevronRight size={17} />
            </button>
          </div>
        )}

      </div>
    </main>
  );
};

export default Onboarding;
