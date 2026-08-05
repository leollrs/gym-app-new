/**
 * Create / Edit program modal with full week/day/exercise builder.
 *
 * Exercise editing supports: browsable/searchable picker, per-exercise
 * sets / reps / rest, swap-in-place, supersets & circuits (group_id/group_type),
 * and drop-set marking. These all persist into the program `weeks` JSON and are
 * carried to the member's live session at enrollment.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronLeft, ChevronRight, Trash2, Copy, Clock, MoreHorizontal, Plus, ArrowLeftRight, Link2, TrendingDown, Check, Upload } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { exName as exNameLocalized } from '../../../lib/exerciseName';
import {
  DEFAULT_SETS,
  DEFAULT_REST,
  DEFAULT_REPS,
  normalizeWeeks,
  calcDaySeconds,
  fmtTime,
} from './programHelpers';
import ExerciseVideoThumb from '../../../components/ExerciseVideoThumb';
import ExercisePicker from './ExercisePicker';
import { CLASS_COVERS } from './CoverPreview';
import { classImageUrl } from '../../../lib/classImageUrl';
import ClassImage from '../../../components/ClassImage';

// Mismos escalones que el builder del miembro (MemberProgramBuilder.REST_OPTS),
// para que un descanso escrito aquí y uno escrito allí sean el mismo conjunto.
const REST_OPTIONS = [30, 45, 60, 75, 90, 120, 150, 180, 240, 300];

const genGroupId = () => 'g' + Math.random().toString(36).slice(2, 10);

export default function ProgramBuilderModal({ program, initialData, onClose, onSave, saving, saveError }) {
  const { t } = useTranslation('pages');
  const isEdit = !!program;
  const init = program || initialData || {};
  const [name, setName]           = useState(init.name ?? '');
  const [nameEs, setNameEs]       = useState(init.name_es ?? '');
  const [description, setDesc]    = useState(init.description ?? '');
  const [descriptionEs, setDescEs] = useState(init.description_es ?? '');
  const [coverPreset, setCoverPreset] = useState(init.cover_preset ?? '');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(classImageUrl(init.image_path) || '');
  const [imagePath, setImagePath] = useState(init.image_path ?? null);
  const [isPublished, setIsPublished] = useState(init.is_published ?? true);
  const [durationWeeks, setDuration] = useState(init.duration_weeks ?? 8);
  const [weeks, setWeeks]         = useState(() => normalizeWeeks(init.weeks));
  const [currentWeek, setCurrentWeek] = useState(1);
  const [copyWeekMenu, setCopyWeekMenu] = useState(null);
  const [copyDayMenu, setCopyDayMenu]   = useState(null);
  const [localError, setLocalError]     = useState('');
  const [picker, setPicker]             = useState(null);   // { wk, di } add | { wk, di, ei, swap:true }
  const [selDi, setSelDi]               = useState(null);   // day index being grouped (current week)
  const [selEis, setSelEis]             = useState(() => new Set());
  const [activeTab, setActiveTab]       = useState('details'); // 'details' | 'workouts'

  // Lock body scroll while program builder is mounted
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Fetch exercises for name display
  const { data: exercises = [] } = useQuery({
    queryKey: ['exercises-library'],
    queryFn: async () => {
      // video_url + equipment se piden para la miniatura y el subtítulo de la
      // fila. Sin ellos la tarjeta pierde justo lo que la hace legible de un
      // vistazo: la imagen y el "músculo · equipo".
      const { data } = await supabase
        .from('exercises')
        .select('id, name, name_es, muscle_group, equipment, video_url')
        .order('name');
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const exById = (id) => exercises.find(e => e.id === id) || null;
  const exName = (id) => {
    const ex = exById(id);
    return ex ? exNameLocalized(ex) : id;
  };

  // ── Selection (grouping) ──
  const clearSel = () => { setSelDi(null); setSelEis(new Set()); };
  const toggleSel = (di, ei) => {
    if (selDi !== di) { setSelDi(di); setSelEis(new Set([ei])); return; }
    setSelEis(prev => {
      const n = new Set(prev);
      n.has(ei) ? n.delete(ei) : n.add(ei);
      if (n.size === 0) setSelDi(null);
      return n;
    });
  };
  const gotoWeek = (w) => { clearSel(); setCurrentWeek(w); };

  // ── Week operations ──
  const copyWeekTo = (fromWk, toWk) => {
    setWeeks(prev => ({ ...prev, [toWk]: JSON.parse(JSON.stringify(prev[fromWk] || [])) }));
    setCopyWeekMenu(null);
    gotoWeek(toWk);
  };

  // ── Day operations ──
  const addDay = (wk) => setWeeks(prev => ({
    ...prev,
    [wk]: [...(prev[wk] || []), { name: t('admin.programs.builder.dayDefault', 'Day {{n}}', { n: (prev[wk] || []).length + 1 }), exercises: [] }],
  }));

  const removeDay = (wk, di) => { clearSel(); setWeeks(prev => ({
    ...prev,
    [wk]: prev[wk].filter((_, i) => i !== di),
  })); };

  const updateDayName = (wk, di, val) => setWeeks(prev => ({
    ...prev,
    [wk]: prev[wk].map((d, i) => i === di ? { ...d, name: val } : d),
  }));

  const copyDayTo = (fromWk, fromDi, toWk, toDi) => {
    const cloned = JSON.parse(JSON.stringify(weeks[fromWk][fromDi]));
    setWeeks(prev => {
      const targetDays = [...(prev[toWk] || [])];
      if (toDi === 'new') {
        targetDays.push({ ...cloned, name: t('admin.programs.builder.dayDefault', 'Day {{n}}', { n: targetDays.length + 1 }) });
      } else {
        targetDays[toDi] = { ...cloned };
      }
      return { ...prev, [toWk]: targetDays };
    });
    setCopyDayMenu(null);
    gotoWeek(toWk);
  };

  // ── Exercise operations ──
  const addExercise = (wk, di, ex) => {
    if (!ex?.id) return;
    setWeeks(prev => ({
      ...prev,
      [wk]: prev[wk].map((d, i) => i === di
        ? { ...d, exercises: [...d.exercises, {
            id: ex.id,
            sets: ex.default_sets || DEFAULT_SETS,
            reps: ex.default_reps || DEFAULT_REPS,
            rest_seconds: ex.rest_seconds || DEFAULT_REST,
          }] }
        : d
      ),
    }));
  };

  const swapExercise = (wk, di, ei, ex) => {
    if (!ex?.id) return;
    setWeeks(prev => ({
      ...prev,
      [wk]: prev[wk].map((d, i) => i === di
        ? { ...d, exercises: d.exercises.map((e, j) => j === ei ? { ...e, id: ex.id } : e) }
        : d
      ),
    }));
  };

  const removeExercise = (wk, di, ei) => { clearSel(); setWeeks(prev => ({
    ...prev,
    [wk]: prev[wk].map((d, i) => i === di
      ? { ...d, exercises: d.exercises.filter((_, j) => j !== ei) }
      : d
    ),
  })); };

  const updateExercise = (wk, di, ei, field, val) => setWeeks(prev => ({
    ...prev,
    [wk]: prev[wk].map((d, i) => i === di
      ? { ...d, exercises: d.exercises.map((ex, j) => j === ei ? { ...ex, [field]: val } : ex) }
      : d
    ),
  }));

  const toggleDrop = (wk, di, ei) =>
    updateExercise(wk, di, ei, 'drop_set', !weeks[wk]?.[di]?.exercises?.[ei]?.drop_set);

  // ── Grouping (supersets / circuits) ──
  const groupSelected = (type) => {
    if (selDi == null || selEis.size < 2) return;
    const gid = genGroupId();
    setWeeks(prev => {
      const days = [...(prev[currentWeek] || [])];
      const day = days[selDi];
      if (!day) return prev;
      const idxs = [...selEis].sort((a, b) => a - b);
      const grouped = idxs.map(i => ({ ...day.exercises[i], group_id: gid, group_type: type }));
      const rest = day.exercises.filter((_, i) => !selEis.has(i));
      const insertAt = day.exercises.slice(0, idxs[0]).filter((_, i) => !selEis.has(i)).length;
      const newEx = [...rest.slice(0, insertAt), ...grouped, ...rest.slice(insertAt)];
      days[selDi] = { ...day, exercises: newEx };
      return { ...prev, [currentWeek]: days };
    });
    clearSel();
  };

  const ungroup = (di, gid) => setWeeks(prev => ({
    ...prev,
    [currentWeek]: prev[currentWeek].map((d, i) => i === di
      ? { ...d, exercises: d.exercises.map(e => {
          if (e.group_id !== gid) return e;
          const { group_id, group_type, ...rest } = e;
          return rest;
        }) }
      : d
    ),
  }));

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  // ── Save ──
  const handleSave = () => {
    if (!name.trim()) { setActiveTab('details'); setLocalError(t('admin.programs.builder.nameRequired', 'Program name is required.')); return; }
    setLocalError('');
    onSave({
      name: name.trim(),
      nameEs: nameEs.trim(),
      description: description.trim(),
      descriptionEs: descriptionEs.trim(),
      durationWeeks,
      weeks,
      coverPreset,
      imageFile,
      imagePath,
      isPublished,
    });
  };

  const allWeekNums = Array.from({ length: durationWeeks }, (_, i) => i + 1);

  const allDayTargets = (fromWk, fromDi) => {
    const targets = [];
    allWeekNums.forEach(wk => {
      const days = weeks[wk] || [];
      days.forEach((d, di) => {
        if (wk === fromWk && di === fromDi) return;
        targets.push({ wk, di, label: `${t('admin.programs.builder.weekShort', 'Wk')} ${wk} · ${d.name || `${t('admin.programs.builder.dayN', 'Day')} ${di + 1}`}` });
      });
      targets.push({ wk, di: 'new', label: `${t('admin.programs.builder.weekShort', 'Wk')} ${wk} · ${t('admin.programs.builder.newDay', 'New day')}` });
    });
    return targets;
  };

  const avgSessionSecs = (() => {
    const allDays = Object.values(weeks).flat();
    if (!allDays.length) return 0;
    return Math.round(allDays.reduce((s, d) => s + calcDaySeconds(d), 0) / allDays.length);
  })();

  const closeMenus = () => { setCopyWeekMenu(null); setCopyDayMenu(null); };
  const error = localError || saveError;

  const inputStyle = { backgroundColor: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      style={{ bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))', padding: '16px' }}
      onClick={closeMenus}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-program-title"
        className="rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-admin-border)' }}>
          <div>
            <p id="edit-program-title" className="text-[16px] font-bold" style={{ color: 'var(--color-admin-text)' }}>{isEdit ? t('admin.programs.builder.editProgram', 'Edit Program') : t('admin.programs.builder.newProgram', 'New Program')}</p>
            {avgSessionSecs > 0 && (
              <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--color-admin-text-muted)' }}>
                <Clock size={10} /> {t('admin.programs.builder.avgPerSession', 'avg {{time}} per session', { time: fmtTime(avgSessionSecs) })}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label={t('common:closeDialog', 'Close dialog')} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg" style={{ color: 'var(--color-admin-text-muted)' }}><X size={20} /></button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Tabs */}
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--color-admin-panel)' }}>
            {[
              { k: 'details', label: t('admin.programs.builder.tabDetails', 'Details') },
              { k: 'workouts', label: t('admin.programs.builder.tabWorkouts', 'Workouts') },
            ].map(tab => (
              <button key={tab.k} type="button" onClick={() => setActiveTab(tab.k)}
                className="flex-1 py-2 rounded-lg text-[12.5px] font-bold transition-colors"
                style={activeTab === tab.k
                  ? { background: 'var(--color-bg-card)', color: 'var(--color-admin-text)', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }
                  : { color: 'var(--color-admin-text-muted)', background: 'transparent' }}>
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'details' && (<>
          {/* Name (EN) */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.programs.builder.programName', 'Program Name')}</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder={t('admin.programs.builder.programNamePlaceholder', 'e.g. 8-Week Strength Builder')}
              className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none transition-colors" style={inputStyle} />
          </div>

          {/* Name (ES) */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.programs.builder.programNameEs', 'Program Name (Spanish)')} <span style={{ color: 'var(--color-admin-text-faint)' }}>· {t('admin.programs.generate.optional', 'optional')}</span></label>
            <input value={nameEs} onChange={e => setNameEs(e.target.value)}
              placeholder={t('admin.programs.builder.programNameEsPlaceholder', 'e.g. Fuerza en 8 semanas')}
              className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none transition-colors" style={inputStyle} />
          </div>

          {/* Description (EN) */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.programs.builder.description', 'Description')}</label>
            <textarea value={description} onChange={e => setDesc(e.target.value)} rows={2}
              placeholder={t('admin.programs.builder.descriptionPlaceholder', 'What will members achieve?')}
              className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none resize-none transition-colors" style={inputStyle} />
          </div>

          {/* Description (ES) */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.programs.builder.descriptionEs', 'Description (Spanish)')} <span style={{ color: 'var(--color-admin-text-faint)' }}>· {t('admin.programs.generate.optional', 'optional')}</span></label>
            <textarea value={descriptionEs} onChange={e => setDescEs(e.target.value)} rows={2}
              placeholder={t('admin.programs.builder.descriptionEsPlaceholder', '¿Qué lograrán los miembros?')}
              className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none resize-none transition-colors" style={inputStyle} />
          </div>

          {/* Duration */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.programs.builder.duration', 'Duration')}</label>
            <div className="flex gap-2">
              {[4, 6, 8, 10, 12].map(w => (
                <button key={w} onClick={() => setDuration(w)}
                  className="flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors"
                  style={durationWeeks === w
                    ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)' }
                    : { backgroundColor: 'var(--color-admin-panel)', color: 'var(--color-admin-text-muted)', border: '1px solid var(--color-admin-border)' }
                  }>
                  {w}{t('admin.programs.weeksShort', 'w')}
                </button>
              ))}
            </div>
          </div>

          {/* Program cover — preset gradient or a custom uploaded photo */}
          <div>
            <label className="block text-[12px] font-medium mb-2" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.programs.builder.cover', 'Program Cover')}</label>

            {imagePreview && (
              <div className="relative mb-2 rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-admin-border)', height: 100 }}>
                {/* Same reason as the class cover: this preview src is either a
                    blob: URL or the stored object's public URL, and the stored
                    one can be dead — on the very screen an admin opens to fix it. */}
                <ClassImage path={imagePreview} alt="" loading="eager" style={{ position: 'absolute', inset: 0 }} />
                <button type="button" onClick={() => { setImageFile(null); setImagePreview(''); setImagePath(null); }}
                  aria-label={t('admin.programs.builder.removeCover', 'Remove')}
                  className="absolute top-2 right-2 p-1.5 rounded-full transition-colors" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
                  <X size={14} />
                </button>
              </div>
            )}

            {!imagePreview && (
              <div className="grid grid-cols-6 gap-2">
                {CLASS_COVERS.map(c => {
                  const Icon = c.icon;
                  const selected = coverPreset === c.key;
                  return (
                    <button key={c.key} type="button" onClick={() => setCoverPreset(selected ? '' : c.key)}
                      className="rounded-lg flex items-center justify-center transition-all"
                      style={{ background: c.gradient, aspectRatio: '1 / 1', opacity: selected ? 1 : 0.7, boxShadow: selected ? '0 0 0 2px var(--color-bg-card), 0 0 0 4px var(--color-accent)' : 'none' }}
                      aria-label={t(c.labelKey, c.key)} title={t(c.labelKey, c.key)}>
                      <Icon size={16} className="text-white/90" />
                    </button>
                  );
                })}
              </div>
            )}

            {!imagePreview && (
              <label className="flex items-center justify-center gap-2 w-full py-2 mt-2 rounded-xl cursor-pointer transition-colors"
                style={{ border: '1px dashed var(--color-admin-border)', color: 'var(--color-admin-text-sub)' }}>
                <Upload size={14} />
                <span className="text-[12px] font-bold">{t('admin.programs.builder.uploadCover', 'Or upload your own photo')}</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { handleImageChange(e); setCoverPreset(''); }} />
              </label>
            )}

            <p className="text-[10.5px] mt-1.5" style={{ color: 'var(--color-admin-text-faint)' }}>{t('admin.programs.builder.coverHint', 'Pick a cover — or one is chosen automatically so it never looks blank.')}</p>
          </div>

          {/* Visibility — Published vs Draft */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.programs.builder.visibility', 'Visibility')}</label>
            <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--color-admin-panel)' }}>
              {[
                { v: true, label: t('admin.programs.published', 'Published') },
                { v: false, label: t('admin.programs.draft', 'Draft') },
              ].map(opt => (
                <button key={String(opt.v)} type="button" onClick={() => setIsPublished(opt.v)}
                  className="flex-1 py-2 rounded-lg text-[12.5px] font-bold transition-colors"
                  style={isPublished === opt.v
                    ? { background: 'var(--color-bg-card)', color: 'var(--color-admin-text)', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }
                    : { color: 'var(--color-admin-text-muted)', background: 'transparent' }}>
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10.5px] mt-1.5" style={{ color: 'var(--color-admin-text-faint)' }}>
              {isPublished ? t('admin.programs.builder.publishedHint', 'Members can see and enroll in this program.') : t('admin.programs.builder.draftHint', 'Hidden from members until you publish it.')}
            </p>
          </div>
          </>)}

          {activeTab === 'workouts' && (
          <div>
            <label className="block text-[12px] font-medium mb-3" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.programs.builder.weeklySchedule', 'Weekly Schedule')}</label>

            {/* Week navigator */}
            <div className="flex items-center justify-between rounded-xl px-3 py-2.5 mb-3" style={{ backgroundColor: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
              <button onClick={() => gotoWeek(Math.max(1, currentWeek - 1))} disabled={currentWeek <= 1}
                aria-label={t('admin.programs.builder.previousWeek', 'Previous week')}
                className="p-1.5 rounded-lg disabled:opacity-30 transition-colors" style={{ color: 'var(--color-admin-text-muted)' }}>
                <ChevronLeft size={18} />
              </button>
              <div className="text-center flex items-center gap-1">
                <span className="text-[14px] font-bold" style={{ color: 'var(--color-admin-text)' }}>
                  {t('admin.programs.builder.weekN', 'Week {{n}}', { n: currentWeek })}
                </span>
                <span className="text-[12px]" style={{ color: 'var(--color-admin-text-muted)' }}>/ {durationWeeks}</span>
                {/* Copy week menu */}
                <div className="relative ml-2" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => { setCopyWeekMenu(copyWeekMenu === currentWeek ? null : currentWeek); setCopyDayMenu(null); }}
                    className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--color-admin-text-muted)' }}
                    title={t('admin.programs.builder.copyWeek', 'Copy week')}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {copyWeekMenu === currentWeek && (
                    <div className="absolute right-0 top-full mt-1 z-20 rounded-xl shadow-xl overflow-hidden min-w-[130px]" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)' }}>
                      <p className="text-[10px] font-bold uppercase tracking-widest px-3 pt-2 pb-1" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.programs.builder.copyWkTo', 'Copy Wk {{n}} to...', { n: currentWeek })}</p>
                      {allWeekNums.filter(w => w !== currentWeek).map(targetWk => (
                        <button
                          key={targetWk}
                          onClick={() => copyWeekTo(currentWeek, targetWk)}
                          className="w-full text-left px-3 py-2 text-[12px] transition-colors hover:bg-[var(--color-bg-hover)]"
                          style={{ color: 'var(--color-admin-text)' }}
                        >
                          {t('admin.programs.builder.weekN', 'Week {{n}}', { n: targetWk })}
                          {(weeks[targetWk] || []).length > 0 && (
                            <span className="ml-1" style={{ color: 'var(--color-admin-text-muted)' }}>({t('admin.programs.builder.overwrite', 'overwrite')})</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <button onClick={() => gotoWeek(Math.min(durationWeeks, currentWeek + 1))} disabled={currentWeek >= durationWeeks}
                aria-label={t('admin.programs.builder.nextWeek', 'Next week')}
                className="p-1.5 rounded-lg disabled:opacity-30 transition-colors" style={{ color: 'var(--color-admin-text-muted)' }}>
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Days for current week */}
            <div className="space-y-2">
              {(weeks[currentWeek] || []).length === 0 && (
                <p className="text-[12px] text-center py-2" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.programs.builder.noDaysYet', 'No days yet — add one below')}</p>
              )}

              {(weeks[currentWeek] || []).map((day, di) => {
                const dayTime = calcDaySeconds(day);
                const showCopyDay = copyDayMenu?.wk === currentWeek && copyDayMenu?.di === di;
                const dayTargets = allDayTargets(currentWeek, di);

                return (
                  <div key={di} className="rounded-xl overflow-visible" style={{ border: '1px solid var(--color-admin-border)' }}>
                    {/* Day header */}
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-t-xl" style={{ backgroundColor: 'var(--color-admin-panel)' }}>
                      <input
                        value={day.name}
                        onChange={e => updateDayName(currentWeek, di, e.target.value)}
                        placeholder={t('admin.programs.builder.dayDefault', 'Day {{n}}', { n: di + 1 })}
                        aria-label={`${t('admin.programs.dayName', 'Day name')} ${di + 1}`}
                        className="flex-1 bg-transparent text-[13px] font-semibold outline-none"
                        style={{ color: 'var(--color-admin-text)' }}
                      />
                      {dayTime > 0 && (
                        <span className="text-[10px] flex items-center gap-0.5 flex-shrink-0" style={{ color: 'var(--color-admin-text-muted)' }}>
                          <Clock size={9} /> {fmtTime(dayTime)}
                        </span>
                      )}
                      {/* Copy day menu */}
                      <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => { setCopyDayMenu(showCopyDay ? null : { wk: currentWeek, di }); setCopyWeekMenu(null); }}
                          className="transition-colors p-0.5" style={{ color: 'var(--color-admin-text-muted)' }}
                          title={t('admin.programs.builder.copyDay', 'Copy day')}
                        >
                          <Copy size={12} />
                        </button>
                        {showCopyDay && (
                          <div className="absolute right-0 top-full mt-1 z-20 rounded-xl shadow-xl overflow-hidden min-w-[160px] max-h-48 overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)' }}>
                            <p className="text-[10px] font-bold uppercase tracking-widest px-3 pt-2 pb-1" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.programs.builder.copyDayTo', 'Copy day to...')}</p>
                            {dayTargets.map((target, idx) => (
                              <button
                                key={idx}
                                onClick={() => copyDayTo(currentWeek, di, target.wk, target.di)}
                                className="w-full text-left px-3 py-2 text-[12px] transition-colors hover:bg-[var(--color-bg-hover)]"
                                style={{ color: 'var(--color-admin-text)' }}
                              >
                                {target.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeDay(currentWeek, di)}
                        aria-label={t('admin.programs.builder.removeDay', 'Remove day')}
                        className="transition-colors flex-shrink-0" style={{ color: 'var(--color-danger)' }}
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {/* Exercises */}
                    <div className="px-3 pb-3 pt-1.5 space-y-1">
                      {day.exercises.length === 0 && (
                        <p className="text-[11px] py-1" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.programs.builder.noExercisesYet', 'No exercises yet')}</p>
                      )}
                      {day.exercises.map((ex, ei) => {
                        const grouped = !!ex.group_id;
                        const prevEx = day.exercises[ei - 1];
                        const isFirstInGroup = grouped && (!prevEx || prevEx.group_id !== ex.group_id);
                        const isSel = selDi === di && selEis.has(ei);
                        return (
                          <div key={ei}>
                            {isFirstInGroup && (
                              <div className="flex items-center justify-between mt-1.5 mb-1">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', color: 'var(--color-accent)' }}>
                                  <Link2 size={10} /> {ex.group_type === 'circuit' ? t('admin.programs.builder.circuit', 'Circuit') : t('admin.programs.builder.superset', 'Superset')}
                                </span>
                                <button onClick={() => ungroup(di, ex.group_id)} className="text-[10px] font-semibold transition-colors hover:opacity-80" style={{ color: 'var(--color-admin-text-muted)' }}>
                                  {t('admin.programs.builder.ungroup', 'Ungroup')}
                                </button>
                              </div>
                            )}
                            {/* Tarjeta por ejercicio — lenguaje de
                                WorkoutBuilder (el actual del miembro):
                                rounded-2xl con SOMBRA en vez de borde, anillo
                                de acento al seleccionar, checkbox redondo,
                                miniatura, y micro-etiquetas en mayúsculas
                                ENCIMA de cada control. Antes eran dos líneas
                                planas con seis ±/± apretados: a ocho ejercicios
                                se vuelve ilegible. */}
                            {(() => {
                              const meta = exById(ex.id);
                              const sets = ex.sets ?? DEFAULT_SETS;
                              return (
                            <div
                              className="rounded-2xl overflow-hidden transition-colors duration-200"
                              style={{
                                background: 'var(--color-bg-card)',
                                boxShadow: isSel
                                  ? '0 0 0 1.5px color-mix(in srgb, var(--color-accent) 55%, transparent), 0 1px 3px rgba(0,0,0,0.14)'
                                  : '0 1px 3px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.04)',
                                ...(grouped ? { borderLeft: '3px solid color-mix(in srgb, var(--color-accent) 55%, transparent)' } : {}),
                              }}
                            >
                              <div className="flex items-center gap-2 px-3 py-2.5">
                                {/* Redondo y tintado de acento, como el del
                                    builder del miembro — el cuadrado gris no
                                    se leía como "seleccionable". */}
                                <button
                                  type="button"
                                  onClick={() => toggleSel(di, ei)}
                                  aria-label={t('admin.programs.builder.selectToGroup', 'Select to group')}
                                  className="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors"
                                  style={isSel
                                    ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: 'var(--color-text-on-accent,#000)' }
                                    : { borderColor: 'color-mix(in srgb, var(--color-accent) 60%, transparent)', background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
                                >
                                  {isSel && <span className="text-[12px] font-bold leading-none">&#10003;</span>}
                                </button>
                                <ExerciseVideoThumb
                                  exercise={{ videoUrl: meta?.video_url, muscle: meta?.muscle_group }}
                                  size={40}
                                  radius={11}
                                  className="flex-shrink-0"
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-[14.5px] truncate" style={{ color: 'var(--color-admin-text)' }}>{exName(ex.id)}</p>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    {meta?.muscle_group && (
                                      <p className="text-[12px] truncate" style={{ color: 'var(--color-admin-text-muted)' }}>
                                        {/* Las dos claves viven en `pages`, que
                                            ya es el namespace de este `t`. */}
                                        {t(`muscleGroups.${meta.muscle_group}`, { defaultValue: meta.muscle_group })}
                                        {meta.equipment ? ` · ${t(`exerciseLibrary.equipmentNames.${meta.equipment}`, { defaultValue: meta.equipment })}` : ''}
                                      </p>
                                    )}
                                    {ex.drop_set && (
                                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--color-warning) 16%, transparent)', color: 'var(--color-warning)' }}>
                                        {t('admin.programs.builder.dropSetShort', 'Drop')}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center flex-shrink-0 -mr-1">
                                  <button onClick={() => setPicker({ wk: currentWeek, di, ei, swap: true })} aria-label={t('admin.programs.builder.swap', 'Swap exercise')}
                                    className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors active:scale-90 hover:text-[var(--color-accent)]" style={{ color: 'var(--color-admin-text-muted)' }}>
                                    <ArrowLeftRight size={16} />
                                  </button>
                                  <button onClick={() => toggleDrop(currentWeek, di, ei)} aria-label={t('admin.programs.builder.dropSet', 'Drop set')}
                                    className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors active:scale-90" style={{ color: ex.drop_set ? 'var(--color-warning)' : 'var(--color-admin-text-muted)' }}>
                                    <TrendingDown size={16} />
                                  </button>
                                  <button onClick={() => removeExercise(currentWeek, di, ei)} aria-label={t('admin.programs.builder.removeExercise', 'Remove exercise')}
                                    className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors active:scale-90 hover:text-red-400" style={{ color: 'var(--color-admin-text-muted)' }}>
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>

                              {/* Etiqueta arriba, control abajo. */}
                              <div className="grid grid-cols-3" style={{ borderTop: '1px solid var(--color-border-subtle)', background: 'color-mix(in srgb, var(--color-admin-panel) 50%, var(--color-bg-card))' }}>
                                <div className="px-2 py-2.5 flex flex-col items-center">
                                  <p className="text-[10px] uppercase font-bold tracking-wider mb-2 text-center" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.programs.builder.sets', 'sets')}</p>
                                  <div className="flex items-center justify-center gap-3">
                                    <button onClick={() => updateExercise(currentWeek, di, ei, 'sets', Math.max(1, sets - 1))}
                                      aria-label={t('admin.programs.builder.sets', 'sets')}
                                      className="w-7 h-7 rounded-lg text-[13px] flex items-center justify-center active:scale-90 transition-all leading-none"
                                      style={{ background: 'color-mix(in srgb, var(--color-accent) 25%, transparent)', color: 'var(--color-text-on-accent, #000)' }}>−</button>
                                    <span className="font-bold text-[15px] tabular-nums w-5 text-center" style={{ color: 'var(--color-admin-text)' }}>{sets}</span>
                                    <button onClick={() => updateExercise(currentWeek, di, ei, 'sets', Math.min(20, sets + 1))}
                                      aria-label={t('admin.programs.builder.sets', 'sets')}
                                      className="w-7 h-7 rounded-lg text-[13px] flex items-center justify-center active:scale-90 transition-all leading-none"
                                      style={{ background: 'color-mix(in srgb, var(--color-accent) 25%, transparent)', color: 'var(--color-text-on-accent, #000)' }}>+</button>
                                  </div>
                                </div>

                                <div className="px-2 py-2.5 flex flex-col items-center" style={{ borderLeft: '1px solid var(--color-border-subtle)', borderRight: '1px solid var(--color-border-subtle)' }}>
                                  <p className="text-[10px] uppercase font-bold tracking-wider mb-2 text-center" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.programs.builder.reps', 'reps')}</p>
                                  <input
                                    type="text"
                                    value={ex.reps ?? DEFAULT_REPS}
                                    onChange={e => updateExercise(currentWeek, di, ei, 'reps', e.target.value.slice(0, 20))}
                                    placeholder="8-12"
                                    aria-label={t('admin.programs.builder.reps', 'Reps')}
                                    className="w-16 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-center outline-none transition-colors"
                                    style={{ background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)', color: 'var(--color-admin-text)' }}
                                  />
                                </div>

                                <div className="px-2 py-2.5 flex flex-col items-center">
                                  <p className="text-[10px] uppercase font-bold tracking-wider mb-2 text-center" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.programs.builder.rest', 'rest')}</p>
                                  {/* Desplegable en vez de ±15s: llegar a 3 min
                                      eran seis clics, por ejercicio. */}
                                  <select
                                    value={ex.rest_seconds ?? DEFAULT_REST}
                                    onChange={e => updateExercise(currentWeek, di, ei, 'rest_seconds', Number(e.target.value))}
                                    aria-label={t('admin.programs.builder.rest', 'rest')}
                                    className="rounded-lg px-2 py-1.5 text-[13px] font-semibold text-center outline-none appearance-none cursor-pointer transition-colors"
                                    style={{ background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)', color: 'var(--color-admin-text)' }}
                                  >
                                    {/* Minutos SOLO cuando son redondos: `s/60`
                                        convertía 90s en "1.5m", que nadie lee
                                        como descanso. */}
                                    {REST_OPTIONS.map(s => (
                                      <option key={s} value={s}>{s % 60 === 0 ? `${s / 60}m` : `${s}s`}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </div>
                              );
                            })()}
                          </div>
                        );
                      })}

                      {/* Grouping toolbar */}
                      {selDi === di && selEis.size >= 2 && (
                        <div className="flex items-center gap-2 mt-2 p-2 rounded-xl" style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)', border: '1px dashed color-mix(in srgb, var(--color-accent) 35%, transparent)' }}>
                          <span className="text-[10.5px] font-semibold mr-auto" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.programs.builder.groupSelected', '{{n}} selected', { n: selEis.size })}</span>
                          <button onClick={() => groupSelected('superset')} className="px-2.5 py-1 rounded-lg text-[11px] font-bold" style={{ background: 'var(--color-accent)', color: '#fff' }}>{t('admin.programs.builder.superset', 'Superset')}</button>
                          <button onClick={() => groupSelected('circuit')} className="px-2.5 py-1 rounded-lg text-[11px] font-bold" style={{ background: 'var(--color-coach)', color: '#fff' }}>{t('admin.programs.builder.circuit', 'Circuit')}</button>
                          <button onClick={clearSel} className="px-2 py-1 text-[11px] font-semibold" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.programs.builder.cancelGroup', 'Cancel')}</button>
                        </div>
                      )}

                      {/* Add exercise — opens browsable picker */}
                      <button
                        type="button"
                        onClick={() => setPicker({ wk: currentWeek, di })}
                        className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12px] font-bold transition-colors mt-1.5 hover:brightness-[1.03]"
                        style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', color: 'var(--color-accent)', border: '1px dashed color-mix(in srgb, var(--color-accent) 40%, transparent)' }}
                      >
                        <Plus size={14} strokeWidth={2.6} /> {t('admin.programs.builder.addExercise', 'Add exercise')}
                      </button>
                    </div>
                  </div>
                );
              })}

              <button
                onClick={() => addDay(currentWeek)}
                className="w-full py-2 text-[12px] font-semibold rounded-xl transition-colors"
                style={{ color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}
              >
                {t('admin.programs.builder.addDay', '+ Add Day')}
              </button>
            </div>
          </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-5 pt-4 flex-shrink-0" style={{ backgroundColor: 'var(--color-bg-card)', borderTop: '1px solid var(--color-admin-border)', paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))' }}>
          {error && <p className="text-[12px] mb-3" style={{ color: 'var(--color-danger)' }}>{error}</p>}
          <button onClick={handleSave} disabled={saving}
            className="w-full py-3.5 rounded-xl font-bold text-[14px] disabled:opacity-50 transition-all hover:brightness-[1.04]"
            style={{ backgroundColor: 'var(--color-accent)', color: '#fff', boxShadow: '0 2px 12px color-mix(in srgb, var(--color-accent) 30%, transparent)' }}>
            {saving ? t('admin.programs.builder.saving', 'Saving…') : !isPublished ? t('admin.programs.builder.saveDraft', 'Save draft') : isEdit ? t('admin.programs.builder.saveChanges', 'Save Changes') : t('admin.programs.builder.createProgram', 'Create Program')}
          </button>
        </div>
      </div>

      <ExercisePicker
        isOpen={!!picker}
        onClose={() => setPicker(null)}
        onAdd={(ex) => {
          if (!picker) return;
          if (picker.swap) { swapExercise(picker.wk, picker.di, picker.ei, ex); setPicker(null); }
          else { addExercise(picker.wk, picker.di, ex); }
        }}
        addedIds={picker && !picker.swap ? (weeks[picker.wk]?.[picker.di]?.exercises || []).map(e => e.id) : []}
        t={t}
      />
    </div>
  );
}
