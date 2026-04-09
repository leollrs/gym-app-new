import { useState, useEffect } from 'react';
import {
  ToggleLeft, ToggleRight, Save, CheckCircle, ChevronDown, Plus, X, Activity,
  Award, Mail, AlertTriangle, Bell, Smartphone,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { FadeIn, AdminCard, AdminModal } from '../../../components/admin';
import { formatDistanceToNow } from 'date-fns';
import logger from '../../../lib/logger';

const DEFAULT_SETTINGS = {
  enabled: false,
  threshold: 55,
  cooldown_days: 7,
  message_template: "Hey! We noticed you haven't been in lately. We miss you — come back and crush your goals. Your progress is waiting!",
  last_run_at: null,
  last_run_count: 0,
  digest_enabled: false,
  digest_day: 1,
};

const DAYS_OF_WEEK = [
  { value: 0, key: 'sun' },
  { value: 1, key: 'mon' },
  { value: 2, key: 'tue' },
  { value: 3, key: 'wed' },
  { value: 4, key: 'thu' },
  { value: 5, key: 'fri' },
  { value: 6, key: 'sat' },
];

const DEFAULT_MILESTONES = [
  { days: 90, message: '' },
  { days: 180, message: '' },
  { days: 365, message: '' },
];

export default function FollowUpSettings({ gymId, initialSettings, initialSteps, atRiskCount = 0, delay = 0 }) {
  const { t } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [fupDraft, setFupDraft] = useState({ ...DEFAULT_SETTINGS, ...initialSettings });

  // Tenure milestone state
  const [showTenure, setShowTenure] = useState(false);
  const [tenureEnabled, setTenureEnabled] = useState(false);
  const [milestones, setMilestones] = useState(DEFAULT_MILESTONES);
  const [savingTenure, setSavingTenure] = useState(false);
  const [tenureSaved, setTenureSaved] = useState(false);

  // Load tenure milestone settings
  useEffect(() => {
    if (!gymId) return;
    supabase.from('tenure_milestone_settings').select('*').eq('gym_id', gymId).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setTenureEnabled(data.enabled ?? false);
          if (Array.isArray(data.milestones) && data.milestones.length > 0) {
            setMilestones(data.milestones);
          }
        }
      })
      .catch(err => logger.error('Failed to load tenure settings', err));
  }, [gymId]);

  const updateMilestone = (idx, field, value) => {
    setMilestones(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  };

  const saveTenureSettings = async () => {
    if (!gymId) return;
    setSavingTenure(true);
    try {
      await supabase.from('tenure_milestone_settings').upsert({
        gym_id: gymId,
        enabled: tenureEnabled,
        milestones,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'gym_id' });
      setTenureSaved(true);
      setTimeout(() => setTenureSaved(false), 2500);
    } catch (err) {
      logger.error('Failed to save tenure settings', err);
    } finally { setSavingTenure(false); }
  };
  const [savingFup, setSavingFup] = useState(false);
  const [fupSaved, setFupSaved] = useState(false);
  const defaultMsg = t('adminChurn.followUp.defaultMessage', { defaultValue: DEFAULT_SETTINGS.message_template });
  const [steps, setSteps] = useState(
    initialSteps?.length
      ? initialSteps.map(s => ({ ...s, channel: s.channel || 'notification' }))
      : [{ step_number: 1, delay_days: 0, message_template: defaultMsg, message_b: null, channel: 'notification' }]
  );

  const lastRunLabel = initialSettings?.last_run_at
    ? formatDistanceToNow(new Date(initialSettings.last_run_at), { addSuffix: true })
    : null;

  const CHANNEL_DEFAULTS = ['notification', 'email', 'sms'];
  const addStep = () => {
    const nextChannel = CHANNEL_DEFAULTS[steps.length] || 'notification';
    setSteps(prev => [...prev, { step_number: prev.length + 1, delay_days: 7, message_template: '', message_b: null, channel: nextChannel }]);
  };
  const removeStep = (idx) => {
    setSteps(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_number: i + 1 })));
  };
  const updateStep = (idx, field, value) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };
  const addVariantB = (idx) => {
    updateStep(idx, 'message_b', '');
  };
  const removeVariantB = (idx) => {
    updateStep(idx, 'message_b', null);
  };

  const saveSettings = async () => {
    if (!gymId) return;
    setSavingFup(true);
    const payload = {
      gym_id: gymId,
      enabled: fupDraft.enabled,
      threshold: fupDraft.threshold,
      cooldown_days: fupDraft.cooldown_days,
      message_template: steps[0]?.message_template || fupDraft.message_template,
      digest_enabled: fupDraft.digest_enabled,
      digest_day: fupDraft.digest_day,
      updated_at: new Date().toISOString(),
    };
    await supabase.from('churn_followup_settings').upsert(payload, { onConflict: 'gym_id' });
    await supabase.from('drip_campaign_steps').delete().eq('gym_id', gymId);
    if (steps.length > 0) {
      await supabase.from('drip_campaign_steps').insert(
        steps.map(s => ({ gym_id: gymId, step_number: s.step_number, delay_days: s.delay_days, message_template: s.message_template, message_b: s.message_b || null, channel: s.channel || 'notification' }))
      );
    }
    setSavingFup(false);
    setFupSaved(true);
    setTimeout(() => setFupSaved(false), 2500);
  };

  return (
    <FadeIn delay={delay}>
      <AdminCard hover>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">{t('adminChurn.followUp.title', { defaultValue: 'Automated Follow-Up' })}</p>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${fupDraft.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-[#6B7280]'}`}>
              {fupDraft.enabled ? t('adminChurn.followUp.on', { defaultValue: 'On' }) : t('adminChurn.followUp.off', { defaultValue: 'Off' })}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => setFupDraft(d => ({ ...d, enabled: !d.enabled }))} aria-label={fupDraft.enabled ? 'Disable automated follow-up' : 'Enable automated follow-up'} className="flex items-center gap-1 transition-colors">
              {fupDraft.enabled ? <ToggleRight size={22} className="text-[#D4AF37]" /> : <ToggleLeft size={22} className="text-[#4B5563]" />}
            </button>
            <button onClick={() => setShowFollowUp(v => !v)} className="flex items-center gap-1 text-[11px] text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors ml-1 whitespace-nowrap">
              {t('adminChurn.followUp.configure', { defaultValue: 'Configure' })}
              <ChevronDown size={13} className={`transition-transform ${showFollowUp ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        <div className={`grid transition-all duration-300 ease-in-out ${showFollowUp ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden">
            <div className="pt-3 mt-3 border-t border-white/6">
              <p className="text-[11px] text-[#6B7280] mb-3">{t('adminChurn.followUp.runsDaily', { defaultValue: 'Runs daily at 2 AM UTC — sends in-app notifications to at-risk members' })}</p>

              {initialSettings?.last_run_at && (
                <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-emerald-500/8 border border-emerald-500/15 rounded-lg">
                  <Activity size={12} className="text-emerald-400 flex-shrink-0" />
                  <p className="text-[11px] text-emerald-400">
                    {t('adminChurn.followUp.lastRun', { time: lastRunLabel, count: initialSettings.last_run_count, defaultValue: 'Last run {{time}} · {{count}} notifications sent' })}
                  </p>
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1.5">{t('adminChurn.followUp.riskThreshold', { defaultValue: 'Risk Threshold' })}</label>
                  <div className="flex gap-2">
                    {[{ label: t('adminChurn.followUp.medium', { defaultValue: 'Medium (30%+)' }), value: 30 }, { label: t('adminChurn.followUp.high', { defaultValue: 'High (55%+)' }), value: 55 }, { label: t('adminChurn.followUp.critical', { defaultValue: 'Critical (80%+)' }), value: 80 }].map(opt => (
                      <button key={opt.value} onClick={() => setFupDraft(d => ({ ...d, threshold: opt.value }))}
                        className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors border whitespace-nowrap ${fupDraft.threshold === opt.value ? 'bg-[#D4AF37]/10 border-[#D4AF37]/30 text-[#D4AF37]' : 'border-white/6 text-[#6B7280] hover:text-[#9CA3AF]'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1.5">{t('adminChurn.followUp.cooldown', { defaultValue: 'Cooldown Between Notifications' })}</label>
                  <div className="flex gap-2">
                    {[3, 7, 14, 30].map(days => (
                      <button key={days} onClick={() => setFupDraft(d => ({ ...d, cooldown_days: days }))}
                        className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors border ${fupDraft.cooldown_days === days ? 'bg-[#D4AF37]/10 border-[#D4AF37]/30 text-[#D4AF37]' : 'border-white/6 text-[#6B7280] hover:text-[#9CA3AF]'}`}>
                        {`${days}d`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Weekly Digest Section */}
              <div className="mb-4 p-3 bg-[#111827] border border-white/6 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Mail size={14} className="text-[#D4AF37]" />
                    <p className="text-[12px] font-semibold text-[#E5E7EB]">{t('adminChurn.digest.title', { defaultValue: 'Weekly Digest' })}</p>
                  </div>
                  <button onClick={() => setFupDraft(d => ({ ...d, digest_enabled: !d.digest_enabled }))} aria-label={fupDraft.digest_enabled ? 'Disable weekly digest' : 'Enable weekly digest'} className="flex items-center gap-1 transition-colors">
                    {fupDraft.digest_enabled ? <ToggleRight size={20} className="text-[#D4AF37]" /> : <ToggleLeft size={20} className="text-[#4B5563]" />}
                  </button>
                </div>
                <p className="text-[10px] text-[#4B5563] mb-2.5">
                  {t('adminChurn.digest.description', { defaultValue: 'Receive a weekly summary notification with new critical members, win-back returns, and top members needing attention.' })}
                </p>
                {fupDraft.digest_enabled && (
                  <div>
                    <label className="block text-[10px] font-medium text-[#9CA3AF] mb-1.5">{t('adminChurn.digest.dayLabel', { defaultValue: 'Digest Day' })}</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {DAYS_OF_WEEK.map(day => (
                        <button key={day.value} onClick={() => setFupDraft(d => ({ ...d, digest_day: day.value }))}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors border ${fupDraft.digest_day === day.value ? 'bg-[#D4AF37]/10 border-[#D4AF37]/30 text-[#D4AF37]' : 'border-white/6 text-[#6B7280] hover:text-[#9CA3AF]'}`}>
                          {t(`adminChurn.digest.days.${day.key}`, { defaultValue: day.key.charAt(0).toUpperCase() + day.key.slice(1) })}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2.5 p-2.5 bg-[#0A0D14] border border-white/4 rounded-lg">
                      <p className="text-[10px] text-[#6B7280] mb-1.5">{t('adminChurn.digest.preview', { defaultValue: 'Digest includes:' })}</p>
                      <ul className="space-y-1 text-[10px] text-[#9CA3AF]">
                        <li className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-[#EF4444]" />{t('adminChurn.digest.newCritical', { defaultValue: 'New critical-tier members this week' })}</li>
                        <li className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-[#10B981]" />{t('adminChurn.digest.returnedMembers', { defaultValue: 'Members who returned after win-back' })}</li>
                        <li className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-[#F59E0B]" />{t('adminChurn.digest.totalAtRisk', { defaultValue: 'Total at-risk members count' })}</li>
                        <li className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-[#D4AF37]" />{t('adminChurn.digest.topNeedAttention', { defaultValue: 'Top 3 members needing attention' })}</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              {/* Drip Campaign Steps */}
              <div className="mb-4">
                <label className="block text-[11px] font-medium text-[#9CA3AF] mb-2">{t('adminChurn.followUp.campaignSteps', { defaultValue: 'Campaign Steps' })}</label>
                <p className="text-[10px] text-[#4B5563] mb-2.5">{t('adminChurn.followUp.campaignHint', { defaultValue: 'Each step can use a different channel: push notification, email, or SMS' })}</p>
                <div className="space-y-0">
                  {steps.map((step, i) => (
                    <div key={i} className="flex gap-2.5">
                      <div className="flex flex-col items-center">
                        <div className="w-6 h-6 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0 z-10">
                          <span className="text-[10px] font-bold text-[#D4AF37]">{i + 1}</span>
                        </div>
                        {i < steps.length - 1 && <div className="w-px flex-1 bg-white/8 my-1" />}
                      </div>
                      <div className="flex-1 pb-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px] font-medium text-[#E5E7EB]">
                            {step.delay_days === 0 ? t('adminChurn.followUp.immediately', { defaultValue: 'Immediately' }) : t('adminChurn.followUp.afterDays', { count: step.delay_days, defaultValue: `After ${step.delay_days} day${step.delay_days !== 1 ? 's' : ''}` })}
                          </span>
                          {i > 0 && (
                            <select value={step.delay_days} onChange={e => updateStep(i, 'delay_days', Number(e.target.value))}
                              className="bg-[#111827] border border-white/6 rounded-md px-2 py-0.5 text-[10px] text-[#9CA3AF] outline-none">
                              {[1,2,3,5,7,10,14,21,30].map(d => <option key={d} value={d}>{d}d</option>)}
                            </select>
                          )}
                          {steps.length > 1 && (
                            <button onClick={() => removeStep(i)} className="ml-auto text-[#6B7280] hover:text-[#EF4444] transition-colors"><X size={13} /></button>
                          )}
                        </div>

                        {/* Channel selector */}
                        <div className="flex gap-1.5 mb-1.5">
                          {[
                            { key: 'notification', icon: Bell, label: t('adminChurn.followUp.channelNotif', { defaultValue: 'Push' }), color: '#10B981' },
                            { key: 'email', icon: Mail, label: t('adminChurn.followUp.channelEmail', { defaultValue: 'Email' }), color: '#60A5FA' },
                            { key: 'sms', icon: Smartphone, label: t('adminChurn.followUp.channelSms', { defaultValue: 'SMS' }), color: '#F59E0B' },
                          ].map(ch => (
                            <button key={ch.key} onClick={() => updateStep(i, 'channel', ch.key)}
                              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold border transition-colors ${
                                step.channel === ch.key
                                  ? 'border-opacity-40 opacity-100'
                                  : 'border-white/6 text-[#6B7280] hover:text-[#9CA3AF] opacity-60'
                              }`}
                              style={step.channel === ch.key ? { background: `${ch.color}15`, borderColor: `${ch.color}66`, color: ch.color } : {}}>
                              <ch.icon size={10} />
                              {ch.label}
                            </button>
                          ))}
                        </div>
                        {step.channel === 'sms' && (
                          <p className="text-[9px] text-[#F59E0B] mb-1">{t('adminChurn.followUp.smsCapWarning', { defaultValue: 'Counts toward 200/mo SMS limit · Only sent if member has phone on file' })}</p>
                        )}

                        {/* A/B Testing: show variants side by side or single textarea */}
                        {step.message_b !== null && step.message_b !== undefined ? (
                          <div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                  <span className="text-[10px] font-bold text-[#D4AF37] bg-[#D4AF37]/10 px-1.5 py-0.5 rounded">A</span>
                                </div>
                                <textarea rows={2} value={step.message_template} onChange={e => updateStep(i, 'message_template', e.target.value)}
                                  className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-1.5 text-[11px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none"
                                  placeholder={t('adminChurn.ab.variantAPlaceholder', { defaultValue: 'Variant A message...' })} />
                              </div>
                              <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                  <span className="text-[10px] font-bold text-[#818CF8] bg-[#818CF8]/10 px-1.5 py-0.5 rounded">B</span>
                                  <button onClick={() => removeVariantB(i)} className="text-[#6B7280] hover:text-[#EF4444] transition-colors ml-auto">
                                    <X size={11} />
                                  </button>
                                </div>
                                <textarea rows={2} value={step.message_b} onChange={e => updateStep(i, 'message_b', e.target.value)}
                                  className="w-full bg-[#111827] border border-[#818CF8]/20 rounded-lg px-3 py-1.5 text-[11px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#818CF8]/40 resize-none"
                                  placeholder={t('adminChurn.ab.variantBPlaceholder', { defaultValue: 'Variant B message...' })} />
                              </div>
                            </div>
                            <p className="text-[9px] text-[#4B5563] mt-1">
                              {t('adminChurn.ab.splitHint', { defaultValue: 'Members are randomly assigned A or B based on their profile ID. Track results in Win-Back tab.' })}
                            </p>
                          </div>
                        ) : (
                          <div>
                            <textarea rows={2} value={step.message_template} onChange={e => updateStep(i, 'message_template', e.target.value)}
                              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-1.5 text-[11px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none"
                              placeholder={t('adminChurn.followUp.messagePlaceholder', { defaultValue: 'Message to send...' })} />
                            <button onClick={() => addVariantB(i)}
                              className="flex items-center gap-1 text-[10px] font-medium text-[#818CF8] hover:text-[#A5B4FC] transition-colors mt-1">
                              <Plus size={11} /> {t('adminChurn.ab.addVariantB', { defaultValue: 'Add Variant B' })}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {steps.length < 5 && (
                  <button onClick={addStep} className="flex items-center gap-1.5 text-[11px] font-medium text-[#D4AF37] hover:text-[#E6C766] transition-colors mt-1.5 whitespace-nowrap">
                    <Plus size={13} /> {t('adminChurn.followUp.addStep', { defaultValue: 'Add step' })}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button onClick={() => setShowSaveConfirm(true)} disabled={savingFup}
                  className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors whitespace-nowrap ${fupSaved ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[#D4AF37] text-black hover:bg-[#E6C766]'} disabled:opacity-50`}>
                  {fupSaved ? <CheckCircle size={13} /> : <Save size={13} />}
                  {savingFup ? t('adminChurn.followUp.saving', { defaultValue: 'Saving...' }) : fupSaved ? t('adminChurn.followUp.saved', { defaultValue: 'Saved!' }) : t('adminChurn.followUp.saveSettings', { defaultValue: 'Save Settings' })}
                </button>
                <p className="text-[10px] text-[#4B5563] ml-auto">
                  {t('adminChurn.followUp.atRiskCount', { count: atRiskCount, defaultValue: `${atRiskCount} member${atRiskCount !== 1 ? 's' : ''} at critical/high risk` })}
                </p>
              </div>

              {/* Confirmation modal for saving (replaces existing campaign steps) */}
              <AdminModal
                isOpen={showSaveConfirm}
                onClose={() => setShowSaveConfirm(false)}
                title={t('adminChurn.followUp.confirmSaveTitle', { defaultValue: 'Save Campaign Settings' })}
                titleIcon={AlertTriangle}
                size="sm"
                footer={
                  <>
                    <button
                      onClick={() => setShowSaveConfirm(false)}
                      className="flex-1 py-2 rounded-lg text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors whitespace-nowrap"
                    >
                      {tc('cancel')}
                    </button>
                    <button
                      onClick={() => { setShowSaveConfirm(false); saveSettings(); }}
                      disabled={savingFup}
                      className="flex-1 py-2 rounded-lg text-[12px] font-semibold bg-[#D4AF37] text-black hover:bg-[#E6C766] transition-colors whitespace-nowrap disabled:opacity-40"
                    >
                      {tc('confirm')}
                    </button>
                  </>
                }
              >
                <p className="text-[12px] text-[#9CA3AF] text-center">
                  {t('adminChurn.followUp.confirmSaveMessage', { defaultValue: 'This will replace all existing campaign steps with your current configuration. Any in-progress drip sequences will restart.' })}
                </p>
              </AdminModal>
            </div>
          </div>
        </div>
      </AdminCard>

      {/* Tenure Milestones Section */}
      <AdminCard hover className="mt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">{t('adminChurn.tenure.title', { defaultValue: 'Tenure Milestones' })}</p>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${tenureEnabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-[#6B7280]'}`}>
              {tenureEnabled ? t('adminChurn.tenure.on', { defaultValue: 'On' }) : t('adminChurn.tenure.off', { defaultValue: 'Off' })}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => setTenureEnabled(v => !v)} aria-label={tenureEnabled ? 'Disable tenure milestones' : 'Enable tenure milestones'} className="flex items-center gap-1 transition-colors">
              {tenureEnabled ? <ToggleRight size={22} className="text-[#D4AF37]" /> : <ToggleLeft size={22} className="text-[#4B5563]" />}
            </button>
            <button onClick={() => setShowTenure(v => !v)} className="flex items-center gap-1 text-[11px] text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors ml-1 whitespace-nowrap">
              {t('adminChurn.tenure.configure', { defaultValue: 'Configure' })}
              <ChevronDown size={13} className={`transition-transform ${showTenure ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        <div className={`grid transition-all duration-300 ease-in-out ${showTenure ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden">
            <div className="pt-3 mt-3 border-t border-white/6">
              <p className="text-[11px] text-[#6B7280] mb-4">
                {t('adminChurn.tenure.description', { defaultValue: 'Automatically send a congratulatory notification when members reach tenure milestones. Helps celebrate loyalty and reduce churn.' })}
              </p>

              <div className="space-y-3 mb-4">
                {milestones.map((ms, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                        <Award size={14} className="text-[#D4AF37]" />
                      </div>
                      {i < milestones.length - 1 && <div className="w-px flex-1 bg-white/8 my-1" />}
                    </div>
                    <div className="flex-1 pb-2">
                      <div className="flex items-center gap-2 mb-1.5">
                        <label className="text-[11px] font-medium text-[#9CA3AF]">{t('adminChurn.tenure.daysLabel', { defaultValue: 'Days' })}</label>
                        <input type="number" min={1} value={ms.days} onChange={e => updateMilestone(i, 'days', Number(e.target.value))}
                          className="w-20 bg-[#111827] border border-white/6 rounded-lg px-2.5 py-1 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
                        <span className="text-[11px] text-[#6B7280]">
                          {ms.days === 90 && t('adminChurn.tenure.3months', { defaultValue: '(3 months)' })}
                          {ms.days === 180 && t('adminChurn.tenure.6months', { defaultValue: '(6 months)' })}
                          {ms.days === 365 && t('adminChurn.tenure.1year', { defaultValue: '(1 year)' })}
                        </span>
                      </div>
                      <textarea rows={2} value={ms.message} onChange={e => updateMilestone(i, 'message', e.target.value)}
                        className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-1.5 text-[11px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none"
                        placeholder={t('adminChurn.tenure.messagePlaceholder', { days: ms.days, defaultValue: `Congratulations on ${ms.days} days with us! Your dedication inspires everyone.` })} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <button onClick={saveTenureSettings} disabled={savingTenure}
                  className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors whitespace-nowrap ${tenureSaved ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[#D4AF37] text-black hover:bg-[#E6C766]'} disabled:opacity-50`}>
                  {tenureSaved ? <CheckCircle size={13} /> : <Save size={13} />}
                  {savingTenure ? t('adminChurn.tenure.saving', { defaultValue: 'Saving...' }) : tenureSaved ? t('adminChurn.tenure.saved', { defaultValue: 'Saved!' }) : t('adminChurn.tenure.save', { defaultValue: 'Save Milestones' })}
                </button>
                <p className="text-[10px] text-[#4B5563] ml-auto">
                  {t('adminChurn.tenure.hint', { defaultValue: 'Checked daily by the churn scoring pipeline' })}
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminCard>
    </FadeIn>
  );
}
