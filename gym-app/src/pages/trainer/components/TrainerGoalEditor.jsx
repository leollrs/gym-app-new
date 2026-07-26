// Trainer-side goal editor — create / edit / delete a CLIENT's member_goals.
// Writes are permitted by migration 0641 (member_goals_staff_* RLS via
// _can_manage_client). Mirrors the member GoalsSection's goal types + baseline
// seeding, but scoped to one client the trainer manages.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Trash2, Loader2, Save } from 'lucide-react';
import { useToast } from '../../../contexts/ToastContext';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { supabase } from '../../../lib/supabase';
import { TT, TFont } from './designTokens';

const TYPES = [
  { key: 'body_weight', unit: 'lbs', label: 'Body weight' },
  { key: 'body_fat', unit: '%', label: 'Body fat' },
  { key: 'lift_1rm', unit: 'lbs', label: '1RM lift', needsExercise: true },
  { key: 'workout_count', unit: 'workouts', label: 'Workouts' },
  { key: 'streak', unit: 'days', label: 'Streak' },
  { key: 'volume', unit: 'lbs', label: 'Volume' },
];
const TYPE_BY_KEY = new Map(TYPES.map((x) => [x.key, x]));
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

export default function TrainerGoalEditor({ clientId, gymId, goal, seed = {}, prs = [], onClose, onDone }) {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const { showToast } = useToast();
  useScrollLock(true);
  const isEdit = !!goal?.id;

  const initType = goal?.goal_type || 'body_weight';
  const [type, setType] = useState(initType);
  const [exId, setExId] = useState(goal?.exercise_id || null);
  const [exName, setExName] = useState(goal?.exercises ? (isEs && goal.exercises.name_es ? goal.exercises.name_es : goal.exercises.name) : '');
  const [title, setTitle] = useState(goal?.title || '');
  const [current, setCurrent] = useState(goal?.current_value != null ? String(goal.current_value) : (seed.weightLbs ? String(Math.round(seed.weightLbs)) : ''));
  const [target, setTarget] = useState(goal?.target_value != null ? String(goal.target_value) : '');
  const [date, setDate] = useState(goal?.target_date || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const meta = TYPE_BY_KEY.get(type) || TYPES[0];
  const typeLabel = (k) => t(`trainerClientDetail.goalEditor.type.${k}`, TYPE_BY_KEY.get(k)?.label || k);

  // Seed the "current" baseline + a default title when the type changes (new only).
  const pickType = (k) => {
    setType(k);
    setExId(null); setExName('');
    const s = k === 'body_weight' ? seed.weightLbs : k === 'body_fat' ? seed.bodyFat : null;
    setCurrent(s != null ? String(Math.round(s * 10) / 10) : '');
    setTitle('');
  };
  const pickPr = (pr) => {
    setExId(pr.exercise_id);
    const nm = isEs && pr.exercises?.name_es ? pr.exercises.name_es : (pr.exercises?.name || '');
    setExName(nm);
    if (pr.estimated_1rm) setCurrent(String(Math.round(pr.estimated_1rm)));
    setTitle(nm ? t('trainerClientDetail.goalEditor.liftTitle', '{{name}} 1RM', { name: nm }) : '');
  };

  const defaultTitle = () => {
    if (type === 'lift_1rm') return exName ? t('trainerClientDetail.goalEditor.liftTitle', '{{name}} 1RM', { name: exName }) : typeLabel('lift_1rm');
    return typeLabel(type);
  };

  const canSave = target.trim() !== '' && (type !== 'lift_1rm' || !!exId);

  const save = async () => {
    if (saving || !canSave) return;
    setSaving(true);
    try {
      if (isEdit) {
        const patch = { title: title.trim() || goal.title, target_value: num(target), target_date: date || null, current_value: num(current) };
        if (goal.start_value == null) patch.start_value = num(current);
        const { error } = await supabase.from('member_goals').update(patch).eq('id', goal.id);
        if (error) throw error;
      } else {
        const payload = {
          profile_id: clientId, gym_id: gymId, goal_type: type,
          exercise_id: type === 'lift_1rm' ? exId : null,
          title: title.trim() || defaultTitle(),
          current_value: num(current), start_value: num(current), target_value: num(target),
          unit: meta.unit, target_date: date || null, is_milestone: false,
        };
        const { error } = await supabase.from('member_goals').insert(payload);
        if (error) {
          if (error.code === '23505') { showToast(t('trainerClientDetail.goalEditor.dup', 'A goal of this type already exists — edit it instead.'), 'error'); setSaving(false); return; }
          throw error;
        }
      }
      showToast(t('trainerClientDetail.goalEditor.saved', 'Goal saved'), 'success');
      onDone();
    } catch (e) { showToast(e?.message || t('common:error', 'Something went wrong'), 'error'); }
    finally { setSaving(false); }
  };

  const del = async () => {
    if (deleting || !isEdit) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('member_goals').delete().eq('id', goal.id);
      if (error) throw error;
      showToast(t('trainerClientDetail.goalEditor.deleted', 'Goal removed'), 'success');
      onDone();
    } catch (e) { showToast(e?.message || t('common:error', 'Something went wrong'), 'error'); setDeleting(false); }
  };

  const label = { fontSize: 11, color: TT.textMute, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, marginBottom: 5, display: 'block' };
  const field = { width: '100%', background: TT.surface2, borderRadius: 10, padding: '10px 12px', fontSize: 14, color: TT.text, border: `1px solid ${TT.border}`, outline: 'none' };

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: 16 }} onClick={() => !saving && !deleting && onClose()}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: TT.bg, borderRadius: 22, border: `1px solid ${TT.borderSolid}`, width: '100%', maxWidth: 440, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.45)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${TT.border}` }}>
          <span style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text }}>{isEdit ? t('trainerClientDetail.goalEditor.editTitle', 'Edit goal') : t('trainerClientDetail.goalEditor.addTitle', 'Add goal')}</span>
          <button type="button" onClick={onClose} aria-label={t('common:close', 'Close')} style={{ width: 34, height: 34, borderRadius: 10, background: TT.surface2, border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.textSub }}><X size={16} /></button>
        </div>

        <div style={{ overflowY: 'auto', padding: 16 }}>
          {/* Type */}
          {isEdit ? (
            <div style={{ marginBottom: 14 }}>
              <span style={label}>{t('trainerClientDetail.goalEditor.typeLabel', 'Goal type')}</span>
              <span style={{ display: 'inline-block', fontSize: 13, fontWeight: 800, color: TT.accentInk, background: TT.accentSoft, padding: '6px 12px', borderRadius: 999 }}>{typeLabel(type)}{exName ? ` · ${exName}` : ''}</span>
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <span style={label}>{t('trainerClientDetail.goalEditor.typeLabel', 'Goal type')}</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {TYPES.map((x) => {
                  const on = type === x.key;
                  return (
                    <button key={x.key} type="button" onClick={() => pickType(x.key)} className="tt-tap"
                      style={{ padding: '9px 10px', borderRadius: 11, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', textAlign: 'left', border: `1px solid ${on ? TT.accent : TT.border}`, background: on ? TT.accent : TT.surface2, color: on ? '#fff' : TT.textSub }}>
                      {typeLabel(x.key)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Exercise picker for lift_1rm (new goal) */}
          {!isEdit && type === 'lift_1rm' && (
            <div style={{ marginBottom: 14 }}>
              <span style={label}>{t('trainerClientDetail.goalEditor.exercise', 'Lift')}</span>
              {prs.length === 0 ? (
                <p style={{ fontSize: 12.5, color: TT.textMute }}>{t('trainerClientDetail.goalEditor.noLifts', 'No tracked lifts yet — the client needs a logged PR first.')}</p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {prs.slice(0, 12).map((pr) => {
                    const nm = isEs && pr.exercises?.name_es ? pr.exercises.name_es : (pr.exercises?.name || pr.exercise_id);
                    const on = exId === pr.exercise_id;
                    return (
                      <button key={pr.exercise_id} type="button" onClick={() => pickPr(pr)} className="tt-tap"
                        style={{ padding: '7px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: `1px solid ${on ? TT.accent : TT.border}`, background: on ? TT.accent : TT.surface2, color: on ? '#fff' : TT.textSub }}>
                        {nm}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Title */}
          <div style={{ marginBottom: 14 }}>
            <span style={label}>{t('trainerClientDetail.goalEditor.title', 'Title')}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle()} style={field} />
          </div>

          {/* Current + Target */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <span style={label}>{t('trainerClientDetail.goalEditor.current', 'Current')} ({meta.unit})</span>
              <input type="number" inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="0" style={field} />
            </div>
            <div>
              <span style={label}>{t('trainerClientDetail.goalEditor.target', 'Target')} ({meta.unit})</span>
              <input type="number" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0" style={field} />
            </div>
          </div>

          {/* Target date */}
          <div style={{ marginBottom: 4 }}>
            <span style={label}>{t('trainerClientDetail.goalEditor.byDate', 'Target date (optional)')}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={field} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderTop: `1px solid ${TT.border}` }}>
          {isEdit && (
            <button type="button" onClick={del} disabled={deleting} className="tt-tap" aria-label={t('common:remove', 'Remove')}
              style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: TT.hotSoft, border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: TT.hot }}>
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            </button>
          )}
          <button type="button" onClick={save} disabled={saving || !canSave} className="tt-tap"
            style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '13px', borderRadius: 12, background: TT.accent, border: 'none', color: '#fff', fontFamily: TFont.display, fontWeight: 800, fontSize: 14, cursor: 'pointer', opacity: (saving || !canSave) ? 0.5 : 1 }}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} strokeWidth={2.4} />} {t('trainerClientDetail.editor.save', 'Save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
