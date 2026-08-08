// «¿Cuándo se da?» — la lista de horarios y el editor, en el mismo sitio.
//
// Un horario, para quien llena esto, es «lunes, miércoles y viernes a las 9».
// La tabla guarda una fila por día, así que al pintar fila a fila esos tres
// días salían como tres tarjetas idénticas salvo el nombre del día, y ocho
// franjas llenaban la pantalla sin decir nada. `groupSlots` las vuelve a
// juntar: una tarjeta, la tira de siete días, la hora.
//
// El aviso del INSTRUCTOR se distingue del de la sala a propósito: el segundo
// se arregla usando otro salón, el primero no se arregla de ninguna manera.
import { useState } from 'react';
import { Repeat, CalendarDays, Trash2, Plus, Check, AlertTriangle, Pencil } from 'lucide-react';
import { format12h, addMinutes, DAYS_OF_WEEK, groupSlots, dayInitials } from '../../../lib/admin/classScheduleHelpers';
import { findConflicts } from '../../../lib/admin/classConflicts';

const DUR_PRESETS = [30, 45, 60, 90];
const todayISO = () => new Date().toISOString().slice(0, 10);
const minutesBetween = (a, b) => {
  const m = (s) => (parseInt(s.split(':')[0], 10) * 60) + parseInt(s.split(':')[1], 10);
  return Math.max(0, m(b) - m(a));
};

