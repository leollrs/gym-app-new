import { useEffect, useReducer, useCallback, useMemo, useRef, useState } from 'react';
import { flushSync, createPortal } from 'react-dom';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Save, StickyNote, BarChart3,
  MessageSquare, Bell, Phone, Mail, UserCheck, Plus, X, Dumbbell, Trophy,
  AlertTriangle, BookOpen, ChevronDown, ChevronLeft, ChevronRight, Flame,
  Zap, UtensilsCrossed, ClipboardList, Ruler,
  Loader2, Play, Eye, MessageCircle, Smartphone,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useScrollLock } from '../../hooks/useScrollLock';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useTheme } from '../../contexts/ThemeContext';
import logger from '../../lib/logger';
import { format, subWeeks, subDays, startOfWeek, differenceInWeeks, eachDayOfInterval, startOfMonth, endOfMonth, differenceInCalendarWeeks } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { enUS } from 'date-fns/locale/en-US';
import { useTranslation } from 'react-i18next';
import MonthlyProgressReport from '../../components/MonthlyProgressReport';
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';
import ChartTooltip from '../../components/ChartTooltip';
import { calculateMacros } from '../../lib/macroCalculator';
import { generateDayPlan } from '../../lib/mealPlanner';
import { exercises as EXERCISE_CATALOG } from '../../data/exercises';
import { exName } from '../../lib/exerciseName';
import { normalizePhone, openWhatsApp } from '../../lib/whatsapp';
import TrainerClientRecovery from './components/TrainerClientRecovery';
import TrainerClientPayment from './components/TrainerClientPayment';
import TrainerClientSchedule from './components/TrainerClientSchedule';
import TrainerClientAttendance from './components/TrainerClientAttendance';
import { TT, TFont, avatarIdx } from './components/designTokens';
import { TCard, TPill, TPrimaryButton, TAvatar, TIconButton, TSectionHeader } from './components/designPrimitives';
import CheckinPhotoEditor from '../../components/CheckinPhotoEditor';

// Single source of truth for tab ids — drives the tab bar, the swipe order
// and the ?tab= URL param.
const MEMBER_TAB_ORDER = ['overview', 'programNutrition', 'body', 'notesFollowUp', 'history'];

// Local catalog lookup for resolving exercise ids → localized names without a query.
const EXERCISE_BY_ID = new Map(EXERCISE_CATALOG.map((e) => [e.id, e]));

// --- Reducer ---
const initialState = {
  // Loading / error
  loading: true,
  accessDenied: false,
  isAssigned: false,

  // Client data
  client: null,
  onboarding: null,
  stats: { count: 0 },
  programName: null,
  enrollment: null,
  streak: null,
  nextSession: null, // next upcoming trainer_session (scheduled/confirmed)
  memberGoals: [], // member-set goals (trainer read policy ships in 0527)

  // Workout data
  recentSessions: [],
  personalRecords: [],
  workoutsThisWeek: 0,

  // Body data
  weights: [],
  measurements: null,
  measurementsPrev: null,
  progressPhotos: [],
  checkIns: [],

  // Notes state
  notesData: { notes: '', injuries: '' },
  notesDirty: false, // unsaved local edits — guards against reload clobbering
  notesSaved: false,
  savingNotes: false,

  // Follow-up state
  followups: [],
  showFollowupModal: false,
  fuMethod: 'call',
  fuNote: '',
  fuOutcome: 'no_answer',
  savingFollowup: false,

  // Program state
  availablePrograms: [],
  assigningProgram: false,

  // Nutrition state
  nutritionTargets: null,
  clientNutritionPrefs: { allergies: [], restrictions: [], avoid: [] },
  foodLogSummary: [],
  activeMealPlan: null,
  savingMealPlan: false,
  mealPlanForm: { calories: '', protein: '', carbs: '', fat: '', name: '', description: '' },
  showMealPlanForm: false,
  nutritionLoaded: false,
  generatingMeals: false,

  // UI state
  activeTab: 'overview',
  showReport: false,

  // Live session indicator
  liveDraft: null, // { profile_id, started_at, is_paused, ... } when client has an active draft

  // Body tab state (period selector for weight chart, photo viewer)
  bodyPeriod: 90, // 30 / 90 / 180 / 365
  viewingPhoto: null,

  // History tab state
  historyLoaded: false,
  allSessions: [], // completed workout_sessions (extended list)
  expandedSessionId: null,
  sessionDetails: {}, // session id → { loading, exercises } (cached per session)
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET':
      return { ...state, ...action.payload };
    case 'LOAD_DATA': {
      // Full data refresh. Never clobber notes the trainer is editing — a
      // reload triggered mid-edit (assigning a program, etc.) used to revert
      // the textarea to the page-load snapshot and silently wipe edits.
      const { notesData, ...rest } = action.payload;
      return state.notesDirty ? { ...state, ...rest } : { ...state, ...rest, notesData };
    }
    case 'SET_NOTES_FIELD':
      return { ...state, notesDirty: true, notesData: { ...state.notesData, [action.field]: action.value } };
    case 'SET_MEAL_PLAN_FIELD':
      return { ...state, mealPlanForm: { ...state.mealPlanForm, [action.field]: action.value } };
    case 'SET_MEAL_PLAN_FORM':
      return { ...state, mealPlanForm: { ...state.mealPlanForm, ...action.payload } };
    case 'PREPEND_FOLLOWUP':
      return { ...state, followups: [action.followup, ...state.followups] };
    case 'SET_SESSION_DETAIL':
      return { ...state, sessionDetails: { ...state.sessionDetails, [action.id]: action.detail } };
    case 'REFRESH_VIEWING_PHOTO':
      // Apply a re-signed URL only if the viewer is still showing that photo.
      if (state.viewingPhoto?.id !== action.photo.id) return state;
      return {
        ...state,
        viewingPhoto: action.photo,
        progressPhotos: state.progressPhotos.map((p) => (p.id === action.photo.id ? action.photo : p)),
      };
    default:
      return state;
  }
}

// Reconstruct a goal's label from its STRUCTURED fields so it renders in the
// viewer's language. `member_goals.title` is free text the member auto-generated
// in whatever language was active when they created it — so a Spanish trainer
// would otherwise see English titles. Mirrors GoalsSection's auto-title logic.
// Falls back to the stored title for legacy / lift goals missing the exercise.
function localizeGoalLabel(g, t) {
  if (!g) return '';
  const v = g.target_value != null && g.target_value !== ''
    ? Number(g.target_value).toLocaleString()
    : '?';
  const unitKey = { lift_1rm: 'lbs', body_weight: 'lbs', body_fat: '%', workout_count: 'workouts', streak: 'days', volume: 'lbs' }[g.goal_type];
  const unit = unitKey ? t(`goals.units.${unitKey}`, unitKey) : (g.unit || '');
  switch (g.goal_type) {
    case 'lift_1rm':
      return g.exercises ? `${exName(g.exercises)} ${v} ${unit}` : (g.title || '');
    case 'body_weight':
      return `${t('goals.types.body_weight', 'Body weight')} ${v} ${unit}`;
    case 'body_fat':
      return `${t('goals.types.body_fat', 'Body fat')} ${v}${unit}`;
    case 'workout_count':
      return `${v} ${t('goals.types.workout_count', 'workouts')}`;
    case 'streak':
      return `${v} ${t('goals.types.streak', 'day streak')}`;
    case 'volume':
      return `${v} ${unit} ${t('goals.types.volume', 'volume')}`;
    default:
      return g.title || '';
  }
}

