import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Scale, Ruler, TrendingUp, StickyNote, Calendar, BarChart3, MessageSquare, Bell, Phone, Mail, UserCheck, Plus, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import MonthlyProgressReport from '../../components/MonthlyProgressReport';

const TABS = ['Overview', 'Notes', 'Body Metrics'];

export default function TrainerClientNotes() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { t } = useTranslation('pages');

  const [activeTab, setActiveTab] = useState('Overview');
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [client, setClient] = useState(null);
  const [stats, setStats] = useState({ count: 0, volume: 0 });
  const [programName, setProgramName] = useState(null);
  const [notesText, setNotesText] = useState('');
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

  useEffect(() => { document.title = 'Trainer - Client Notes | TuGymPR'; }, []);

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

      const [clientRes, statsRes, weightsRes, measRes, streakRes, followupsRes] = await Promise.all([
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
        }
      }

      if (statsRes.data) {
        const totalVolume = statsRes.data.reduce((sum, s) => sum + (s.total_volume_lbs || 0), 0);
        setStats({ count: statsRes.data.length, volume: totalVolume });
      }

      setNotesText(assignment.notes || '');

      setWeights(weightsRes.data || []);
      setMeasurements(measRes.data?.[0] || null);
      setStreak(streakRes.data || null);
      setFollowups(followupsRes.data || []);
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
      // Whitelist fields — only update notes, never allow role/gym escalation
      await supabase.from('trainer_clients').upsert({
        gym_id: profile.gym_id,
        trainer_id: profile.id,
        client_id: clientId,
        notes: notesText,
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
          Back to Clients
        </button>
        <div className="text-center py-20">
          <p className="text-[16px] font-semibold text-[#E5E7EB] mb-2">Access Denied</p>
          <p className="text-[14px] text-[#6B7280]">This client is not assigned to you.</p>
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
          Back to Clients
        </button>
        <p className="text-[#9CA3AF] text-[14px]">Client not found.</p>
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
        Back to Clients
      </button>

      {/* Client header */}
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#E5E7EB] truncate">
          {client.full_name || 'Unnamed Client'}
        </h1>
        {client.username && (
          <p className="text-[13px] text-[#6B7280] mt-0.5">@{client.username}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-white/6">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-[13px] font-medium transition-colors relative ${
              activeTab === tab
                ? 'text-[#D4AF37]'
                : 'text-[#6B7280] hover:text-[#9CA3AF]'
            }`}
          >
            {tab}
            {activeTab === tab && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#D4AF37] rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'Overview' && (
        <div className="space-y-4">
          {/* Last active */}
          <div className="flex items-center gap-2 text-[13px] text-[#9CA3AF]">
            <Calendar className="w-3.5 h-3.5" />
            <span>
              Last active:{' '}
              {client.last_active_at
                ? format(new Date(client.last_active_at), 'MMM d, yyyy')
                : 'Unknown'}
            </span>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-[#D4AF37] flex-shrink-0" />
                <span className="text-[11px] text-[#6B7280] uppercase tracking-wide truncate">Total Workouts</span>
              </div>
              <p className="text-[24px] font-bold text-[#E5E7EB] truncate">{stats.count}</p>
            </div>
            <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-2">
                <Scale className="w-4 h-4 text-[#D4AF37] flex-shrink-0" />
                <span className="text-[11px] text-[#6B7280] uppercase tracking-wide truncate">Total Volume</span>
              </div>
              <p className="text-[24px] font-bold text-[#E5E7EB] truncate">
                {stats.volume >= 1000
                  ? `${(stats.volume / 1000).toFixed(1)}k`
                  : stats.volume}{' '}
                <span className="text-[13px] font-normal text-[#6B7280]">lbs</span>
              </p>
            </div>
            <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-4 h-4 text-[#D4AF37] flex-shrink-0" />
                <span className="text-[11px] text-[#6B7280] uppercase tracking-wide truncate">Days as Member</span>
              </div>
              <p className="text-[24px] font-bold text-[#E5E7EB] truncate">
                {getDaysSince(client.created_at)}
              </p>
            </div>
            <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-[#10B981] flex-shrink-0" />
                <span className="text-[11px] text-[#6B7280] uppercase tracking-wide truncate">Current Streak</span>
              </div>
              <p className="text-[24px] font-bold text-[#E5E7EB] truncate">
                {streak ? streak.current_streak : 0}
                <span className="text-[13px] font-normal text-[#6B7280] ml-1">days</span>
              </p>
            </div>
          </div>

          {/* Assigned program */}
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
            <p className="text-[11px] text-[#6B7280] uppercase tracking-wide mb-1">Assigned Program</p>
            <p className="text-[14px] text-[#E5E7EB]">
              {programName || 'None'}
            </p>
          </div>

          {/* Monthly Report */}
          <button
            onClick={() => setShowReport(true)}
            className="w-full bg-[#0F172A] rounded-2xl border border-white/6 p-4 flex items-center gap-3 hover:border-[#D4AF37]/30 transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-[#D4AF37]" />
            </div>
            <div className="text-left">
              <p className="text-[14px] font-medium text-[#E5E7EB]">Monthly Progress Report</p>
              <p className="text-[12px] text-[#6B7280]">View training, strength & body composition trends</p>
            </div>
          </button>

          {/* Follow-Up History */}
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-[#D4AF37]" />
                <span className="text-[14px] font-medium text-[#E5E7EB]">{t('trainerNotes.followUp.title')}</span>
                {followups.length > 0 && (
                  <span className="text-[11px] text-[#6B7280]">({followups.length})</span>
                )}
              </div>
              <button
                onClick={() => setShowFollowupModal(true)}
                className="flex items-center gap-1.5 text-[12px] text-[#D4AF37] hover:text-[#E5C94B] transition-colors"
              >
                <Plus size={14} />
                {t('trainerNotes.followUp.logFollowUp')}
              </button>
            </div>

            {followups.length === 0 ? (
              <p className="text-[13px] text-[#6B7280]">{t('trainerNotes.followUp.noFollowUps')}</p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
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

      {/* Monthly Report Modal */}
      <MonthlyProgressReport
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        profileId={clientId}
      />

      {activeTab === 'Notes' && (
        <div className="space-y-4">
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
            <div className="flex items-center gap-2 mb-3">
              <StickyNote className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-[14px] font-medium text-[#E5E7EB]">Trainer Notes</span>
            </div>
            <textarea
              value={notesText}
              onChange={(e) => {
                if (e.target.value.length <= 2000) {
                  setNotesText(e.target.value);
                }
              }}
              placeholder="Add notes about this client's goals, preferences, or progress..."
              className="w-full bg-[#111827] border border-white/8 rounded-lg p-3 text-[14px] text-[#E5E7EB] placeholder-[#6B7280] resize-none focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
              rows={8}
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-[11px] text-[#6B7280]">
                {notesText.length} / 2000
              </span>
              <div className="flex items-center gap-3">
                {notesSaved && (
                  <span className="text-[13px] text-[#10B981]">Saved</span>
                )}
                <button
                  onClick={handleSaveNotes}
                  disabled={savingNotes}
                  className="flex items-center gap-2 bg-[#D4AF37] hover:bg-[#C4A030] text-[#05070B] text-[13px] font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingNotes ? 'Saving...' : 'Save Notes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Body Metrics' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Weight logs */}
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Scale className="w-5 h-5 text-[#D4AF37]" />
              <span className="text-[16px] font-semibold text-[#E5E7EB]">Weight History</span>
              {weights.length > 0 && (
                <span className="text-[12px] text-[#6B7280] ml-auto">{weights.length} entries</span>
              )}
            </div>
            {weights.length === 0 ? (
              <p className="text-[14px] text-[#6B7280]">No weight logs recorded yet</p>
            ) : (
              <>
                {/* Current weight highlight */}
                <div className="bg-[#111827] rounded-xl p-4 mb-4 border border-[#D4AF37]/15">
                  <p className="text-[11px] text-[#6B7280] uppercase tracking-wide mb-1">Latest Weight</p>
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
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {weights.slice(1).map((w, i) => {
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

          {/* Measurements */}
          <div className="bg-[#0F172A] rounded-2xl border border-white/6 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Ruler className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-[14px] font-medium text-[#E5E7EB]">Body Measurements</span>
            </div>
            {!measurements ? (
              <p className="text-[13px] text-[#6B7280]">No measurements recorded yet</p>
            ) : (
              <div className="space-y-1.5">
                {measurements.measured_at && (
                  <p className="text-[11px] text-[#6B7280] mb-2">
                    Measured on {format(new Date(measurements.measured_at), 'MMM d, yyyy')}
                  </p>
                )}
                {[
                  { label: 'Chest', value: measurements.chest_cm },
                  { label: 'Waist', value: measurements.waist_cm },
                  { label: 'Hips', value: measurements.hips_cm },
                  { label: 'Left Arm', value: measurements.left_arm_cm },
                  { label: 'Right Arm', value: measurements.right_arm_cm },
                  { label: 'Left Thigh', value: measurements.left_thigh_cm },
                  { label: 'Right Thigh', value: measurements.right_thigh_cm },
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
        </div>
      )}

      {/* Log Follow-Up Modal */}
      {showFollowupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-[#0F172A] rounded-2xl border border-white/[0.08] w-full max-w-[400px] p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-semibold text-[#E5E7EB]">
                {t('trainerNotes.followUp.logFollowUp')}
              </h3>
              <button onClick={() => setShowFollowupModal(false)} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors">
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
                  className={`flex-1 py-2 rounded-lg flex flex-col items-center gap-1 text-[10px] font-medium transition-colors ${
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
              className="w-full bg-[#111827] border border-white/8 rounded-lg px-3 py-2.5 text-[14px] text-[#E5E7EB] mb-4 focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
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
                className="flex-1 py-2.5 rounded-lg border border-white/8 text-[13px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors"
              >
                {t('trainerNotes.followUp.cancel')}
              </button>
              <button
                onClick={handleSaveFollowup}
                disabled={savingFollowup}
                className="flex-1 py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#C4A030] text-[#05070B] text-[13px] font-semibold transition-colors disabled:opacity-50"
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
