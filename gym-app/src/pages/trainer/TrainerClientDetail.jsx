import { useEffect, useReducer, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Save, TrendingUp, TrendingDown, Minus, StickyNote, Calendar, BarChart3,
  MessageSquare, Bell, Phone, Mail, UserCheck, Plus, X, Dumbbell, Trophy,
  AlertTriangle, BookOpen, ChevronRight, ChevronDown, ChevronLeft, Flame,
  Heart, Zap, RefreshCw, Apple, MapPin, UtensilsCrossed, ClipboardList, Ruler,
  Loader2, MoreHorizontal, Play, Eye, History as HistoryIcon, User as UserIcon,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { format, subWeeks, subDays, startOfWeek, differenceInWeeks, eachDayOfInterval } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { enUS } from 'date-fns/locale/en-US';
import { useTranslation } from 'react-i18next';
import UnderlineTabs from '../../components/UnderlineTabs';
import MonthlyProgressReport from '../../components/MonthlyProgressReport';
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';
import ChartTooltip from '../../components/ChartTooltip';
import { calculateMacros } from '../../lib/macroCalculator';
import { generateDayPlan } from '../../lib/mealPlanner';
import AnimatedCounter from '../../components/AnimatedCounter';
import TrainerStatCard from './components/TrainerStatCard';
import TrainerClientRecovery from './components/TrainerClientRecovery';
import TrainerClientPayment from './components/TrainerClientPayment';
import TrainerClientSchedule from './components/TrainerClientSchedule';
import TrainerClientAttendance from './components/TrainerClientAttendance';
import TrainerClientCoaching from './components/TrainerClientCoaching';
import { TT, TFont, avatarIdx } from './components/designTokens';
import { TCard, TPill, TPrimaryButton, TAvatar, TIconButton, TSectionHeader } from './components/designPrimitives';
import CheckinPhotoEditor from '../../components/CheckinPhotoEditor';

const TAB_KEYS = ['overview', 'history', 'body', 'notesFollowUp', 'programNutrition', 'coaching'];

// --- Reducer ---
const initialState = {
  // Loading / error
  loading: true,
  accessDenied: false,
  isAssigned: false,
  _assignmentNotes: null,

  // Client data
  client: null,
  onboarding: null,
  stats: { count: 0, volume: 0 },
  programName: null,
  enrollment: null,
  streak: null,
  nextSession: null, // next upcoming trainer_session (scheduled/confirmed)

  // Workout data
  recentSessions: [],
  personalRecords: [],
  weeklyWorkouts: [],
  workoutsThisWeek: 0,

  // Body data
  weights: [],
  measurements: null,
  progressPhotos: [],
  checkIns: [],

  // Notes state
  notesData: { notes: '', injuries: '' },
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
  foodLogSummary: [],
  activeMealPlan: null,
  savingMealPlan: false,
  mealPlanForm: { calories: '', protein: '', carbs: '', fat: '', name: '', description: '' },
  showMealPlanForm: false,
  nutritionLoaded: false,
  sampleMeals: null,
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
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET':
      return { ...state, ...action.payload };
    case 'SET_NOTES_FIELD':
      return { ...state, notesData: { ...state.notesData, [action.field]: action.value } };
    case 'SET_MEAL_PLAN_FIELD':
      return { ...state, mealPlanForm: { ...state.mealPlanForm, [action.field]: action.value } };
    case 'SET_MEAL_PLAN_FORM':
      return { ...state, mealPlanForm: { ...state.mealPlanForm, ...action.payload } };
    case 'PREPEND_FOLLOWUP':
      return { ...state, followups: [action.followup, ...state.followups] };
    default:
      return state;
  }
}

