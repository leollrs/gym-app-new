// TrainerClientCoaching.jsx
// -----------------------------------------------------------------------------
// Trainer-side surface for #6, framed as PROGRESS TRACKING (not remote
// coaching): author recurring check-in forms for this client + read their
// responses, and assign daily habits + see completion. Lives as the "Check-ins"
// tab inside the client detail view.
// -----------------------------------------------------------------------------

import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, ClipboardList, Flame } from 'lucide-react';
import { useToast } from '../../../contexts/ToastContext';
import {
  getClientCheckins, createCheckinTemplate, assignCheckin,
  getClientHabits, createHabitForClient, deactivateHabit,
} from '../../../lib/coaching';

const newId = () => (globalThis.crypto?.randomUUID?.() || `q_${Math.random().toString(36).slice(2)}`);

const PRESETS = [
  { key: 'weight',    label: 'Body weight', type: 'number', unit: 'lbs' },
  { key: 'energy',    label: 'Energy',      type: 'scale', min: 1, max: 10 },
  { key: 'sleep',     label: 'Sleep quality', type: 'scale', min: 1, max: 10 },
  { key: 'adherence', label: 'Plan adherence', type: 'scale', min: 1, max: 10 },
  { key: 'notes',     label: 'Notes', type: 'text' },
];

const HABIT_PRESETS = ['Water 3L', 'Sleep 8h', '10k steps', 'Protein target', 'Stretch 10 min'];

