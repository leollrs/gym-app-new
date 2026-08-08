import { useState } from 'react';
import { X, Upload, Loader2, Languages, AlertTriangle, Check } from 'lucide-react';
import { AdminModal } from '../../../components/admin';
import { useToast } from '../../../contexts/ToastContext';
import { classImageUrl } from '../../../lib/classImageUrl';
import { groupSlots } from '../../../lib/admin/classScheduleHelpers';
import { useAutoTranslate } from '../../../hooks/useAutoTranslate';

import TranslationPreviewModal from './TranslationPreviewModal';
import InstructorSelector from './InstructorSelector';
import RoutineSelector from './RoutineSelector';
import ClassSchedulePlanner from './ClassSchedulePlanner';
import ClassTypePicker from './ClassTypePicker';
import ClassFormRail from './ClassFormRail';
import CoverPreview, { CLASS_COVERS } from './CoverPreview';
import ClassImage from '../../../components/ClassImage';

const DEFAULT_COLOR = '#D4AF37';
const NAME_MAX = 100;
const DESC_MAX = 500;

// Inline char-count badge for the name/description inputs. Tiny, used
// only by this modal — keeping it co-located makes the field markup
// self-contained.
function CharCount({ value, max }) {
  const len = (value || '').length;
  const warn = len > max * 0.9;
  const over = len > max;
  return (
    <span className={`text-[10px] tabular-nums ${over ? 'text-red-400' : warn ? 'text-amber-400' : ''}`}
      style={!over && !warn ? { color: 'var(--color-text-muted)' } : undefined}>
      {len}/{max}
    </span>
  );
}

/**
 * Create/edit modal for a gym class — the single source of truth for
 * everything stored on `gym_classes` plus its schedule slots and
 * workout-template attachment.
 *
 * Two-step save flow for NEW classes (translation preview); single-step
 * save for EDITS — we used to run the translation flow on edit too, but
 * admins reported that the preview step felt like the save had failed
 * (no toast, no obvious confirmation). Edits now go straight through.
 *
 * Slot management has two modes:
 *  - Editing an existing class → "add" hits `onAddSlot(classId, slot)`
 *    so it persists immediately; "delete" hits `onDeleteSlot(slotId)`.
 *  - New class → slots accumulate in `pendingSlots` and are written in
 *    a single batch after the parent class row is inserted.
 */
