import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ArrowRight, Check, Heart, Flame, Dumbbell, Zap,
  Sun, Sunrise, Moon, Sparkles, Trophy, Pin, Camera, Activity,
  Shield, BarChart3, Gift, X, Users, AlertTriangle, Loader2,
  UtensilsCrossed, Search, ExternalLink, Sprout, Smartphone,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePostHog } from '@posthog/react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Capacitor } from '@capacitor/core';
import { isAvailable as healthAvailable, requestPermissions as healthRequest, readLatestWeight, readHeight } from '../lib/healthSync';
import { generateProgram } from '../lib/workoutGenerator';
import { generateProgramName, generateRoutineName } from '../lib/programNaming';
import { calculateMacros } from '../lib/macroCalculator';
import { generateWeekPlan } from '../lib/mealPlanner';
// MEALS (~280 KB raw across 6 meal-category files) is lazy-loaded on first
// mount of Onboarding. Eager-importing it here was the single biggest hit on
// app cold-start TTI for returning users who never go through onboarding.
import { isMealAllergenSafe, isMealDietaryCompliant } from '../lib/mealPreferences';
let mealsCache = null;
const loadMeals = async () => {
  if (mealsCache) return mealsCache;
  const mod = await import('../data/meals');
  mealsCache = mod.MEALS;
  return mealsCache;
};
import { getExerciseById } from '../data/exercises';
import { foodImageUrl } from '../lib/imageUrl';
import RewardPicker from '../components/RewardPicker';

// ── DESIGN TOKENS ──────────────────────────────────────────
// Warm-paper onboarding system. Onboarding runs BEFORE gym branding applies,
// so we use literal hex values — NOT CSS variables.
const OB = {
  bg:          '#f0eee9',
  surface:     '#ffffff',
  surface2:    '#e8e5de',
  ink:         '#0B0F12',
  sub:         '#6B6A63',
  mute:        '#9A988E',
  line:        'rgba(11,15,18,0.08)',
  lineStrong:  'rgba(11,15,18,0.14)',
  teal:        '#2EC4C4',
  tealDeep:    '#0FA5A5',
  tealSoft:    '#D7F1F1',
  orange:      '#FF5A2E',
  orangeSoft:  '#FBE0D3',
  purple:      '#6D5FDB',
  purpleSoft:  '#E0DCF5',
  gold:        '#E8C547',
  goldSoft:    '#F6ECB6',
  green:       '#5EAA5E',
  greenSoft:   '#DDEBD6',
  shadow:      '0 1px 2px rgba(11,15,18,0.04), 0 6px 18px rgba(11,15,18,0.05)',
  shadowLg:    '0 2px 4px rgba(11,15,18,0.05), 0 16px 40px rgba(11,15,18,0.08)',
};

const OB_FONT = {
  display: '"Archivo", "Familjen Grotesk", system-ui, sans-serif',
  body:    '"Familjen Grotesk", -apple-system, system-ui, sans-serif',
  mono:    '"SF Mono", ui-monospace, monospace',
};

// ── PRIMITIVES ─────────────────────────────────────────────

