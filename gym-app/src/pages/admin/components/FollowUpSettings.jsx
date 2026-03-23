import { useState } from 'react';
import {
  ToggleLeft, ToggleRight, Save, CheckCircle, ChevronDown, Plus, X, Activity,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { FadeIn, AdminCard } from '../../../components/admin';
import { formatDistanceToNow } from 'date-fns';

const DEFAULT_SETTINGS = {
  enabled: false,
  threshold: 55,
  cooldown_days: 7,
  message_template: "Hey! We noticed you haven't been in lately. We miss you — come back and crush your goals. Your progress is waiting!",
  last_run_at: null,
  last_run_count: 0,
};

export default function FollowUpSettings({ gymId, initialSettings, initialSteps, atRiskCount = 0, delay = 0 }) {
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [fupDraft, setFupDraft] = useState({ ...DEFAULT_SETTINGS, ...initialSettings });
  const [savingFup, setSavingFup] = useState(false);
  const [fupSaved, setFupSaved] = useState(false);
  const [steps, setSteps] = useState(
    initialSteps?.length
      ? initialSteps
      : [{ step_number: 1, delay_days: 0, message_template: DEFAULT_SETTINGS.message_template }]
  );

  const lastRunLabel = initialSettings?.last_run_at
    ? formatDistanceToNow(new Date(initialSettings.last_run_at), { addSuffix: true })
    : null;

  const addStep = () => {
    setSteps(prev => [...prev, { step_number: prev.length + 1, delay_days: 3, message_template: '' }]);
  };
  const removeStep = (idx) => {
    setSteps(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_number: i + 1 })));
  };
  const updateStep = (idx, field, value) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
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
      updated_at: new Date().toISOString(),
    };
    await supabase.from('churn_followup_settings').upsert(payload, { onConflict: 'gym_id' });
    await supabase.from('drip_campaign_steps').delete().eq('gym_id', gymId);
    if (steps.length > 0) {
      await supabase.from('drip_campaign_steps').insert(
        steps.map(s => ({ gym_id: gymId, step_number: s.step_number, delay_days: s.delay_days, message_template: s.message_template }))
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
          <div className="flex items-center gap-3">
            <p className="text-[13px] font-semibold text-[#E5E7EB]">Automated Follow-Up</p>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${fupDraft.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-[#6B7280]'}`}>
              {fupDraft.enabled ? 'On' : 'Off'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setFupDraft(d => ({ ...d, enabled: !d.enabled }))} className="flex items-center gap-1 transition-colors">
              {fupDraft.enabled ? <ToggleRight size={22} className="text-[#D4AF37]" /> : <ToggleLeft size={22} className="text-[#4B5563]" />}
            </button>
            <button onClick={() => setShowFollowUp(v => !v)} className="flex items-center gap-1 text-[11px] text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors ml-1">
              Configure
              <ChevronDown size={13} className={`transition-transform ${showFollowUp ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        <div className={`grid transition-all duration-300 ease-in-out ${showFollowUp ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden">
            <div className="pt-3 mt-3 border-t border-white/6">
              <p className="text-[11px] text-[#6B7280] mb-3">Runs daily at 2 AM UTC — sends in-app notifications to at-risk members</p>

              {initialSettings?.last_run_at && (
                <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-emerald-500/8 border border-emerald-500/15 rounded-lg">
                  <Activity size={12} className="text-emerald-400 flex-shrink-0" />
                  <p className="text-[11px] text-emerald-400">
                    Last run {lastRunLabel} · {initialSettings.last_run_count} notification{initialSettings.last_run_count !== 1 ? 's' : ''} sent
                  </p>
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1.5">Risk Threshold</label>
                  <div className="flex gap-2">
                    {[{ label: 'Medium (30%+)', value: 30 }, { label: 'High (55%+)', value: 55 }, { label: 'Critical (80%+)', value: 80 }].map(opt => (
                      <button key={opt.value} onClick={() => setFupDraft(d => ({ ...d, threshold: opt.value }))}
                        className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors border ${fupDraft.threshold === opt.value ? 'bg-[#D4AF37]/10 border-[#D4AF37]/30 text-[#D4AF37]' : 'border-white/6 text-[#6B7280] hover:text-[#9CA3AF]'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1.5">Cooldown Between Notifications</label>
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

              {/* Drip Campaign Steps */}
              <div className="mb-4">
                <label className="block text-[11px] font-medium text-[#9CA3AF] mb-2">Campaign Steps</label>
                <p className="text-[10px] text-[#4B5563] mb-2.5">Sent as in-app notifications · members see them in their notification bell</p>
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
                            {step.delay_days === 0 ? 'Immediately' : `After ${step.delay_days} day${step.delay_days !== 1 ? 's' : ''}`}
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
                        <textarea rows={2} value={step.message_template} onChange={e => updateStep(i, 'message_template', e.target.value)}
                          className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-1.5 text-[11px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none"
                          placeholder="Message to send..." />
                      </div>
                    </div>
                  ))}
                </div>
                {steps.length < 5 && (
                  <button onClick={addStep} className="flex items-center gap-1.5 text-[11px] font-medium text-[#D4AF37] hover:text-[#E6C766] transition-colors mt-1.5">
                    <Plus size={13} /> Add step
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button onClick={saveSettings} disabled={savingFup}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors ${fupSaved ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[#D4AF37] text-black hover:bg-[#E6C766]'} disabled:opacity-50`}>
                  {fupSaved ? <CheckCircle size={13} /> : <Save size={13} />}
                  {savingFup ? 'Saving…' : fupSaved ? 'Saved!' : 'Save Settings'}
                </button>
                <p className="text-[10px] text-[#4B5563] ml-auto">
                  {atRiskCount} member{atRiskCount !== 1 ? 's' : ''} at critical/high risk
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminCard>
    </FadeIn>
  );
}