// Read-only program viewer — renders a gym_programs / plan `weeks` JSONB
// (object keyed by week number OR array) as week → day → exercises, resolving
// exercise IDs to localized names. Portaled to <body> so it floats above the
// trainer chrome. Used by the Plan tab's current + available program cards.
function ProgramDetailModal({ program, onClose }) {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const [exMap, setExMap] = useState({});
  const [openWeek, setOpenWeek] = useState(1);
  useScrollLock(!!program); // lock page behind when this modal is showing

  useEffect(() => {
    if (!program) return;
    setOpenWeek(1);
    let alive = true;
    (async () => {
      const ids = new Set();
      const src = program.weeks || {};
      (Array.isArray(src) ? src : Object.values(src)).forEach(days =>
        (days || []).forEach(d => (d.exercises || []).forEach(e => {
          const id = e.id || e.exercise_id;
          if (id) ids.add(id);
        })));
      if (!ids.size) return;
      const { data } = await supabase.from('exercises').select('id, name, name_es').in('id', [...ids]);
      if (!alive) return;
      const map = {};
      (data || []).forEach(e => { map[e.id] = e; });
      setExMap(map);
    })();
    return () => { alive = false; };
  }, [program]);

  if (!program) return null;
  const src = program.weeks || {};
  const weekEntries = Array.isArray(src)
    ? src.map((days, i) => [i + 1, days])
    : Object.entries(src).map(([k, v]) => [Number(k), v]).sort((a, b) => a[0] - b[0]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, borderRadius: 18, width: '100%', maxWidth: 540, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${TT.border}` }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{program.name}</div>
            <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 1 }}>
              {program.duration_weeks ? t('trainerClientDetail.weekProgram', '{{n}}-week program', { n: program.duration_weeks }) : `${weekEntries.length} ${t('trainerNotes.program.weeks', 'weeks')}`}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common:close', 'Close')}
            style={{ width: 36, height: 36, borderRadius: 10, background: TT.surface2, border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0, color: TT.textSub }}>
            <X size={17} strokeWidth={2.2} />
          </button>
        </div>
        <div style={{ padding: 14, overflowY: 'auto', flex: 1 }}>
          {weekEntries.length === 0 ? (
            <p style={{ fontSize: 13, color: TT.textMute, textAlign: 'center', padding: '24px 0' }}>{t('trainerClientDetail.program.empty', 'This program has no content yet.')}</p>
          ) : weekEntries.map(([wk, days]) => {
            const open = openWeek === wk;
            return (
              <div key={wk} style={{ marginBottom: 8, border: `1px solid ${TT.border}`, borderRadius: 12, overflow: 'hidden', background: TT.surface2 }}>
                <button type="button" onClick={() => setOpenWeek(open ? null : wk)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 13px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: TT.text, fontFamily: TFont.display }}>{t('trainerClientDetail.weekN', 'Week {{w}}', { w: wk })}</span>
                  <ChevronDown size={17} strokeWidth={2.4} color={TT.textSub} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                </button>
                {open && (
                  <div style={{ padding: '0 11px 11px' }}>
                    {(days || []).length === 0 ? (
                      <p style={{ fontSize: 12, color: TT.textMute, padding: '4px 2px 8px' }}>{t('trainerClientDetail.program.restWeek', 'Rest / no sessions')}</p>
                    ) : (days || []).map((d, di) => (
                      <div key={di} style={{ background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: 10, padding: 11, marginTop: 8 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: TT.accentInk, marginBottom: (d.exercises || []).length ? 8 : 0 }}>
                          {d.name || t('trainerClientDetail.dayN', 'Day {{n}}', { n: di + 1 })}
                        </div>
                        {(d.exercises || []).map((e, ei) => {
                          const exId = e.id || e.exercise_id;
                          const nm = exName(exMap[exId]) || e.name || t('trainerNotes.overview.unknownExercise', 'Exercise');
                          return (
                            <div key={ei} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderTop: ei > 0 ? `1px solid ${TT.border}` : 'none' }}>
                              <span style={{ fontSize: 12.5, color: TT.text, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nm}</span>
                              <span style={{ fontSize: 11.5, color: TT.textSub, fontFamily: TFont.mono, flexShrink: 0 }}>
                                {(e.sets ?? '—')} × {(e.reps ?? '—')}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function TrainerClientNotes() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  // Back = return to wherever the user came from (Home, Clients list, a search,
  // …) rather than always dumping them on the Clients list. Falls back to the
  // Clients list only on a cold deep-link with no in-app history to pop.
  const goBack = () => {
    const idx = window.history.state?.idx;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else navigate('/trainer/clients');
  };
  const { profile } = useAuth();
  const { showToast } = useToast();
  const { isDark: isDarkTheme } = useTheme();
  const { t, i18n } = useTranslation(['pages', 'common']);
  const dateFnsLocale = i18n.language?.startsWith('es') ? es : enUS;
  const [searchParams, setSearchParams] = useSearchParams();
  // Lazy init: restore the active tab from ?tab= so refresh / deep-links land
  // on the same tab instead of always resetting to Overview.
  const [state, dispatch] = useReducer(reducer, initialState, (init) => {
    if (typeof window === 'undefined') return init;
    const urlTab = new URLSearchParams(window.location.search).get('tab');
    return urlTab && MEMBER_TAB_ORDER.includes(urlTab) ? { ...init, activeTab: urlTab } : init;
  });
  const notesSavedTimerRef = useRef(null);
  // Raw trainer_clients.notes as last fetched/saved — loadClientData re-derives
  // notesData from this, so it MUST be refreshed after a successful save or a
  // reload (e.g. assigning a program) reverts the textarea to page-load text.
  const assignmentNotesRef = useRef(null);
  // Tab-swipe gesture state (declared here with other hooks — must run before
  // the loading/notFound early returns to keep hook order stable).
  const swipeRef = useRef({ x: 0, y: 0, active: false, horiz: false, dx: 0, width: 0, settling: false });
  // Paged lists — heavy tabs render 5 rows at a time ("Ver más" steps by 5)
  // so a long history can't bloat the DOM and stall the page.
  const [prVisible, setPrVisible] = useState(5);
  const [showContactSheet, setShowContactSheet] = useState(false);
  const [logVisible, setLogVisible] = useState(5);
  // Nutrition compliance week navigation. 0 = current rolling 7 days; each step
  // back is one more week. We fetch 8 weeks up-front, so paging is client-side.
  const [nutWeekOffset, setNutWeekOffset] = useState(0);
  // Program detail modal (tap a program card to inspect its weeks/days).
  const [viewProgram, setViewProgram] = useState(null);
  // Body-measurement editing (gated on the member's allow_trainer_measurements).
  const [editMeas, setEditMeas] = useState(null); // null = closed; object = form
  const [savingMeas, setSavingMeas] = useState(false);
  // Client nutrition preferences editing (writes member_onboarding → reflects on
  // the member's planner). null = closed; { allergies:[], restrictions:[] } = open.
  const [editPrefs, setEditPrefs] = useState(null);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [avoidInput, setAvoidInput] = useState('');
  // "Use one of my existing meal plans" picker.
  const [planPicker, setPlanPicker] = useState(false);
  const [myMealPlans, setMyMealPlans] = useState(null); // null = not loaded
  const [copyingPlanId, setCopyingPlanId] = useState(null);
  useEffect(() => { setPrVisible(5); setLogVisible(5); }, [clientId]);
  const swipeViewportRef = useRef(null);
  const trackRef = useRef(null);
  // True while a horizontal drag/settle is live — mounts the neighbor tab
  // panels so the incoming page is visible as the finger drags.
  const [swipeDrag, setSwipeDrag] = useState(false);

  // Destructure for readability in JSX
  const {
    loading, accessDenied, isAssigned, client, onboarding, stats, programName, enrollment, streak, nextSession,
    memberGoals, recentSessions, personalRecords, workoutsThisWeek,
    weights, measurements, measurementsPrev, progressPhotos, checkIns,
    notesData, notesSaved, savingNotes,
    followups, showFollowupModal, fuMethod, fuNote, fuOutcome, savingFollowup,
    availablePrograms, assigningProgram,
    nutritionTargets, clientNutritionPrefs, foodLogSummary, activeMealPlan, savingMealPlan, mealPlanForm, showMealPlanForm, nutritionLoaded, generatingMeals,
    activeTab, showReport,
    liveDraft, bodyPeriod, viewingPhoto,
    historyLoaded, allSessions, expandedSessionId, sessionDetails,
  } = state;

  useEffect(() => { document.title = t('trainerNotes.pageTitle'); }, [t]);

  // Keep the active tab in the URL (?tab=) so refresh / deep-links restore it.
  useEffect(() => {
    const current = searchParams.get('tab') || 'overview';
    if (current === activeTab) return;
    const next = new URLSearchParams(searchParams);
    if (activeTab === 'overview') next.delete('tab');
    else next.set('tab', activeTab);
    setSearchParams(next, { replace: true });
  }, [activeTab, searchParams, setSearchParams]);

  // Cleanup notesSaved timer on unmount
  useEffect(() => {
    return () => {
      if (notesSavedTimerRef.current) clearTimeout(notesSavedTimerRef.current);
    };
  }, []);

  // Phase 1: verify trainer ↔ client assignment BEFORE any data queries fire.
  const checkAssignment = useCallback(async () => {
    // Fresh client load — any dirty-notes state belongs to the previous client.
    dispatch({ type: 'SET', payload: { loading: true, accessDenied: false, isAssigned: false, notesDirty: false } });
    try {
      const { data: assignment } = await supabase
        .from('trainer_clients')
        .select('id, notes')
        .eq('trainer_id', profile.id)
        .eq('client_id', clientId)
        .eq('gym_id', profile.gym_id)
        .eq('is_active', true)
        .maybeSingle();

      if (!assignment) {
        dispatch({ type: 'SET', payload: { accessDenied: true, loading: false, isAssigned: false } });
        return;
      }

      // Assignment confirmed — store notes and set flag so data queries can proceed.
      assignmentNotesRef.current = assignment.notes;
      dispatch({ type: 'SET', payload: { isAssigned: true } });
    } catch (err) {
      logger.error('Error checking assignment:', err);
      dispatch({ type: 'SET', payload: { loading: false } });
    }
  }, [clientId, profile?.id, profile?.gym_id]);

  // Phase 2: load all client data — only runs after isAssigned is true.
  const loadClientData = useCallback(async () => {
    const assignmentNotes = assignmentNotesRef.current;
    try {
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
      const oneYearAgo = subDays(new Date(), 366).toISOString();

      const [
        clientRes, statsRes, weightsRes, measRes, streakRes, followupsRes,
        recentRes, prsRes, onbRes, thisWeekRes, nextSessionRes,
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, username, phone_number, last_active_at, created_at, assigned_program_id, checkin_photo_path, allow_trainer_measurements')
          .eq('id', clientId)
          .single(),
        supabase
          .from('workout_sessions')
          .select('id')
          .eq('profile_id', clientId)
          .eq('status', 'completed'),
        // Full year of weight logs so the Body tab's 365d view isn't truncated
        // (the old latest-50 cap cut off frequent loggers after ~2 months).
        supabase
          .from('body_weight_logs')
          .select('weight_lbs, logged_at')
          .eq('profile_id', clientId)
          .gte('logged_at', oneYearAgo)
          .order('logged_at', { ascending: false })
          .limit(400),
        supabase
          .from('body_measurements')
          .select('*')
          .eq('profile_id', clientId)
          .order('measured_at', { ascending: false })
          .limit(2),
        supabase
          .from('streak_cache')
          .select('current_streak_days, last_activity_date')
          .eq('profile_id', clientId)
          .maybeSingle(),
        supabase
          .from('trainer_followups')
          .select('id, method, note, outcome, created_at')
          .eq('trainer_id', profile.id)
          .eq('client_id', clientId)
          .order('created_at', { ascending: false })
          .limit(50),
        // Recent 5 sessions for overview
        supabase
          .from('workout_sessions')
          .select('id, name, started_at, total_volume_lbs, duration_seconds')
          .eq('profile_id', clientId)
          .eq('status', 'completed')
          .order('started_at', { ascending: false })
          .limit(5),
        // Personal records
        supabase
          .from('personal_records')
          .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name, name_es)')
          .eq('profile_id', clientId)
          .order('achieved_at', { ascending: false })
          .limit(20),
        // Onboarding data for client summary
        supabase
          .from('member_onboarding')
          .select('*')
          .eq('profile_id', clientId)
          .maybeSingle(),
        // Workouts this week
        supabase
          .from('workout_sessions')
          .select('id')
          .eq('profile_id', clientId)
          .eq('status', 'completed')
          .gte('started_at', weekStart.toISOString()),
        // Next genuinely-scheduled upcoming session (drives the "Next session" card)
        supabase
          .from('trainer_sessions')
          .select('id, title, scheduled_at, duration_mins, status')
          .eq('trainer_id', profile.id)
          .eq('client_id', clientId)
          .in('status', ['scheduled', 'confirmed'])
          .gte('scheduled_at', new Date().toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);

      // Resolve the assigned program id now; the program name + enrollment are
      // fetched IN the parallel batch below instead of as two extra serial
      // round-trips between the two Promise.all batches.
      const assignedProgramId = clientRes.data?.assigned_program_id || null;

      // Parse notes - gracefully handle plain string vs JSON
      // Merge old preferences and goalReminders into coach notes
      let parsedNotes = { notes: '', injuries: '' };
      if (assignmentNotes) {
        try {
          const parsed = JSON.parse(assignmentNotes);
          if (typeof parsed === 'object' && parsed !== null) {
            const mergedNotes = [
              parsed.notes || '',
              parsed.preferences ? `\n\n--- ${t('trainerNotes.notes.preferencesHeader', 'Preferences')} ---\n${parsed.preferences}` : '',
              parsed.goalReminders ? `\n\n--- ${t('trainerNotes.notes.goalRemindersHeader', 'Goal Reminders')} ---\n${parsed.goalReminders}` : '',
            ].join('').trim();
            parsedNotes = {
              notes: mergedNotes,
              injuries: parsed.injuries || '',
            };
          } else {
            parsedNotes = { notes: assignmentNotes, injuries: '' };
          }
        } catch {
          parsedNotes = { notes: assignmentNotes, injuries: '' };
        }
      }

      // Load available programs, progress photos, check-ins, member goals, AND
      // the assigned program name + enrollment all in parallel (program
      // name/enrollment were previously two serial hops between batches).
      const [progsRes, photosRes, checkInsRes, goalsRes, progNameRes, enrRes] = await Promise.all([
        supabase
          .from('gym_programs')
          .select('id, name, duration_weeks, weeks')
          .eq('gym_id', profile.gym_id)
          .eq('is_published', true)
          .order('name'),
        supabase
          .from('progress_photos')
          .select('id, storage_path, view_angle, taken_at')
          .eq('profile_id', clientId)
          .order('taken_at', { ascending: false })
          .limit(12),
        // Current-month check-ins (drives "Monthly visits"). The old
        // latest-30-overall query undercounted multi-scan members.
        supabase
          .from('check_ins')
          .select('id, checked_in_at, method')
          .eq('profile_id', clientId)
          .gte('checked_in_at', startOfMonth(new Date()).toISOString())
          .lte('checked_in_at', endOfMonth(new Date()).toISOString())
          .order('checked_in_at', { ascending: false })
          .limit(500),
        // Member-set goals (read-only; trainer SELECT policy ships in 0527 —
        // on { error } we just hide the section).
        supabase
          .from('member_goals')
          .select('id, title, goal_type, target_value, current_value, start_value, unit, target_date, achieved_at, created_at, exercise_id, exercises(name, name_es)')
          .eq('profile_id', clientId)
          .order('created_at', { ascending: false })
          .limit(12),
        assignedProgramId
          ? supabase.from('gym_programs').select('name').eq('id', assignedProgramId).single()
          : Promise.resolve({ data: null }),
        assignedProgramId
          ? supabase
              .from('gym_program_enrollments')
              .select('enrolled_at, gym_programs(name, duration_weeks, weeks)')
              .eq('profile_id', clientId)
              .eq('program_id', assignedProgramId)
              .order('enrolled_at', { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const loadedProgramName = progNameRes.data?.name || null;
      const loadedEnrollment = enrRes.data || null;

      // Batch all photo signed URLs into ONE request (was one round-trip per
      // photo). 6h expiry so long-open tabs don't go stale mid-review; the
      // fullscreen viewer re-signs on open as a further backstop.
      const photoPaths = (photosRes.data || []).map((p) => p.storage_path);
      let signedByPath = {};
      if (photoPaths.length) {
        const { data: signed } = await supabase.storage
          .from('progress-photos')
          .createSignedUrls(photoPaths, 21600);
        (signed ?? []).forEach((s) => { if (s.signedUrl) signedByPath[s.path] = s.signedUrl; });
      }
      const photosWithUrls = (photosRes.data || []).map((photo) => ({
        ...photo,
        signedUrl: signedByPath[photo.storage_path] || '',
      }));

      dispatch({
        type: 'LOAD_DATA',
        payload: {
          client: clientRes.data,
          stats: { count: (statsRes.data || []).length },
          programName: loadedProgramName,
          enrollment: loadedEnrollment,
          weights: weightsRes.data || [],
          measurements: measRes.data?.[0] || null,
          measurementsPrev: measRes.data?.[1] || null,
          streak: streakRes.data || null,
          followups: followupsRes.data || [],
          recentSessions: recentRes.data || [],
          personalRecords: prsRes.data || [],
          onboarding: onbRes.data || null,
          nextSession: nextSessionRes.data || null,
          workoutsThisWeek: thisWeekRes.data?.length || 0,
          memberGoals: goalsRes.error ? [] : (goalsRes.data || []),
          availablePrograms: progsRes.data || [],
          progressPhotos: photosWithUrls,
          checkIns: checkInsRes.data || [],
          notesData: parsedNotes,
          loading: false,
        },
      });
    } catch (err) {
      logger.error('Error loading client data:', err);
      dispatch({ type: 'SET', payload: { loading: false } });
    }
  }, [clientId, profile?.id, profile?.gym_id, t]);

  // Phase 1: run assignment check whenever clientId / trainer changes.
  useEffect(() => {
    if (clientId && profile?.id) {
      checkAssignment();
    }
  }, [clientId, profile?.id, checkAssignment]);

  // Phase 2: only fire data queries after assignment is confirmed (enabled: !!isAssigned).
  useEffect(() => {
    if (isAssigned) {
      loadClientData();
    }
  }, [isAssigned, loadClientData]);

  // Check for an active session_drafts row for this client. Drives the
  // "Watch live" pill + the "Start" button precheck.
  // Filter on updated_at within the last 6 hours so a stale draft from days
  // ago doesn't keep saying the client is "live".
  const checkLiveDraft = useCallback(async () => {
    if (!clientId) return;
    try {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('session_drafts')
        .select('profile_id, routine_id, started_at, updated_at, is_paused')
        .eq('profile_id', clientId)
        .gte('updated_at', sixHoursAgo)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      dispatch({ type: 'SET', payload: { liveDraft: data || null } });
    } catch (err) {
      logger.error('Error checking live draft:', err);
    }
  }, [clientId]);

  useEffect(() => {
    if (isAssigned) checkLiveDraft();
  }, [isAssigned, checkLiveDraft]);

  // Realtime: pick up the live indicator the moment the client starts a
  // session — without this, the trainer has to refresh the page to see it.
  // Any received event just re-runs the authoritative check instead of
  // patching state from the payload: DELETE payloads only carry the PK (no
  // profile_id), so they can't be trusted to clear/patch the pill — and with
  // the profile_id filter they may not be delivered at all. A 60s poll
  // backstops both that and session_drafts not being in the realtime
  // publication yet (added in migration 0527).
  useEffect(() => {
    if (!isAssigned || !clientId) return;
    const channel = supabase
      .channel(`trainer-client-live-${clientId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'session_drafts', filter: `profile_id=eq.${clientId}` },
        () => { checkLiveDraft(); })
      .subscribe();
    const pollId = setInterval(() => { checkLiveDraft(); }, 60000);
    return () => { supabase.removeChannel(channel); clearInterval(pollId); };
  }, [isAssigned, clientId, checkLiveDraft]);

  // Bug 3: Start/Watch live session — precheck draft first.
  // - If a draft exists -> navigate to /trainer/live/:clientId (spectator)
  // - If no draft -> show toast and stay put (no auto-redirect)
  const handleStartLiveSession = useCallback(async () => {
    try {
      // Same ≤6h freshness window as the live pill — a days-old abandoned
      // draft should toast "hasn't started", not open a dead spectator view.
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: latest } = await supabase
        .from('session_drafts')
        .select('profile_id')
        .eq('profile_id', clientId)
        .gte('updated_at', sixHoursAgo)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest) {
        navigate(`/trainer/live/${clientId}`);
      } else {
        showToast(
          t('trainerClientDetail.live.noActiveSession', "Client hasn't started a session yet"),
          'info'
        );
      }
    } catch (err) {
      logger.error('Error starting live session:', err);
      showToast(t('trainerNotes.errors.genericError', 'Something went wrong'), 'error');
    }
  }, [clientId, navigate, showToast, t]);

  // History tab: load extended workout history on first activation
  const loadHistoryData = useCallback(async () => {
    if (historyLoaded || !clientId) return;
    try {
      const sixMonthsAgo = subWeeks(new Date(), 26).toISOString();
      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('id, name, started_at, completed_at, duration_seconds, total_volume_lbs, status')
        .eq('profile_id', clientId)
        .eq('status', 'completed')
        .gte('started_at', sixMonthsAgo)
        .order('started_at', { ascending: false })
        .limit(100);
      dispatch({
        type: 'SET',
        payload: {
          allSessions: sessions || [],
          historyLoaded: true,
        },
      });
    } catch (err) {
      logger.error('Error loading history data:', err);
      dispatch({ type: 'SET', payload: { historyLoaded: true } });
    }
  }, [clientId, historyLoaded]);

  useEffect(() => {
    if (activeTab === 'history' && clientId && isAssigned) {
      loadHistoryData();
    }
  }, [activeTab, clientId, isAssigned, loadHistoryData]);

  const loadNutritionData = useCallback(async () => {
    if (nutritionLoaded) return;
    try {
      // 8 weeks of logs so the compliance card can page back week-by-week
      // without refetching (windowed client-side by nutWeekOffset).
      const eightWeeksAgo = subDays(new Date(), 56).toISOString().split('T')[0];
      const [targetsRes, logsRes, mealPlanRes, prefsRes, dislikedRes] = await Promise.all([
        supabase
          .from('nutrition_targets')
          .select('daily_calories, daily_protein_g, daily_carbs_g, daily_fat_g, updated_at')
          .eq('profile_id', clientId)
          .maybeSingle(),
        supabase
          .from('food_logs')
          .select('log_date, calories, protein_g, carbs_g, fat_g')
          .eq('profile_id', clientId)
          .gte('log_date', eightWeeksAgo)
          .order('log_date'),
        // Newest active plan. Deliberately NOT .maybeSingle(): legacy data can
        // hold several active rows (TrainerPlans used to stack them) and
        // maybeSingle() errors on 2+ rows → the card showed "No plan".
        supabase
          .from('trainer_meal_plans')
          .select('*')
          .eq('trainer_id', profile.id)
          .eq('client_id', clientId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1),
        // Client nutrition preferences (editable by the trainer) — same source
        // the member's planner reads, so edits reflect on the member side.
        supabase
          .from('member_onboarding')
          .select('food_allergies, dietary_restrictions')
          .eq('profile_id', clientId)
          .maybeSingle(),
        supabase
          .from('disliked_foods')
          .select('food_name')
          .eq('profile_id', clientId),
      ]);

      // Aggregate food logs by day
      const dayMap = {};
      (logsRes.data || []).forEach(log => {
        if (!dayMap[log.log_date]) dayMap[log.log_date] = { date: log.log_date, calories: 0, protein: 0, carbs: 0, fat: 0 };
        dayMap[log.log_date].calories += Number(log.calories) || 0;
        dayMap[log.log_date].protein += Number(log.protein_g) || 0;
        dayMap[log.log_date].carbs += Number(log.carbs_g) || 0;
        dayMap[log.log_date].fat += Number(log.fat_g) || 0;
      });

      if (mealPlanRes.error) logger.error('Error loading active meal plan:', mealPlanRes.error);
      const loadedActivePlan = mealPlanRes.data?.[0] || null;

      // Pre-fill meal plan form from active plan
      let loadedMealPlanForm = state.mealPlanForm;
      if (loadedActivePlan) {
        loadedMealPlanForm = {
          calories: loadedActivePlan.target_calories?.toString() || '',
          protein: loadedActivePlan.target_protein_g?.toString() || '',
          carbs: loadedActivePlan.target_carbs_g?.toString() || '',
          fat: loadedActivePlan.target_fat_g?.toString() || '',
          name: loadedActivePlan.name || '',
          description: loadedActivePlan.description || '',
        };
      }

      dispatch({
        type: 'SET',
        payload: {
          nutritionTargets: targetsRes.data || null,
          activeMealPlan: loadedActivePlan,
          clientNutritionPrefs: {
            allergies: prefsRes?.data?.food_allergies || [],
            restrictions: prefsRes?.data?.dietary_restrictions || [],
            avoid: (dislikedRes?.data || []).map(d => d.food_name).filter(Boolean),
          },
          foodLogSummary: Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date)),
          mealPlanForm: loadedMealPlanForm,
          nutritionLoaded: true,
        },
      });
    } catch (err) {
      logger.error('Error loading nutrition data:', err);
    }
  }, [clientId, profile?.id, nutritionLoaded, state.mealPlanForm]);

  useEffect(() => {
    if (activeTab === 'programNutrition' && clientId && profile?.id) {
      loadNutritionData();
    }
  }, [activeTab, clientId, profile?.id, loadNutritionData]);

  // Auto-calculate macro targets from real client data.
  // The app writes `sex` + `height_inches` to member_onboarding (see
  // PersonalInfo.jsx); `gender` / `height_cm` are legacy fallbacks only.
  // Weight: latest body_weight_logs entry (weights[0], desc-ordered), then kg.
  function handleAutoCalculate() {
    const weightLbs = weights[0]?.weight_lbs || (onboarding?.weight_kg ? onboarding.weight_kg * 2.20462 : null);
    if (!weightLbs) return;
    const heightInches = onboarding?.height_inches || (onboarding?.height_cm ? onboarding.height_cm / 2.54 : 68);
    const age = onboarding?.age || 30;
    const sex = (onboarding?.sex || onboarding?.gender) === 'female' ? 'female' : 'male';
    const trainingDays = onboarding?.training_days_per_week || 4;
    const goal = onboarding?.primary_goal || 'general_fitness';

    const result = calculateMacros({ weightLbs, heightInches, age, sex, trainingDays, goal });
    dispatch({
      type: 'SET_MEAL_PLAN_FORM',
      payload: {
        calories: result.calories.toString(),
        protein: result.protein.toString(),
        carbs: result.carbs.toString(),
        fat: result.fat.toString(),
        name: mealPlanForm.name || `${t(`trainerNotes.goals.${goal}`, goal.replace(/_/g, ' '))} ${t('trainerNotes.nutrition.planSuffix', 'Plan')}`,
      },
    });
    return result;
  }

  // Auto-generate full meal plan with sample meals
  async function handleAutoGenerateMeals() {
    dispatch({ type: 'SET', payload: { generatingMeals: true } });
    try {
      const macros = handleAutoCalculate();
      if (!macros) { dispatch({ type: 'SET', payload: { generatingMeals: false } }); return; }

      const plan = generateDayPlan({
        targets: macros,
        slots: 3,
        favorites: [],
        excludeIds: [],
      });

      if (plan?.meals) {
        // Generated meals carry a `slot` tag (breakfast/lunch/snack/dinner);
        // `type` is only a legacy fallback. Map to the localized slot labels.
        const SLOT_KEYS = ['breakfast', 'lunch', 'snack', 'dinner'];
        const mealDesc = plan.meals.map(m => {
          const slotKey = m.slot ?? m.type;
          const label = SLOT_KEYS.includes(slotKey)
            ? t(`nutrition.meals.${slotKey}`, slotKey)
            : (slotKey || t('trainerNotes.nutrition.meal'));
          return `${label}: ${m.name} (${Math.round(m.calories)} cal)`;
        }).join('\n');
        dispatch({
          type: 'SET',
          payload: {
            showMealPlanForm: true,
          },
        });
        dispatch({
          type: 'SET_MEAL_PLAN_FORM',
          payload: {
            description: `${t('trainerNotes.nutrition.sampleDay')}:\n${mealDesc}`,
          },
        });
      } else {
        dispatch({ type: 'SET', payload: { showMealPlanForm: true } });
      }
    } catch (err) {
      logger.error('Error generating meal plan:', err);
    } finally {
      dispatch({ type: 'SET', payload: { generatingMeals: false } });
    }
  }

  async function handleSaveMealPlan() {
    if (!profile?.id || savingMealPlan) return;
    dispatch({ type: 'SET', payload: { savingMealPlan: true } });
    try {
      // Editing the assigned plan = a real UPDATE on the same row (keeps the
      // start date, no replace-with-copy). Only brand-new assignments go
      // through the deactivate+insert path below.
      if (activeMealPlan?.id) {
        const { data, error } = await supabase
          .from('trainer_meal_plans')
          .update({
            name: mealPlanForm.name || t('trainerNotes.nutrition.customPlan'),
            description: mealPlanForm.description || null,
            target_calories: parseInt(mealPlanForm.calories) || null,
            target_protein_g: parseInt(mealPlanForm.protein) || null,
            target_carbs_g: parseInt(mealPlanForm.carbs) || null,
            target_fat_g: parseInt(mealPlanForm.fat) || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', activeMealPlan.id)
          .select()
          .single();
        if (error) throw error;
        dispatch({ type: 'SET', payload: { activeMealPlan: data, showMealPlanForm: false, savingMealPlan: false } });
        return;
      }

      // Single-active invariant: deactivate ALL of this client's currently
      // active plans (legacy data can hold several — TrainerPlans used to
      // stack actives). RLS scopes the update to this trainer's own rows.
      // Abort on failure so we never insert a duplicate active.
      const { error: deactivateErr } = await supabase
        .from('trainer_meal_plans')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('client_id', clientId)
        .eq('is_active', true);
      if (deactivateErr) throw deactivateErr;

      const payload = {
        gym_id: profile.gym_id,
        trainer_id: profile.id,
        client_id: clientId,
        name: mealPlanForm.name || t('trainerNotes.nutrition.customPlan'),
        description: mealPlanForm.description || null,
        target_calories: parseInt(mealPlanForm.calories) || null,
        target_protein_g: parseInt(mealPlanForm.protein) || null,
        target_carbs_g: parseInt(mealPlanForm.carbs) || null,
        target_fat_g: parseInt(mealPlanForm.fat) || null,
        is_active: true,
        start_date: new Date().toISOString().split('T')[0],
      };

      const { data, error } = await supabase
        .from('trainer_meal_plans')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      dispatch({ type: 'SET', payload: { activeMealPlan: data, showMealPlanForm: false } });
    } catch (err) {
      logger.error('Error saving meal plan:', err);
      showToast(t('trainerNotes.errors.saveMealPlanFailed', 'Could not save meal plan'), 'error');
    } finally {
      dispatch({ type: 'SET', payload: { savingMealPlan: false } });
    }
  }

  async function handleDeactivateMealPlan() {
    if (!activeMealPlan) return;
    try {
      // Deactivate every active row for this client (not just the one we're
      // showing) so legacy duplicate actives are cleaned up too. supabase-js
      // never throws — check { error } so a failed write can't fake success.
      const { error } = await supabase
        .from('trainer_meal_plans')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('client_id', clientId)
        .eq('is_active', true);
      if (error) throw error;
      dispatch({
        type: 'SET',
        payload: {
          activeMealPlan: null,
          mealPlanForm: { calories: '', protein: '', carbs: '', fat: '', name: '', description: '' },
        },
      });
    } catch (err) {
      logger.error('Error deactivating meal plan:', err);
      showToast(t('trainerNotes.errors.deactivateMealPlanFailed', 'Could not deactivate the meal plan'), 'error');
    }
  }

  // Open the "use one of my plans" picker and load the trainer's meal plans
  // (across all clients) so they can copy one onto this client.
  async function openPlanPicker() {
    setPlanPicker(true);
    if (myMealPlans !== null) return;
    const { data, error } = await supabase
      .from('trainer_meal_plans')
      .select('id, name, target_calories, target_protein_g, target_carbs_g, target_fat_g, duration_weeks, meals, client_id, client:profiles!trainer_meal_plans_client_id_fkey(full_name)')
      .eq('trainer_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) { logger.error('openPlanPicker failed:', error); setMyMealPlans([]); return; }
    setMyMealPlans(data || []);
  }

  // Copy a chosen plan onto THIS client as a fresh active plan (new start date).
  async function copyPlanToClient(src) {
    if (copyingPlanId) return;
    setCopyingPlanId(src.id);
    try {
      const { error: deErr } = await supabase.from('trainer_meal_plans')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('client_id', clientId).eq('is_active', true);
      if (deErr) throw deErr;
      const durWeeks = Math.max(1, Math.min(52, Number(src.duration_weeks) || 1));
      const start = new Date();
      const end = new Date(start.getTime() + durWeeks * 7 * 86400000);
      const { data, error } = await supabase.from('trainer_meal_plans').insert({
        gym_id: profile.gym_id, trainer_id: profile.id, client_id: clientId,
        name: src.name, target_calories: src.target_calories, target_protein_g: src.target_protein_g,
        target_carbs_g: src.target_carbs_g, target_fat_g: src.target_fat_g,
        duration_weeks: durWeeks, meals: src.meals || [], is_active: true,
        start_date: start.toISOString().split('T')[0], end_date: end.toISOString().split('T')[0],
      }).select().single();
      if (error) throw error;
      dispatch({ type: 'SET', payload: { activeMealPlan: data, showMealPlanForm: false } });
      setPlanPicker(false);
      showToast(t('trainerNotes.nutrition.planCopied', 'Plan assigned'), 'success');
    } catch (err) {
      logger.error('copyPlanToClient failed:', err);
      showToast(t('trainerNotes.errors.saveMealPlanFailed', 'Could not save meal plan'), 'error');
    } finally {
      setCopyingPlanId(null);
    }
  }

  async function handleSaveNotes() {
    if (!profile?.id) return;
    dispatch({ type: 'SET', payload: { savingNotes: true } });
    try {
      const serialized = JSON.stringify(notesData);
      const { error } = await supabase.from('trainer_clients').upsert({
        gym_id: profile.gym_id,
        trainer_id: profile.id,
        client_id: clientId,
        notes: serialized,
      }, { onConflict: 'trainer_id,client_id' });
      if (error) throw error; // don't flash "Saved ✓" on a failed write
      // Refresh the load-time snapshot so a later reload (assign program,
      // language switch) re-derives THESE notes instead of reverting.
      assignmentNotesRef.current = serialized;
      dispatch({ type: 'SET', payload: { notesSaved: true, notesDirty: false } });
      if (notesSavedTimerRef.current) clearTimeout(notesSavedTimerRef.current);
      notesSavedTimerRef.current = setTimeout(() => {
        dispatch({ type: 'SET', payload: { notesSaved: false } });
        notesSavedTimerRef.current = null;
      }, 2000);
    } catch (err) {
      logger.error('Error saving notes:', err);
      showToast(t('trainerNotes.errors.saveNotesFailed', 'Could not save notes'), 'error');
    } finally {
      dispatch({ type: 'SET', payload: { savingNotes: false } });
    }
  }

  async function handleSaveFollowup() {
    if (!profile?.id) return;
    dispatch({ type: 'SET', payload: { savingFollowup: true } });
    try {
      const { data, error } = await supabase.from('trainer_followups').insert({
        trainer_id: profile.id,
        client_id: clientId,
        gym_id: profile.gym_id,
        method: fuMethod,
        note: fuNote || null,
        outcome: fuOutcome,
      }).select().single();
      if (error) throw error;
      dispatch({ type: 'PREPEND_FOLLOWUP', followup: data });
      dispatch({
        type: 'SET',
        payload: { showFollowupModal: false, fuNote: '', fuMethod: 'call', fuOutcome: 'no_answer' },
      });
    } catch (err) {
      // Keep the modal open so the trainer can retry without losing the note.
      logger.error('Error saving followup:', err);
      showToast(t('trainerNotes.errors.saveFollowupFailed', 'Could not save the follow-up'), 'error');
    } finally {
      dispatch({ type: 'SET', payload: { savingFollowup: false } });
    }
  }

  // ── Body measurements: trainer editing (consent-gated) ──────────────────
  const canEditMeasurements = client?.allow_trainer_measurements !== false;
  const MEAS_FIELDS = [
    { k: 'chest_cm', l: t('trainerClientDetail.body.chest', 'Chest') },
    { k: 'waist_cm', l: t('trainerClientDetail.body.waist', 'Waist') },
    { k: 'hips_cm', l: t('trainerClientDetail.body.hips', 'Hips') },
    { k: 'left_arm_cm', l: t('trainerClientDetail.body.leftArm', 'Left arm') },
    { k: 'right_arm_cm', l: t('trainerClientDetail.body.rightArm', 'Right arm') },
    { k: 'left_thigh_cm', l: t('trainerClientDetail.body.leftThigh', 'Left thigh') },
    { k: 'right_thigh_cm', l: t('trainerClientDetail.body.rightThigh', 'Right thigh') },
  ];
  // For circumferences UP is the gain; waist + body-fat improve going DOWN.
  const MEAS_FAVORABLE_DOWN = new Set(['waist_cm', 'body_fat_pct']);
  const measDelta = (key) => {
    if (!measurements || !measurementsPrev) return null;
    const cur = measurements[key], prev = measurementsPrev[key];
    if (cur == null || prev == null) return null;
    const d = Number(cur) - Number(prev);
    if (Math.abs(d) < 0.05) return { d: 0, favorable: null };
    const favorable = MEAS_FAVORABLE_DOWN.has(key) ? d < 0 : d > 0;
    return { d, favorable };
  };
  const openEditMeasurements = () => {
    const m = measurements || {};
    setEditMeas({
      chest_cm: m.chest_cm ?? '', waist_cm: m.waist_cm ?? '', hips_cm: m.hips_cm ?? '',
      left_arm_cm: m.left_arm_cm ?? '', right_arm_cm: m.right_arm_cm ?? '',
      left_thigh_cm: m.left_thigh_cm ?? '', right_thigh_cm: m.right_thigh_cm ?? '',
      body_fat_pct: m.body_fat_pct ?? '',
    });
  };
  const saveMeasurements = async () => {
    if (!editMeas || savingMeas) return;
    setSavingMeas(true);
    try {
      const num = (v) => (v === '' || v == null ? null : Number(v));
      const fields = {
        chest_cm: num(editMeas.chest_cm), waist_cm: num(editMeas.waist_cm), hips_cm: num(editMeas.hips_cm),
        left_arm_cm: num(editMeas.left_arm_cm), right_arm_cm: num(editMeas.right_arm_cm),
        left_thigh_cm: num(editMeas.left_thigh_cm), right_thigh_cm: num(editMeas.right_thigh_cm),
        body_fat_pct: num(editMeas.body_fat_pct),
      };
      const today = format(new Date(), 'yyyy-MM-dd');
      // Same-day edit updates the row; otherwise log a new dated measurement.
      const existingToday = measurements && measurements.measured_at === today ? measurements : null;
      const { error: err } = existingToday
        ? await supabase.from('body_measurements').update(fields).eq('id', existingToday.id)
        : await supabase.from('body_measurements').insert({ profile_id: clientId, gym_id: profile.gym_id, measured_at: today, ...fields });
      if (err) {
        logger.error('saveMeasurements failed:', err);
        showToast(t('trainerClientDetail.body.saveFailed', 'Could not save measurements'), 'error');
        setSavingMeas(false);
        return;
      }
      const { data } = await supabase.from('body_measurements').select('*')
        .eq('profile_id', clientId).order('measured_at', { ascending: false }).limit(2);
      dispatch({ type: 'SET', payload: { measurements: data?.[0] || null, measurementsPrev: data?.[1] || null } });
      setEditMeas(null);
      showToast(t('trainerClientDetail.body.measurementsSaved', 'Measurements saved'), 'success');
    } catch (e) {
      logger.error('saveMeasurements error:', e);
      showToast(t('trainerClientDetail.body.saveFailed', 'Could not save measurements'), 'error');
    } finally {
      setSavingMeas(false);
    }
  };

  // ── Client nutrition preferences (allergies + diets) ────────────────────
  const ALLERGEN_OPTIONS = ['nuts', 'shellfish', 'dairy', 'eggs', 'soy', 'wheat', 'fish'];
  const DIET_OPTIONS = ['vegan', 'vegetarian', 'pescatarian', 'keto', 'gluten_free', 'dairy_free', 'halal'];
  const togglePref = (listKey, val) => setEditPrefs(p => {
    const cur = p[listKey] || [];
    return { ...p, [listKey]: cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val] };
  });
  const saveClientPrefs = async () => {
    if (!editPrefs || savingPrefs) return;
    setSavingPrefs(true);
    try {
      const { error } = await supabase.from('member_onboarding')
        .update({ food_allergies: editPrefs.allergies, dietary_restrictions: editPrefs.restrictions })
        .eq('profile_id', clientId);
      if (error) {
        logger.error('saveClientPrefs failed:', error);
        showToast(t('trainerClientDetail.prefs.saveFailed', 'Could not save preferences'), 'error');
        setSavingPrefs(false);
        return;
      }
      // Sync "avoid foods" (disliked_foods) — diff current vs new.
      const curAvoid = clientNutritionPrefs?.avoid || [];
      const newAvoid = editPrefs.avoid || [];
      const toAdd = newAvoid.filter(x => !curAvoid.includes(x));
      const toRemove = curAvoid.filter(x => !newAvoid.includes(x));
      if (toRemove.length) {
        await supabase.from('disliked_foods').delete().eq('profile_id', clientId).in('food_name', toRemove);
      }
      if (toAdd.length) {
        await supabase.from('disliked_foods').upsert(
          toAdd.map(food_name => ({ profile_id: clientId, gym_id: profile.gym_id, food_name })),
          { onConflict: 'profile_id,food_name' },
        );
      }
      dispatch({ type: 'SET', payload: { clientNutritionPrefs: { allergies: editPrefs.allergies, restrictions: editPrefs.restrictions, avoid: newAvoid } } });
      setEditPrefs(null);
      showToast(t('trainerClientDetail.prefs.saved', 'Preferences saved'), 'success');
    } catch (e) {
      logger.error('saveClientPrefs error:', e);
      showToast(t('trainerClientDetail.prefs.saveFailed', 'Could not save preferences'), 'error');
    } finally {
      setSavingPrefs(false);
    }
  };

  async function handleAssignProgram(programId) {
    if (!profile?.id || assigningProgram) return;
    dispatch({ type: 'SET', payload: { assigningProgram: true } });
    try {
      // Update profile's assigned_program_id via secure RPC
      const { error: rpcErr } = await supabase.rpc('trainer_assign_program', { p_member_id: clientId, p_program_id: programId });
      if (rpcErr) {
        logger.error('Error assigning program:', rpcErr);
        showToast(t('trainerNotes.errors.assignProgramFailed', 'Could not update the program'), 'error');
        return;
      }

      if (programId) {
        // Upsert enrollment. The conflict path (re-assigning a program the client
        // already enrolled in) is an UPDATE under RLS — policy gpe_update_trainer
        // ships in migration 0526. Until it's applied, fall back to keeping the
        // existing row (ignoreDuplicates → ON CONFLICT DO NOTHING, insert-only RLS).
        const { error: enrollErr } = await supabase
          .from('gym_program_enrollments')
          .upsert({
            program_id: programId,
            profile_id: clientId,
            gym_id: profile.gym_id,
            enrolled_at: new Date().toISOString(),
          }, { onConflict: 'program_id,profile_id' });
        if (enrollErr) {
          await supabase
            .from('gym_program_enrollments')
            .upsert({
              program_id: programId,
              profile_id: clientId,
              gym_id: profile.gym_id,
            }, { onConflict: 'program_id,profile_id', ignoreDuplicates: true });
        }
      } else if (client?.assigned_program_id) {
        // "Remove program": never upsert program_id NULL (NOT NULL → 23502).
        // Delete the now-stale enrollment instead. The trainer DELETE policy
        // ships in migration 0527 — pre-migration this fails under RLS, which
        // is non-fatal (the RPC above already cleared assigned_program_id).
        const { error: delErr } = await supabase
          .from('gym_program_enrollments')
          .delete()
          .eq('profile_id', clientId)
          .eq('program_id', client.assigned_program_id);
        if (delErr) logger.error('Error removing enrollment (non-fatal pre-0527):', delErr);
      }

      // Reload data
      await loadClientData();
    } catch (err) {
      logger.error('Error assigning program:', err);
    } finally {
      dispatch({ type: 'SET', payload: { assigningProgram: false } });
    }
  }

  const METHOD_ICONS = {
    push: Bell,
    email: Mail,
    call: Phone,
    in_person: UserCheck,
  };

  // Follow-up method → fixed accent hue (for the tinted icon-box in the
  // history rows) + i18n key suffix (method values use snake_case; the
  // locale keys are camelCase under trainerNotes.followUp.methods).
  const METHOD_TONES = {
    call: TT.accent,
    in_person: TT.good,
    push: TT.coach,
    email: TT.warn,
  };
  const FU_METHOD_KEY = {
    call: 'call',
    in_person: 'inPerson',
    push: 'push',
    email: 'email',
  };

  const OUTCOME_STYLES = {
    no_answer: { label: t('trainerNotes.followUp.outcomes.noAnswer'), color: 'text-[var(--tt-text-sub)]', bg: 'bg-[var(--tt-bg)]' },
    rescheduled: { label: t('trainerNotes.followUp.outcomes.rescheduled'), color: 'text-[var(--tt-accent-ink)]', bg: 'bg-[var(--tt-accent-soft)]' },
    coming_back: { label: t('trainerNotes.followUp.outcomes.comingBack'), color: 'text-[var(--tt-good-ink)]', bg: 'bg-[var(--tt-good-soft)]' },
    not_interested: { label: t('trainerNotes.followUp.outcomes.notInterested'), color: 'text-[#FF5A2E]', bg: 'bg-[var(--tt-hot-soft)]' },
    other: { label: t('trainerNotes.followUp.outcomes.other'), color: 'text-[var(--tt-text-sub)]', bg: 'bg-[var(--tt-bg)]' },
  };

  function getDaysSince(dateStr) {
    if (!dateStr) return 0;
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  function formatDuration(seconds) {
    if (!seconds) return '--';
    const mins = Math.floor(seconds / 60);
    return `${mins}m`;
  }

  // Compute adherence %
  const adherencePercent = useMemo(() => {
    if (stats.count === 0 || !client?.created_at) return 0;
    const daysMember = getDaysSince(client.created_at);
    const weeksActive = Math.max(daysMember / 7, 1);
    // Assume ~3 workouts/week as baseline
    const expected = weeksActive * 3;
    return Math.min(Math.round((stats.count / expected) * 100), 100);
  }, [stats.count, client?.created_at]);

  // Program progress. Days/week is derived from the JSONB `weeks` column —
  // the schema doesn't have a top-level `days_per_week`. We pick week 1's
  // day count as representative; programs may technically vary week-to-week
  // but for a simple progress card this is enough.
  const programProgress = useMemo(() => {
    if (!enrollment?.gym_programs || !enrollment.enrolled_at) return null;
    const { duration_weeks, weeks, name } = enrollment.gym_programs;
    const started = new Date(enrollment.enrolled_at);
    const now = new Date();
    const currentWeek = Math.min(Math.max(differenceInWeeks(now, started) + 1, 1), duration_weeks || 1);
    const totalWeeks = duration_weeks || 0;
    const progressPct = totalWeeks > 0 ? Math.round((currentWeek / totalWeeks) * 100) : 0;
    const week1 = weeks && typeof weeks === 'object' ? (weeks['1'] || weeks[1]) : null;
    const daysPerWeek = Array.isArray(week1) ? week1.length : (week1?.days?.length ?? 3);
    return { name, currentWeek, totalWeeks, daysPerWeek, progressPct };
  }, [enrollment]);

  // Body tab — period-filtered weight chart data
  const bodyWeightChart = useMemo(() => {
    if (weights.length === 0) return [];
    const cutoff = subDays(new Date(), bodyPeriod).getTime();
    const within = weights.filter(w => new Date(w.logged_at).getTime() >= cutoff);
    return [...within].reverse().map(w => ({
      date: format(new Date(w.logged_at), 'MMM d', { locale: dateFnsLocale }),
      weight: parseFloat(w.weight_lbs),
    }));
  }, [weights, bodyPeriod, dateFnsLocale]);

  // Body tab — current weight + delta over selected period
  const bodyWeightStats = useMemo(() => {
    if (weights.length === 0) return { current: null, delta: null, count: 0 };
    const cutoff = subDays(new Date(), bodyPeriod).getTime();
    const within = weights.filter(w => new Date(w.logged_at).getTime() >= cutoff);
    if (within.length === 0) {
      return { current: parseFloat(weights[0].weight_lbs), delta: null, count: 0 };
    }
    const current = parseFloat(within[0].weight_lbs);
    const earliest = parseFloat(within[within.length - 1].weight_lbs);
    const delta = within.length > 1 ? current - earliest : null;
    return { current, delta, count: within.length };
  }, [weights, bodyPeriod]);

  // Body tab — group photos by month
  const photosByMonth = useMemo(() => {
    if (!progressPhotos?.length) return [];
    const groups = {};
    progressPhotos.forEach(p => {
      const key = format(new Date(p.taken_at), 'yyyy-MM');
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    return Object.entries(groups)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, photos]) => ({
        key,
        label: format(new Date(key + '-01T12:00:00'), 'MMMM yyyy', { locale: dateFnsLocale }),
        photos,
      }));
  }, [progressPhotos, dateFnsLocale]);

  // History tab — best 1RM per exercise per session for top 5 lifts (PR timeline)
  const prTimelineData = useMemo(() => {
    if (!personalRecords?.length) return { lifts: [], series: [] };
    const TOP_LIFT_HINTS = ['bench', 'squat', 'deadlift', 'overhead', 'press', 'row'];
    // Group PRs by exercise name
    const byExercise = {};
    personalRecords.forEach(pr => {
      const name = pr.exercises?.name;
      if (!name) return;
      if (!byExercise[name]) byExercise[name] = [];
      byExercise[name].push(pr);
    });
    // Pick top 5: prefer canonical lifts, then by record count
    const ranked = Object.entries(byExercise)
      .map(([name, recs]) => {
        const lower = name.toLowerCase();
        const matchScore = TOP_LIFT_HINTS.findIndex(h => lower.includes(h));
        const priority = matchScore === -1 ? 99 : matchScore;
        return { name, recs, priority, count: recs.length };
      })
      .sort((a, b) => a.priority - b.priority || b.count - a.count)
      .slice(0, 5);
    // Build per-month series: latest 1RM per month per lift
    const allDates = new Set();
    ranked.forEach(({ recs }) => recs.forEach(r => allDates.add(format(new Date(r.achieved_at), 'yyyy-MM'))));
    const sortedDates = Array.from(allDates).sort();
    const series = sortedDates.map(month => {
      const point = { month: format(new Date(month + '-01T12:00:00'), 'MMM yy', { locale: dateFnsLocale }) };
      ranked.forEach(({ name, recs }) => {
        const inMonth = recs.filter(r => format(new Date(r.achieved_at), 'yyyy-MM') === month);
        if (inMonth.length) {
          const best = Math.max(...inMonth.map(r => Number(r.estimated_1rm) || Number(r.weight_lbs) || 0));
          if (best > 0) point[name] = Math.round(best);
        }
      });
      return point;
    });
    return { lifts: ranked.map(r => r.name), series };
  }, [personalRecords, dateFnsLocale]);

  // History tab — 12-week rolling volume
  const volumeTrendData = useMemo(() => {
    if (!allSessions?.length) return [];
    const weekMap = {};
    for (let i = 11; i >= 0; i--) {
      const wk = startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 0 });
      const key = format(wk, 'MMM d', { locale: dateFnsLocale });
      weekMap[key] = 0;
    }
    allSessions.forEach(s => {
      const wk = startOfWeek(new Date(s.started_at), { weekStartsOn: 0 });
      const key = format(wk, 'MMM d', { locale: dateFnsLocale });
      if (weekMap[key] !== undefined) weekMap[key] += Number(s.total_volume_lbs) || 0;
    });
    return Object.entries(weekMap).map(([week, volume]) => ({ week, volume: Math.round(volume) }));
  }, [allSessions, dateFnsLocale]);

  // History tab — this month's visits, split by week-of-month. A "visit" is a
  // day the client showed up (a workout OR a check-in counts once). The detailed
  // day-by-day attendance lives in the Body tab's month calendar, so here we
  // surface the monthly total broken down per week.
  const monthlyVisits = useMemo(() => {
    const now = new Date();
    const mStart = startOfMonth(now);
    const mEnd = endOfMonth(now);
    const visitDays = new Set();
    (allSessions || []).forEach(s => {
      const d = new Date(s.started_at);
      if (d >= mStart && d <= mEnd) visitDays.add(format(d, 'yyyy-MM-dd'));
    });
    (checkIns || []).forEach(c => {
      const d = new Date(c.checked_in_at);
      if (d >= mStart && d <= mEnd) visitDays.add(format(d, 'yyyy-MM-dd'));
    });
    const buckets = {};
    eachDayOfInterval({ start: mStart, end: mEnd }).forEach(d => {
      const wi = differenceInCalendarWeeks(d, mStart, { weekStartsOn: 0 });
      if (buckets[wi] == null) buckets[wi] = 0;
      if (visitDays.has(format(d, 'yyyy-MM-dd'))) buckets[wi] += 1;
    });
    const weeks = Object.keys(buckets).map(Number).sort((a, b) => a - b)
      .map(wi => ({ week: wi + 1, count: buckets[wi] }));
    return {
      weeks,
      total: visitDays.size,
      max: Math.max(...weeks.map(w => w.count), 1),
      monthLabel: format(now, 'MMMM', { locale: dateFnsLocale }),
    };
  }, [allSessions, checkIns, dateFnsLocale]);

  // History tab — streaks (current from streak_cache; longest from sessions)
  const streakStats = useMemo(() => {
    const current = streak?.current_streak_days || 0;
    if (!allSessions?.length) return { current, longest: current };
    // Build set of distinct training days, find longest run
    const dayKeys = Array.from(
      new Set(allSessions.map(s => format(new Date(s.started_at), 'yyyy-MM-dd')))
    ).sort();
    let longest = 0;
    let run = 0;
    let prev = null;
    for (const k of dayKeys) {
      if (!prev) { run = 1; }
      else {
        const diff = (new Date(k) - new Date(prev)) / 86400000;
        run = diff === 1 ? run + 1 : 1;
      }
      if (run > longest) longest = run;
      prev = k;
    }
    return { current, longest: Math.max(longest, current) };
  }, [streak, allSessions]);

  // Member-declared injuries + excluded exercises (from onboarding) — safety
  // info the member already gave the gym; resolve exercise ids to localized
  // names via the local catalog (custom ids simply don't resolve).
  const declaredInjuries = useMemo(() => {
    const notes = (onboarding?.injuries_notes || '').trim();
    const ids = Array.isArray(onboarding?.excluded_exercise_ids) ? onboarding.excluded_exercise_ids : [];
    const excludedNames = ids
      .map((id) => {
        const ex = EXERCISE_BY_ID.get(id);
        return ex ? exName(ex) : null;
      })
      .filter(Boolean);
    return notes || excludedNames.length ? { notes, excludedNames } : null;
  }, [onboarding]);

  // Rolling 7-day window into the 8 weeks of food logs, driven by nutWeekOffset.
  // MUST stay above the early returns below — these are hooks and would
  // otherwise be called conditionally (crash: "rendered more hooks…").
  const nutWindow = useMemo(() => {
    const end = subDays(new Date(), nutWeekOffset * 7);
    const start = subDays(end, 6);
    const startStr = format(start, 'yyyy-MM-dd');
    const endStr = format(end, 'yyyy-MM-dd');
    return {
      start, end, startStr, endStr,
      days: (foodLogSummary || []).filter(d => d.date >= startStr && d.date <= endStr),
    };
  }, [foodLogSummary, nutWeekOffset]);
  // How far back logs actually exist — caps the "previous week" arrow.
  const oldestNutWeekOffset = useMemo(() => {
    if (!foodLogSummary?.length) return 0;
    const oldest = foodLogSummary[0]?.date;
    if (!oldest) return 0;
    const days = Math.floor((new Date() - new Date(oldest + 'T00:00:00')) / 86400000);
    return Math.min(7, Math.floor(days / 7));
  }, [foodLogSummary]);

  // Lock the page behind any of this page's modals (kept above the early
  // returns so the hook count stays stable).
  useScrollLock(!!editMeas || !!editPrefs || !!planPicker || showFollowupModal || showReport || !!viewProgram || showContactSheet);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--tt-bg)] px-4 py-6 max-w-[480px] mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full" style={{ backgroundColor: TT.surface2 }} />
            <div className="space-y-2 flex-1">
              <div className="h-5 w-32 rounded-lg" style={{ backgroundColor: TT.surface2 }} />
              <div className="h-3 w-24 rounded-lg" style={{ backgroundColor: TT.surface2 }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-24 rounded-xl" style={{ backgroundColor: TT.surface2 }} />
            <div className="h-24 rounded-xl" style={{ backgroundColor: TT.surface2 }} />
          </div>
          <div className="h-48 rounded-xl" style={{ backgroundColor: TT.surface2 }} />
        </div>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="min-h-screen bg-[var(--tt-bg)] px-4 md:px-6 py-6 max-w-5xl mx-auto">
        <button
          onClick={() => navigate('/trainer/clients')}
          className="flex items-center gap-2 text-[var(--tt-text-sub)] text-[14px] mb-6 hover:text-[var(--tt-text)] transition-colors whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4 flex-shrink-0" />
          {t('trainerNotes.backToClients')}
        </button>
        <div className="text-center py-20">
          <p className="text-[16px] font-semibold text-[var(--tt-text)] mb-2">{t('trainerNotes.accessDenied')}</p>
          <p className="text-[14px] text-[#96A0AA]">{t('trainerNotes.notAssigned')}</p>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="min-h-screen bg-[var(--tt-bg)] px-4 md:px-6 py-6 max-w-5xl mx-auto">
        <button
          onClick={() => navigate('/trainer/clients')}
          className="flex items-center gap-2 text-[var(--tt-text-sub)] text-[14px] mb-6 whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4 flex-shrink-0" />
          {t('trainerNotes.backToClients')}
        </button>
        <p className="text-[var(--tt-text-sub)] text-[14px]">{t('trainerNotes.clientNotFound')}</p>
      </div>
    );
  }

  // ── Avatar + status pill mapping ────────────────────────
  const heroIdx = avatarIdx(client.id);
  const daysQuiet = client.last_active_at
    ? Math.floor((Date.now() - new Date(client.last_active_at).getTime()) / 86400000)
    : null;
  const churnFlag = daysQuiet !== null && daysQuiet > 30;
  const riskFlag = !churnFlag && daysQuiet !== null && daysQuiet > 14;
  const heroStatus = churnFlag ? 'churn' : riskFlag ? 'risk' : 'on';
  const heroStatusLabel = churnFlag
    ? t('trainerClientDetail.statusChurn', 'Churn')
    : riskFlag
      ? t('trainerClientDetail.statusAtRisk', 'At risk')
      : t('trainerClientDetail.statusOnTrack', 'On track');
  const heroStatusTone = heroStatus === 'churn' ? 'hot' : heroStatus === 'risk' ? 'warn' : 'invert';

  // Pinned note from notesData (if any text present)
  const pinnedNote = (notesData?.notes || '').trim();
  const injuriesNote = (notesData?.injuries || '').trim();

  // Map first 3 PRs into the "Personal records" grid
  const topPRs = (personalRecords || []).slice(0, prVisible);

  // Pinned-notes warm gradient is light-only; in dark mode fall back to the
  // theme-aware surface so it doesn't blow out. isDarkTheme comes from
  // ThemeContext (useTheme at the top) so a theme flip re-renders correctly —
  // a render-time DOM classList check could go stale.
  const pinnedNoteBg = isDarkTheme ? TT.surface2 : 'linear-gradient(160deg,#FFFBEF,#FFFDF7)';
  const pinnedNoteBorder = isDarkTheme ? TT.border : '#F1E6C8';

  // Member-since label for the identity meta line.
  const memberSince = client?.created_at
    ? format(new Date(client.created_at), 'MMM yyyy', { locale: dateFnsLocale })
    : null;

  // Open DM thread with this client (shared by the back-bar + identity CTA).
  const openConversation = async () => {
    try {
      const { data: convId, error } = await supabase.rpc('get_or_create_conversation', { p_other_user: clientId });
      if (error || !convId) {
        logger.error('Error opening conversation:', error);
        showToast(t('trainerNotes.errors.openConversationFailed', 'Could not open the chat'), 'error');
        return;
      }
      navigate(`/trainer/messages/${convId}`);
    } catch (err) { logger.error('Error opening conversation:', err); }
  };

  // Contact actions — only rendered when the client has a dialable number.
  const phoneDigits = normalizePhone(client?.phone_number);

  // Open the fullscreen photo viewer and re-sign the URL in the background so
  // a tab that's been open past the signed-URL expiry still loads the image.
  const openPhotoViewer = (photo) => {
    dispatch({ type: 'SET', payload: { viewingPhoto: photo } });
    (async () => {
      try {
        const { data: signed, error } = await supabase.storage
          .from('progress-photos')
          .createSignedUrl(photo.storage_path, 21600);
        if (!error && signed?.signedUrl) {
          dispatch({ type: 'REFRESH_VIEWING_PHOTO', photo: { ...photo, signedUrl: signed.signedUrl } });
        }
      } catch (err) {
        logger.error('Error refreshing photo URL:', err);
      }
    })();
  };

  // History tab — fetch a session's exercises + sets on first expand and
  // cache per session id (trainer SELECT policies exist on both tables).
  const loadSessionDetail = async (sessionId) => {
    if (sessionDetails[sessionId]) return; // cached or in flight
    dispatch({ type: 'SET_SESSION_DETAIL', id: sessionId, detail: { loading: true, exercises: [] } });
    const { data, error } = await supabase
      .from('session_exercises')
      .select('id, exercise_id, snapshot_name, position, session_sets ( set_number, weight_lbs, reps, duration_seconds, is_completed )')
      .eq('session_id', sessionId)
      .order('position', { ascending: true });
    if (error) {
      logger.error('Error loading session detail:', error);
      dispatch({ type: 'SET_SESSION_DETAIL', id: sessionId, detail: { loading: false, exercises: [] } });
      return;
    }
    const exercisesDetail = (data || []).map((se) => {
      const catalogEx = EXERCISE_BY_ID.get(se.exercise_id);
      return {
        id: se.id,
        name: (catalogEx && exName(catalogEx)) || se.snapshot_name || '—',
        sets: (se.session_sets || [])
          .filter((st) => st.is_completed)
          .sort((a, b) => (a.set_number || 0) - (b.set_number || 0)),
      };
    });
    dispatch({ type: 'SET_SESSION_DETAIL', id: sessionId, detail: { loading: false, exercises: exercisesDetail } });
  };

  // ── Sliding swipe between tabs (in tab-bar order) ─────────────────────
  // The panels live on a 3-slot track (prev | active | next). During a
  // horizontal drag the track follows the finger via an IMPERATIVE transform
  // on trackRef (zero re-renders per move); releasing past the threshold
  // animates to the neighbor and only then commits the tab change.
  const onTabSwipeStart = (e) => {
    const tch = e.touches && e.touches[0];
    // Don't hijack text fields or explicitly-ignored scrollers (the tab bar, charts).
    if (!tch || swipeRef.current.settling ||
        (e.target.closest && e.target.closest('[data-swipe-ignore]'))) {
      swipeRef.current.active = false;
      return;
    }
    swipeRef.current = { ...swipeRef.current, x: tch.clientX, y: tch.clientY, active: true, horiz: false, dx: 0 };
  };

  const onTabSwipeMove = (e) => {
    const s = swipeRef.current;
    if (!s.active || s.settling) return;
    const tch = e.touches && e.touches[0];
    if (!tch) return;
    const dx = tch.clientX - s.x;
    const dy = tch.clientY - s.y;
    if (!s.horiz) {
      // Decide intent once: clear vertical motion releases the gesture to the
      // scroller; clear horizontal motion locks the track to the finger.
      if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) { s.active = false; return; }
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      s.horiz = true;
      s.width = swipeViewportRef.current?.clientWidth || window.innerWidth;
      // A drag that started on a text field is a swipe, not typing — drop the
      // keyboard/caret so the slide isn't fighting the focused input.
      const ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) ae.blur();
      setSwipeDrag(true); // mount neighbor panels so the next page is visible
    }
    const i = MEMBER_TAB_ORDER.indexOf(activeTab);
    let d = dx;
    if ((d > 0 && i === 0) || (d < 0 && i === MEMBER_TAB_ORDER.length - 1)) d = d / 3; // edge resistance
    s.dx = d;
    const el = trackRef.current;
    if (el) {
      el.style.transition = 'none';
      el.style.transform = `translateX(calc(-33.3333% + ${d}px))`;
    }
  };

  // slotShift: -1 settles to prev, 0 snaps back, 1 settles to next.
  const settleSwipe = (targetTab, slotShift) => {
    const s = swipeRef.current;
    const el = trackRef.current;
    const reset = () => {
      swipeRef.current = { x: 0, y: 0, active: false, horiz: false, dx: 0, width: 0, settling: false };
    };
    if (!el) {
      if (targetTab) dispatch({ type: 'SET', payload: { activeTab: targetTab } });
      setSwipeDrag(false);
      reset();
      return;
    }
    s.settling = true;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      el.removeEventListener('transitionend', done);
      // flushSync so the new tab is ALREADY in the center slot when the track
      // snaps back to rest — otherwise the old panel flashes for a frame.
      flushSync(() => {
        if (targetTab) dispatch({ type: 'SET', payload: { activeTab: targetTab } });
        setSwipeDrag(false);
      });
      el.style.transition = 'none';
      el.style.transform = 'translateX(-33.3333%)';
      reset();
    };
    el.addEventListener('transitionend', done);
    setTimeout(done, 380); // safety net — transitionend can be swallowed
    requestAnimationFrame(() => {
      el.style.transition = 'transform 280ms cubic-bezier(.22, .8, .32, 1)';
      el.style.transform = `translateX(${(-(1 + slotShift) * 33.3333).toFixed(4)}%)`;
    });
  };

  const onTabSwipeEnd = () => {
    const s = swipeRef.current;
    if (!s.active || s.settling) return;
    s.active = false;
    if (!s.horiz) return; // tap or vertical scroll — nothing to settle
    const i = MEMBER_TAB_ORDER.indexOf(activeTab);
    const threshold = Math.min(96, (s.width || 320) * 0.22);
    let shift = 0;
    if (s.dx <= -threshold && i < MEMBER_TAB_ORDER.length - 1) shift = 1;
    else if (s.dx >= threshold && i > 0) shift = -1;
    settleSwipe(shift === 0 ? null : MEMBER_TAB_ORDER[i + shift], shift);
  };

  return (
    <div style={{ background: TT.bg, minHeight: '100%' }} onTouchStart={onTabSwipeStart} onTouchMove={onTabSwipeMove} onTouchEnd={onTabSwipeEnd} onTouchCancel={onTabSwipeEnd}>
      {/* ── Back bar (Atelier) ──────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px 4px' }}>
        <TIconButton
          ariaLabel={t('trainerNotes.backToClients', 'Back')}
          onClick={goBack}
        >
          <ChevronLeft size={18} strokeWidth={2.4} color={TT.text} />
        </TIconButton>
        <div style={{ fontFamily: TFont.display, fontSize: 15, fontWeight: 800, color: TT.text, letterSpacing: -0.2 }}>
          {t('trainerClientDetail.clientLabel', 'Client')}
        </div>
        {/* The old "⋯" hid a single action — label it for discoverability. */}
        <button
          type="button"
          onClick={() => dispatch({ type: 'SET', payload: { showReport: true } })}
          aria-label={t('trainerNotes.actions.monthlyReport', 'Monthly report')}
          className="tt-tap"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            height: 38, padding: '0 12px', borderRadius: 12,
            background: TT.surface2, border: `1px solid ${TT.borderSolid}`,
            fontFamily: TFont.display, fontSize: 12, fontWeight: 700,
            color: TT.text, cursor: 'pointer', flexShrink: 0,
          }}
        >
          <BarChart3 size={14} strokeWidth={2.2} color={TT.accent} />
          {t('trainerClientDetail.reportPill', 'Report')}
        </button>
      </div>

      {/* ── Identity header (centered) — exact Atelier reference sizes ── */}
      <div style={{ padding: '6px 20px 10px', textAlign: 'center' }}>
        <div style={{ display: 'inline-block', position: 'relative' }}>
          <TAvatar name={client.full_name || '?'} size={64} idx={heroIdx} />
          {liveDraft && (
            <span style={{
              position: 'absolute', bottom: 1, right: 1,
              width: 15, height: 15, borderRadius: 999,
              background: TT.hot, border: `2.5px solid ${TT.bg}`,
              animation: 'pulse 1.6s ease-in-out infinite',
            }} aria-hidden="true" />
          )}
        </div>
        <div style={{ fontFamily: TFont.display, fontSize: 22, fontWeight: 800, color: TT.text, letterSpacing: -0.6, marginTop: 9, lineHeight: 1.1 }}>
          {client.full_name || t('trainerNotes.unnamedClient', 'Client')}
        </div>
        <div style={{ fontSize: 12.5, color: TT.textSub, marginTop: 3 }}>
          {programName || t('trainerClientDetail.noProgram', 'No program')}
          {programProgress && <> · {t('trainerClientDetail.weekN', 'Week {{w}}', { w: programProgress.currentWeek })}</>}
          {memberSince && <> · {t('trainerClientDetail.memberSince', 'Member since {{m}}', { m: memberSince })}</>}
        </div>

        {/* Status + live pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', justifyContent: 'center', marginTop: 9 }}>
          <TPill tone={heroStatusTone === 'invert' ? 'good' : heroStatusTone} size="m">
            {heroStatusLabel} · {adherencePercent}% {t('trainerClientDetail.adhAbbr', 'adh')}
          </TPill>
          {liveDraft && (
            <button
              type="button"
              onClick={() => navigate(`/trainer/live/${clientId}`)}
              aria-label={t('trainerClientDetail.live.watchLive', '● Live')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 10px', borderRadius: 999,
                background: TT.hot, color: '#fff',
                fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4,
                textTransform: 'uppercase', border: 'none', cursor: 'pointer',
                animation: 'pulse 1.6s ease-in-out infinite',
                whiteSpace: 'nowrap', minHeight: 22,
              }}
            >
              {t('trainerClientDetail.live.watchLive', '● Live')}
            </button>
          )}
        </div>

        {/* CTAs */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 13 }}>
          <TPrimaryButton onClick={openConversation} aria-label={t('trainerNotes.actions.messageClient', 'Message')}>
            <MessageSquare size={16} strokeWidth={2.4} />
            {t('trainerNotes.actions.messageClient', 'Message')}
          </TPrimaryButton>
          <button
            type="button"
            onClick={handleStartLiveSession}
            aria-label={t('trainerClientDetail.live.startSession', 'Log session')}
            className="tt-btn tt-btn--secondary"
            style={{ padding: '11px 16px', borderRadius: 14, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Play size={16} strokeWidth={2.2} />
            {t('trainerClientDetail.live.startSession', 'Log session')}
          </button>
          {/* One Contact button → action sheet (call / WhatsApp / SMS). The
              old inline WhatsApp + Call pair crowded the CTA row. */}
          {phoneDigits && (
            <button
              type="button"
              onClick={() => setShowContactSheet(true)}
              aria-label={t('trainerClientDetail.contact.contactBtn', 'Contact')}
              className="tt-btn tt-btn--secondary"
              style={{
                width: 44, height: 44, borderRadius: 14, padding: 0, flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Phone size={16} strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>

      {/* ── Stat trio (Atelier) — exact reference sizes ─────── */}
      <div style={{ padding: '4px 16px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[
          { l: t('trainerClientDetail.snapshot.adherence', 'Adherence'), big: `${adherencePercent}`, unit: '%', tone: TT.accent },
          { l: t('trainerClientDetail.snapshot.streak', 'Streak'), big: `${streak?.current_streak_days || 0}`, unit: 'd', tone: '#F08A3C' },
          { l: t('trainerClientDetail.snapshot.sessions', 'Sessions'), big: `${workoutsThisWeek}`, unit: `/${stats.count}`, tone: TT.text },
        ].map((s, i) => (
          <TCard key={i} padded={0} style={{ padding: '11px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, color: TT.textMute, letterSpacing: 0.7, textTransform: 'uppercase' }}>{s.l}</div>
            <div style={{ fontFamily: TFont.display, fontSize: 24, fontWeight: 800, color: s.tone, letterSpacing: -1, lineHeight: 1, marginTop: 5 }}>
              {s.big}<span style={{ fontSize: 12, color: TT.textMute }}>{s.unit}</span>
            </div>
          </TCard>
        ))}
      </div>

      {/* ── Tab chips (Atelier, horizontal scroll) ──────────── */}
      <div
        data-swipe-ignore
        role="tablist"
        style={{ display: 'flex', padding: '0 8px', borderBottom: `1px solid ${TT.border}`, marginBottom: 4 }}
      >
        {(() => {
          // Labels keyed by the canonical id list (MEMBER_TAB_ORDER) so the
          // chip order, swipe order and ?tab= values can never drift apart.
          const TAB_LABELS = {
            overview: t('trainerClientDetail.tabs.overview', 'Overview'),
            programNutrition: t('trainerClientDetail.tabs.plan', 'Plan'),
            body: t('trainerClientDetail.tabs.body', 'Body'),
            notesFollowUp: t('trainerClientDetail.tabs.notes', 'Notes'),
            history: t('trainerClientDetail.tabs.history', 'History'),
          };
          return MEMBER_TAB_ORDER.map((tabId) => {
            const isActive = activeTab === tabId;
            return (
              <button
                key={tabId}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => dispatch({ type: 'SET', payload: { activeTab: tabId } })}
                className="tt-tap"
                style={{
                  flex: 1, minWidth: 0, textAlign: 'center',
                  padding: '11px 2px 12px', whiteSpace: 'nowrap',
                  // Clip instead of spilling — an overlong label widening the
                  // document is what let the whole page pan sideways.
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  fontFamily: TFont.display, fontSize: 12, fontWeight: isActive ? 800 : 600,
                  background: 'none', border: 'none',
                  color: isActive ? TT.text : TT.textSub,
                  borderBottom: isActive ? `2px solid ${TT.accent}` : '2px solid transparent',
                  marginBottom: -1,
                  cursor: 'pointer', minHeight: 40,
                }}
              >
                {TAB_LABELS[tabId]}
              </button>
            );
          });
        })()}
      </div>

      {/* ── Swipeable tab panels: 3-slot track (prev | active | next) that
          follows the finger; neighbors mount only while a drag is live, so
          the idle render cost is identical to the old single panel. ────── */}
      {(() => {
        const renderTabPanel = (tab) => (
          <>
      {/* ── Overview tab content (new visual layer) ────────── */}
      {tab === 'overview' && (
        <div style={{ padding: '16px 16px 24px' }} className="md:max-w-[860px] md:mx-auto">
          {/* Check-in reference photo (staff-managed) */}
          <TCard padded={14} style={{ marginBottom: 22 }}>
            {/* View-only for trainers — the reference photo is managed by the
                gym admin at the front desk (0548 enforces this server-side). */}
            <CheckinPhotoEditor
              canEdit={false}
              subjectId={clientId}
              path={client.checkin_photo_path}
              size={84}
              onChange={(p) => dispatch({ type: 'SET', payload: { client: { ...client, checkin_photo_path: p } } })}
              theme={{ accent: TT.accent, surface: TT.surface2, border: TT.border, text: TT.text, textSub: TT.textSub, danger: TT.hot, badgeBorder: TT.surface }}
              labels={{ photo: t('checkinPhoto.title', 'Check-in photo'), hint: t('checkinPhoto.viewOnlyHint', 'Managed by the gym at the front desk — view only.'), add: t('checkinPhoto.add', 'Add photo'), replace: t('checkinPhoto.replace', 'Replace'), remove: t('checkinPhoto.remove', 'Remove') }}
            />
          </TCard>
          {/* Payment (trainer tool) */}
          <TrainerClientPayment clientId={clientId} />
          {/* Weekly schedule (trainer tool) */}
          <TrainerClientSchedule clientId={clientId} />
          {/* Next session — also shown for brand-new clients whose only data
              is a booked upcoming session (nextSession). */}
          {(nextSession || programName || recentSessions.length > 0) && (
            <>
              <TSectionHeader title={t('trainerClientDetail.nextSession', 'Next session')} />
              <TCard padded={14} style={{ marginBottom: 22, boxShadow: `inset 3px 0 0 ${TT.accent}, ${TT.shadow}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontFamily: TFont.display, fontSize: 22, fontWeight: 800, color: TT.text, letterSpacing: -0.5, lineHeight: 1 }}>
                      {nextSession
                        ? format(new Date(nextSession.scheduled_at), 'EEE p', { locale: dateFnsLocale })
                        : '—'}
                    </div>
                    <div style={{ fontSize: 11, color: TT.textSub, marginTop: 2 }}>
                      {nextSession
                        ? t('trainerClientDetail.sessionMins', '{{m}} min', { m: nextSession.duration_mins || 60 })
                        : t('trainerClientDetail.noUpcomingSession', 'No upcoming session')}
                    </div>
                  </div>
                  <div style={{ flex: 1, paddingLeft: 14, borderLeft: `1px solid ${TT.border}`, marginLeft: 8, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {programName || t('trainerClientDetail.activeWorkout', 'Workout')}
                    </div>
                    <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 2 }}>
                      {programProgress
                        // daysPerWeek is a frequency, not "which day" — phrase it as such.
                        ? t('trainerClientDetail.weekDaysPerWeek', 'Week {{w}} · {{d}} days/wk', { w: programProgress.currentWeek, d: programProgress.daysPerWeek })
                        : recentSessions[0]?.name || ''}
                    </div>
                  </div>
                  <TPrimaryButton onClick={handleStartLiveSession} aria-label={t('trainerClientDetail.live.startSession', 'Start session')}>
                    <Play size={13} strokeWidth={2.4} />
                    {t('trainerClientDetail.start', 'Start')}
                  </TPrimaryButton>
                </div>
              </TCard>
            </>
          )}

          {/* Current plan (Atelier) */}
          {programName && (
            <>
              <TSectionHeader
                title={t('trainerClientDetail.currentPlan', 'Current plan')}
                action={
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'SET', payload: { activeTab: 'programNutrition' } })}
                    className="tt-tap"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: TT.textSub, padding: 0 }}
                  >
                    {t('trainerClientDetail.adjust', 'Adjust')}
                  </button>
                }
              />
              <TCard padded={16} style={{ marginBottom: 22 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {programName}
                    </div>
                    {programProgress && (
                      <div style={{ fontSize: 12.5, color: TT.textSub, marginTop: 2 }}>
                        {t('trainerClientDetail.weekProgram', '{{n}}-week program', { n: programProgress.totalWeeks })}
                        {' · '}
                        {t('trainerClientDetail.daysWeekN', '{{d}} days/week', { d: programProgress.daysPerWeek })}
                      </div>
                    )}
                  </div>
                  {programProgress && (
                    <TPill tone="teal" size="l" style={{ flexShrink: 0 }}>
                      {t('trainerClientDetail.weekOfPill', 'Week {{w}} / {{t}}', { w: programProgress.currentWeek, t: programProgress.totalWeeks })}
                    </TPill>
                  )}
                </div>
                {programProgress && (
                  <>
                    <div style={{ height: 6, background: TT.surface2, borderRadius: 999, marginTop: 14, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px var(--tt-border)' }}>
                      <div style={{ width: `${programProgress.progressPct}%`, height: '100%', background: 'linear-gradient(90deg,#27B0A0,#178C7E)', borderRadius: 999 }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11.5, color: TT.textSub, fontWeight: 600 }}>
                      <span>{t('trainerClientDetail.weekProgressLabel', 'Week {{w}} of {{t}}', { w: programProgress.currentWeek, t: programProgress.totalWeeks })}</span>
                      <span>
                        {nextSession
                          ? t('trainerClientDetail.nextColon', 'Next: {{d}}', { d: format(new Date(nextSession.scheduled_at), 'EEE p', { locale: dateFnsLocale }) })
                          : t('trainerClientDetail.progressPct', '{{p}}% complete', { p: programProgress.progressPct })}
                      </span>
                    </div>
                  </>
                )}
              </TCard>
            </>
          )}

          {/* (Recent log removed — duplicated the History tab's Entrenos list.
              recentSessions still feeds the hero's next-session fallback.) */}

          {/* Recent PRs (Atelier) */}
          <TSectionHeader title={t('trainerClientDetail.recentPrs', 'Recent PRs')} />
          {topPRs.length === 0 ? (
            <TCard padded={14} style={{ marginBottom: 22 }}>
              <p style={{ fontSize: 13, color: TT.textMute }}>
                {t('trainerNotes.progress.noPRs', 'No PRs yet')}
              </p>
            </TCard>
          ) : (
            <TCard padded={0} style={{ marginBottom: 22, overflow: 'hidden' }}>
              {topPRs.map((pr, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 15px',
                    borderTop: i > 0 ? `1px solid ${TT.border}` : 'none',
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                    background: 'rgba(240,138,60,.14)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Trophy size={16} color="#E08A2E" strokeWidth={2.2} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {exName(pr.exercises) || t('trainerNotes.overview.unknownExercise', 'Lift')}
                    </div>
                    <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 1 }}>
                      {format(new Date(pr.achieved_at), 'MMM d', { locale: dateFnsLocale })}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: TT.text, fontFamily: TFont.mono }}>
                      {pr.weight_lbs} {t('common:lb', 'lb')}{pr.reps ? ` × ${pr.reps}` : ''}
                    </div>
                    {pr.estimated_1rm ? (
                      <div style={{ fontSize: 11, color: TT.accent, fontWeight: 800, marginTop: 1 }}>
                        {t('trainerClientDetail.oneRmShort', '1RM {{v}}', { v: Math.round(pr.estimated_1rm) })}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: TT.accent, fontWeight: 800, marginTop: 1 }}>
                        {t('trainerClientDetail.pr.up', '↑ PR')}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {(personalRecords || []).length > prVisible && (
                <button type="button" onClick={() => setPrVisible(v => v + 5)} className="tt-tap"
                  style={{ width: '100%', padding: 13, background: 'transparent', border: 'none', borderTop: `1px solid ${TT.border}`, color: TT.accentInk, fontWeight: 800, fontSize: 12.5, fontFamily: TFont.display, cursor: 'pointer' }}>
                  {t('trainerClientDetail.showMore', 'Ver más')}
                </button>
              )}
            </TCard>
          )}

          {/* Client goals (member-set, read-only — RLS read policy from 0527;
              section hides itself when the query errors or returns nothing) */}
          {memberGoals.length > 0 && (
            <>
              <TSectionHeader title={t('trainerClientDetail.clientGoals.title', 'Client goals')} />
              <TCard padded={0} style={{ marginBottom: 22, overflow: 'hidden' }}>
                {[...memberGoals]
                  .sort((a, b) => (a.achieved_at ? 1 : 0) - (b.achieved_at ? 1 : 0))
                  .slice(0, 6)
                  .map((g, i) => {
                    const target = parseFloat(g.target_value) || 0;
                    const current = parseFloat(g.current_value) || 0;
                    // Direction-aware (mirrors GoalsSection.goalProgressPct): body
                    // goals count DOWN from a baseline, so current/target pins them
                    // at 100%. Use distance covered when a baseline is recorded;
                    // fall back to current/target for legacy goals.
                    const start = g.start_value != null ? parseFloat(g.start_value) : NaN;
                    const rawPct = (!isNaN(start) && start !== target)
                      ? ((start - current) / (start - target)) * 100
                      : (target > 0 ? (current / target) * 100 : 0);
                    const pct = isFinite(rawPct) ? Math.min(100, Math.max(0, Math.round(rawPct))) : 0;
                    const achieved = !!g.achieved_at;
                    return (
                      <div
                        key={g.id}
                        style={{ padding: '12px 15px', borderTop: i > 0 ? `1px solid ${TT.border}` : 'none' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: TT.text, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {localizeGoalLabel(g, t)}
                          </div>
                          {achieved ? (
                            <TPill tone="good" size="m" style={{ flexShrink: 0 }}>
                              {t('goals.achieved', 'Achieved')}
                            </TPill>
                          ) : (
                            <span style={{ fontSize: 12, fontWeight: 700, color: TT.textSub, fontFamily: TFont.mono, flexShrink: 0 }}>
                              {current.toLocaleString()} / {target.toLocaleString()}{g.unit ? ` ${g.unit}` : ''}
                            </span>
                          )}
                        </div>
                        {!achieved && (
                          <div style={{ height: 5, background: TT.surface2, borderRadius: 999, marginTop: 8, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px var(--tt-border)' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#27B0A0,#178C7E)', borderRadius: 999 }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
              </TCard>
            </>
          )}

          {/* Pinned notes (warm gradient, Atelier) */}
          {(pinnedNote || injuriesNote) && (
            <>
              <TSectionHeader
                title={t('trainerClientDetail.pinnedNotes', 'Pinned notes')}
                action={
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'SET', payload: { activeTab: 'notesFollowUp' } })}
                    className="tt-tap"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: TT.textSub, padding: 0 }}
                  >
                    {t('trainerClientDetail.edit', 'Edit')}
                  </button>
                }
              />
              <TCard padded={14} style={{ marginBottom: 22, background: pinnedNoteBg, borderColor: pinnedNoteBorder }}>
                {[
                  injuriesNote && {
                    ico: AlertTriangle,
                    iconHue: '#D97A2E', iconBg: 'rgba(240,138,60,.14)',
                    label: t('trainerClientDetail.notesWatch', 'Watch'),
                    labelColor: isDarkTheme ? TT.warnInk : '#B07A28',
                    value: injuriesNote,
                  },
                  pinnedNote && {
                    ico: StickyNote,
                    iconHue: TT.accent, iconBg: 'color-mix(in srgb, #1E9C8E 14%, transparent)',
                    label: t('trainerClientDetail.notesCoach', 'Coach notes'),
                    labelColor: isDarkTheme ? TT.accentInk : '#1E8276',
                    value: pinnedNote.length > 240 ? pinnedNote.slice(0, 240) + '…' : pinnedNote,
                  },
                ].filter(Boolean).map((n, i) => {
                  const Ico = n.ico;
                  return (
                    <div key={i} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', marginTop: i ? 12 : 0 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 9, background: n.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Ico size={15} color={n.iconHue} strokeWidth={2.2} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 10.5, fontWeight: 800, color: n.labelColor, letterSpacing: 0.5, textTransform: 'uppercase' }}>{n.label}</div>
                        <div style={{ fontSize: 13.5, color: isDarkTheme ? TT.text : '#5A4A2A', fontWeight: 600, marginTop: 2, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{n.value}</div>
                      </div>
                    </div>
                  );
                })}
              </TCard>
            </>
          )}

        </div>
      )}

      {/* ===================== TAB: BODY (read-only client mirror of BodyMetrics) =====================
          Option A: read-only. RLS on body_measurements / progress_photos / body_weight_logs ties writes to
          profile_id = auth.uid(), which would block trainers. Adding new RLS policies + RPCs (Option B) is
          additional backend scope; this read-only mirror satisfies the v1 requirement and is safe to ship.
          Trainer still sees the full picture (weight trend, body comp, measurements grid, photo timeline). */}
      {tab === 'body' && (
        <div style={{ padding: '16px 16px 24px' }} className="md:max-w-[860px] md:mx-auto">
          {/* Recovery + what-to-train (trainer tool) */}
          <TrainerClientRecovery clientId={clientId} />
          {/* Attendance calendar (with-you vs alone) */}
          <TrainerClientAttendance clientId={clientId} />
          {/* View-only banner */}
          <div style={{
            background: TT.warnSoft, color: TT.warnInk,
            borderRadius: 12, padding: '8px 12px', marginBottom: 22,
            fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Eye size={14} />
            {t('trainerClientDetail.body.viewOnly', 'View only — client owns these records.')}
          </div>

          {/* Body composition summary — 4 stat cards (Atelier) */}
          <TSectionHeader title={t('trainerClientDetail.body.composition', 'Body composition')} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 22 }}>
            {[
              {
                l: t('trainerClientDetail.body.weight', 'Weight'),
                v: bodyWeightStats.current != null ? `${bodyWeightStats.current.toFixed(1)}` : '—',
                u: t('common:lb', 'lb'),
              },
              {
                l: t('trainerClientDetail.body.age', 'Age'),
                v: onboarding?.age || '—',
                u: '',
              },
              {
                l: t('trainerClientDetail.body.height', 'Height'),
                v: onboarding?.height_inches
                  ? `${Math.floor(onboarding.height_inches / 12)}'${onboarding.height_inches % 12}"`
                  : (onboarding?.height_cm ? `${onboarding.height_cm}` : '—'),
                u: onboarding?.height_inches ? '' : (onboarding?.height_cm ? t('common:cm', 'cm') : ''),
              },
              {
                l: t('trainerClientDetail.body.bodyFat', 'Body fat'),
                v: measurements?.body_fat_pct != null ? `${parseFloat(measurements.body_fat_pct).toFixed(1)}` : '—',
                u: measurements?.body_fat_pct != null ? '%' : '',
              },
            ].map((s, i) => (
              <TCard key={i} padded={0} style={{ padding: '12px 8px', textAlign: 'center' }}>
                <div style={{
                  fontFamily: TFont.display, fontSize: 19, fontWeight: 800,
                  color: TT.text, letterSpacing: -0.6, lineHeight: 1,
                }}>
                  {s.v}{s.u && <span style={{ fontSize: 11, fontWeight: 700, color: TT.textMute, marginLeft: 1 }}>{s.u}</span>}
                </div>
                <div style={{
                  fontSize: 9.5, color: TT.textMute, fontWeight: 800,
                  letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 5,
                }}>{s.l}</div>
              </TCard>
            ))}
          </div>

          {/* Weight trend with period selector */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <div style={{
              fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text,
              letterSpacing: -0.3,
            }}>
              {t('trainerClientDetail.body.weightTrend', 'Weight trend')}
            </div>
            <div style={{ display: 'flex', gap: 4, background: TT.surface, padding: 3, borderRadius: 10, boxShadow: 'inset 0 0 0 1px var(--tt-border)' }}>
              {[
                { l: '30d', v: 30 },
                { l: '90d', v: 90 },
                { l: '180d', v: 180 },
                { l: '1y', v: 365 },
              ].map(p => (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => dispatch({ type: 'SET', payload: { bodyPeriod: p.v } })}
                  aria-pressed={bodyPeriod === p.v}
                  className="tt-tap"
                  style={{
                    padding: '5px 9px', borderRadius: 7,
                    background: bodyPeriod === p.v ? TT.text : 'transparent',
                    color: bodyPeriod === p.v ? TT.onInverse : TT.textMute,
                    fontFamily: TFont.display, fontSize: 11, fontWeight: 700,
                    border: 'none', cursor: 'pointer', minHeight: 28,
                  }}
                >{p.l}</button>
              ))}
            </div>
          </div>
          <TCard padded={16} style={{ marginBottom: 22 }} data-swipe-ignore>
            {bodyWeightStats.current != null && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: TFont.display, fontSize: 26, fontWeight: 800, color: TT.text, letterSpacing: -1, lineHeight: 1 }}>
                  {bodyWeightStats.current.toFixed(1)} <span style={{ fontSize: 13, color: TT.textMute }}>{t('common:lb', 'lb')}</span>
                </span>
                {bodyWeightStats.delta != null && (
                  <span style={{
                    fontSize: 12, fontWeight: 800,
                    color: bodyWeightStats.delta > 0 ? TT.hot : bodyWeightStats.delta < 0 ? TT.good : TT.accent,
                  }}>
                    {bodyWeightStats.delta > 0 ? '+' : ''}{bodyWeightStats.delta.toFixed(1)} {t('common:lb', 'lb')} · {bodyPeriod}d
                  </span>
                )}
              </div>
            )}
            {bodyWeightChart.length > 1 ? (() => {
              // Compact Atelier sparkline (matches the reference) — area + line, no axes.
              const ws = bodyWeightChart.map(d => Number(d.weight)).filter(n => !Number.isNaN(n));
              const min = Math.min(...ws), max = Math.max(...ws), range = (max - min) || 1;
              const W = 300, H = 80, padY = 8;
              const pt = (v, i) => {
                const x = ws.length === 1 ? W : (i / (ws.length - 1)) * W;
                const y = H - padY - ((v - min) / range) * (H - padY * 2);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              };
              const line = ws.map(pt).join(' ');
              return (
                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 80, marginTop: 10, display: 'block' }} preserveAspectRatio="none" aria-hidden="true">
                  <polygon points={`${line} ${W},${H} 0,${H}`} fill="rgba(240,138,60,.10)" />
                  <polyline points={line} fill="none" stroke="#F08A3C" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              );
            })() : (
              <p style={{ fontSize: 13, color: TT.textMute, marginTop: 10 }}>
                {t('trainerClientDetail.body.notEnoughLogs', 'Not enough weight logs to show a trend yet.')}
              </p>
            )}
          </TCard>

          {/* Measurements — ruler-icon rows with vs-last deltas (Atelier) */}
          <TSectionHeader
            title={t('trainerClientDetail.body.measurements', 'Measurements')}
            action={
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {measurements && (
                  <span style={{ fontSize: 11.5, color: TT.textMute, fontWeight: 600 }}>
                    {format(new Date(measurements.measured_at), 'MMM d', { locale: dateFnsLocale })}
                  </span>
                )}
                {canEditMeasurements && (
                  <button type="button" onClick={openEditMeasurements} className="tt-tap"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 800, color: TT.accentInk, padding: 0 }}>
                    <Pencil size={13} strokeWidth={2.4} />
                    {measurements ? t('trainerClientDetail.body.edit', 'Edit') : t('trainerClientDetail.body.add', 'Add')}
                  </button>
                )}
              </div>
            }
          />
          {measurements ? (
            <TCard padded={0} style={{ marginBottom: 22, overflow: 'hidden' }}>
              {MEAS_FIELDS
                .filter(m => measurements[m.k] != null)
                .map((m, i) => {
                  const delta = measDelta(m.k);
                  return (
                  <div key={m.k} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 15px',
                    borderTop: i > 0 ? `1px solid ${TT.border}` : 'none',
                  }}>
                    <Ruler size={16} color={TT.textMute} strokeWidth={2} />
                    <div style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: TT.text }}>{m.l}</div>
                    {delta && delta.d !== 0 && (
                      <span style={{ fontSize: 11, fontWeight: 800, fontFamily: TFont.mono, color: delta.favorable ? TT.goodInk : TT.textMute }}>
                        {delta.d > 0 ? '↑' : '↓'}{Math.abs(delta.d).toFixed(1)}
                      </span>
                    )}
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: TT.text, fontFamily: TFont.mono }}>
                      {parseFloat(measurements[m.k]).toFixed(1)}
                      <span style={{ fontSize: 10, fontWeight: 600, color: TT.textMute, marginLeft: 2 }}>{t('common:cm', 'cm')}</span>
                    </div>
                  </div>
                  );
                })}
            </TCard>
          ) : (
            <TCard padded={14} style={{ marginBottom: 22 }}>
              <p style={{ fontSize: 13, color: TT.textMute }}>
                {t('trainerClientDetail.body.noMeasurements', 'No measurements recorded yet.')}
              </p>
            </TCard>
          )}
          {!canEditMeasurements && (
            <p style={{ fontSize: 11.5, color: TT.textMute, margin: '-14px 2px 22px', display: 'flex', alignItems: 'center', gap: 5 }}>
              {t('trainerClientDetail.body.editingDisabled', 'This member has turned off trainer editing of measurements.')}
            </p>
          )}

          {/* Progress photos timeline (month-grouped, read-only) */}
          <TSectionHeader title={t('trainerClientDetail.body.photos', 'Progress photos')} />
          {photosByMonth.length === 0 ? (
            <TCard padded={14}>
              <p style={{ fontSize: 13, color: TT.textMute }}>
                {t('trainerClientDetail.body.noPhotos', 'No progress photos yet.')}
              </p>
            </TCard>
          ) : (
            photosByMonth.map(grp => (
              <div key={grp.key} style={{ marginBottom: 22 }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: TT.textSub,
                  letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6,
                }}>{grp.label}</div>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6,
                }}>
                  {grp.photos.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => openPhotoViewer(p)}
                      aria-label={t('trainerClientDetail.body.viewPhoto', 'View progress photo')}
                      style={{
                        aspectRatio: '3/4', borderRadius: 12, overflow: 'hidden',
                        background: TT.surface2, border: `1px solid ${TT.border}`,
                        position: 'relative', cursor: 'pointer', padding: 0,
                      }}
                    >
                      <img
                        src={p.signedUrl}
                        alt={p.view_angle || t('trainerClientDetail.photos.alt', 'Progress photo')}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      <span style={{
                        position: 'absolute', bottom: 4, left: 4,
                        fontSize: 9, fontWeight: 700, color: '#fff',
                        background: 'rgba(0,0,0,0.55)', padding: '1px 6px',
                        borderRadius: 6, textTransform: 'capitalize',
                      }}>
                        {p.view_angle || format(new Date(p.taken_at), 'MMM d', { locale: dateFnsLocale })}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ===================== TAB: HISTORY (full client history) ===================== */}
      {tab === 'history' && (
        <div style={{ padding: '16px 16px 24px' }} className="md:max-w-[860px] md:mx-auto">
          {/* Streak summary — flame / trophy stat cards (Atelier) */}
          <TSectionHeader title={t('trainerClientDetail.history.streaks', 'Streaks')} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 22 }}>
            {[
              { ico: Flame, hue: '#F08A3C', l: t('trainerClientDetail.history.currentStreak', 'Current streak'), big: streakStats.current },
              { ico: Trophy, hue: TT.accent, l: t('trainerClientDetail.history.longestStreak', 'Longest streak'), big: streakStats.longest },
            ].map((s, i) => {
              const Ico = s.ico;
              return (
                <TCard key={i} padded={15}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Ico size={15} color={s.hue} strokeWidth={2.2} />
                    <span style={{ fontSize: 10, fontWeight: 800, color: TT.textMute, letterSpacing: 0.7, textTransform: 'uppercase' }}>{s.l}</span>
                  </div>
                  <div style={{ fontFamily: TFont.display, fontSize: 30, fontWeight: 800, color: s.hue, letterSpacing: -1.2, lineHeight: 1, marginTop: 9 }}>
                    {s.big}<span style={{ fontSize: 15, color: TT.textMute }}> {t('trainerClientDetail.history.daysUnit', 'days')}</span>
                  </div>
                </TCard>
              );
            })}
          </div>

          {/* PR timeline */}
          <TSectionHeader title={t('trainerClientDetail.history.prTimeline', 'PR timeline')} />
          <TCard padded={14} style={{ marginBottom: 22 }} data-swipe-ignore>
            {prTimelineData.series.length > 1 ? (
              <div style={{ height: 200, marginLeft: -10 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={prTimelineData.series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,134,140,0.22)" />
                    <XAxis dataKey="month" tick={{ fill: TT.textMute, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: TT.textMute, fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
                    <Tooltip content={<ChartTooltip formatter={(v) => `${v} lb`} />} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    {prTimelineData.lifts.map((lift, i) => {
                      const palette = [TT.accent, TT.hot, TT.coach, TT.warn, TT.good];
                      return (
                        <Line
                          key={lift}
                          type="monotone"
                          dataKey={lift}
                          stroke={palette[i % palette.length]}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          connectNulls
                        />
                      );
                    })}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: TT.textMute }}>
                {t('trainerClientDetail.history.notEnoughPrs', 'Not enough PR data yet.')}
              </p>
            )}
          </TCard>

          {/* Volume trend */}
          <TSectionHeader title={t('trainerClientDetail.history.volumeTrend', 'Volume trend')} />
          <TCard padded={14} style={{ marginBottom: 22 }} data-swipe-ignore>
            {volumeTrendData.some(d => d.volume > 0) ? (
              <div style={{ height: 180, marginLeft: -10 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={volumeTrendData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="histVolGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={TT.accent} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={TT.accent} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,134,140,0.22)" />
                    <XAxis dataKey="week" tick={{ fill: TT.textMute, fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: TT.textMute, fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
                    <Tooltip content={<ChartTooltip formatter={(v) => `${Number(v).toLocaleString()} lb`} nameLabel={t('trainerClientDetail.history.volume', 'Volume')} />} />
                    <Area type="monotone" dataKey="volume" stroke={TT.accent} strokeWidth={2} fill="url(#histVolGrad)" name={t('trainerClientDetail.history.volume', 'Volume')} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: TT.textMute }}>
                {t('trainerClientDetail.history.noVolume', 'No volume recorded in the last 12 weeks.')}
              </p>
            )}
          </TCard>

          {/* Monthly visits — broken down by week (detailed calendar lives in Body) */}
          <TSectionHeader
            title={t('trainerClientDetail.history.monthlyVisits', 'Monthly visits')}
            action={monthlyVisits.monthLabel}
          />
          <TCard padded={16} style={{ marginBottom: 22 }} data-swipe-ignore>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 16 }}>
              <span style={{ fontFamily: TFont.display, fontSize: 26, fontWeight: 800, color: TT.text, letterSpacing: -1, lineHeight: 1 }}>
                {monthlyVisits.total}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: TT.textSub }}>
                {t('trainerClientDetail.history.visitsThisMonth', 'visits this month')}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: 84, gap: 8 }}>
              {monthlyVisits.weeks.map((w) => {
                const h = w.count === 0 ? 6 : Math.max(12, (w.count / monthlyVisits.max) * 60);
                return (
                  <div key={w.week} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: TFont.display, fontSize: 12.5, fontWeight: 800, color: w.count > 0 ? TT.text : TT.textMute }}>{w.count}</span>
                    <div style={{
                      width: '100%', maxWidth: 38, height: h, borderRadius: 8,
                      background: w.count > 0 ? 'linear-gradient(180deg,#27B0A0,#178C7E)' : TT.surface2,
                      boxShadow: w.count > 0 ? 'inset 0 1px 0 rgba(255,255,255,.25)' : 'inset 0 0 0 1px var(--tt-border)',
                    }} />
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: TT.textMute }}>
                      {t('trainerClientDetail.history.weekShort', 'W')}{w.week}
                    </span>
                  </div>
                );
              })}
            </div>
          </TCard>

          {/* Workouts log */}
          <TSectionHeader title={t('trainerClientDetail.history.workouts', 'Workouts')} />
          {!historyLoaded ? (
            <TCard padded={14}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
                <Loader2 size={18} className="animate-spin" />
              </div>
            </TCard>
          ) : allSessions.length === 0 ? (
            <TCard padded={14}>
              <p style={{ fontSize: 13, color: TT.textMute }}>
                {t('trainerClientDetail.history.noWorkouts', 'No completed workouts yet.')}
              </p>
            </TCard>
          ) : (
            <TCard padded={0}>
              {allSessions.slice(0, logVisible).map((s, i) => {
                const isOpen = expandedSessionId === s.id;
                return (
                  <div key={s.id} style={{ borderTop: i > 0 ? `1px solid ${TT.border}` : 'none' }}>
                    <button
                      type="button"
                      onClick={() => {
                        const next = isOpen ? null : s.id;
                        dispatch({ type: 'SET', payload: { expandedSessionId: next } });
                        if (next) loadSessionDetail(s.id);
                      }}
                      aria-expanded={isOpen}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 14px', background: 'transparent', border: 'none',
                        cursor: 'pointer', textAlign: 'left', minHeight: 44,
                      }}
                    >
                      <div style={{ width: 36, textAlign: 'center', flexShrink: 0 }}>
                        <div style={{
                          fontSize: 10, fontWeight: 700, color: TT.textMute,
                          letterSpacing: 0.4, textTransform: 'uppercase',
                        }}>
                          {format(new Date(s.started_at), 'MMM', { locale: dateFnsLocale })}
                        </div>
                        <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, lineHeight: 1 }}>
                          {format(new Date(s.started_at), 'd', { locale: dateFnsLocale })}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.name || t('trainerNotes.overview.workout', 'Workout')}
                        </div>
                        <div style={{ fontSize: 11, color: TT.textSub, marginTop: 1 }}>
                          {format(new Date(s.started_at), 'EEE · h:mm a', { locale: dateFnsLocale })}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 11.5, fontFamily: TFont.mono, fontWeight: 700, color: TT.text }}>
                          {s.total_volume_lbs >= 1000
                            ? `${(s.total_volume_lbs / 1000).toFixed(1)}${t('trainerClientDetail.body.kLbs', 'k lbs')}`
                            : `${s.total_volume_lbs || 0} ${t('common:lb', 'lb')}`}
                        </div>
                        <div style={{ fontSize: 10, color: TT.textMute, marginTop: 1 }}>
                          {formatDuration(s.duration_seconds)}
                        </div>
                      </div>
                      <ChevronDown
                        size={14}
                        style={{
                          color: TT.textMute, flexShrink: 0,
                          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 150ms',
                        }}
                      />
                    </button>
                    {isOpen && (
                      <div style={{
                        padding: '0 14px 12px',
                        fontSize: 12, color: TT.textSub,
                        background: TT.surface2,
                      }}>
                        {(() => {
                          // Per-exercise breakdown (fetched on first expand,
                          // cached per session) — the collapsed row already
                          // shows date/duration/volume.
                          const detail = sessionDetails[s.id];
                          if (!detail || detail.loading) {
                            return (
                              <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
                                <Loader2 size={15} className="animate-spin" />
                              </div>
                            );
                          }
                          if (detail.exercises.length === 0) {
                            return (
                              <p style={{ fontSize: 12, color: TT.textMute, paddingTop: 10 }}>
                                {t('trainerClientDetail.history.noDetail', 'No exercise detail recorded for this session.')}
                              </p>
                            );
                          }
                          return detail.exercises.map((ex, j) => (
                            <div key={ex.id} style={{ paddingTop: j === 0 ? 10 : 9 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 700, color: TT.text }}>{ex.name}</div>
                              {ex.sets.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                                  {ex.sets.map((set, k) => {
                                    const w = Number(set.weight_lbs) || 0;
                                    const r = set.reps || 0;
                                    const label = (!w && !r && set.duration_seconds)
                                      ? `${set.duration_seconds}s`
                                      : `${w}×${r}`;
                                    return (
                                      <span
                                        key={k}
                                        style={{
                                          fontFamily: TFont.mono, fontSize: 11, fontWeight: 700,
                                          color: TT.text, background: TT.surface,
                                          borderRadius: 7, padding: '2px 7px',
                                          boxShadow: 'inset 0 0 0 1px var(--tt-border)',
                                        }}
                                      >
                                        {label}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
              {allSessions.length > logVisible && (
                <button type="button" onClick={() => setLogVisible(v => v + 5)} className="tt-tap"
                  style={{ width: '100%', padding: 13, background: 'transparent', border: 'none', borderTop: `1px solid ${TT.border}`, color: TT.accentInk, fontWeight: 800, fontSize: 12.5, fontFamily: TFont.display, cursor: 'pointer' }}>
                  {t('trainerClientDetail.showMore', 'Ver más')}
                </button>
              )}
            </TCard>
          )}
        </div>
      )}

      {/* ── Remaining tab content (each block is already gated on activeTab) ── */}
      <div className="md:max-w-[860px] md:mx-auto">

      {/* ===================== TAB 2: NOTES & FOLLOW-UP ===================== */}
      {tab === 'notesFollowUp' && (
        <div style={{ padding: '16px 16px 24px' }} className="md:grid md:grid-cols-2 md:gap-4">
          {/* Coach Notes (merged: notes + preferences + goal reminders) */}
          <TCard padded={16} style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: 9, background: 'color-mix(in srgb, #1E9C8E 14%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <StickyNote size={15} color={TT.accent} strokeWidth={2.2} />
              </div>
              <span style={{ fontFamily: TFont.display, fontSize: 15, fontWeight: 800, color: TT.text, letterSpacing: -0.2 }}>{t('trainerNotes.notes.coachNotes')}</span>
            </div>
            <textarea
              value={notesData.notes}
              onChange={(e) => {
                if (e.target.value.length <= 5000) {
                  dispatch({ type: 'SET_NOTES_FIELD', field: 'notes', value: e.target.value });
                }
              }}
              placeholder={t('trainerNotes.notes.notesPlaceholder')}
              onFocus={(e) => { e.target.style.boxShadow = `inset 0 0 0 1.5px ${TT.accent}`; }}
              onBlur={(e) => { e.target.style.boxShadow = 'inset 0 0 0 1px var(--tt-border)'; }}
              style={{
                width: '100%', background: TT.surface2, borderRadius: 12, padding: 12,
                fontSize: 14, color: TT.text, resize: 'none', border: 'none',
                boxShadow: 'inset 0 0 0 1px var(--tt-border)', outline: 'none',
              }}
              rows={10}
            />
            <span style={{ fontSize: 11, color: TT.textMute, marginTop: 6, display: 'block' }}>
              {notesData.notes.length} / 5000
            </span>
          </TCard>

          {/* Injuries / Limitations — kept separate (safety-critical) */}
          <TCard padded={16} style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: 9, background: 'color-mix(in srgb, #FF5A2E 14%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <AlertTriangle size={15} color={TT.hot} strokeWidth={2.2} />
              </div>
              <span style={{ fontFamily: TFont.display, fontSize: 15, fontWeight: 800, color: TT.text, letterSpacing: -0.2 }}>{t('trainerNotes.notes.injuriesLimitations')}</span>
            </div>
            <textarea
              value={notesData.injuries}
              onChange={(e) => {
                if (e.target.value.length <= 1000) {
                  dispatch({ type: 'SET_NOTES_FIELD', field: 'injuries', value: e.target.value });
                }
              }}
              placeholder={t('trainerNotes.notes.injuriesPlaceholder')}
              onFocus={(e) => { e.target.style.boxShadow = `inset 0 0 0 1.5px ${TT.accent}`; }}
              onBlur={(e) => { e.target.style.boxShadow = 'inset 0 0 0 1px var(--tt-border)'; }}
              style={{
                width: '100%', background: TT.surface2, borderRadius: 12, padding: 12,
                fontSize: 14, color: TT.text, resize: 'none', border: 'none',
                boxShadow: 'inset 0 0 0 1px var(--tt-border)', outline: 'none',
              }}
              rows={5}
            />

            {/* Member-declared injuries + excluded exercises (from onboarding —
                read-only safety info, shown only when the member declared any) */}
            {declaredInjuries && (
              <div style={{
                marginTop: 12, padding: '11px 12px', borderRadius: 12,
                background: TT.warnSoft,
              }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: TT.warnInk, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  {t('trainerClientDetail.declaredInjuries.title', 'Client-declared injuries')}
                </div>
                {declaredInjuries.notes && (
                  <p style={{ fontSize: 13, color: TT.text, fontWeight: 600, marginTop: 5, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                    {declaredInjuries.notes}
                  </p>
                )}
                {declaredInjuries.excludedNames.length > 0 && (
                  <>
                    <div style={{ fontSize: 10.5, fontWeight: 800, color: TT.warnInk, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: declaredInjuries.notes ? 9 : 5 }}>
                      {t('trainerClientDetail.declaredInjuries.excluded', 'Excluded exercises')}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                      {declaredInjuries.excludedNames.map((name, i) => (
                        <span key={i} style={{
                          fontSize: 11.5, fontWeight: 700, color: TT.text,
                          background: TT.surface, borderRadius: 8, padding: '3px 8px',
                          boxShadow: 'inset 0 0 0 1px var(--tt-border)',
                        }}>
                          {name}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </TCard>

          {/* Save button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginBottom: 22 }} className="md:col-span-2">
            {notesSaved && (
              <span style={{ fontSize: 13, color: TT.goodInk, fontWeight: 700 }}>{t('trainerNotes.notes.saved')}</span>
            )}
            <TPrimaryButton onClick={handleSaveNotes} disabled={savingNotes}>
              <Save size={14} strokeWidth={2.4} />
              {savingNotes ? t('trainerNotes.notes.saving') : t('trainerNotes.notes.saveNotes')}
            </TPrimaryButton>
          </div>

          {/* Follow-up section */}
          <div className="md:col-span-2">
            <TSectionHeader
              title={t('trainerNotes.followUp.title')}
              action={
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'SET', payload: { showFollowupModal: true } })}
                  className="tt-tap"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: TT.accent, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Plus size={13} strokeWidth={2.6} />
                  {t('trainerNotes.followUp.logFollowUp')}
                </button>
              }
            />
            {followups.length === 0 ? (
              <TCard padded={16}>
                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                  <Phone size={32} color={TT.textMute} strokeWidth={1.6} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                  <p style={{ fontSize: 13, color: TT.textSub }}>{t('trainerNotes.followUp.noFollowUps')}</p>
                  <p style={{ fontSize: 12, color: TT.textMute, marginTop: 2 }}>{t('trainerNotes.followUp.noFollowUpsHint')}</p>
                </div>
              </TCard>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxHeight: 520, overflowY: 'auto' }}>
                {followups.map((fu) => {
                  const MethodIcon = METHOD_ICONS[fu.method] || Phone;
                  const tone = METHOD_TONES[fu.method] || TT.accent;
                  const outcomeStyle = fu.outcome ? OUTCOME_STYLES[fu.outcome] : null;
                  const methodLabel = t(`trainerNotes.followUp.methods.${FU_METHOD_KEY[fu.method] || 'call'}`);
                  return (
                    <TCard key={fu.id} padded={13} style={{ display: 'flex', gap: 12 }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                        background: `color-mix(in srgb, ${tone} 14%, transparent)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <MethodIcon size={16} color={tone} strokeWidth={2.1} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 800, color: TT.text, fontFamily: TFont.display }}>{methodLabel}</span>
                          <span style={{ fontSize: 11, color: TT.textMute, fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {format(new Date(fu.created_at), 'MMM d, h:mm a', { locale: dateFnsLocale })}
                          </span>
                        </div>
                        {outcomeStyle && (
                          <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full mt-1 ${outcomeStyle.bg} ${outcomeStyle.color}`}>
                            {outcomeStyle.label}
                          </span>
                        )}
                        {fu.note && (
                          <p style={{ fontSize: 12.5, color: TT.textSub, marginTop: 3, lineHeight: 1.45 }}>{fu.note}</p>
                        )}
                      </div>
                    </TCard>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================== TAB 3: PROGRAM & NUTRITION ===================== */}
      {tab === 'programNutrition' && (
        <div style={{ padding: '16px 16px 24px' }} className="md:max-w-[860px] md:mx-auto">
          {/* Current assigned program */}
          <TSectionHeader title={t('trainerNotes.program.currentProgram')} />
          <TCard padded={16} style={{ marginBottom: 22 }}>
            {programName ? (
              <div>
                {(() => {
                  const currentProgramObj = availablePrograms.find(p => p.id === client?.assigned_program_id)
                    || (enrollment?.gym_programs?.weeks ? enrollment.gym_programs : null);
                  return (
                <div
                  role={currentProgramObj?.weeks ? 'button' : undefined}
                  tabIndex={currentProgramObj?.weeks ? 0 : undefined}
                  onClick={currentProgramObj?.weeks ? () => setViewProgram(currentProgramObj) : undefined}
                  onKeyDown={currentProgramObj?.weeks ? (e) => { if (e.key === 'Enter') setViewProgram(currentProgramObj); } : undefined}
                  className={currentProgramObj?.weeks ? 'tt-tap' : undefined}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, cursor: currentProgramObj?.weeks ? 'pointer' : 'default' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 13, flexShrink: 0,
                      background: 'linear-gradient(160deg,#27B0A0,#178C7E)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 4px 10px -4px rgba(10,90,82,.5), inset 0 1px 0 rgba(255,255,255,.25)',
                    }}>
                      <Dumbbell size={22} color="#fff" strokeWidth={2.1} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{programName}</div>
                      {programProgress && (
                        <div style={{ fontSize: 12, color: TT.textSub, marginTop: 2 }}>
                          {t('trainerClientDetail.weekProgram', '{{n}}-week program', { n: programProgress.totalWeeks })}
                          {' · '}
                          {programProgress.daysPerWeek} {t('trainerNotes.program.daysPerWeek')}
                        </div>
                      )}
                    </div>
                  </div>
                  {programProgress && (
                    <TPill tone="teal" size="l" style={{ flexShrink: 0 }}>
                      {t('trainerClientDetail.weekOfPill', 'Week {{w}} / {{t}}', { w: programProgress.currentWeek, t: programProgress.totalWeeks })}
                    </TPill>
                  )}
                </div>
                  );
                })()}
                {programProgress && (
                  <>
                    <div style={{ height: 6, background: TT.surface2, borderRadius: 999, marginTop: 14, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px var(--tt-border)' }}>
                      <div style={{ width: `${programProgress.progressPct}%`, height: '100%', background: 'linear-gradient(90deg,#27B0A0,#178C7E)', borderRadius: 999 }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11.5, color: TT.textSub, fontWeight: 600 }}>
                      <span>{t('trainerClientDetail.weekProgressLabel', 'Week {{w}} of {{t}}', { w: programProgress.currentWeek, t: programProgress.totalWeeks })}</span>
                      <span>
                        {nextSession
                          ? t('trainerClientDetail.nextColon', 'Next: {{d}}', { d: format(new Date(nextSession.scheduled_at), 'EEE p', { locale: dateFnsLocale }) })
                          : t('trainerClientDetail.progressPct', '{{p}}% complete', { p: programProgress.progressPct })}
                      </span>
                    </div>
                  </>
                )}
                <button
                  onClick={() => handleAssignProgram(null)}
                  className="tt-tap"
                  style={{ marginTop: 14, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: TT.hot, padding: '6px 0', minHeight: 36 }}
                >
                  {t('trainerNotes.program.removeProgram')}
                </button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <BookOpen size={32} color={TT.textMute} strokeWidth={1.6} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                <p style={{ fontSize: 13, color: TT.textSub }}>{t('trainerNotes.program.noProgram')}</p>
              </div>
            )}
          </TCard>

          {/* Available programs to assign */}
          <TSectionHeader title={t('trainerNotes.program.availablePrograms')} />
          {availablePrograms.length === 0 ? (
            <TCard padded={16} style={{ marginBottom: 22 }}>
              <p style={{ fontSize: 13, color: TT.textMute }}>{t('trainerNotes.program.noProgramsAvailable')}</p>
            </TCard>
          ) : (
            <TCard padded={0} style={{ marginBottom: 22, overflow: 'hidden' }}>
              {availablePrograms.map((prog, idx) => {
                const isAssigned = client.assigned_program_id === prog.id;
                const tone = ['#7A6BE0', '#F08A3C', '#27B0A0'][idx % 3];
                return (
                  <div
                    key={prog.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setViewProgram(prog)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setViewProgram(prog); }}
                    className="tt-tap"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                      padding: '13px 15px', borderTop: idx > 0 ? `1px solid ${TT.border}` : 'none',
                      background: isAssigned ? TT.accentSoft : 'transparent',
                    }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: `color-mix(in srgb, ${tone} 14%, transparent)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <ClipboardList size={18} color={tone} strokeWidth={2.1} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 14, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prog.name}</p>
                      <p style={{ fontSize: 11.5, color: TT.textSub, marginTop: 1 }}>
                        {/* gym_programs has no days_per_week column — duration only. */}
                        {prog.duration_weeks ? `${prog.duration_weeks} ${t('trainerNotes.program.weeks')}` : ''}
                      </p>
                    </div>
                    {isAssigned ? (
                      <TPill tone="teal" size="m" style={{ flexShrink: 0 }}>{t('trainerNotes.program.assigned')}</TPill>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAssignProgram(prog.id); }}
                        disabled={assigningProgram}
                        className="tt-btn tt-btn--secondary"
                        style={{ flexShrink: 0, padding: '7px 13px', borderRadius: 10, fontSize: 12, opacity: assigningProgram ? 0.5 : 1 }}
                      >
                        {t('trainerNotes.program.assign')}
                      </button>
                    )}
                  </div>
                );
              })}
            </TCard>
          )}

          {/* Nutrition section */}
          {!nutritionLoaded ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
              <Loader2 size={28} color={TT.accent} className="animate-spin" />
            </div>
          ) : (
            <>
              {/* Active Meal Plan / Macro Targets */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <UtensilsCrossed size={16} color={TT.accent} strokeWidth={2.2} />
                  {t('trainerNotes.nutrition.mealPlan', 'Assigned Meal Plan')}
                </div>
                {!showMealPlanForm && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={handleAutoGenerateMeals}
                      disabled={generatingMeals}
                      className="tt-btn tt-btn--secondary"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 10, fontSize: 12, opacity: generatingMeals ? 0.4 : 1 }}
                    >
                      {generatingMeals ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} color={TT.accent} />}
                      {t('trainerNotes.nutrition.autoGenerate', 'Auto-Generate')}
                    </button>
                    <button
                      onClick={openPlanPicker}
                      className="tt-btn tt-btn--secondary"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 10, fontSize: 12 }}
                    >
                      <ClipboardList size={12} color={TT.accent} />
                      {t('trainerNotes.nutrition.useExisting', 'Use existing')}
                    </button>
                    <button
                      onClick={() => dispatch({ type: 'SET', payload: { showMealPlanForm: true } })}
                      className="tt-btn tt-btn--secondary"
                      style={{ padding: '7px 12px', borderRadius: 10, fontSize: 12 }}
                    >
                      {activeMealPlan ? t('trainerNotes.nutrition.editPlan', 'Edit Plan') : t('trainerNotes.nutrition.assignPlan', 'Assign Plan')}
                    </button>
                  </div>
                )}
              </div>

              {activeMealPlan && !showMealPlanForm ? (
                <TCard padded={16} style={{ marginBottom: 22 }}>
                  <p style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.2 }}>{activeMealPlan.name}</p>
                  {activeMealPlan.description && (
                    <p style={{ fontSize: 12, color: TT.textSub, marginTop: 2, whiteSpace: 'pre-wrap' }}>{activeMealPlan.description}</p>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 14 }}>
                    {[
                      { label: t('trainerNotes.nutrition.cal', 'Cal'), val: activeMealPlan.target_calories, color: TT.text },
                      { label: t('trainerNotes.nutrition.protein', 'Protein'), val: activeMealPlan.target_protein_g ? `${activeMealPlan.target_protein_g}g` : '--', color: TT.coach },
                      { label: t('trainerNotes.nutrition.carbs', 'Carbs'), val: activeMealPlan.target_carbs_g ? `${activeMealPlan.target_carbs_g}g` : '--', color: TT.warn },
                      { label: t('trainerNotes.nutrition.fat', 'Fat'), val: activeMealPlan.target_fat_g ? `${activeMealPlan.target_fat_g}g` : '--', color: TT.hot },
                    ].map((m, i) => (
                      <div key={i} style={{ textAlign: 'center', padding: 10, borderRadius: 12, background: TT.surface2 }}>
                        <p style={{ fontSize: 9.5, color: TT.textMute, textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.4 }}>{m.label}</p>
                        <p style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: m.color, marginTop: 4 }}>{m.val || '--'}</p>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${TT.border}` }}>
                    <p style={{ fontSize: 11, color: TT.textMute }}>
                      {t('trainerNotes.nutrition.since', 'Since')} {format(new Date(activeMealPlan.start_date), 'MMM d, yyyy', { locale: dateFnsLocale })}
                      {Number(activeMealPlan.duration_weeks) > 1 && ` · ${t('trainerClientDetail.weekProgram', '{{n}}-week program', { n: activeMealPlan.duration_weeks })}`}
                    </p>
                    <button
                      onClick={handleDeactivateMealPlan}
                      className="tt-tap"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: TT.hot, padding: '6px 0', minHeight: 36, display: 'flex', alignItems: 'center' }}
                    >
                      {t('trainerNotes.nutrition.deactivate', 'Deactivate')}
                    </button>
                  </div>
                </TCard>
              ) : !showMealPlanForm ? (
                <TCard padded={16} style={{ marginBottom: 22 }}>
                  <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <UtensilsCrossed size={32} color={TT.textMute} strokeWidth={1.6} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                    <p style={{ fontSize: 13, color: TT.textSub }}>{t('trainerNotes.nutrition.noPlan', 'No meal plan assigned yet')}</p>
                  </div>
                </TCard>
              ) : null}

              {/* Meal Plan Form */}
              {showMealPlanForm && (
                <TCard padded={16} style={{ marginBottom: 22 }}>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 11, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, marginBottom: 5, display: 'block' }}>{t('trainerNotes.nutrition.planName', 'Plan Name')}</label>
                    <input
                      value={mealPlanForm.name}
                      onChange={e => dispatch({ type: 'SET_MEAL_PLAN_FIELD', field: 'name', value: e.target.value })}
                      placeholder={t('trainerNotes.nutrition.planNamePlaceholder', 'e.g. Cutting Phase, Lean Bulk')}
                      onFocus={(e) => { e.target.style.boxShadow = `inset 0 0 0 1.5px ${TT.accent}`; }}
                      onBlur={(e) => { e.target.style.boxShadow = 'inset 0 0 0 1px var(--tt-border)'; }}
                      style={{ width: '100%', background: TT.surface2, borderRadius: 12, padding: '10px 12px', fontSize: 14, color: TT.text, border: 'none', boxShadow: 'inset 0 0 0 1px var(--tt-border)', outline: 'none' }}
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 11, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, marginBottom: 5, display: 'block' }}>{t('trainerNotes.nutrition.description', 'Description')}</label>
                    <textarea
                      value={mealPlanForm.description}
                      onChange={e => dispatch({ type: 'SET_MEAL_PLAN_FIELD', field: 'description', value: e.target.value })}
                      placeholder={t('trainerNotes.nutrition.descPlaceholder', 'Optional notes for the client…')}
                      onFocus={(e) => { e.target.style.boxShadow = `inset 0 0 0 1.5px ${TT.accent}`; }}
                      onBlur={(e) => { e.target.style.boxShadow = 'inset 0 0 0 1px var(--tt-border)'; }}
                      style={{ width: '100%', background: TT.surface2, borderRadius: 12, padding: '10px 12px', fontSize: 14, color: TT.text, resize: 'none', border: 'none', boxShadow: 'inset 0 0 0 1px var(--tt-border)', outline: 'none' }}
                      rows={2}
                    />
                  </div>

                  {/* Macro targets */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <label style={{ fontSize: 11, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>{t('trainerNotes.nutrition.macroTargets', 'Daily Macro Targets')}</label>
                    <button
                      onClick={handleAutoCalculate}
                      disabled={!weights.length}
                      className="tt-tap"
                      style={{ background: 'none', border: 'none', cursor: weights.length ? 'pointer' : 'not-allowed', fontSize: 11, fontWeight: 700, color: TT.accent, opacity: weights.length ? 1 : 0.3, padding: 0 }}
                    >
                      {t('trainerNotes.nutrition.autoCalc', 'Auto-Calculate')}
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {[
                      { key: 'calories', label: t('trainerNotes.nutrition.cal', 'Cal'), placeholder: '2200' },
                      { key: 'protein', label: t('trainerNotes.nutrition.protein', 'Protein'), placeholder: '160g' },
                      { key: 'carbs', label: t('trainerNotes.nutrition.carbs', 'Carbs'), placeholder: '250g' },
                      { key: 'fat', label: t('trainerNotes.nutrition.fat', 'Fat'), placeholder: '60g' },
                    ].map(({ key, label, placeholder }) => (
                      <div key={key}>
                        <p style={{ fontSize: 10, color: TT.textMute, textAlign: 'center', marginBottom: 4 }}>{label}</p>
                        <input
                          type="number"
                          value={mealPlanForm[key]}
                          onChange={e => dispatch({ type: 'SET_MEAL_PLAN_FIELD', field: key, value: e.target.value })}
                          placeholder={placeholder}
                          onFocus={(e) => { e.target.style.boxShadow = `inset 0 0 0 1.5px ${TT.accent}`; }}
                          onBlur={(e) => { e.target.style.boxShadow = 'inset 0 0 0 1px var(--tt-border)'; }}
                          style={{ width: '100%', background: TT.surface2, borderRadius: 10, padding: '9px 6px', fontSize: 14, color: TT.text, textAlign: 'center', border: 'none', boxShadow: 'inset 0 0 0 1px var(--tt-border)', outline: 'none' }}
                        />
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: 10, paddingTop: 14 }}>
                    <button
                      onClick={() => dispatch({ type: 'SET', payload: { showMealPlanForm: false } })}
                      className="tt-btn tt-btn--secondary"
                      style={{ flex: 1, padding: '11px 12px', borderRadius: 12, fontSize: 13 }}
                    >
                      {t('trainerNotes.nutrition.cancel', 'Cancel')}
                    </button>
                    <TPrimaryButton
                      onClick={handleSaveMealPlan}
                      disabled={savingMealPlan || (!mealPlanForm.calories && !mealPlanForm.protein)}
                      style={{ flex: 1, justifyContent: 'center' }}
                    >
                      {savingMealPlan ? t('trainerNotes.nutrition.saving', 'Saving…') : t('trainerNotes.nutrition.savePlan', 'Save Plan')}
                    </TPrimaryButton>
                  </div>
                </TCard>
              )}

              {/* Client nutrition preferences (allergies + diets) — edits write
                  member_onboarding, so they shape the member's own meal planner. */}
              <TSectionHeader
                title={t('trainerClientDetail.prefs.title', 'Preferences')}
                action={
                  <button type="button" onClick={() => setEditPrefs({ allergies: [...(clientNutritionPrefs?.allergies || [])], restrictions: [...(clientNutritionPrefs?.restrictions || [])], avoid: [...(clientNutritionPrefs?.avoid || [])] })}
                    className="tt-tap"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 800, color: TT.accentInk, padding: 0 }}>
                    <Pencil size={13} strokeWidth={2.4} />
                    {t('trainerClientDetail.body.edit', 'Edit')}
                  </button>
                }
              />
              <TCard padded={14} style={{ marginBottom: 22 }}>
                {(clientNutritionPrefs?.allergies?.length || clientNutritionPrefs?.restrictions?.length || clientNutritionPrefs?.avoid?.length) ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(clientNutritionPrefs.restrictions || []).map(r => (
                      <span key={`d-${r}`} style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: TT.accentSoft, color: TT.accentInk }}>
                        {t(`trainerClientDetail.prefs.diets.${r}`, r.replace(/_/g, ' '))}
                      </span>
                    ))}
                    {(clientNutritionPrefs.allergies || []).map(a => (
                      <span key={`a-${a}`} style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: TT.warnSoft, color: TT.warnInk }}>
                        {t(`trainerClientDetail.prefs.allergens.${a}`, a)}
                      </span>
                    ))}
                    {(clientNutritionPrefs.avoid || []).map(f => (
                      <span key={`v-${f}`} style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: TT.surface2, color: TT.textSub, textTransform: 'capitalize' }}>
                        {f.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: TT.textMute }}>{t('trainerClientDetail.prefs.none', 'No dietary preferences set.')}</p>
                )}
              </TCard>

              {/* 7-Day Food Log Compliance — paginates week-by-week */}
              <TSectionHeader
                title={t('trainerNotes.nutrition.weeklyIntake', '7-Day Intake')}
                action={foodLogSummary.length > 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button type="button" aria-label={t('common:previous', 'Previous')}
                      disabled={nutWeekOffset >= oldestNutWeekOffset}
                      onClick={() => setNutWeekOffset(o => Math.min(oldestNutWeekOffset, o + 1))}
                      className="tt-tap"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'grid', placeItems: 'center', opacity: nutWeekOffset >= oldestNutWeekOffset ? 0.3 : 1, color: TT.textSub }}>
                      <ChevronLeft size={17} strokeWidth={2.4} />
                    </button>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: TT.textSub, minWidth: 96, textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {nutWeekOffset === 0
                        ? t('trainerNotes.nutrition.thisWeek', 'This week')
                        : `${format(nutWindow.start, 'MMM d', { locale: dateFnsLocale })} – ${format(nutWindow.end, 'MMM d', { locale: dateFnsLocale })}`}
                    </span>
                    <button type="button" aria-label={t('common:next', 'Next')}
                      disabled={nutWeekOffset === 0}
                      onClick={() => setNutWeekOffset(o => Math.max(0, o - 1))}
                      className="tt-tap"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'grid', placeItems: 'center', opacity: nutWeekOffset === 0 ? 0.3 : 1, color: TT.textSub }}>
                      <ChevronRight size={17} strokeWidth={2.4} />
                    </button>
                  </div>
                ) : null}
              />
              <TCard padded={16} style={{ marginBottom: 22 }} data-swipe-ignore>
                {nutWindow.days.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <p style={{ fontSize: 13, color: TT.textMute }}>
                      {foodLogSummary.length === 0
                        ? t('trainerNotes.nutrition.noLogs', 'No food logs in the last 7 days')
                        : t('trainerNotes.nutrition.noLogsThisWeek', 'No food logs this week')}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="h-36 sm:h-40 overflow-hidden -mx-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={nutWindow.days} barGap={2}>
                          <XAxis
                            dataKey="date"
                            tickFormatter={d => format(new Date(d + 'T00:00:00'), 'EEE', { locale: dateFnsLocale })}
                            tick={{ fill: '#96A0AA', fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis hide />
                          <Tooltip
                            cursor={{ fill: 'var(--tt-surface-2)', opacity: 0.45 }}
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null;
                              // Only a `calories` Bar is drawn, but the full data
                              // point carries every macro — surface them all so a
                              // tap on the bar shows P/C/F below the calories.
                              const d = payload[0]?.payload || {};
                              const rows = [
                                { k: t('trainerNotes.nutrition.cal', 'Cal'), v: `${Math.round(d.calories || 0)}`, c: TT.accent },
                                { k: t('trainerClientDetail.macros.gramsProtein', 'P'), v: `${Math.round(d.protein || 0)}g`, c: '#6D5FDB' },
                                { k: t('trainerClientDetail.macros.gramsCarbs', 'C'), v: `${Math.round(d.carbs || 0)}g`, c: 'var(--tt-warn-ink)' },
                                { k: t('trainerClientDetail.macros.gramsFat', 'F'), v: `${Math.round(d.fat || 0)}g`, c: '#FF5A2E' },
                              ];
                              return (
                                <div className="bg-[var(--tt-surface)] border border-[var(--tt-border)] rounded-2xl px-4 py-3 shadow-xl shadow-black/10 backdrop-blur-sm text-[12px] min-w-[120px]">
                                  {label && <p className="text-[#96A0AA] text-[10px] font-medium uppercase tracking-wider mb-1.5 opacity-70">{format(new Date(label + 'T00:00:00'), 'EEE, MMM d', { locale: dateFnsLocale })}</p>}
                                  {rows.map((r, i) => (
                                    <p key={i} className="font-semibold leading-snug" style={{ color: r.c }}>
                                      {r.k}: {r.v}
                                    </p>
                                  ))}
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="calories" fill={TT.accent} radius={[4, 4, 0, 0]} maxBarSize={32} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Macro breakdown per day */}
                    <div className="mt-3 space-y-1.5">
                      {nutWindow.days.map(day => {
                        const targets = activeMealPlan || nutritionTargets;
                        const calTarget = targets?.target_calories || targets?.daily_calories;
                        const calPct = calTarget ? Math.round((day.calories / calTarget) * 100) : null;
                        return (
                          <div key={day.date} className="flex items-center gap-2 md:gap-3 py-2 px-2 md:px-3 rounded-xl bg-[var(--tt-surface-2)]/60 overflow-hidden">
                            <span className="text-[11px] text-[#96A0AA] w-8 shrink-0">{format(new Date(day.date + 'T00:00:00'), 'EEE', { locale: dateFnsLocale })}</span>
                            <div className="flex-1 flex items-center gap-1.5 md:gap-3 text-[10px] md:text-[11px] min-w-0 flex-wrap">
                              <span className="text-[var(--tt-text)] font-medium whitespace-nowrap">{Math.round(day.calories)} {t('common:cal', 'cal')}</span>
                              <span className="text-[#6D5FDB] whitespace-nowrap">{t('trainerClientDetail.macros.gramsProtein', 'P')} {Math.round(day.protein)}g</span>
                              <span className="text-[var(--tt-warn-ink)] whitespace-nowrap">{t('trainerClientDetail.macros.gramsCarbs', 'C')} {Math.round(day.carbs)}g</span>
                              <span className="text-[#FF5A2E] whitespace-nowrap">{t('trainerClientDetail.macros.gramsFat', 'F')} {Math.round(day.fat)}g</span>
                            </div>
                            {calPct !== null && (
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                                calPct >= 90 && calPct <= 110 ? 'bg-[var(--tt-good-soft)] text-[var(--tt-good-ink)]'
                                : calPct < 70 ? 'bg-[var(--tt-hot-soft)] text-[#FF5A2E]'
                                : 'bg-[var(--tt-warn-soft)] text-[var(--tt-warn-ink)]'
                              }`}>
                                {calPct}%
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </TCard>

              {/* Compliance Summary */}
              {foodLogSummary.length > 0 && (activeMealPlan || nutritionTargets) && (
                <>
                  <TSectionHeader title={t('trainerNotes.nutrition.compliance', 'Compliance')} />
                  <TCard padded={16} style={{ marginBottom: 22 }}>
                    {(() => {
                      const targets = activeMealPlan || nutritionTargets;
                      const calTarget = targets?.target_calories || targets?.daily_calories;
                      if (!calTarget) return <p style={{ fontSize: 13, color: TT.textMute }}>{t('trainerNotes.nutrition.noTargetsSet', 'No targets set to compare against')}</p>;
                      const onTrack = nutWindow.days.filter(d => {
                        const pct = (d.calories / calTarget) * 100;
                        return pct >= 85 && pct <= 115;
                      }).length;
                      const daysLogged = nutWindow.days.length;
                      const compliancePct = daysLogged ? Math.round((onTrack / daysLogged) * 100) : 0;
                      const rateColor = compliancePct >= 70 ? TT.goodInk : compliancePct >= 40 ? TT.warnInk : TT.hot;
                      return (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                          {[
                            { l: t('trainerNotes.nutrition.daysLogged', 'Days Logged'), big: `${daysLogged}`, unit: '/7', color: TT.text },
                            { l: t('trainerNotes.nutrition.onTarget', 'On Target'), big: `${onTrack}`, unit: `/${daysLogged}`, color: TT.goodInk },
                            { l: t('trainerNotes.nutrition.compliancePct', 'Rate'), big: `${compliancePct}%`, unit: '', color: rateColor },
                          ].map((s, i) => (
                            <div key={i} style={{ textAlign: 'center', padding: '12px 4px', borderRadius: 12, background: TT.surface2 }}>
                              <p style={{ fontSize: 9.5, color: TT.textMute, textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.4, marginBottom: 4 }}>{s.l}</p>
                              <p style={{ fontFamily: TFont.display, fontSize: 18, fontWeight: 800, color: s.color }}>
                                {s.big}{s.unit && <span style={{ fontSize: 12, color: TT.textMute }}>{s.unit}</span>}
                              </p>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </TCard>
                </>
              )}
            </>
          )}
        </div>
      )}
      </div>
          </>
        );
        const ti = MEMBER_TAB_ORDER.indexOf(activeTab);
        const prevTab = swipeDrag && ti > 0 ? MEMBER_TAB_ORDER[ti - 1] : null;
        const nextTab = swipeDrag && ti < MEMBER_TAB_ORDER.length - 1 ? MEMBER_TAB_ORDER[ti + 1] : null;
        return (
          <div ref={swipeViewportRef} style={{ overflow: 'hidden', touchAction: 'pan-y' }}>
            <div ref={trackRef} style={{ display: 'flex', alignItems: 'flex-start', width: '300%', transform: 'translateX(-33.3333%)' }}>
              <div style={{ width: '33.3333%', flexShrink: 0 }}>{prevTab ? renderTabPanel(prevTab) : null}</div>
              <div style={{ width: '33.3333%', flexShrink: 0 }}>{renderTabPanel(activeTab)}</div>
              <div style={{ width: '33.3333%', flexShrink: 0 }}>{nextTab ? renderTabPanel(nextTab) : null}</div>
            </div>
          </div>
        );
      })()}

      {/* Program detail (tap a program card in the Plan tab) */}
      <ProgramDetailModal program={viewProgram} onClose={() => setViewProgram(null)} />

      {/* Body measurement editor (consent-gated) */}
      {editMeas && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !savingMeas && setEditMeas(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, borderRadius: 18, width: '100%', maxWidth: 460, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${TT.border}` }}>
              <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text }}>{t('trainerClientDetail.body.editMeasurements', 'Edit measurements')}</div>
              <button type="button" onClick={() => !savingMeas && setEditMeas(null)} aria-label={t('common:close', 'Close')}
                style={{ width: 36, height: 36, borderRadius: 10, background: TT.surface2, border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.textSub }}>
                <X size={17} strokeWidth={2.2} />
              </button>
            </div>
            <div style={{ padding: 16, overflowY: 'auto', flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[...MEAS_FIELDS, { k: 'body_fat_pct', l: t('trainerClientDetail.body.bodyFat', 'Body fat'), unit: '%' }].map(f => (
                <label key={f.k} style={{ display: 'block' }}>
                  <span style={{ fontSize: 11, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, display: 'block', marginBottom: 5 }}>{f.l}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: TT.surface2, border: `1px solid ${TT.borderSolid}`, borderRadius: 10, padding: '0 10px' }}>
                    <input type="number" inputMode="decimal" step="0.1" min="0"
                      value={editMeas[f.k]}
                      onChange={e => setEditMeas(prev => ({ ...prev, [f.k]: e.target.value }))}
                      placeholder="—"
                      style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: TT.text, fontSize: 14, fontWeight: 700, padding: '10px 0', fontFamily: TFont.mono }} />
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: TT.textMute }}>{f.unit || t('common:cm', 'cm')}</span>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderTop: `1px solid ${TT.border}` }}>
              <button type="button" onClick={() => setEditMeas(null)} disabled={savingMeas}
                style={{ flex: 1, height: 44, borderRadius: 12, background: TT.surface2, border: `1px solid ${TT.border}`, color: TT.textSub, fontWeight: 800, fontSize: 13.5, cursor: 'pointer' }}>
                {t('trainerClientDetail.body.cancel', 'Cancel')}
              </button>
              <button type="button" onClick={saveMeasurements} disabled={savingMeas} className="tt-btn tt-btn--primary"
                style={{ flex: 1, height: 44, borderRadius: 12, fontWeight: 800, fontSize: 13.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: savingMeas ? 0.6 : 1 }}>
                {savingMeas ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} strokeWidth={2.4} />}
                {t('trainerClientDetail.body.save', 'Save')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* "Use one of my plans" picker — copies a saved plan onto this client */}
      {planPicker && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !copyingPlanId && setPlanPicker(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, borderRadius: 18, width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${TT.border}` }}>
              <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text }}>{t('trainerNotes.nutrition.useExistingTitle', 'Choose a plan')}</div>
              <button type="button" onClick={() => !copyingPlanId && setPlanPicker(false)} aria-label={t('common:close', 'Close')}
                style={{ width: 36, height: 36, borderRadius: 10, background: TT.surface2, border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.textSub }}>
                <X size={17} strokeWidth={2.2} />
              </button>
            </div>
            <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
              {myMealPlans === null ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}><Loader2 size={24} className="animate-spin" color={TT.accent} /></div>
              ) : myMealPlans.length === 0 ? (
                <p style={{ fontSize: 13, color: TT.textMute, textAlign: 'center', padding: '24px 0' }}>{t('trainerNotes.nutrition.noSavedPlans', 'You have no saved meal plans yet.')}</p>
              ) : myMealPlans.map(p => (
                <button key={p.id} type="button" onClick={() => copyPlanToClient(p)} disabled={!!copyingPlanId}
                  className="tt-tap"
                  style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 13px', borderRadius: 12, background: TT.surface2, border: `1px solid ${TT.border}`, marginBottom: 8, cursor: 'pointer', opacity: copyingPlanId && copyingPlanId !== p.id ? 0.5 : 1 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: TT.accentSoft, display: 'grid', placeItems: 'center' }}>
                    <UtensilsCrossed size={17} color={TT.accentInk} strokeWidth={2.1} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13.5, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</p>
                    <p style={{ fontSize: 11, color: TT.textSub, marginTop: 1 }}>
                      {p.target_calories ? `${p.target_calories} ${t('common:cal', 'cal')}` : ''}
                      {Number(p.duration_weeks) > 1 ? ` · ${p.duration_weeks}${t('trainerPlans.wSuffix', 'w')}` : ''}
                      {p.client?.full_name ? ` · ${p.client.full_name}` : ''}
                    </p>
                  </div>
                  {copyingPlanId === p.id && <Loader2 size={16} className="animate-spin" color={TT.accent} />}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Client nutrition preferences editor (writes member_onboarding) */}
      {editPrefs && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !savingPrefs && setEditPrefs(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, borderRadius: 18, width: '100%', maxWidth: 460, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${TT.border}` }}>
              <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text }}>{t('trainerClientDetail.prefs.editTitle', 'Edit preferences')}</div>
              <button type="button" onClick={() => !savingPrefs && setEditPrefs(null)} aria-label={t('common:close', 'Close')}
                style={{ width: 36, height: 36, borderRadius: 10, background: TT.surface2, border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.textSub }}>
                <X size={17} strokeWidth={2.2} />
              </button>
            </div>
            <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
              <p style={{ fontSize: 11, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, marginBottom: 8 }}>{t('trainerClientDetail.prefs.dietsLabel', 'Dietary restrictions')}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 18 }}>
                {DIET_OPTIONS.map(d => {
                  const on = editPrefs.restrictions?.includes(d);
                  return (
                    <button key={d} type="button" onClick={() => togglePref('restrictions', d)}
                      style={{ fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${on ? TT.accent : TT.border}`, background: on ? TT.accent : TT.surface2, color: on ? '#fff' : TT.textSub }}>
                      {t(`trainerClientDetail.prefs.diets.${d}`, d.replace(/_/g, ' '))}
                    </button>
                  );
                })}
              </div>
              <p style={{ fontSize: 11, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, marginBottom: 8 }}>{t('trainerClientDetail.prefs.allergensLabel', 'Allergies')}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {ALLERGEN_OPTIONS.map(a => {
                  const on = editPrefs.allergies?.includes(a);
                  return (
                    <button key={a} type="button" onClick={() => togglePref('allergies', a)}
                      style={{ fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${on ? '#E0863C' : TT.border}`, background: on ? TT.warnSoft : TT.surface2, color: on ? TT.warnInk : TT.textSub }}>
                      {t(`trainerClientDetail.prefs.allergens.${a}`, a)}
                    </button>
                  );
                })}
              </div>
              {/* Foods to avoid — free-text ingredient tags (disliked_foods) */}
              <p style={{ fontSize: 11, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, margin: '18px 0 8px' }}>{t('trainerClientDetail.prefs.avoidLabel', 'Foods to avoid')}</p>
              {(editPrefs.avoid?.length > 0) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 8 }}>
                  {editPrefs.avoid.map(f => (
                    <span key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, padding: '6px 8px 6px 11px', borderRadius: 999, background: TT.surface2, color: TT.text, border: `1px solid ${TT.border}`, textTransform: 'capitalize' }}>
                      {f.replace(/_/g, ' ')}
                      <button type="button" onClick={() => setEditPrefs(p => ({ ...p, avoid: p.avoid.filter(x => x !== f) }))} aria-label={t('common:remove', 'Remove')}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: TT.textMute, display: 'grid', placeItems: 'center', padding: 0 }}>
                        <X size={13} strokeWidth={2.4} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={avoidInput} onChange={e => setAvoidInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const v = avoidInput.trim().toLowerCase();
                      if (v && !editPrefs.avoid?.includes(v)) setEditPrefs(p => ({ ...p, avoid: [...(p.avoid || []), v] }));
                      setAvoidInput('');
                    }
                  }}
                  placeholder={t('trainerClientDetail.prefs.avoidPlaceholder', 'e.g. cilantro, mushrooms')}
                  style={{ flex: 1, minWidth: 0, background: TT.surface2, border: `1px solid ${TT.borderSolid}`, borderRadius: 10, padding: '10px 12px', fontSize: 14, color: TT.text, outline: 'none' }} />
                <button type="button" onClick={() => {
                    const v = avoidInput.trim().toLowerCase();
                    if (v && !editPrefs.avoid?.includes(v)) setEditPrefs(p => ({ ...p, avoid: [...(p.avoid || []), v] }));
                    setAvoidInput('');
                  }}
                  style={{ flexShrink: 0, padding: '0 14px', borderRadius: 10, background: TT.accentSoft, color: TT.accentInk, border: 'none', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
                  {t('common:add', 'Add')}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderTop: `1px solid ${TT.border}` }}>
              <button type="button" onClick={() => setEditPrefs(null)} disabled={savingPrefs}
                style={{ flex: 1, height: 44, borderRadius: 12, background: TT.surface2, border: `1px solid ${TT.border}`, color: TT.textSub, fontWeight: 800, fontSize: 13.5, cursor: 'pointer' }}>
                {t('trainerClientDetail.body.cancel', 'Cancel')}
              </button>
              <button type="button" onClick={saveClientPrefs} disabled={savingPrefs} className="tt-btn tt-btn--primary"
                style={{ flex: 1, height: 44, borderRadius: 12, fontWeight: 800, fontSize: 13.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: savingPrefs ? 0.6 : 1 }}>
                {savingPrefs ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} strokeWidth={2.4} />}
                {t('trainerClientDetail.body.save', 'Save')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Monthly Report Modal */}
      <MonthlyProgressReport
        isOpen={showReport}
        onClose={() => dispatch({ type: 'SET', payload: { showReport: false } })}
        profileId={clientId}
      />

      {/* Log Follow-Up Modal */}
      {showFollowupModal && (
        <div data-swipe-ignore className="fixed inset-0 z-[90] flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div style={{ background: TT.surface, borderRadius: 'var(--tt-card-radius, 20px)', border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg, width: '100%', maxWidth: 448, maxHeight: '90vh', overflowY: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontFamily: TFont.display, fontSize: 17, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>
                {t('trainerNotes.followUp.logFollowUp')}
              </h3>
              <TIconButton ariaLabel={t('trainerNotes.followUp.cancel', 'Close')} onClick={() => dispatch({ type: 'SET', payload: { showFollowupModal: false } })}>
                <X size={18} color={TT.text} />
              </TIconButton>
            </div>

            {/* Method selector */}
            <label style={{ fontSize: 11, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, marginBottom: 6, display: 'block' }}>
              {t('trainerNotes.followUp.method')}
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
              {[
                { value: 'call', icon: Phone, label: t('trainerNotes.followUp.methods.call') },
                { value: 'push', icon: Bell, label: t('trainerNotes.followUp.methods.push') },
                { value: 'email', icon: Mail, label: t('trainerNotes.followUp.methods.email') },
                { value: 'in_person', icon: UserCheck, label: t('trainerNotes.followUp.methods.inPerson') },
              ].map(({ value, icon: Icon, label }) => {
                const sel = fuMethod === value;
                return (
                  <button
                    key={value}
                    onClick={() => dispatch({ type: 'SET', payload: { fuMethod: value } })}
                    title={label}
                    className="tt-tap"
                    style={{
                      padding: '10px 4px', borderRadius: 10, minHeight: 44,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                      background: sel ? TT.accentSoft : TT.surface2,
                      color: sel ? TT.accentInk : TT.textSub,
                      border: sel ? `1px solid ${TT.accent}` : `1px solid ${TT.border}`,
                    }}
                  >
                    <Icon size={14} color={sel ? TT.accent : TT.textMute} />
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Outcome */}
            <label style={{ fontSize: 11, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, marginBottom: 6, display: 'block' }}>
              {t('trainerNotes.followUp.outcomeLabel')}
            </label>
            <select
              value={fuOutcome}
              onChange={(e) => dispatch({ type: 'SET', payload: { fuOutcome: e.target.value } })}
              onFocus={(e) => { e.target.style.boxShadow = `inset 0 0 0 1.5px ${TT.accent}`; }}
              onBlur={(e) => { e.target.style.boxShadow = 'inset 0 0 0 1px var(--tt-border)'; }}
              style={{ width: '100%', background: TT.surface2, borderRadius: 12, padding: '11px 12px', fontSize: 14, color: TT.text, marginBottom: 16, border: 'none', boxShadow: 'inset 0 0 0 1px var(--tt-border)', outline: 'none', minHeight: 44 }}
            >
              <option value="no_answer">{t('trainerNotes.followUp.outcomes.noAnswer')}</option>
              <option value="rescheduled">{t('trainerNotes.followUp.outcomes.rescheduled')}</option>
              <option value="coming_back">{t('trainerNotes.followUp.outcomes.comingBack')}</option>
              <option value="not_interested">{t('trainerNotes.followUp.outcomes.notInterested')}</option>
              <option value="other">{t('trainerNotes.followUp.outcomes.other')}</option>
            </select>

            {/* Note */}
            <label style={{ fontSize: 11, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, marginBottom: 6, display: 'block' }}>
              {t('trainerNotes.followUp.noteLabel')}
            </label>
            <textarea
              value={fuNote}
              onChange={(e) => dispatch({ type: 'SET', payload: { fuNote: e.target.value } })}
              placeholder={t('trainerNotes.followUp.notePlaceholder')}
              onFocus={(e) => { e.target.style.boxShadow = `inset 0 0 0 1.5px ${TT.accent}`; }}
              onBlur={(e) => { e.target.style.boxShadow = 'inset 0 0 0 1px var(--tt-border)'; }}
              style={{ width: '100%', background: TT.surface2, borderRadius: 12, padding: 12, fontSize: 14, color: TT.text, resize: 'none', marginBottom: 16, border: 'none', boxShadow: 'inset 0 0 0 1px var(--tt-border)', outline: 'none' }}
              rows={3}
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => dispatch({ type: 'SET', payload: { showFollowupModal: false } })}
                className="tt-btn tt-btn--secondary"
                style={{ flex: 1, padding: '11px 12px', borderRadius: 12, fontSize: 13 }}
              >
                {t('trainerNotes.followUp.cancel')}
              </button>
              <TPrimaryButton onClick={handleSaveFollowup} disabled={savingFollowup} style={{ flex: 1, justifyContent: 'center' }}>
                {savingFollowup ? t('trainerNotes.followUp.saving') : t('trainerNotes.followUp.save')}
              </TPrimaryButton>
            </div>
          </div>
        </div>
      )}

      {/* Contact action sheet — call / WhatsApp / SMS (member emails are
          PII-protected from trainers by design, so no email row). Portaled:
          ancestors with transforms break position:fixed. */}
      {showContactSheet && phoneDigits && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('trainerClientDetail.contact.contactBtn', 'Contact')}
          onClick={() => setShowContactSheet(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 90,
            background: 'rgba(11,15,18,0.55)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 480,
              background: TT.surface, border: `1px solid ${TT.border}`, borderBottom: 'none',
              borderRadius: '22px 22px 0 0',
              padding: '10px 16px calc(16px + env(safe-area-inset-bottom))',
            }}
          >
            <div style={{ width: 38, height: 4.5, borderRadius: 999, background: TT.border, margin: '2px auto 12px' }} />
            <div style={{ fontFamily: TFont.display, fontSize: 17, fontWeight: 800, color: TT.text, letterSpacing: -0.3, textAlign: 'center', marginBottom: 6 }}>
              {t('trainerClientDetail.contact.title', 'Contact {{name}}', { name: (client?.full_name || '').split(' ')[0] || t('trainerMessages.list.clientFallback', 'Client') })}
            </div>
            {[
              {
                ico: Phone, tint: TT.accent,
                label: t('trainerClientDetail.contact.call', 'Call'),
                onClick: () => { setShowContactSheet(false); window.location.href = `tel:+${phoneDigits}`; },
              },
              {
                ico: MessageCircle, tint: '#25D366',
                label: t('trainerClientDetail.contact.whatsapp', 'WhatsApp'),
                onClick: () => {
                  setShowContactSheet(false);
                  openWhatsApp(client.phone_number, t('trainerClients.waGreeting', 'Hi {{name}}!', { name: (client.full_name || '').split(' ')[0] || '' }));
                },
              },
              {
                ico: Smartphone, tint: '#5A8DEE',
                label: t('trainerClientDetail.contact.sms', 'Text message (SMS)'),
                onClick: () => { setShowContactSheet(false); window.location.href = `sms:+${phoneDigits}`; },
              },
            ].map((row, i) => {
              const Ico = row.ico;
              return (
                <button
                  key={row.label}
                  type="button"
                  onClick={row.onClick}
                  className="tt-tap"
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 13,
                    padding: '13px 6px', background: 'transparent', border: 'none',
                    borderTop: i > 0 ? `1px solid ${TT.border}` : 'none',
                    cursor: 'pointer', textAlign: 'left', minHeight: 54,
                  }}
                >
                  <span style={{
                    width: 38, height: 38, borderRadius: 12, flexShrink: 0,
                    background: `color-mix(in srgb, ${row.tint} 14%, transparent)`,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ico size={18} color={row.tint} strokeWidth={2.2} />
                  </span>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: TT.text }}>{row.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setShowContactSheet(false)}
              className="tt-btn tt-btn--secondary"
              style={{ width: '100%', height: 48, borderRadius: 14, marginTop: 8, fontSize: 14 }}
            >
              {t('trainerNotes.followUp.cancel', 'Cancel')}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Body tab — full-image photo viewer (read-only) */}
      {viewingPhoto && (
        <div
          data-swipe-ignore
          role="dialog"
          aria-modal="true"
          aria-label={t('trainerClientDetail.body.viewPhoto', 'View progress photo')}
          onClick={() => dispatch({ type: 'SET', payload: { viewingPhoto: null } })}
          style={{
            position: 'fixed', inset: 0, zIndex: 90,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex', flexDirection: 'column',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', color: '#fff',
          }} onClick={e => e.stopPropagation()}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'capitalize' }}>
                {viewingPhoto.view_angle || t('trainerClientDetail.photos.headerFallback', 'Photo')}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>
                {format(new Date(viewingPhoto.taken_at), 'MMMM d, yyyy', { locale: dateFnsLocale })}
              </div>
            </div>
            <button
              type="button"
              onClick={() => dispatch({ type: 'SET', payload: { viewingPhoto: null } })}
              aria-label={t('trainerNotes.followUp.cancel', 'Close')}
              style={{
                width: 44, height: 44, borderRadius: 12,
                background: 'rgba(255,255,255,0.12)', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', cursor: 'pointer',
              }}
            >
              <X size={20} />
            </button>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <img
              src={viewingPhoto.signedUrl}
              alt={viewingPhoto.view_angle || t('trainerClientDetail.photos.alt', 'Progress photo')}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 16 }}
            />
          </div>
        </div>
      )}

      {/* Pulsing-pill keyframes (live indicator) */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(255,90,46,0.45); }
          50%      { opacity: 0.85; box-shadow: 0 0 0 6px rgba(255,90,46,0); }
        }
      `}</style>
    </div>
  );
}
