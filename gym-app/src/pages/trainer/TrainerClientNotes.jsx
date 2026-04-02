import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Save, Scale, Ruler, TrendingUp, StickyNote, Calendar, BarChart3,
  MessageSquare, Bell, Phone, Mail, UserCheck, Plus, X, Dumbbell, Trophy,
  Target, Activity, Clock, AlertTriangle, BookOpen, ChevronRight, Flame,
  ClipboardList, Heart, Zap, RefreshCw,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { format, subWeeks, startOfWeek, differenceInWeeks } from 'date-fns';
import { useTranslation } from 'react-i18next';
import MonthlyProgressReport from '../../components/MonthlyProgressReport';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const TAB_KEYS = ['overview', 'progress', 'notes', 'followUp', 'program'];

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

  useEffect(() => { document.title = 'Trainer - Client Workspace | TuGymPR'; }, []);

  useEffect(() => {
    if (clientId && profile?.id) {
      loadClientData();
    }
  }, [clientId, profile?.id]);

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
          .select('primary_goal, fitness_level, available_equipment, injuries_notes')
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

      // Load available programs
      const { data: progs } = await supabase
        .from('gym_programs')
        .select('id, name, duration_weeks, days_per_week')
        .eq('gym_id', profile.gym_id)
        .eq('is_published', true)
        .order('name');
      setAvailablePrograms(progs || []);
    } catch (err) {
      logger.error('Error loading client data:', err);
    } finally {
      setLoading(false);
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
      // Update profile's assigned_program_id
      await supabase
        .from('profiles')
        .update({ assigned_program_id: programId })
        .eq('id', clientId);

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
    sms: MessageSquare,
    push: Bell,
    email: Mail,
    call: Phone,
    in_person: UserCheck,
  };

  const OUTCOME_STYLES = {
    no_answer: { label: t('trainerNotes.followUp.outcomes.noAnswer'), color: 'text-[#6B7280]', bg: 'bg-white/[0.04]' },
    rescheduled: { label: t('trainerNotes.followUp.outcomes.rescheduled'), color: 'text-blue-400', bg: 'bg-blue-500/10' },
    coming_back: { label: t('trainerNotes.followUp.outcomes.comingBack'), color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    not_interested: { label: t('trainerNotes.followUp.outcomes.notInterested'), color: 'text-red-400', bg: 'bg-red-500/10' },
    other: { label: t('trainerNotes.followUp.outcomes.other'), color: 'text-[#9CA3AF]', bg: 'bg-white/[0.04]' },
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
      <div className="min-h-screen bg-[#05070B] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="min-h-screen bg-[#05070B] px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl">
        <button
          onClick={() => navigate('/trainer/clients')}
          className="flex items-center gap-2 text-[#9CA3AF] text-[14px] mb-6 hover:text-[#E5E7EB] transition-colors whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4 flex-shrink-0" />
          {t('trainerNotes.backToClients')}
        </button>
        <div className="text-center py-20">
          <p className="text-[16px] font-semibold text-[#E5E7EB] mb-2">{t('trainerNotes.accessDenied')}</p>
          <p className="text-[14px] text-[#6B7280]">{t('trainerNotes.notAssigned')}</p>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="min-h-screen bg-[#05070B] px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl">
        <button
          onClick={() => navigate('/trainer/clients')}
          className="flex items-center gap-2 text-[#9CA3AF] text-[14px] mb-6 whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4 flex-shrink-0" />
          {t('trainerNotes.backToClients')}
        </button>
        <p className="text-[#9CA3AF] text-[14px]">{t('trainerNotes.clientNotFound')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05070B] px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
      {/* Back button */}
      <button
        onClick={() => navigate('/trainer/clients')}
        className="flex items-center gap-2 text-[#9CA3AF] text-[14px] mb-6 hover:text-[#E5E7EB] transition-colors whitespace-nowrap"
      >
        <ArrowLeft className="w-4 h-4 flex-shrink-0" />
        {t('trainerNotes.backToClients')}
      </button>

      {/* Client header with badges */}
      <div className="mb-4">
        <h1 className="text-[22px] font-bold text-[#E5E7EB] truncate">
          {client.full_name || t('trainerNotes.unnamedClient')}
        </h1>
        {client.username && (
          <p className="text-[13px] text-[#6B7280] mt-0.5">@{client.username}</p>
        )}
        {/* Status badges */}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {streak && streak.current_streak >= 7 && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
              {streak.current_streak} {t('trainerNotes.dayStreak')}
            </span>
          )}
          {onboarding?.fitness_level && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/[0.06] text-[#9CA3AF] capitalize">
              {onboarding.fitness_level}
            </span>
          )}
          {programName && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#D4AF37]/10 text-[#D4AF37]">
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
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button
          onClick={() => { setActiveTab('followUp'); setShowFollowupModal(true); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#0F172A] border border-white/6 text-[12px] font-medium text-[#9CA3AF] hover:text-[#D4AF37] hover:border-[#D4AF37]/30 transition-colors whitespace-nowrap min-h-[44px]"
        >
          <Phone className="w-3.5 h-3.5" />
          {t('trainerNotes.actions.logFollowUp')}
        </button>
        <button
          onClick={() => setActiveTab('program')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#0F172A] border border-white/6 text-[12px] font-medium text-[#9CA3AF] hover:text-[#D4AF37] hover:border-[#D4AF37]/30 transition-colors whitespace-nowrap min-h-[44px]"
        >
          <BookOpen className="w-3.5 h-3.5" />
          {t('trainerNotes.actions.assignProgram')}
        </button>
        <button
          onClick={() => setShowReport(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#0F172A] border border-white/6 text-[12px] font-medium text-[#9CA3AF] hover:text-[#D4AF37] hover:border-[#D4AF37]/30 transition-colors whitespace-nowrap min-h-[44px]"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          {t('trainerNotes.actions.monthlyReport')}
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-6">
        <div className="bg-[#0F172A] rounded-xl border border-white/6 px-3 py-2.5">
          <p className="text-[10px] text-[#6B7280] uppercase tracking-wide">{t('trainerNotes.strip.lastActive')}</p>
          <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">
            {client.last_active_at ? format(new Date(client.last_active_at), 'MMM d') : '--'}
          </p>
        </div>
        <div className="bg-[#0F172A] rounded-xl border border-white/6 px-3 py-2.5">
          <p className="text-[10px] text-[#6B7280] uppercase tracking-wide">{t('trainerNotes.strip.thisWeek')}</p>
          <p className="text-[14px] font-semibold text-[#E5E7EB]">{workoutsThisWeek}</p>
        </div>
        <div className="bg-[#0F172A] rounded-xl border border-white/6 px-3 py-2.5">
          <p className="text-[10px] text-[#6B7280] uppercase tracking-wide">{t('trainerNotes.strip.streak')}</p>
          <p className="text-[14px] font-semibold text-[#E5E7EB]">{streak ? streak.current_streak : 0} <span className="text-[11px] font-normal text-[#6B7280]">{t('trainerNotes.strip.days')}</span></p>
        </div>
        <div className="bg-[#0F172A] rounded-xl border border-white/6 px-3 py-2.5">
          <p className="text-[10px] text-[#6B7280] uppercase tracking-wide">{t('trainerNotes.strip.totalWorkouts')}</p>
          <p className="text-[14px] font-semibold text-[#E5E7EB]">{stats.count}</p>
        </div>
        <div className="bg-[#0F172A] rounded-xl border border-white/6 px-3 py-2.5 col-span-2 md:col-span-1">
          <p className="text-[10px] text-[#6B7280] uppercase tracking-wide">{t('trainerNotes.strip.adherence')}</p>
          <p className="text-[14px] font-semibold text-[#E5E7EB]">{adherencePercent}%</p>
        </div>
      </div>

      {/* Tab bar - horizontal pills */}
      <div className="flex gap-1.5 mb-6 overflow-x-auto pb-1 -mx-1 px-1">
        {TAB_KEYS.map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => setActiveTab(tabKey)}
            className={`px-4 py-2 text-[13px] font-medium rounded-xl transition-colors whitespace-nowrap min-h-[44px] ${
              activeTab === tabKey
                ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
                : 'bg-[#0F172A] text-[#6B7280] border border-white/6 hover:text-[#9CA3AF]'
            }`}
          >
            {t(`trainerNotes.tabs.${tabKey}`)}
          </button>
        ))}
      </div>

      {/* ===================== TAB 1: OVERVIEW ===================== */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Client summary */}
          {onboarding && (
            <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-[#D4AF37]" />
                <span className="text-[14px] font-medium text-[#E5E7EB]">{t('trainerNotes.overview.clientSummary')}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {onboarding.primary_goal && (
                  <div className="bg-[#111827]/60 rounded-xl px-3 py-2.5">
                    <p className="text-[11px] text-[#6B7280] uppercase tracking-wide">{t('trainerNotes.overview.goal')}</p>
                    <p className="text-[13px] text-[#E5E7EB] capitalize mt-0.5">{onboarding.primary_goal.replace(/_/g, ' ')}</p>
                  </div>
                )}
                {onboarding.fitness_level && (
                  <div className="bg-[#111827]/60 rounded-xl px-3 py-2.5">
                    <p className="text-[11px] text-[#6B7280] uppercase tracking-wide">{t('trainerNotes.overview.fitnessLevel')}</p>
                    <p className="text-[13px] text-[#E5E7EB] capitalize mt-0.5">{onboarding.fitness_level}</p>
                  </div>
                )}
                {onboarding.available_equipment && onboarding.available_equipment.length > 0 && (
                  <div className="bg-[#111827]/60 rounded-xl px-3 py-2.5">
                    <p className="text-[11px] text-[#6B7280] uppercase tracking-wide">{t('trainerNotes.overview.equipment')}</p>
                    <p className="text-[13px] text-[#E5E7EB] mt-0.5 truncate">
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
                  <p className="text-[13px] text-[#E5E7EB]">{onboarding.injuries_notes}</p>
                </div>
              )}
            </div>
          )}

          {/* Recent activity */}
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-[14px] font-medium text-[#E5E7EB]">{t('trainerNotes.overview.recentActivity')}</span>
            </div>
            {recentSessions.length === 0 ? (
              <p className="text-[13px] text-[#6B7280]">{t('trainerNotes.overview.noRecentWorkouts')}</p>
            ) : (
              <div className="space-y-2">
                {recentSessions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-[#111827]/60">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-[#E5E7EB] truncate">{s.name || t('trainerNotes.overview.workout')}</p>
                      <p className="text-[11px] text-[#6B7280]">
                        {format(new Date(s.started_at), 'MMM d')}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-right shrink-0">
                      <span className="text-[12px] text-[#9CA3AF]">
                        <Clock className="w-3 h-3 inline mr-0.5" />
                        {formatDuration(s.duration_seconds)}
                      </span>
                      <span className="text-[12px] text-[#9CA3AF]">
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
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-[14px] font-medium text-[#E5E7EB]">{t('trainerNotes.overview.currentProgram')}</span>
            </div>
            <p className="text-[14px] text-[#E5E7EB]">
              {programName || t('trainerNotes.overview.noProgram')}
            </p>
            {programProgress && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-[11px] text-[#6B7280] mb-1">
                  <span>{t('trainerNotes.program.week')} {programProgress.currentWeek} / {programProgress.totalWeeks}</span>
                  <span>{programProgress.progressPct}%</span>
                </div>
                <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#D4AF37] rounded-full transition-all"
                    style={{ width: `${programProgress.progressPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Recent wins (PRs) */}
          {personalRecords.length > 0 && (
            <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="w-4 h-4 text-[#D4AF37]" />
                <span className="text-[14px] font-medium text-[#E5E7EB]">{t('trainerNotes.overview.recentWins')}</span>
              </div>
              <div className="space-y-2">
                {personalRecords.slice(0, 3).map((pr, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-3 rounded-xl bg-[#111827]/60">
                    <div className="min-w-0">
                      <p className="text-[13px] text-[#E5E7EB] truncate">{pr.exercises?.name || t('trainerNotes.overview.unknownExercise')}</p>
                      <p className="text-[11px] text-[#6B7280]">{format(new Date(pr.achieved_at), 'MMM d')}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[13px] font-semibold text-[#D4AF37]">{pr.weight_lbs} lbs x {pr.reps}</p>
                      {pr.estimated_1rm && (
                        <p className="text-[10px] text-[#6B7280]">1RM: {Math.round(pr.estimated_1rm)} lbs</p>
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
            className="w-full bg-[#0F172A] rounded-2xl border border-white/6 p-4 flex items-center gap-3 hover:border-[#D4AF37]/30 transition-colors min-h-[44px]"
          >
            <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-[#D4AF37]" />
            </div>
            <div className="text-left">
              <p className="text-[14px] font-medium text-[#E5E7EB]">{t('trainerNotes.overview.monthlyReport')}</p>
              <p className="text-[12px] text-[#6B7280]">{t('trainerNotes.overview.monthlyReportDesc')}</p>
            </div>
          </button>
        </div>
      )}

      {/* ===================== TAB 2: PROGRESS ===================== */}
      {activeTab === 'progress' && (
        <div className="space-y-4">
          {/* Training trend chart */}
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-[14px] font-medium text-[#E5E7EB]">{t('trainerNotes.progress.trainingTrend')}</span>
            </div>
            {weeklyWorkouts.length > 0 ? (
              <div className="h-[180px] -ml-2">
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
              <p className="text-[13px] text-[#6B7280]">{t('trainerNotes.progress.noData')}</p>
            )}
          </div>

          {/* Weight history */}
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Scale className="w-5 h-5 text-[#D4AF37]" />
              <span className="text-[16px] font-semibold text-[#E5E7EB]">{t('trainerNotes.progress.weightHistory')}</span>
              {weights.length > 0 && (
                <span className="text-[12px] text-[#6B7280] ml-auto">{weights.length} {t('trainerNotes.progress.entries')}</span>
              )}
            </div>
            {weights.length === 0 ? (
              <p className="text-[14px] text-[#6B7280]">{t('trainerNotes.progress.noWeightLogs')}</p>
            ) : (
              <>
                <div className="bg-[#111827] rounded-xl p-4 mb-4 border border-[#D4AF37]/15">
                  <p className="text-[11px] text-[#6B7280] uppercase tracking-wide mb-1">{t('trainerNotes.progress.latestWeight')}</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[24px] font-bold text-[#E5E7EB]">{weights[0].weight_lbs}</span>
                    <span className="text-[14px] text-[#6B7280]">lbs</span>
                    {weights.length >= 2 && (
                      <span className={`text-[13px] font-medium ml-2 ${
                        weights[0].weight_lbs - weights[1].weight_lbs > 0
                          ? 'text-[#EF4444]'
                          : weights[0].weight_lbs - weights[1].weight_lbs < 0
                            ? 'text-[#10B981]'
                            : 'text-[#6B7280]'
                      }`}>
                        {weights[0].weight_lbs - weights[1].weight_lbs > 0 ? '+' : ''}
                        {(weights[0].weight_lbs - weights[1].weight_lbs).toFixed(1)} lbs
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-[#6B7280] mt-1">
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
                        className="flex items-center justify-between py-3 px-4 rounded-xl bg-[#111827]/60"
                      >
                        <span className="text-[14px] text-[#9CA3AF]">
                          {format(new Date(w.logged_at), 'MMM d, yyyy')}
                        </span>
                        <div className="flex items-center gap-3">
                          {diff && parseFloat(diff) !== 0 && (
                            <span className={`text-[12px] ${parseFloat(diff) > 0 ? 'text-[#EF4444]' : 'text-[#10B981]'}`}>
                              {parseFloat(diff) > 0 ? '+' : ''}{diff}
                            </span>
                          )}
                          <span className="text-[16px] font-semibold text-[#E5E7EB]">
                            {w.weight_lbs} <span className="text-[12px] font-normal text-[#6B7280]">lbs</span>
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
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Ruler className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-[14px] font-medium text-[#E5E7EB]">{t('trainerNotes.progress.bodyMeasurements')}</span>
            </div>
            {!measurements ? (
              <p className="text-[13px] text-[#6B7280]">{t('trainerNotes.progress.noMeasurements')}</p>
            ) : (
              <div className="space-y-1.5">
                {measurements.measured_at && (
                  <p className="text-[11px] text-[#6B7280] mb-2">
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
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#111827]/50"
                    >
                      <span className="text-[13px] text-[#9CA3AF]">{m.label}</span>
                      <span className="text-[14px] font-medium text-[#E5E7EB]">
                        {m.value} cm
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Personal Records list */}
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-[14px] font-medium text-[#E5E7EB]">{t('trainerNotes.progress.personalRecords')}</span>
              {personalRecords.length > 0 && (
                <span className="text-[11px] text-[#6B7280] ml-auto">({personalRecords.length})</span>
              )}
            </div>
            {personalRecords.length === 0 ? (
              <p className="text-[13px] text-[#6B7280]">{t('trainerNotes.progress.noPRs')}</p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {personalRecords.map((pr, i) => (
                  <div key={i} className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-[#111827]/60">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-[#E5E7EB] truncate">{pr.exercises?.name || t('trainerNotes.overview.unknownExercise')}</p>
                      <p className="text-[11px] text-[#6B7280]">{format(new Date(pr.achieved_at), 'MMM d, yyyy')}</p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-[13px] font-semibold text-[#E5E7EB]">{pr.weight_lbs} lbs x {pr.reps}</p>
                      {pr.estimated_1rm && (
                        <p className="text-[11px] text-[#D4AF37]">1RM: {Math.round(pr.estimated_1rm)} lbs</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================== TAB 3: NOTES ===================== */}
      {activeTab === 'notes' && (
        <div className="space-y-4">
          {/* Main coach notes */}
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
            <div className="flex items-center gap-2 mb-3">
              <StickyNote className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-[14px] font-medium text-[#E5E7EB]">{t('trainerNotes.notes.coachNotes')}</span>
            </div>
            <textarea
              value={notesData.notes}
              onChange={(e) => {
                if (e.target.value.length <= 2000) {
                  setNotesData(prev => ({ ...prev, notes: e.target.value }));
                }
              }}
              placeholder={t('trainerNotes.notes.notesPlaceholder')}
              className="w-full bg-[#111827] border border-white/8 rounded-lg p-3 text-[14px] text-[#E5E7EB] placeholder-[#6B7280] resize-none focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
              rows={6}
            />
            <span className="text-[11px] text-[#6B7280] mt-1 block">
              {notesData.notes.length} / 2000
            </span>
          </div>

          {/* Preferences */}
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Heart className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-[14px] font-medium text-[#E5E7EB]">{t('trainerNotes.notes.preferences')}</span>
            </div>
            <textarea
              value={notesData.preferences}
              onChange={(e) => {
                if (e.target.value.length <= 1000) {
                  setNotesData(prev => ({ ...prev, preferences: e.target.value }));
                }
              }}
              placeholder={t('trainerNotes.notes.preferencesPlaceholder')}
              className="w-full bg-[#111827] border border-white/8 rounded-lg p-3 text-[14px] text-[#E5E7EB] placeholder-[#6B7280] resize-none focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
              rows={3}
            />
          </div>

          {/* Injuries / Limitations */}
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className="text-[14px] font-medium text-[#E5E7EB]">{t('trainerNotes.notes.injuriesLimitations')}</span>
            </div>
            <textarea
              value={notesData.injuries}
              onChange={(e) => {
                if (e.target.value.length <= 1000) {
                  setNotesData(prev => ({ ...prev, injuries: e.target.value }));
                }
              }}
              placeholder={t('trainerNotes.notes.injuriesPlaceholder')}
              className="w-full bg-[#111827] border border-white/8 rounded-lg p-3 text-[14px] text-[#E5E7EB] placeholder-[#6B7280] resize-none focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
              rows={3}
            />
          </div>

          {/* Goal Reminders */}
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-[14px] font-medium text-[#E5E7EB]">{t('trainerNotes.notes.goalReminders')}</span>
            </div>
            <textarea
              value={notesData.goalReminders}
              onChange={(e) => {
                if (e.target.value.length <= 1000) {
                  setNotesData(prev => ({ ...prev, goalReminders: e.target.value }));
                }
              }}
              placeholder={t('trainerNotes.notes.goalRemindersPlaceholder')}
              className="w-full bg-[#111827] border border-white/8 rounded-lg p-3 text-[14px] text-[#E5E7EB] placeholder-[#6B7280] resize-none focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
              rows={3}
            />
          </div>

          {/* Save button */}
          <div className="flex items-center justify-end gap-3">
            {notesSaved && (
              <span className="text-[13px] text-[#10B981]">{t('trainerNotes.notes.saved')}</span>
            )}
            <button
              onClick={handleSaveNotes}
              disabled={savingNotes}
              className="flex items-center gap-2 bg-[#D4AF37] hover:bg-[#C4A030] text-[#05070B] text-[13px] font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 min-h-[44px]"
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
            className="w-full flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#C4A030] text-[#05070B] text-[14px] font-semibold px-4 py-3 rounded-xl transition-colors min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            {t('trainerNotes.followUp.logFollowUp')}
          </button>

          {/* Follow-up history */}
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Phone className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-[14px] font-medium text-[#E5E7EB]">{t('trainerNotes.followUp.title')}</span>
              {followups.length > 0 && (
                <span className="text-[11px] text-[#6B7280]">({followups.length})</span>
              )}
            </div>

            {followups.length === 0 ? (
              <div className="text-center py-8">
                <Phone className="w-8 h-8 text-[#6B7280] mx-auto mb-2 opacity-40" />
                <p className="text-[13px] text-[#6B7280]">{t('trainerNotes.followUp.noFollowUps')}</p>
                <p className="text-[12px] text-[#6B7280]/60 mt-1">{t('trainerNotes.followUp.noFollowUpsHint')}</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {followups.map((fu) => {
                  const MethodIcon = METHOD_ICONS[fu.method] || Phone;
                  const outcomeStyle = fu.outcome ? OUTCOME_STYLES[fu.outcome] : null;
                  return (
                    <div key={fu.id} className="flex items-start gap-3 py-3 px-3 rounded-xl bg-[#111827]/60">
                      <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0 mt-0.5">
                        <MethodIcon size={13} className="text-[#9CA3AF]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] text-[#9CA3AF]">
                            {format(new Date(fu.created_at), 'MMM d, yyyy h:mm a')}
                          </span>
                          {outcomeStyle && (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${outcomeStyle.bg} ${outcomeStyle.color}`}>
                              {outcomeStyle.label}
                            </span>
                          )}
                        </div>
                        {fu.note && (
                          <p className="text-[13px] text-[#E5E7EB] mt-1">{fu.note}</p>
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
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-[14px] font-medium text-[#E5E7EB]">{t('trainerNotes.program.currentProgram')}</span>
            </div>

            {programName ? (
              <div>
                <div className="bg-[#111827] rounded-xl p-4 border border-[#D4AF37]/15">
                  <p className="text-[16px] font-semibold text-[#E5E7EB]">{programName}</p>
                  {programProgress && (
                    <>
                      <div className="flex items-center gap-4 mt-3 text-[12px] text-[#9CA3AF]">
                        <span>{t('trainerNotes.program.week')} {programProgress.currentWeek} / {programProgress.totalWeeks}</span>
                        <span>{programProgress.daysPerWeek} {t('trainerNotes.program.daysPerWeek')}</span>
                      </div>
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-[11px] text-[#6B7280] mb-1.5">
                          <span>{t('trainerNotes.program.progress')}</span>
                          <span>{programProgress.progressPct}%</span>
                        </div>
                        <div className="w-full h-2 bg-white/[0.06] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#D4AF37] rounded-full transition-all"
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
                <BookOpen className="w-8 h-8 text-[#6B7280] mx-auto mb-2 opacity-40" />
                <p className="text-[13px] text-[#6B7280]">{t('trainerNotes.program.noProgram')}</p>
              </div>
            )}
          </div>

          {/* Adherence stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
              <p className="text-[11px] text-[#6B7280] uppercase tracking-wide mb-1">{t('trainerNotes.program.totalWorkouts')}</p>
              <p className="text-[24px] font-bold text-[#E5E7EB]">{stats.count}</p>
            </div>
            <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
              <p className="text-[11px] text-[#6B7280] uppercase tracking-wide mb-1">{t('trainerNotes.program.adherence')}</p>
              <p className="text-[24px] font-bold text-[#E5E7EB]">{adherencePercent}%</p>
            </div>
          </div>

          {/* Available programs to assign */}
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-[14px] font-medium text-[#E5E7EB]">{t('trainerNotes.program.availablePrograms')}</span>
            </div>

            {availablePrograms.length === 0 ? (
              <p className="text-[13px] text-[#6B7280]">{t('trainerNotes.program.noProgramsAvailable')}</p>
            ) : (
              <div className="space-y-2">
                {availablePrograms.map((prog) => {
                  const isAssigned = client.assigned_program_id === prog.id;
                  return (
                    <div
                      key={prog.id}
                      className={`flex items-center justify-between py-3 px-4 rounded-xl transition-colors ${
                        isAssigned
                          ? 'bg-[#D4AF37]/10 border border-[#D4AF37]/20'
                          : 'bg-[#111827]/60 hover:bg-[#111827]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{prog.name}</p>
                        <p className="text-[11px] text-[#6B7280]">
                          {prog.duration_weeks ? `${prog.duration_weeks} ${t('trainerNotes.program.weeks')}` : ''}
                          {prog.days_per_week ? ` · ${prog.days_per_week} ${t('trainerNotes.program.daysWk')}` : ''}
                        </p>
                      </div>
                      {isAssigned ? (
                        <span className="text-[11px] font-medium text-[#D4AF37] px-2.5 py-1 rounded-lg bg-[#D4AF37]/10">
                          {t('trainerNotes.program.assigned')}
                        </span>
                      ) : (
                        <button
                          onClick={() => handleAssignProgram(prog.id)}
                          disabled={assigningProgram}
                          className="text-[12px] font-medium text-[#D4AF37] hover:text-[#E5C94B] px-3 py-1.5 rounded-lg border border-[#D4AF37]/30 hover:bg-[#D4AF37]/10 transition-colors disabled:opacity-50 min-h-[36px]"
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

      {/* Monthly Report Modal */}
      <MonthlyProgressReport
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        profileId={clientId}
      />

      {/* Log Follow-Up Modal */}
      {showFollowupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-[#0F172A] rounded-2xl border border-white/[0.08] w-full max-w-[400px] p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-semibold text-[#E5E7EB]">
                {t('trainerNotes.followUp.logFollowUp')}
              </h3>
              <button onClick={() => setShowFollowupModal(false)} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
                <X size={18} />
              </button>
            </div>

            {/* Method selector */}
            <label className="text-[12px] text-[#6B7280] uppercase tracking-wide mb-1.5 block">
              {t('trainerNotes.followUp.method')}
            </label>
            <div className="flex gap-2 mb-4">
              {[
                { value: 'call', icon: Phone, label: t('trainerNotes.followUp.methods.call') },
                { value: 'sms', icon: MessageSquare, label: t('trainerNotes.followUp.methods.sms') },
                { value: 'push', icon: Bell, label: t('trainerNotes.followUp.methods.push') },
                { value: 'email', icon: Mail, label: t('trainerNotes.followUp.methods.email') },
                { value: 'in_person', icon: UserCheck, label: t('trainerNotes.followUp.methods.inPerson') },
              ].map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  onClick={() => setFuMethod(value)}
                  title={label}
                  className={`flex-1 py-2 rounded-lg flex flex-col items-center gap-1 text-[10px] font-medium transition-colors min-h-[44px] ${
                    fuMethod === value
                      ? 'bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30'
                      : 'bg-[#111827] text-[#6B7280] border border-white/6 hover:text-[#9CA3AF]'
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>

            {/* Outcome */}
            <label className="text-[12px] text-[#6B7280] uppercase tracking-wide mb-1.5 block">
              {t('trainerNotes.followUp.outcomeLabel')}
            </label>
            <select
              value={fuOutcome}
              onChange={(e) => setFuOutcome(e.target.value)}
              className="w-full bg-[#111827] border border-white/8 rounded-lg px-3 py-2.5 text-[14px] text-[#E5E7EB] mb-4 focus:outline-none focus:border-[#D4AF37]/40 transition-colors min-h-[44px]"
            >
              <option value="no_answer">{t('trainerNotes.followUp.outcomes.noAnswer')}</option>
              <option value="rescheduled">{t('trainerNotes.followUp.outcomes.rescheduled')}</option>
              <option value="coming_back">{t('trainerNotes.followUp.outcomes.comingBack')}</option>
              <option value="not_interested">{t('trainerNotes.followUp.outcomes.notInterested')}</option>
              <option value="other">{t('trainerNotes.followUp.outcomes.other')}</option>
            </select>

            {/* Note */}
            <label className="text-[12px] text-[#6B7280] uppercase tracking-wide mb-1.5 block">
              {t('trainerNotes.followUp.noteLabel')}
            </label>
            <textarea
              value={fuNote}
              onChange={(e) => setFuNote(e.target.value)}
              placeholder={t('trainerNotes.followUp.notePlaceholder')}
              className="w-full bg-[#111827] border border-white/8 rounded-lg p-3 text-[14px] text-[#E5E7EB] placeholder-[#6B7280] resize-none focus:outline-none focus:border-[#D4AF37]/40 transition-colors mb-4"
              rows={3}
            />

            <div className="flex gap-3">
              <button
                onClick={() => setShowFollowupModal(false)}
                className="flex-1 py-2.5 rounded-lg border border-white/8 text-[13px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors min-h-[44px]"
              >
                {t('trainerNotes.followUp.cancel')}
              </button>
              <button
                onClick={handleSaveFollowup}
                disabled={savingFollowup}
                className="flex-1 py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#C4A030] text-[#05070B] text-[13px] font-semibold transition-colors disabled:opacity-50 min-h-[44px]"
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
