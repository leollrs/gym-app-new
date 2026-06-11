// TrainerClientCoaching.jsx
// -----------------------------------------------------------------------------
// Trainer-side surface for #6, framed as PROGRESS TRACKING (not remote
// coaching): author recurring check-in forms for this client + read their
// responses, and assign daily habits + see completion. Lives as the "Check-ins"
// tab inside the client detail view.
// -----------------------------------------------------------------------------

import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { enUS } from 'date-fns/locale/en-US';
import { Plus, Trash2, History, Droplet, Moon, TrendingUp, Utensils, Activity } from 'lucide-react';
import { useToast } from '../../../contexts/ToastContext';
import {
  getClientCheckins, createCheckinTemplate, assignCheckin,
  getClientHabits, createHabitForClient, deactivateHabit,
} from '../../../lib/coaching';
import { TT, TFont } from './designTokens';

// Decorative tone + icon cycle for habit rows (habits rarely carry an `icon`).
// Index-stable so a given row keeps its look; never derived from member data.
const HABIT_TONES = ['#27B0A0', '#7A6BE0', '#F08A3C', '#2FA66B', '#1E9C8E'];
const HABIT_ICONS = [Droplet, Moon, TrendingUp, Utensils, Activity];

const newId = () => (globalThis.crypto?.randomUUID?.() || `q_${Math.random().toString(36).slice(2)}`);

// NOTE: `label` strings here are i18n DEFAULTS only — the rendered chips AND
// the labels persisted to the DB (which the MEMBER sees in their check-in
// form) are resolved through t('trainerCoaching.preset.<key>') /
// t('trainerCoaching.habitPreset.<key>') so a Spanish-locale trainer stores
// Spanish labels.
const PRESETS = [
  { key: 'weight',    label: 'Body weight', type: 'number', unit: 'lbs' },
  { key: 'energy',    label: 'Energy',      type: 'scale', min: 1, max: 10 },
  { key: 'sleep',     label: 'Sleep quality', type: 'scale', min: 1, max: 10 },
  { key: 'adherence', label: 'Plan adherence', type: 'scale', min: 1, max: 10 },
  { key: 'notes',     label: 'Notes', type: 'text' },
];

const HABIT_PRESETS = [
  { key: 'water',   label: 'Water 3L' },
  { key: 'sleep8',  label: 'Sleep 8h' },
  { key: 'steps',   label: '10k steps' },
  { key: 'protein', label: 'Protein target' },
  { key: 'stretch', label: 'Stretch 10 min' },
];

// Stored cadence values → existing trainerCoaching.* label keys (explicit map
// so an unexpected cadence value never resolves an unrelated key).
const CADENCE_LABELS = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly' };

