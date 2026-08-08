// La cabecera del detalle de clase: quién es, y las cuatro cifras que deciden
// si hay que hacer algo con ella.
//
// LO QUE HABÍA. Una tarjeta con la foto, el nombre, el instructor, la duración
// y el aforo. Todo cierto y todo inerte: nada de eso le dice al dueño si la
// clase va bien, si sobra una franja o si la gente reserva y no aparece. Para
// enterarse tenía que entrar en Analíticas y leer.
//
// Las cuatro cifras salen de `lib/admin/classStats.js`, el MISMO sitio del que
// las saca la pestaña de Analíticas. Si cada una las calculara por su cuenta,
// tarde o temprano dirían cosas distintas en la misma pantalla.
import { Users, Clock, CalendarDays } from 'lucide-react';
import CoverPreview from './CoverPreview';
import ClassImage from '../../../components/ClassImage';
import { weeklySessions, fillTone } from '../../../lib/admin/classStats';

const DISPLAY = 'var(--admin-font-display, "Archivo", system-ui, sans-serif)';

function Stat({ label, value, sub, tone }) {
  return (
    <div className="px-3 py-2.5 rounded-xl min-w-0" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
      <p className="text-[9.5px] font-bold uppercase tracking-wider truncate"
        style={{ color: 'var(--color-admin-text-faint)', letterSpacing: '.09em' }}>{label}</p>
      <p className="text-[19px] font-extrabold leading-tight tabular-nums mt-0.5"
        style={{ fontFamily: DISPLAY, color: tone || 'var(--color-admin-text)' }}>{value}</p>
      {sub && <p className="text-[10.5px] leading-snug mt-0.5 truncate" style={{ color: 'var(--color-admin-text-muted)' }}>{sub}</p>}
    </div>
  );
}

export default function ClassDetailHeader({ classItem, stats, nextSession, coaches, t, lang }) {
  const name = (lang === 'es' && classItem.name_es) ? classItem.name_es : classItem.name;
  const desc = (lang === 'es' && classItem.description_es) ? classItem.description_es : classItem.description;
  const slots = classItem.gym_class_schedules || [];
  const perWeek = weeklySessions(slots);
  // Franjas recurrentes que en las últimas cuatro semanas no vendieron NADA.
  // Es la cifra que dice «esta hora no la quiere nadie» sin tener que leer una
  // tabla entera.
  const idle = stats?.idleSlots ?? null;

  const accent = classItem.accent_color || 'var(--color-accent)';

  return (
    <div className="mb-4">
      <div className="flex items-start gap-3">
        <div className="w-[68px] h-[68px] rounded-xl overflow-hidden flex-shrink-0 relative"
          style={{ border: '1px solid var(--color-admin-border)', background: 'var(--color-bg-deep)' }}>
          {classItem.image_path ? (
            <ClassImage path={classItem.image_path} alt={name} accent={accent} loading="eager"
              fallback={classItem.cover_preset ? <CoverPreview preset={classItem.cover_preset} size="square" className="!rounded-none" /> : null}
              style={{ position: 'absolute', inset: 0 }} />
          ) : classItem.cover_preset ? (
            <div className="absolute inset-0"><CoverPreview preset={classItem.cover_preset} size="square" /></div>
          ) : (
            <div className="absolute inset-0 grid place-items-center" style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)` }}>
              <CalendarDays size={22} style={{ color: accent }} />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[18px] font-extrabold leading-tight"
              style={{ fontFamily: DISPLAY, letterSpacing: '-0.3px', color: 'var(--color-admin-text)' }}>{name}</h3>
            <span className="text-[9.5px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full"
              style={classItem.is_active
                ? { background: 'color-mix(in srgb, var(--color-success) 15%, transparent)', color: 'var(--color-success)' }
                : { background: 'var(--color-admin-border)', color: 'var(--color-admin-text-muted)' }}>
              {classItem.is_active ? t('admin.classes.statusLive', 'Activa') : t('admin.classes.statusPaused', 'Pausada')}
            </span>
          </div>
          {desc && (
            <p className="text-[12px] mt-1 leading-snug line-clamp-2" style={{ color: 'var(--color-admin-text-sub)' }}>{desc}</p>
          )}
          <div className="flex items-center gap-3 mt-1.5 text-[11.5px] flex-wrap" style={{ color: 'var(--color-admin-text-muted)' }}>
            {coaches?.length > 0 && (
              <span className="inline-flex items-center gap-1.5"><Users size={12} /> {coaches.join(', ')}</span>
            )}
            <span className="inline-flex items-center gap-1.5"><Clock size={12} /> {classItem.duration_minutes} min</span>
            <span className="inline-flex items-center gap-1.5">
              {t('admin.classes.capacityShort', { n: classItem.max_capacity, defaultValue: 'cap. {{n}}' })}
            </span>
          </div>
        </div>
      </div>

      {/* Las cuatro cifras. Se pintan aunque no haya datos todavía: un guion es
          información («no hay de dónde sacarlo»), un hueco no. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3.5">
        <Stat
          label={t('admin.classes.statFill', 'Ocupación media')}
          value={stats?.avgFill != null ? `${stats.avgFill}%` : '—'}
          tone={stats?.avgFill != null ? fillTone(stats.avgFill) : undefined}
          sub={t('admin.classes.statFillSub', 'últimas 4 semanas')}
        />
        <Stat
          label={t('admin.classes.statNext', 'Próxima sesión')}
          value={nextSession ? nextSession.label : '—'}
          sub={nextSession ? nextSession.sub : t('admin.classes.statNextNone', 'sin horarios')}
        />
        <Stat
          label={t('admin.classes.statPerWeek', 'Horarios / semana')}
          value={perWeek}
          sub={idle != null
            ? (idle > 0
              ? t('admin.classes.statIdle', { count: idle, defaultValue: '{{count}} sin reservas' })
              : t('admin.classes.statAllBooked', 'todos con reservas'))
            : undefined}
        />
        {/* No-show solo cuando hay de dónde sacarlo. Si nadie ha marcado una
            sola asistencia en la ventana, el porcentaje sería 100 % siempre —
            una cifra alarmante que no habla de la clase sino de que nadie hace
            check-in. Ahí va un guion y se dice por qué. */}
        <Stat
          label={t('admin.classes.statNoShow', 'No-show')}
          value={(stats?.confirmedPast && stats?.attendanceTracked) ? `${stats.noShowRate}%` : '—'}
          tone={(stats?.attendanceTracked && stats?.noShowRate > 12) ? 'var(--color-warning, #F59E0B)' : undefined}
          sub={!stats?.confirmedPast
            ? t('admin.classes.statNoData', 'aún sin datos')
            : !stats.attendanceTracked
              ? t('admin.classes.statNoAttendance', 'nadie marca asistencia')
              : t('admin.classes.statNoShowSub', { n: stats.noShows, total: stats.confirmedPast, defaultValue: '{{n}} de {{total}}' })}
        />
      </div>
    </div>
  );
}
