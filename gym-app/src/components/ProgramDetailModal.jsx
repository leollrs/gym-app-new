/**
 * Program / plan detail modal — expandable day cards with exercise thumbnails,
 * muscle tag and the SETS · REPS · REST row.
 *
 * Shared on purpose: the member opening their coach's plan and the trainer
 * opening the same plan now get the SAME screen. The member side had its own
 * plainer layout, which is why the coach's plan kept reading as a different,
 * older app than everything else the member opens.
 */
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, ChevronLeft, ChevronRight, ChevronDown, Dumbbell } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { exName } from '../lib/exerciseName';
import { estimateMinutes, estimateCalories } from '../lib/workoutEstimate';
import { getExercises } from '../lib/exerciseStore';
import ExerciseVideoThumb from './ExerciseVideoThumb';
import { useScrollLock } from '../hooks/useScrollLock';
import { TT, TFont } from '../pages/trainer/components/designTokens';

const EXERCISE_BY_ID = new Map(getExercises().map((e) => [e.id, e]));
const MUSCLE_HUE = { chest: '#F0894C', back: '#4FB6F0', legs: '#38D07E', shoulders: '#E7A93E', arms: '#9A8CF7', core: '#FF6B5E', biceps: '#FF6B5E', triceps: '#9A8CF7' };
const muscleHue = (m) => MUSCLE_HUE[String(m || '').toLowerCase()] || TT.accent;

// Legacy shapes are real and defended against in five other places in this
// repo: a week can be a bare array of exercise-id STRINGS, and a day's
// exercises can be strings rather than objects. Without this the modal renders
// N empty "Day n · 0 exercises" cards, or rows reading "Unknown Exercise · —".
const normalizeDays = (raw, dayLabel) => {
  if (!Array.isArray(raw)) return [];
  if (raw.length && typeof raw[0] === 'string') {
    return [{ name: `${dayLabel} 1`, exercises: raw.map(id => ({ id })) }];
  }
  return raw.map(d => ({
    ...d,
    exercises: (d?.exercises || []).map(e => (typeof e === 'string' ? { id: e } : e)),
  }));
};

// `name_es` / `description_es` exist on templates and gym programs; rendering
// the raw field meant Spanish members read English titles here and nowhere else.
const localized = (obj, field, es) => (es && obj?.[`${field}_es`]) || obj?.[field] || '';