export default function ClassSchedulePlanner({
  slots, duration, onAdd, onDelete, onUpdate, onDurationChange,
  allClasses = [], excludeClassId, trainerIds = [], trainers = [], t, tc, lang,
}) {
  const groups = groupSlots(slots, duration);
  const [editing, setEditing] = useState(() => groups.length === 0);
  const [editKey, setEditKey] = useState(null); // grupo que se está modificando
  const [mode, setMode] = useState('recurring');
  const [days, setDays] = useState([]);
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState('09:00');
  // Instructor POR FRANJA. No sale en el mockup —allí la clase tiene uno solo—
  // pero el modelo lo soporta y el formulario viejo lo ofrecía. Quitarlo en
  // silencio habría sido perder una capacidad sin que nadie lo decidiera.
  const [slotTrainer, setSlotTrainer] = useState('');
  // Duración en curso de edición. `duration` (la de la clase) solo cambia al confirmar.
  const [draftDuration, setDraftDuration] = useState(duration);

  const initials = dayInitials(lang);
  const conflictsFor = (slot) => findConflicts(slot, duration, allClasses, { excludeClassId, trainerIds });

  // Aviso del editor: se mira contra TODOS los días marcados, no solo el primero.
  const draftSlots = mode === 'recurring'
    ? days.map(d => ({ day_of_week: d, specific_date: null, start_time: time }))
    : [{ day_of_week: null, specific_date: date, start_time: time }];
  const draftConflicts = draftSlots.flatMap(conflictsFor);
  const coachClash = draftConflicts.find(c => c.instructorClash);
  const canSave = mode === 'recurring' ? days.length > 0 : !!date;

  const target = editKey ? groups.find(g => g.key === editKey) : null;
  // Días que el admin acaba de quitar de un horario que ya existe. Borrar la
  // fila cancela EN CASCADA las reservas de ese día (class_bookings apunta a
  // gym_class_schedules con ON DELETE CASCADE), así que se dice antes, no
  // después.
  const droppedDays = target && mode === 'recurring'
    ? target.days.filter(d => !days.includes(d))
    : [];

  const openNew = () => {
    setEditKey(null); setMode('recurring'); setDays([]); setSlotTrainer('');
    setDraftDuration(duration);
    setEditing(true);
  };

  const openEdit = (g) => {
    setEditKey(g.key);
    setMode(g.kind === 'date' ? 'specific' : 'recurring');
    setDays(g.kind === 'date' ? [] : g.days);
    setDate(g.specific_date || todayISO());
    setTime(g.start_time);
    setSlotTrainer(g.trainer_id || '');
    // La duración de la franja se lleva en estado LOCAL y solo se propaga al
    // confirmar. Propagarla al abrir cambiaba la duración de la CLASE entera
    // por el mero hecho de mirar una franja — y Cancelar no la devolvía, así
    // que al guardar por cualquier otro motivo `AdminClasses` reescribía el
    // `end_time` de TODAS las franjas con esa duración accidental.
    setDraftDuration(minutesBetween(g.start_time, g.end_time) || duration);
    setEditing(true);
  };

  const close = () => { setEditing(false); setEditKey(null); setDays([]); setSlotTrainer(''); };

  const commit = () => {
    if (!canSave) return;
    const end = addMinutes(time, draftDuration);
    const trainer_id = slotTrainer || null;
    // AHORA sí: la duración escogida pasa a la clase, al confirmar y no antes.
    if (draftDuration !== duration) onDurationChange(draftDuration);

    if (!target) {
      draftSlots.forEach(s => onAdd({ ...s, end_time: end, trainer_id }));
      close();
      return;
    }

    // Modificar, no rehacer. Las filas de los días que se quedan se ACTUALIZAN:
    // si se borraran y se volvieran a crear, cada reserva de esa clase moriría
    // por el ON DELETE CASCADE sin que nadie lo pidiera.
    if (mode === 'recurring') {
      const kept = target.rows.filter(r => days.includes(r.slot.day_of_week));
      const gone = target.rows.filter(r => !days.includes(r.slot.day_of_week));
      const fresh = days.filter(d => !target.days.includes(d));
      kept.forEach(r => onUpdate(r.slot, { start_time: time, end_time: end, trainer_id }, r.index));
      // De atrás hacia delante, por lo mismo que en removeGroup.
      [...gone].reverse().forEach(r => onDelete(r.slot, r.index));
      fresh.forEach(d => onAdd({ day_of_week: d, specific_date: null, start_time: time, end_time: end, trainer_id }));
    } else {
      // De recurrente a fecha suelta: se BORRA el grupo entero y se crea UNA
      // fila. Actualizar solo `rows[0]` dejaba el lunes convertido en fecha y
      // el miércoles y el viernes recurrentes, sin decir nada — y en una clase
      // ya guardada el CHECK de la 0182 (día o fecha, nunca los dos) rechazaba
      // el UPDATE y el admin veía el error crudo de Postgres.
      [...target.rows].reverse().forEach(r => onDelete(r.slot, r.index));
      onAdd({ day_of_week: null, specific_date: date, start_time: time, end_time: end, trainer_id });
    }
    close();
  };

  const removeGroup = (g) => {
    // De atrás hacia delante: al crear, las franjas viven en un array local y
    // borrar por índice de menor a mayor corre los que faltan por borrar.
    [...g.rows].reverse().forEach(r => onDelete(r.slot, r.index));
    if (editKey === g.key) close();
  };

  const trainerName = (id) => trainers.find(x => x.id === id)?.full_name || '';

  const btn = 'inline-flex items-center justify-center gap-1.5 h-[34px] px-3 rounded-lg text-[12.5px] font-bold transition-colors';
  const chip = (on) => ({
    background: on ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'var(--color-bg-deep)',
    border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
    color: on ? 'var(--color-accent)' : 'var(--color-text-muted)',
  });
  const iconBtn = 'w-[28px] h-[28px] grid place-items-center rounded-lg transition-colors flex-shrink-0';

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const cf = g.rows.flatMap(r => conflictsFor(r.slot));
        const clash = cf.find(c => c.instructorClash) || cf[0];
        const isDate = g.kind === 'date';
        const len = minutesBetween(g.start_time, g.end_time);
        const being = editKey === g.key;
        return (
          <div key={g.key} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
            style={{
              background: 'var(--color-bg-deep)',
              border: `1px solid ${being ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
              opacity: being ? 0.55 : 1,
            }}>
            <span className="w-[30px] h-[30px] rounded-lg grid place-items-center flex-shrink-0"
              style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)' }}>
              {isDate ? <CalendarDays size={14} /> : <Repeat size={14} />}
            </span>

            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                {!isDate && (
                  <div className="flex gap-[3px]">
                    {initials.map((d, i) => {
                      const on = g.days.includes(i);
                      return (
                        <span key={i} className="w-[22px] h-[20px] rounded-[5px] grid place-items-center text-[10px] font-bold"
                          style={{
                            background: on ? 'color-mix(in srgb, var(--color-accent) 18%, transparent)' : 'var(--color-bg-hover)',
                            color: on ? 'var(--color-accent)' : 'var(--color-text-subtle)',
                          }}>{d}</span>
                      );
                    })}
                  </div>
                )}
                <p className="text-[12.5px] font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                  {isDate && `${new Date(`${g.specific_date}T00:00:00`).toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' })} · `}
                  {format12h(g.start_time)} – {format12h(g.end_time)}
                </p>
              </div>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {isDate
                  ? t('admin.classes.onceOnly', 'Una sola vez')
                  : `${t('admin.classes.everyWeek', 'Cada semana')} · ${t('admin.classes.nDays', { count: g.days.length, defaultValue: '{{count}} días' })}`}
                {len ? ` · ${t('admin.classes.nMin', { n: len, defaultValue: '{{n}} min' })}` : ''}
                {g.trainer_id && trainerName(g.trainer_id) ? ` · ${trainerName(g.trainer_id)}` : ''}
                {clash && (
                  <span style={{ color: 'var(--color-warning, var(--color-accent))' }}>
                    {' · '}{t('admin.classes.clashWith', { name: clash.name, defaultValue: 'Choca con {{name}}' })}
                  </span>
                )}
              </p>
            </div>

            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => openEdit(g)}
                aria-label={t('admin.classes.editSlot', 'Edit schedule slot')}
                className={iconBtn} style={{ color: 'var(--color-text-muted)' }}>
                <Pencil size={14} />
              </button>
              <button type="button" onClick={() => removeGroup(g)}
                aria-label={t('admin.classes.deleteSlot', 'Delete schedule slot')}
                className={iconBtn} style={{ color: 'var(--color-danger)' }}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}

      {!editing && (
        <button type="button" onClick={openNew}
          className="w-full h-[38px] rounded-xl text-[13px] font-bold inline-flex items-center justify-center gap-2 transition-colors"
          style={{ border: '1px dashed var(--color-border-default)', color: 'var(--color-text-muted)' }}>
          <Plus size={15} /> {t('admin.classes.addAnotherSlot', 'Añadir otro horario')}
        </button>
      )}

      {editing && (
        <div className="rounded-xl p-3.5" style={{ border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)', background: 'color-mix(in srgb, var(--color-accent) 5%, transparent)' }}>
          <div className="inline-flex p-0.5 rounded-lg mb-3" style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
            {[['recurring', Repeat, t('admin.classes.repeatsWeekly', 'Se repite cada semana')],
              ['specific', CalendarDays, t('admin.classes.singleDay', 'Un solo día')]].map(([m, icon, label]) => {
              // Const local y no el parámetro destructurado: el lint de este repo
              // no cuenta el uso en JSX de un ARGUMENTO (cae bajo `args`, no bajo
              // `vars`, y `varsIgnorePattern` no lo cubre).
              const Icon = icon;
              return (
              <button key={m} type="button" onClick={() => setMode(m)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-bold transition-colors"
                style={{
                  background: mode === m ? 'var(--color-bg-hover)' : 'transparent',
                  color: mode === m ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                }}>
                <Icon size={13} /> {label}
              </button>
              );
            })}
          </div>

          {mode === 'recurring' ? (
            <>
              <div className="flex items-baseline justify-between mb-1.5">
                <p className="text-[11.5px] font-bold" style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.classes.daysOfWeek', 'Días de la semana')}
                </p>
                <span className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('admin.classes.nSelected', { count: days.length, defaultValue: '{{count}} seleccionados' })}
                </span>
              </div>
              {/* DAYS_OF_WEEK ya viene con domingo=0, igual que Postgres y que el
                  resto de la app. Ni reordenar ni reindexar. */}
              <div className="grid grid-cols-7 gap-1.5">
                {DAYS_OF_WEEK.map((d) => {
                  const on = days.includes(d.value);
                  const busy = findConflicts(
                    { day_of_week: d.value, specific_date: null, start_time: time },
                    duration, allClasses, { excludeClassId, trainerIds },
                  ).length > 0;
                  return (
                    <button key={d.value} type="button"
                      onClick={() => setDays(s => s.includes(d.value) ? s.filter(x => x !== d.value) : [...s, d.value].sort())}
                      className="h-[36px] rounded-lg text-[11.5px] font-bold transition-colors"
                      style={{
                        ...chip(on),
                        ...(on ? { background: 'var(--color-accent)', color: 'var(--color-text-on-accent)', border: '1px solid var(--color-accent)' } : {}),
                        ...(busy && !on ? { borderColor: 'color-mix(in srgb, var(--color-warning, var(--color-accent)) 45%, transparent)' } : {}),
                      }}>
                      {(tc(d.labelKey) || '').slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div>
              <p className="text-[11.5px] font-bold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.date', 'Fecha')}</p>
              <input type="date" value={date} min={todayISO()} onChange={e => setDate(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <p className="text-[11.5px] font-bold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.startTime', 'Hora de inicio')}</p>
              <input type="time" step={300} value={time} onChange={e => setTime(e.target.value || '09:00')}
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
            </div>
            <div>
              <p className="text-[11.5px] font-bold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.duration')}</p>
              <div className="flex gap-1.5 flex-wrap">
                {DUR_PRESETS.map(d => (
                  <button key={d} type="button" onClick={() => setDraftDuration(d)}
                    className="h-[34px] px-2.5 rounded-lg text-[12px] font-bold tabular-nums transition-colors"
                    style={chip(draftDuration === d)}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {(coachClash || draftConflicts.length > 0) && (
            <div className="flex gap-2 mt-3 px-3 py-2.5 rounded-lg"
              style={{ background: 'color-mix(in srgb, var(--color-warning, var(--color-accent)) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning, var(--color-accent)) 30%, transparent)' }}>
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning, var(--color-accent))' }} />
              <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                {coachClash
                  ? t('admin.classes.clashCoach', {
                    name: coachClash.name,
                    defaultValue: 'Ese instructor ya está dando {{name}} a esa hora. Una persona no puede estar en dos clases a la vez.',
                  })
                  : t('admin.classes.clashRoom', {
                    names: [...new Set(draftConflicts.map(c => c.name))].join(', '),
                    defaultValue: 'Se solapa con {{names}}. Puedes guardarlo igual si usas otra sala.',
                  })}
              </p>
            </div>
          )}

          {droppedDays.length > 0 && (
            <div className="flex gap-2 mt-3 px-3 py-2.5 rounded-lg"
              style={{ background: 'color-mix(in srgb, var(--color-danger) 9%, transparent)', border: '1px solid color-mix(in srgb, var(--color-danger) 28%, transparent)' }}>
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-danger)' }} />
              <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                {t('admin.classes.dropDayWarning', {
                  days: droppedDays.map(d => tc(DAYS_OF_WEEK[d].labelKey)).join(', '),
                  defaultValue: 'Al guardar se quita {{days}}, y las reservas que ya tenga ese día se cancelan.',
                })}
              </p>
            </div>
          )}

          {trainers.length > 0 && (
            <div className="mt-3">
              <p className="text-[11.5px] font-bold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.classes.slotTrainer', 'Instructor de esta franja')}
                <span className="font-normal" style={{ color: 'var(--color-text-subtle)' }}> — {t('admin.classes.optional', 'opcional')}</span>
              </p>
              <select value={slotTrainer} onChange={e => setSlotTrainer(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}>
                <option value="">{t('admin.classes.sameAsClass', 'El mismo de la clase')}</option>
                {trainers.map(tr => <option key={tr.id} value={tr.id}>{tr.full_name}</option>)}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
            <span className="text-[11.5px] tabular-nums flex-1 min-w-0" style={{ color: 'var(--color-text-muted)' }}>
              {mode === 'recurring' && !days.length
                ? t('admin.classes.pickADay', 'Escoge al menos un día')
                : `${format12h(time)} – ${format12h(addMinutes(time, draftDuration))}`}
            </span>
            {(groups.length > 0 || target) && (
              <button type="button" onClick={close} className={btn} style={{ color: 'var(--color-text-muted)' }}>
                {tc('cancel')}
              </button>
            )}
            <button type="button" onClick={commit} disabled={!canSave}
              className={`${btn} disabled:opacity-40 disabled:cursor-not-allowed`}
              style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}>
              <Check size={14} />
              {target ? t('admin.classes.saveSlotChanges', 'Guardar cambios') : t('admin.classes.addThisSlot', 'Añadir este horario')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