// Dark monogram logo with gold "G"
const OBLogo = ({ size = 52 }) => (
  <div style={{
    width: size, height: size, borderRadius: size * 0.28,
    background: 'radial-gradient(circle at 35% 28%, #262a30 0%, #0a0c0f 100%)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '1.5px solid #1a1d22',
    boxShadow: '0 6px 18px rgba(10,12,15,0.22), inset 0 1px 0 rgba(255,255,255,0.08)',
    flexShrink: 0,
  }}>
    <div style={{
      width: size * 0.58, height: size * 0.58, borderRadius: '50%',
      border: `2.2px solid ${OB.gold}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: OB.gold, fontFamily: OB_FONT.display, fontWeight: 900,
      fontSize: size * 0.32, letterSpacing: -0.5,
    }}>G</div>
  </div>
);

// 54px pill CTA
const OBButton = ({ children, tone = 'teal', full = false, icon, onClick, disabled, type = 'button', style = {} }) => {
  const tones = {
    teal:  { bg: OB.teal,     fg: '#0A2A2A' },
    dark:  { bg: OB.ink,      fg: '#fff' },
    ghost: { bg: 'transparent', fg: OB.ink },
    soft:  { bg: OB.tealSoft, fg: OB.tealDeep },
  };
  const x = tones[tone] || tones.teal;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 54, padding: '0 22px', borderRadius: 999, border: 'none',
        background: disabled ? OB.tealSoft : x.bg,
        color: disabled ? OB.mute : x.fg,
        fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 16,
        letterSpacing: -0.2,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        width: full ? '100%' : undefined,
        boxShadow: tone === 'teal' && !disabled ? '0 6px 16px rgba(46,196,196,0.28)' : 'none',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'transform 120ms ease, box-shadow 120ms ease',
        ...style,
      }}
    >
      {icon}{children}
    </button>
  );
};

// Step progress bar: teal label + mono count + 6px gradient bar
const OBProgress = ({ label, step, total }) => {
  const pct = Math.max(0, Math.min(100, Math.round((step / total) * 100)));
  return (
    <div style={{ padding: '0 0 16px' }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <div style={{
          fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 13,
          color: OB.teal, letterSpacing: 0.4, textTransform: 'uppercase',
        }}>{label}</div>
        <div style={{
          fontFamily: OB_FONT.mono, fontSize: 12, color: OB.sub,
          fontVariantNumeric: 'tabular-nums',
        }}>{step} / {total}</div>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: OB.surface2, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: `linear-gradient(90deg, ${OB.teal} 0%, ${OB.tealDeep} 100%)`,
          borderRadius: 3,
          transition: 'width 300ms ease',
        }}/>
      </div>
    </div>
  );
};

// Title + subtitle (30px Archivo 900)
const OBHeading = ({ title, sub }) => (
  <div style={{ paddingBottom: 18 }}>
    <div style={{
      fontFamily: OB_FONT.display, fontWeight: 900,
      fontSize: 28, color: OB.ink, letterSpacing: -1.2, lineHeight: 1.05,
    }}>{title}</div>
    {sub && <div style={{
      fontSize: 14, color: OB.sub, marginTop: 8, lineHeight: 1.4,
    }}>{sub}</div>}
  </div>
);

// Selectable option row with icon tile
const OBOption = ({ title, sub, icon, iconBg, iconFg, selected, badge, onClick, tall = false, disabled }) => (
  <button
    type="button"
    onClick={disabled ? undefined : onClick}
    aria-pressed={selected}
    style={{
      width: '100%',
      background: selected ? '#fff' : OB.surface,
      border: `1.5px solid ${selected ? OB.teal : OB.line}`,
      borderRadius: 18, padding: tall ? '16px 16px' : '14px 16px',
      display: 'flex', alignItems: 'center', gap: 14,
      boxShadow: selected ? '0 0 0 4px rgba(46,196,196,0.12)' : OB.shadow,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      position: 'relative', textAlign: 'left',
      transition: 'all 150ms ease',
    }}
  >
    {icon && (
      <div style={{
        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
        background: iconBg || OB.surface2,
        color: iconFg || OB.ink,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</div>
    )}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{
          fontFamily: OB_FONT.display, fontWeight: 700, fontSize: 16,
          color: OB.ink, letterSpacing: -0.3,
        }}>{title}</div>
        {badge && (
          <span style={{
            padding: '2px 8px', borderRadius: 999, background: OB.surface2,
            color: OB.sub, fontSize: 10, fontWeight: 700,
            letterSpacing: 0.4, textTransform: 'uppercase',
          }}>{badge}</span>
        )}
      </div>
      {sub && <div style={{
        fontSize: 13, color: OB.sub, marginTop: 2, lineHeight: 1.35,
      }}>{sub}</div>}
    </div>
    {selected && (
      <div style={{
        width: 22, height: 22, borderRadius: 999, background: OB.teal,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Check size={12} strokeWidth={3.5} color="#0A2A2A" />
      </div>
    )}
  </button>
);

// 40px pill chip (teal or orange variant)
const OBChip = ({ children, selected, tone = 'teal', onClick, icon, disabled }) => {
  const tones = {
    teal:   { bg: OB.teal,   fg: '#0A2A2A' },
    orange: { bg: OB.orange, fg: '#fff' },
  };
  const x = tones[tone] || tones.teal;
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-pressed={selected}
      disabled={disabled}
      style={{
        height: 40, padding: '0 16px', borderRadius: 999,
        border: `1.5px solid ${selected ? x.bg : OB.lineStrong}`,
        background: selected ? x.bg : 'transparent',
        color: selected ? x.fg : OB.ink,
        fontFamily: OB_FONT.body, fontWeight: 700, fontSize: 14,
        letterSpacing: -0.2,
        display: 'inline-flex', alignItems: 'center', gap: 7,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 120ms ease',
      }}
    >
      {icon}{children}
    </button>
  );
};

// 11px uppercase letterspaced label
const OBLabel = ({ children, badge }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 11, fontWeight: 800, color: OB.sub,
    letterSpacing: 0.6, textTransform: 'uppercase',
    marginBottom: 8,
  }}>
    {children}{badge}
  </div>
);

// 54px input with icon
const OBInput = ({ placeholder, value, onChange, icon, right, monospace, type = 'text', inputMode, maxLength, min, max, step, disabled, autoCapitalize }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 10,
    height: 54, padding: '0 16px', borderRadius: 14,
    background: OB.surface, border: `1.5px solid ${OB.line}`,
  }}>
    {icon && <span style={{ color: OB.mute, display: 'flex', flexShrink: 0 }}>{icon}</span>}
    <input
      type={type}
      inputMode={inputMode}
      value={value ?? ''}
      onChange={onChange}
      placeholder={placeholder}
      maxLength={maxLength}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      autoCapitalize={autoCapitalize}
      style={{
        flex: 1,
        background: 'transparent', border: 'none', outline: 'none',
        fontFamily: monospace ? OB_FONT.mono : OB_FONT.body,
        fontSize: 16, color: OB.ink,
        letterSpacing: monospace ? 0.5 : -0.2,
        fontWeight: value ? 600 : 400,
        width: '100%', minWidth: 0,
      }}
    />
    {right}
  </div>
);

// Bottom CTA bar. Renders OUTSIDE the scroll body (as a flex sibling of the
// scroller in the page chrome), so it's auto-pinned to the bottom of the
// keyboard-aware viewport. No `position: sticky` needed — the scroll body
// owns the overflow and this row sits below it natively.
const OBBottomBar = ({ children }) => (
  <div style={{
    flexShrink: 0,
    padding: '14px 0 8px',
    marginTop: 8,
    background: OB.bg,
    display: 'flex', alignItems: 'center', gap: 12,
  }}>
    {children}
  </div>
);

// Compact step header (logo + "Let's set you up" + progress + title + sub)
const OBStepHead = ({ label, step, total, title, sub, onBack, rightAction, t }) => (
  <div>
    {/* Top bar: back + optional right action */}
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '4px 0', height: 44, marginBottom: 4,
    }}>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label={t ? t('common:back') : 'Back'}
          style={{
            width: 40, height: 40, borderRadius: 999, border: 'none',
            background: 'transparent', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <ChevronLeft size={22} color={OB.ink} strokeWidth={2.2} />
        </button>
      ) : <div style={{ width: 40 }}/>}
      {rightAction || <div style={{ width: 40 }}/>}
    </div>

    {/* Logo + "Let's set you up" */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
      <OBLogo size={40}/>
      <div>
        <div style={{
          fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 16,
          color: OB.ink, letterSpacing: -0.3,
        }}>
          {t ? t('stepHead.lets', "Let's set you up") : "Let's set you up"}
        </div>
        <div style={{ fontSize: 12, color: OB.sub }}>
          {t ? t('stepHead.takes', 'Takes 2 minutes · you can edit later') : 'Takes 2 minutes · you can edit later'}
        </div>
      </div>
    </div>

    <OBProgress label={label} step={step} total={total}/>

    {title && (
      <div style={{ paddingTop: 8, paddingBottom: 4 }}>
        <div style={{
          fontFamily: OB_FONT.display, fontWeight: 900, fontSize: 28,
          letterSpacing: -1.2, color: OB.ink, lineHeight: 1.05,
        }}>{title}</div>
        {sub && <div style={{ fontSize: 14, color: OB.sub, marginTop: 6, lineHeight: 1.4 }}>{sub}</div>}
      </div>
    )}
  </div>
);

// ── DATA ───────────────────────────────────────────────────

const FITNESS_LEVELS = [
  { value: 'beginner',     key: 'beginner',     icon: Sprout, iconBg: OB.greenSoft, iconFg: OB.green,    badgeKey: 'badge' },
  { value: 'intermediate', key: 'intermediate', icon: Zap,    iconBg: OB.tealSoft,  iconFg: OB.tealDeep, badgeKey: 'badge' },
  { value: 'advanced',     key: 'advanced',     icon: Trophy, iconBg: OB.goldSoft,  iconFg: '#9a7e00',   badgeKey: 'badge' },
];

const GOALS = [
  { value: 'muscle_gain',     key: 'muscle_gain',     icon: Dumbbell, iconBg: OB.orangeSoft, iconFg: OB.orange },
  { value: 'fat_loss',        key: 'fat_loss',        icon: Flame,    iconBg: OB.orangeSoft, iconFg: OB.orange },
  { value: 'strength',        key: 'strength',        icon: Zap,      iconBg: OB.purpleSoft, iconFg: OB.purple },
  { value: 'endurance',       key: 'endurance',       icon: Heart,    iconBg: OB.tealSoft,   iconFg: OB.tealDeep },
  { value: 'general_fitness', key: 'general_fitness', icon: Activity, iconBg: OB.greenSoft,  iconFg: OB.green },
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

const SHORT_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const TIME_PREFERENCES = [
  { value: 'morning',   key: 'morning',   subKey: 'morningSub',   icon: Sunrise },
  { value: 'afternoon', key: 'afternoon', subKey: 'afternoonSub', icon: Sun },
  { value: 'evening',   key: 'evening',   subKey: 'eveningSub',   icon: Moon },
];

// Returns a pre-selected set of day keys based on training frequency.
function getDefaultDays(freq, closedDays) {
  const allDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const openDays = closedDays ? allDays.filter(d => !closedDays.has(d)) : allDays;
  if (freq >= openDays.length) return openDays;
  const step = openDays.length / freq;
  const result = [];
  for (let i = 0; i < freq; i++) {
    result.push(openDays[Math.round(i * step)]);
  }
  return result;
}

const CORE_STEPS = 11;   // steps 0-10: invite → social (phone inserted at step 9)
const TOTAL_STEPS = 13;  // + step 11 (Program) + step 12 (Nutrition)

// Step labels (for OB progress "SECTION" tag) + analytics names. The labels
// here are i18n keys (under the `onboarding.stepLabels.*` namespace) — kept
// in array order so STEP_LABELS[step] continues to work.
const STEP_LABEL_KEYS = ['invite', 'language', 'level', 'goal', 'training', 'schedule', 'privacy', 'health', 'body', 'phone', 'squad', 'program', 'nutrition'];
const STEP_LABELS = STEP_LABEL_KEYS.map(k => `stepLabels.${k}`);
const STEP_NAMES  = ['invite', 'language', 'fitness_level', 'goal', 'equipment', 'schedule', 'data_consent', 'health_sync', 'body_stats', 'phone', 'social', 'program', 'nutrition'];

// ── MAIN COMPONENT ─────────────────────────────────────────
const Onboarding = () => {
  const { user, refreshProfile, profile } = useAuth();
  const navigate = useNavigate();
  const { t, i18n, ready: i18nReady } = useTranslation(['onboarding', 'common']);
  const posthog = usePostHog();

  // Fetch gym hours + equipment for schedule/equipment steps
  const [gymHours, setGymHours] = useState([]);
  const [gymName, setGymName] = useState('');
  useEffect(() => {
    const gymId = profile?.gym_id;
    if (!gymId) return;
    supabase.from('gym_hours').select('day_of_week, open_time, close_time, is_closed')
      .eq('gym_id', gymId)
      .then(({ data }) => { if (data) setGymHours(data); });
    supabase.from('gyms').select('name, available_equipment').eq('id', gymId).maybeSingle()
      .then(({ data: gym }) => {
        if (gym?.name) setGymName(gym.name);
        if (gym?.available_equipment?.length > 0) {
          setData(d => {
            const isDefault = JSON.stringify([...d.available_equipment].sort()) === JSON.stringify(['Barbell', 'Bodyweight', 'Cable', 'Dumbbell', 'Machine'].sort());
            if (isDefault) return { ...d, available_equipment: gym.available_equipment };
            return d;
          });
        }
      });
  }, [profile?.gym_id]);

  // ── Restore onboarding draft from localStorage ──
  // Two keys are used:
  //   - DRAFT_KEY (legacy): step + data only. Kept for back-compat with users
  //     mid-flight when this change ships.
  //   - PERSIST_KEY (new): step + data + dietary/allergies/dislikes +
  //     lastUpdated timestamp. Used as the source of truth on hydration when
  //     fresh (<24h). Cleared on successful completion.
  // NOTE: savedDraft must be declared BEFORE any useEffect that reads it in
  // its dependency array — otherwise the deps tuple hits a TDZ during render.
  const DRAFT_KEY   = 'onboarding_draft';
  const PERSIST_KEY = 'tugympr_onboarding_state';
  const PERSIST_TTL_MS = 24 * 60 * 60 * 1000; // 24h

  const savedPersist = useMemo(() => {
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const ts = Number(parsed.lastUpdated) || 0;
      if (!ts || Date.now() - ts > PERSIST_TTL_MS) {
        try { localStorage.removeItem(PERSIST_KEY); } catch {}
        return null;
      }
      return parsed;
    } catch {
      try { localStorage.removeItem(PERSIST_KEY); } catch {}
      return null;
    }
  }, []);

  const savedDraft = useMemo(() => {
    if (savedPersist) {
      return { step: savedPersist.step, data: savedPersist.data };
    }
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, [savedPersist]);

  // Pre-fill onboarding from any profile fields the gym already set when
  // creating the account (CreateInviteModal). Runs once when no local draft
  // exists, so it doesn't clobber a user who's mid-onboarding.
  // Only fields still at their default value are seeded.
  const profilePrefillRanRef = useRef(false);
  useEffect(() => {
    if (profilePrefillRanRef.current) return;
    if (!user?.id) return;
    if (savedDraft) return; // user has an in-progress draft — don't overwrite
    profilePrefillRanRef.current = true;

    supabase
      .from('profiles')
      .select('fitness_level, primary_goal, training_days_per_week, height_inches, initial_weight_lbs, age, sex')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data: row }) => {
        if (!row) return;
        setData(d => {
          const next = { ...d };
          if (row.fitness_level && !d.fitness_level) next.fitness_level = row.fitness_level;
          if (row.primary_goal && !d.primary_goal) next.primary_goal = row.primary_goal;
          if (row.training_days_per_week && d.training_days_per_week === 4) {
            next.training_days_per_week = row.training_days_per_week;
            next.preferred_training_days = getDefaultDays(row.training_days_per_week);
          }
          if (row.height_inches && !d.height_inches) {
            const ft = Math.floor(row.height_inches / 12);
            const inch = row.height_inches % 12;
            next.height_feet = String(ft);
            next.height_inches = String(inch);
          }
          if (row.initial_weight_lbs && !d.initial_weight_lbs) next.initial_weight_lbs = String(row.initial_weight_lbs);
          if (row.age && !d.age) next.age = String(row.age);
          if (row.sex && !d.sex) next.sex = row.sex;
          return next;
        });
      });
  }, [user?.id, savedDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guard: wait for i18n translations to load before rendering
  if (!i18nReady) return null;

  // Skip Step 0 (invite code) if user already has gym attached.
  const initialStep = (() => {
    const draft = savedDraft?.step ?? 0;
    if (draft === 0 && profile?.gym_id) return 1;
    return draft;
  })();
  const [step, setStep]     = useState(initialStep);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [onboardingDone, setOnboardingDone] = useState(false);
  // MEALS data — lazy-loaded on mount so the meal preview / allergy step has it
  // ready by the time the user reaches them, but the boot bundle stays slim.
  const [MEALS, setMEALSState] = useState(() => mealsCache || []);
  useEffect(() => {
    if (mealsCache) return;
    loadMeals().then(setMEALSState).catch(() => {});
  }, []);

  // Invite code state
  const [inviteCode, setInviteCode] = useState(() => {
    try { return localStorage.getItem('pendingInviteCode') || ''; } catch { return ''; }
  });
  const [inviteStatus, setInviteStatus] = useState(() => profile?.gym_id ? 'success' : 'idle');
  const [showRewardPicker, setShowRewardPicker] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [referredRewardId, setReferredRewardId] = useState(null);
  const [inviteError, setInviteError] = useState('');

  const defaultData = {
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
    workout_duration_min:       60,
    has_workout_buddy:          null,
    workout_buddy_username:     '',
    health_linked:              false,
    known_maxes:                { ex_bp: '', ex_sq: '', ex_dl: '', ex_ohp: '' },
    // false = English (lb, ft/in), true = International (kg, cm). Drives the
    // display of the body-stats inputs and is persisted to `profiles.metric_units`
    // at finish so the whole app respects the user's preference. Switchable
    // later from Personal Info.
    metric_units:               false,
  };

  const [data, setData] = useState(savedDraft?.data ? { ...defaultData, ...savedDraft.data } : defaultData);

  // Phone step state (skippable). Normalized at handleFinish into '+ccDigits + localDigits'
  // and saved to profiles.phone_number. Empty string if user skips.
  const [phoneCountryCode, setPhoneCountryCode] = useState(savedDraft?.data?.phoneCountryCode || '+1');
  const [phoneNumber, setPhoneNumber] = useState(savedDraft?.data?.phoneNumber || '');

  // Diet preferences — declared BEFORE the persistence useEffect below that
  // captures them in its deps array. Declaring them later (was lines 616-624)
  // caused a Temporal Dead Zone "Cannot access uninitialized variable" crash
  // when the effect was scheduled before these hooks ran.
  const [dietaryRestrictions, setDietaryRestrictions] = useState(() =>
    Array.isArray(savedPersist?.dietaryRestrictions) ? savedPersist.dietaryRestrictions : []
  );
  const [foodAllergies, setFoodAllergies] = useState(() =>
    Array.isArray(savedPersist?.foodAllergies) ? savedPersist.foodAllergies : []
  );
  const [dislikedIngredients, setDislikedIngredients] = useState(() =>
    Array.isArray(savedPersist?.dislikedIngredients) ? savedPersist.dislikedIngredients : []
  );

  // Persist draft (legacy key — kept for back-compat)
  useEffect(() => {
    if (onboardingDone || step >= CORE_STEPS) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, data: { ...data, phoneCountryCode, phoneNumber } }));
    } catch {}
  }, [step, data, phoneCountryCode, phoneNumber, onboardingDone]);

  // Persist full onboarding state to PERSIST_KEY (debounced 300ms).
  // Survives back navigation, tab/app backgrounding, and refreshes for 24h.
  // Cleared on successful onboarding completion (handleSkipMealPlan /
  // handleMealPlanDone) and skipped while step >= CORE_STEPS (post-finish flow) or
  // when onboardingDone has flipped.
  const persistTimerRef = useRef(null);
  useEffect(() => {
    if (onboardingDone) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(PERSIST_KEY, JSON.stringify({
          step,
          data: { ...data, phoneCountryCode, phoneNumber },
          dietaryRestrictions,
          foodAllergies,
          dislikedIngredients,
          lastUpdated: Date.now(),
        }));
      } catch {}
    }, 300);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [step, data, phoneCountryCode, phoneNumber, dietaryRestrictions, foodAllergies, dislikedIngredients, onboardingDone]);

  // Skip Step 0 once profile loads
  useEffect(() => {
    if (step === 0 && profile?.gym_id) {
      setStep(1);
    }
  }, [profile?.gym_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill workout buddy from referral
  const [referrerBuddy, setReferrerBuddy] = useState(() => {
    try {
      const raw = localStorage.getItem('referrer_buddy');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  useEffect(() => {
    if (referrerBuddy?.name && !data.workout_buddy_username) {
      setData(d => ({
        ...d,
        has_workout_buddy: true,
        workout_buddy_username: referrerBuddy.name,
      }));
    }
  }, [referrerBuddy]); // eslint-disable-line react-hooks/exhaustive-deps

  // Plan + meal plan state
  const [showGeneratePlan, setShowGeneratePlan] = useState(false);
  const [generateError, setGenerateError] = useState('');
  // Variant-A routines (the default rotation). The preview also shows
  // variant B by toggling `previewWeekIdx` — both arrays are stored on the
  // plan cache so the preview can flip without re-generating.
  const [generatedRoutines, setGeneratedRoutines] = useState([]);
  const [generatedRoutinesB, setGeneratedRoutinesB] = useState([]);
  const [previewRoutineIdx, setPreviewRoutineIdx] = useState(0);
  // 0-indexed week number across the full 12-week program (so 0..11).
  // The program itself is a 2-variant rotation (A/B) so the displayed
  // routines come from `generatedRoutines` (Variant A) on even indices and
  // `generatedRoutinesB` on odd ones — but exposing all 12 weeks lets the
  // user see the program they were promised in the meta line, not just
  // "Week A / Week B".
  const [previewWeekIdx, setPreviewWeekIdx] = useState(0);

  const [showMealPlan, setShowMealPlan] = useState(false);
  const [mealPlanError, setMealPlanError] = useState('');
  // dietaryRestrictions / foodAllergies / dislikedIngredients moved up — see
  // declarations near the top of the component (above the persistence useEffect).
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [generatedMealPlan, setGeneratedMealPlan] = useState(null);
  const [mealPlanMacros, setMealPlanMacros] = useState(null);
  const [previewDayIdx, setPreviewDayIdx] = useState(0);

  // ── BACKGROUND PRELOAD CACHES ─────────────────────────────────
  // Each ref holds { key, promise, result, error } — key is a JSON
  // signature of the inputs. When inputs change we invalidate + restart.
  const planCacheRef = useRef({ key: null, promise: null, result: null, error: null });
  const mealPlanCacheRef = useRef({ key: null, promise: null, result: null, error: null });

  // Snapshot builders — capture current inputs at call time. Used for both
  // background preload and fallback fresh-run inside the click handler.
  const buildPlanSnapshot = () => ({
    fitness_level: data.fitness_level,
    primary_goal: data.primary_goal,
    training_days_per_week: data.training_days_per_week,
    available_equipment: data.available_equipment,
    injury_areas: data.injury_areas,
    sex: data.sex,
    age: data.age,
    workout_duration_min: data.workout_duration_min,
    preferred_training_days: data.preferred_training_days,
  });

  // Input key for cache invalidation — any change here invalidates.
  const planInputKey = () => JSON.stringify([
    data.fitness_level, data.primary_goal, data.training_days_per_week,
    data.available_equipment, data.injury_areas, data.sex, data.age,
    data.workout_duration_min, data.preferred_training_days,
  ]);

  const buildMealSnapshot = () => ({
    fitness_level: data.fitness_level,
    primary_goal: data.primary_goal,
    training_days_per_week: data.training_days_per_week,
    height_feet: data.height_feet,
    height_inches: data.height_inches,
    age: data.age,
    sex: data.sex,
    initial_weight_lbs: data.initial_weight_lbs,
    dietaryRestrictions,
    foodAllergies,
    dislikedIngredients,
    availableMealCount,
  });

  const mealInputKey = () => JSON.stringify([
    data.fitness_level, data.primary_goal, data.training_days_per_week,
    data.height_feet, data.height_inches, data.age, data.sex,
    data.initial_weight_lbs, dietaryRestrictions, foodAllergies, dislikedIngredients,
  ]);

  // ── PRELOAD: Workout plan ─────────────────────────────────────
  // Kick off in background as soon as Schedule step (index 5) is completed.
  // All inputs (fitness_level, goal, days, equipment, injuries, duration,
  // preferred_training_days) are available. We run a key-diff check to
  // invalidate + re-fetch if the user goes back and edits.
  useEffect(() => {
    // Gate: user must be past the Schedule step AND not past the plan preview
    if (step < 6 || step > 11 || onboardingDone) return;
    // Gate: required inputs present
    if (!data.fitness_level || !data.primary_goal || !data.training_days_per_week) return;
    if (!(data.available_equipment?.length > 0)) return;

    const key = planInputKey();
    if (planCacheRef.current.key === key) return; // already preloading / loaded

    // Invalidate + kick off new background fetch
    const snapshot = { ...buildPlanSnapshot(), _preloaded: true };
    const promise = runGeneratePlanCore(snapshot)
      .then(result => {
        if (planCacheRef.current.key === key) {
          planCacheRef.current.result = result;
        }
        return result;
      })
      .catch(err => {
        if (planCacheRef.current.key === key) {
          planCacheRef.current.error = err;
        }
        throw err;
      });
    planCacheRef.current = { key, promise, result: null, error: null };
  }, [
    step, onboardingDone,
    data.fitness_level, data.primary_goal, data.training_days_per_week,
    data.available_equipment, data.injury_areas, data.sex, data.age,
    data.workout_duration_min, data.preferred_training_days,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── PRELOAD: Meal plan ────────────────────────────────────────
  // Kick off in background as soon as Body Stats step (index 8) is
  // completed. Dietary prefs may not be set yet — that's OK, we use
  // current values and invalidate if they change at the prefs screen.
  useEffect(() => {
    if (step < 9 || step > 12 || onboardingDone) return;
    if (!data.primary_goal || !data.initial_weight_lbs) return;

    const key = mealInputKey();
    if (mealPlanCacheRef.current.key === key) return;

    const snapshot = { ...buildMealSnapshot(), _preloaded: true };
    const promise = runGenerateMealPlanCore(snapshot)
      .then(result => {
        if (mealPlanCacheRef.current.key === key) {
          mealPlanCacheRef.current.result = result;
        }
        return result;
      })
      .catch(err => {
        if (mealPlanCacheRef.current.key === key) {
          mealPlanCacheRef.current.error = err;
        }
        throw err;
      });
    mealPlanCacheRef.current = { key, promise, result: null, error: null };
  }, [
    step, onboardingDone,
    data.fitness_level, data.primary_goal, data.training_days_per_week,
    data.height_feet, data.height_inches, data.age, data.sex,
    data.initial_weight_lbs, dietaryRestrictions, foodAllergies, dislikedIngredients,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── AUTO-APPLY plan preview when user reaches step 10 and cache is ready
  // Skip the "Generate" button entirely — the work is already done.
  useEffect(() => {
    if (step !== 10 || showGeneratePlan) return;
    if (planCacheRef.current.result) {
      // Instant path: apply and show 'done' immediately
      const r = planCacheRef.current.result;
      setGeneratedRoutines(r.routinesA);
      setGeneratedRoutinesB(r.routinesB);
      setPreviewRoutineIdx(0);
      setPreviewWeekIdx(0);
      setShowGeneratePlan('done');
    } else if (planCacheRef.current.promise) {
      // Pending path: await in handler (shows subtle shimmer for max ~2s)
      handleGeneratePlan();
    }
    // else: no preload happened → leave the manual "Generate" button
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (field, value) => setData(d => ({ ...d, [field]: value }));
  const setMax = (exerciseId, value) =>
    setData(d => ({ ...d, known_maxes: { ...d.known_maxes, [exerciseId]: value } }));

  // ── ANALYTICS ───────────────────────────────────────────────
  const prevStepRef = useRef(0);

  useEffect(() => {
    if (step === prevStepRef.current) return;
    const prevStep = prevStepRef.current;
    prevStepRef.current = step;

    if (step > prevStep) {
      posthog?.capture('onboarding_step_completed', {
        step: prevStep,
        step_name: STEP_NAMES[prevStep],
      });
    }

    if (user?.id) {
      supabase
        .from('profiles')
        .update({ onboarding_step: step })
        .eq('id', user.id)
        .then();
    }
  }, [step, user?.id, posthog]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step, showGeneratePlan, showMealPlan]);

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
    setInviteCode(val.replace(/[-\s]/g, '').toUpperCase());
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
      if (result?.error) {
        setInviteStatus('error');
        const code = result.error;
        const errorKeys = {
          INVALID_CODE: 'inviteCode.errors.invalidCode',
          ALREADY_USED: 'inviteCode.errors.alreadyUsed',
          EXPIRED: 'inviteCode.errors.expired',
          WRONG_GYM: 'inviteCode.errors.wrongGym',
          RATE_LIMITED: 'inviteCode.errors.rateLimited',
        };
        setInviteError(t(errorKeys[code] || 'inviteCode.errors.invalidCode'));
        return;
      }
      setInviteStatus('success');
      await refreshProfile();

      if (result?.has_referral && result?.referred_reward_id) {
        setReferredRewardId(result.referred_reward_id);
        setTimeout(() => setShowRewardPicker(true), 1000);
      } else {
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
    setData(d => {
      const newDays = d.preferred_training_days.includes(fullDay)
        ? d.preferred_training_days.filter(day => day !== fullDay)
        : [...d.preferred_training_days, fullDay];
      return {
        ...d,
        preferred_training_days: newDays,
        training_days_per_week: newDays.length || 1,
      };
    });

  // Re-compute default days once gym hours arrive
  useEffect(() => {
    if (gymHours.length === 0) return;
    const DOW_TO_NAME = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };
    const closed = new Set();
    gymHours.forEach(h => { if (h.is_closed) closed.add(DOW_TO_NAME[h.day_of_week]); });
    if (closed.size === 0) return;
    setData(d => {
      const filtered = d.preferred_training_days.filter(day => !closed.has(day));
      if (filtered.length === d.preferred_training_days.length) return d;
      return { ...d, preferred_training_days: getDefaultDays(d.training_days_per_week, closed) };
    });
  }, [gymHours]);

  const closedDaysSet = useMemo(() => {
    const DOW_TO_NAME = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };
    const closed = new Set();
    gymHours.forEach(h => { if (h.is_closed) closed.add(DOW_TO_NAME[h.day_of_week]); });
    return closed;
  }, [gymHours]);

  const setFrequency = (n) => {
    setData(d => ({
      ...d,
      training_days_per_week:  n,
      preferred_training_days: getDefaultDays(n, closedDaysSet),
    }));
  };

  // ── Consent state ──
  const [consentDeclined, setConsentDeclined] = useState(false);

  const [healthStatus, setHealthStatus] = useState('idle');
  const [healthPrefill, setHealthPrefill] = useState({});
  // Rationale acknowledgement — shown BEFORE the native Health permission
  // dialog so the user understands why we're asking. Once acknowledged
  // (Continue or Skip) we don't show it again for this session.
  const [healthRationaleAck, setHealthRationaleAck] = useState(false);
  const platform = Capacitor.getPlatform();
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

        localStorage.setItem('tugympr_health_connected', 'true');
        localStorage.setItem('tugympr_health_settings', JSON.stringify({ syncWeight: true, syncWorkouts: true, importWeight: true }));
        if (user?.id) {
          supabase.from('profiles').update({ health_sync_enabled: true }).eq('id', user.id).then(() => {});
        }

        const prefilled = {};
        const [weightData, heightData] = await Promise.allSettled([
          readLatestWeight(),
          readHeight(),
        ]);

        setData(prev => {
          const updates = { ...prev };
          if (weightData.status === 'fulfilled' && weightData.value?.value && !prev.initial_weight_lbs) {
            updates.initial_weight_lbs = String(Math.round(weightData.value.value));
            prefilled.weight = true;
          }
          if (heightData.status === 'fulfilled' && heightData.value?.value && !prev.height_feet && !prev.height_inches) {
            const totalInches = Math.round(heightData.value.value);
            const feet = Math.floor(totalInches / 12);
            const inches = totalInches % 12;
            if (feet >= 3 && feet <= 8) {
              updates.height_feet = String(feet);
              updates.height_inches = String(inches);
              prefilled.height = true;
            }
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
    } catch {}
    setStep(s => s + 1);
  };

  const handleConsentDecline = () => setConsentDeclined(true);
  const handleConsentDeclineContinue = () => {
    setConsentDeclined(false);
    setStep(s => s + 1);
  };

  // COPPA: enforce a hard age floor of 13 at the body_stats step in addition
  // to the signup checkbox. Empty age stays allowed (the step is skippable),
  // but any explicit value below 13 blocks the Continue button.
  const isAgeUnder13 = (() => {
    if (!data.age) return false;
    const n = parseInt(data.age, 10);
    return Number.isFinite(n) && n < 13;
  })();

  const canAdvance = () => {
    // Step 0 = invite/gym selection. Block until either an invite was successfully
    // claimed (inviteStatus === 'success') or the profile already has a gym_id.
    if (step === 0) return inviteStatus === 'success' || !!profile?.gym_id;
    if (step === 1) return !!data.language;
    if (step === 2) return !!data.fitness_level;
    if (step === 3) return !!data.primary_goal;
    if (step === 4) return data.available_equipment.length > 0;
    if (step === 5) return data.preferred_training_days.length > 0 && !!data.preferred_training_time;
    if (step === 8) return !isAgeUnder13;
    return true;
  };

  const handleFinish = async () => {
    if (saving) return; // idempotency: ignore double-tap
    setError('');
    setSaving(true);
    try {
      const { data: profileRow } = await supabase
        .from('profiles').select('gym_id').eq('id', user.id).single();
      const gymId = profileRow?.gym_id;
      if (!gymId) {
        throw new Error(t('onboarding.gymRequired', { defaultValue: 'A gym is required to finish onboarding. Please enter an invite code.' }));
      }

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
          // Defensive COPPA gate: never persist an age below 13 even if the
          // input somehow gets past the canAdvance() check.
          age:                    (() => {
                                    if (!data.age) return null;
                                    const n = parseInt(data.age, 10);
                                    if (!Number.isFinite(n) || n < 13) return null;
                                    return n;
                                  })(),
          height_inches:          data.height_feet || data.height_inches
                                    ? (parseInt(data.height_feet || 0) * 12) + parseInt(data.height_inches || 0)
                                    : null,
          initial_weight_lbs:     data.initial_weight_lbs ? parseFloat(data.initial_weight_lbs) : null,
          workout_duration_min:   data.workout_duration_min || 60,
          completed_at:           new Date().toISOString(),
        });

      if (onboardingErr) throw onboardingErr;

      try { localStorage.setItem('tugympr_user_sex', data.sex || 'male'); } catch {}
      try { localStorage.setItem('tugympr_workout_duration', String(data.workout_duration_min || 60)); } catch {}

      // Normalize phone: strip non-digits, prepend country code prefix.
      // Empty if user skipped or input invalid.
      const ccDigits = (phoneCountryCode || '').replace(/\D/g, '');
      const localDigits = (phoneNumber || '').replace(/\D/g, '');
      const normalizedPhone =
        ccDigits.length >= 1 && ccDigits.length <= 3 && localDigits.length >= 7
          ? `+${ccDigits}${localDigits}`
          : null;

      const profileUpdate = {
        preferred_training_days:  data.preferred_training_days,
        preferred_training_time:  data.preferred_training_time,
        workout_buddy_username:   data.workout_buddy_username?.trim() || null,
        preferred_language:       data.language,
        phone_number:             normalizedPhone,
        metric_units:             !!data.metric_units,
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

      await supabase
        .from('profiles')
        .update({ onboarding_step: CORE_STEPS })
        .eq('id', user.id);

      posthog?.capture('onboarding_step_completed', {
        step: CORE_STEPS - 1,
        step_name: STEP_NAMES[CORE_STEPS - 1],
      });

      setOnboardingDone(true);
      setStep(11);
    } catch (err) {
      setError(err.message || t('common:somethingWentWrong'));
    } finally {
      setSaving(false);
    }
  };

  // ── GENERATE PERSONAL PLAN (core worker — side-effectful) ────
  // Returns the previewable routines array. All Supabase writes + PostHog
  // events happen inside. Safe to call in background (no React state
  // mutations) — caller applies UI state when consuming.
  const runGeneratePlanCore = async (snapshot) => {
    const { data: profileRow } = await supabase
      .from('profiles').select('gym_id').eq('id', user.id).single();
    const gymId = profileRow?.gym_id;

    const onboardingForGenerator = {
      fitness_level: snapshot.fitness_level || 'beginner',
      primary_goal: snapshot.primary_goal || 'general_fitness',
      training_days_per_week: snapshot.training_days_per_week || 3,
      available_equipment: snapshot.available_equipment?.length > 0
        ? snapshot.available_equipment
        : ['Bodyweight'],
      injuries_notes: snapshot.injury_areas?.length > 0
        ? snapshot.injury_areas.join(', ')
        : '',
      sex: snapshot.sex || 'male',
      age: snapshot.age ? parseInt(snapshot.age) : 30,
      workout_duration_min: snapshot.workout_duration_min || 60,
    };

    const result = generateProgram(onboardingForGenerator);

    const startDate = new Date();
    startDate.setSeconds(startDate.getSeconds() - 5);

    const nameSeed = result.seed || Math.floor(Math.random() * 100000);
    // Persist BOTH variant A and variant B routines so the program view can
    // alternate them weekly (odd weeks → A, even weeks → B). Different
    // exercises + different names per variant — the user runs a real
    // rotation rather than the same 4 routines every week.
    const insertVariant = async (variantRoutines, variantOffsetForName) => {
      const ids = [];
      for (const routine of variantRoutines) {
        const creativeName = generateRoutineName(
          routine.slotsKey,
          routine.variantIndex + variantOffsetForName,
          nameSeed
        );
        const { data: saved, error: rErr } = await supabase
          .from('routines')
          .insert({
            name: `Auto: ${creativeName}`,
            gym_id: gymId,
            created_by: user.id,
          })
          .select('id')
          .single();
        if (rErr) throw rErr;
        ids.push(saved.id);

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
      return ids;
    };
    const createdRoutineIdsA = await insertVariant(result.routinesA, 0);
    const createdRoutineIdsB = await insertVariant(result.routinesB, 5);
    const createdRoutineIds = [...createdRoutineIdsA, ...createdRoutineIdsB];

    const DAY_TO_DOW = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
    const fallbackByN = { 1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };

    const { data: gymHoursData } = await supabase
      .from('gym_hours')
      .select('day_of_week, is_closed')
      .eq('gym_id', gymId);
    const closedDays = new Set((gymHoursData || []).filter(h => h.is_closed).map(h => h.day_of_week));

    const userDows = (snapshot.preferred_training_days || [])
      .map(d => DAY_TO_DOW[d])
      .filter(n => typeof n === 'number' && !closedDays.has(n))
      .sort((a, b) => a - b);
    // N is the per-variant slot count, not the combined A+B total. Each DOW
    // has one A routine and one B routine that alternate by week parity.
    const N = createdRoutineIdsA.length;
    let pickedDows = userDows.length >= N ? userDows.slice(0, N) : (fallbackByN[N] || [1, 3, 5]).filter(d => !closedDays.has(d)).slice(0, N);

    if (pickedDows.length < N) {
      const allOpenDays = [0, 1, 2, 3, 4, 5, 6].filter(d => !closedDays.has(d));
      const used = new Set(pickedDows);
      for (const d of allOpenDays) {
        if (pickedDows.length >= N) break;
        if (!used.has(d)) { pickedDows.push(d); used.add(d); }
      }
      pickedDows.sort((a, b) => a - b);
    }

    // Program duration in *training weeks* (each = N sessions). The calendar
    // span is always at least DURATION_WEEKS — usually a bit longer because
    // signup mid-week steals sessions from week 0 that we make up at the end.
    const DURATION_WEEKS = 12;
    const startDow = startDate.getDay();

    // ── Partial-week scheduling ──────────────────────────────────────────
    // pickedDows is the user's full weekly cadence (e.g., Mon/Wed/Fri/Sat).
    // routine_index N→day_of_week mapping is the canonical week.
    // Week 0 (signup week): only days from today onwards.
    // Final week: only as many days as needed to total DURATION_WEEKS × N
    // sessions across the whole program. Result: signup Thu w/ M/W/F/S +
    // 12 weeks → 2 (Fri+Sat) + 11×4 + 2 (Mon+Wed) = 48 sessions, ends Wed.
    const week1Dows = pickedDows.filter(d => d >= startDow);
    const sessionsPerWeek = pickedDows.length;
    const totalSessionsTarget = DURATION_WEEKS * sessionsPerWeek;
    const sessionsAfterWeek1 = totalSessionsTarget - week1Dows.length;
    const fullMidWeeks = Math.floor(sessionsAfterWeek1 / sessionsPerWeek);
    const lastWeekSessionCount = sessionsAfterWeek1 - fullMidWeeks * sessionsPerWeek;
    const lastWeekDows = pickedDows.slice(0, lastWeekSessionCount);

    // routine_index for any given day_of_week: determined by position in
    // pickedDows (canonical order). week1_map / last_week_map use the SAME
    // routine_index per dow so the week's exercise variety is preserved.
    const dowToRoutineIdx = new Map(pickedDows.map((dow, i) => [dow, i]));
    const week1Map = week1Dows.map(dow => ({ routine_index: dowToRoutineIdx.get(dow), day_of_week: dow }));
    const lastWeekMap = lastWeekDows.map(dow => ({ routine_index: dowToRoutineIdx.get(dow), day_of_week: dow }));

    const totalCalendarWeeks = 1 + fullMidWeeks + (lastWeekSessionCount > 0 ? 1 : 0);
    const expiresAt = new Date(startDate);
    if (lastWeekSessionCount > 0) {
      const lastSessionDow = lastWeekDows[lastWeekDows.length - 1];
      const daysToEnd = (totalCalendarWeeks - 1) * 7 + (lastSessionDow - startDow);
      expiresAt.setDate(expiresAt.getDate() + daysToEnd + 1); // +1 so the last session day is included
    } else {
      const lastSessionDow = pickedDows[pickedDows.length - 1];
      const daysToEnd = (totalCalendarWeeks - 1) * 7 + (lastSessionDow - startDow);
      expiresAt.setDate(expiresAt.getDate() + daysToEnd + 1);
    }

    // Dedup the display name against any past programs this user already has
    // (e.g. they redid onboarding) so the same creative name never appears
    // twice in My Programs.
    const { data: priorPrograms } = await supabase
      .from('generated_programs')
      .select('schedule_map')
      .eq('profile_id', user.id);
    const usedProgramNames = (priorPrograms || [])
      .map((p) => p.schedule_map?.display_name)
      .filter(Boolean);
    const displayName = generateProgramName(
      result.split,
      snapshot.primary_goal || 'general_fitness',
      usedProgramNames,
    );

    const scheduleMapData = {
      display_name:    displayName,
      // Combined list — used by orphan cleanup + Reactivate.
      routine_ids:     createdRoutineIds,
      // Variant-specific lists — getRoutinesForWeek alternates them by week
      // parity so the user runs a different rotation on odd vs. even weeks.
      routine_ids_a:   createdRoutineIdsA,
      routine_ids_b:   createdRoutineIdsB,
      routine_day_map: pickedDows.map((dow, i) => ({ routine_index: i, day_of_week: dow })),
      week1_map:       week1Map,
      last_week_map:   lastWeekMap,
      start_dow:       startDow,
      week1_dows:      week1Dows,
      wrapped_dows:    lastWeekDows,
      normal_dows:     pickedDows,
      total_calendar_weeks: totalCalendarWeeks,
    };

    const { error: progErr } = await supabase.from('generated_programs').insert({
      profile_id:       user.id,
      gym_id:           gymId,
      split_type:       result.split,
      program_start:    startDate.toISOString(),
      expires_at:       expiresAt.toISOString(),
      routines_a_count: N,
      duration_weeks:   DURATION_WEEKS,
      schedule_map:     scheduleMapData,
    });
    if (progErr) console.warn('generated_programs insert failed:', progErr.message);

    // Seed workout_schedule with variant A only. The Workouts page resolves
    // the actual per-week variant from schedule_map.routine_ids_a/_b; other
    // surfaces (dashboard, notifications) read workout_schedule and will
    // show variant A for that DOW, which is still a valid program routine.
    for (let i = 0; i < createdRoutineIdsA.length; i++) {
      await supabase.from('workout_schedule').upsert({
        profile_id:  user.id,
        gym_id:      gymId,
        day_of_week: pickedDows[i],
        routine_id:  createdRoutineIdsA[i],
        updated_at:  new Date().toISOString(),
      }, { onConflict: 'profile_id,day_of_week' });
    }

    posthog?.capture('onboarding_plan_generated', {
      split: result.splitLabel,
      goal: snapshot.primary_goal,
      days: snapshot.training_days_per_week,
      routines_count: createdRoutineIds.length,
      variants: 2,
      duration_weeks: DURATION_WEEKS,
      preloaded: snapshot._preloaded === true,
    });

    // Return BOTH variant rotations so the preview can let the user flip
    // between Week A and Week B (alternated by the schedule_map on a 2-week
    // cycle). Naming + exercise enrichment is identical for both — wrapped
    // in a helper so the two arrays stay in sync.
    const enrich = (variant) => variant.map((r) => ({
      name: generateRoutineName(r.slotsKey, r.variantIndex, nameSeed),
      exercises: r.exercises.map((ex) => {
        const info = getExerciseById(ex.exerciseId);
        return { ...ex, name: info?.name || ex.exerciseId, name_es: info?.name_es || null, muscle: info?.muscle || '' };
      }),
    }));
    return {
      routinesA: enrich(result.routinesA),
      routinesB: enrich(result.routinesB),
    };
  };

  // Consumer: applies UI state from the (possibly pre-warmed) cache.
  const handleGeneratePlan = async () => {
    setShowGeneratePlan('generating');
    setGenerateError('');
    try {
      let promise = planCacheRef.current.promise;
      if (planCacheRef.current.result) {
        // Already resolved — instant!
        const cached = planCacheRef.current.result;
        setGeneratedRoutines(cached.routinesA);
        setGeneratedRoutinesB(cached.routinesB);
        setPreviewRoutineIdx(0);
        setPreviewWeekIdx(0);
        setShowGeneratePlan('done');
        return;
      }
      if (!promise) {
        // No preload — fall back to fresh run
        const snapshot = buildPlanSnapshot();
        promise = runGeneratePlanCore(snapshot);
        planCacheRef.current = { key: planInputKey(), promise, result: null, error: null };
      }
      const result = await promise;
      planCacheRef.current.result = result;
      setGeneratedRoutines(result.routinesA);
      setGeneratedRoutinesB(result.routinesB);
      setPreviewRoutineIdx(0);
      setPreviewWeekIdx(0);
      setShowGeneratePlan('done');
    } catch (err) {
      planCacheRef.current = { key: null, promise: null, result: null, error: err };
      setGenerateError(err.message || t('common:somethingWentWrong'));
      setShowGeneratePlan(false);
    }
  };

  const handleSkipGeneratePlan = () => {
    setShowGeneratePlan(false);
    setStep(12);
  };

  const handlePlanDone = () => {
    setShowGeneratePlan(false);
    setStep(12);
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

  const COMMON_INGREDIENTS = [
    'chicken_breast', 'salmon_fillet', 'ground_turkey', 'lean_ground_beef',
    'tofu', 'shrimp', 'eggs', 'greek_yogurt', 'oats', 'brown_rice',
    'quinoa', 'sweet_potato', 'broccoli', 'spinach', 'avocado',
    'peanut_butter', 'cottage_cheese', 'tuna', 'mushrooms', 'bell_pepper',
    'black_beans', 'chickpeas', 'lentils', 'kale', 'cauliflower',
    'zucchini', 'asparagus', 'brussels_sprouts', 'coconut_milk',
    'soy_sauce', 'olive_oil',
  ];

  // MEALS is lazy-loaded into the local state below — it starts as an empty
  // array on first paint and gets populated by `loadMeals()` shortly after.
  // The previous deps array left MEALS out, so this memo froze at 0 until
  // the user clicked a restriction/allergy chip (which changed the deps and
  // forced a re-run). To the user that read as "if I don't click anything
  // it doesn't suggest anything; selecting options RAISES the count" —
  // exactly the opposite of the intended "empty selection = full pool,
  // selections rip away options" behavior. Adding MEALS to the deps lets
  // the recompute fire as soon as the lazy load resolves.
  const availableMealCount = useMemo(() => {
    return MEALS.filter(m =>
      isMealAllergenSafe(m, foodAllergies) &&
      isMealDietaryCompliant(m, dietaryRestrictions) &&
      !(m.ingredients || []).some(i => dislikedIngredients.includes(i))
    ).length;
  }, [MEALS, foodAllergies, dietaryRestrictions, dislikedIngredients]);

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

  const handleSkipMealPlan = async () => {
    // Write is_onboarded BEFORE anything else so PublicRoute/ProtectedRoute
    // never bounce back to /onboarding. Await refreshProfile so the AuthContext
    // reflects the flip before we navigate — otherwise there's a render frame
    // where profile.is_onboarded is still false and ProtectedRoute redirects
    // to /onboarding, re-mounting this page at step 0 (the step-1 flash).
    await supabase.from('profiles').update({ is_onboarded: true }).eq('id', user.id);
    posthog?.capture('onboarding_completed', { total_steps: TOTAL_STEPS });
    // Mark done so the draft-persist effect stops writing back step 11
    setOnboardingDone(true);
    try { await refreshProfile(); } catch {}
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    try { localStorage.removeItem(PERSIST_KEY); } catch {}
    try { localStorage.removeItem('referrer_buddy'); } catch {}
    navigate('/', { replace: true });
  };

  const handleMealPlanPrefs = () => setShowMealPlan('prefs');

  // Core worker — side-effectful, safe to run in background. Does not
  // mutate React state. Returns { weekPlan, macros } for the consumer.
  const runGenerateMealPlanCore = async (snapshot) => {
    const { data: profileRow } = await supabase
      .from('profiles').select('gym_id').eq('id', user.id).single();
    const gymId = profileRow?.gym_id;

    const heightInches = snapshot.height_feet || snapshot.height_inches
      ? (parseInt(snapshot.height_feet || 0) * 12) + parseInt(snapshot.height_inches || 0)
      : 70;
    const macros = calculateMacros({
      weightLbs: parseFloat(snapshot.initial_weight_lbs) || 170,
      heightInches,
      age: parseInt(snapshot.age) || 25,
      sex: snapshot.sex || 'male',
      trainingDays: snapshot.training_days_per_week || 4,
      goal: snapshot.primary_goal || 'general_fitness',
    });

    await supabase
      .from('member_onboarding')
      .update({
        dietary_restrictions: snapshot.dietaryRestrictions,
        food_allergies: snapshot.foodAllergies,
      })
      .eq('profile_id', user.id);

    if (snapshot.dislikedIngredients.length > 0) {
      const dislikeRows = snapshot.dislikedIngredients.map(ing => ({
        profile_id: user.id,
        gym_id: gymId,
        food_name: ing,
      }));
      await supabase
        .from('disliked_foods')
        .upsert(dislikeRows, { onConflict: 'profile_id,food_name', ignoreDuplicates: true });
    }

    const weekPlan = generateWeekPlan({
      targets: macros,
      favorites: [],
      allergies: snapshot.foodAllergies,
      restrictions: snapshot.dietaryRestrictions,
      affinities: {},
    });

    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1);
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
      .then(() => {})
      .catch(() => {});

    posthog?.capture('onboarding_meal_plan_generated', {
      restrictions: snapshot.dietaryRestrictions,
      allergies: snapshot.foodAllergies,
      dislikes_count: snapshot.dislikedIngredients.length,
      meals_available: snapshot.availableMealCount,
      goal: snapshot.primary_goal,
      calories: macros.calories,
      protein: macros.protein,
      preloaded: snapshot._preloaded === true,
    });

    return { weekPlan, macros };
  };

  const handleGenerateMealPlan = async () => {
    setShowMealPlan('generating');
    setMealPlanError('');
    try {
      let promise = mealPlanCacheRef.current.promise;
      if (mealPlanCacheRef.current.result) {
        const { weekPlan, macros } = mealPlanCacheRef.current.result;
        setMealPlanMacros(macros);
        setGeneratedMealPlan(weekPlan);
        setShowMealPlan('done');
        return;
      }
      if (!promise) {
        const snapshot = buildMealSnapshot();
        promise = runGenerateMealPlanCore(snapshot);
        mealPlanCacheRef.current = { key: mealInputKey(), promise, result: null, error: null };
      }
      const { weekPlan, macros } = await promise;
      mealPlanCacheRef.current.result = { weekPlan, macros };
      setMealPlanMacros(macros);
      setGeneratedMealPlan(weekPlan);
      setShowMealPlan('done');
    } catch (err) {
      mealPlanCacheRef.current = { key: null, promise: null, result: null, error: err };
      setMealPlanError(err.message || t('common:somethingWentWrong'));
      setShowMealPlan('prefs');
    }
  };

  const handleMealPlanDone = async () => {
    // Same ordering contract as handleSkipMealPlan: persist, refresh context,
    // clear drafts, THEN navigate. Prevents the step-1 flash caused by
    // ProtectedRoute redirecting to /onboarding while the profile context is
    // still stale.
    await supabase.from('profiles').update({ is_onboarded: true }).eq('id', user.id);
    posthog?.capture('onboarding_completed', { total_steps: TOTAL_STEPS });
    setOnboardingDone(true);
    try { await refreshProfile(); } catch {}
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    try { localStorage.removeItem(PERSIST_KEY); } catch {}
    try { localStorage.removeItem('referrer_buddy'); } catch {}
    navigate('/', { replace: true });
  };

  const dayShort = (index) => t(`common:days.${SHORT_DAY_KEYS[index]}`);
  const FULL_DAYS_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // ── RENDER ───────────────────────────────────────────────

  const displayStep = step + 1; // 1-indexed for UI
  const canGoBack = step > 0 && !(step === 1 && profile?.gym_id);

  // Determine if we're on a "final done" state where no bottom bar navigation applies
  const isConsentStep = step === 6;
  const isPhoneStep = step === 9;
  const isPlanStep = step === 11;
  const isMealStep = step === 12;
  // Phone step (9) renders its own button row (with Skip), so exclude from core nav.
  const showCoreNav = step > 0 && !isConsentStep && !isPhoneStep && step < CORE_STEPS;

  return (
    <main
      style={{
        // capacitor.config.json has Keyboard.resize: "native", so iOS already
        // shrinks the WebView when the keyboard opens — 100dvh inside is
        // automatically the area ABOVE the keyboard. The previous
        // calc(100dvh - --keyboard-height) was double-subtracting and
        // collapsed the page to a blank sliver the instant a text field
        // received focus. Plain 100dvh is the correct anchor here.
        height: '100dvh',
        background: OB.bg,
        color: OB.ink,
        fontFamily: OB_FONT.body,
        WebkitFontSmoothing: 'antialiased',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          margin: '0 auto',
          padding: '0 20px',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* ══════════════════════════════════════════════════════
            STEP HEADER
            ══════════════════════════════════════════════════════ */}
        <OBStepHead
          label={t(STEP_LABELS[step], STEP_LABEL_KEYS[step].toUpperCase())}
          step={displayStep}
          total={TOTAL_STEPS}
          title={
            step === 0 ? t('inviteCode.title') :
            step === 1 ? t('langStep.title') :
            step === 2 ? t('fitnessLevel.title') :
            step === 3 ? t('goal.title') :
            step === 4 ? t('training.title') :
            step === 5 ? t('schedule.title') :
            step === 6 ? t('dataConsent.title') :
            step === 7 ? t('health.title') :
            step === 8 ? t('bodyStats.title') :
            step === 9 ? t('phoneStep.title') :
            step === 10 ? t('social.title') :
            null
          }
          sub={
            step === 0 ? t('inviteCode.subtitle') :
            step === 1 ? t('langStep.subtitle') :
            step === 2 ? t('fitnessLevel.subtitle') :
            step === 3 ? t('goal.subtitle') :
            step === 4 ? t('training.subtitle') :
            step === 5 ? t('schedule.subtitle') :
            step === 6 ? t('dataConsent.subtitle') :
            step === 7 ? t('health.subtitle') :
            step === 8 ? t('bodyStats.subtitle') :
            step === 9 ? t('phoneStep.subtitle') :
            step === 10 ? t('social.subtitle') :
            null
          }
          onBack={canGoBack ? () => setStep(s => s - 1) : null}
          t={t}
        />

        {/* Scroll body — only this element scrolls. Header + footer above/below
            stay pinned to the (keyboard-aware) viewport. */}
        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          paddingTop: 8,
        }}>

        {/* ══════════════════════════════════════════════════════
            STEP 0 · INVITE CODE
            ══════════════════════════════════════════════════════ */}
        {step === 0 && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <OBInput
              value={inviteCode}
              onChange={e => handleInviteCodeChange(e.target.value)}
              placeholder={t('inviteCode.placeholder', { defaultValue: 'e.g. ABC123' })}
              disabled={inviteStatus === 'verifying' || inviteStatus === 'success'}
              maxLength={30}
              monospace
              autoCapitalize="characters"
            />

            {inviteStatus !== 'success' && (
              <OBButton
                full
                tone="teal"
                icon={<ArrowRight size={16}/>}
                onClick={handleVerifyInviteCode}
                disabled={!inviteCode.trim() || inviteStatus === 'verifying'}
              >
                {inviteStatus === 'verifying' ? t('inviteCode.verifying') : t('inviteCode.verify')}
              </OBButton>
            )}

            {inviteStatus === 'success' && !showRewardPicker && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: OB.greenSoft, border: `1.5px solid ${OB.green}`,
                borderRadius: 14, padding: '14px 16px',
              }}>
                <Check size={18} color={OB.green} />
                <span style={{ fontFamily: OB_FONT.display, fontWeight: 800, color: '#2d5a2d', fontSize: 14 }}>
                  {t('inviteCode.success')}
                </span>
              </div>
            )}

            {showRewardPicker && referredRewardId && (
              <RewardPicker
                rewardId={referredRewardId}
                gymId={profile?.gym_id}
                onChosen={() => { setShowRewardPicker(false); setTimeout(() => setStep(1), 800); }}
                onSkip={() => { setShowRewardPicker(false); setStep(1); }}
                className="w-full"
              />
            )}

            {inviteStatus === 'error' && inviteError && (
              <div role="alert" style={{
                background: 'rgba(255,90,46,0.1)', border: `1.5px solid ${OB.orange}`,
                borderRadius: 14, padding: '12px 14px',
              }}>
                <p style={{ fontSize: 13, color: OB.orange, textAlign: 'center', margin: 0 }}>{inviteError}</p>
              </div>
            )}

            {inviteStatus !== 'success' && (
              <button
                type="button"
                onClick={() => setStep(1)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 13, color: OB.sub, padding: '10px', textAlign: 'center',
                  fontFamily: OB_FONT.body, fontWeight: 600,
                }}
              >
                {t('inviteCode.skip')}
              </button>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            STEP 1 · LANGUAGE
            ══════════════════════════════════════════════════════ */}
        {step === 1 && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <OBOption
              tall
              selected={data.language === 'en'}
              onClick={() => selectLanguage('en')}
              title="English"
              sub="United States · Imperial units"
              icon={<span style={{ fontSize: 24 }}>🇺🇸</span>}
              iconBg={OB.surface2}
            />
            <OBOption
              tall
              selected={data.language === 'es'}
              onClick={() => selectLanguage('es')}
              title="Español"
              sub="Puerto Rico · Unidades métricas"
              icon={<span style={{ fontSize: 24 }}>🇵🇷</span>}
              iconBg={OB.surface2}
            />
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            STEP 2 · FITNESS LEVEL + 1RMs
            ══════════════════════════════════════════════════════ */}
        {step === 2 && (
          <div className="animate-fade-in">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {FITNESS_LEVELS.map(l => {
                const Icon = l.icon;
                return (
                  <OBOption
                    key={l.value}
                    selected={data.fitness_level === l.value}
                    onClick={() => set('fitness_level', l.value)}
                    title={t(`fitnessLevel.${l.key}.label`)}
                    sub={t(`fitnessLevel.${l.key}.desc`)}
                    badge={t(`fitnessLevel.${l.key}.badge`)}
                    icon={<Icon size={22} color={l.iconFg} />}
                    iconBg={l.iconBg}
                    iconFg={l.iconFg}
                  />
                );
              })}
            </div>

            {/* 1RM reveal for intermediate/advanced */}
            {(data.fitness_level === 'intermediate' || data.fitness_level === 'advanced') && (
              <div className="animate-fade-in" style={{ marginTop: 18 }}>
                <div style={{
                  background: OB.surface, borderRadius: 18, padding: 18,
                  border: `1px solid ${OB.line}`, boxShadow: OB.shadow,
                }}>
                  <div style={{
                    fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 14,
                    color: OB.ink, letterSpacing: -0.2,
                  }}>
                    {t('fitnessLevel.maxes.title')} <span style={{ color: OB.sub, fontWeight: 500 }}>· {t('common:optional')}</span>
                  </div>
                  <div style={{ fontSize: 12, color: OB.sub, marginTop: 3, marginBottom: 14 }}>
                    {t('fitnessLevel.maxes.subtitle')}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {[
                      { id: 'ex_bp',  label: t('fitnessLevel.maxes.bench') },
                      { id: 'ex_sq',  label: t('fitnessLevel.maxes.squat') },
                      { id: 'ex_dl',  label: t('fitnessLevel.maxes.deadlift') },
                      { id: 'ex_ohp', label: t('fitnessLevel.maxes.ohp') },
                    ].map(lift => (
                      <div key={lift.id} style={{
                        background: OB.surface2, borderRadius: 12, padding: '10px 12px',
                      }}>
                        <div style={{
                          fontSize: 10, color: OB.sub, fontWeight: 700,
                          letterSpacing: 0.5, textTransform: 'uppercase',
                        }}>{lift.label}</div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 2 }}>
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            max="1500"
                            placeholder="—"
                            aria-label={lift.label}
                            value={data.known_maxes[lift.id]}
                            onChange={e => setMax(lift.id, e.target.value)}
                            style={{
                              flex: 1, minWidth: 0, width: '100%',
                              background: 'transparent', border: 'none', outline: 'none',
                              fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 22,
                              color: OB.ink, letterSpacing: -0.5,
                            }}
                          />
                          <div style={{ fontSize: 11, color: OB.mute, fontWeight: 600 }}>lb</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p style={{ fontSize: 11, color: OB.mute, marginTop: 10, textAlign: 'center' }}>
                  {t('fitnessLevel.maxes.hint')}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            STEP 3 · GOAL (2×2 + 1 full-width)
            ══════════════════════════════════════════════════════ */}
        {step === 3 && (
          <div className="animate-fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {GOALS.map((g, i) => {
              const Icon = g.icon;
              const sel = data.primary_goal === g.value;
              const isLast = i === GOALS.length - 1;
              return (
                <button
                  type="button"
                  key={g.value}
                  onClick={() => set('primary_goal', g.value)}
                  aria-pressed={sel}
                  style={{
                    background: sel ? '#fff' : OB.surface,
                    border: `1.5px solid ${sel ? OB.teal : OB.line}`,
                    borderRadius: 18, padding: '16px 14px',
                    boxShadow: sel ? '0 0 0 4px rgba(46,196,196,0.12)' : OB.shadow,
                    position: 'relative',
                    gridColumn: isLast ? 'span 2' : undefined,
                    display: 'flex',
                    flexDirection: isLast ? 'row' : 'column',
                    gap: 10,
                    alignItems: isLast ? 'center' : 'flex-start',
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'all 150ms ease',
                  }}
                >
                  <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: g.iconBg, color: g.iconFg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Icon size={22} color={g.iconFg} />
                  </div>
                  <div style={{ flex: isLast ? 1 : undefined }}>
                    <div style={{
                      fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 15,
                      color: OB.ink, letterSpacing: -0.3,
                    }}>
                      {t(`goal.${g.key}.label`)}
                    </div>
                    <div style={{ fontSize: 12, color: OB.sub, marginTop: 2 }}>
                      {t(`goal.${g.key}.desc`)}
                    </div>
                  </div>
                  {sel && (
                    <div style={{
                      position: 'absolute', top: 10, right: 10,
                      width: 20, height: 20, borderRadius: 999, background: OB.teal,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Check size={12} strokeWidth={3.5} color="#0A2A2A" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            STEP 4 · FREQUENCY + EQUIPMENT
            ══════════════════════════════════════════════════════ */}
        {step === 4 && (
          <div className="animate-fade-in">
            <OBLabel>{t('training.daysPerWeek')}</OBLabel>
            <div style={{ display: 'flex', gap: 6 }}>
              {FREQUENCIES.map(n => {
                const sel = data.training_days_per_week === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setFrequency(n)}
                    aria-pressed={sel}
                    style={{
                      flex: 1, height: 58, borderRadius: 14,
                      background: sel ? OB.teal : OB.surface,
                      border: `1.5px solid ${sel ? OB.teal : OB.line}`,
                      color: sel ? '#0A2A2A' : OB.ink,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 120ms ease',
                      boxShadow: sel ? '0 6px 16px rgba(46,196,196,0.22)' : 'none',
                    }}
                  >
                    <div style={{
                      fontFamily: OB_FONT.display, fontWeight: 900, fontSize: 20,
                      letterSpacing: -0.5,
                    }}>{n}</div>
                    <div style={{
                      fontSize: 9, fontWeight: 700,
                      opacity: sel ? 0.7 : 0.5,
                      letterSpacing: 0.4, textTransform: 'uppercase',
                    }}>{n === 1 ? t('training.dayLabel', { defaultValue: 'day' }) : t('training.daysLabel', { defaultValue: 'days' })}</div>
                  </button>
                );
              })}
            </div>
            <p style={{ fontSize: 11, color: OB.sub, marginTop: 8, textAlign: 'center' }}>
              {data.training_days_per_week <= 2 && t('training.freq1')}
              {data.training_days_per_week === 3 && t('training.freq3')}
              {data.training_days_per_week === 4 && t('training.freq4')}
              {data.training_days_per_week === 5 && t('training.freq5')}
              {data.training_days_per_week >= 6 && t('training.freq6')}
            </p>

            <div style={{ marginTop: 26 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <OBLabel>{t('training.equipment')}</OBLabel>
                {gymName && (
                  <span style={{
                    fontSize: 11, color: OB.tealDeep, fontWeight: 700,
                    letterSpacing: 0.3, textTransform: 'uppercase',
                  }}>
                    {data.available_equipment.length} {t('training.selected', 'selected')}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {EQUIPMENT_OPTIONS.map(eq => {
                  const active = data.available_equipment.includes(eq.value);
                  return (
                    <OBChip
                      key={eq.value}
                      selected={active}
                      onClick={() => toggleEquipment(eq.value)}
                      icon={active ? (
                        <div style={{
                          width: 14, height: 14, borderRadius: 999,
                          background: '#0A2A2A', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Check size={10} strokeWidth={3} color={OB.teal}/>
                        </div>
                      ) : null}
                    >
                      {t(`training.${eq.key}`)}
                    </OBChip>
                  );
                })}
              </div>

              {gymName && (
                <div style={{
                  marginTop: 14, padding: '10px 14px', borderRadius: 12,
                  background: OB.surface, border: `1px dashed ${OB.lineStrong}`,
                  fontSize: 12, color: OB.sub,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <Pin size={16} color={OB.sub} strokeWidth={2} />
                  <span>
                    {t('training.pulledFrom', 'Pulled from')} <span style={{ color: OB.ink, fontWeight: 700 }}>{gymName}</span>{t('training.updatedByYourGym', ' — updated by your gym.')}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            STEP 5 · SCHEDULE (days + duration + time)
            ══════════════════════════════════════════════════════ */}
        {step === 5 && (
          <div className="animate-fade-in">
            {/* Days */}
            <OBLabel>{t('schedule.whichDays')}</OBLabel>
            <div style={{ display: 'flex', gap: 6 }}>
              {FULL_DAYS_EN.map((dayEN, idx) => {
                const active = data.preferred_training_days.includes(dayEN);
                const dow = idx === 6 ? 0 : idx + 1;
                const hourRow = gymHours.find(h => h.day_of_week === dow);
                const isClosed = hourRow?.is_closed === true;
                return (
                  <button
                    key={dayEN}
                    type="button"
                    onClick={() => !isClosed && toggleTrainingDay(dayEN)}
                    disabled={isClosed}
                    aria-pressed={active}
                    style={{
                      flex: 1, height: 56, borderRadius: 14,
                      background: active ? OB.teal : isClosed ? 'transparent' : OB.surface,
                      border: `1.5px solid ${active ? OB.teal : isClosed ? 'transparent' : OB.line}`,
                      color: active ? '#0A2A2A' : isClosed ? OB.mute : OB.ink,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      textDecoration: isClosed ? 'line-through' : 'none',
                      textDecorationColor: isClosed ? OB.orange : undefined,
                      position: 'relative',
                      cursor: isClosed ? 'not-allowed' : 'pointer',
                      transition: 'all 120ms ease',
                      boxShadow: active ? '0 6px 16px rgba(46,196,196,0.22)' : 'none',
                    }}
                  >
                    <div style={{
                      fontFamily: OB_FONT.display, fontWeight: 900, fontSize: 13,
                      letterSpacing: 0.3,
                    }}>
                      {dayShort(idx).toUpperCase()}
                    </div>
                    {isClosed && (
                      <div style={{
                        fontSize: 8, color: OB.orange, fontWeight: 700,
                        position: 'absolute', bottom: 4, letterSpacing: 0.4,
                      }}>{t('schedule.closed', 'CLOSED')}</div>
                    )}
                  </button>
                );
              })}
            </div>
            {data.preferred_training_days.length > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                marginTop: 10, fontSize: 12, color: OB.sub,
              }}>
                <span style={{
                  padding: '3px 8px', borderRadius: 999,
                  background: OB.tealSoft, color: OB.tealDeep,
                  fontWeight: 800, fontSize: 11,
                }}>{t('schedule.daysSelected', { count: data.preferred_training_days.length })}</span>
              </div>
            )}
            {data.preferred_training_days.length === 0 && (
              <p style={{ fontSize: 11, color: OB.orange, marginTop: 8, textAlign: 'center' }}>
                {t('schedule.selectAtLeast')}
              </p>
            )}

            {/* Session length */}
            <div style={{ marginTop: 22 }}>
              <OBLabel>{t('schedule.durationTitle', 'Session length')}</OBLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                {[30, 45, 60, 90].map(n => {
                  const sel = data.workout_duration_min === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => set('workout_duration_min', n)}
                      aria-pressed={sel}
                      style={{
                        padding: '14px 4px', borderRadius: 14,
                        background: sel ? '#fff' : OB.surface,
                        border: `1.5px solid ${sel ? OB.teal : OB.line}`,
                        boxShadow: sel ? '0 0 0 4px rgba(46,196,196,0.12)' : 'none',
                        textAlign: 'center', cursor: 'pointer',
                        transition: 'all 150ms ease',
                      }}
                    >
                      <div style={{
                        fontFamily: OB_FONT.display, fontWeight: 900, fontSize: 22,
                        color: OB.ink, letterSpacing: -0.5,
                      }}>
                        {n}<span style={{ fontSize: 11, color: OB.sub, fontWeight: 700 }}>m</span>
                      </div>
                    </button>
                  );
                })}
                {(() => {
                  const preset = [30, 45, 60, 90].includes(data.workout_duration_min);
                  const sel = !preset;
                  return (
                    <button
                      key="custom"
                      type="button"
                      onClick={() => {
                        if (preset) set('workout_duration_min', 75);
                      }}
                      aria-pressed={sel}
                      style={{
                        padding: '14px 4px', borderRadius: 14,
                        background: sel ? '#fff' : OB.surface,
                        border: `1.5px solid ${sel ? OB.teal : OB.line}`,
                        boxShadow: sel ? '0 0 0 4px rgba(46,196,196,0.12)' : 'none',
                        textAlign: 'center', cursor: 'pointer',
                        transition: 'all 150ms ease',
                      }}
                    >
                      <div style={{
                        fontFamily: OB_FONT.display, fontWeight: 900, fontSize: 22,
                        color: OB.ink, letterSpacing: -0.5,
                      }}>
                        {sel ? (
                          <>{data.workout_duration_min}<span style={{ fontSize: 11, color: OB.sub, fontWeight: 700 }}>m</span></>
                        ) : (
                          <span style={{ fontSize: 13, letterSpacing: 0.2 }}>{t('schedule.custom', 'Custom')}</span>
                        )}
                      </div>
                    </button>
                  );
                })()}
              </div>
              {![30, 45, 60, 90].includes(data.workout_duration_min) && (
                <div style={{
                  marginTop: 10, display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <label style={{
                    fontSize: 11, color: OB.sub, fontWeight: 700, letterSpacing: 0.3,
                    textTransform: 'uppercase',
                  }}>{t('schedule.customMinutes', 'Minutes')}</label>
                  <input
                    type="number"
                    min={15}
                    max={180}
                    step={5}
                    value={data.workout_duration_min}
                    onChange={e => {
                      const raw = parseInt(e.target.value, 10);
                      if (Number.isNaN(raw)) return;
                      const clamped = Math.max(15, Math.min(180, raw));
                      set('workout_duration_min', clamped);
                    }}
                    style={{
                      flex: 1, height: 44, borderRadius: 12,
                      border: `1.5px solid ${OB.lineStrong}`,
                      background: '#fff', color: OB.ink,
                      padding: '0 12px', fontFamily: OB_FONT.mono,
                      fontWeight: 700, fontSize: 16, outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: 11, color: OB.mute, fontWeight: 600 }}>15–180</span>
                </div>
              )}
            </div>

            {/* Time preference */}
            {(() => {
              const openHours = gymHours.filter(h => !h.is_closed);
              const earliestOpen = openHours.length > 0 ? openHours.reduce((min, h) => h.open_time < min ? h.open_time : min, '23:59') : null;
              const latestClose = openHours.length > 0 ? openHours.reduce((max, h) => h.close_time > max ? h.close_time : max, '00:00') : null;

              // Derive Morning window start from the gym's earliest opening hour.
              // Fallback: 6am when no hours set / 24h gym.
              const parseHour = (s) => {
                if (!s) return null;
                const [h] = s.split(':').map(Number);
                return Number.isFinite(h) ? h : null;
              };
              const openHour = parseHour(earliestOpen);
              const morningStart = (openHour == null || openHour >= 12) ? 6 : Math.max(0, openHour);
              const afternoonStart = Math.max(morningStart + 1, 12);
              const eveningStart = Math.max(afternoonStart + 1, 17);

              const closeHour = parseHour(latestClose);
              const closeLabel = closeHour != null && closeHour > 0
                ? (closeHour >= 24 || closeHour === 0 ? '24' : String(closeHour))
                : t('schedule.closeLabel', 'close');

              const windowLabels = {
                morning:   `${morningStart}–${afternoonStart}`,
                afternoon: `${afternoonStart}–${eveningStart}`,
                evening:   `${eveningStart}–${closeLabel}`,
              };

              return (
                <div style={{ marginTop: 22 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <OBLabel>{t('schedule.preferTime')}</OBLabel>
                    {earliestOpen && latestClose && (
                      <span style={{ fontSize: 11, color: OB.sub }}>
                        {t('schedule.gymLabel', 'Gym')}: <span style={{ fontFamily: OB_FONT.mono, color: OB.ink, fontWeight: 700 }}>{earliestOpen.slice(0,5)}–{latestClose.slice(0,5)}</span>
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    {TIME_PREFERENCES.map(tp => {
                      const sel = data.preferred_training_time === tp.value;
                      const Icon = tp.icon;
                      return (
                        <button
                          key={tp.value}
                          type="button"
                          onClick={() => set('preferred_training_time', tp.value)}
                          aria-pressed={sel}
                          style={{
                            padding: '14px 8px', borderRadius: 14, textAlign: 'center',
                            background: sel ? '#fff' : OB.surface,
                            border: `1.5px solid ${sel ? OB.teal : OB.line}`,
                            boxShadow: sel ? '0 0 0 4px rgba(46,196,196,0.12)' : 'none',
                            cursor: 'pointer', transition: 'all 150ms ease',
                          }}
                        >
                          <div style={{ color: sel ? OB.tealDeep : OB.ink, display: 'flex', justifyContent: 'center' }}>
                            <Icon size={22} strokeWidth={2} />
                          </div>
                          <div style={{
                            fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 14,
                            marginTop: 6, color: OB.ink,
                          }}>{t(`schedule.${tp.key}`)}</div>
                          <div style={{
                            fontSize: 11, color: OB.sub, marginTop: 1,
                            fontFamily: OB_FONT.mono, fontWeight: 700,
                          }}>
                            {windowLabels[tp.value]}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            STEP 6 · PRIVACY
            ══════════════════════════════════════════════════════ */}
        {step === 6 && (
          <div className="animate-fade-in">
            {/* Dark hero card */}
            <div style={{
              display: 'flex', gap: 14, alignItems: 'center',
              padding: 18, borderRadius: 18,
              background: OB.ink, color: '#fff',
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: 'rgba(46,196,196,0.2)', color: OB.teal,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Shield size={24} color={OB.teal} />
              </div>
              <div>
                <div style={{ fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 17, letterSpacing: -0.3 }}>
                  {t('dataConsent.heroTitle', 'Your data, your rules.')}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>
                  {t('dataConsent.heroSub', "Three things we'll use. Decline any, change anytime.")}
                </div>
              </div>
            </div>

            {/* 3 cards */}
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { title: t('dataConsent.healthTitle', { defaultValue: 'Health & Fitness' }), sub: t('dataConsent.health'), icon: Activity, bg: OB.tealSoft, fg: OB.tealDeep },
                { title: t('dataConsent.cameraTitle', { defaultValue: 'Camera & Photos' }), sub: t('dataConsent.camera'), icon: Camera, bg: OB.purpleSoft, fg: OB.purple },
                { title: t('dataConsent.analyticsTitle', { defaultValue: 'Analytics' }), sub: t('dataConsent.analytics'), icon: BarChart3, bg: OB.goldSoft, fg: '#9a7e00' },
              ].map(c => {
                const Icon = c.icon;
                return (
                  <div key={c.title} style={{
                    background: OB.surface, borderRadius: 16, padding: 14,
                    border: `1px solid ${OB.line}`,
                    display: 'flex', gap: 12,
                  }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 11, flexShrink: 0,
                      background: c.bg, color: c.fg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon size={20} color={c.fg} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 15, color: OB.ink, letterSpacing: -0.2 }}>
                        {c.title}
                      </div>
                      <div style={{ fontSize: 12, color: OB.sub, marginTop: 2, lineHeight: 1.35 }}>
                        {c.sub}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Privacy policy link */}
            <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12 }}>
              <button
                type="button"
                onClick={() => setShowPrivacyModal(true)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: OB.tealDeep, fontWeight: 700, fontSize: 12,
                  textDecoration: 'underline', textDecorationThickness: 1.5,
                  textUnderlineOffset: 3, display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontFamily: OB_FONT.body,
                }}
              >
                {t('dataConsent.privacyLink')} <ExternalLink size={12} />
              </button>
            </div>

            {consentDeclined && (
              <div style={{
                background: 'rgba(255,90,46,0.08)', border: `1px solid rgba(255,90,46,0.3)`,
                borderRadius: 14, padding: '12px 14px', marginTop: 14,
                display: 'flex', alignItems: 'flex-start', gap: 10,
              }}>
                <AlertTriangle size={16} color={OB.orange} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p style={{ fontSize: 12, color: OB.orange, lineHeight: 1.4, margin: 0 }}>
                    {t('dataConsent.declineWarning')}
                  </p>
                  <button
                    type="button"
                    onClick={handleConsentDeclineContinue}
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: OB.orange, fontWeight: 700, fontSize: 12, padding: 0,
                      marginTop: 6, fontFamily: OB_FONT.body,
                    }}
                  >
                    {t('common:continue')} →
                  </button>
                </div>
              </div>
            )}

            {/* Consent buttons (live inline, not in bottom bar) */}
            <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
              <OBButton tone="ghost" onClick={handleConsentDecline}>
                {t('dataConsent.decline')}
              </OBButton>
              <OBButton full tone="teal" icon={<Check size={16} strokeWidth={2.5}/>} onClick={handleConsentAgree}>
                {t('dataConsent.agree')}
              </OBButton>
            </div>

            <p style={{ fontSize: 11, color: OB.mute, textAlign: 'center', marginTop: 12 }}>
              {t('dataConsent.changeAnytime')}
            </p>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            STEP 7 · HEALTH
            ══════════════════════════════════════════════════════ */}
        {step === 7 && !healthRationaleAck && platform !== 'web' && healthStatus === 'idle' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Permission rationale — explains WHY before triggering the
                native Health permission dialog. User can Continue (proceeds
                to native prompt) or Skip (advances without prompting). */}
            <div style={{
              borderRadius: 22, padding: 22,
              background: OB.surface, border: `1.5px solid ${OB.line}`,
              boxShadow: OB.shadow,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              textAlign: 'center', gap: 14,
            }}>
              <div style={{
                width: 72, height: 72, borderRadius: 20,
                background: '#0a0c0f', color: '#FF375F',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Heart size={36} fill="#FF375F" color="#FF375F" />
              </div>
              <div style={{
                fontFamily: OB_FONT.display, fontWeight: 900, fontSize: 22,
                color: OB.ink, letterSpacing: -0.6, lineHeight: 1.15,
              }}>
                {t('healthRationale.title', { defaultValue: 'Connect {{healthPlatformName}}', healthPlatformName })}
              </div>
              <div style={{ fontSize: 14, color: OB.sub, lineHeight: 1.45, maxWidth: 340 }}>
                {t('healthRationale.body', {
                  defaultValue: 'We use {{healthPlatformName}} to auto-fill your weight and height, sync workouts, and pull heart-rate data during sessions. We never write data without your permission, and you can disconnect any time in Settings.',
                  healthPlatformName,
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <OBButton
                tone="ghost"
                onClick={() => {
                  // Skip: acknowledge rationale + advance without native prompt.
                  setHealthRationaleAck(true);
                  setStep(s => s + 1);
                }}
              >
                {t('common:skip')}
              </OBButton>
              <OBButton
                full
                tone="teal"
                icon={<ArrowRight size={16}/>}
                onClick={() => {
                  setHealthRationaleAck(true);
                  // Defer the native call to the next tick so the rationale
                  // unmounts before the OS dialog appears.
                  setTimeout(() => { handleLinkHealth(); }, 0);
                }}
              >
                {t('common:continue')}
              </OBButton>
            </div>
          </div>
        )}

        {step === 7 && (healthRationaleAck || platform === 'web' || healthStatus !== 'idle') && (
          <div className="animate-fade-in">
            <div style={{
              borderRadius: 22, padding: 22,
              background: OB.surface,
              border: `1.5px solid ${healthStatus === 'linked' ? OB.teal : OB.line}`,
              boxShadow: healthStatus === 'linked' ? '0 0 0 4px rgba(46,196,196,0.1)' : OB.shadow,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 16,
                  background: '#0a0c0f', color: '#FF375F',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Heart size={28} fill="#FF375F" color="#FF375F" />
                </div>
                <div>
                  <div style={{
                    fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 20,
                    color: OB.ink, letterSpacing: -0.5,
                  }}>
                    {platform === 'web' ? t('health.webTitle') : healthPlatformName}
                  </div>
                  <div style={{ fontSize: 13, color: OB.sub, marginTop: 2 }}>
                    {platform === 'web' ? t('health.webDesc') : `${t('health.steps')} · ${t('health.heartRate')} · ${t('health.weight')}`}
                  </div>
                </div>
              </div>

              {/* Connected pill */}
              {healthStatus === 'linked' && (
                <div style={{
                  marginTop: 18, padding: '12px 14px', borderRadius: 12,
                  background: OB.greenSoft,
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: 999,
                    background: OB.green, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Check size={14} strokeWidth={3} />
                  </div>
                  <div style={{ fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 14, color: '#2d5a2d' }}>
                    {t('health.connected', { healthPlatformName })}
                  </div>
                </div>
              )}

              {/* Pre-filled grid */}
              {healthStatus === 'linked' && Object.keys(healthPrefill).length > 0 && (
                <>
                  <div style={{
                    fontSize: 11, color: OB.sub, fontWeight: 800,
                    letterSpacing: 0.5, textTransform: 'uppercase',
                    marginTop: 16, marginBottom: 8,
                  }}>
                    {t('health.prefillTitle')}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {healthPrefill.weight && (
                      <div style={{ background: OB.surface2, borderRadius: 12, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, color: OB.sub, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>{t('bodyStats.weight')}</div>
                        <div style={{ fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 18, color: OB.ink, marginTop: 2, letterSpacing: -0.3 }}>
                          {data.initial_weight_lbs} <span style={{ fontSize: 11, color: OB.mute }}>lb</span>
                        </div>
                      </div>
                    )}
                    {healthPrefill.height && (
                      <div style={{ background: OB.surface2, borderRadius: 12, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, color: OB.sub, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>{t('bodyStats.height')}</div>
                        <div style={{ fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 18, color: OB.ink, marginTop: 2, letterSpacing: -0.3 }}>
                          {data.height_feet}′ {data.height_inches}″
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Connect button */}
              {platform !== 'web' && healthStatus !== 'linked' && (
                <div style={{ marginTop: 18 }}>
                  <OBButton
                    full
                    tone="teal"
                    onClick={handleLinkHealth}
                    disabled={healthStatus === 'linking'}
                    icon={healthStatus === 'linking' ? <Loader2 size={16} className="animate-spin"/> : <Smartphone size={16}/>}
                  >
                    {healthStatus === 'linking' ? t('health.connecting') : t('health.connect', { healthPlatformName })}
                  </OBButton>
                </div>
              )}

              {healthStatus === 'unavailable' && (
                <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: OB.goldSoft }}>
                  <p style={{ fontSize: 13, color: '#9a7e00', margin: 0 }}>
                    {t('health.unavailable', { healthPlatformName })}
                  </p>
                </div>
              )}
              {healthStatus === 'error' && (
                <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,90,46,0.1)' }}>
                  <p style={{ fontSize: 13, color: OB.orange, margin: 0 }}>
                    {t('health.error')}
                  </p>
                </div>
              )}
            </div>

            {/* Read-only note */}
            <div style={{
              marginTop: 14, padding: '12px 14px', borderRadius: 12,
              background: OB.tealSoft, fontSize: 12, color: OB.tealDeep, lineHeight: 1.4,
            }}>
              {t('health.hint')}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            STEP 8 · BODY STATS + INJURIES
            ══════════════════════════════════════════════════════ */}
        {step === 8 && (
          <div className="animate-fade-in">
            {/* Unit system. Setting it here pre-fills KG/LB across the app —
                changeable later from Personal Info. The body-stats inputs
                below display + accept values in the chosen system; internally
                we always normalize to lbs + ft/in so the rest of the
                save/sync code is unchanged. */}
            <OBLabel>{t('bodyStats.unitsLabel', 'Units')}</OBLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
              {[
                { value: false, label: t('bodyStats.unitsImperial', 'English · lb, ft') },
                { value: true,  label: t('bodyStats.unitsMetric', 'International · kg, cm') },
              ].map(opt => {
                const sel = !!data.metric_units === opt.value;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => set('metric_units', opt.value)}
                    aria-pressed={sel}
                    style={{
                      height: 44, borderRadius: 14,
                      background: sel ? '#fff' : OB.surface,
                      border: `1.5px solid ${sel ? OB.teal : OB.line}`,
                      boxShadow: sel ? '0 0 0 4px rgba(46,196,196,0.12)' : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 12.5,
                      color: sel ? OB.tealDeep : OB.ink,
                      cursor: 'pointer', transition: 'all 150ms ease',
                      letterSpacing: -0.1,
                    }}
                  >{opt.label}</button>
                );
              })}
            </div>

            {/* Biological sex */}
            <OBLabel>
              {t('bodyStats.sex')}{' '}
              <span style={{ fontSize: 10, color: OB.mute, textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
                — {t('bodyStats.sexHint')}
              </span>
            </OBLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { value: 'male',   label: t('bodyStats.male') },
                { value: 'female', label: t('bodyStats.female') },
              ].map(opt => {
                const sel = data.sex === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set('sex', opt.value)}
                    aria-pressed={sel}
                    style={{
                      height: 48, borderRadius: 14,
                      background: sel ? '#fff' : OB.surface,
                      border: `1.5px solid ${sel ? OB.teal : OB.line}`,
                      boxShadow: sel ? '0 0 0 4px rgba(46,196,196,0.12)' : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 14,
                      color: sel ? OB.tealDeep : OB.ink,
                      cursor: 'pointer', transition: 'all 150ms ease',
                    }}
                  >{opt.label}</button>
                );
              })}
            </div>

            {/* Age + Weight */}
            <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <OBLabel>{t('bodyStats.age')}</OBLabel>
                <div style={{
                  height: 54, borderRadius: 14, background: OB.surface,
                  border: `1.5px solid ${OB.line}`, padding: '0 16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <input
                    type="number" inputMode="numeric" min={13} max={99}
                    placeholder="25"
                    aria-label={t('bodyStats.age')}
                    aria-invalid={isAgeUnder13 || undefined}
                    value={data.age}
                    onChange={e => set('age', e.target.value)}
                    style={{
                      flex: 1, minWidth: 0, width: '100%',
                      background: 'transparent', border: 'none', outline: 'none',
                      fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 22,
                      color: OB.ink, letterSpacing: -0.5,
                    }}
                  />
                  <div style={{ fontSize: 11, color: OB.mute, fontWeight: 700 }}>yrs</div>
                </div>
                {isAgeUnder13 && (
                  <p
                    role="alert"
                    style={{
                      marginTop: 6,
                      fontSize: 12,
                      color: OB.orange || '#c0392b',
                      fontFamily: OB_FONT.body,
                      fontWeight: 600,
                      lineHeight: 1.4,
                    }}
                  >
                    {t('onboardingAgeUnder13', 'You must be at least 13 to use TuGymPR. Please contact your gym for assistance.')}
                  </p>
                )}
              </div>
              <div>
                <OBLabel
                  badge={healthPrefill.weight ? (
                    <span style={{ padding: '2px 6px', borderRadius: 999, background: OB.greenSoft, color: '#2d5a2d', fontSize: 9, letterSpacing: 0.4 }}>HEALTH</span>
                  ) : null}
                >
                  {t('bodyStats.weight')}
                </OBLabel>
                <div style={{
                  height: 54, borderRadius: 14, background: OB.surface,
                  border: `1.5px solid ${OB.line}`, padding: '0 16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <input
                    type="number" inputMode="decimal" step="0.1"
                    min={data.metric_units ? 23 : 50}
                    max={data.metric_units ? 320 : 700}
                    placeholder={data.metric_units ? '80' : t('bodyStats.weightPlaceholder', '178')}
                    aria-label={t('bodyStats.weight')}
                    value={
                      data.metric_units
                        ? (data.initial_weight_lbs
                            ? (parseFloat(data.initial_weight_lbs) * 0.453592).toFixed(1)
                            : '')
                        : data.initial_weight_lbs
                    }
                    onChange={e => {
                      const v = e.target.value;
                      if (data.metric_units) {
                        // Convert kg → lb on the fly; keep the canonical store in lb
                        set('initial_weight_lbs', v ? (parseFloat(v) * 2.20462).toFixed(1) : '');
                      } else {
                        set('initial_weight_lbs', v);
                      }
                    }}
                    style={{
                      flex: 1, minWidth: 0, width: '100%',
                      background: 'transparent', border: 'none', outline: 'none',
                      fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 22,
                      color: OB.ink, letterSpacing: -0.5,
                    }}
                  />
                  <div style={{ fontSize: 11, color: OB.mute, fontWeight: 700 }}>
                    {data.metric_units ? 'kg' : 'lb'}
                  </div>
                </div>
              </div>
            </div>

            {/* Height */}
            <div style={{ marginTop: 14 }}>
              <OBLabel
                badge={healthPrefill.height ? (
                  <span style={{ padding: '2px 6px', borderRadius: 999, background: OB.greenSoft, color: '#2d5a2d', fontSize: 9, letterSpacing: 0.4 }}>HEALTH</span>
                ) : null}
              >
                {t('bodyStats.height')}
              </OBLabel>
              {data.metric_units ? (
                // One cm input. Convert to ft + in for storage so the rest of
                // the save path stays unchanged.
                <div style={{
                  height: 54, borderRadius: 14, background: OB.surface,
                  border: `1.5px solid ${OB.line}`, padding: '0 16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <input
                    type="number" inputMode="numeric" min={91} max={244}
                    placeholder="175"
                    aria-label={`${t('bodyStats.height')} (cm)`}
                    value={(() => {
                      const ft = parseInt(data.height_feet) || 0;
                      const inches = parseInt(data.height_inches) || 0;
                      const total = ft * 12 + inches;
                      return total > 0 ? String(Math.round(total * 2.54)) : '';
                    })()}
                    onChange={e => {
                      const cm = parseFloat(e.target.value) || 0;
                      const totalInches = cm * 0.393701;
                      const ft = Math.floor(totalInches / 12);
                      const inches = Math.round(totalInches - ft * 12);
                      setData(d => ({
                        ...d,
                        height_feet: cm ? String(ft) : '',
                        height_inches: cm ? String(inches) : '',
                      }));
                    }}
                    style={{
                      flex: 1, minWidth: 0, width: '100%',
                      background: 'transparent', border: 'none', outline: 'none',
                      fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 22,
                      color: OB.ink, letterSpacing: -0.5,
                    }}
                  />
                  <div style={{ fontSize: 11, color: OB.mute, fontWeight: 700 }}>cm</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[
                    { val: data.height_feet,   onChange: v => set('height_feet', v),   label: 'ft', min: 3, max: 8,  ph: '5' },
                    { val: data.height_inches, onChange: v => set('height_inches', v), label: 'in', min: 0, max: 11, ph: '10' },
                  ].map((f, i) => (
                    <div key={i} style={{
                      height: 54, borderRadius: 14, background: OB.surface,
                      border: `1.5px solid ${OB.line}`, padding: '0 16px',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                      <input
                        type="number" inputMode="numeric" min={f.min} max={f.max}
                        placeholder={f.ph}
                        aria-label={`${t('bodyStats.height')} (${f.label})`}
                        value={f.val}
                        onChange={e => f.onChange(e.target.value)}
                        style={{
                          flex: 1, minWidth: 0, width: '100%',
                          background: 'transparent', border: 'none', outline: 'none',
                          fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 22,
                          color: OB.ink, letterSpacing: -0.5,
                        }}
                      />
                      <div style={{ fontSize: 11, color: OB.mute, fontWeight: 700 }}>{f.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Injuries */}
            <div style={{ marginTop: 20 }}>
              <OBLabel>
                {t('bodyStats.injuries')}{' '}
                <span style={{ color: OB.mute, textTransform: 'none', fontWeight: 500, letterSpacing: 0 }}>
                  — {t('bodyStats.injuriesHint')}
                </span>
              </OBLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {INJURY_OPTIONS.map(inj => {
                  const active = data.injury_areas.includes(inj.value);
                  return (
                    <OBChip
                      key={inj.value}
                      selected={active}
                      tone="orange"
                      onClick={() => toggleInjury(inj.value)}
                    >
                      {t(`bodyStats.${inj.key}`)}
                    </OBChip>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: OB.sub, marginTop: 10 }}>
                {data.injury_areas.length > 0 ? (
                  <>
                    <span style={{ fontFamily: OB_FONT.display, fontWeight: 800, color: OB.orange }}>
                      {t('bodyStats.areasCount', { count: data.injury_areas.length })}
                    </span>
                  </>
                ) : (
                  <span>{t('bodyStats.noneSelected')}</span>
                )}
              </div>
            </div>

            {error && (
              <div role="alert" style={{
                background: 'rgba(255,90,46,0.1)', border: `1.5px solid ${OB.orange}`,
                borderRadius: 14, padding: '12px 14px', marginTop: 14,
              }}>
                <p style={{ fontSize: 13, color: OB.orange, margin: 0 }}>{error}</p>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            STEP 9 · PHONE NUMBER (skippable)
            ══════════════════════════════════════════════════════ */}
        {step === 9 && (
          <div className="animate-fade-in">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
              <div style={{ width: 92, flexShrink: 0 }}>
                <OBLabel>{t('phoneStep.countryCode')}</OBLabel>
                <div style={{
                  height: 54, borderRadius: 14, background: OB.surface,
                  border: `1.5px solid ${OB.line}`, padding: '0 14px',
                  display: 'flex', alignItems: 'center',
                }}>
                  <input
                    type="tel"
                    inputMode="numeric"
                    aria-label={t('phoneStep.countryCode')}
                    value={phoneCountryCode}
                    onChange={e => {
                      let v = e.target.value.replace(/[^+\d]/g, '');
                      if (!v.startsWith('+')) v = '+' + v.replace(/\+/g, '');
                      // '+' followed by up to 3 digits
                      v = '+' + v.slice(1).replace(/\D/g, '').slice(0, 3);
                      setPhoneCountryCode(v);
                    }}
                    placeholder="+1"
                    style={{
                      flex: 1, minWidth: 0, width: '100%',
                      background: 'transparent', border: 'none', outline: 'none',
                      fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 18,
                      color: OB.ink, letterSpacing: -0.3,
                    }}
                  />
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <OBLabel>{t('phoneStep.title')}</OBLabel>
                <div style={{
                  height: 54, borderRadius: 14, background: OB.surface,
                  border: `1.5px solid ${OB.line}`, padding: '0 16px',
                  display: 'flex', alignItems: 'center',
                }}>
                  <input
                    type="tel"
                    inputMode="numeric"
                    aria-label={t('phoneStep.title')}
                    value={phoneNumber}
                    onChange={e => setPhoneNumber(e.target.value)}
                    placeholder={t('phoneStep.phonePlaceholder')}
                    style={{
                      flex: 1, minWidth: 0, width: '100%',
                      background: 'transparent', border: 'none', outline: 'none',
                      fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 18,
                      color: OB.ink, letterSpacing: -0.3,
                    }}
                  />
                </div>
              </div>
            </div>
            <p style={{
              fontSize: 12, color: OB.sub, marginTop: 12, lineHeight: 1.4,
            }}>
              {t('phoneStep.subtitle')}
            </p>

            {/* Buttons: Skip (left) + Continue (right) */}
            <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
              <OBButton
                tone="ghost"
                onClick={() => {
                  setPhoneNumber('');
                  setStep(s => s + 1);
                }}
              >
                {t('phoneStep.skip')}
              </OBButton>
              {(() => {
                // Validation: country code is "+" + 1-3 digits, phone has at least 7 digits.
                const ccDigits = (phoneCountryCode || '').replace(/\D/g, '');
                const localDigits = (phoneNumber || '').replace(/\D/g, '');
                const isCcValid = phoneCountryCode.startsWith('+') && ccDigits.length >= 1 && ccDigits.length <= 3;
                const isPhoneValid = localDigits.length >= 7;
                const canContinue = isCcValid && isPhoneValid;
                return (
                  <OBButton
                    full
                    tone="teal"
                    icon={<ArrowRight size={16} />}
                    disabled={!canContinue}
                    onClick={() => setStep(s => s + 1)}
                  >
                    {t('phoneStep.continue')}
                  </OBButton>
                );
              })()}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            STEP 10 · SOCIAL / SQUAD
            ══════════════════════════════════════════════════════ */}
        {step === 10 && (
          <div className="animate-fade-in">
            {/* Referrer banner */}
            {referrerBuddy?.name && (
              <div style={{
                padding: '14px 16px', borderRadius: 16,
                background: OB.surface, border: `1.5px solid ${OB.green}`,
                boxShadow: '0 0 0 4px rgba(94,170,94,0.1)',
                display: 'flex', alignItems: 'center', gap: 12,
                marginBottom: 18,
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: OB.greenSoft, color: '#2d5a2d',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Gift size={22} color={OB.green} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 15,
                    color: OB.ink, letterSpacing: -0.2,
                  }}>
                    {t('social.referredBy', 'Referred by')}{' '}
                    <span style={{ color: '#2d5a2d' }}>{referrerBuddy.name}</span>
                  </div>
                  <div style={{ fontSize: 12, color: OB.sub, marginTop: 1 }}>
                    {t('social.referralApplied', 'Friend added via referral')}
                  </div>
                </div>
                <Check size={18} color={OB.green} strokeWidth={2.5} />
              </div>
            )}

            {/* Referral code input (if no referrer applied yet) */}
            {!referrerBuddy?.name && (
              <div style={{ marginBottom: 22 }}>
                <OBLabel>{t('social.referralCode', 'Referral Code')}</OBLabel>
                <OBInput
                  value={data.workout_buddy_username || ''}
                  onChange={e => {
                    const raw = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 11);
                    let formatted;
                    if (raw.length <= 3) formatted = raw;
                    else if (raw.length <= 7) formatted = `${raw.slice(0, 3)}-${raw.slice(3)}`;
                    else formatted = `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7)}`;
                    set('workout_buddy_username', formatted);
                  }}
                  placeholder="REF-XXXX-XXXX"
                  maxLength={13}
                  icon={<Users size={18} color={OB.mute}/>}
                  monospace
                />
                {data.workout_buddy_username && (
                  <p style={{ fontSize: 11, color: OB.green, marginTop: 6, textAlign: 'center' }}>
                    {t('social.referralWillConnect', "You'll be connected as friends and both earn rewards!")}
                  </p>
                )}
              </div>
            )}

            {/* Feed preview */}
            <div style={{
              fontSize: 11, color: OB.sub, fontWeight: 800,
              letterSpacing: 0.6, textTransform: 'uppercase',
              marginBottom: 10,
            }}>{t('social.feedPreview')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { u: 'Alex',    tx: t('social.mockPR'),      m: t('social.mockPRDetail', { defaultValue: 'Bench Press · 225 lb × 5' }),      ago: t('social.minAgo'),     type: t('social.badgePR',      'PR'),      color: OB.orange, bg: OB.orangeSoft },
                { u: 'Jordan',  tx: t('social.mockSession'), m: t('social.mockSessionDetail', { defaultValue: 'Upper Body · 14 sets · 42 min' }), ago: t('social.minAgo18'),   type: t('social.badgeSession', 'SESSION'), color: OB.teal,   bg: OB.tealSoft },
                { u: 'Morgan',  tx: t('social.mockStreak'),  m: t('social.mockStreakDesc'),       ago: t('social.hrAgo'),      type: t('social.badgeStreak',  'STREAK'),  color: OB.purple, bg: OB.purpleSoft },
              ].map((f, i) => (
                <div key={i} style={{
                  background: OB.surface, borderRadius: 16, padding: 14,
                  border: `1px solid ${OB.line}`,
                  display: 'flex', gap: 12, alignItems: 'center',
                }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: 999,
                    background: `linear-gradient(135deg, ${f.color} 0%, ${f.bg} 100%)`,
                    color: '#fff',
                    fontFamily: OB_FONT.display, fontWeight: 900, fontSize: 16,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>{f.u[0]}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 14, color: OB.ink }}>{f.u}</span>
                      <span style={{ fontSize: 12, color: OB.sub }}>{f.tx}</span>
                    </div>
                    <div style={{
                      fontFamily: OB_FONT.mono, fontSize: 12, color: OB.ink,
                      fontWeight: 700, marginTop: 2,
                    }}>{f.m}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{
                      padding: '3px 8px', borderRadius: 999,
                      background: f.bg, color: f.color,
                      fontSize: 9, fontWeight: 800, letterSpacing: 0.6,
                    }}>{f.type}</div>
                    <div style={{ fontSize: 10, color: OB.mute, marginTop: 4 }}>{f.ago}</div>
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <div role="alert" style={{
                background: 'rgba(255,90,46,0.1)', border: `1.5px solid ${OB.orange}`,
                borderRadius: 14, padding: '12px 14px', marginTop: 14,
              }}>
                <p style={{ fontSize: 13, color: OB.orange, margin: 0 }}>{error}</p>
              </div>
            )}

            <p style={{ fontSize: 11, color: OB.mute, textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>
              {t('disclaimer')}
            </p>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            STEP 11 · PROGRAM (generate + preview)
            ══════════════════════════════════════════════════════ */}
        {step === 11 && !showGeneratePlan && (
          <div className="animate-fade-in" style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            textAlign: 'center', gap: 20, padding: '32px 0',
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: 18,
              background: OB.tealSoft, color: OB.tealDeep,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Sparkles size={28} color={OB.tealDeep} />
            </div>
            <div>
              <div style={{
                fontFamily: OB_FONT.display, fontWeight: 900, fontSize: 24,
                color: OB.ink, letterSpacing: -0.9, lineHeight: 1.1,
              }}>{t('generatePlan.title')}</div>
              <p style={{
                fontSize: 14, color: OB.sub, lineHeight: 1.5,
                marginTop: 8, maxWidth: 340,
              }}>{t('generatePlan.desc')}</p>
            </div>

            {generateError && (
              <div role="alert" style={{
                width: '100%', background: 'rgba(255,90,46,0.1)',
                border: `1.5px solid ${OB.orange}`, borderRadius: 14, padding: '12px 14px',
              }}>
                <p style={{ fontSize: 13, color: OB.orange, textAlign: 'center', margin: 0 }}>{generateError}</p>
              </div>
            )}

            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <OBButton full tone="teal" icon={<Sparkles size={16}/>} onClick={handleGeneratePlan}>
                {t('generatePlan.generate')}
              </OBButton>
              <button
                type="button"
                onClick={handleSkipGeneratePlan}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 13, color: OB.sub, padding: 10,
                  fontFamily: OB_FONT.body, fontWeight: 600,
                }}
              >{t('generatePlan.skip')}</button>
            </div>
          </div>
        )}

        {step === 11 && showGeneratePlan === 'generating' && (
          <div role="status" aria-live="polite" className="animate-fade-in" style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 14, padding: '56px 0',
          }}>
            <Loader2 size={28} color={OB.tealDeep} className="animate-spin"/>
            <p style={{ fontFamily: OB_FONT.display, fontWeight: 700, fontSize: 13, color: OB.sub, letterSpacing: 0.2 }}>
              {planCacheRef.current.promise
                ? t('generatePlan.preparing', 'Preparing your plan…')
                : t('generatePlan.generating')}
            </p>
          </div>
        )}

        {step === 11 && showGeneratePlan === 'done' && (() => {
          return (
          <div className="animate-fade-in">
            {/* GENERATED pill */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', borderRadius: 999,
              background: OB.greenSoft, width: 'fit-content',
              marginBottom: 14,
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: 999,
                background: OB.green, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Check size={11} strokeWidth={3} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#2d5a2d', letterSpacing: 0.3 }}>
                {t('generatePlan.pill', 'PLAN GENERATED')}
              </span>
            </div>

            <div style={{
              fontFamily: OB_FONT.display, fontWeight: 900, fontSize: 26,
              letterSpacing: -1.1, color: OB.ink, lineHeight: 1.05,
            }}>{t('generatePlan.readyHeadline', "Here's your week.")}</div>
            <div style={{ fontSize: 14, color: OB.sub, marginTop: 4 }}>
              {t('generatePlan.programMeta', {
                defaultValue: '{{days}}-day · {{minutes}} min · {{weeks}}-week program',
                days: data.training_days_per_week,
                minutes: data.workout_duration_min,
                weeks: 12,
              })}
            </div>

            {/* 12-week strip. The underlying program is a 2-variant rotation
                (Week A / Week B) that alternates across 12 calendar weeks —
                odd weeks run Variant A, even weeks run Variant B. We surface
                all 12 weeks here so the user actually sees a 12-week program
                instead of just "A vs B". Tapping any week reveals its
                routines; a small Variant-A/B chip on the selected pill
                clarifies what's repeating underneath. */}
            {generatedRoutinesB.length > 0 && (() => {
              const TOTAL_WEEKS = 12;
              return (
                <div style={{
                  display: 'flex', gap: 6, marginTop: 16,
                  overflowX: 'auto', scrollbarWidth: 'none',
                  WebkitOverflowScrolling: 'touch',
                  paddingBottom: 4,
                }}>
                  {Array.from({ length: TOTAL_WEEKS }, (_, i) => {
                    const sel = previewWeekIdx === i;
                    const variant = i % 2 === 0 ? 'A' : 'B';
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setPreviewWeekIdx(i); setPreviewRoutineIdx(0); }}
                        aria-pressed={sel}
                        style={{
                          flex: '0 0 auto',
                          minWidth: 70,
                          height: 48, borderRadius: 12,
                          background: sel ? OB.ink : OB.surface,
                          border: `1.5px solid ${sel ? OB.ink : OB.line}`,
                          color: sel ? '#fff' : OB.ink,
                          fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 13,
                          letterSpacing: -0.1, cursor: 'pointer',
                          transition: 'all 150ms ease',
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center',
                          padding: '0 12px',
                        }}
                      >
                        <span style={{ lineHeight: 1 }}>
                          {t('generatePlan.weekN', { defaultValue: 'Week {{n}}', n: i + 1 })}
                        </span>
                        <span style={{
                          marginTop: 3,
                          fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                          opacity: sel ? 0.8 : 0.5,
                        }}>
                          {variant}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {/* Day tabs + exercise list. Source array swaps between Week A
                and Week B based on the selector above. */}
            {(() => {
              // Odd-index week (= even calendar week, 2/4/6/...) runs Variant B.
              const activeRoutines =
                previewWeekIdx % 2 === 1 && generatedRoutinesB.length > 0
                  ? generatedRoutinesB
                  : generatedRoutines;
              if (activeRoutines.length === 0) return null;
              const clampedIdx = Math.min(previewRoutineIdx, activeRoutines.length - 1);
              const activeRoutine = activeRoutines[clampedIdx];
              return (
              <div>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginTop: 20, marginBottom: 14,
                padding: '10px 6px', background: OB.surface, borderRadius: 14,
                border: `1px solid ${OB.line}`,
              }}>
                <button
                  type="button"
                  onClick={() => setPreviewRoutineIdx(i => Math.max(0, Math.min(i, activeRoutines.length - 1) - 1))}
                  disabled={clampedIdx === 0}
                  style={{
                    width: 32, height: 32, borderRadius: 999, border: 'none',
                    background: OB.surface2, color: OB.mute,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: clampedIdx === 0 ? 'default' : 'pointer',
                    opacity: clampedIdx === 0 ? 0.4 : 1,
                  }}
                >
                  <ChevronLeft size={16} />
                </button>
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    fontFamily: OB_FONT.display, fontWeight: 900, fontSize: 18,
                    color: OB.ink, letterSpacing: -0.4,
                  }}>
                    {activeRoutine?.name?.replace('Auto: ', '') || t('generatePlan.dayFallback', { defaultValue: 'Day {{n}}', n: clampedIdx + 1 })}
                  </div>
                  <div style={{
                    fontSize: 11, color: OB.sub, fontFamily: OB_FONT.mono, marginTop: 1,
                  }}>
                    {t('generatePlan.dayCounter', { defaultValue: 'DAY {{current}} / {{total}}', current: clampedIdx + 1, total: activeRoutines.length })}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewRoutineIdx(i => Math.min(activeRoutines.length - 1, Math.min(i, activeRoutines.length - 1) + 1))}
                  disabled={clampedIdx === activeRoutines.length - 1}
                  style={{
                    width: 32, height: 32, borderRadius: 999, border: 'none',
                    background: OB.ink, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: clampedIdx === activeRoutines.length - 1 ? 'default' : 'pointer',
                    opacity: clampedIdx === activeRoutines.length - 1 ? 0.4 : 1,
                  }}
                >
                  <ChevronLeft size={16} style={{ transform: 'rotate(180deg)' }} />
                </button>
              </div>

              {activeRoutine && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                {activeRoutine.exercises.map((ex, i) => {
                  const palette = [
                    { fg: OB.orange, bg: OB.orangeSoft },
                    { fg: OB.purple, bg: OB.purpleSoft },
                    { fg: OB.tealDeep, bg: OB.tealSoft },
                    { fg: OB.green, bg: OB.greenSoft },
                  ];
                  const c = palette[i % palette.length];
                  return (
                    <div key={i} style={{
                      background: OB.surface, borderRadius: 14, padding: '12px 14px',
                      border: `1px solid ${OB.line}`,
                      display: 'flex', alignItems: 'center', gap: 12,
                    }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: 10,
                        background: c.bg, color: c.fg,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <Dumbbell size={20} color={c.fg} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 14,
                          color: OB.ink, letterSpacing: -0.2,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {i18n.language === 'es' && ex.name_es ? ex.name_es : ex.name}
                        </div>
                        <div style={{
                          fontSize: 11, color: OB.sub, fontFamily: OB_FONT.mono, marginTop: 2,
                        }}>
                          {ex.sets} × {ex.reps} · {ex.restSeconds}s
                        </div>
                      </div>
                      {ex.muscle && (
                        <div style={{
                          padding: '4px 8px', borderRadius: 999,
                          background: c.bg, color: c.fg,
                          fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
                          textTransform: 'uppercase', flexShrink: 0,
                        }}>{t(`muscleGroups.${String(ex.muscle).toLowerCase()}`, { ns: 'pages', defaultValue: ex.muscle })}</div>
                      )}
                    </div>
                  );
                })}
              </div>
              )}

              {activeRoutines.length > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 14 }}>
                  {activeRoutines.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPreviewRoutineIdx(i)}
                      style={{
                        width: i === clampedIdx ? 22 : 6, height: 6, borderRadius: 3,
                        background: i === clampedIdx ? OB.teal : OB.lineStrong,
                        border: 'none', cursor: 'pointer',
                        transition: 'width 200ms ease',
                      }}
                    />
                  ))}
                </div>
              )}
              </div>
              );
            })()}

            <div style={{ marginTop: 20 }}>
              <OBButton full tone="teal" icon={<ArrowRight size={16}/>} onClick={handlePlanDone}>
                {t('generatePlan.looksGood', 'Looks good')}
              </OBButton>
            </div>
          </div>
          );
        })()}

        {/* ══════════════════════════════════════════════════════
            STEP 12 · NUTRITION / MEAL PLAN
            ══════════════════════════════════════════════════════ */}
        {step === 12 && !showMealPlan && (
          <div className="animate-fade-in" style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            textAlign: 'center', gap: 20, padding: '32px 0',
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: 18,
              background: OB.greenSoft, color: OB.green,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <UtensilsCrossed size={28} color={OB.green} />
            </div>
            <div>
              <div style={{
                fontFamily: OB_FONT.display, fontWeight: 900, fontSize: 24,
                color: OB.ink, letterSpacing: -0.9, lineHeight: 1.1,
              }}>{t('mealPlan.askTitle')}</div>
              <p style={{
                fontSize: 14, color: OB.sub, lineHeight: 1.5,
                marginTop: 8, maxWidth: 340,
              }}>{t('mealPlan.askDesc')}</p>
            </div>
            <div style={{
              width: '100%', display: 'flex', flexDirection: 'column', gap: 10,
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
            }}>
              <OBButton full tone="teal" icon={<UtensilsCrossed size={16}/>} onClick={handleMealPlanPrefs}>
                {t('mealPlan.generate')}
              </OBButton>
              <button
                type="button"
                onClick={handleSkipMealPlan}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 13, color: OB.sub, padding: 10,
                  fontFamily: OB_FONT.body, fontWeight: 600,
                }}
              >{t('mealPlan.skip')}</button>
            </div>
          </div>
        )}

        {step === 12 && showMealPlan === 'prefs' && (
          <div className="animate-fade-in">
            <OBHeading title={t('mealPlan.prefsTitle')} sub={t('mealPlan.prefsSubtitle')}/>

            <div style={{ marginBottom: 22 }}>
              <OBLabel>{t('mealPlan.restrictionsLabel')}</OBLabel>
              <p style={{ fontSize: 12, color: OB.sub, marginBottom: 10 }}>{t('mealPlan.restrictionsHint')}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {DIETARY_OPTIONS.map(opt => (
                  <OBChip
                    key={opt.value}
                    selected={dietaryRestrictions.includes(opt.value)}
                    onClick={() => toggleRestriction(opt.value)}
                  >{t(`mealPlan.${opt.key}`)}</OBChip>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 22 }}>
              <OBLabel>{t('mealPlan.allergiesLabel')}</OBLabel>
              <p style={{ fontSize: 12, color: OB.sub, marginBottom: 10 }}>{t('mealPlan.allergiesHint')}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {ALLERGY_OPTIONS.map(opt => (
                  <OBChip
                    key={opt.value}
                    selected={foodAllergies.includes(opt.value)}
                    tone="orange"
                    onClick={() => toggleAllergy(opt.value)}
                  >{t(`mealPlan.${opt.key}`)}</OBChip>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 22 }}>
              <OBLabel>{t('mealPlan.dislikesLabel')}</OBLabel>
              <p style={{ fontSize: 12, color: OB.sub, marginBottom: 10 }}>{t('mealPlan.dislikesHint')}</p>

              <OBInput
                value={ingredientSearch}
                onChange={e => setIngredientSearch(e.target.value)}
                placeholder={t('mealPlan.dislikePlaceholder')}
                icon={<Search size={16} color={OB.mute}/>}
                right={ingredientSearch ? (
                  <button
                    type="button"
                    onClick={() => setIngredientSearch('')}
                    aria-label={t('mealPlan.clearSearch', { defaultValue: 'Clear' })}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}
                  >
                    <X size={14} color={OB.mute}/>
                  </button>
                ) : null}
              />

              {dislikedIngredients.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {dislikedIngredients.map(ing => (
                    <button
                      key={ing}
                      type="button"
                      onClick={() => toggleDislike(ing)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '5px 10px', borderRadius: 999,
                        background: OB.orangeSoft, color: OB.orange,
                        border: `1.5px solid ${OB.orange}`,
                        fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        fontFamily: OB_FONT.body,
                      }}
                    >
                      {formatIngredient(ing)} <X size={12} />
                    </button>
                  ))}
                </div>
              )}

              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 8,
                maxHeight: 180, overflowY: 'auto', marginTop: 10,
              }}>
                {filteredCommonIngredients
                  .filter(i => !dislikedIngredients.includes(i))
                  .map(ing => (
                    <button
                      key={ing}
                      type="button"
                      onClick={() => toggleDislike(ing)}
                      style={{
                        padding: '7px 12px', borderRadius: 999,
                        background: OB.surface, color: OB.ink,
                        border: `1px solid ${OB.line}`,
                        fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        fontFamily: OB_FONT.body,
                      }}
                    >{formatIngredient(ing)}</button>
                  ))}
              </div>
            </div>

            {/* Availability banner */}
            <div style={{
              padding: '12px 14px', borderRadius: 12, marginBottom: 16,
              background: availableMealCount < 30 ? OB.goldSoft : OB.greenSoft,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              {availableMealCount < 30 && <AlertTriangle size={16} color="#9a7e00"/>}
              <p style={{
                fontSize: 13, fontWeight: 700, margin: 0,
                color: availableMealCount < 30 ? '#9a7e00' : '#2d5a2d',
              }}>
                {t('mealPlan.mealsAvailable', { count: availableMealCount })}
              </p>
            </div>

            {mealPlanError && (
              <div role="alert" style={{
                background: 'rgba(255,90,46,0.1)', border: `1.5px solid ${OB.orange}`,
                borderRadius: 14, padding: '12px 14px', marginBottom: 14,
              }}>
                <p style={{ fontSize: 13, color: OB.orange, margin: 0, textAlign: 'center' }}>{mealPlanError}</p>
              </div>
            )}

            <div style={{
              display: 'flex', gap: 12,
              position: 'sticky', bottom: 0,
              paddingTop: 12,
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
              background: `linear-gradient(to top, ${OB.bg} 70%, rgba(240,238,233,0))`,
              zIndex: 5,
            }}>
              <OBButton tone="ghost" icon={<ChevronLeft size={16}/>} onClick={() => setShowMealPlan(false)}>
                {t('common:back')}
              </OBButton>
              <OBButton
                full
                tone="teal"
                icon={<UtensilsCrossed size={16}/>}
                onClick={handleGenerateMealPlan}
                disabled={availableMealCount < 10}
              >
                {t('mealPlan.continueToGenerate')}
              </OBButton>
            </div>
          </div>
        )}

        {step === 12 && showMealPlan === 'generating' && (
          <div role="status" aria-live="polite" className="animate-fade-in" style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 18, padding: '64px 0',
          }}>
            <Loader2 size={36} color={OB.green} className="animate-spin"/>
            <p style={{ fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 15, color: OB.ink }}>
              {t('mealPlan.generating')}
            </p>
          </div>
        )}

        {step === 12 && showMealPlan === 'done' && (
          <div className="animate-fade-in">
            {/* Pill */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', borderRadius: 999,
              background: OB.greenSoft, width: 'fit-content',
              marginBottom: 14,
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: 999,
                background: OB.green, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Check size={11} strokeWidth={3} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#2d5a2d', letterSpacing: 0.3 }}>
                {t('mealPlan.pill', 'MEAL PLAN READY · 7 DAYS')}
              </span>
            </div>

            <div style={{
              fontFamily: OB_FONT.display, fontWeight: 900, fontSize: 26,
              letterSpacing: -1.1, color: OB.ink, lineHeight: 1.05,
            }}>{t('mealPlan.readyHeadline', 'Ready to cook.')}</div>

            {/* Daily macro summary */}
            {mealPlanMacros && (
              <div style={{
                marginTop: 14, padding: '14px 16px', borderRadius: 16,
                background: OB.ink, color: '#fff',
                display: 'flex', alignItems: 'center', gap: 16,
              }}>
                <div>
                  <div style={{
                    fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: 700,
                    letterSpacing: 0.5, textTransform: 'uppercase',
                  }}>{t('mealPlan.caloriesLabel', 'Calories')}</div>
                  <div style={{
                    fontFamily: OB_FONT.display, fontWeight: 900, fontSize: 28,
                    letterSpacing: -1, lineHeight: 1,
                  }}>{mealPlanMacros.calories}</div>
                </div>
                <div style={{ width: 1, height: 46, background: 'rgba(255,255,255,0.15)' }}/>
                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {[
                    ['P', mealPlanMacros.protein, OB.teal],
                    ['C', mealPlanMacros.carbs,   OB.orange],
                    ['F', mealPlanMacros.fat,     OB.gold],
                  ].map(([l, v, c]) => (
                    <div key={l}>
                      <div style={{ fontSize: 9, color: c, fontWeight: 800, letterSpacing: 0.5 }}>{l}</div>
                      <div style={{
                        fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 18, letterSpacing: -0.4,
                      }}>{v}<span style={{ fontSize: 10, opacity: 0.5, fontWeight: 600 }}>g</span></div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Day tabs */}
            {generatedMealPlan && generatedMealPlan.length > 0 && (
              <div style={{
                display: 'flex', gap: 6, marginTop: 16,
                overflowX: 'auto', scrollbarWidth: 'none',
              }}>
                {generatedMealPlan.map((_, i) => {
                  const dayLetters = i18n.language === 'es' ? ['L','M','X','J','V','S','D'] : ['M','T','W','T','F','S','S'];
                  const sel = i === previewDayIdx;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPreviewDayIdx(i)}
                      aria-pressed={sel}
                      style={{
                        width: 44, height: 48, borderRadius: 12, flexShrink: 0,
                        background: sel ? OB.teal : OB.surface,
                        border: `1px solid ${sel ? OB.teal : OB.line}`,
                        color: sel ? '#0A2A2A' : OB.ink,
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer',
                        fontFamily: OB_FONT.display, fontWeight: 900, fontSize: 13,
                      }}
                    >
                      <div>{dayLetters[i % 7]}</div>
                      <div style={{ fontSize: 9, opacity: 0.7, fontWeight: 700 }}>
                        {i + 1}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Meals for selected day */}
            {generatedMealPlan && generatedMealPlan[previewDayIdx] && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                {(generatedMealPlan[previewDayIdx].meals || []).map((meal, mi) => {
                  const mealData = MEALS.find(m => m.id === meal.id) || meal;
                  const title = i18n.language === 'es' && (mealData.title_es || mealData.name_es)
                    ? (mealData.title_es || mealData.name_es)
                    : (mealData.title || mealData.name || t('mealPlan.mealFallback', { defaultValue: 'Meal {{n}}', n: mi + 1 }));
                  const typeLabels = [
                    t('mealPlan.breakfast', 'Breakfast'),
                    t('mealPlan.lunch', 'Lunch'),
                    t('mealPlan.snack', 'Snack'),
                    t('mealPlan.dinner', 'Dinner'),
                  ];
                  const initial = (title || '?').trim()[0]?.toUpperCase() || '?';
                  const palettes = [
                    ['#FFB86B', '#FF7A3D'],
                    ['#7FE3C4', '#2EC4C4'],
                    ['#FFD166', '#F2A23A'],
                    ['#D0C6FF', '#8B7DFF'],
                  ];
                  const [a, b] = palettes[mi % palettes.length];
                  // Resolve image: prefer absolute image_url, else route local /meals path
                  // through Supabase Storage (food-images bucket) via foodImageUrl().
                  const rawImg = mealData.image_url || mealData.image;
                  const resolvedImg = rawImg && rawImg.startsWith('http')
                    ? rawImg
                    : foodImageUrl(rawImg);
                  return (
                    <div key={mi} style={{
                      background: OB.surface, borderRadius: 14, padding: 12,
                      border: `1px solid ${OB.line}`,
                      display: 'flex', alignItems: 'center', gap: 12,
                    }}>
                      <div style={{
                        width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                        background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'rgba(255,255,255,0.95)',
                        fontFamily: OB_FONT.display, fontWeight: 700, fontSize: 20,
                        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)',
                        overflow: 'hidden',
                      }}>
                        {resolvedImg ? (
                          <img
                            src={resolvedImg}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            loading="lazy"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        ) : initial}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 10, color: OB.mute, fontWeight: 800,
                          letterSpacing: 0.5, textTransform: 'uppercase',
                        }}>{typeLabels[mi % typeLabels.length]}</div>
                        <div style={{
                          fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 14,
                          color: OB.ink, letterSpacing: -0.2,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{title}</div>
                        <div style={{
                          display: 'flex', gap: 8, marginTop: 3,
                          fontFamily: OB_FONT.mono, fontSize: 10, color: OB.sub,
                        }}>
                          <span><span style={{ color: OB.ink, fontWeight: 800 }}>{meal.calories || mealData.calories || 0}</span>kc</span>
                          <span><span style={{ color: OB.teal, fontWeight: 800 }}>{meal.protein || mealData.protein || 0}</span>p</span>
                          <span><span style={{ color: OB.orange, fontWeight: 800 }}>{meal.carbs || mealData.carbs || 0}</span>c</span>
                          <span><span style={{ color: '#9a7e00', fontWeight: 800 }}>{meal.fat || mealData.fat || 0}</span>f</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{
              marginTop: 20,
              position: 'sticky', bottom: 0,
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
              background: `linear-gradient(to top, ${OB.bg} 70%, rgba(240,238,233,0))`,
              zIndex: 5,
            }}>
              <OBButton full tone="dark" icon={<ArrowRight size={16}/>} onClick={handleMealPlanDone}>
                {t('mealPlan.goToDashboard', 'Go to Dashboard')}
              </OBButton>
            </div>
          </div>
        )}

        </div>{/* /scroll body */}

        {/* ══════════════════════════════════════════════════════
            CORE NAV (steps 1-5, 7, 8, 10 use bottom bar).
            Step 6 has inline decline/agree buttons above.
            Step 9 (Phone) renders its own Skip + Continue row.
            Steps 11/12 handle their own buttons.
            ══════════════════════════════════════════════════════ */}
        {showCoreNav && (
          <OBBottomBar>
            {canGoBack && (
              <OBButton tone="ghost" icon={<ChevronLeft size={16}/>} onClick={() => setStep(s => s - 1)}>
                {t('common:back')}
              </OBButton>
            )}
            {step < CORE_STEPS - 1 ? (
              <OBButton
                full
                tone="teal"
                icon={<ArrowRight size={16}/>}
                onClick={() => setStep(s => s + 1)}
                disabled={!canAdvance()}
              >
                {t('common:continue')}
              </OBButton>
            ) : (
              <OBButton
                full
                tone="teal"
                icon={saving ? <Loader2 size={16} className="animate-spin"/> : <ArrowRight size={16}/>}
                onClick={handleFinish}
                disabled={saving}
              >
                {saving ? t('common:saving') : t('finish')}
              </OBButton>
            )}
          </OBBottomBar>
        )}

        {/* Skip link for Health / Body steps */}
        {(step === 7 || step === 8) && (
          <button
            type="button"
            onClick={() => setStep(s => s + 1)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 12, color: OB.mute, padding: '8px 0 16px',
              fontFamily: OB_FONT.body, fontWeight: 600,
              textAlign: 'center', width: '100%',
            }}
          >
            {step === 7 ? t('health.skip') : t('common:skip')}
          </button>
        )}

      </div>{/* /container */}

      {/* Privacy Policy Modal */}
      {showPrivacyModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          display: 'flex', flexDirection: 'column',
          background: OB.bg,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: `1px solid ${OB.line}`,
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          }}>
            <h2 style={{
              fontFamily: OB_FONT.display, fontWeight: 800, fontSize: 16,
              color: OB.ink, margin: 0,
            }}>{t('dataConsent.privacyLink')}</h2>
            <button
              type="button"
              onClick={() => setShowPrivacyModal(false)}
              aria-label={t('common:close')}
              style={{
                width: 40, height: 40, borderRadius: 999, border: 'none',
                background: 'transparent', color: OB.sub, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <X size={20}/>
            </button>
          </div>
          <iframe
            src="https://tugympr.com/privacy"
            title={t('dataConsent.privacyLink')}
            style={{ flex: 1, width: '100%', border: 0, background: '#fff' }}
          />
        </div>
      )}
    </main>
  );
};

export default Onboarding;
