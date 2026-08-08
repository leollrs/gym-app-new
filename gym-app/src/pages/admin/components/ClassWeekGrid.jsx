// La semana de la clase, dibujada.
//
// LO QUE HABÍA. Una lista de franjas ordenada por día: «Lunes 9:00 – 9:45»,
// «Miércoles 9:00 – 9:45», una debajo de otra. Cierta y muda. Con una lista no
// se ve lo único que importa de un horario: dónde se amontona, dónde hay un
// hueco de cinco horas, y qué franja está vacía al lado de una que revienta.
//
// Aquí cada bloque se pinta en su hora real y se colorea por ocupación, así que
// «el martes a las 6 está lleno y el viernes a la misma hora no lo quiere
// nadie» se ve sin leer un número.
import { fillTone, slotFill } from '../../../lib/admin/classStats';
import { format12h, dayInitials } from '../../../lib/admin/classScheduleHelpers';

const toMin = (t) => {
  if (!t) return 0;
  const [h, m] = String(t).split(':');
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
};

export default function ClassWeekGrid({ schedules, capacity, bookedBySlot, duplicateIds, lang, t }) {
  // Solo lo recurrente: una fecha suelta no vive en «la semana». Sale abajo, en
  // la lista, donde sí se puede decir de qué día es.
  const weekly = (schedules || []).filter(s => !s.specific_date);
  if (!weekly.length) return null;

  // La ventana se ajusta a lo que hay. Pintar de 6 de la mañana a 10 de la
  // noche cuando la clase solo tiene dos franjas a las 9 deja el 90 % del
  // dibujo vacío y los bloques del tamaño de una uña.
  const starts = weekly.map(s => toMin(s.start_time));
  const ends = weekly.map(s => toMin(s.end_time || s.start_time) || toMin(s.start_time) + 60);
  const from = Math.max(0, Math.floor((Math.min(...starts) - 60) / 60) * 60);
  const to = Math.min(24 * 60, Math.ceil((Math.max(...ends) + 60) / 60) * 60);
  const span = Math.max(120, to - from);
  const H = 250;
  const y = (m) => ((m - from) / span) * H;

  const initials = dayInitials(lang);
  const hours = [];
  for (let h = Math.ceil(from / 60); h <= Math.floor(to / 60); h += 1) hours.push(h);
  const axisEvery = hours.length > 8 ? 2 : 1;

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-admin-border)', background: 'var(--color-admin-panel)' }}>
      <div className="grid" style={{ gridTemplateColumns: '30px repeat(7, minmax(0,1fr))' }}>
        <span />
        {initials.map((d, i) => (
          <div key={i} className="text-center py-2 text-[10px] font-bold"
            style={{ color: 'var(--color-admin-text-faint)', letterSpacing: '.06em' }}>{d}</div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '30px repeat(7, minmax(0,1fr))', height: H }}>
        <div className="relative">
          {hours.filter((_, i) => i % axisEvery === 0).map(h => (
            <span key={h} className="absolute right-1 text-[9px] tabular-nums"
              style={{ top: y(h * 60) - 5, color: 'var(--color-admin-text-faint)' }}>
              {h % 12 === 0 ? 12 : h % 12}{h < 12 ? 'a' : 'p'}
            </span>
          ))}
        </div>

        {[0, 1, 2, 3, 4, 5, 6].map(dow => {
          const day = weekly.filter(s => s.day_of_week === dow).sort((a, b) => toMin(a.start_time) - toMin(b.start_time));
          return (
            <div key={dow} className="relative" style={{ borderLeft: '1px solid var(--color-admin-border)' }}>
              {hours.map(h => (
                <div key={h} className="absolute left-0 right-0" style={{ top: y(h * 60), borderTop: '1px dashed var(--color-admin-border)', opacity: 0.5 }} />
              ))}
              {day.map((s) => {
                const booked = bookedBySlot?.[s.id] ?? null;
                const pct = booked == null ? null : slotFill(booked, s, capacity);
                const dup = duplicateIds?.has(s.id);
                const tone = dup ? 'var(--color-warning, #F59E0B)' : fillTone(pct);
                const top = y(toMin(s.start_time));
                const h = Math.max(26, y(toMin(s.end_time || s.start_time)) - top);
                // Dos franjas a la misma hora se reparten el ancho — si no, una
                // tapa a la otra y el duplicado que se quiere ver desaparece.
                const same = day.filter(x => toMin(x.start_time) === toMin(s.start_time));
                const idx = same.indexOf(s);
                return (
                  <div key={s.id}
                    title={`${format12h(s.start_time)}${booked != null ? ` · ${booked}/${s.override_capacity || capacity}` : ''}`}
                    className="absolute rounded-md px-1 py-0.5 overflow-hidden"
                    style={{
                      top, height: h,
                      left: `calc(2px + ${idx} * (100% - 4px) / ${same.length})`,
                      width: `calc((100% - 4px) / ${same.length} - ${same.length > 1 ? 2 : 0}px)`,
                      background: `color-mix(in srgb, ${tone} 16%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${tone} 45%, transparent)`,
                    }}>
                    <p className="text-[8.5px] font-bold leading-none tabular-nums truncate" style={{ color: tone }}>
                      {format12h(s.start_time).replace(' ', '')}
                    </p>
                    {booked != null && h > 32 && (
                      <p className="text-[8px] leading-none mt-0.5 tabular-nums truncate" style={{ color: 'var(--color-admin-text-muted)' }}>
                        {booked}/{s.override_capacity || capacity}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {bookedBySlot == null && (
        <p className="text-[10.5px] px-3 py-2" style={{ color: 'var(--color-admin-text-faint)', borderTop: '1px solid var(--color-admin-border)' }}>
          {t('admin.classes.gridNoBookings', 'Sin reservas todavía — los colores aparecen cuando la gente empiece a reservar.')}
        </p>
      )}
    </div>
  );
}