export default function TrainerClientNotes() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const { t, i18n } = useTranslation(['pages', 'common']);
  const dateFnsLocale = i18n.language?.startsWith('es') ? es : enUS;
  const [state, dispatch] = useReducer(reducer, initialState);
  const notesSavedTimerRef = useRef(null);
  // Tab-swipe gesture state (declared here with other hooks — must run before
  // the loading/notFound early returns to keep hook order stable).
  const swipeRef = useRef({ x: 0, y: 0, active: false });

  // Destructure for readability in JSX
  const {
    loading, accessDenied, isAssigned, client, onboarding, stats, programName, enrollment, streak, nextSession,
    recentSessions, personalRecords, weeklyWorkouts, workoutsThisWeek,
    weights, measurements, progressPhotos, checkIns,
    notesData, notesSaved, savingNotes,
    followups, showFollowupModal, fuMethod, fuNote, fuOutcome, savingFollowup,
    availablePrograms, assigningProgram,
    nutritionTargets, foodLogSummary, activeMealPlan, savingMealPlan, mealPlanForm, showMealPlanForm, nutritionLoaded, sampleMeals, generatingMeals,
    activeTab, showReport,
    liveDraft, bodyPeriod, viewingPhoto,
    historyLoaded, allSessions, expandedSessionId,
  } = state;

  useEffect(() => { document.title = t('trainerNotes.pageTitle'); }, [t]);

  // Cleanup notesSaved timer on unmount
  useEffect(() => {
    return () => {
      if (notesSavedTimerRef.current) clearTimeout(notesSavedTimerRef.current);
    };
  }, []);

  // Phase 1: verify trainer ↔ client assignment BEFORE any data queries fire.
  const checkAssignment = useCallback(async () => {
    dispatch({ type: 'SET', payload: { loading: true, accessDenied: false, isAssigned: false } });
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
      dispatch({ type: 'SET', payload: { isAssigned: true, _assignmentNotes: assignment.notes } });
    } catch (err) {
      logger.error('Error checking assignment:', err);
      dispatch({ type: 'SET', payload: { loading: false } });
    }
  }, [clientId, profile?.id, profile?.gym_id]);

  // Phase 2: load all client data — only runs after isAssigned is true.
  const loadClientData = useCallback(async () => {
    const assignmentNotes = state._assignmentNotes;
    try {
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
      const eightWeeksAgo = subWeeks(new Date(), 8).toISOString();

      const [
        clientRes, statsRes, weightsRes, measRes, streakRes, followupsRes,
        recentRes, prsRes, weeklyRes, onbRes, thisWeekRes, nextSessionRes,
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, username, last_active_at, created_at, assigned_program_id, checkin_photo_path')
          .eq('id', clientId)
          .single(),
        supabase
          .from('workout_sessions')
          .select('id, total_volume_lbs')
          .eq('profile_id', clientId)
          .eq('status', 'completed'),
        supabase
          .from('body_weight_logs')
          .select('weight_lbs, logged_at')
          .eq('profile_id', clientId)
          .order('logged_at', { ascending: false })
          .limit(50),
        supabase
          .from('body_measurements')
          .select('*')
          .eq('profile_id', clientId)
          .order('measured_at', { ascending: false })
          .limit(1),
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
          .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name)')
          .eq('profile_id', clientId)
          .order('achieved_at', { ascending: false })
          .limit(20),
        // Weekly workout counts (last 8 weeks)
        supabase
          .from('workout_sessions')
          .select('started_at')
          .eq('profile_id', clientId)
          .eq('status', 'completed')
          .gte('started_at', eightWeeksAgo),
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

      const totalVolume = (statsRes.data || []).reduce((sum, s) => sum + (s.total_volume_lbs || 0), 0);

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

      // Process weekly workout data for chart
      let processedWeeklyWorkouts = [];
      if (weeklyRes.data) {
        const weekMap = {};
        for (let i = 7; i >= 0; i--) {
          const wk = startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 0 });
          const key = format(wk, 'MMM d', { locale: dateFnsLocale });
          weekMap[key] = 0;
        }
        weeklyRes.data.forEach((s) => {
          const wk = startOfWeek(new Date(s.started_at), { weekStartsOn: 0 });
          const key = format(wk, 'MMM d', { locale: dateFnsLocale });
          if (weekMap[key] !== undefined) weekMap[key]++;
        });
        processedWeeklyWorkouts = Object.entries(weekMap).map(([week, count]) => ({ week, count }));
      }

      // Load available programs, progress photos, check-ins, AND the assigned
      // program name + enrollment all in parallel (program name/enrollment were
      // previously two serial hops between batches).
      const [progsRes, photosRes, checkInsRes, progNameRes, enrRes] = await Promise.all([
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
        supabase
          .from('check_ins')
          .select('id, checked_in_at, method')
          .eq('profile_id', clientId)
          .order('checked_in_at', { ascending: false })
          .limit(30),
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

      // Batch all photo signed URLs into ONE request (was one round-trip per photo).
      const photoPaths = (photosRes.data || []).map((p) => p.storage_path);
      let signedByPath = {};
      if (photoPaths.length) {
        const { data: signed } = await supabase.storage
          .from('progress-photos')
          .createSignedUrls(photoPaths, 3600);
        (signed ?? []).forEach((s) => { if (s.signedUrl) signedByPath[s.path] = s.signedUrl; });
      }
      const photosWithUrls = (photosRes.data || []).map((photo) => ({
        ...photo,
        signedUrl: signedByPath[photo.storage_path] || '',
      }));

      dispatch({
        type: 'SET',
        payload: {
          client: clientRes.data,
          stats: { count: (statsRes.data || []).length, volume: totalVolume },
          programName: loadedProgramName,
          enrollment: loadedEnrollment,
          weights: weightsRes.data || [],
          measurements: measRes.data?.[0] || null,
          streak: streakRes.data || null,
          followups: followupsRes.data || [],
          recentSessions: recentRes.data || [],
          personalRecords: prsRes.data || [],
          onboarding: onbRes.data || null,
          nextSession: nextSessionRes.data || null,
          workoutsThisWeek: thisWeekRes.data?.length || 0,
          weeklyWorkouts: processedWeeklyWorkouts,
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
  }, [clientId, profile?.id, profile?.gym_id, t, state._assignmentNotes]);

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
      const { data: latest } = await supabase
        .from('session_drafts')
        .select('profile_id')
        .eq('profile_id', clientId)
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
        .select('id, name, started_at, ended_at, duration_seconds, total_volume_lbs, status')
        .eq('profile_id', clientId)
        .eq('status', 'completed')
        .gte('started_at', sixMonthsAgo)
        .order('started_at', { ascending: false })
        .limit(200);
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
      const sevenDaysAgo = subDays(new Date(), 7).toISOString().split('T')[0];
      const [targetsRes, logsRes, mealPlanRes] = await Promise.all([
        supabase
          .from('nutrition_targets')
          .select('daily_calories, daily_protein_g, daily_carbs_g, daily_fat_g, updated_at')
          .eq('profile_id', clientId)
          .maybeSingle(),
        supabase
          .from('food_logs')
          .select('log_date, calories, protein_g, carbs_g, fat_g')
          .eq('profile_id', clientId)
          .gte('log_date', sevenDaysAgo)
          .order('log_date'),
        supabase
          .from('trainer_meal_plans')
          .select('*')
          .eq('trainer_id', profile.id)
          .eq('client_id', clientId)
          .eq('is_active', true)
          .maybeSingle(),
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

      // Pre-fill meal plan form from active plan
      let loadedMealPlanForm = state.mealPlanForm;
      if (mealPlanRes.data) {
        loadedMealPlanForm = {
          calories: mealPlanRes.data.target_calories?.toString() || '',
          protein: mealPlanRes.data.target_protein_g?.toString() || '',
          carbs: mealPlanRes.data.target_carbs_g?.toString() || '',
          fat: mealPlanRes.data.target_fat_g?.toString() || '',
          name: mealPlanRes.data.name || '',
          description: mealPlanRes.data.description || '',
        };
      }

      dispatch({
        type: 'SET',
        payload: {
          nutritionTargets: targetsRes.data || null,
          activeMealPlan: mealPlanRes.data || null,
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
        const mealDesc = plan.meals.map(m => `${m.type || t('trainerNotes.nutrition.meal')}: ${m.name} (${Math.round(m.calories)} cal)`).join('\n');
        dispatch({
          type: 'SET',
          payload: {
            sampleMeals: plan.meals,
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
      // Deactivate existing plan if any
      if (activeMealPlan) {
        await supabase
          .from('trainer_meal_plans')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', activeMealPlan.id);
      }

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
      await supabase
        .from('trainer_meal_plans')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', activeMealPlan.id);
      dispatch({
        type: 'SET',
        payload: {
          activeMealPlan: null,
          mealPlanForm: { calories: '', protein: '', carbs: '', fat: '', name: '', description: '' },
        },
      });
    } catch (err) {
      logger.error('Error deactivating meal plan:', err);
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
      dispatch({ type: 'SET', payload: { notesSaved: true } });
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
      logger.error('Error saving followup:', err);
    } finally {
      dispatch({ type: 'SET', payload: { savingFollowup: false } });
    }
  }

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

  // History tab — 90-day attendance heatmap (workouts + check-ins)
  const attendanceHeatmap = useMemo(() => {
    const days = eachDayOfInterval({ start: subDays(new Date(), 89), end: new Date() });
    const dayMap = {};
    days.forEach(d => {
      dayMap[format(d, 'yyyy-MM-dd')] = 0;
    });
    (allSessions || []).forEach(s => {
      const key = format(new Date(s.started_at), 'yyyy-MM-dd');
      if (key in dayMap) dayMap[key] += 1;
    });
    (checkIns || []).forEach(c => {
      const key = format(new Date(c.checked_in_at), 'yyyy-MM-dd');
      if (key in dayMap) dayMap[key] += 1;
    });
    return days.map(d => {
      const key = format(d, 'yyyy-MM-dd');
      const v = dayMap[key];
      return { date: key, value: v, label: format(d, 'EEE, MMM d', { locale: dateFnsLocale }) };
    });
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
  const topPRs = (personalRecords || []).slice(0, 4);

  // Pinned-notes warm gradient is light-only; in dark mode fall back to the
  // theme-aware surface so it doesn't blow out. Read the toggle at render time
  // (ThemeContext re-renders the tree when the OS preference flips).
  const isDarkTheme = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
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

  // ── Swipe left/right to move between tabs (in tab-bar order) ──────────
  // (swipeRef is declared up top with the other hooks; these are plain handlers.)
  const MEMBER_TAB_ORDER = ['overview', 'programNutrition', 'history', 'notesFollowUp', 'body', 'coaching'];
  const onTabSwipeStart = (e) => {
    const tch = e.touches && e.touches[0];
    // Don't hijack text fields or explicitly-ignored scrollers (the tab bar, charts).
    if (!tch || (e.target.closest && e.target.closest('[data-swipe-ignore], input, textarea, select'))) {
      swipeRef.current.active = false;
      return;
    }
    swipeRef.current = { x: tch.clientX, y: tch.clientY, active: true };
  };
  const onTabSwipeEnd = (e) => {
    const s = swipeRef.current;
    if (!s.active) return;
    s.active = false;
    const tch = e.changedTouches && e.changedTouches[0];
    if (!tch) return;
    const dx = tch.clientX - s.x;
    const dy = tch.clientY - s.y;
    // Require a dominant horizontal swipe so vertical scrolling never switches tabs.
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    const i = MEMBER_TAB_ORDER.indexOf(activeTab);
    if (i < 0) return;
    const next = dx < 0 ? i + 1 : i - 1;
    if (next < 0 || next >= MEMBER_TAB_ORDER.length) return;
    dispatch({ type: 'SET', payload: { activeTab: MEMBER_TAB_ORDER[next] } });
  };

  return (
    <div style={{ background: TT.bg, minHeight: '100%' }} onTouchStart={onTabSwipeStart} onTouchEnd={onTabSwipeEnd}>
      {/* ── Back bar (Atelier) ──────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px 4px' }}>
        <TIconButton
          ariaLabel={t('trainerNotes.backToClients', 'Back')}
          onClick={() => navigate('/trainer/clients')}
        >
          <ChevronLeft size={18} strokeWidth={2.4} color={TT.text} />
        </TIconButton>
        <div style={{ fontFamily: TFont.display, fontSize: 15, fontWeight: 800, color: TT.text, letterSpacing: -0.2 }}>
          {t('trainerClientDetail.clientLabel', 'Client')}
        </div>
        <TIconButton
          ariaLabel={t('trainerNotes.actions.monthlyReport', 'More')}
          onClick={() => dispatch({ type: 'SET', payload: { showReport: true } })}
        >
          <MoreHorizontal size={18} strokeWidth={2.2} color={TT.text} />
        </TIconButton>
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
      <div data-swipe-ignore style={{ display: 'flex', gap: 7, padding: '0 16px 12px', overflowX: 'auto' }}>
        {[
          { l: t('trainerClientDetail.tabs.overview', 'Overview'), tab: 'overview' },
          { l: t('trainerClientDetail.tabs.plan', 'Plan'), tab: 'programNutrition' },
          { l: t('trainerClientDetail.tabs.history', 'History'), tab: 'history' },
          { l: t('trainerClientDetail.tabs.notes', 'Notes'), tab: 'notesFollowUp' },
          { l: t('trainerClientDetail.tabs.body', 'Body'), tab: 'body' },
          { l: t('trainerClientDetail.tabs.coaching', 'Check-ins'), tab: 'coaching' },
        ].map((t2) => {
          const isActive = activeTab === t2.tab;
          return (
            <button
              key={t2.tab}
              type="button"
              onClick={() => dispatch({ type: 'SET', payload: { activeTab: t2.tab } })}
              className="tt-tap"
              style={{
                padding: '8px 14px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0,
                fontFamily: TFont.display, fontSize: 13, fontWeight: 700,
                background: isActive ? TT.text : TT.surface,
                color: isActive ? TT.onInverse : TT.textSub,
                boxShadow: isActive ? '0 2px 6px -2px rgba(20,16,10,.4)' : 'inset 0 0 0 1px var(--tt-border)',
                border: 'none', cursor: 'pointer', minHeight: 36,
              }}
            >
              {t2.l}
            </button>
          );
        })}
      </div>

      {/* ── Overview tab content (new visual layer) ────────── */}
      {activeTab === 'overview' && (
        <div style={{ padding: '16px 16px 24px' }} className="md:max-w-[860px] md:mx-auto">
          {/* Check-in reference photo (staff-managed) */}
          <TCard padded={14} style={{ marginBottom: 22 }}>
            <CheckinPhotoEditor
              subjectId={clientId}
              path={client.checkin_photo_path}
              size={84}
              onChange={(p) => dispatch({ type: 'SET', payload: { client: { ...client, checkin_photo_path: p } } })}
              theme={{ accent: TT.accent, surface: TT.surface2, border: TT.border, text: TT.text, textSub: TT.textSub, danger: TT.hot, badgeBorder: TT.surface }}
              labels={{ photo: t('checkinPhoto.title', 'Check-in photo'), hint: t('checkinPhoto.hint', 'Staff only — used to verify identity at check-in.'), add: t('checkinPhoto.add', 'Add photo'), replace: t('checkinPhoto.replace', 'Replace'), remove: t('checkinPhoto.remove', 'Remove') }}
            />
          </TCard>
          {/* Payment (trainer tool) */}
          <TrainerClientPayment clientId={clientId} />
          {/* Weekly schedule (trainer tool) */}
          <TrainerClientSchedule clientId={clientId} />
          {/* Next session */}
          {(programName || recentSessions.length > 0) && (
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
                        ? t('trainerClientDetail.weekDay', 'Week {{w}} · day {{d}}', { w: programProgress.currentWeek, d: programProgress.daysPerWeek })
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

          {/* Recent log — dumbbell icon-box rows (Atelier) */}
          <TSectionHeader title={t('trainerClientDetail.recentLog', 'Recent log')} />
          {recentSessions.length === 0 ? (
            <TCard padded={14} style={{ marginBottom: 22 }}>
              <p style={{ fontSize: 13, color: TT.textMute }}>
                {t('trainerNotes.overview.noRecentWorkouts', 'No recent workouts')}
              </p>
            </TCard>
          ) : (
            <TCard padded={0} style={{ marginBottom: 22, overflow: 'hidden' }}>
              {recentSessions.slice(0, 5).map((s, i) => {
                const mins = s.duration_seconds ? Math.round(s.duration_seconds / 60) : null;
                return (
                  <div
                    key={s.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px',
                      borderTop: i > 0 ? `1px solid ${TT.border}` : 'none',
                    }}
                  >
                    <div style={{
                      width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                      background: 'color-mix(in srgb, #1E9C8E 12%, transparent)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Dumbbell size={17} color={TT.accent} strokeWidth={2.1} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {s.name || t('trainerNotes.overview.workout', 'Workout')}
                      </div>
                      <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 1 }}>
                        {format(new Date(s.started_at), 'MMM d', { locale: dateFnsLocale })}
                        {mins != null && ` · ${t('trainerClientDetail.sessionMins', '{{m}} min', { m: mins })}`}
                      </div>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: TT.text, fontFamily: TFont.mono, flexShrink: 0 }}>
                      {s.total_volume_lbs >= 1000
                        ? `${(s.total_volume_lbs / 1000).toFixed(1)}${t('trainerClientDetail.body.kLbs', 'k lbs')}`
                        : `${s.total_volume_lbs || 0} ${t('common:lb', 'lb')}`}
                    </div>
                  </div>
                );
              })}
            </TCard>
          )}

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
                      {pr.exercises?.name || t('trainerNotes.overview.unknownExercise', 'Lift')}
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
            </TCard>
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

          {/* Quick action row — keep access to follow-up/report */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            <button
              type="button"
              onClick={() => dispatch({ type: 'SET', payload: { activeTab: 'notesFollowUp', showFollowupModal: true } })}
              className="tt-btn tt-btn--secondary"
              style={{ padding: '10px 14px', borderRadius: 12, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Phone size={13} />
              {t('trainerNotes.actions.logFollowUp', 'Log follow-up')}
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: 'SET', payload: { showReport: true } })}
              className="tt-btn tt-btn--secondary"
              style={{ padding: '10px 14px', borderRadius: 12, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <BarChart3 size={13} />
              {t('trainerNotes.actions.monthlyReport', 'Monthly report')}
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: 'SET', payload: { activeTab: 'programNutrition' } })}
              className="tt-btn tt-btn--secondary"
              style={{ padding: '10px 14px', borderRadius: 12, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <BookOpen size={13} />
              {t('trainerNotes.actions.assignProgram', 'Assign program')}
            </button>
          </div>
        </div>
      )}

      {/* ===================== TAB: BODY (read-only client mirror of BodyMetrics) =====================
          Option A: read-only. RLS on body_measurements / progress_photos / body_weight_logs ties writes to
          profile_id = auth.uid(), which would block trainers. Adding new RLS policies + RPCs (Option B) is
          additional backend scope; this read-only mirror satisfies the v1 requirement and is safe to ship.
          Trainer still sees the full picture (weight trend, body comp, measurements grid, photo timeline). */}
      {activeTab === 'body' && (
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
          <TCard padded={16} style={{ marginBottom: 22 }}>
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

          {/* Measurements — ruler-icon rows (Atelier) */}
          <TSectionHeader
            title={t('trainerClientDetail.body.measurements', 'Measurements')}
            action={measurements ? `${t('trainerClientDetail.body.lastUpdated', 'Last updated')} ${format(new Date(measurements.measured_at), 'MMM d', { locale: dateFnsLocale })}` : null}
          />
          {measurements ? (
            <TCard padded={0} style={{ marginBottom: 22, overflow: 'hidden' }}>
              {[
                { k: 'chest_cm', l: t('trainerClientDetail.body.chest', 'Chest') },
                { k: 'waist_cm', l: t('trainerClientDetail.body.waist', 'Waist') },
                { k: 'hips_cm', l: t('trainerClientDetail.body.hips', 'Hips') },
                { k: 'left_arm_cm', l: t('trainerClientDetail.body.leftArm', 'Left arm') },
                { k: 'right_arm_cm', l: t('trainerClientDetail.body.rightArm', 'Right arm') },
                { k: 'left_thigh_cm', l: t('trainerClientDetail.body.leftThigh', 'Left thigh') },
                { k: 'right_thigh_cm', l: t('trainerClientDetail.body.rightThigh', 'Right thigh') },
              ]
                .filter(m => measurements[m.k] != null)
                .map((m, i) => (
                  <div key={m.k} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 15px',
                    borderTop: i > 0 ? `1px solid ${TT.border}` : 'none',
                  }}>
                    <Ruler size={16} color={TT.textMute} strokeWidth={2} />
                    <div style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: TT.text }}>{m.l}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: TT.text, fontFamily: TFont.mono }}>
                      {parseFloat(measurements[m.k]).toFixed(1)}
                      <span style={{ fontSize: 10, fontWeight: 600, color: TT.textMute, marginLeft: 2 }}>{t('common:cm', 'cm')}</span>
                    </div>
                  </div>
                ))}
            </TCard>
          ) : (
            <TCard padded={14} style={{ marginBottom: 22 }}>
              <p style={{ fontSize: 13, color: TT.textMute }}>
                {t('trainerClientDetail.body.noMeasurements', 'No measurements recorded yet.')}
              </p>
            </TCard>
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
                      onClick={() => dispatch({ type: 'SET', payload: { viewingPhoto: p } })}
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
      {activeTab === 'history' && (
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
          <TCard padded={14} style={{ marginBottom: 22 }}>
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
          <TCard padded={14} style={{ marginBottom: 22 }}>
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

          {/* Attendance heatmap (90-day) */}
          <TSectionHeader title={t('trainerClientDetail.history.attendance', 'Attendance')} />
          <TCard padded={16} style={{ marginBottom: 22 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 5,
            }}>
              {attendanceHeatmap.slice(-35).map((d, i) => {
                const intensity = d.value === 0 ? 0 : Math.min(d.value, 3);
                const colors = [TT.surface2, TT.accentSoft, '#7FE3C4', TT.accent];
                return (
                  <div
                    key={i}
                    title={`${d.label}: ${t('trainerClientDetail.heatmap.event', '{{count}} events', { count: d.value })}`}
                    aria-label={`${d.label}: ${t('trainerClientDetail.heatmap.event', '{{count}} events', { count: d.value })}`}
                    style={{
                      aspectRatio: '1/1',
                      borderRadius: 5,
                      background: colors[intensity],
                      boxShadow: intensity === 0 ? 'inset 0 0 0 1px var(--tt-border)' : 'none',
                    }}
                  />
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 10.5, color: TT.textMute, fontWeight: 700 }}>
              <span>{t('trainerClientDetail.history.less', 'Less')}</span>
              {[TT.surface2, TT.accentSoft, '#7FE3C4', TT.accent].map((c, i) => (
                <div key={i} style={{ width: 11, height: 11, borderRadius: 3, background: c, boxShadow: i === 0 ? 'inset 0 0 0 1px var(--tt-border)' : 'none' }} />
              ))}
              <span>{t('trainerClientDetail.history.more', 'More')}</span>
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
              {allSessions.slice(0, 30).map((s, i) => {
                const isOpen = expandedSessionId === s.id;
                return (
                  <div key={s.id} style={{ borderTop: i > 0 ? `1px solid ${TT.border}` : 'none' }}>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'SET', payload: { expandedSessionId: isOpen ? null : s.id } })}
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
                        borderBottom: i === Math.min(allSessions.length, 30) - 1 ? 'none' : 'none',
                      }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, paddingTop: 10 }}>
                          <div>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: TT.textMute, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                              {t('trainerClientDetail.history.duration', 'Duration')}
                            </div>
                            <div style={{ fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text, marginTop: 2 }}>
                              {formatDuration(s.duration_seconds)}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: TT.textMute, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                              {t('trainerClientDetail.history.volume', 'Volume')}
                            </div>
                            <div style={{ fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text, marginTop: 2 }}>
                              {s.total_volume_lbs >= 1000
                                ? `${(s.total_volume_lbs / 1000).toFixed(1)}${t('trainerClientDetail.body.kLbs', 'k lbs')}`
                                : `${s.total_volume_lbs || 0} ${t('common:lb', 'lb')}`}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: TT.textMute, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                              {t('trainerClientDetail.history.date', 'Date')}
                            </div>
                            <div style={{ fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text, marginTop: 2 }}>
                              {format(new Date(s.started_at), 'MMM d, yyyy', { locale: dateFnsLocale })}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </TCard>
          )}
        </div>
      )}

      {/* ── Existing legacy tab content for non-overview tabs ── */}
      <div className="md:max-w-[860px] md:mx-auto">
        <div style={{
          display: (activeTab === 'overview' || activeTab === 'body' || activeTab === 'history') ? 'none' : 'block',
        }}>

      {/* ===================== TAB 2: NOTES & FOLLOW-UP ===================== */}
      {activeTab === 'notesFollowUp' && (
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

      {/* ===================== TAB: CHECK-INS & HABITS (#6) ===================== */}
      {activeTab === 'coaching' && (
        <TrainerClientCoaching clientId={clientId} gymId={profile?.gym_id} trainerId={profile?.id} />
      )}

      {/* ===================== TAB 3: PROGRAM & NUTRITION ===================== */}
      {activeTab === 'programNutrition' && (
        <div style={{ padding: '16px 16px 24px' }} className="md:max-w-[860px] md:mx-auto">
          {/* Current assigned program */}
          <TSectionHeader title={t('trainerNotes.program.currentProgram')} />
          <TCard padded={16} style={{ marginBottom: 22 }}>
            {programName ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
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
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
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
                        {prog.duration_weeks ? `${prog.duration_weeks} ${t('trainerNotes.program.weeks')}` : ''}
                        {prog.days_per_week ? ` · ${prog.days_per_week} ${t('trainerNotes.program.daysWk')}` : ''}
                      </p>
                    </div>
                    {isAssigned ? (
                      <TPill tone="teal" size="m" style={{ flexShrink: 0 }}>{t('trainerNotes.program.assigned')}</TPill>
                    ) : (
                      <button
                        onClick={() => handleAssignProgram(prog.id)}
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

              {/* 7-Day Food Log Compliance */}
              <TSectionHeader title={t('trainerNotes.nutrition.weeklyIntake', '7-Day Intake')} />
              <TCard padded={16} style={{ marginBottom: 22 }}>
                {foodLogSummary.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <p style={{ fontSize: 13, color: TT.textMute }}>{t('trainerNotes.nutrition.noLogs', 'No food logs in the last 7 days')}</p>
                  </div>
                ) : (
                  <>
                    <div className="h-36 sm:h-40 overflow-hidden -mx-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={foodLogSummary} barGap={2}>
                          <XAxis
                            dataKey="date"
                            tickFormatter={d => format(new Date(d + 'T00:00:00'), 'EEE', { locale: dateFnsLocale })}
                            tick={{ fill: '#96A0AA', fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis hide />
                          <Tooltip
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null;
                              return (
                                <div className="bg-[var(--tt-surface)] border border-[var(--tt-border)] rounded-2xl px-4 py-3 shadow-xl shadow-black/10 backdrop-blur-sm text-[12px] min-w-[120px]">
                                  {label && <p className="text-[#96A0AA] text-[10px] font-medium uppercase tracking-wider mb-1.5 opacity-70">{format(new Date(label + 'T00:00:00'), 'EEE, MMM d', { locale: dateFnsLocale })}</p>}
                                  {payload.map((entry, i) => (
                                    <p key={entry.dataKey || i} className="font-semibold leading-snug" style={{ color: entry.color || TT.accent }}>
                                      {entry.name === 'calories' ? t('trainerNotes.nutrition.cal') : `${entry.name} (g)`}: {Math.round(entry.value)}
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
                      {foodLogSummary.map(day => {
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
                      const onTrack = foodLogSummary.filter(d => {
                        const pct = (d.calories / calTarget) * 100;
                        return pct >= 85 && pct <= 115;
                      }).length;
                      const daysLogged = foodLogSummary.length;
                      const compliancePct = Math.round((onTrack / daysLogged) * 100);
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
      </div>

      {/* Monthly Report Modal */}
      <MonthlyProgressReport
        isOpen={showReport}
        onClose={() => dispatch({ type: 'SET', payload: { showReport: false } })}
        profileId={clientId}
      />

      {/* Log Follow-Up Modal */}
      {showFollowupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
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

      {/* Body tab — full-image photo viewer (read-only) */}
      {viewingPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('trainerClientDetail.body.viewPhoto', 'View progress photo')}
          onClick={() => dispatch({ type: 'SET', payload: { viewingPhoto: null } })}
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
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