export default function ProgramDetailModal({
  program, onClose, eyebrow, footer, description, meta,
}) {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const isEs = i18n.language?.startsWith('es');
  const [exMap, setExMap] = useState({});
  const [weekIdx, setWeekIdx] = useState(0);
  const [expandedDay, setExpandedDay] = useState(0);
  const [descOpen, setDescOpen] = useState(false);
  useScrollLock(!!program); // lock page behind when this modal is showing

  useEffect(() => {
    if (!program) return;
    setWeekIdx(0); setExpandedDay(0);
    const src = program.weeks || {};
    let alive = true;
    (async () => {
      const ids = new Set();
      (Array.isArray(src) ? src : Object.values(src)).forEach(days =>
        (days || []).forEach(d => (d.exercises || []).forEach(e => {
          const id = e.id || e.exercise_id;
          if (id) ids.add(id);
        })));
      if (!ids.size) return;
      const { data } = await supabase.from('exercises').select('id, name, name_es').in('id', [...ids]);
      if (!alive) return;
      const map = {};
      (data || []).forEach(e => { map[e.id] = e; });
      setExMap(map);
    })();
    return () => { alive = false; };
  }, [program]);

  if (!program) return null;
  const src = program.weeks || {};
  const weekEntries = Array.isArray(src)
    ? src.map((days, i) => [i + 1, days])
    : Object.entries(src).map(([k, v]) => [Number(k), v]).sort((a, b) => a[0] - b[0]);
  const total = weekEntries.length;
  const idx = Math.min(Math.max(weekIdx, 0), Math.max(total - 1, 0));
  const [weekNum, rawDays] = weekEntries[idx] || [1, []];
  const days = normalizeDays(rawDays, t('trainerClientDetail.dayN', 'Day {{n}}', { n: '' }).trim() || 'Day');
  const canPrev = idx > 0;
  const canNext = idx < total - 1;

  const groupLabel = (type) => type === 'circuit'
    ? t('trainerClientDetail.program.circuit', 'Circuit')
    : t('trainerClientDetail.program.superset', 'Superset');

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, borderRadius: 18, width: '100%', maxWidth: 540, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${TT.border}` }}>
          <div style={{ minWidth: 0 }}>
            {eyebrow && (
              <div style={{ fontSize: 10.5, fontWeight: 800, color: TT.accent, textTransform: 'uppercase', letterSpacing: 1.1, marginBottom: 3 }}>{eyebrow}</div>
            )}
            <div style={{ fontFamily: TFont.display, fontSize: 20, fontWeight: 900, color: TT.text, letterSpacing: -0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{localized(program, 'name', isEs)}</div>
            <div style={{ fontSize: 12, color: TT.textSub, marginTop: 3 }}>
              {program.duration_weeks ? t('trainerClientDetail.weekProgram', '{{n}}-week program', { n: program.duration_weeks }) : `${weekEntries.length} ${t('trainerNotes.program.weeks', 'weeks')}`}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common:close', 'Close')}
            style={{ width: 36, height: 36, borderRadius: 10, background: TT.surface2, border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0, color: TT.textSub }}>
            <X size={17} strokeWidth={2.2} />
          </button>
        </div>

        <div style={{ padding: '4px 16px 16px', overflowY: 'auto', flex: 1 }}>
          {(description || localized(program, 'description', isEs)) && (
            <div style={{ paddingTop: 10 }}>
              <p style={{
                fontSize: 13.5, lineHeight: 1.55, color: TT.textSub,
                display: descOpen ? 'block' : '-webkit-box',
                WebkitLineClamp: descOpen ? 'none' : 3, WebkitBoxOrient: 'vertical',
                overflow: descOpen ? 'visible' : 'hidden',
              }}>
                {description || localized(program, 'description', isEs)}
              </p>
              {(description || localized(program, 'description', isEs)).length > 120 && (
                <button type="button" onClick={() => setDescOpen(o => !o)}
                  style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, color: TT.accent, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                  {descOpen ? t('trainerPlanViewer.readLess', 'Read less') : t('trainerPlanViewer.readMore', 'Read more')}
                </button>
              )}
            </div>
          )}
          {meta && (
            <p style={{ fontSize: 11.5, color: TT.textMute, marginTop: 10 }}>{meta}</p>
          )}
          {weekEntries.length === 0 ? (
            <p style={{ fontSize: 13, color: TT.textMute, textAlign: 'center', padding: '24px 0' }}>{t('trainerClientDetail.program.empty', 'This program has no content yet.')}</p>
          ) : (
            <>
              {/* Week navigator — prev/next arrows (matches the member My-Plan modal) */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '12px 0' }}>
                <button type="button" onClick={() => { if (canPrev) { setWeekIdx(idx - 1); setExpandedDay(0); } }} disabled={!canPrev} aria-label={t('myPlan.previousWeek', 'Previous week')}
                  style={{ width: 40, height: 40, borderRadius: 13, border: 'none', flexShrink: 0, cursor: canPrev ? 'pointer' : 'default', background: canPrev ? TT.surface2 : 'transparent', color: canPrev ? TT.text : TT.textMute, opacity: canPrev ? 1 : 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ChevronLeft size={18} strokeWidth={2.3} />
                </button>
                <div style={{ fontFamily: TFont.display, fontWeight: 800, fontSize: 17, color: TT.text, letterSpacing: -0.3 }}>
                  {t('trainerClientDetail.weekN', 'Week {{w}}', { w: weekNum })}
                  <span style={{ color: TT.textMute, fontWeight: 700 }}> {t('trainerClientDetail.ofN', 'of {{n}}', { n: total })}</span>
                </div>
                <button type="button" onClick={() => { if (canNext) { setWeekIdx(idx + 1); setExpandedDay(0); } }} disabled={!canNext} aria-label={t('myPlan.nextWeek', 'Next week')}
                  style={{ width: 40, height: 40, borderRadius: 13, border: 'none', flexShrink: 0, cursor: canNext ? 'pointer' : 'default', background: canNext ? TT.surface2 : 'transparent', color: canNext ? TT.text : TT.textMute, opacity: canNext ? 1 : 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ChevronRight size={18} strokeWidth={2.3} />
                </button>
              </div>

              {/* Day tiles — collapsible; expand to the exercise list */}
              {days.length === 0 ? (
                <p style={{ fontSize: 13, color: TT.textMute, textAlign: 'center', padding: '20px 0' }}>{t('trainerClientDetail.program.restWeek', 'Rest / no sessions')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {days.map((d, di) => {
                    const exs = d.exercises || [];
                    const open = expandedDay === di;
                    return (
                      <div key={di} style={{ background: open ? TT.bg : TT.surface2, border: `1px solid ${open ? `${TT.accent}55` : TT.border}`, borderRadius: 18, overflow: 'hidden' }}>
                        <button type="button" onClick={() => setExpandedDay(open ? null : di)} className="tt-tap"
                          style={{ width: '100%', background: 'transparent', border: 'none', padding: '14px 15px', display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left', cursor: 'pointer' }}>
                          <div style={{ width: 40, height: 40, borderRadius: 12, background: TT.accentSoft, boxShadow: `inset 0 0 0 1px ${TT.accent}44`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                            <Dumbbell size={20} color={TT.accent} strokeWidth={2.1} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: TFont.display, fontSize: 16.5, fontWeight: 800, color: TT.text, letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {localized(d, 'name', isEs) || t('trainerClientDetail.dayN', 'Day {{n}}', { n: di + 1 })}
                            </div>
                            <div style={{ fontSize: 12, color: TT.textSub, marginTop: 3 }}>
                              {exs.length} {t('dashboard.exercises', 'exercises')}{exs.length ? ` · ~${estimateMinutes(exs)}m · ${estimateCalories(exs)} cal` : ''}
                            </div>
                          </div>
                          <ChevronDown size={20} style={{ color: TT.textMute, flexShrink: 0, transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' }} />
                        </button>
                        {open && exs.length > 0 && (
                          <div style={{ margin: '0 12px 12px', padding: '2px 14px', borderRadius: 14, background: TT.surface, border: `1px solid ${TT.border}` }}>
                            {exs.map((e, ei) => {
                              const exId = e.id || e.exercise_id;
                              const lib = EXERCISE_BY_ID.get(exId);
                              const nm = exName(exMap[exId]) || exName(lib) || e.name || t('trainerNotes.overview.unknownExercise', 'Exercise');
                              const mus = lib?.muscle;
                              const mc = muscleHue(mus);
                              const prevGid = ei > 0 ? (exs[ei - 1].group_id || null) : null;
                              const groupStart = e.group_id && e.group_id !== prevGid;
                              const last = ei === exs.length - 1;
                              const stats = [[String(e.sets ?? lib?.defaultSets ?? '—'), t('trainerClientDetail.editor.setsShort', 'sets')], [String(e.reps ?? lib?.defaultReps ?? '—'), t('trainerClientDetail.editor.repsShort', 'reps')], [(e.rest_seconds ?? lib?.restSeconds) ? `${e.rest_seconds ?? lib.restSeconds}s` : '—', t('trainerClientDetail.editor.restShort', 'rest')]];
                              return (
                                <div key={ei}>
                                  {groupStart && (
                                    <div style={{ fontSize: 9.5, fontWeight: 800, color: TT.coach, textTransform: 'uppercase', letterSpacing: 0.5, margin: `${ei ? 10 : 6}px 0 2px` }}>
                                      {groupLabel(e.group_type)}
                                    </div>
                                  )}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: last ? 'none' : `1px solid ${TT.border}`, paddingLeft: e.group_id ? 9 : 0, borderLeft: e.group_id ? `2px solid ${TT.coach}` : 'none' }}>
                                    <ExerciseVideoThumb exercise={{ videoUrl: lib?.videoUrl, muscle: mus }} size={46} radius={12} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ flex: 1, minWidth: 0, fontFamily: TFont.display, fontSize: 14.5, fontWeight: 800, color: TT.text, letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nm}</span>
                                        {mus && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, fontSize: 11, fontWeight: 700, color: mc }}><span style={{ width: 6, height: 6, borderRadius: 99, background: mc }} />{t(`muscleGroups.${mus}`, mus)}</span>}
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 5, whiteSpace: 'nowrap' }}>
                                        {stats.map(([v, l], k) => (
                                          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                                            {k > 0 && <span style={{ width: 3, height: 3, borderRadius: 99, background: TT.textMute }} />}
                                            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
                                              <span style={{ fontFamily: TFont.mono, fontSize: 12.5, fontWeight: 700, color: TT.text, letterSpacing: -0.3 }}>{v}</span>
                                              <span style={{ fontFamily: TFont.display, fontSize: 9.5, fontWeight: 700, color: TT.textMute, letterSpacing: 0.2, textTransform: 'uppercase' }}>{l}</span>
                                            </span>
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {footer && (
          <div style={{ // The dialog wrapper already applies pb-[env(safe-area-inset-bottom)];
            // adding it again here left ~34px of dead space under the CTA on a
            // notched iPhone.
            padding: '12px 16px', borderTop: `1px solid ${TT.border}`, flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