export default function ClassFormModal({ classData, initialSlots, onClose, onSave, saving, gymId, trainers = [], allClasses = [], onAddSlot, onDeleteSlot, onUpdateSlot, t, tc, lang }) {
  const [form, setForm] = useState({
    name: classData?.name || '',
    description: classData?.description || '',
    instructor: classData?.instructor_name || classData?.instructor || '',
    trainer_ids: (() => {
      const fromJunction = (classData?.gym_class_trainers || [])
        .map(r => r?.trainer?.id)
        .filter(Boolean);
      // Fallback for classes that pre-date the junction table being
      // populated (e.g. dev environment running before migration 0379).
      if (fromJunction.length > 0) return fromJunction;
      return classData?.trainer_id ? [classData.trainer_id] : [];
    })(),
    duration_minutes: classData?.duration_minutes || 60,
    max_capacity: classData?.max_capacity || 30,
    accent_color: classData?.accent_color || DEFAULT_COLOR,
    is_active: classData?.is_active ?? true,
    workout_template_id: classData?.workout_template_id || null,
  });
  // Sembrado desde `initialSlots` cuando el formulario nace de una propuesta:
  // el entrenador ya dijo qué día y a qué hora, y hacer que el admin lo vuelva
  // a teclear mirando la propuesta al lado es precisamente el trabajo manual
  // que este flujo existe para quitar. Vacío en cualquier otro caso.
  const [pendingSlots, setPendingSlots] = useState(() =>
    Array.isArray(initialSlots) ? initialSlots : []);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(classImageUrl(classData?.image_path) || classData?.image_url || '');
  // The stored path, tracked separately from the preview URL. Without this the
  // ✕ "remove image" button only cleared local state: onSave never carried a
  // "cleared" signal, so handleSaveClass fell back to the row's existing
  // image_path and the photo came straight back on reload. It also meant an
  // admin had no way to clear a path whose object no longer exists.
  const [imagePath, setImagePath] = useState(classData?.image_path ?? null);
  const [coverPreset, setCoverPreset] = useState(classData?.cover_preset || '');
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const { translate, translating } = useAutoTranslate();
  const { showToast } = useToast();

  const validateClassForm = () => {
    const e = {};
    if (!form.name.trim()) e.name = t('admin.validation.classNameRequired', 'Class name is required');
    else if (form.name.trim().length < 2) e.name = t('admin.validation.tooShort', { min: 2 });
    if (form.duration_minutes < 5) e.duration_minutes = t('admin.validation.required', 'This field is required');
    if (form.max_capacity < 1) e.max_capacity = t('admin.validation.required', 'This field is required');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleClassBlur = (field) => {
    const e = { ...errors };
    if (field === 'name') {
      if (!form.name.trim()) e.name = t('admin.validation.classNameRequired', 'Class name is required');
      else if (form.name.trim().length < 2) e.name = t('admin.validation.tooShort', { min: 2 });
      else delete e.name;
    }
    if (field === 'duration_minutes') {
      if (form.duration_minutes < 5) e.duration_minutes = t('admin.validation.required', 'This field is required');
      else delete e.duration_minutes;
    }
    if (field === 'max_capacity') {
      if (form.max_capacity < 1) e.max_capacity = t('admin.validation.required', 'This field is required');
      else delete e.max_capacity;
    }
    setErrors(e);
  };

  const setFormField = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(prev => { const n = { ...prev }; delete n[k]; return n; });
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  // Step 1: Translate → show preview (single API call, second only if needed).
  // For EDITS we skip the translation roundtrip entirely — the admin is
  // tweaking an existing class and the translation flow was burying the
  // actual save call behind a fragile preview step that several admins
  // reported "didn't save my changes". Editing now goes straight to save.
  const handleTranslateAndPreview = async () => {
    if (!validateClassForm()) {
      showToast(t('admin.validation.fixHighlighted', 'Please fix the highlighted fields'), 'error');
      return;
    }

    if (classData?.id) {
      onSave({
        ...form,
        name_es: classData?.name_es || '',
        description_es: classData?.description_es || '',
        imageFile,
        imagePath,
        pendingSlots,
        cover_preset: coverPreset || null,
      });
      return;
    }

    const texts = [form.name];
    const hasDesc = !!(form.description || '').trim();
    if (hasDesc) texts.push(form.description);

    // First call: try translating to ES (DeepL auto-detects source)
    const result = await translate(texts, 'ES');

    if (!result) {
      // Translation failed — save without translation
      onSave({ ...form, name_es: classData?.name_es || '', description_es: classData?.description_es || '', imageFile, imagePath, pendingSlots, cover_preset: coverPreset || null });
      return;
    }

    const isSpanish = result.detected_lang === 'ES';

    if (isSpanish) {
      // Admin typed in Spanish → we need EN translation, not ES
      const toEn = await translate(texts, 'EN');
      if (!toEn) {
        onSave({ ...form, name_es: form.name, description_es: form.description || '', imageFile, imagePath, pendingSlots, cover_preset: coverPreset || null });
        return;
      }
      setPreview({
        name_en: toEn.translations[0] || form.name,
        name_es: form.name,
        desc_en: hasDesc ? (toEn.translations[1] || form.description) : '',
        desc_es: hasDesc ? form.description : '',
      });
    } else {
      // Admin typed in English (or other) → ES translation is already done
      setPreview({
        name_en: form.name,
        name_es: result.translations[0] || '',
        desc_en: hasDesc ? form.description : '',
        desc_es: hasDesc ? (result.translations[1] || '') : '',
      });
    }
  };

  // Step 2: Admin confirms preview → save
  const handleConfirmSave = () => {
    if (!preview) return;
    onSave({
      ...form,
      name: preview.name_en,
      name_es: preview.name_es,
      description: preview.desc_en,
      description_es: preview.desc_es,
      imageFile,
      imagePath,
      pendingSlots,
      cover_preset: coverPreset || null,
    });
  };

  const isEditing = !!classData?.id;

  // Show translation preview modal if active
  if (preview) {
    return (
      <TranslationPreviewModal
        preview={preview}
        onChange={setPreview}
        onConfirm={handleConfirmSave}
        onCancel={() => setPreview(null)}
        saving={saving}
        t={t}
        tc={tc}
      />
    );
  }

  // Franjas unificadas: al editar viven en la clase (se persisten al momento),
  // al crear se acumulan aquí y se escriben en lote tras insertar la fila.
  const slots = isEditing ? (classData?.gym_class_schedules || []) : pendingSlots;
  const addSlot = (slot) => {
    if (isEditing && classData?.id) onAddSlot(classData.id, slot);
    else setPendingSlots(s => [...s, slot]);
  };
  const removeSlot = (slot, idx) => {
    if (isEditing && slot.id) onDeleteSlot(slot.id);
    else setPendingSlots(s => s.filter((_, i) => i !== idx));
  };
  // Modificar una franja es UPDATE, nunca borrar-y-crear: `class_bookings`
  // apunta a `gym_class_schedules` con ON DELETE CASCADE, así que recrear la
  // fila para mover la hora quince minutos borraría todas las reservas.
  const updateSlot = (slot, patch, idx) => {
    if (isEditing && slot.id) onUpdateSlot(slot.id, patch);
    else setPendingSlots(s => s.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  };

  // Se cuentan HORARIOS, no filas: «lunes y miércoles a las 9» es un horario,
  // aunque en la tabla ocupe dos filas. El encabezado decía 2 y la lista
  // enseñaba 1.
  const slotGroupCount = groupSlots(slots, form.duration_minutes).length;

  const typeMeta = CLASS_COVERS.find(c => c.key === coverPreset) || null;

  // Escoger el tipo hace cuatro cosas de una vez: portada, nombre, duración y
  // capacidad. Nombre y números solo se pisan si el admin no los ha tocado —
  // reescribir lo que alguien acaba de teclear es peor que no ayudar.
  const pickType = (c) => {
    if (!c) { setCoverPreset(''); return; }
    setCoverPreset(c.key);
    setImageFile(null); setImagePreview(''); setImagePath(null);
    setForm(f => {
      const untouched = !f.name.trim() || CLASS_COVERS.some(x => t(x.labelKey) === f.name.trim());
      return {
        ...f,
        name: untouched ? t(c.labelKey) : f.name,
        duration_minutes: slots.length ? f.duration_minutes : c.dur,
        max_capacity: slots.length ? f.max_capacity : c.cap,
      };
    });
  };

  // Quién sale en la tarjeta, con la misma precedencia que usa la app del
  // socio: el entrenador asignado manda, y el nombre suelto solo aparece
  // cuando no hay ninguno.
  const instructorLabel =
    form.trainer_ids.map(id => trainers.find(x => x.id === id)?.full_name).filter(Boolean).join(', ')
    || form.instructor.trim()
    || null;

  const missing = [];
  if (!form.name.trim()) missing.push(t('admin.classes.missName', 'nombre'));
  if (!slots.length) missing.push(t('admin.classes.missSlot', 'un horario'));

  const sectionNum = (n) => (
    <span className="text-[10.5px] font-bold tabular-nums w-[16px] flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }}>{n}</span>
  );
  const inputCls = 'w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors';
  const inputStyle = (bad) => ({
    backgroundColor: 'var(--color-bg-deep)',
    border: `1px solid ${bad ? 'var(--color-danger-soft)' : 'var(--color-border-subtle)'}`,
    color: 'var(--color-text-primary)',
  });
  const capChip = (on) => ({
    background: on ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'var(--color-bg-deep)',
    border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
    color: on ? 'var(--color-accent)' : 'var(--color-text-muted)',
  });
  const CAPS = [10, 14, 20, 30];

  return (
    <AdminModal
      isOpen
      onClose={onClose}
      title={isEditing ? t('admin.classes.editClass') : t('admin.classes.addClass')}
      subtitle={t('admin.classes.formSubtitle', 'Define la clase una vez, luego añade los horarios en que se repite.')}
      size="lg"
      footer={(
        <div className="flex items-center gap-3 w-full flex-wrap">
          <div className="flex items-center gap-1.5 text-[11.5px] flex-1 min-w-[150px]">
            {missing.length ? (
              <>
                <AlertTriangle size={13} style={{ color: 'var(--color-warning, var(--color-accent))', flexShrink: 0 }} />
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.classes.missingFields', { fields: missing.join(' + '), defaultValue: 'Falta {{fields}}' })}
                </span>
              </>
            ) : (
              <>
                <Check size={13} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                <span style={{ color: 'var(--color-success)' }}>{t('admin.classes.readyToCreate', 'Lista para crear')}</span>
              </>
            )}
          </div>
          <button onClick={onClose} className="px-4 py-2.5 text-[13px] font-bold transition-colors"
            style={{ color: 'var(--color-admin-text-sub)', background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)', borderRadius: 999 }}>
            {tc('cancel')}
          </button>
          <button onClick={handleTranslateAndPreview} disabled={saving || translating || missing.length > 0}
            className="flex items-center justify-center gap-2 px-5 py-2.5 text-[13px] font-bold disabled:opacity-50 transition-all hover:brightness-[1.04]"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent)', borderRadius: 999 }}>
            {(translating || saving) ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
            {translating ? t('admin.classes.translating') : saving ? tc('saving') : tc('save')}
          </button>
        </div>
      )}
    >
      {/* La columna de la derecha mide 340 porque la tarjeta del socio mide eso
          en un teléfono. Una vista previa más estrecha corta nombres que en la
          app entran, que es justo lo que uno viene a comprobar aquí. */}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5">
        <div className="min-w-0 space-y-5">
          {/* ── 01 · ¿Qué clase es? ── */}
          <section>
            <div className="flex items-baseline gap-2.5 mb-3">
              {sectionNum('01')}
              <h3 className="text-[14px] font-extrabold" style={{ color: 'var(--color-text-primary)' }}>
                {t('admin.classes.step1', '¿Qué clase es?')}
              </h3>
            </div>

            <ClassTypePicker value={coverPreset} onPick={pickType} t={t} />

            <div className="mt-3.5">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[12px] font-bold" style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.classes.className')} <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <CharCount value={form.name} max={NAME_MAX} />
              </div>
              <input value={form.name} onChange={e => { if (e.target.value.length <= NAME_MAX) setFormField('name', e.target.value); }}
                onBlur={() => handleClassBlur('name')} className={inputCls} style={inputStyle(errors.name)}
                placeholder={t('admin.classes.namePlaceholder', 'Yoga, Spinning, CrossFit...')} />
              {errors.name && <p className="text-[11px] mt-1" style={{ color: 'var(--color-danger)' }}>{errors.name}</p>}
            </div>

            <div className="mt-3.5">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[12px] font-bold" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.description')}</label>
                <CharCount value={form.description} max={DESC_MAX} />
              </div>
              <textarea value={form.description} onChange={e => { if (e.target.value.length <= DESC_MAX) setFormField('description', e.target.value); }}
                rows={2} className={`${inputCls} resize-none`} style={inputStyle(false)}
                placeholder={t('admin.classes.descPlaceholder', 'Intensidad, nivel, qué traer. Aparece en la ficha de la clase en la app.')} />
            </div>

            {/* Portada: la del tipo por defecto, foto propia si la quieres. */}
            <div className="mt-3.5">
              <label className="block text-[12px] font-bold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.classes.classCover', 'Class Cover')}
              </label>
              <div className="flex items-center gap-3">
                <div className="w-[104px] h-[66px] rounded-xl overflow-hidden flex-shrink-0 relative"
                  style={{ border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-deep)' }}>
                  {imagePreview ? (
                    <ClassImage path={imagePreview} alt="" accent={form.accent_color || 'var(--color-accent)'} loading="eager" style={{ position: 'absolute', inset: 0 }} />
                  ) : coverPreset ? (
                    <div className="absolute inset-0"><CoverPreview preset={coverPreset} size="square" /></div>
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('admin.classes.noCover', 'Sin portada')}
                    </div>
                  )}
                  {(imagePreview || coverPreset) && (
                    <button type="button" aria-label={t('admin.classes.removeImage', 'Remove image')}
                      onClick={() => {
                        if (imageFile) {
                          if (imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
                          setImageFile(null);
                          setImagePath(classData?.image_path ?? null);
                          setImagePreview(classImageUrl(classData?.image_path) || classData?.image_url || '');
                          return;
                        }
                        setImagePreview(''); setImagePath(null); setCoverPreset('');
                      }}
                      className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white">
                      <X size={11} />
                    </button>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                    {imagePreview ? t('admin.classes.ownPhoto', 'Foto propia') : t('admin.classes.autoCover', 'Se genera con el tipo de clase')}
                  </p>
                  <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.classes.coverHint', 'Sube una foto de tu gimnasio si prefieres. JPG o PNG.')}
                  </p>
                  <label className="inline-flex items-center gap-1.5 mt-1.5 text-[12px] font-bold cursor-pointer" style={{ color: 'var(--color-accent)' }}>
                    <Upload size={12} /> {t('admin.classes.uploadCustom', 'Or upload your own image')}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { handleImageChange(e); setCoverPreset(''); }} />
                  </label>
                </div>
              </div>
            </div>

            {/* La rutina no es un ajuste avanzado: es lo que el entrenador ve al
                pasar asistencia y lo que hace que la clase cuente para récords
                y sobrecarga. Estaba escondida detrás de «Más opciones», al
                final del formulario, donde nadie la abría. */}
            <div className="mt-3.5">
              <RoutineSelector gymId={gymId} value={form.workout_template_id}
                onChange={(id) => setForm(f => ({ ...f, workout_template_id: id }))} t={t} />
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.classes.routineHint', 'Opcional. El entrenador la ve al pasar asistencia y los miembros al reservar.')}
              </p>
            </div>
          </section>

          {/* ── 02 · ¿Quién la da y para cuántos? ── */}
          <section style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 18 }}>
            <div className="flex items-baseline gap-2.5 mb-3">
              {sectionNum('02')}
              <h3 className="text-[14px] font-extrabold" style={{ color: 'var(--color-text-primary)' }}>
                {t('admin.classes.step2', '¿Quién la da y para cuántos?')}
              </h3>
            </div>

            <InstructorSelector gymId={gymId} values={form.trainer_ids}
              onChange={(ids) => setForm(f => ({ ...f, trainer_ids: ids }))} t={t} />

            <div className="mt-3.5">
              <label className="block text-[12px] font-bold mb-1" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.classes.guestInstructor', 'Guest instructor')}
              </label>
              <input value={form.instructor} onChange={e => setFormField('instructor', e.target.value)}
                className={inputCls} style={inputStyle(false)}
                placeholder={t('admin.classes.guestInstructorPlaceholder', 'e.g. Coach Alex (no app account)')} />
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.classes.guestInstructorHint', 'Optional. Shown to members only when no trainer above is selected.')}
              </p>
            </div>

            <div className="mt-3.5">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-bold" style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.classes.capacity')} <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <span className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('admin.classes.perSession', 'personas por sesión')}
                </span>
              </div>
              <div className="flex gap-1.5 flex-wrap items-center">
                {CAPS.map(n => (
                  <button key={n} type="button" onClick={() => setFormField('max_capacity', n)}
                    className="h-[34px] px-3.5 rounded-lg text-[12.5px] font-bold tabular-nums transition-colors"
                    style={capChip(form.max_capacity === n)}>{n}</button>
                ))}
                <label className="h-[34px] px-3 rounded-lg text-[12.5px] font-bold inline-flex items-center gap-1.5"
                  style={capChip(!CAPS.includes(form.max_capacity))}>
                  {t('admin.classes.other', 'Otra')}
                  <input type="number" inputMode="numeric" min={1} max={1000} value={form.max_capacity || ''}
                    onChange={e => setFormField('max_capacity', Math.max(0, parseInt(e.target.value, 10) || 0))}
                    onBlur={() => handleClassBlur('max_capacity')}
                    className="w-[44px] bg-transparent outline-none text-right tabular-nums" style={{ color: 'inherit' }} />
                </label>
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.classes.capacityHint', 'Al llenarse, los miembros entran a lista de espera automáticamente.')}
              </p>
              {errors.max_capacity && <p className="text-[11px] mt-1" style={{ color: 'var(--color-danger)' }}>{errors.max_capacity}</p>}
            </div>
          </section>

          {/* ── 03 · ¿Cuándo se da? ── */}
          <section style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 18 }}>
            <div className="flex items-baseline gap-2.5 mb-3">
              {sectionNum('03')}
              <h3 className="text-[14px] font-extrabold" style={{ color: 'var(--color-text-primary)' }}>
                {t('admin.classes.step3', '¿Cuándo se da?')}
              </h3>
              {slotGroupCount > 0 && (
                <span className="ml-auto text-[11.5px]" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('admin.classes.slotCount', { count: slotGroupCount, defaultValue: '{{count}} horarios' })}
                </span>
              )}
            </div>
            {slots.length === 0 && (
              <p className="text-[11.5px] mb-2.5 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.classes.noSlotsYet', 'La clase queda guardada pero no aparece en la app hasta que añadas al menos un horario.')}
              </p>
            )}
            <ClassSchedulePlanner
              slots={slots}
              duration={form.duration_minutes}
              onDurationChange={(d) => setFormField('duration_minutes', d)}
              onAdd={addSlot}
              onDelete={removeSlot}
              onUpdate={updateSlot}
              allClasses={allClasses}
              excludeClassId={classData?.id}
              trainerIds={form.trainer_ids}
              trainers={trainers}
              t={t}
              tc={tc}
              lang={lang}
            />
          </section>
        </div>

        {/* ── Panel derecho ── */}
        <div className="lg:sticky lg:top-0 self-start">
          <ClassFormRail
            name={form.name}
            description={form.description}
            coverPreset={coverPreset}
            imagePreview={imagePreview}
            typeMeta={typeMeta}
            instructorLabel={instructorLabel}
            capacity={form.max_capacity}
            duration={form.duration_minutes}
            slots={slots}
            hasRoutine={!!form.workout_template_id}
            t={t}
            lang={lang}
          />
        </div>
      </div>
    </AdminModal>
  );
}
