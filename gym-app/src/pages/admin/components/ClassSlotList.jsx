// «TODOS LOS HORARIOS» — agrupados por día, con quién los da y cómo van.
//
// LO QUE HABÍA. Una lista plana ordenada por día: «Lunes 9:00 – 9:45»,
// «Miércoles 9:00 – 9:45». Cierta y muda. No decía quién la da, ni si esa hora
// se llena, ni cuál de dos filas idénticas es la que sobra.
//
// Agrupar por día no es decoración: «Lunes · 2 sesiones» es la frase que hace
// visible el duplicado antes de leer las horas.
import { Pencil, Trash2, Plus, CalendarDays, Repeat } from 'lucide-react';
import { format12h, DAYS_OF_WEEK } from '../../../lib/admin/classScheduleHelpers';
import { slotFill, fillTone } from '../../../lib/admin/classStats';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

const initialsOf = (name) => (name || '?')
  .split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

// Color estable a partir del nombre: el mismo instructor sale del mismo color en
// toda la pantalla sin tener que guardarlo en ningún sitio.
const hueOf = (name) => {
  let h = 0;
  for (let i = 0; i < (name || '').length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
};

function Coach({ name, isCover, t }) {
  if (!name) return null;
  const hue = hueOf(name);
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className="w-[22px] h-[22px] rounded-full grid place-items-center text-[9.5px] font-extrabold flex-shrink-0"
        style={{ background: `hsl(${hue} 55% 42%)`, color: '#fff' }}>{initialsOf(name)}</span>
      <span className="text-[12px] truncate" style={{ color: 'var(--color-admin-text-sub)' }}>{name}</span>
      {/* Quien da ESA franja no es el instructor de la clase. Saberlo importa:
          una hora que rinde la mitad puede ser el día… o puede ser quién la da. */}
      {isCover && (
        <span className="text-[8.5px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: 'color-mix(in srgb, var(--color-info) 16%, transparent)', color: 'var(--color-info)', letterSpacing: '.06em' }}>
          {t('admin.classes.covering', 'Cubre')}
        </span>
      )}
    </span>
  );
}