export default function TrainerClientCoaching({ clientId, gymId, trainerId }) {
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? es : enUS;
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

  // Resolve the member-facing label through i18n at ADD time — the stored
  // question label is what the member sees in their check-in form.
  const addPreset = (p) => {
    const label = t(`trainerCoaching.preset.${p.key}`, { defaultValue: p.label });
    setQuestions((qs) => qs.some((q) => q.label === label) ? qs : [...qs, { id: newId(), ...p, label }]);
  };
  const removeQuestion = (id) => setQuestions((qs) => qs.filter((q) => q.id !== id));

  const cadenceLabel = (c) =>
    CADENCE_LABELS[c] ? t(`trainerCoaching.${c}`, { defaultValue: CADENCE_LABELS[c] }) : c;

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

  // Responses grouped per template (already sorted desc) → [latest, prior, …].
  const respListByTemplate = new Map();
  for (const r of checkins.responses) {
    if (!respListByTemplate.has(r.template_id)) respListByTemplate.set(r.template_id, []);
    respListByTemplate.get(r.template_id).push(r);
  }

  const fmtPeriod = (ps) => {
    // period_start is date-only (YYYY-MM-DD) — parseISO keeps local time.
    const d = ps ? parseISO(ps) : null;
    return d && !isNaN(d) ? format(d, 'MMM d', { locale: dateFnsLocale }) : (ps || '');
  };

  const inputStyle = { width: '100%', padding: '9px 11px', borderRadius: 9, border: `1px solid ${TT.borderSolid}`, background: TT.surface2, color: TT.text, fontSize: 13 };
  const sectionTitle = { fontFamily: TFont.display, fontSize: 16, fontWeight: 800, letterSpacing: -0.3, color: TT.text, margin: '0 0 11px' };

  return (
    <div style={{ padding: '16px 16px 24px' }}>
      {/* ── Check-ins ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0 0 11px' }}>
        <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, letterSpacing: -0.3, color: TT.text }}>
          {t('trainerCoaching.checkinsTitle', { defaultValue: 'Check-ins' })}
        </div>
        {!building && (
          <button type="button" onClick={() => setBuilding(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', color: TT.accent, fontFamily: TFont.display, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
            <Plus size={14} strokeWidth={2.4} /> {t('trainerCoaching.new', { defaultValue: 'New' })}
          </button>
        )}
      </div>

      {checkins.templates.length === 0 && !building && (
        <div style={{ fontSize: 13, color: TT.textMute, marginBottom: 12 }}>
          {t('trainerCoaching.noCheckins', { defaultValue: 'No check-ins yet. Create one to track how this member is doing each week.' })}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 18 }}>
      {checkins.templates.map((tpl) => {
        const list = respListByTemplate.get(tpl.id) || [];
        const latest = list[0] || null;
        const prior = list.slice(1, 3); // up to 2 collapsed prior weeks
        // Answered questions become the stat cluster (data-driven, not the mock's fixed 4).
        const stats = (tpl.questions || [])
          .filter((q) => latest && latest.answers?.[q.id] !== undefined && latest.answers?.[q.id] !== '')
          .map((q) => ({ l: q.label, v: `${String(latest.answers[q.id])}${q.unit ? ` ${q.unit}` : ''}` }));
        return (
          <div key={tpl.id} style={{ background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: 'var(--tt-card-radius, 20px)', boxShadow: TT.shadow, padding: 15 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: TFont.display, fontSize: 14.5, fontWeight: 800, color: TT.text }}>
                  {latest ? t('trainerCoaching.weekOf', { date: fmtPeriod(latest.period_start), defaultValue: `Week of ${fmtPeriod(latest.period_start)}` }) : tpl.title}
                </div>
                <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 2 }}>{latest ? `${tpl.title} · ${cadenceLabel(tpl.cadence)}` : cadenceLabel(tpl.cadence)}</div>
              </div>
              {latest ? (
                <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: TT.goodSoft, color: TT.goodInk, whiteSpace: 'nowrap' }}>
                  {t('trainerCoaching.completed', { defaultValue: 'Completed' })}
                </span>
              ) : (
                <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: TT.warnSoft, color: TT.warnInk, whiteSpace: 'nowrap' }}>
                  {t('trainerCoaching.pending', { defaultValue: 'Pending' })}
                </span>
              )}
            </div>
            {stats.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '13px 18px', marginTop: 13 }}>
                {stats.map((s, i) => (
                  <div key={i}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: TT.textMute, letterSpacing: 0.5, textTransform: 'uppercase' }}>{s.l}</div>
                    <div style={{ fontFamily: TFont.display, fontSize: 15, fontWeight: 800, color: TT.text, marginTop: 3 }}>{s.v}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: TT.textMute, marginTop: 8 }}>
                {t('trainerCoaching.noResponseYet', { defaultValue: 'No response yet.' })}
              </div>
            )}
            {prior.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: i === 0 ? 13 : 8, paddingTop: i === 0 ? 12 : 0, borderTop: i === 0 ? `1px solid ${TT.border}` : 'none' }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: TT.surface2, display: 'grid', placeItems: 'center', boxShadow: 'inset 0 0 0 1px var(--tt-border)', flexShrink: 0 }}>
                  <History size={15} style={{ color: TT.textMute }} />
                </div>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: TT.textSub }}>
                  {t('trainerCoaching.weekOf', { date: fmtPeriod(p.period_start), defaultValue: `Week of ${fmtPeriod(p.period_start)}` })}
                </div>
              </div>
            ))}
          </div>
        );
      })}
      </div>

      {building && (
        <div style={{ marginBottom: 18, padding: 14, borderRadius: 'var(--tt-card-radius, 20px)', border: `1px solid ${TT.border}`, background: TT.surface, boxShadow: TT.shadow }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('trainerCoaching.titlePlaceholder', { defaultValue: 'Title (e.g. Weekly check-in)' })} style={{ ...inputStyle, marginBottom: 8 }} />
          <select value={cadence} onChange={(e) => setCadence(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }}>
            <option value="weekly">{t('trainerCoaching.weekly', { defaultValue: 'Weekly' })}</option>
            <option value="biweekly">{t('trainerCoaching.biweekly', { defaultValue: 'Every 2 weeks' })}</option>
            <option value="monthly">{t('trainerCoaching.monthly', { defaultValue: 'Monthly' })}</option>
          </select>

          <div style={{ fontSize: 11, color: TT.textMute, marginBottom: 6 }}>{t('trainerCoaching.addQuestions', { defaultValue: 'Add questions' })}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {PRESETS.map((p) => (
              <button key={p.key} type="button" onClick={() => addPreset(p)}
                style={{ fontSize: 12, padding: '5px 10px', borderRadius: 999, border: `1px solid ${TT.border}`, background: 'transparent', color: TT.text, cursor: 'pointer' }}>
                + {t(`trainerCoaching.preset.${p.key}`, { defaultValue: p.label })}
              </button>
            ))}
          </div>

          {questions.map((q) => (
            <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 13, color: TT.text }}>
              <span style={{ flex: 1 }}>{q.label} <span style={{ color: TT.textMute }}>· {q.type}{q.unit ? ` (${q.unit})` : ''}</span></span>
              <button type="button" onClick={() => removeQuestion(q.id)} aria-label="remove" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: TT.textMute }}><Trash2 size={15} /></button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" onClick={handleSaveTemplate} disabled={savingTpl}
              className="tt-btn tt-btn--primary"
              style={{ flex: 1, padding: '10px 0', borderRadius: 11, fontFamily: TFont.display, fontWeight: 800, fontSize: 13, opacity: savingTpl ? 0.6 : 1 }}>
              {savingTpl ? t('trainerCoaching.saving', { defaultValue: 'Saving…' }) : t('trainerCoaching.saveAssign', { defaultValue: 'Save & assign' })}
            </button>
            <button type="button" onClick={() => { setBuilding(false); setQuestions([]); setTitle(''); }}
              className="tt-btn tt-btn--secondary"
              style={{ padding: '10px 16px', borderRadius: 11, fontFamily: TFont.display, fontWeight: 700, fontSize: 13 }}>
              {t('trainerCoaching.cancel', { defaultValue: 'Cancel' })}
            </button>
          </div>
        </div>
      )}

      {/* ── Habits ────────────────────────────────────────────── */}
      <div style={sectionTitle}>{t('trainerCoaching.habitsTitle', { defaultValue: 'Habits' })}</div>

      <div style={{ background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: 'var(--tt-card-radius, 20px)', boxShadow: TT.shadow, overflow: 'hidden' }}>
        {habits.map((h, idx) => {
          const tone = HABIT_TONES[idx % HABIT_TONES.length];
          const Icon = HABIT_ICONS[idx % HABIT_ICONS.length];
          const goal = h.target_per_week || 7;
          const done = Math.min(h.recentCount || 0, goal); // recent activity vs target
          const hit = done >= goal;
          return (
            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', borderTop: idx > 0 ? `1px solid ${TT.border}` : 'none' }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, background: `color-mix(in srgb, ${tone} 16%, transparent)`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Icon size={18} strokeWidth={2.1} style={{ color: tone }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: TT.text }}>{h.name}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  {Array.from({ length: goal }).map((_, k) => (
                    <span key={k} style={{ width: 14, height: 6, borderRadius: 999, background: k < done ? tone : TT.border }} />
                  ))}
                </div>
              </div>
              <span style={{ fontFamily: TFont.display, fontSize: 13, fontWeight: 800, color: hit ? tone : TT.textSub }}>{done}/{goal}</span>
              <button type="button" onClick={() => handleRemoveHabit(h.id)} aria-label={t('trainerCoaching.removeHabit', { defaultValue: 'Remove habit' })}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: TT.textMute, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
        {/* Add habit row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 15px', borderTop: habits.length > 0 ? `1px solid ${TT.border}` : 'none' }}>
          <input value={habitName} onChange={(e) => setHabitName(e.target.value)} placeholder={t('trainerCoaching.habitPlaceholder', { defaultValue: 'New habit…' })}
            style={{ flex: 1, height: 38, padding: '0 12px', borderRadius: 10, border: 'none', boxShadow: 'inset 0 0 0 1px var(--tt-border)', background: TT.surface2, color: TT.text, fontSize: 13, outline: 'none' }} />
          <select value={habitTarget} onChange={(e) => setHabitTarget(Number(e.target.value))}
            style={{ height: 38, padding: '0 8px', borderRadius: 10, border: 'none', boxShadow: 'inset 0 0 0 1px var(--tt-border)', background: TT.surface2, color: TT.text, fontSize: 12.5, fontWeight: 700, outline: 'none', cursor: 'pointer' }}>
            {[3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{t('trainerCoaching.perWeek', { count: n, defaultValue: `${n}/wk` })}</option>)}
          </select>
          <button type="button" onClick={handleAddHabit}
            className="tt-btn tt-btn--primary"
            style={{ padding: '0 16px', height: 38, borderRadius: 10, fontFamily: TFont.display, fontWeight: 800, fontSize: 13 }}>
            {t('trainerCoaching.add', { defaultValue: 'Add' })}
          </button>
        </div>
      </div>

      {/* Quick suggestions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
        {HABIT_PRESETS.map((p) => {
          // Translated at click time too — the habit name is stored verbatim
          // and is what the member sees on their daily habit list.
          const label = t(`trainerCoaching.habitPreset.${p.key}`, { defaultValue: p.label });
          return (
            <button key={p.key} type="button" onClick={() => setHabitName(label)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 999, border: 'none', boxShadow: 'inset 0 0 0 1px var(--tt-border)', background: TT.surface, color: TT.textSub, cursor: 'pointer' }}>
              <Plus size={13} strokeWidth={2.4} style={{ color: TT.accent }} /> {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
