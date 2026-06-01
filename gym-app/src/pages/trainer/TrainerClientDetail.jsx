import { useEffect, useReducer, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Save, Scale, Ruler, TrendingUp, TrendingDown, Minus, StickyNote, Calendar, BarChart3,
  MessageSquare, Bell, Phone, Mail, UserCheck, Plus, X, Dumbbell, Trophy,
  Target, Activity, Clock, AlertTriangle, BookOpen, ChevronRight, ChevronDown, Flame,
  ClipboardList, Heart, Zap, RefreshCw, Apple, Camera, MapPin, UtensilsCrossed,
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
import { TT, TFont, avatarIdx, avatarGradient } from './components/designTokens';
import { TCard, TPill, TPrimaryButton } from './components/designPrimitives';
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
  showMeasurements: false,
  showPhotos: false,

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

  // Destructure for readability in JSX
  const {
    loading, accessDenied, isAssigned, client, onboarding, stats, programName, enrollment, streak,
    recentSessions, personalRecords, weeklyWorkouts, workoutsThisWeek,
    weights, measurements, progressPhotos, checkIns,
    notesData, notesSaved, savingNotes,
    followups, showFollowupModal, fuMethod, fuNote, fuOutcome, savingFollowup,
    availablePrograms, assigningProgram,
    nutritionTargets, foodLogSummary, activeMealPlan, savingMealPlan, mealPlanForm, showMealPlanForm, nutritionLoaded, sampleMeals, generatingMeals,
    activeTab, showReport, showMeasurements, showPhotos,
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
        recentRes, prsRes, weeklyRes, onbRes, thisWeekRes,
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
              .select('started_at, gym_programs(name, duration_weeks, weeks)')
              .eq('profile_id', clientId)
              .eq('program_id', assignedProgramId)
              .order('started_at', { ascending: false })
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
  useEffect(() => {
    if (!isAssigned || !clientId) return;
    const channel = supabase
      .channel(`trainer-client-live-${clientId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'session_drafts', filter: `profile_id=eq.${clientId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            dispatch({ type: 'SET', payload: { liveDraft: null } });
          } else {
            dispatch({ type: 'SET', payload: { liveDraft: payload.new || null } });
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isAssigned, clientId]);

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

  // Auto-calculate macro targets from real client data
  function handleAutoCalculate() {
    const weightLbs = weights[0]?.weight_lbs || (onboarding?.weight_kg ? onboarding.weight_kg * 2.20462 : null);
    if (!weightLbs) return;
    const heightInches = onboarding?.height_cm ? onboarding.height_cm / 2.54 : 68;
    const age = onboarding?.age || 30;
    const sex = onboarding?.gender === 'female' ? 'female' : 'male';
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
      await supabase.from('trainer_clients').upsert({
        gym_id: profile.gym_id,
        trainer_id: profile.id,
        client_id: clientId,
        notes: serialized,
      }, { onConflict: 'trainer_id,client_id' });
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
      await supabase.rpc('trainer_assign_program', { p_member_id: clientId, p_program_id: programId });

      // Upsert enrollment
      await supabase
        .from('gym_program_enrollments')
        .upsert({
          program_id: programId,
          profile_id: clientId,
          gym_id: profile.gym_id,
          started_at: new Date().toISOString(),
        }, { onConflict: 'program_id,profile_id' });

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

  const OUTCOME_STYLES = {
    no_answer: { label: t('trainerNotes.followUp.outcomes.noAnswer'), color: 'text-[var(--color-text-muted)]', bg: 'bg-white/[0.04]' },
    rescheduled: { label: t('trainerNotes.followUp.outcomes.rescheduled'), color: 'text-[var(--color-accent)]', bg: 'bg-[var(--color-accent)]/10' },
    coming_back: { label: t('trainerNotes.followUp.outcomes.comingBack'), color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    not_interested: { label: t('trainerNotes.followUp.outcomes.notInterested'), color: 'text-red-400', bg: 'bg-red-500/10' },
    other: { label: t('trainerNotes.followUp.outcomes.other'), color: 'text-[var(--color-text-secondary)]', bg: 'bg-white/[0.04]' },
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
    if (!enrollment?.gym_programs || !enrollment.started_at) return null;
    const { duration_weeks, weeks, name } = enrollment.gym_programs;
    const started = new Date(enrollment.started_at);
    const now = new Date();
    const currentWeek = Math.min(Math.max(differenceInWeeks(now, started) + 1, 1), duration_weeks || 1);
    const totalWeeks = duration_weeks || 0;
    const progressPct = totalWeeks > 0 ? Math.round((currentWeek / totalWeeks) * 100) : 0;
    const week1 = weeks && typeof weeks === 'object' ? (weeks['1'] || weeks[1]) : null;
    const daysPerWeek = Array.isArray(week1) ? week1.length : (week1?.days?.length ?? 3);
    return { name, currentWeek, totalWeeks, daysPerWeek, progressPct };
  }, [enrollment]);

  // Weight chart data (reversed so chart goes left-to-right chronologically)
  const weightChartData = useMemo(() => {
    if (weights.length === 0) return [];
    return [...weights].reverse().map(w => ({
      date: format(new Date(w.logged_at), 'MMM d', { locale: dateFnsLocale }),
      weight: w.weight_lbs,
    }));
  }, [weights, dateFnsLocale]);

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
      <div className="min-h-screen bg-[var(--color-bg-primary)] px-4 py-6 max-w-[480px] mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full" style={{ backgroundColor: 'var(--color-bg-deep)' }} />
            <div className="space-y-2 flex-1">
              <div className="h-5 w-32 rounded-lg" style={{ backgroundColor: 'var(--color-bg-deep)' }} />
              <div className="h-3 w-24 rounded-lg" style={{ backgroundColor: 'var(--color-bg-deep)' }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-24 rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)' }} />
            <div className="h-24 rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)' }} />
          </div>
          <div className="h-48 rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)' }} />
        </div>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-primary)] px-4 md:px-6 py-6 max-w-5xl mx-auto">
        <button
          onClick={() => navigate('/trainer/clients')}
          className="flex items-center gap-2 text-[var(--color-text-secondary)] text-[14px] mb-6 hover:text-[var(--color-text-primary)] transition-colors whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4 flex-shrink-0" />
          {t('trainerNotes.backToClients')}
        </button>
        <div className="text-center py-20">
          <p className="text-[16px] font-semibold text-[var(--color-text-primary)] mb-2">{t('trainerNotes.accessDenied')}</p>
          <p className="text-[14px] text-[var(--color-text-muted)]">{t('trainerNotes.notAssigned')}</p>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-primary)] px-4 md:px-6 py-6 max-w-5xl mx-auto">
        <button
          onClick={() => navigate('/trainer/clients')}
          className="flex items-center gap-2 text-[var(--color-text-secondary)] text-[14px] mb-6 whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4 flex-shrink-0" />
          {t('trainerNotes.backToClients')}
        </button>
        <p className="text-[var(--color-text-secondary)] text-[14px]">{t('trainerNotes.clientNotFound')}</p>
      </div>
    );
  }

  // ── Hero gradient + status pill mapping ─────────────────
  const heroIdx = avatarIdx(client.id);
  const [heroA, heroB] = avatarGradient(heroIdx);
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

  // Split name for two-line hero display
  const nameParts = (client.full_name || t('trainerNotes.unnamedClient', 'Client')).trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ');

  // Pinned note from notesData (if any text present)
  const pinnedNote = (notesData?.notes || '').trim();
  const injuriesNote = (notesData?.injuries || '').trim();

  // Map first 3 PRs into the "Personal records" grid
  const topPRs = (personalRecords || []).slice(0, 4);

  return (
    <div style={{ background: TT.bg, minHeight: '100%' }}>
      {/* ── Hero header (gradient) ──────────────────────────── */}
      <div
        style={{
          background: `linear-gradient(135deg, ${heroA} 0%, ${heroB} 100%)`,
          padding: '12px 16px 90px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <button
            type="button"
            onClick={() => navigate('/trainer/clients')}
            aria-label={t('trainerNotes.backToClients', 'Back')}
            style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'rgba(255,255,255,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', cursor: 'pointer', color: '#fff',
            }}
          >
            <ArrowLeft size={18} strokeWidth={2.2} />
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={async () => {
                try {
                  const { data: convId } = await supabase.rpc('get_or_create_conversation', { p_other_user: clientId });
                  if (convId) navigate(`/trainer/messages/${convId}`);
                } catch (err) { logger.error('Error opening conversation:', err); }
              }}
              aria-label={t('trainerNotes.actions.messageClient', 'Message')}
              style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'rgba(255,255,255,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', cursor: 'pointer', color: '#fff',
              }}
            >
              <MessageSquare size={18} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: 'SET', payload: { showReport: true } })}
              aria-label={t('trainerNotes.actions.monthlyReport', 'More')}
              style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'rgba(255,255,255,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', cursor: 'pointer', color: '#fff',
              }}
            >
              <MoreHorizontal size={18} strokeWidth={2.2} />
            </button>
          </div>
        </div>
        <div style={{ color: '#fff' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <TPill tone={heroStatusTone} size="s">
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
                  whiteSpace: 'nowrap',
                  minHeight: 22,
                }}
              >
                {t('trainerClientDetail.live.watchLive', '● Live')}
              </button>
            )}
          </div>
          <div style={{
            fontFamily: TFont.display, fontSize: 32, fontWeight: 800,
            letterSpacing: -1.2, lineHeight: 1.05, marginTop: 12,
          }}>
            {firstName}{lastName ? <><br/>{lastName}</> : null}
          </div>
          {client?.username && (
            <div style={{
              fontSize: 13, fontWeight: 500, marginTop: 4,
              color: 'rgba(255,255,255,0.7)',
            }}>
              @{client.username}
            </div>
          )}
          <div style={{ fontSize: 13, marginTop: 6, opacity: 0.85, fontWeight: 600 }}>
            {programName || t('trainerClientDetail.noProgram', 'No program')}
            {programProgress && (
              <> · {t('trainerClientDetail.weekOf', 'Week {{w}} of {{t}}', {
                w: programProgress.currentWeek,
                t: programProgress.totalWeeks,
              })}</>
            )}
          </div>
        </div>
      </div>

      {/* ── Snapshot card overlapping ──────────────────────── */}
      <div style={{ padding: '0 16px', marginTop: -70, position: 'relative', zIndex: 2 }}>
        <TCard padded={16}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[
              { l: t('trainerClientDetail.snapshot.adherence', 'Adherence'), v: `${adherencePercent}%`, sub: t('trainerClientDetail.snapshot.last30d', 'Last 30d'), tone: TT.good },
              { l: t('trainerClientDetail.snapshot.sessions', 'Sessions'), v: `${workoutsThisWeek}/${stats.count}`, sub: t('trainerClientDetail.snapshot.thisBlock', 'This block'), tone: TT.accent },
              { l: t('trainerClientDetail.snapshot.streak', 'Streak'), v: `${streak?.current_streak_days || 0}d`, sub: t('trainerClientDetail.snapshot.active', 'Active'), tone: TT.hot },
            ].map((s, i) => (
              <div key={i} style={{
                padding: 10, borderRadius: 12, background: TT.surface2,
                textAlign: 'center',
              }}>
                <div style={{ fontFamily: TFont.display, fontSize: 18, fontWeight: 800, color: s.tone, letterSpacing: -0.5 }}>
                  {s.v}
                </div>
                <div style={{ fontSize: 10, color: TT.textSub, fontWeight: 700, marginTop: 4, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  {s.l}
                </div>
                <div style={{ fontSize: 9, color: TT.textMute, marginTop: 2 }}>{s.sub}</div>
              </div>
            ))}
          </div>
        </TCard>
      </div>

      {/* ── Tab strip ──────────────────────────────────────── */}
      <div style={{ padding: '14px 16px 0' }}>
        <div style={{
          display: 'flex', gap: 4, padding: 4, background: TT.surface,
          borderRadius: 12, border: `1px solid ${TT.border}`, marginBottom: 14,
        }}>
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
                style={{
                  flex: 1, padding: '8px 4px', borderRadius: 8, textAlign: 'center',
                  background: isActive ? TT.text : 'transparent',
                  color: isActive ? '#fff' : TT.textSub,
                  fontSize: 11.5, fontWeight: 700,
                  border: 'none', cursor: 'pointer',
                  minHeight: 36,
                }}
              >
                {t2.l}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Overview tab content (new visual layer) ────────── */}
      {activeTab === 'overview' && (
        <div style={{ padding: '0 16px 14px' }} className="md:max-w-[860px] md:mx-auto">
          {/* Check-in reference photo (staff-managed) */}
          <TCard padded={14} style={{ marginBottom: 14 }}>
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
              <div style={{
                fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text,
                letterSpacing: -0.2, marginBottom: 8,
              }}>
                {t('trainerClientDetail.nextSession', 'Next session')}
              </div>
              <TCard padded={14} style={{ marginBottom: 14, borderLeft: `3px solid ${TT.accent}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontFamily: TFont.display, fontSize: 22, fontWeight: 800, color: TT.text, letterSpacing: -0.5, lineHeight: 1 }}>
                      {recentSessions[0]?.duration_seconds
                        ? formatDuration(recentSessions[0].duration_seconds)
                        : t('trainerClientDetail.scheduled', 'Soon')}
                    </div>
                    <div style={{ fontSize: 11, color: TT.textSub, marginTop: 2 }}>
                      {t('trainerClientDetail.sessionMins', '{{m}} min', { m: 60 })}
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

          {/* Recent log */}
          <div style={{
            fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text,
            letterSpacing: -0.2, marginBottom: 8,
          }}>
            {t('trainerClientDetail.recentLog', 'Recent log')}
          </div>
          {recentSessions.length === 0 ? (
            <TCard padded={14} style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 13, color: TT.textMute }}>
                {t('trainerNotes.overview.noRecentWorkouts', 'No recent workouts')}
              </p>
            </TCard>
          ) : (
            <TCard padded={0} style={{ marginBottom: 14 }}>
              {recentSessions.slice(0, 5).map((s, i) => (
                <div
                  key={s.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                    borderTop: i > 0 ? `1px solid ${TT.border}` : 'none',
                  }}
                >
                  <div style={{ width: 36, textAlign: 'center', flexShrink: 0 }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, color: TT.textMute,
                      letterSpacing: 0.4, textTransform: 'uppercase',
                    }}>
                      {format(new Date(s.started_at), 'EEE', { locale: dateFnsLocale })}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.name || t('trainerNotes.overview.workout', 'Workout')}
                    </div>
                    <div style={{ fontSize: 11, color: TT.textSub, marginTop: 1 }}>
                      {format(new Date(s.started_at), 'MMM d', { locale: dateFnsLocale })}
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
                </div>
              ))}
            </TCard>
          )}

          {/* Personal records */}
          <div style={{
            fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text,
            letterSpacing: -0.2, marginBottom: 8,
          }}>
            {t('trainerClientDetail.prs', 'Personal records')}
          </div>
          {topPRs.length === 0 ? (
            <TCard padded={14} style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 13, color: TT.textMute }}>
                {t('trainerNotes.progress.noPRs', 'No PRs yet')}
              </p>
            </TCard>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
              {topPRs.map((pr, i) => (
                <TCard key={i} padded={12}>
                  <div style={{
                    fontSize: 10, color: TT.textMute, fontWeight: 700,
                    letterSpacing: 0.5, textTransform: 'uppercase',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {pr.exercises?.name || t('trainerNotes.overview.unknownExercise', 'Lift')}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                    <div style={{
                      fontFamily: TFont.display, fontSize: 18, fontWeight: 800,
                      color: TT.text, letterSpacing: -0.5,
                    }}>
                      {pr.weight_lbs} {t('common:lb', 'lb')}
                    </div>
                    <span style={{ fontSize: 10, color: TT.good, fontWeight: 800 }}>
                      {t('trainerClientDetail.pr.up', '↑ PR')}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: TT.textMute, marginTop: 2 }}>
                    {format(new Date(pr.achieved_at), 'MMM d', { locale: dateFnsLocale })}
                  </div>
                </TCard>
              ))}
            </div>
          )}

          {/* Pinned notes (post-it style) */}
          {(pinnedNote || injuriesNote) && (
            <>
              <div style={{
                fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text,
                letterSpacing: -0.2, marginBottom: 8,
              }}>
                {t('trainerClientDetail.pinnedNotes', 'Pinned notes')}
              </div>
              {injuriesNote && (
                <TCard padded={14} style={{
                  background: '#FEF4A8', borderColor: '#F2DC6E', marginBottom: 8,
                }}>
                  <div style={{ fontSize: 12.5, color: '#5A4A2A', lineHeight: 1.5, fontFamily: TFont.body, fontStyle: 'italic' }}>
                    "{injuriesNote}"
                  </div>
                  <div style={{ fontSize: 10, color: '#8A7A4A', marginTop: 6, fontWeight: 700 }}>
                    {t('trainerClientDetail.injuriesPinned', 'Injuries · Pinned')}
                  </div>
                </TCard>
              )}
              {pinnedNote && (
                <TCard padded={14} style={{
                  background: '#FEF4A8', borderColor: '#F2DC6E', marginBottom: 14,
                }}>
                  <div style={{ fontSize: 12.5, color: '#5A4A2A', lineHeight: 1.5, fontFamily: TFont.body, fontStyle: 'italic' }}>
                    "{pinnedNote.length > 240 ? pinnedNote.slice(0, 240) + '…' : pinnedNote}"
                  </div>
                  <div style={{ fontSize: 10, color: '#8A7A4A', marginTop: 6, fontWeight: 700 }}>
                    {t('trainerClientDetail.coachPinned', 'Coach notes · Pinned')}
                  </div>
                </TCard>
              )}
            </>
          )}

          {/* Quick action row — keep access to follow-up/report */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            <button
              type="button"
              onClick={() => dispatch({ type: 'SET', payload: { activeTab: 'notesFollowUp', showFollowupModal: true } })}
              style={{
                padding: '10px 14px', borderRadius: 12,
                border: `1px solid ${TT.borderSolid}`, background: TT.surface,
                fontSize: 12, fontWeight: 700, color: TT.text, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Phone size={13} />
              {t('trainerNotes.actions.logFollowUp', 'Log follow-up')}
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: 'SET', payload: { showReport: true } })}
              style={{
                padding: '10px 14px', borderRadius: 12,
                border: `1px solid ${TT.borderSolid}`, background: TT.surface,
                fontSize: 12, fontWeight: 700, color: TT.text, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <BarChart3 size={13} />
              {t('trainerNotes.actions.monthlyReport', 'Monthly report')}
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: 'SET', payload: { activeTab: 'programNutrition' } })}
              style={{
                padding: '10px 14px', borderRadius: 12,
                border: `1px solid ${TT.borderSolid}`, background: TT.surface,
                fontSize: 12, fontWeight: 700, color: TT.text, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
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
        <div style={{ padding: '0 16px 24px' }} className="md:max-w-[860px] md:mx-auto">
          {/* Recovery + what-to-train (trainer tool) */}
          <TrainerClientRecovery clientId={clientId} />
          {/* Attendance calendar (with-you vs alone) */}
          <TrainerClientAttendance clientId={clientId} />
          {/* View-only banner */}
          <div style={{
            background: TT.warnSoft, color: TT.warnInk,
            borderRadius: 12, padding: '8px 12px', marginBottom: 14,
            fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Eye size={14} />
            {t('trainerClientDetail.body.viewOnly', 'View only — client owns these records.')}
          </div>

          {/* Body composition summary */}
          <div style={{
            fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text,
            letterSpacing: -0.2, marginBottom: 8,
          }}>
            {t('trainerClientDetail.body.composition', 'Body composition')}
          </div>
          <TCard padded={14} style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
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
                <div key={i} style={{ padding: 10, borderRadius: 12, background: TT.surface2, textAlign: 'center' }}>
                  <div style={{
                    fontFamily: TFont.display, fontSize: 18, fontWeight: 800,
                    color: TT.text, letterSpacing: -0.5,
                  }}>
                    {s.v}{s.u && <span style={{ fontSize: 11, fontWeight: 700, color: TT.textSub, marginLeft: 2 }}>{s.u}</span>}
                  </div>
                  <div style={{
                    fontSize: 9.5, color: TT.textMute, fontWeight: 700,
                    letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 4,
                  }}>{s.l}</div>
                </div>
              ))}
            </div>
          </TCard>

          {/* Weight trend with period selector */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div style={{
              fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text,
              letterSpacing: -0.2,
            }}>
              {t('trainerClientDetail.body.weightTrend', 'Weight trend')}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
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
                  style={{
                    padding: '4px 9px', borderRadius: 8,
                    background: bodyPeriod === p.v ? TT.text : 'transparent',
                    color: bodyPeriod === p.v ? '#fff' : TT.textSub,
                    fontSize: 10.5, fontWeight: 700,
                    border: bodyPeriod === p.v ? 'none' : `1px solid ${TT.borderSolid}`,
                    cursor: 'pointer', minHeight: 28,
                  }}
                >{p.l}</button>
              ))}
            </div>
          </div>
          <TCard padded={14} style={{ marginBottom: 14 }}>
            {bodyWeightStats.current != null && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
                <span style={{ fontFamily: TFont.display, fontSize: 28, fontWeight: 800, color: TT.text, letterSpacing: -1 }}>
                  {bodyWeightStats.current.toFixed(1)}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: TT.textSub }}>{t('common:lb', 'lb')}</span>
                {bodyWeightStats.delta != null && (
                  <span style={{
                    fontSize: 12, fontWeight: 700,
                    color: bodyWeightStats.delta > 0 ? TT.hot : bodyWeightStats.delta < 0 ? TT.good : TT.textMute,
                    marginLeft: 6,
                  }}>
                    {bodyWeightStats.delta > 0 ? '+' : ''}{bodyWeightStats.delta.toFixed(1)} {t('common:lb', 'lb')}
                  </span>
                )}
              </div>
            )}
            {bodyWeightChart.length > 1 ? (
              <div style={{ height: 180, marginLeft: -10 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={bodyWeightChart} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="bodyWeightGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={TT.accent} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={TT.accent} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={TT.border} />
                    <XAxis dataKey="date" tick={{ fill: TT.textMute, fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis domain={['dataMin - 2', 'dataMax + 2']} tick={{ fill: TT.textMute, fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
                    <Tooltip content={<ChartTooltip formatter={(v) => `${v} lb`} nameLabel={t('trainerClientDetail.body.weight', 'Weight')} />} />
                    <Area type="monotone" dataKey="weight" stroke={TT.accent} strokeWidth={2} fill="url(#bodyWeightGrad)" name={t('trainerClientDetail.body.weight', 'Weight')} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: TT.textMute }}>
                {t('trainerClientDetail.body.notEnoughLogs', 'Not enough weight logs to show a trend yet.')}
              </p>
            )}
          </TCard>

          {/* Measurements grid */}
          <div style={{
            fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text,
            letterSpacing: -0.2, marginBottom: 8,
          }}>
            {t('trainerClientDetail.body.measurements', 'Measurements')}
          </div>
          {measurements ? (
            <TCard padded={14} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: TT.textMute, fontWeight: 600, marginBottom: 8 }}>
                {t('trainerClientDetail.body.lastUpdated', 'Last updated')}{' '}
                {format(new Date(measurements.measured_at), 'MMM d, yyyy', { locale: dateFnsLocale })}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
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
                  .map(m => (
                    <div key={m.k} style={{
                      padding: 10, borderRadius: 12, background: TT.surface2,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    }}>
                      <span style={{ fontSize: 11.5, color: TT.textSub, fontWeight: 600 }}>{m.l}</span>
                      <span style={{ fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text }}>
                        {parseFloat(measurements[m.k]).toFixed(1)}
                        <span style={{ fontSize: 10, fontWeight: 600, color: TT.textMute, marginLeft: 2 }}>{t('common:cm', 'cm')}</span>
                      </span>
                    </div>
                  ))}
              </div>
            </TCard>
          ) : (
            <TCard padded={14} style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 13, color: TT.textMute }}>
                {t('trainerClientDetail.body.noMeasurements', 'No measurements recorded yet.')}
              </p>
            </TCard>
          )}

          {/* Progress photos timeline (month-grouped, read-only) */}
          <div style={{
            fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text,
            letterSpacing: -0.2, marginBottom: 8,
          }}>
            {t('trainerClientDetail.body.photos', 'Progress photos')}
          </div>
          {photosByMonth.length === 0 ? (
            <TCard padded={14}>
              <p style={{ fontSize: 13, color: TT.textMute }}>
                {t('trainerClientDetail.body.noPhotos', 'No progress photos yet.')}
              </p>
            </TCard>
          ) : (
            photosByMonth.map(grp => (
              <div key={grp.key} style={{ marginBottom: 14 }}>
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
        <div style={{ padding: '0 16px 24px' }} className="md:max-w-[860px] md:mx-auto">
          {/* Streak summary */}
          <div style={{
            fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text,
            letterSpacing: -0.2, marginBottom: 8,
          }}>
            {t('trainerClientDetail.history.streaks', 'Streaks')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            <TCard padded={12}>
              <div style={{ fontSize: 10, fontWeight: 700, color: TT.textMute, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                {t('trainerClientDetail.history.currentStreak', 'Current streak')}
              </div>
              <div style={{ fontFamily: TFont.display, fontSize: 24, fontWeight: 800, color: TT.hot, letterSpacing: -0.5, marginTop: 2 }}>
                {streakStats.current}<span style={{ fontSize: 13, color: TT.textSub, fontWeight: 700, marginLeft: 4 }}>d</span>
              </div>
            </TCard>
            <TCard padded={12}>
              <div style={{ fontSize: 10, fontWeight: 700, color: TT.textMute, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                {t('trainerClientDetail.history.longestStreak', 'Longest streak')}
              </div>
              <div style={{ fontFamily: TFont.display, fontSize: 24, fontWeight: 800, color: TT.accent, letterSpacing: -0.5, marginTop: 2 }}>
                {streakStats.longest}<span style={{ fontSize: 13, color: TT.textSub, fontWeight: 700, marginLeft: 4 }}>d</span>
              </div>
            </TCard>
          </div>

          {/* PR timeline */}
          <div style={{
            fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text,
            letterSpacing: -0.2, marginBottom: 8,
          }}>
            {t('trainerClientDetail.history.prTimeline', 'PR timeline')}
          </div>
          <TCard padded={14} style={{ marginBottom: 14 }}>
            {prTimelineData.series.length > 1 ? (
              <div style={{ height: 200, marginLeft: -10 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={prTimelineData.series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={TT.border} />
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
          <div style={{
            fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text,
            letterSpacing: -0.2, marginBottom: 8,
          }}>
            {t('trainerClientDetail.history.volumeTrend', 'Volume trend')}
          </div>
          <TCard padded={14} style={{ marginBottom: 14 }}>
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
                    <CartesianGrid strokeDasharray="3 3" stroke={TT.border} />
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
          <div style={{
            fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text,
            letterSpacing: -0.2, marginBottom: 8,
          }}>
            {t('trainerClientDetail.history.attendance', 'Attendance')}
          </div>
          <TCard padded={14} style={{ marginBottom: 14 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(15, 1fr)',
              gap: 3,
              maxWidth: 360,
            }}>
              {attendanceHeatmap.map((d, i) => {
                const intensity = d.value === 0 ? 0 : Math.min(d.value, 3);
                const colors = [TT.surface2, TT.accentSoft, '#7FE3C4', TT.accent];
                return (
                  <div
                    key={i}
                    title={`${d.label}: ${t('trainerClientDetail.heatmap.event', '{{count}} events', { count: d.value })}`}
                    aria-label={`${d.label}: ${t('trainerClientDetail.heatmap.event', '{{count}} events', { count: d.value })}`}
                    style={{
                      aspectRatio: '1/1',
                      borderRadius: 3,
                      background: colors[intensity],
                      border: `1px solid ${TT.border}`,
                    }}
                  />
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 10, color: TT.textMute, fontWeight: 600 }}>
              <span>{t('trainerClientDetail.history.less', 'Less')}</span>
              {[TT.surface2, TT.accentSoft, '#7FE3C4', TT.accent].map((c, i) => (
                <div key={i} style={{ width: 10, height: 10, borderRadius: 2, background: c, border: `1px solid ${TT.border}` }} />
              ))}
              <span>{t('trainerClientDetail.history.more', 'More')}</span>
            </div>
          </TCard>

          {/* Workouts log */}
          <div style={{
            fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text,
            letterSpacing: -0.2, marginBottom: 8,
          }}>
            {t('trainerClientDetail.history.workouts', 'Workouts')}
          </div>
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
      <div style={{ padding: '0 16px 14px' }} className="md:max-w-[860px] md:mx-auto">
        <div style={{
          display: (activeTab === 'overview' || activeTab === 'body' || activeTab === 'history') ? 'none' : 'block',
        }}>

      {/* ===================== TAB 1: OVERVIEW (merged Overview + Progress) ===================== */}
      {activeTab === 'overview' && (
        <div className="space-y-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
          {/* Client stats strip */}
          {onboarding && (
            <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4 md:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-[var(--color-accent)]" />
                <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.overview.clientSummary')}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
                {onboarding.primary_goal && (
                  <div className="bg-[var(--color-bg-secondary)]/60 rounded-xl px-3 py-2.5">
                    <p className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide">{t('trainerNotes.overview.goal')}</p>
                    <p className="text-[13px] text-[var(--color-text-primary)] capitalize mt-0.5">{t(`trainerNotes.goals.${onboarding.primary_goal}`, onboarding.primary_goal.replace(/_/g, ' '))}</p>
                  </div>
                )}
                {onboarding.fitness_level && (
                  <div className="bg-[var(--color-bg-secondary)]/60 rounded-xl px-3 py-2.5">
                    <p className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide">{t('trainerNotes.overview.fitnessLevel')}</p>
                    <p className="text-[13px] text-[var(--color-text-primary)] capitalize mt-0.5">{t(`trainerNotes.fitnessLevels.${onboarding.fitness_level}`, onboarding.fitness_level)}</p>
                  </div>
                )}
                {onboarding.available_equipment && onboarding.available_equipment.length > 0 && (
                  <div className="bg-[var(--color-bg-secondary)]/60 rounded-xl px-3 py-2.5">
                    <p className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide">{t('trainerNotes.overview.equipment')}</p>
                    <p className="text-[13px] text-[var(--color-text-primary)] mt-0.5 truncate">
                      {Array.isArray(onboarding.available_equipment)
                        ? onboarding.available_equipment.join(', ')
                        : onboarding.available_equipment}
                    </p>
                  </div>
                )}
              </div>
              {onboarding.injuries_notes && (
                <div className="mt-3 bg-red-500/5 rounded-xl px-3 py-2.5 border border-red-500/10">
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="w-3 h-3 text-red-400" />
                    <p className="text-[11px] text-red-400 uppercase tracking-wide">{t('trainerNotes.overview.injuries')}</p>
                  </div>
                  <p className="text-[13px] text-[var(--color-text-primary)]">{onboarding.injuries_notes}</p>
                </div>
              )}
            </div>
          )}

          {/* Recent 5 workouts */}
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-[var(--color-accent)]" />
              <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.overview.recentActivity')}</span>
            </div>
            {recentSessions.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-muted)]">{t('trainerNotes.overview.noRecentWorkouts')}</p>
            ) : (
              <div className="space-y-2">
                {recentSessions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-[var(--color-bg-secondary)]/60">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-[var(--color-text-primary)] truncate">{s.name || t('trainerNotes.overview.workout')}</p>
                      <p className="text-[11px] text-[var(--color-text-muted)]">
                        {format(new Date(s.started_at), 'MMM d', { locale: dateFnsLocale })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-right shrink-0">
                      <span className="text-[12px] text-[var(--color-text-secondary)]">
                        <Clock className="w-3 h-3 inline mr-0.5" />
                        {formatDuration(s.duration_seconds)}
                      </span>
                      <span className="text-[12px] text-[var(--color-text-secondary)]">
                        {s.total_volume_lbs >= 1000
                          ? `${(s.total_volume_lbs / 1000).toFixed(1)}k`
                          : s.total_volume_lbs || 0} {t('common:lbs', 'lbs')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top PRs */}
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-4 h-4 text-[var(--color-accent)]" />
              <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.progress.personalRecords')}</span>
              {personalRecords.length > 0 && (
                <span className="text-[11px] text-[var(--color-text-muted)] ml-auto">({personalRecords.length})</span>
              )}
            </div>
            {personalRecords.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-muted)]">{t('trainerNotes.progress.noPRs')}</p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {personalRecords.map((pr, i) => (
                  <div key={i} className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-[var(--color-bg-secondary)]/60">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-[var(--color-text-primary)] truncate">{pr.exercises?.name || t('trainerNotes.overview.unknownExercise')}</p>
                      <p className="text-[11px] text-[var(--color-text-muted)]">{format(new Date(pr.achieved_at), 'MMM d, yyyy', { locale: dateFnsLocale })}</p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">{pr.weight_lbs} {t('common:lbs', 'lbs')} x {pr.reps}</p>
                      {pr.estimated_1rm && (
                        <p className="text-[11px] text-[var(--color-accent)]">1RM: {Math.round(pr.estimated_1rm)} {t('common:lbs', 'lbs')}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Weekly volume chart */}
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4 md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-[var(--color-accent)]" />
              <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.progress.trainingTrend')}</span>
            </div>
            {weeklyWorkouts.length > 0 ? (
              <div className="h-[160px] sm:h-[180px] overflow-hidden -mx-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weeklyWorkouts}>
                    <defs>
                      <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="week"
                      tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={20}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--color-accent)', strokeWidth: 1, strokeDasharray: '4 4', strokeOpacity: 0.4 }} />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="var(--color-accent)"
                      strokeWidth={2}
                      fill="url(#goldGrad)"
                      name={t('trainerNotes.progress.workouts')}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-[13px] text-[var(--color-text-muted)]">{t('trainerNotes.progress.noData')}</p>
            )}
          </div>

          {/* Weight trend — chart only with latest weight summary */}
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4 md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <Scale className="w-4 h-4 text-[var(--color-accent)]" />
              <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.progress.weightHistory')}</span>
            </div>
            {weights.length === 0 ? (
              <p className="text-[14px] text-[var(--color-text-muted)]">{t('trainerNotes.progress.noWeightLogs')}</p>
            ) : (
              <>
                {/* Latest weight summary line */}
                <div className="bg-[var(--color-bg-secondary)] rounded-xl p-4 mb-4 border border-[var(--color-accent)]/15">
                  <p className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide mb-1">{t('trainerNotes.progress.latestWeight')}</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[20px] sm:text-[24px] font-bold text-[var(--color-text-primary)]">{weights[0].weight_lbs}</span>
                    <span className="text-[14px] text-[var(--color-text-muted)]">{t('common:lbs', 'lbs')}</span>
                    {weights.length >= 2 && (
                      <span className={`text-[13px] font-medium ml-2 ${
                        weights[0].weight_lbs - weights[1].weight_lbs > 0
                          ? 'text-[#EF4444]'
                          : weights[0].weight_lbs - weights[1].weight_lbs < 0
                            ? 'text-[#10B981]'
                            : 'text-[var(--color-text-muted)]'
                      }`}>
                        {weights[0].weight_lbs - weights[1].weight_lbs > 0 ? '+' : ''}
                        {(weights[0].weight_lbs - weights[1].weight_lbs).toFixed(1)} {t('common:lbs', 'lbs')}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-[var(--color-text-muted)] mt-1">
                    {format(new Date(weights[0].logged_at), 'EEEE, MMM d, yyyy', { locale: dateFnsLocale })}
                  </p>
                </div>
                {/* Weight trend chart */}
                {weightChartData.length > 1 && (
                  <div className="h-[160px] sm:h-[180px] overflow-hidden -mx-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={weightChartData}>
                        <defs>
                          <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="date"
                          tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          domain={['dataMin - 2', 'dataMax + 2']}
                          tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          width={35}
                        />
                        <Tooltip
                          content={<ChartTooltip formatter={(val) => `${val} lbs`} nameLabel={t('trainerNotes.progress.weight', 'Weight')} />}
                          cursor={{ stroke: 'var(--color-accent)', strokeWidth: 1, strokeDasharray: '4 4', strokeOpacity: 0.4 }}
                        />
                        <Area
                          type="monotone"
                          dataKey="weight"
                          stroke="var(--color-accent)"
                          strokeWidth={2}
                          fill="url(#weightGrad)"
                          name={t('trainerNotes.progress.weight', 'Weight')}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Body measurements (collapsible) */}
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4 md:col-span-2">
            <button
              onClick={() => dispatch({ type: 'SET', payload: { showMeasurements: !showMeasurements } })}
              className="flex items-center justify-between w-full min-h-[44px]"
            >
              <div className="flex items-center gap-2">
                <Ruler className="w-4 h-4 text-[var(--color-accent)]" />
                <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.progress.bodyMeasurements')}</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-[var(--color-text-muted)] transition-transform ${showMeasurements ? 'rotate-180' : ''}`} />
            </button>
            {showMeasurements && (
              <div className="mt-3">
                {!measurements ? (
                  <p className="text-[13px] text-[var(--color-text-muted)]">{t('trainerNotes.progress.noMeasurements')}</p>
                ) : (
                  <div className="space-y-1.5">
                    {measurements.measured_at && (
                      <p className="text-[11px] text-[var(--color-text-muted)] mb-2">
                        {t('trainerNotes.progress.measuredOn')} {format(new Date(measurements.measured_at), 'MMM d, yyyy', { locale: dateFnsLocale })}
                      </p>
                    )}
                    {[
                      { label: t('trainerNotes.progress.chest'), value: measurements.chest_cm },
                      { label: t('trainerNotes.progress.waist'), value: measurements.waist_cm },
                      { label: t('trainerNotes.progress.hips'), value: measurements.hips_cm },
                      { label: t('trainerNotes.progress.leftArm'), value: measurements.left_arm_cm },
                      { label: t('trainerNotes.progress.rightArm'), value: measurements.right_arm_cm },
                      { label: t('trainerNotes.progress.leftThigh'), value: measurements.left_thigh_cm },
                      { label: t('trainerNotes.progress.rightThigh'), value: measurements.right_thigh_cm },
                    ]
                      .filter((m) => m.value != null)
                      .map((m, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--color-bg-secondary)]/50"
                        >
                          <span className="text-[13px] text-[var(--color-text-secondary)]">{m.label}</span>
                          <span className="text-[14px] font-medium text-[var(--color-text-primary)]">
                            {m.value} {t('common:cm', 'cm')}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Progress Photos (collapsible) */}
          {progressPhotos.length > 0 && (
            <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4 md:col-span-2">
              <button
                onClick={() => dispatch({ type: 'SET', payload: { showPhotos: !showPhotos } })}
                className="flex items-center justify-between w-full min-h-[44px]"
              >
                <div className="flex items-center gap-2">
                  <Camera className="w-4 h-4 text-[var(--color-accent)]" />
                  <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.progress.photos', 'Progress Photos')}</span>
                  <span className="text-[11px] text-[var(--color-text-muted)]">({progressPhotos.length})</span>
                </div>
                <ChevronDown className={`w-4 h-4 text-[var(--color-text-muted)] transition-transform ${showPhotos ? 'rotate-180' : ''}`} />
              </button>
              {showPhotos && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 mt-3">
                  {progressPhotos.map(photo => (
                    <div key={photo.id} className="aspect-square rounded-xl overflow-hidden bg-[var(--color-bg-secondary)] relative">
                      <img
                        src={photo.signedUrl}
                        alt={photo.view_angle || t('trainerNotes.progress.progressAlt')}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <span className="absolute bottom-1 left-1 text-[9px] font-medium bg-black/60 text-white px-1.5 py-0.5 rounded">
                        {format(new Date(photo.taken_at), 'MMM d', { locale: dateFnsLocale })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Monthly Report */}
          <button
            onClick={() => dispatch({ type: 'SET', payload: { showReport: true } })}
            className="w-full bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4 flex items-center gap-3 hover:border-[var(--color-accent)]/30 transition-colors min-h-[44px] md:col-span-2"
          >
            <div className="w-10 h-10 rounded-xl bg-[var(--color-accent)]/10 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-[var(--color-accent)]" />
            </div>
            <div className="text-left">
              <p className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.overview.monthlyReport')}</p>
              <p className="text-[12px] text-[var(--color-text-muted)]">{t('trainerNotes.overview.monthlyReportDesc')}</p>
            </div>
          </button>
        </div>
      )}

      {/* ===================== TAB 2: NOTES & FOLLOW-UP ===================== */}
      {activeTab === 'notesFollowUp' && (
        <div className="space-y-4">
          {/* Notes editor — 2 textareas: Coach Notes (merged) and Injuries */}
          <div className="space-y-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
            {/* Coach Notes (merged: notes + preferences + goal reminders) */}
            <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <StickyNote className="w-4 h-4 text-[var(--color-accent)]" />
                <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.notes.coachNotes')}</span>
              </div>
              <textarea
                value={notesData.notes}
                onChange={(e) => {
                  if (e.target.value.length <= 5000) {
                    dispatch({ type: 'SET_NOTES_FIELD', field: 'notes', value: e.target.value });
                  }
                }}
                placeholder={t('trainerNotes.notes.notesPlaceholder')}
                className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg p-3 text-[16px] sm:text-[14px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors"
                rows={10}
              />
              <span className="text-[11px] text-[var(--color-text-muted)] mt-1 block">
                {notesData.notes.length} / 5000
              </span>
            </div>

            {/* Injuries / Limitations — kept separate (safety-critical) */}
            <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.notes.injuriesLimitations')}</span>
              </div>
              <textarea
                value={notesData.injuries}
                onChange={(e) => {
                  if (e.target.value.length <= 1000) {
                    dispatch({ type: 'SET_NOTES_FIELD', field: 'injuries', value: e.target.value });
                  }
                }}
                placeholder={t('trainerNotes.notes.injuriesPlaceholder')}
                className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg p-3 text-[16px] sm:text-[14px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors"
                rows={5}
              />
            </div>

            {/* Save button */}
            <div className="flex items-center justify-end gap-3 md:col-span-2">
              {notesSaved && (
                <span className="text-[13px] text-[#10B981]">{t('trainerNotes.notes.saved')}</span>
              )}
              <button
                onClick={handleSaveNotes}
                disabled={savingNotes}
                className="flex items-center gap-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)] text-[var(--color-text-on-accent)] text-[13px] font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 min-h-[44px]"
              >
                <Save className="w-3.5 h-3.5" />
                {savingNotes ? t('trainerNotes.notes.saving') : t('trainerNotes.notes.saveNotes')}
              </button>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-[var(--color-border-subtle)]" />

          {/* Follow-up section */}
          <button
            onClick={() => dispatch({ type: 'SET', payload: { showFollowupModal: true } })}
            className="w-full flex items-center justify-center gap-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)] text-[var(--color-text-on-accent)] text-[14px] font-semibold px-4 py-3 rounded-xl transition-colors min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            {t('trainerNotes.followUp.logFollowUp')}
          </button>

          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Phone className="w-4 h-4 text-[var(--color-accent)]" />
              <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.followUp.title')}</span>
              {followups.length > 0 && (
                <span className="text-[11px] text-[var(--color-text-muted)]">({followups.length})</span>
              )}
            </div>

            {followups.length === 0 ? (
              <div className="text-center py-8">
                <Phone className="w-8 h-8 text-[var(--color-text-muted)] mx-auto mb-2 opacity-40" />
                <p className="text-[13px] text-[var(--color-text-muted)]">{t('trainerNotes.followUp.noFollowUps')}</p>
                <p className="text-[12px] text-[var(--color-text-muted)]/60 mt-1">{t('trainerNotes.followUp.noFollowUpsHint')}</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {followups.map((fu) => {
                  const MethodIcon = METHOD_ICONS[fu.method] || Phone;
                  const outcomeStyle = fu.outcome ? OUTCOME_STYLES[fu.outcome] : null;
                  return (
                    <div key={fu.id} className="flex items-start gap-3 py-3 px-3 rounded-xl bg-[var(--color-bg-secondary)]/60">
                      <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0 mt-0.5">
                        <MethodIcon size={13} className="text-[var(--color-text-secondary)]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] text-[var(--color-text-secondary)]">
                            {format(new Date(fu.created_at), 'MMM d, yyyy h:mm a', { locale: dateFnsLocale })}
                          </span>
                          {outcomeStyle && (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${outcomeStyle.bg} ${outcomeStyle.color}`}>
                              {outcomeStyle.label}
                            </span>
                          )}
                        </div>
                        {fu.note && (
                          <p className="text-[13px] text-[var(--color-text-primary)] mt-1">{fu.note}</p>
                        )}
                      </div>
                    </div>
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
        <div className="space-y-4">
          {/* Current assigned program */}
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="w-4 h-4 text-[var(--color-accent)]" />
              <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.program.currentProgram')}</span>
            </div>

            {programName ? (
              <div>
                <div className="bg-[var(--color-bg-secondary)] rounded-xl p-4 border border-[var(--color-accent)]/15">
                  <p className="text-[16px] font-semibold text-[var(--color-text-primary)]">{programName}</p>
                  {programProgress && (
                    <>
                      <div className="flex items-center gap-4 mt-3 text-[12px] text-[var(--color-text-secondary)]">
                        <span>{t('trainerNotes.program.week')} {programProgress.currentWeek} / {programProgress.totalWeeks}</span>
                        <span>{programProgress.daysPerWeek} {t('trainerNotes.program.daysPerWeek')}</span>
                      </div>
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-[11px] text-[var(--color-text-muted)] mb-1.5">
                          <span>{t('trainerNotes.program.progress')}</span>
                          <span>{programProgress.progressPct}%</span>
                        </div>
                        <div className="w-full h-2 bg-white/[0.06] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[var(--color-accent)] rounded-full transition-all"
                            style={{ width: `${programProgress.progressPct}%` }}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <button
                  onClick={() => handleAssignProgram(null)}
                  className="mt-3 text-[12px] text-red-400 hover:text-red-300 transition-colors min-h-[44px] py-2"
                >
                  {t('trainerNotes.program.removeProgram')}
                </button>
              </div>
            ) : (
              <div className="text-center py-6">
                <BookOpen className="w-8 h-8 text-[var(--color-text-muted)] mx-auto mb-2 opacity-40" />
                <p className="text-[13px] text-[var(--color-text-muted)]">{t('trainerNotes.program.noProgram')}</p>
              </div>
            )}
          </div>

          {/* Available programs to assign */}
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList className="w-4 h-4 text-[var(--color-accent)]" />
              <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.program.availablePrograms')}</span>
            </div>

            {availablePrograms.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-muted)]">{t('trainerNotes.program.noProgramsAvailable')}</p>
            ) : (
              <div className="space-y-2">
                {availablePrograms.map((prog) => {
                  const isAssigned = client.assigned_program_id === prog.id;
                  return (
                    <div
                      key={prog.id}
                      className={`flex items-center justify-between py-3 px-4 rounded-xl transition-colors ${
                        isAssigned
                          ? 'bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20'
                          : 'bg-[var(--color-bg-secondary)]/60 hover:bg-[var(--color-bg-secondary)]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">{prog.name}</p>
                        <p className="text-[11px] text-[var(--color-text-muted)]">
                          {prog.duration_weeks ? `${prog.duration_weeks} ${t('trainerNotes.program.weeks')}` : ''}
                          {prog.days_per_week ? ` · ${prog.days_per_week} ${t('trainerNotes.program.daysWk')}` : ''}
                        </p>
                      </div>
                      {isAssigned ? (
                        <span className="text-[11px] font-medium text-[var(--color-accent)] px-2.5 py-1 rounded-lg bg-[var(--color-accent)]/10">
                          {t('trainerNotes.program.assigned')}
                        </span>
                      ) : (
                        <button
                          onClick={() => handleAssignProgram(prog.id)}
                          disabled={assigningProgram}
                          className="text-[12px] font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-soft)] px-3 py-2 sm:py-1.5 rounded-lg border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-50 min-h-[44px] sm:min-h-[36px]"
                        >
                          {t('trainerNotes.program.assign')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-[var(--color-border-subtle)]" />

          {/* Nutrition section */}
          {!nutritionLoaded ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)] rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Active Meal Plan / Macro Targets */}
              <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                  <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                    <UtensilsCrossed className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                    {t('trainerNotes.nutrition.mealPlan', 'Assigned Meal Plan')}
                  </h3>
                  {!showMealPlanForm && (
                    <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={handleAutoGenerateMeals}
                      disabled={generatingMeals}
                      className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-soft)] px-3 py-1.5 rounded-lg border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/10 transition-colors min-h-[36px] disabled:opacity-40"
                    >
                      {generatingMeals ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                      {t('trainerNotes.nutrition.autoGenerate', 'Auto-Generate')}
                    </button>
                    <button
                      onClick={() => dispatch({ type: 'SET', payload: { showMealPlanForm: true } })}
                      className="text-[12px] font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-soft)] px-3 py-1.5 rounded-lg border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/10 transition-colors min-h-[36px]"
                    >
                      {activeMealPlan ? t('trainerNotes.nutrition.editPlan', 'Edit Plan') : t('trainerNotes.nutrition.assignPlan', 'Assign Plan')}
                    </button>
                    </div>
                  )}
                </div>

                {activeMealPlan && !showMealPlanForm ? (
                  <div className="bg-[var(--color-bg-secondary)] rounded-xl p-4 border border-[var(--color-accent)]/15">
                    <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">{activeMealPlan.name}</p>
                    {activeMealPlan.description && (
                      <p className="text-[12px] text-[var(--color-text-secondary)] mt-1">{activeMealPlan.description}</p>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                      {[
                        { label: t('trainerNotes.nutrition.cal', 'Cal'), val: activeMealPlan.target_calories, color: 'text-[var(--color-text-primary)]' },
                        { label: t('trainerNotes.nutrition.protein', 'Protein'), val: activeMealPlan.target_protein_g ? `${activeMealPlan.target_protein_g}g` : '--', color: 'text-blue-400' },
                        { label: t('trainerNotes.nutrition.carbs', 'Carbs'), val: activeMealPlan.target_carbs_g ? `${activeMealPlan.target_carbs_g}g` : '--', color: 'text-amber-400' },
                        { label: t('trainerNotes.nutrition.fat', 'Fat'), val: activeMealPlan.target_fat_g ? `${activeMealPlan.target_fat_g}g` : '--', color: 'text-rose-400' },
                      ].map((m, i) => (
                        <div key={i} className="text-center py-1 sm:py-0">
                          <p className="text-[10px] text-[var(--color-text-muted)] uppercase">{m.label}</p>
                          <p className={`text-[14px] font-semibold ${m.color}`}>{m.val || '--'}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--color-border-subtle)]">
                      <p className="text-[11px] text-[var(--color-text-muted)]">
                        {t('trainerNotes.nutrition.since', 'Since')} {format(new Date(activeMealPlan.start_date), 'MMM d, yyyy', { locale: dateFnsLocale })}
                      </p>
                      <button
                        onClick={handleDeactivateMealPlan}
                        className="text-[11px] text-red-400 hover:text-red-300 transition-colors py-2 min-h-[44px] flex items-center"
                      >
                        {t('trainerNotes.nutrition.deactivate', 'Deactivate')}
                      </button>
                    </div>
                  </div>
                ) : !showMealPlanForm ? (
                  <div className="text-center py-6">
                    <UtensilsCrossed className="w-8 h-8 text-[var(--color-text-muted)] mx-auto mb-2 opacity-40" />
                    <p className="text-[13px] text-[var(--color-text-muted)]">{t('trainerNotes.nutrition.noPlan', 'No meal plan assigned yet')}</p>
                  </div>
                ) : null}

                {/* Meal Plan Form */}
                {showMealPlanForm && (
                  <div className="bg-[var(--color-bg-secondary)] rounded-xl p-4 border border-[var(--color-border-default)] space-y-3">
                    <div>
                      <label className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide mb-1 block">{t('trainerNotes.nutrition.planName', 'Plan Name')}</label>
                      <input
                        value={mealPlanForm.name}
                        onChange={e => dispatch({ type: 'SET_MEAL_PLAN_FIELD', field: 'name', value: e.target.value })}
                        placeholder={t('trainerNotes.nutrition.planNamePlaceholder', 'e.g. Cutting Phase, Lean Bulk')}
                        className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-lg px-3 py-2.5 text-[16px] sm:text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide mb-1 block">{t('trainerNotes.nutrition.description', 'Description')}</label>
                      <textarea
                        value={mealPlanForm.description}
                        onChange={e => dispatch({ type: 'SET_MEAL_PLAN_FIELD', field: 'description', value: e.target.value })}
                        placeholder={t('trainerNotes.nutrition.descPlaceholder', 'Optional notes for the client…')}
                        className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-lg px-3 py-2.5 text-[16px] sm:text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors"
                        rows={2}
                      />
                    </div>

                    {/* Macro targets */}
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide">{t('trainerNotes.nutrition.macroTargets', 'Daily Macro Targets')}</label>
                      <button
                        onClick={handleAutoCalculate}
                        disabled={!weights.length}
                        className="text-[11px] font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-soft)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {t('trainerNotes.nutrition.autoCalc', 'Auto-Calculate')}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { key: 'calories', label: t('trainerNotes.nutrition.cal', 'Cal'), placeholder: '2200' },
                        { key: 'protein', label: t('trainerNotes.nutrition.protein', 'Protein'), placeholder: '160g' },
                        { key: 'carbs', label: t('trainerNotes.nutrition.carbs', 'Carbs'), placeholder: '250g' },
                        { key: 'fat', label: t('trainerNotes.nutrition.fat', 'Fat'), placeholder: '60g' },
                      ].map(({ key, label, placeholder }) => (
                        <div key={key}>
                          <p className="text-[10px] text-[var(--color-text-muted)] text-center mb-1">{label}</p>
                          <input
                            type="number"
                            value={mealPlanForm[key]}
                            onChange={e => dispatch({ type: 'SET_MEAL_PLAN_FIELD', field: key, value: e.target.value })}
                            placeholder={placeholder}
                            className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-lg px-2 py-2.5 text-[16px] sm:text-[13px] text-[var(--color-text-primary)] text-center placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={() => dispatch({ type: 'SET', payload: { showMealPlanForm: false } })}
                        className="flex-1 py-3 sm:py-2.5 rounded-xl border border-[var(--color-border-default)] text-[14px] sm:text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors min-h-[44px]"
                      >
                        {t('trainerNotes.nutrition.cancel', 'Cancel')}
                      </button>
                      <button
                        onClick={handleSaveMealPlan}
                        disabled={savingMealPlan || (!mealPlanForm.calories && !mealPlanForm.protein)}
                        className="flex-1 py-3 sm:py-2.5 rounded-xl bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)] text-[var(--color-text-on-accent)] text-[14px] sm:text-[13px] font-semibold transition-colors disabled:opacity-50 min-h-[44px]"
                      >
                        {savingMealPlan ? t('trainerNotes.nutrition.saving', 'Saving…') : t('trainerNotes.nutrition.savePlan', 'Save Plan')}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 7-Day Food Log Compliance */}
              <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
                <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-[var(--color-accent)]" />
                  {t('trainerNotes.nutrition.weeklyIntake', '7-Day Intake')}
                </h3>
                {foodLogSummary.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-[13px] text-[var(--color-text-muted)]">{t('trainerNotes.nutrition.noLogs', 'No food logs in the last 7 days')}</p>
                  </div>
                ) : (
                  <>
                    <div className="h-36 sm:h-40 overflow-hidden -mx-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={foodLogSummary} barGap={2}>
                          <XAxis
                            dataKey="date"
                            tickFormatter={d => format(new Date(d + 'T00:00:00'), 'EEE', { locale: dateFnsLocale })}
                            tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis hide />
                          <Tooltip
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null;
                              return (
                                <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-subtle,rgba(255,255,255,0.08))] rounded-2xl px-4 py-3 shadow-2xl shadow-black/50 backdrop-blur-sm text-[12px] min-w-[120px]">
                                  {label && <p className="text-[var(--color-text-muted)] text-[10px] font-medium uppercase tracking-wider mb-1.5 opacity-70">{format(new Date(label + 'T00:00:00'), 'EEE, MMM d', { locale: dateFnsLocale })}</p>}
                                  {payload.map((entry, i) => (
                                    <p key={entry.dataKey || i} className="font-semibold leading-snug" style={{ color: entry.color || 'var(--color-accent)' }}>
                                      {entry.name === 'calories' ? t('trainerNotes.nutrition.cal') : `${entry.name} (g)`}: {Math.round(entry.value)}
                                    </p>
                                  ))}
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="calories" fill="var(--color-accent)" radius={[4, 4, 0, 0]} maxBarSize={32} />
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
                          <div key={day.date} className="flex items-center gap-2 md:gap-3 py-2 px-2 md:px-3 rounded-xl bg-[var(--color-bg-secondary)]/60 overflow-hidden">
                            <span className="text-[11px] text-[var(--color-text-muted)] w-8 shrink-0">{format(new Date(day.date + 'T00:00:00'), 'EEE', { locale: dateFnsLocale })}</span>
                            <div className="flex-1 flex items-center gap-1.5 md:gap-3 text-[10px] md:text-[11px] min-w-0 flex-wrap">
                              <span className="text-[var(--color-text-primary)] font-medium whitespace-nowrap">{Math.round(day.calories)} {t('common:cal', 'cal')}</span>
                              <span className="text-blue-400 whitespace-nowrap">{t('trainerClientDetail.macros.gramsProtein', 'P')} {Math.round(day.protein)}g</span>
                              <span className="text-amber-400 whitespace-nowrap">{t('trainerClientDetail.macros.gramsCarbs', 'C')} {Math.round(day.carbs)}g</span>
                              <span className="text-rose-400 whitespace-nowrap">{t('trainerClientDetail.macros.gramsFat', 'F')} {Math.round(day.fat)}g</span>
                            </div>
                            {calPct !== null && (
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                                calPct >= 90 && calPct <= 110 ? 'bg-emerald-500/10 text-emerald-400'
                                : calPct < 70 ? 'bg-red-500/10 text-red-400'
                                : 'bg-amber-500/10 text-amber-400'
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
              </div>

              {/* Compliance Summary */}
              {foodLogSummary.length > 0 && (activeMealPlan || nutritionTargets) && (
                <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
                  <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[var(--color-accent)]" />
                    {t('trainerNotes.nutrition.compliance', 'Compliance')}
                  </h3>
                  {(() => {
                    const targets = activeMealPlan || nutritionTargets;
                    const calTarget = targets?.target_calories || targets?.daily_calories;
                    if (!calTarget) return <p className="text-[13px] text-[var(--color-text-muted)]">{t('trainerNotes.nutrition.noTargetsSet', 'No targets set to compare against')}</p>;
                    const onTrack = foodLogSummary.filter(d => {
                      const pct = (d.calories / calTarget) * 100;
                      return pct >= 85 && pct <= 115;
                    }).length;
                    const daysLogged = foodLogSummary.length;
                    const compliancePct = Math.round((onTrack / daysLogged) * 100);
                    return (
                      <div className="grid grid-cols-3 gap-2 sm:gap-3">
                        <div className="text-center bg-[var(--color-bg-secondary)] rounded-xl py-2.5 sm:py-3 px-1">
                          <p className="text-[9px] sm:text-[10px] text-[var(--color-text-muted)] uppercase mb-0.5">{t('trainerNotes.nutrition.daysLogged', 'Days Logged')}</p>
                          <p className="text-[16px] sm:text-[18px] font-bold text-[var(--color-text-primary)]">{daysLogged}<span className="text-[11px] sm:text-[12px] text-[var(--color-text-muted)]">/7</span></p>
                        </div>
                        <div className="text-center bg-[var(--color-bg-secondary)] rounded-xl py-2.5 sm:py-3 px-1">
                          <p className="text-[9px] sm:text-[10px] text-[var(--color-text-muted)] uppercase mb-0.5">{t('trainerNotes.nutrition.onTarget', 'On Target')}</p>
                          <p className="text-[16px] sm:text-[18px] font-bold text-emerald-400">{onTrack}<span className="text-[11px] sm:text-[12px] text-[var(--color-text-muted)]">/{daysLogged}</span></p>
                        </div>
                        <div className="text-center bg-[var(--color-bg-secondary)] rounded-xl py-2.5 sm:py-3 px-1">
                          <p className="text-[9px] sm:text-[10px] text-[var(--color-text-muted)] uppercase mb-0.5">{t('trainerNotes.nutrition.compliancePct', 'Rate')}</p>
                          <p className={`text-[16px] sm:text-[18px] font-bold ${compliancePct >= 70 ? 'text-emerald-400' : compliancePct >= 40 ? 'text-amber-400' : 'text-red-400'}`}>{compliancePct}%</p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-default)] w-full max-h-[90vh] overflow-y-auto sm:max-w-md p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] sm:text-[17px] font-semibold text-[var(--color-text-primary)]">
                {t('trainerNotes.followUp.logFollowUp')}
              </h3>
              <button onClick={() => dispatch({ type: 'SET', payload: { showFollowupModal: false } })} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
                <X size={18} />
              </button>
            </div>

            {/* Method selector */}
            <label className="text-[12px] text-[var(--color-text-muted)] uppercase tracking-wide mb-1.5 block">
              {t('trainerNotes.followUp.method')}
            </label>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {[
                { value: 'call', icon: Phone, label: t('trainerNotes.followUp.methods.call') },
                { value: 'push', icon: Bell, label: t('trainerNotes.followUp.methods.push') },
                { value: 'email', icon: Mail, label: t('trainerNotes.followUp.methods.email') },
                { value: 'in_person', icon: UserCheck, label: t('trainerNotes.followUp.methods.inPerson') },
              ].map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  onClick={() => dispatch({ type: 'SET', payload: { fuMethod: value } })}
                  title={label}
                  className={`py-2.5 sm:py-2 rounded-lg flex flex-col items-center gap-1 text-[10px] sm:text-[11px] font-medium transition-colors min-h-[44px] ${
                    fuMethod === value
                      ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/30'
                      : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border-subtle)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>

            {/* Outcome */}
            <label className="text-[12px] text-[var(--color-text-muted)] uppercase tracking-wide mb-1.5 block">
              {t('trainerNotes.followUp.outcomeLabel')}
            </label>
            <select
              value={fuOutcome}
              onChange={(e) => dispatch({ type: 'SET', payload: { fuOutcome: e.target.value } })}
              className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2.5 text-[16px] sm:text-[14px] text-[var(--color-text-primary)] mb-4 focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors min-h-[44px]"
            >
              <option value="no_answer">{t('trainerNotes.followUp.outcomes.noAnswer')}</option>
              <option value="rescheduled">{t('trainerNotes.followUp.outcomes.rescheduled')}</option>
              <option value="coming_back">{t('trainerNotes.followUp.outcomes.comingBack')}</option>
              <option value="not_interested">{t('trainerNotes.followUp.outcomes.notInterested')}</option>
              <option value="other">{t('trainerNotes.followUp.outcomes.other')}</option>
            </select>

            {/* Note */}
            <label className="text-[12px] text-[var(--color-text-muted)] uppercase tracking-wide mb-1.5 block">
              {t('trainerNotes.followUp.noteLabel')}
            </label>
            <textarea
              value={fuNote}
              onChange={(e) => dispatch({ type: 'SET', payload: { fuNote: e.target.value } })}
              placeholder={t('trainerNotes.followUp.notePlaceholder')}
              className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg p-3 text-[14px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors mb-4"
              rows={3}
            />

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => dispatch({ type: 'SET', payload: { showFollowupModal: false } })}
                className="flex-1 py-3 sm:py-2.5 rounded-xl border border-[var(--color-border-default)] text-[14px] sm:text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors min-h-[44px]"
              >
                {t('trainerNotes.followUp.cancel')}
              </button>
              <button
                onClick={handleSaveFollowup}
                disabled={savingFollowup}
                className="flex-1 py-3 sm:py-2.5 rounded-xl bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)] text-[var(--color-text-on-accent)] text-[14px] sm:text-[13px] font-semibold transition-colors disabled:opacity-50 min-h-[44px]"
              >
                {savingFollowup ? t('trainerNotes.followUp.saving') : t('trainerNotes.followUp.save')}
              </button>
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
