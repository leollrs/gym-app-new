// El panel derecho: lo que el socio va a ver, y lo que de verdad estás creando.
//
// La tarjeta de arriba no se parece a la del socio: ES la del socio. Misma
// altura de foto, mismo degradado, mismo nombre encima de la imagen, mismos
// distintivos (ClassCardBadges) y la misma fila de datos. Una vista previa que
// enseña otra cosa no sirve para lo único que sirve.
//
// Debajo, lo que el formulario viejo no decía: que «3 franjas» significan **12
// sesiones al mes**. Esa es la decisión real —cuánta gente, cuántas horas de
// instructor— y no aparecía por ningún lado.
import { useMemo } from 'react';
import { Clock, Users } from 'lucide-react';
import CoverPreview from './CoverPreview';
import ClassImage from '../../../components/ClassImage';
import { ClassStatusPill, ClassCatTag, CFD, CFB, CFM } from '../../../components/ClassCardBadges';
import { projectSessions, calendarGrid } from '../../../lib/admin/classConflicts';
import { format12h, addMinutes, dayInitials } from '../../../lib/admin/classScheduleHelpers';

export default function ClassFormRail({
  name, description, coverPreset, imagePreview, typeMeta,
  instructorLabel, capacity, duration, slots, hasRoutine, t, lang,
}) {
  const sessions = useMemo(() => projectSessions(slots), [slots]);
  const grid = useMemo(() => calendarGrid(), []);
  const marked = useMemo(
    () => new Set(sessions.map(s => s.date.toDateString())),
    [sessions],
  );
  const initials = useMemo(() => dayInitials(lang), [lang]);
  const first = sessions[0];
  const today = new Date();
  const todayKey = today.toDateString();

  const shown = name.trim();
  const Icon = typeMeta?.icon;
  const accent = 'var(--color-accent)';

  return (
    <div className="space-y-4">
      {/* ── Así la ven los miembros ── */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
          {t('admin.classes.railPreview', 'Así la ven los miembros')}
        </p>

        <div className="rounded-[20px] overflow-hidden" style={{
          border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-card)',
          boxShadow: '0 14px 30px -18px rgba(0,0,0,0.7)', opacity: shown ? 1 : 0.65,
        }}>
          {/* hero — la foto con el nombre encima, igual que en la app */}
          <div className="relative" style={{ height: 132 }}>
            {imagePreview ? (
              <ClassImage path={imagePreview} alt="" accent={accent} loading="eager" style={{ position: 'absolute', inset: 0 }} />
            ) : coverPreset ? (
              <div className="absolute inset-0"><CoverPreview preset={coverPreset} size="square" /></div>
            ) : (
              <div className="absolute inset-0 grid place-items-center" style={{ background: 'var(--color-bg-hover)' }}>
                {Icon ? <Icon size={26} strokeWidth={1.7} style={{ color: 'var(--color-text-muted)' }} /> : null}
              </div>
            )}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(9,11,13,0.25), rgba(9,11,13,0.05) 45%, var(--color-bg-card) 100%)' }} />
            {hasRoutine && <div style={{ position: 'absolute', top: 13, left: 14 }}><ClassCatTag t={t} /></div>}
            {/* Una clase recién creada no tiene reservas: el socio la ve libre. */}
            <div style={{ position: 'absolute', top: 13, right: 14 }}>
              <ClassStatusPill stateKey="available" accent={accent} t={t} />
            </div>
            <div style={{
              position: 'absolute', left: 14, right: 14, bottom: 11,
              fontFamily: CFD, fontWeight: 900, fontSize: 22, letterSpacing: -0.6,
              color: shown ? '#fff' : 'rgba(255,255,255,0.55)',
              textShadow: '0 2px 18px rgba(0,0,0,0.5)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {shown || t('admin.classes.railNamePlaceholder', 'Nombre de la clase')}
            </div>
          </div>

          {/* cuerpo — hora · quién la da · cupos, la misma fila de la app */}
          <div style={{ padding: '13px 16px 15px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, whiteSpace: 'nowrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: CFM, fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                <Clock size={14} style={{ color: accent }} strokeWidth={2} />
                {first
                  ? `${format12h(first.slot.start_time)} – ${format12h(first.slot.end_time || addMinutes(first.slot.start_time, duration))}`
                  : t('admin.classes.railNoTimeYet', 'Sin horario')}
              </span>
              <span style={{ width: 4, height: 4, borderRadius: 99, background: 'var(--color-text-muted)', flexShrink: 0 }} />
              {/* Misma precedencia que la tarjeta del socio: si no hay quien la
                  dé, ese hueco lo ocupa la duración, no un «sin instructor». */}
              <span style={{ fontFamily: CFB, fontSize: 12, color: 'var(--color-text-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {instructorLabel || t('classes.minutes', { count: duration, defaultValue: `${duration} min` })}
              </span>
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Users size={13} style={{ color: 'var(--color-text-muted)' }} />
                <span style={{ fontFamily: CFM, fontSize: 11.5, fontWeight: 600, color: accent }}>0/{capacity}</span>
              </span>
            </div>

            {description.trim() && (
              <p className="text-[11.5px] leading-snug line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>
                {description.trim()}
              </p>
            )}
          </div>
        </div>

        {/* Fuera de la tarjeta a propósito: el socio ve la clase dentro de un
            día concreto, así que la fecha no vive en la tarjeta. Aquí sí hace
            falta saber cuándo cae la primera. */}
        <p className="text-[11px] mt-1.5 flex items-baseline justify-between gap-2" style={{ color: 'var(--color-text-subtle)' }}>
          <span>{t('admin.classes.railNextSession', 'Próxima sesión')}</span>
          <span className="font-bold tabular-nums" style={{ color: first ? 'var(--color-text-secondary)' : 'var(--color-text-subtle)' }}>
            {first ? first.date.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' }) : '—'}
          </span>
        </p>
      </div>

      {/* ── Lo que vas a crear ── */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
          {t('admin.classes.railWhatYouCreate', 'Lo que vas a crear')}
        </p>
        <div className="rounded-xl p-3" style={{ border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-deep)' }}>
          <div className="flex items-end gap-2.5">
            <span className="text-[30px] font-extrabold leading-none tabular-nums"
              style={{ color: sessions.length ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
              {sessions.length}
            </span>
            <span className="text-[11.5px] leading-snug pb-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.classes.railSessions4w', 'sesiones en las próximas 4 semanas')}
            </span>
          </div>

          <div className="grid grid-cols-7 gap-1 mt-3">
            {initials.map((d, i) => (
              <span key={i} className="text-[9px] font-bold text-center" style={{ color: 'var(--color-text-subtle)' }}>{d}</span>
            ))}
            {grid.map((d) => {
              const on = marked.has(d.toDateString());
              const past = d < new Date(today.getFullYear(), today.getMonth(), today.getDate());
              const isToday = d.toDateString() === todayKey;
              return (
                <span key={d.toISOString()}
                  className="text-[9.5px] tabular-nums text-center rounded-[5px] py-1"
                  style={{
                    background: on ? 'color-mix(in srgb, var(--color-accent) 22%, transparent)' : 'transparent',
                    color: on ? 'var(--color-accent)' : past ? 'var(--color-text-subtle)' : 'var(--color-text-muted)',
                    fontWeight: on ? 700 : 400,
                    opacity: past && !on ? 0.4 : 1,
                    outline: isToday ? '1px solid var(--color-border-default)' : 'none',
                  }}>
                  {d.getDate()}
                </span>
              );
            })}
          </div>

          {sessions.length > 0 && (
            <p className="text-[10.5px] mt-2.5" style={{ color: 'var(--color-text-subtle)' }}>
              {t('admin.classes.railPerWeek', {
                n: (sessions.length / 4).toFixed(1),
                defaultValue: '{{n}} por semana',
              })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