export default function ClassSlotList({
  slots, capacity, bookedBySlot, duplicateIds, trainers = [], mainTrainerId,
  onAddSlot, onEditSlot, onDeleteSlot, dayLabel, t, lang,
}) {
  const trainerName = (id) => trainers.find(x => x.id === id)?.full_name || null;

  // Recurrentes por día de la semana, y las fechas sueltas juntas al final:
  // una fecha concreta no pertenece a «los lunes».
  const byDay = DAYS_OF_WEEK.map(d => ({
    key: `d${d.value}`,
    label: dayLabel(d.value),
    rows: slots.filter(s => !s.specific_date && s.day_of_week === d.value)
      .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time))),
  })).filter(g => g.rows.length);

  const oneOffs = slots.filter(s => s.specific_date)
    .sort((a, b) => String(a.specific_date).localeCompare(String(b.specific_date)));
  if (oneOffs.length) {
    byDay.push({ key: 'dates', label: t('admin.classes.oneOffDates', 'Fechas sueltas'), rows: oneOffs, isDates: true });
  }

  const iconBtn = 'w-[28px] h-[28px] grid place-items-center rounded-lg transition-colors flex-shrink-0';

  return (
    <div>
      <div className="flex items-center gap-3 mb-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-admin-text-faint)', letterSpacing: '.09em' }}>
          {t('admin.classes.allSlots', 'Todos los horarios')}
        </p>
        <div className="flex-1 h-px" style={{ background: 'var(--color-admin-border)' }} />
        {onAddSlot && (
          <button type="button" onClick={onAddSlot}
            className="inline-flex items-center gap-1.5 h-[30px] px-3 rounded-lg text-[12px] font-bold flex-shrink-0"
            style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text-sub)' }}>
            <Plus size={13} /> {t('admin.classes.addSlot', 'Añadir horario')}
          </button>
        )}
      </div>

      {byDay.length === 0 && (
        <p className="text-[12px] italic py-2" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.classes.noScheduleSlots')}</p>
      )}

      {byDay.map(group => (
        <div key={group.key} className="mb-3">
          <p className="flex items-baseline gap-2 mb-1.5">
            <span className="text-[12.5px] font-bold capitalize" style={{ color: 'var(--color-admin-text)' }}>{group.label}</span>
            <span className="text-[11px]" style={{ color: 'var(--color-admin-text-faint)' }}>
              {t('admin.classes.nSessions', { count: group.rows.length, defaultValue: '{{count}} sesiones' })}
            </span>
          </p>

          <div className="space-y-1.5">
            {group.rows.map(slot => {
              const dup = duplicateIds?.has(slot.id);
              const booked = bookedBySlot?.[slot.id] ?? null;
              const pct = booked == null ? null : slotFill(booked, slot, capacity);
              const tone = fillTone(pct);
              const coach = trainerName(slot.trainer_id);
              const isCover = !!slot.trainer_id && !!mainTrainerId && slot.trainer_id !== mainTrainerId;
              // Un duplicado SIN reservas es el que sobra. Decirlo evita que el
              // admin borre el que sí tiene gente dentro.
              const emptyDup = dup && (booked == null || booked === 0);

              return (
                <div key={slot.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                  style={{
                    background: dup ? 'color-mix(in srgb, var(--color-warning, #F59E0B) 7%, transparent)' : 'var(--color-bg-deep)',
                    border: `1px solid ${dup ? 'color-mix(in srgb, var(--color-warning, #F59E0B) 40%, transparent)' : 'var(--color-admin-border)'}`,
                  }}>
                  <span className="text-[12.5px] font-bold tabular-nums whitespace-nowrap flex-shrink-0"
                    style={{ fontFamily: MONO, color: 'var(--color-admin-text)' }}>
                    {group.isDates && (
                      <span className="inline-flex items-center gap-1.5 mr-2" style={{ color: 'var(--color-info)' }}>
                        <CalendarDays size={12} />
                        {new Date(`${slot.specific_date}T00:00:00`).toLocaleDateString(lang, { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                    {format12h(slot.start_time)} – {format12h(slot.end_time)}
                  </span>

                  <Coach name={coach} isCover={isCover} t={t} />

                  <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                    {emptyDup ? (
                      <span className="text-[11.5px] font-bold whitespace-nowrap" style={{ color: 'var(--color-warning, #F59E0B)' }}>
                        {t('admin.classes.exactDuplicate', 'Duplicado exacto')}
                      </span>
                    ) : pct != null ? (
                      <div className="flex items-center gap-2" style={{ width: 104 }}>
                        <div className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: 'var(--color-admin-border)' }}>
                          <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: tone }} />
                        </div>
                        <span className="text-[11.5px] font-bold tabular-nums" style={{ fontFamily: MONO, color: tone }}>
                          {booked}/{slot.override_capacity || capacity}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[11px]" style={{ color: 'var(--color-admin-text-faint)' }}>
                        {t('admin.classes.slotNoData', 'sin reservas')}
                      </span>
                    )}

                    {onEditSlot && (
                      <button type="button" onClick={onEditSlot} className={iconBtn}
                        aria-label={t('admin.classes.editSlot', 'Modificar horario')}
                        style={{ color: 'var(--color-admin-text-muted)' }}>
                        <Pencil size={14} />
                      </button>
                    )}
                    {onDeleteSlot && (
                      <button type="button" onClick={() => onDeleteSlot(slot)} className={iconBtn}
                        aria-label={t('admin.classes.deleteSlot', 'Eliminar horario')}
                        style={{ color: 'var(--color-danger)' }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Lo que de verdad pasa al borrar, dicho antes de borrar. `class_bookings`
          apunta a `gym_class_schedules` con ON DELETE CASCADE: quitar la franja
          cancela las reservas que tenga, y nadie avisa a esa gente. */}
      {slots.length > 0 && onDeleteSlot && (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug mt-1" style={{ color: 'var(--color-admin-text-faint)' }}>
          <Repeat size={12} className="flex-shrink-0 mt-0.5" />
          {t('admin.classes.deleteSlotWarn', 'Eliminar un horario cancela las reservas que ya tenga ese día.')}
        </p>
      )}
    </div>
  );
}
