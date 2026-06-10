// CoachingSection.jsx
// -----------------------------------------------------------------------------
// Member-facing surface for #6: shows the check-ins a trainer has assigned
// (tap to fill this week) and the member's daily habits (tap to tick off).
// Renders nothing when the member has neither — so it's invisible for gyms
// without a trainer tier.
// -----------------------------------------------------------------------------

import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Check, X, Flame } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getMemberCoaching, submitCheckin, setHabitLog, mondayOf, todayStr } from '../lib/coaching';

function CheckinModal({ template, profileId, gymId, period, existing, onClose, onSaved, t }) {
  const questions = Array.isArray(template.questions) ? template.questions : [];
  const [answers, setAnswers] = useState(() => ({ ...(existing?.answers || {}) }));
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const setAns = (qid, val) => setAnswers((a) => ({ ...a, [qid]: val }));

  const handleSubmit = async () => {
    setSaving(true);
    const { error } = await submitCheckin({ templateId: template.id, profileId, gymId, periodStart: period, answers });
    setSaving(false);
    if (error) {
      showToast(t('coaching.saveError', { defaultValue: "Couldn't save your check-in. Try again." }), 'error');
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto',
          background: 'var(--color-bg-card, #fff)', borderTopLeftRadius: 22, borderTopRightRadius: 22,
          padding: '20px 20px 28px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-text-primary)' }}>{template.title}</div>
            {template.description && (
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>{template.description}</div>
            )}
          </div>
          <button onClick={onClose} aria-label={t('coaching.close', { defaultValue: 'Close' })}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            <X size={22} />
          </button>
        </div>

        {questions.map((q) => (
          <div key={q.id} style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 6 }}>
              {q.label}{q.unit ? ` (${q.unit})` : ''}
            </label>

            {q.type === 'scale' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Array.from({ length: (q.max || 10) - (q.min || 1) + 1 }).map((_, i) => {
                  const v = (q.min || 1) + i;
                  const active = answers[q.id] === v;
                  return (
                    <button key={v} type="button" onClick={() => setAns(q.id, v)}
                      style={{
                        width: 34, height: 34, borderRadius: 9, cursor: 'pointer', fontWeight: 800, fontSize: 13,
                        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                        background: active ? 'var(--color-accent)' : 'transparent',
                        color: active ? 'var(--color-text-on-accent, #fff)' : 'var(--color-text-primary)',
                      }}>
                      {v}
                    </button>
                  );
                })}
              </div>
            )}

            {q.type === 'number' && (
              <input type="number" inputMode="decimal" value={answers[q.id] ?? ''} onChange={(e) => setAns(q.id, e.target.value === '' ? '' : Number(e.target.value))}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--color-border-subtle)', background: 'var(--color-surface-hover, transparent)', color: 'var(--color-text-primary)' }} />
            )}

            {q.type === 'text' && (
              <textarea rows={3} value={answers[q.id] ?? ''} onChange={(e) => setAns(q.id, e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--color-border-subtle)', background: 'var(--color-surface-hover, transparent)', color: 'var(--color-text-primary)', resize: 'vertical' }} />
            )}

            {q.type === 'boolean' && (
              <div style={{ display: 'flex', gap: 8 }}>
                {[{ v: true, l: t('coaching.yes', { defaultValue: 'Yes' }) }, { v: false, l: t('coaching.no', { defaultValue: 'No' }) }].map(({ v, l }) => {
                  const active = answers[q.id] === v;
                  return (
                    <button key={String(v)} type="button" onClick={() => setAns(q.id, v)}
                      style={{
                        flex: 1, padding: '9px 0', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 13,
                        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                        background: active ? 'var(--color-accent)' : 'transparent',
                        color: active ? 'var(--color-text-on-accent, #fff)' : 'var(--color-text-primary)',
                      }}>
                      {l}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        <button type="button" onClick={handleSubmit} disabled={saving}
          style={{
            width: '100%', padding: '13px 0', borderRadius: 12, border: 'none', marginTop: 4,
            background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #fff)', fontWeight: 800, fontSize: 15,
            cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
          }}>
          {saving ? t('coaching.saving', { defaultValue: 'Saving…' }) : t('coaching.submit', { defaultValue: 'Submit check-in' })}
        </button>
      </div>
    </div>
  );
}

export default function CoachingSection() {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [data, setData] = useState(null);
  const [modalTemplate, setModalTemplate] = useState(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const d = await getMemberCoaching(user.id);
      setData(d);
    } catch {
      // Non-critical surface — stay silent on load failure.
    }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const handleToggleHabit = async (entry) => {
    if (!user?.id) return;
    const date = todayStr();
    const next = !entry.doneToday;
    // Optimistic
    setData((d) => ({
      ...d,
      habits: d.habits.map((h) => h.habit.id === entry.habit.id
        ? { ...h, doneToday: next, doneCount: h.doneCount + (next ? 1 : -1) }
        : h),
    }));
    const { error } = await setHabitLog({ habitId: entry.habit.id, profileId: user.id, date, completed: next });
    if (error) {
      // rollback
      setData((d) => ({
        ...d,
        habits: d.habits.map((h) => h.habit.id === entry.habit.id
          ? { ...h, doneToday: !next, doneCount: h.doneCount + (next ? -1 : 1) }
          : h),
      }));
      showToast(t('coaching.habitError', { defaultValue: "Couldn't update that habit." }), 'error');
    }
  };

  if (!data || (data.checkins.length === 0 && data.habits.length === 0)) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 10 }}>
        {t('coaching.title', { defaultValue: 'From your trainer' })}
      </div>

      {/* Check-ins */}
      {data.checkins.map(({ template, done }) => (
        <button key={template.id} type="button" onClick={() => setModalTemplate(template)}
          style={{
            width: '100%', textAlign: 'left', marginBottom: 8, padding: '13px 14px', borderRadius: 14, cursor: 'pointer',
            background: 'var(--color-bg-card, #fff)', border: '1px solid var(--color-border-subtle)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: done ? 'color-mix(in srgb, #3DAD7C 16%, transparent)' : 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}>
            {done ? <Check size={18} style={{ color: '#3DAD7C' }} /> : <ClipboardList size={18} style={{ color: 'var(--color-accent)' }} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>{template.title}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {done ? t('coaching.doneThisWeek', { defaultValue: 'Done this week — tap to edit' }) : t('coaching.dueThisWeek', { defaultValue: 'Due this week' })}
            </div>
          </div>
        </button>
      ))}

      {/* Habits */}
      {data.habits.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: data.checkins.length ? 8 : 0 }}>
          {data.habits.map((entry) => {
            const { habit, doneToday, doneCount } = entry;
            return (
              <button key={habit.id} type="button" onClick={() => handleToggleHabit(entry)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${doneToday ? '#3DAD7C' : 'var(--color-border-subtle)'}`,
                  background: doneToday ? 'color-mix(in srgb, #3DAD7C 14%, transparent)' : 'var(--color-bg-card, #fff)',
                }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: doneToday ? '#3DAD7C' : 'transparent', border: doneToday ? 'none' : '1.5px solid var(--color-border-subtle)',
                }}>
                  {doneToday && <Check size={12} style={{ color: '#fff' }} strokeWidth={3} />}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>{habit.name}</span>
                {habit.target_per_week ? (
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <Flame size={11} />{doneCount}/{habit.target_per_week}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {modalTemplate && (
        <CheckinModal
          template={modalTemplate}
          profileId={user.id}
          gymId={profile?.gym_id}
          period={mondayOf()}
          existing={data.checkins.find((c) => c.template.id === modalTemplate.id)?.response}
          onClose={() => setModalTemplate(null)}
          onSaved={load}
          t={t}
        />
      )}
    </div>
  );
}