export default function TrainerClientCoaching({ clientId, gymId, trainerId }) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const [checkins, setCheckins] = useState({ templates: [], responses: [] });
  const [habits, setHabits] = useState([]);
  const [building, setBuilding] = useState(false);
  const [savingTpl, setSavingTpl] = useState(false);
  const [title, setTitle] = useState('');
  const [cadence, setCadence] = useState('weekly');
  const [questions, setQuestions] = useState([]);
  const [habitName, setHabitName] = useState('');
  const [habitTarget, setHabitTarget] = useState(7);

  const load = useCallback(async () => {
    try {
      const [c, h] = await Promise.all([getClientCheckins(clientId), getClientHabits(clientId)]);
      setCheckins(c);
      setHabits(h);
    } catch {
      // best-effort surface
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const addPreset = (p) => setQuestions((qs) =>
    qs.some((q) => q.label === p.label) ? qs : [...qs, { id: newId(), ...p }]);
  const removeQuestion = (id) => setQuestions((qs) => qs.filter((q) => q.id !== id));

  const handleSaveTemplate = async () => {
    if (!title.trim() || questions.length === 0) {
      showToast(t('trainerCoaching.needTitleQuestions', { defaultValue: 'Add a title and at least one question.' }), 'error');
      return;
    }
    setSavingTpl(true);
    const { data: tpl, error } = await createCheckinTemplate({
      gymId, createdBy: trainerId, title: title.trim(), description: null, cadence, questions,
    });
    if (error || !tpl) {
      setSavingTpl(false);
      showToast(t('trainerCoaching.saveError', { defaultValue: "Couldn't save the check-in." }), 'error');
      return;
    }
    const { error: aErr } = await assignCheckin({ templateId: tpl.id, profileId: clientId, gymId, assignedBy: trainerId });
    setSavingTpl(false);
    if (aErr) {
      showToast(t('trainerCoaching.assignError', { defaultValue: 'Saved, but assigning to the client failed.' }), 'error');
      return;
    }
    setBuilding(false); setTitle(''); setQuestions([]); setCadence('weekly');
    showToast(t('trainerCoaching.assigned', { defaultValue: 'Check-in assigned.' }), 'success');
    load();
  };

  const handleAddHabit = async () => {
    if (!habitName.trim()) return;
    const { error } = await createHabitForClient({
      gymId, profileId: clientId, createdBy: trainerId, name: habitName.trim(), targetPerWeek: habitTarget,
    });
    if (error) {
      showToast(t('trainerCoaching.habitError', { defaultValue: "Couldn't add the habit." }), 'error');
      return;
    }
    setHabitName('');
    load();
  };

  const handleRemoveHabit = async (id) => {
    const prev = habits;
    setHabits((h) => h.filter((x) => x.id !== id)); // optimistic
    const { error } = await deactivateHabit(id);
    if (error) { setHabits(prev); showToast(t('trainerCoaching.habitError', { defaultValue: "Couldn't remove the habit." }), 'error'); }
  };

  const respByTemplate = new Map();
  for (const r of checkins.responses) {
    if (!respByTemplate.has(r.template_id)) respByTemplate.set(r.template_id, r); // latest (already desc)
  }

  const inputStyle = { width: '100%', padding: '9px 11px', borderRadius: 9, border: '1px solid var(--color-border-subtle)', background: 'var(--color-surface-hover, transparent)', color: 'var(--color-text-primary)', fontSize: 13 };
  const sectionTitle = { fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-text-muted)', margin: '4px 0 10px' };

  return (
    <div style={{ padding: '4px 2px 24px' }}>
      {/* ── Check-ins ─────────────────────────────────────────── */}
      <div style={sectionTitle}>{t('trainerCoaching.checkinsTitle', { defaultValue: 'Check-ins' })}</div>

      {checkins.templates.length === 0 && !building && (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
          {t('trainerCoaching.noCheckins', { defaultValue: 'No check-ins yet. Create one to track how this member is doing each week.' })}
        </div>
      )}

      {checkins.templates.map((tpl) => {
        const latest = respByTemplate.get(tpl.id);
        return (
          <div key={tpl.id} style={{ marginBottom: 10, padding: 12, borderRadius: 12, border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-card, #fff)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ClipboardList size={15} style={{ color: 'var(--color-accent)' }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>{tpl.title}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>{tpl.cadence}</span>
            </div>
            {latest ? (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(tpl.questions || []).map((q) => latest.answers?.[q.id] !== undefined && latest.answers?.[q.id] !== '' ? (
                  <span key={q.id} style={{ fontSize: 12, padding: '3px 8px', borderRadius: 8, background: 'var(--color-surface-hover, rgba(0,0,0,0.04))', color: 'var(--color-text-primary)' }}>
                    <strong>{q.label}:</strong> {String(latest.answers[q.id])}{q.unit ? ` ${q.unit}` : ''}
                  </span>
                ) : null)}
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', width: '100%' }}>
                  {t('trainerCoaching.lastResponse', { date: latest.period_start, defaultValue: `Week of ${latest.period_start}` })}
                </span>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
                {t('trainerCoaching.noResponseYet', { defaultValue: 'No response yet.' })}
              </div>
            )}
          </div>
        );
      })}

      {!building ? (
        <button type="button" onClick={() => setBuilding(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: '1px dashed var(--color-border-subtle)', background: 'transparent', color: 'var(--color-accent)', fontWeight: 700, fontSize: 13, cursor: 'pointer', marginBottom: 18 }}>
          <Plus size={15} /> {t('trainerCoaching.newCheckin', { defaultValue: 'New check-in' })}
        </button>
      ) : (
        <div style={{ marginBottom: 18, padding: 14, borderRadius: 12, border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-card, #fff)' }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('trainerCoaching.titlePlaceholder', { defaultValue: 'Title (e.g. Weekly check-in)' })} style={{ ...inputStyle, marginBottom: 8 }} />
          <select value={cadence} onChange={(e) => setCadence(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }}>
            <option value="weekly">{t('trainerCoaching.weekly', { defaultValue: 'Weekly' })}</option>
            <option value="biweekly">{t('trainerCoaching.biweekly', { defaultValue: 'Every 2 weeks' })}</option>
            <option value="monthly">{t('trainerCoaching.monthly', { defaultValue: 'Monthly' })}</option>
          </select>

          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>{t('trainerCoaching.addQuestions', { defaultValue: 'Add questions' })}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {PRESETS.map((p) => (
              <button key={p.key} type="button" onClick={() => addPreset(p)}
                style={{ fontSize: 12, padding: '5px 10px', borderRadius: 999, border: '1px solid var(--color-border-subtle)', background: 'transparent', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                + {t(`trainerCoaching.preset.${p.key}`, { defaultValue: p.label })}
              </button>
            ))}
          </div>

          {questions.map((q) => (
            <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 13, color: 'var(--color-text-primary)' }}>
              <span style={{ flex: 1 }}>{q.label} <span style={{ color: 'var(--color-text-muted)' }}>· {q.type}{q.unit ? ` (${q.unit})` : ''}</span></span>
              <button type="button" onClick={() => removeQuestion(q.id)} aria-label="remove" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)' }}><Trash2 size={15} /></button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" onClick={handleSaveTemplate} disabled={savingTpl}
              style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: 'var(--color-accent)', color: '#fff', fontWeight: 800, fontSize: 13, cursor: savingTpl ? 'default' : 'pointer', opacity: savingTpl ? 0.6 : 1 }}>
              {savingTpl ? t('trainerCoaching.saving', { defaultValue: 'Saving…' }) : t('trainerCoaching.saveAssign', { defaultValue: 'Save & assign' })}
            </button>
            <button type="button" onClick={() => { setBuilding(false); setQuestions([]); setTitle(''); }}
              style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid var(--color-border-subtle)', background: 'transparent', color: 'var(--color-text-muted)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              {t('trainerCoaching.cancel', { defaultValue: 'Cancel' })}
            </button>
          </div>
        </div>
      )}

      {/* ── Habits ────────────────────────────────────────────── */}
      <div style={sectionTitle}>{t('trainerCoaching.habitsTitle', { defaultValue: 'Habits' })}</div>

      {habits.map((h) => (
        <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, padding: '10px 12px', borderRadius: 11, border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-card, #fff)' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)', flex: 1 }}>{h.name}</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Flame size={12} />{h.recentCount}{h.target_per_week ? ` · ${t('trainerCoaching.perWeek', { count: h.target_per_week, defaultValue: `${h.target_per_week}/wk` })}` : ''}
          </span>
          <button type="button" onClick={() => handleRemoveHabit(h.id)} aria-label="remove" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)' }}><Trash2 size={15} /></button>
        </div>
      ))}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0 8px' }}>
        {HABIT_PRESETS.map((p) => (
          <button key={p} type="button" onClick={() => setHabitName(p)}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 999, border: '1px solid var(--color-border-subtle)', background: 'transparent', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
            + {p}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={habitName} onChange={(e) => setHabitName(e.target.value)} placeholder={t('trainerCoaching.habitPlaceholder', { defaultValue: 'New habit' })} style={{ ...inputStyle, flex: 1 }} />
        <select value={habitTarget} onChange={(e) => setHabitTarget(Number(e.target.value))} style={{ ...inputStyle, width: 90 }}>
          {[3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}/wk</option>)}
        </select>
        <button type="button" onClick={handleAddHabit}
          style={{ padding: '9px 14px', borderRadius: 10, border: 'none', background: 'var(--color-accent)', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
          {t('trainerCoaching.add', { defaultValue: 'Add' })}
        </button>
      </div>
    </div>
  );
}
