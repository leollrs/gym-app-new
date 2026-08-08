// Los distintivos de la tarjeta de clase y la tipografía que la compone.
//
// Viven aquí y no dentro de la página del socio porque la vista previa del
// formulario de admin enseña LA MISMA tarjeta. Si el admin ve una tarjeta y el
// socio otra, la vista previa deja de servir para lo único que sirve. Una sola
// definición, dos consumidores.
import { Check, Dumbbell } from 'lucide-react';

export const CFD = '"Archivo","Familjen Grotesk",system-ui,sans-serif';   // display
export const CFB = '"Familjen Grotesk",-apple-system,system-ui,sans-serif'; // body
export const CFM = '"JetBrains Mono","SF Mono",ui-monospace,monospace';     // mono
export const GOLD = '#D4AF37';

/* status pill (gold available · accent booked · danger full · muted passed) */
export function ClassStatusPill({ stateKey, accent, t, waitlistPos }) {
  const map = {
    available: { txt: t('classes.statusAvailable', 'Disponible'), c: GOLD, bg: 'rgba(212,175,55,0.15)', ln: 'rgba(212,175,55,0.4)' },
    booked:    { txt: t('classes.booked', 'Reservada'), c: accent, bg: `color-mix(in srgb, ${accent} 13%, transparent)`, ln: `color-mix(in srgb, ${accent} 32%, transparent)`, check: true },
    waitlisted:{ txt: t('classes.waitlistedShort', { position: waitlistPos || 1, defaultValue: `Lista · #${waitlistPos || 1}` }), c: '#F59E0B', bg: 'rgba(245,158,11,0.15)', ln: 'rgba(245,158,11,0.35)' },
    full:      { txt: t('classes.full', 'Llena'), c: 'var(--color-danger)', bg: 'rgba(240,99,75,0.12)', ln: 'rgba(240,99,75,0.34)' },
    attended:  { txt: t('classes.attended', 'Asistida'), c: 'var(--color-success)', bg: 'color-mix(in srgb, var(--color-success) 14%, transparent)', ln: 'color-mix(in srgb, var(--color-success) 32%, transparent)', check: true },
    passed:    { txt: t('classes.statusFinished', 'Finalizada'), c: 'var(--color-text-muted)', bg: 'rgba(255,255,255,0.06)', ln: 'rgba(255,255,255,0.09)' },
  };
  const s = map[stateKey] || map.available;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px',
      background: s.bg, border: `1px solid ${s.ln}`, borderRadius: 999,
      fontFamily: CFB, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: s.c }}>
      {s.check && <Check size={12} strokeWidth={2.6} />}
      {s.txt}
    </span>
  );
}

/* gold category tag (Workout — only when the class carries a template) */
export function ClassCatTag({ t }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px 6px 10px',
      background: 'rgba(212,175,55,0.15)', border: '1px solid rgba(212,175,55,0.4)', borderRadius: 999,
      fontFamily: CFB, fontSize: 12.5, fontWeight: 800, letterSpacing: 0.2, color: GOLD }}>
      <Dumbbell size={14} strokeWidth={2.2} />
      {t('classes.hasWorkout', { defaultValue: 'Workout' }).split(' ').slice(-1)[0]}
    </span>
  );
}
