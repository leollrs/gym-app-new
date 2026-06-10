// TrainerAutomations.jsx
// -----------------------------------------------------------------------------
// Trainer-side manager for #7 — retention/progress autoflows. The trainer turns
// on rules ("alert me when a client goes 7 days without a workout"); a daily
// cron (run_trainer_automations, migration 0501) fires the notifications.
// -----------------------------------------------------------------------------

import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Zap } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { getTrainerAutomations, createAutomation, setAutomationActive, deleteAutomation } from '../../../lib/coaching';
import { TT, TFont } from './designTokens';
import { TPrimaryButton } from './designPrimitives';

export default function TrainerAutomations() {
  const { t } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [rules, setRules] = useState([]);
  const [adding, setAdding] = useState(false);
  const [triggerType, setTriggerType] = useState('inactivity');
  const [thresholdDays, setThresholdDays] = useState(7);
  const [action, setAction] = useState('notify_trainer');

  const load = useCallback(async () => {
    if (!profile?.id) return;
    try { setRules(await getTrainerAutomations(profile.id)); } catch { /* best-effort */ }
  }, [profile?.id]);

  useEffect(() => { load(); }, [load]);

  const describe = (r) => {
    const n = r.threshold_days;
    if (r.trigger_type === 'inactivity') {
      return r.action === 'nudge_member'
        ? t('trainerAutomations.descInactivityNudge', { count: n, defaultValue: `Nudge a client after ${n} days without a workout` })
        : t('trainerAutomations.descInactivityAlert', { count: n, defaultValue: `Alert me when a client goes ${n} days without a workout` });
    }
    return r.action === 'nudge_member'
      ? t('trainerAutomations.descCheckinNudge', { defaultValue: 'Remind a client who misses their weekly check-in' })
      : t('trainerAutomations.descCheckinAlert', { defaultValue: 'Alert me when a client misses their weekly check-in' });
  };

  const handleAdd = async () => {
    if (!profile?.id) return;
    const { error } = await createAutomation({
      gymId: profile.gym_id, trainerId: profile.id, triggerType,
      thresholdDays: triggerType === 'inactivity' ? thresholdDays : 7, action,
    });
    if (error) { showToast(t('trainerAutomations.saveError', { defaultValue: "Couldn't save the automation." }), 'error'); return; }
    setAdding(false); setTriggerType('inactivity'); setThresholdDays(7); setAction('notify_trainer');
    load();
  };

  const handleToggle = async (r) => {
    const prev = rules;
    setRules((rs) => rs.map((x) => x.id === r.id ? { ...x, is_active: !x.is_active } : x));
    const { error } = await setAutomationActive(r.id, !r.is_active);
    if (error) { setRules(prev); showToast(t('trainerAutomations.saveError', { defaultValue: "Couldn't update the automation." }), 'error'); }
  };

  const handleDelete = async (id) => {
    const prev = rules;
    setRules((rs) => rs.filter((x) => x.id !== id));
    const { error } = await deleteAutomation(id);
    if (error) { setRules(prev); showToast(t('trainerAutomations.saveError', { defaultValue: "Couldn't remove the automation." }), 'error'); }
  };

  const inputStyle = { padding: '9px 11px', borderRadius: 9, border: `1px solid ${TT.borderSolid}`, background: TT.surface, color: TT.text, fontSize: 13, fontFamily: 'inherit', outline: 'none' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Zap size={16} style={{ color: TT.accent }} />
        <span style={{ fontFamily: TFont.display, fontSize: 15, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>
          {t('trainerAutomations.title', { defaultValue: 'Automations' })}
        </span>
      </div>
      <div style={{ fontSize: 12, color: TT.textMute, marginBottom: 12 }}>
        {t('trainerAutomations.subtitle', { defaultValue: 'Get pinged when a client needs a nudge — so no one slips away unnoticed.' })}
      </div>

      {rules.map((r) => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, padding: '11px 12px', borderRadius: 14, border: `1px solid ${TT.border}`, background: TT.surface, boxShadow: TT.shadow }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: r.is_active ? TT.text : TT.textMute }}>
            {describe(r)}
          </span>
          {/* Active toggle */}
          <button type="button" role="switch" aria-checked={r.is_active} onClick={() => handleToggle(r)}
            style={{ position: 'relative', width: 40, height: 23, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0,
              background: r.is_active ? TT.accent : TT.borderSolid }}>
            <span style={{ position: 'absolute', top: 2, left: r.is_active ? 19 : 2, width: 19, height: 19, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 2px rgba(15,20,25,0.2)' }} />
          </button>
          <button type="button" onClick={() => handleDelete(r.id)} aria-label="remove" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: TT.textMute }}>
            <Trash2 size={15} />
          </button>
        </div>
      ))}

      {!adding ? (
        <button type="button" onClick={() => setAdding(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: `1px dashed ${TT.borderStrong}`, background: 'transparent', color: TT.accentDark, fontWeight: 700, fontSize: 13, cursor: 'pointer', marginTop: 4 }}>
          <Plus size={15} /> {t('trainerAutomations.addRule', { defaultValue: 'Add automation' })}
        </button>
      ) : (
        <div style={{ marginTop: 8, padding: 14, borderRadius: 14, border: `1px solid ${TT.border}`, background: TT.surface, boxShadow: TT.shadow }}>
          <label style={{ display: 'block', fontSize: 11, color: TT.textMute, marginBottom: 4 }}>{t('trainerAutomations.when', { defaultValue: 'When' })}</label>
          <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} style={{ ...inputStyle, width: '100%', marginBottom: 10 }}>
            <option value="inactivity">{t('trainerAutomations.triggerInactivity', { defaultValue: 'A client stops training' })}</option>
            <option value="missed_checkin">{t('trainerAutomations.triggerMissedCheckin', { defaultValue: 'A client misses their check-in' })}</option>
          </select>

          {triggerType === 'inactivity' && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 11, color: TT.textMute, marginBottom: 4 }}>{t('trainerAutomations.afterDays', { defaultValue: 'After how many days?' })}</label>
              <select value={thresholdDays} onChange={(e) => setThresholdDays(Number(e.target.value))} style={{ ...inputStyle, width: '100%' }}>
                {[3, 5, 7, 10, 14].map((n) => <option key={n} value={n}>{t('trainerAutomations.days', { count: n, defaultValue: `${n} days` })}</option>)}
              </select>
            </div>
          )}

          <label style={{ display: 'block', fontSize: 11, color: TT.textMute, marginBottom: 4 }}>{t('trainerAutomations.then', { defaultValue: 'Then' })}</label>
          <select value={action} onChange={(e) => setAction(e.target.value)} style={{ ...inputStyle, width: '100%', marginBottom: 12 }}>
            <option value="notify_trainer">{t('trainerAutomations.actionNotify', { defaultValue: 'Alert me' })}</option>
            <option value="nudge_member">{t('trainerAutomations.actionNudge', { defaultValue: 'Nudge the member' })}</option>
          </select>

          <div style={{ display: 'flex', gap: 8 }}>
            <TPrimaryButton onClick={handleAdd} style={{ flex: 1, padding: '10px 0' }}>
              {t('trainerAutomations.save', { defaultValue: 'Save' })}
            </TPrimaryButton>
            <button type="button" onClick={() => setAdding(false)}
              style={{ padding: '10px 16px', borderRadius: 12, border: `1px solid ${TT.borderSolid}`, background: TT.surface2, color: TT.textSub, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: TFont.display }}>
              {t('trainerAutomations.cancel', { defaultValue: 'Cancel' })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
