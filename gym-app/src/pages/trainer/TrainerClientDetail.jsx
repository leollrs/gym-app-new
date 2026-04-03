import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Save, Scale, Ruler, TrendingUp, StickyNote, Calendar, BarChart3,
  MessageSquare, Bell, Phone, Mail, UserCheck, Plus, X, Dumbbell, Trophy,
  Target, Activity, Clock, AlertTriangle, BookOpen, ChevronRight, Flame,
  ClipboardList, Heart, Zap, RefreshCw, Apple, Camera, MapPin, UtensilsCrossed,
  Loader2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { format, subWeeks, subDays, startOfWeek, differenceInWeeks } from 'date-fns';
import { useTranslation } from 'react-i18next';
import UnderlineTabs from '../../components/UnderlineTabs';
import MonthlyProgressReport from '../../components/MonthlyProgressReport';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { calculateMacros } from '../../lib/macroCalculator';
import { generateDayPlan } from '../../lib/mealPlanner';

const TAB_KEYS = ['overview', 'progress', 'notes', 'followUp', 'program', 'nutrition'];

export default function TrainerClientNotes() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { t } = useTranslation('pages');

  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [client, setClient] = useState(null);
  const [stats, setStats] = useState({ count: 0, volume: 0 });
  const [programName, setProgramName] = useState(null);
  const [notesData, setNotesData] = useState({ notes: '', preferences: '', injuries: '', goalReminders: '' });
  const [notesSaved, setNotesSaved] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [weights, setWeights] = useState([]);
  const [measurements, setMeasurements] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [streak, setStreak] = useState(null);
  const [followups, setFollowups] = useState([]);
  const [showFollowupModal, setShowFollowupModal] = useState(false);
  const [fuMethod, setFuMethod] = useState('call');
  const [fuNote, setFuNote] = useState('');
  const [fuOutcome, setFuOutcome] = useState('no_answer');
  const [savingFollowup, setSavingFollowup] = useState(false);

  // New state for 5-tab structure
  const [recentSessions, setRecentSessions] = useState([]);
  const [personalRecords, setPersonalRecords] = useState([]);
  const [weeklyWorkouts, setWeeklyWorkouts] = useState([]);
  const [onboarding, setOnboarding] = useState(null);
  const [enrollment, setEnrollment] = useState(null);
  const [availablePrograms, setAvailablePrograms] = useState([]);
  const [assigningProgram, setAssigningProgram] = useState(false);
  const [workoutsThisWeek, setWorkoutsThisWeek] = useState(0);

  // Nutrition tab state
  const [nutritionTargets, setNutritionTargets] = useState(null);
  const [foodLogSummary, setFoodLogSummary] = useState([]);
  const [activeMealPlan, setActiveMealPlan] = useState(null);
  const [savingMealPlan, setSavingMealPlan] = useState(false);
  const [mealPlanForm, setMealPlanForm] = useState({ calories: '', protein: '', carbs: '', fat: '', name: '', description: '' });
  const [showMealPlanForm, setShowMealPlanForm] = useState(false);
  const [nutritionLoaded, setNutritionLoaded] = useState(false);
  const [sampleMeals, setSampleMeals] = useState(null);
  const [generatingMeals, setGeneratingMeals] = useState(false);

  // Progress photos + check-ins
  const [progressPhotos, setProgressPhotos] = useState([]);
  const [checkIns, setCheckIns] = useState([]);

  useEffect(() => { document.title = t('trainerNotes.pageTitle'); }, [t]);

  useEffect(() => {
    if (clientId && profile?.id) {
      loadClientData();
    }
  }, [clientId, profile?.id]);

  useEffect(() => {
    if (activeTab === 'nutrition' && clientId && profile?.id) {
      loadNutritionData();
    }
  }, [activeTab, clientId, profile?.id]);

  async function loadClientData() {
    setLoading(true);
    setAccessDenied(false);
    try {
      // Verify this client is assigned to the current trainer
      const { data: assignment } = await supabase
        .from('trainer_clients')
        .select('id, notes')
        .eq('trainer_id', profile.id)
        .eq('client_id', clientId)
        .eq('gym_id', profile.gym_id)
        .eq('is_active', true)
        .maybeSingle();

      if (!assignment) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
      const eightWeeksAgo = subWeeks(new Date(), 8).toISOString();

      const [
        clientRes, statsRes, weightsRes, measRes, streakRes, followupsRes,
        recentRes, prsRes, weeklyRes, onbRes, thisWeekRes,
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, username, last_active_at, created_at, assigned_program_id')
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
          .select('current_streak, last_workout_date')
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

      if (clientRes.data) {
        setClient(clientRes.data);
        if (clientRes.data.assigned_program_id) {
          const { data: prog } = await supabase
            .from('gym_programs')
            .select('name')
            .eq('id', clientRes.data.assigned_program_id)
            .single();
          if (prog) setProgramName(prog.name);

          // Load enrollment
          const { data: enr } = await supabase
            .from('gym_program_enrollments')
            .select('started_at, gym_programs(name, duration_weeks, days_per_week)')
            .eq('profile_id', clientId)
            .eq('program_id', clientRes.data.assigned_program_id)
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          setEnrollment(enr);
        }
      }

      if (statsRes.data) {
        const totalVolume = statsRes.data.reduce((sum, s) => sum + (s.total_volume_lbs || 0), 0);
        setStats({ count: statsRes.data.length, volume: totalVolume });
      }

      // Parse notes - gracefully handle plain string vs JSON
      if (assignment.notes) {
        try {
          const parsed = JSON.parse(assignment.notes);
          if (typeof parsed === 'object' && parsed !== null) {
            setNotesData({
              notes: parsed.notes || '',
              preferences: parsed.preferences || '',
              injuries: parsed.injuries || '',
              goalReminders: parsed.goalReminders || '',
            });
          } else {
            setNotesData({ notes: assignment.notes, preferences: '', injuries: '', goalReminders: '' });
          }
        } catch {
          // Plain string - treat as main notes
          setNotesData({ notes: assignment.notes, preferences: '', injuries: '', goalReminders: '' });
        }
      }

      setWeights(weightsRes.data || []);
      setMeasurements(measRes.data?.[0] || null);
      setStreak(streakRes.data || null);
      setFollowups(followupsRes.data || []);
      setRecentSessions(recentRes.data || []);
      setPersonalRecords(prsRes.data || []);
      setOnboarding(onbRes.data || null);
      setWorkoutsThisWeek(thisWeekRes.data?.length || 0);

      // Process weekly workout data for chart
      if (weeklyRes.data) {
        const weekMap = {};
        for (let i = 7; i >= 0; i--) {
          const wk = startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 });
          const key = format(wk, 'MMM d');
          weekMap[key] = 0;
        }
        weeklyRes.data.forEach((s) => {
          const wk = startOfWeek(new Date(s.started_at), { weekStartsOn: 1 });
          const key = format(wk, 'MMM d');
          if (weekMap[key] !== undefined) weekMap[key]++;
        });
        setWeeklyWorkouts(Object.entries(weekMap).map(([week, count]) => ({ week, count })));
      }

      // Load available programs, progress photos, and check-ins in parallel
      const [progsRes, photosRes, checkInsRes] = await Promise.all([
        supabase
          .from('gym_programs')
          .select('id, name, duration_weeks, days_per_week')
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
      ]);
      setAvailablePrograms(progsRes.data || []);
      // Pre-resolve signed URLs for private progress photos
      const photosWithUrls = await Promise.all(
        (photosRes.data || []).map(async (photo) => {
          const { data: urlData } = await supabase.storage
            .from('progress-photos')
            .createSignedUrl(photo.storage_path, 3600);
          return { ...photo, signedUrl: urlData?.signedUrl || '' };
        })
      );
      setProgressPhotos(photosWithUrls);
      setCheckIns(checkInsRes.data || []);
    } catch (err) {
      logger.error('Error loading client data:', err);
    } finally {
      setLoading(false);
    }
  }

  // Lazy-load nutrition data when the tab is opened
  async function loadNutritionData() {
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

      setNutritionTargets(targetsRes.data || null);
      setActiveMealPlan(mealPlanRes.data || null);

      // Aggregate food logs by day
      const dayMap = {};
      (logsRes.data || []).forEach(log => {
        if (!dayMap[log.log_date]) dayMap[log.log_date] = { date: log.log_date, calories: 0, protein: 0, carbs: 0, fat: 0 };
        dayMap[log.log_date].calories += Number(log.calories) || 0;
        dayMap[log.log_date].protein += Number(log.protein_g) || 0;
        dayMap[log.log_date].carbs += Number(log.carbs_g) || 0;
        dayMap[log.log_date].fat += Number(log.fat_g) || 0;
      });
      setFoodLogSummary(Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date)));

      // Pre-fill meal plan form from active plan
      if (mealPlanRes.data) {
        setMealPlanForm({
          calories: mealPlanRes.data.target_calories?.toString() || '',
          protein: mealPlanRes.data.target_protein_g?.toString() || '',
          carbs: mealPlanRes.data.target_carbs_g?.toString() || '',
          fat: mealPlanRes.data.target_fat_g?.toString() || '',
          name: mealPlanRes.data.name || '',
          description: mealPlanRes.data.description || '',
        });
      }
      setNutritionLoaded(true);
    } catch (err) {
      logger.error('Error loading nutrition data:', err);
    }
  }

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
    setMealPlanForm(prev => ({
      ...prev,
      calories: result.calories.toString(),
      protein: result.protein.toString(),
      carbs: result.carbs.toString(),
      fat: result.fat.toString(),
      name: prev.name || `${goal.replace(/_/g, ' ')} plan`.replace(/\b\w/g, c => c.toUpperCase()),
    }));
    return result;
  }

  // Auto-generate full meal plan with sample meals
  async function handleAutoGenerateMeals() {
    setGeneratingMeals(true);
    try {
      const macros = handleAutoCalculate();
      if (!macros) { setGeneratingMeals(false); return; }

      const plan = generateDayPlan({
        targets: macros,
        slots: 3,
        favorites: [],
        excludeIds: [],
      });

      if (plan?.meals) {
        setSampleMeals(plan.meals);
        const mealDesc = plan.meals.map(m => `${m.type || t('trainerNotes.nutrition.meal')}: ${m.name} (${Math.round(m.calories)} cal)`).join('\n');
        setMealPlanForm(prev => ({
          ...prev,
          description: `${t('trainerNotes.nutrition.sampleDay')}:\n${mealDesc}`,
        }));
      }
      setShowMealPlanForm(true);
    } catch (err) {
      logger.error('Error generating meal plan:', err);
    } finally {
      setGeneratingMeals(false);
    }
  }

  async function handleSaveMealPlan() {
    if (!profile?.id || savingMealPlan) return;
    setSavingMealPlan(true);
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
      setActiveMealPlan(data);
      setShowMealPlanForm(false);
    } catch (err) {
      logger.error('Error saving meal plan:', err);
    } finally {
      setSavingMealPlan(false);
    }
  }

  async function handleDeactivateMealPlan() {
    if (!activeMealPlan) return;
    try {
      await supabase
        .from('trainer_meal_plans')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', activeMealPlan.id);
      setActiveMealPlan(null);
      setMealPlanForm({ calories: '', protein: '', carbs: '', fat: '', name: '', description: '' });
    } catch (err) {
      logger.error('Error deactivating meal plan:', err);
    }
  }

  async function handleSaveNotes() {
    if (!profile?.id) return;
    setSavingNotes(true);
    try {
      const serialized = JSON.stringify(notesData);
      await supabase.from('trainer_clients').upsert({
        gym_id: profile.gym_id,
        trainer_id: profile.id,
        client_id: clientId,
        notes: serialized,
      }, { onConflict: 'trainer_id,client_id' });
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch (err) {
      logger.error('Error saving notes:', err);
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleSaveFollowup() {
    if (!profile?.id) return;
    setSavingFollowup(true);
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
      setFollowups(prev => [data, ...prev]);
      setShowFollowupModal(false);
      setFuNote('');
      setFuMethod('call');
      setFuOutcome('no_answer');
    } catch (err) {
      logger.error('Error saving followup:', err);
    } finally {
      setSavingFollowup(false);
    }
  }

  async function handleAssignProgram(programId) {
    if (!profile?.id || assigningProgram) return;
    setAssigningProgram(true);
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
      setAssigningProgram(false);
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
    rescheduled: { label: t('trainerNotes.followUp.outcomes.rescheduled'), color: 'text-blue-400', bg: 'bg-blue-500/10' },
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

  // Program progress
  const programProgress = useMemo(() => {
    if (!enrollment?.gym_programs || !enrollment.started_at) return null;
    const { duration_weeks, days_per_week, name } = enrollment.gym_programs;
    const started = new Date(enrollment.started_at);
    const now = new Date();
    const currentWeek = Math.min(Math.max(differenceInWeeks(now, started) + 1, 1), duration_weeks || 1);
    const totalWeeks = duration_weeks || 0;
    const progressPct = totalWeeks > 0 ? Math.round((currentWeek / totalWeeks) * 100) : 0;
    return { name, currentWeek, totalWeeks, daysPerWeek: days_per_week || 3, progressPct };
  }, [enrollment]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-primary)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
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

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] px-4 md:px-6 py-6 max-w-5xl mx-auto pb-28 md:pb-12">
      {/* Back button */}
      <button
        onClick={() => navigate('/trainer/clients')}
        className="flex items-center gap-2 text-[var(--color-text-secondary)] text-[14px] mb-6 hover:text-[var(--color-text-primary)] transition-colors whitespace-nowrap"
      >
        <ArrowLeft className="w-4 h-4 flex-shrink-0" />
        {t('trainerNotes.backToClients')}
      </button>

      {/* Client header with badges */}
      <div className="mb-4">
        <h1 className="text-[22px] font-bold text-[var(--color-text-primary)] truncate">
          {client.full_name || t('trainerNotes.unnamedClient')}
        </h1>
        {client.username && (
          <p className="text-[13px] text-[var(--color-text-muted)] mt-0.5">@{client.username}</p>
        )}
        {/* Status badges */}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {streak && streak.current_streak >= 7 && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
              {streak.current_streak} {t('trainerNotes.dayStreak')}
            </span>
          )}
          {onboarding?.fitness_level && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/[0.06] text-[var(--color-text-secondary)] capitalize">
              {onboarding.fitness_level}
            </span>
          )}
          {programName && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
              {programName}
            </span>
          )}
          {getDaysSince(client.last_active_at) > 14 && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">
              {t('trainerNotes.atRisk')}
            </span>
          )}
        </div>
      </div>

      {/* Quick actions row */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => { setActiveTab('followUp'); setShowFollowupModal(true); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[#D4AF37]/30 transition-colors whitespace-nowrap min-h-[44px]"
        >
          <Phone className="w-3.5 h-3.5" />
          {t('trainerNotes.actions.logFollowUp')}
        </button>
        <button
          onClick={() => setActiveTab('program')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[#D4AF37]/30 transition-colors whitespace-nowrap min-h-[44px]"
        >
          <BookOpen className="w-3.5 h-3.5" />
          {t('trainerNotes.actions.assignProgram')}
        </button>
        <button
          onClick={() => setShowReport(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[#D4AF37]/30 transition-colors whitespace-nowrap min-h-[44px]"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          {t('trainerNotes.actions.monthlyReport')}
        </button>
        <button
          onClick={async () => {
            try {
              const { data: convId } = await supabase.rpc('get_or_create_conversation', { p_other_user: clientId });
              if (convId) navigate(`/trainer/messages/${convId}`);
            } catch (err) { logger.error('Error opening conversation:', err); }
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[#D4AF37]/30 transition-colors whitespace-nowrap min-h-[44px]"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          {t('trainerNotes.actions.messageClient', 'Message')}
        </button>
        <button
          onClick={() => setActiveTab('nutrition')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[#D4AF37]/30 transition-colors whitespace-nowrap min-h-[44px]"
        >
          <UtensilsCrossed className="w-3.5 h-3.5" />
          {t('trainerNotes.actions.mealPlan', 'Meal Plan')}
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-6">
        <div className="bg-[var(--color-bg-card)] rounded-xl border border-[var(--color-border-subtle)] px-3 py-2.5">
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide">{t('trainerNotes.strip.lastActive')}</p>
          <p className="text-[14px] font-semibold text-[var(--color-text-primary)] truncate">
            {client.last_active_at ? format(new Date(client.last_active_at), 'MMM d') : '--'}
          </p>
        </div>
        <div className="bg-[var(--color-bg-card)] rounded-xl border border-[var(--color-border-subtle)] px-3 py-2.5">
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide">{t('trainerNotes.strip.thisWeek')}</p>
          <p className="text-[14px] font-semibold text-[var(--color-text-primary)]">{workoutsThisWeek}</p>
        </div>
        <div className="bg-[var(--color-bg-card)] rounded-xl border border-[var(--color-border-subtle)] px-3 py-2.5">
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide">{t('trainerNotes.strip.streak')}</p>
          <p className="text-[14px] font-semibold text-[var(--color-text-primary)]">{streak ? streak.current_streak : 0} <span className="text-[11px] font-normal text-[var(--color-text-muted)]">{t('trainerNotes.strip.days')}</span></p>
        </div>
        <div className="bg-[var(--color-bg-card)] rounded-xl border border-[var(--color-border-subtle)] px-3 py-2.5">
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide">{t('trainerNotes.strip.totalWorkouts')}</p>
          <p className="text-[14px] font-semibold text-[var(--color-text-primary)]">{stats.count}</p>
        </div>
        <div className="bg-[var(--color-bg-card)] rounded-xl border border-[var(--color-border-subtle)] px-3 py-2.5 col-span-2 md:col-span-1">
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide">{t('trainerNotes.strip.adherence')}</p>
          <p className="text-[14px] font-semibold text-[var(--color-text-primary)]">{adherencePercent}%</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="mb-6 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <UnderlineTabs
          tabs={TAB_KEYS.map(key => ({ key, label: t(`trainerNotes.tabs.${key}`) }))}
          activeIndex={TAB_KEYS.indexOf(activeTab)}
          onChange={i => setActiveTab(TAB_KEYS[i])}
        />
      </div>

      {/* ===================== TAB 1: OVERVIEW ===================== */}
      {activeTab === 'overview' && (
        <div className="space-y-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
          {/* Client summary */}
          {onboarding && (
            <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4 md:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-[var(--color-accent)]" />
                <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.overview.clientSummary')}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {onboarding.primary_goal && (
                  <div className="bg-[var(--color-bg-secondary)]/60 rounded-xl px-3 py-2.5">
                    <p className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide">{t('trainerNotes.overview.goal')}</p>
                    <p className="text-[13px] text-[var(--color-text-primary)] capitalize mt-0.5">{onboarding.primary_goal.replace(/_/g, ' ')}</p>
                  </div>
                )}
                {onboarding.fitness_level && (
                  <div className="bg-[var(--color-bg-secondary)]/60 rounded-xl px-3 py-2.5">
                    <p className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide">{t('trainerNotes.overview.fitnessLevel')}</p>
                    <p className="text-[13px] text-[var(--color-text-primary)] capitalize mt-0.5">{onboarding.fitness_level}</p>
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

          {/* Recent activity */}
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
                        {format(new Date(s.started_at), 'MMM d')}
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
                          : s.total_volume_lbs || 0} lbs
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Current program */}
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4 text-[var(--color-accent)]" />
              <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.overview.currentProgram')}</span>
            </div>
            <p className="text-[14px] text-[var(--color-text-primary)]">
              {programName || t('trainerNotes.overview.noProgram')}
            </p>
            {programProgress && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-[11px] text-[var(--color-text-muted)] mb-1">
                  <span>{t('trainerNotes.program.week')} {programProgress.currentWeek} / {programProgress.totalWeeks}</span>
                  <span>{programProgress.progressPct}%</span>
                </div>
                <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--color-accent)] rounded-full transition-all"
                    style={{ width: `${programProgress.progressPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Recent wins (PRs) */}
          {personalRecords.length > 0 && (
            <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="w-4 h-4 text-[var(--color-accent)]" />
                <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.overview.recentWins')}</span>
              </div>
              <div className="space-y-2">
                {personalRecords.slice(0, 3).map((pr, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-3 rounded-xl bg-[var(--color-bg-secondary)]/60">
                    <div className="min-w-0">
                      <p className="text-[13px] text-[var(--color-text-primary)] truncate">{pr.exercises?.name || t('trainerNotes.overview.unknownExercise')}</p>
                      <p className="text-[11px] text-[var(--color-text-muted)]">{format(new Date(pr.achieved_at), 'MMM d')}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[13px] font-semibold text-[var(--color-accent)]">{pr.weight_lbs} lbs x {pr.reps}</p>
                      {pr.estimated_1rm && (
                        <p className="text-[10px] text-[var(--color-text-muted)]">1RM: {Math.round(pr.estimated_1rm)} lbs</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Monthly Report */}
          <button
            onClick={() => setShowReport(true)}
            className="w-full bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4 flex items-center gap-3 hover:border-[#D4AF37]/30 transition-colors min-h-[44px] md:col-span-2"
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

      {/* ===================== TAB 2: PROGRESS ===================== */}
      {activeTab === 'progress' && (
        <div className="space-y-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
          {/* Training trend chart */}
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4 md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-[var(--color-accent)]" />
              <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.progress.trainingTrend')}</span>
            </div>
            {weeklyWorkouts.length > 0 ? (
              <div className="h-[180px] overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weeklyWorkouts}>
                    <defs>
                      <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#D4AF37" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#D4AF37" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="week"
                      tick={{ fill: '#6B7280', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: '#6B7280', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={24}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#111827',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '12px',
                        fontSize: '12px',
                        color: '#E5E7EB',
                      }}
                      labelStyle={{ color: '#9CA3AF' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#D4AF37"
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

          {/* Weight history */}
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Scale className="w-5 h-5 text-[var(--color-accent)]" />
              <span className="text-[16px] font-semibold text-[var(--color-text-primary)]">{t('trainerNotes.progress.weightHistory')}</span>
              {weights.length > 0 && (
                <span className="text-[12px] text-[var(--color-text-muted)] ml-auto">{weights.length} {t('trainerNotes.progress.entries')}</span>
              )}
            </div>
            {weights.length === 0 ? (
              <p className="text-[14px] text-[var(--color-text-muted)]">{t('trainerNotes.progress.noWeightLogs')}</p>
            ) : (
              <>
                <div className="bg-[var(--color-bg-secondary)] rounded-xl p-4 mb-4 border border-[#D4AF37]/15">
                  <p className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide mb-1">{t('trainerNotes.progress.latestWeight')}</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[24px] font-bold text-[var(--color-text-primary)]">{weights[0].weight_lbs}</span>
                    <span className="text-[14px] text-[var(--color-text-muted)]">lbs</span>
                    {weights.length >= 2 && (
                      <span className={`text-[13px] font-medium ml-2 ${
                        weights[0].weight_lbs - weights[1].weight_lbs > 0
                          ? 'text-[#EF4444]'
                          : weights[0].weight_lbs - weights[1].weight_lbs < 0
                            ? 'text-[#10B981]'
                            : 'text-[var(--color-text-muted)]'
                      }`}>
                        {weights[0].weight_lbs - weights[1].weight_lbs > 0 ? '+' : ''}
                        {(weights[0].weight_lbs - weights[1].weight_lbs).toFixed(1)} lbs
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-[var(--color-text-muted)] mt-1">
                    {format(new Date(weights[0].logged_at), 'EEEE, MMM d, yyyy')}
                  </p>
                </div>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {weights.slice(1, 15).map((w, i) => {
                    const prev = weights[i + 2];
                    const diff = prev ? (w.weight_lbs - prev.weight_lbs).toFixed(1) : null;
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between py-3 px-4 rounded-xl bg-[var(--color-bg-secondary)]/60"
                      >
                        <span className="text-[14px] text-[var(--color-text-secondary)]">
                          {format(new Date(w.logged_at), 'MMM d, yyyy')}
                        </span>
                        <div className="flex items-center gap-3">
                          {diff && parseFloat(diff) !== 0 && (
                            <span className={`text-[12px] ${parseFloat(diff) > 0 ? 'text-[#EF4444]' : 'text-[#10B981]'}`}>
                              {parseFloat(diff) > 0 ? '+' : ''}{diff}
                            </span>
                          )}
                          <span className="text-[16px] font-semibold text-[var(--color-text-primary)]">
                            {w.weight_lbs} <span className="text-[12px] font-normal text-[var(--color-text-muted)]">lbs</span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Body measurements */}
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Ruler className="w-4 h-4 text-[var(--color-accent)]" />
              <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.progress.bodyMeasurements')}</span>
            </div>
            {!measurements ? (
              <p className="text-[13px] text-[var(--color-text-muted)]">{t('trainerNotes.progress.noMeasurements')}</p>
            ) : (
              <div className="space-y-1.5">
                {measurements.measured_at && (
                  <p className="text-[11px] text-[var(--color-text-muted)] mb-2">
                    {t('trainerNotes.progress.measuredOn')} {format(new Date(measurements.measured_at), 'MMM d, yyyy')}
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
                        {m.value} cm
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Personal Records list */}
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
                      <p className="text-[11px] text-[var(--color-text-muted)]">{format(new Date(pr.achieved_at), 'MMM d, yyyy')}</p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">{pr.weight_lbs} lbs x {pr.reps}</p>
                      {pr.estimated_1rm && (
                        <p className="text-[11px] text-[var(--color-accent)]">1RM: {Math.round(pr.estimated_1rm)} lbs</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Progress Photos */}
          {progressPhotos.length > 0 && (
            <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4 md:col-span-2">
              <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
                <Camera className="w-4 h-4 text-[var(--color-accent)]" />
                {t('trainerNotes.progress.photos', 'Progress Photos')}
              </h3>
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {progressPhotos.map(photo => {
                  return (
                    <div key={photo.id} className="aspect-square rounded-xl overflow-hidden bg-[var(--color-bg-secondary)] relative">
                      <img
                        src={photo.signedUrl}
                        alt={photo.view_angle || t('trainerNotes.progress.progressAlt')}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <span className="absolute bottom-1 left-1 text-[9px] font-medium bg-black/60 text-white px-1.5 py-0.5 rounded">
                        {format(new Date(photo.taken_at), 'MMM d')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Gym Check-ins */}
          {checkIns.length > 0 && (
            <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4 md:col-span-2">
              <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[var(--color-accent)]" />
                {t('trainerNotes.progress.checkIns', 'Gym Check-ins')}
                <span className="text-[11px] font-normal text-[var(--color-text-muted)]">({t('trainerNotes.progress.last30', 'Last 30')})</span>
              </h3>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {checkIns.map(ci => {
                  const methodLabel = ci.method === 'qr' ? 'QR' : ci.method === 'gps' ? 'GPS' : t('trainerNotes.progress.manual', 'Manual');
                  return (
                    <div key={ci.id} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-[var(--color-bg-secondary)]/60">
                      <p className="text-[12px] text-[var(--color-text-primary)]">{format(new Date(ci.checked_in_at), 'EEE, MMM d · h:mm a')}</p>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/[0.06] text-[var(--color-text-secondary)]">{methodLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================== TAB 3: NOTES ===================== */}
      {activeTab === 'notes' && (
        <div className="space-y-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
          {/* Main coach notes */}
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <StickyNote className="w-4 h-4 text-[var(--color-accent)]" />
              <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.notes.coachNotes')}</span>
            </div>
            <textarea
              value={notesData.notes}
              onChange={(e) => {
                if (e.target.value.length <= 2000) {
                  setNotesData(prev => ({ ...prev, notes: e.target.value }));
                }
              }}
              placeholder={t('trainerNotes.notes.notesPlaceholder')}
              className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg p-3 text-[14px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
              rows={6}
            />
            <span className="text-[11px] text-[var(--color-text-muted)] mt-1 block">
              {notesData.notes.length} / 2000
            </span>
          </div>

          {/* Preferences */}
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Heart className="w-4 h-4 text-[var(--color-accent)]" />
              <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.notes.preferences')}</span>
            </div>
            <textarea
              value={notesData.preferences}
              onChange={(e) => {
                if (e.target.value.length <= 1000) {
                  setNotesData(prev => ({ ...prev, preferences: e.target.value }));
                }
              }}
              placeholder={t('trainerNotes.notes.preferencesPlaceholder')}
              className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg p-3 text-[14px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
              rows={3}
            />
          </div>

          {/* Injuries / Limitations */}
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.notes.injuriesLimitations')}</span>
            </div>
            <textarea
              value={notesData.injuries}
              onChange={(e) => {
                if (e.target.value.length <= 1000) {
                  setNotesData(prev => ({ ...prev, injuries: e.target.value }));
                }
              }}
              placeholder={t('trainerNotes.notes.injuriesPlaceholder')}
              className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg p-3 text-[14px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
              rows={3}
            />
          </div>

          {/* Goal Reminders */}
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-[var(--color-accent)]" />
              <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.notes.goalReminders')}</span>
            </div>
            <textarea
              value={notesData.goalReminders}
              onChange={(e) => {
                if (e.target.value.length <= 1000) {
                  setNotesData(prev => ({ ...prev, goalReminders: e.target.value }));
                }
              }}
              placeholder={t('trainerNotes.notes.goalRemindersPlaceholder')}
              className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg p-3 text-[14px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
              rows={3}
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
      )}

      {/* ===================== TAB 4: FOLLOW-UP ===================== */}
      {activeTab === 'followUp' && (
        <div className="space-y-4">
          {/* Log Follow-Up button */}
          <button
            onClick={() => setShowFollowupModal(true)}
            className="w-full flex items-center justify-center gap-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)] text-[var(--color-text-on-accent)] text-[14px] font-semibold px-4 py-3 rounded-xl transition-colors min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            {t('trainerNotes.followUp.logFollowUp')}
          </button>

          {/* Follow-up history */}
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
                            {format(new Date(fu.created_at), 'MMM d, yyyy h:mm a')}
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

      {/* ===================== TAB 5: PROGRAM ===================== */}
      {activeTab === 'program' && (
        <div className="space-y-4">
          {/* Current assigned program */}
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="w-4 h-4 text-[var(--color-accent)]" />
              <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('trainerNotes.program.currentProgram')}</span>
            </div>

            {programName ? (
              <div>
                <div className="bg-[var(--color-bg-secondary)] rounded-xl p-4 border border-[#D4AF37]/15">
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
                  onClick={() => {
                    // Clear current program assignment
                    handleAssignProgram(null);
                  }}
                  className="mt-3 text-[12px] text-red-400 hover:text-red-300 transition-colors"
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

          {/* Adherence stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
              <p className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide mb-1">{t('trainerNotes.program.totalWorkouts')}</p>
              <p className="text-[24px] font-bold text-[var(--color-text-primary)]">{stats.count}</p>
            </div>
            <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
              <p className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide mb-1">{t('trainerNotes.program.adherence')}</p>
              <p className="text-[24px] font-bold text-[var(--color-text-primary)]">{adherencePercent}%</p>
            </div>
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
                          ? 'bg-[var(--color-accent)]/10 border border-[#D4AF37]/20'
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
                          className="text-[12px] font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-soft)] px-3 py-1.5 rounded-lg border border-[#D4AF37]/30 hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-50 min-h-[36px]"
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
        </div>
      )}

      {/* ===================== TAB 6: NUTRITION ===================== */}
      {activeTab === 'nutrition' && (
        <div className="space-y-4">
          {!nutritionLoaded ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Active Meal Plan */}
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
                      className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-soft)] px-3 py-1.5 rounded-lg border border-[#D4AF37]/30 hover:bg-[var(--color-accent)]/10 transition-colors min-h-[36px] disabled:opacity-40"
                    >
                      {generatingMeals ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                      {t('trainerNotes.nutrition.autoGenerate', 'Auto-Generate')}
                    </button>
                    <button
                      onClick={() => setShowMealPlanForm(true)}
                      className="text-[12px] font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-soft)] px-3 py-1.5 rounded-lg border border-[#D4AF37]/30 hover:bg-[var(--color-accent)]/10 transition-colors min-h-[36px]"
                    >
                      {activeMealPlan ? t('trainerNotes.nutrition.editPlan', 'Edit Plan') : t('trainerNotes.nutrition.assignPlan', 'Assign Plan')}
                    </button>
                    </div>
                  )}
                </div>

                {activeMealPlan && !showMealPlanForm ? (
                  <div className="bg-[var(--color-bg-secondary)] rounded-xl p-4 border border-[#D4AF37]/15">
                    <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">{activeMealPlan.name}</p>
                    {activeMealPlan.description && (
                      <p className="text-[12px] text-[var(--color-text-secondary)] mt-1">{activeMealPlan.description}</p>
                    )}
                    <div className="grid grid-cols-4 gap-2 mt-3">
                      {[
                        { label: t('trainerNotes.nutrition.cal', 'Cal'), val: activeMealPlan.target_calories, color: 'text-[var(--color-text-primary)]' },
                        { label: t('trainerNotes.nutrition.protein', 'Protein'), val: activeMealPlan.target_protein_g ? `${activeMealPlan.target_protein_g}g` : '--', color: 'text-blue-400' },
                        { label: t('trainerNotes.nutrition.carbs', 'Carbs'), val: activeMealPlan.target_carbs_g ? `${activeMealPlan.target_carbs_g}g` : '--', color: 'text-amber-400' },
                        { label: t('trainerNotes.nutrition.fat', 'Fat'), val: activeMealPlan.target_fat_g ? `${activeMealPlan.target_fat_g}g` : '--', color: 'text-rose-400' },
                      ].map((m, i) => (
                        <div key={i} className="text-center">
                          <p className="text-[10px] text-[var(--color-text-muted)] uppercase">{m.label}</p>
                          <p className={`text-[14px] font-semibold ${m.color}`}>{m.val || '--'}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--color-border-subtle)]">
                      <p className="text-[11px] text-[var(--color-text-muted)]">
                        {t('trainerNotes.nutrition.since', 'Since')} {format(new Date(activeMealPlan.start_date), 'MMM d, yyyy')}
                      </p>
                      <button
                        onClick={handleDeactivateMealPlan}
                        className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
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
                        onChange={e => setMealPlanForm(p => ({ ...p, name: e.target.value }))}
                        placeholder={t('trainerNotes.nutrition.planNamePlaceholder', 'e.g. Cutting Phase, Lean Bulk')}
                        className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide mb-1 block">{t('trainerNotes.nutrition.description', 'Description')}</label>
                      <textarea
                        value={mealPlanForm.description}
                        onChange={e => setMealPlanForm(p => ({ ...p, description: e.target.value }))}
                        placeholder={t('trainerNotes.nutrition.descPlaceholder', 'Optional notes for the client…')}
                        className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
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
                    <div className="grid grid-cols-4 gap-2">
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
                            onChange={e => setMealPlanForm(p => ({ ...p, [key]: e.target.value }))}
                            placeholder={placeholder}
                            className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-lg px-2 py-2 text-[13px] text-[var(--color-text-primary)] text-center placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={() => setShowMealPlanForm(false)}
                        className="flex-1 py-2.5 rounded-lg border border-[var(--color-border-default)] text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors min-h-[44px]"
                      >
                        {t('trainerNotes.nutrition.cancel', 'Cancel')}
                      </button>
                      <button
                        onClick={handleSaveMealPlan}
                        disabled={savingMealPlan || (!mealPlanForm.calories && !mealPlanForm.protein)}
                        className="flex-1 py-2.5 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)] text-[var(--color-text-on-accent)] text-[13px] font-semibold transition-colors disabled:opacity-50 min-h-[44px]"
                      >
                        {savingMealPlan ? t('trainerNotes.nutrition.saving', 'Saving…') : t('trainerNotes.nutrition.savePlan', 'Save Plan')}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Client's Current Targets (self-set) */}
              {nutritionTargets && (
                <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-4">
                  <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
                    <Target className="w-4 h-4 text-[var(--color-text-secondary)]" />
                    {t('trainerNotes.nutrition.clientTargets', "Client's Own Targets")}
                  </h3>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="text-center bg-[var(--color-bg-secondary)] rounded-xl py-2.5">
                      <p className="text-[10px] text-[var(--color-text-muted)] uppercase">{t('trainerNotes.nutrition.cal', 'Cal')}</p>
                      <p className="text-[14px] font-semibold text-[var(--color-text-primary)]">{nutritionTargets.daily_calories || '--'}</p>
                    </div>
                    <div className="text-center bg-[var(--color-bg-secondary)] rounded-xl py-2.5">
                      <p className="text-[10px] text-[var(--color-text-muted)] uppercase">{t('trainerNotes.nutrition.protein', 'Protein')}</p>
                      <p className="text-[14px] font-semibold text-blue-400">{nutritionTargets.daily_protein_g ? `${nutritionTargets.daily_protein_g}g` : '--'}</p>
                    </div>
                    <div className="text-center bg-[var(--color-bg-secondary)] rounded-xl py-2.5">
                      <p className="text-[10px] text-[var(--color-text-muted)] uppercase">{t('trainerNotes.nutrition.carbs', 'Carbs')}</p>
                      <p className="text-[14px] font-semibold text-amber-400">{nutritionTargets.daily_carbs_g ? `${nutritionTargets.daily_carbs_g}g` : '--'}</p>
                    </div>
                    <div className="text-center bg-[var(--color-bg-secondary)] rounded-xl py-2.5">
                      <p className="text-[10px] text-[var(--color-text-muted)] uppercase">{t('trainerNotes.nutrition.fat', 'Fat')}</p>
                      <p className="text-[14px] font-semibold text-rose-400">{nutritionTargets.daily_fat_g ? `${nutritionTargets.daily_fat_g}g` : '--'}</p>
                    </div>
                  </div>
                </div>
              )}

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
                    <div className="h-40 overflow-hidden">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={foodLogSummary} barGap={2}>
                          <XAxis
                            dataKey="date"
                            tickFormatter={d => format(new Date(d + 'T00:00:00'), 'EEE')}
                            tick={{ fill: '#6B7280', fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis hide />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#1E293B', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12 }}
                            labelFormatter={d => format(new Date(d + 'T00:00:00'), 'EEE, MMM d')}
                            formatter={(val, name) => [Math.round(val), name === 'calories' ? t('trainerNotes.nutrition.cal') : `${name} (g)`]}
                          />
                          <Bar dataKey="calories" fill="#D4AF37" radius={[4, 4, 0, 0]} maxBarSize={32} />
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
                            <span className="text-[11px] text-[var(--color-text-muted)] w-8 shrink-0">{format(new Date(day.date + 'T00:00:00'), 'EEE')}</span>
                            <div className="flex-1 flex items-center gap-1.5 md:gap-3 text-[10px] md:text-[11px] min-w-0 flex-wrap">
                              <span className="text-[var(--color-text-primary)] font-medium whitespace-nowrap">{Math.round(day.calories)} cal</span>
                              <span className="text-blue-400 whitespace-nowrap">P {Math.round(day.protein)}g</span>
                              <span className="text-amber-400 whitespace-nowrap">C {Math.round(day.carbs)}g</span>
                              <span className="text-rose-400 whitespace-nowrap">F {Math.round(day.fat)}g</span>
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
                      <div className="grid grid-cols-3 gap-3">
                        <div className="text-center bg-[var(--color-bg-secondary)] rounded-xl py-3">
                          <p className="text-[10px] text-[var(--color-text-muted)] uppercase mb-0.5">{t('trainerNotes.nutrition.daysLogged', 'Days Logged')}</p>
                          <p className="text-[18px] font-bold text-[var(--color-text-primary)]">{daysLogged}<span className="text-[12px] text-[var(--color-text-muted)]">/7</span></p>
                        </div>
                        <div className="text-center bg-[var(--color-bg-secondary)] rounded-xl py-3">
                          <p className="text-[10px] text-[var(--color-text-muted)] uppercase mb-0.5">{t('trainerNotes.nutrition.onTarget', 'On Target')}</p>
                          <p className="text-[18px] font-bold text-emerald-400">{onTrack}<span className="text-[12px] text-[var(--color-text-muted)]">/{daysLogged}</span></p>
                        </div>
                        <div className="text-center bg-[var(--color-bg-secondary)] rounded-xl py-3">
                          <p className="text-[10px] text-[var(--color-text-muted)] uppercase mb-0.5">{t('trainerNotes.nutrition.compliancePct', 'Rate')}</p>
                          <p className={`text-[18px] font-bold ${compliancePct >= 70 ? 'text-emerald-400' : compliancePct >= 40 ? 'text-amber-400' : 'text-red-400'}`}>{compliancePct}%</p>
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

      {/* Monthly Report Modal */}
      <MonthlyProgressReport
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        profileId={clientId}
      />

      {/* Log Follow-Up Modal */}
      {showFollowupModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm md:px-4">
          <div className="bg-[var(--color-bg-card)] rounded-t-2xl md:rounded-2xl border border-[var(--color-border-default)] w-full max-h-[90vh] overflow-y-auto md:max-w-[440px] p-5 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
                {t('trainerNotes.followUp.logFollowUp')}
              </h3>
              <button onClick={() => setShowFollowupModal(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
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
                  onClick={() => setFuMethod(value)}
                  title={label}
                  className={`py-2 rounded-lg flex flex-col items-center gap-1 text-[10px] font-medium transition-colors min-h-[44px] ${
                    fuMethod === value
                      ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[#D4AF37]/30'
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
              onChange={(e) => setFuOutcome(e.target.value)}
              className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2.5 text-[14px] text-[var(--color-text-primary)] mb-4 focus:outline-none focus:border-[#D4AF37]/40 transition-colors min-h-[44px]"
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
              onChange={(e) => setFuNote(e.target.value)}
              placeholder={t('trainerNotes.followUp.notePlaceholder')}
              className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg p-3 text-[14px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[#D4AF37]/40 transition-colors mb-4"
              rows={3}
            />

            <div className="flex gap-3">
              <button
                onClick={() => setShowFollowupModal(false)}
                className="flex-1 py-2.5 rounded-lg border border-[var(--color-border-default)] text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors min-h-[44px]"
              >
                {t('trainerNotes.followUp.cancel')}
              </button>
              <button
                onClick={handleSaveFollowup}
                disabled={savingFollowup}
                className="flex-1 py-2.5 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)] text-[var(--color-text-on-accent)] text-[13px] font-semibold transition-colors disabled:opacity-50 min-h-[44px]"
              >
                {savingFollowup ? t('trainerNotes.followUp.saving') : t('trainerNotes.followUp.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
