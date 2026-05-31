import { useState } from 'react';
import { Repeat, CalendarDays, Trash2, X, Upload, Loader2, Languages } from 'lucide-react';
import { AdminModal } from '../../../components/admin';
import { classImageUrl } from '../../../lib/classImageUrl';
import { useAutoTranslate } from '../../../hooks/useAutoTranslate';
import { slotDayLabel, format12h, DAYS_OF_WEEK } from '../../../lib/admin/classScheduleHelpers';
import TranslationPreviewModal from './TranslationPreviewModal';
import InstructorSelector from './InstructorSelector';
import RoutineSelector from './RoutineSelector';
import ScheduleSlotForm from './ScheduleSlotForm';
import CoverPreview, { CLASS_COVERS } from './CoverPreview';

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
export default function ClassFormModal({ classData, onClose, onSave, saving, gymId, trainers = [], onAddSlot, onDeleteSlot, t, tc, lang }) {
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
  const [pendingSlots, setPendingSlots] = useState([]);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(classImageUrl(classData?.image_path) || classData?.image_url || '');
  const [coverPreset, setCoverPreset] = useState(classData?.cover_preset || '');
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const { translate, translating } = useAutoTranslate();

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
    if (!validateClassForm()) return;

    if (classData?.id) {
      onSave({
        ...form,
        name_es: classData?.name_es || '',
        description_es: classData?.description_es || '',
        imageFile,
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
      onSave({ ...form, name_es: classData?.name_es || '', description_es: classData?.description_es || '', imageFile, pendingSlots, cover_preset: coverPreset || null });
      return;
    }

    const isSpanish = result.detected_lang === 'ES';

    if (isSpanish) {
      // Admin typed in Spanish → we need EN translation, not ES
      const toEn = await translate(texts, 'EN');
      if (!toEn) {
        onSave({ ...form, name_es: form.name, description_es: form.description || '', imageFile, pendingSlots, cover_preset: coverPreset || null });
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

  return (
    <AdminModal isOpen onClose={onClose} title={isEditing ? t('admin.classes.editClass') : t('admin.classes.addClass')} size="lg">
      <div className="space-y-4">
        {/* Name */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.className')} <span className="text-red-400">*</span></label>
            <CharCount value={form.name} max={NAME_MAX} />
          </div>
          <input value={form.name} onChange={e => { if (e.target.value.length <= NAME_MAX) setFormField('name', e.target.value); }}
            onBlur={() => handleClassBlur('name')}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: `1px solid ${errors.name ? 'var(--color-danger-soft)' : 'var(--color-border-subtle)'}`, color: 'var(--color-text-primary)' }}
            placeholder={t('admin.classes.namePlaceholder', 'Yoga, Spinning, CrossFit...')} />
          {errors.name && <p className="text-[11px] text-red-400 mt-1">{errors.name}</p>}
        </div>

        {/* Description */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.description')}</label>
            <CharCount value={form.description} max={DESC_MAX} />
          </div>
          <textarea value={form.description} onChange={e => { if (e.target.value.length <= DESC_MAX) setFormField('description', e.target.value); }} rows={2}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none resize-none transition-colors"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
        </div>

        {/* Instructor (multi-select — pulls from trainers and admins) */}
        <InstructorSelector
          gymId={gymId}
          values={form.trainer_ids}
          onChange={(ids) => setForm(f => ({ ...f, trainer_ids: ids }))}
          t={t}
        />

        {/* Duration + Capacity */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.duration')} ({tc('min') || 'min'}) <span className="text-red-400">*</span></label>
            <input type="number" min={5} max={480} value={form.duration_minutes} onChange={e => setFormField('duration_minutes', Number(e.target.value))}
              onBlur={() => handleClassBlur('duration_minutes')}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: `1px solid ${errors.duration_minutes ? 'var(--color-danger-soft)' : 'var(--color-border-subtle)'}`, color: 'var(--color-text-primary)' }} />
            {errors.duration_minutes && <p className="text-[11px] text-red-400 mt-1">{errors.duration_minutes}</p>}
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.capacity')} <span className="text-red-400">*</span></label>
            <input type="number" min={1} max={1000} value={form.max_capacity} onChange={e => setFormField('max_capacity', Number(e.target.value))}
              onBlur={() => handleClassBlur('max_capacity')}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: `1px solid ${errors.max_capacity ? 'var(--color-danger-soft)' : 'var(--color-border-subtle)'}`, color: 'var(--color-text-primary)' }} />
            {errors.max_capacity && <p className="text-[11px] text-red-400 mt-1">{errors.max_capacity}</p>}
          </div>
        </div>

        {/* Schedule Slots */}
        <div>
          <label className="flex items-center gap-1.5 text-[11px] font-medium mb-2" style={{ color: 'var(--color-text-muted)' }}>
            <Repeat size={12} /> {t('admin.classes.weeklySchedule', 'Weekly Schedule')}
          </label>

          {/* Slot table — existing (edit mode) or pending (new class) */}
          {((isEditing && classData?.gym_class_schedules?.length > 0) || (!isEditing && pendingSlots.length > 0)) && (
            <div className="rounded-xl overflow-hidden mb-2"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                    <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-muted)' }}>{tc('day') || t('admin.classes.day', 'Day')}</th>
                    <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.time', 'Time')}</th>
                    <th className="w-10 px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {(isEditing ? [...classData.gym_class_schedules].sort((a, b) => {
                    if (a.specific_date && !b.specific_date) return 1;
                    if (!a.specific_date && b.specific_date) return -1;
                    if (a.specific_date && b.specific_date) return a.specific_date.localeCompare(b.specific_date);
                    return (a.day_of_week ?? 0) - (b.day_of_week ?? 0) || a.start_time.localeCompare(b.start_time);
                  }) : pendingSlots).map((slot, idx) => {
                    const key = slot.id || `pending-${idx}`;
                    const onDelete = isEditing
                      ? () => onDeleteSlot(slot.id)
                      : () => setPendingSlots(s => s.filter((_, i) => i !== idx));
                    return (
                      <tr key={key} style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}>
                        <td className="px-3 py-2">
                          {slot.specific_date ? (
                            <span className="inline-flex items-center gap-1 font-medium" style={{ color: 'var(--color-info, #60A5FA)' }}>
                              <CalendarDays size={11} />
                              {slotDayLabel(slot, (d) => tc(DAYS_OF_WEEK.find(x => x.value === d)?.labelKey), lang)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                              <Repeat size={11} style={{ color: 'var(--color-accent, #D4AF37)' }} />
                              {tc(DAYS_OF_WEEK.find(d => d.value === slot.day_of_week)?.labelKey)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                          {format12h(slot.start_time)} <span style={{ color: 'var(--color-text-muted)' }}>–</span> {format12h(slot.end_time)}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button type="button" onClick={onDelete} aria-label={t('admin.classes.deleteSlot', 'Delete schedule slot')} className="p-1.5 rounded hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Add slot form */}
          <ScheduleSlotForm
            onAdd={(slot) => {
              if (isEditing && classData?.id) {
                onAddSlot(classData.id, slot);
              } else {
                setPendingSlots(s => [...s, slot]);
              }
            }}
            durationMinutes={form.duration_minutes}
            t={t}
            tc={tc}
            lang={lang}
          />

          {(!isEditing && pendingSlots.length === 0 && !classData?.gym_class_schedules?.length) && (
            <p className="text-[10px] italic mt-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.scheduleHint', 'Add time slots for when this class repeats each week')}</p>
          )}
        </div>

        {/* Workout Template */}
        <RoutineSelector gymId={gymId} value={form.workout_template_id} onChange={(id) => setForm(f => ({ ...f, workout_template_id: id }))} t={t} />

        {/* Class cover — preset or custom upload */}
        <div>
          <label className="block text-[11px] font-medium mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.classCover', 'Class Cover')}</label>

          {/* Custom image preview */}
          {imagePreview ? (
            <div className="relative w-full h-32 rounded-xl overflow-hidden mb-2" style={{ border: '1px solid var(--color-border-subtle)' }}>
              <img src={imagePreview} alt={t('admin.classes.imagePreviewAlt', 'Class image preview')} className="w-full h-full object-cover" />
              <button onClick={() => { setImageFile(null); setImagePreview(''); setCoverPreset(''); }}
                aria-label={t('admin.classes.removeImage', 'Remove image')}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors">
                <X size={14} />
              </button>
            </div>
          ) : coverPreset ? (
            <div className="relative mb-2">
              <CoverPreview preset={coverPreset} size="lg" />
              <button onClick={() => setCoverPreset('')}
                aria-label={t('admin.classes.removeCover', 'Remove cover')}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors">
                <X size={14} />
              </button>
            </div>
          ) : null}

          {/* Preset grid */}
          {!imagePreview && (
            <>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {CLASS_COVERS.map(c => {
                  const Icon = c.icon;
                  const selected = coverPreset === c.key;
                  return (
                    <button key={c.key} type="button"
                      onClick={() => { setCoverPreset(c.key); setImageFile(null); setImagePreview(''); }}
                      className={`rounded-xl p-2 flex flex-col items-center gap-1 transition-all ${selected ? 'ring-2 ring-white scale-[1.03]' : 'opacity-70 hover:opacity-100'}`}
                      style={{ background: c.gradient }}>
                      <Icon size={18} className="text-white/90" />
                      <span className="text-[8px] font-bold text-white/80 uppercase tracking-wide">{t(c.labelKey)}</span>
                    </button>
                  );
                })}
              </div>

              {/* Or upload custom */}
              <label className="flex items-center justify-center gap-2 w-full py-2 rounded-xl border border-dashed cursor-pointer transition-colors hover:opacity-80"
                style={{ borderColor: 'var(--color-border-subtle)' }}>
                <Upload size={14} style={{ color: 'var(--color-text-muted)' }} />
                <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.uploadCustom', 'Or upload your own image')}</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { handleImageChange(e); setCoverPreset(''); }} />
              </label>
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 mt-5">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors hover:opacity-80"
          style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-hover)' }}>
          {tc('cancel')}
        </button>
        <button onClick={handleTranslateAndPreview} disabled={saving || translating || !form.name.trim()}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: 'var(--color-accent, #D4AF37)', color: 'var(--color-bg-base)' }}>
          {translating ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
          {translating ? t('admin.classes.translating') : tc('save')}
        </button>
      </div>
    </AdminModal>
  );
}
