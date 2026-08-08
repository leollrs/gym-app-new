// «¿Cómo se gana?» — la primera pregunta, y la que cambia el significado de
// todas las demás.
//
// Antes solo existía el podio, y por eso «ven 12 veces este mes» no cabía en
// ningún sitio: de treinta personas que cumplen, cobraban tres. Un reto de
// asistencia repartido como una carrera no es un reto de asistencia.
//
// El formato decide además la forma de la sección de premios (tres puestos o
// uno solo) y lo que ve el socio en su tarjeta: una posición, o una barra.
import { Trophy, Target } from 'lucide-react';

const OPTIONS = [
  { value: 'competitive', icon: Trophy, tone: '#FDA904' },
  { value: 'completion',  icon: Target, tone: '#3FBF7F' },
];

export default function ChallengeFormatPicker({ value, onPick, t }) {
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const on = value === o.value;
        return (
          <button key={o.value} type="button" onClick={() => onPick(o.value)} aria-pressed={on}
            className="flex items-start gap-3 p-3.5 rounded-xl text-left transition-all"
            style={{
              background: on ? `color-mix(in srgb, ${o.tone} 10%, transparent)` : 'var(--color-admin-panel)',
              border: `1px solid ${on ? o.tone : 'var(--color-admin-border)'}`,
            }}>
            <span className="w-[34px] h-[34px] rounded-[10px] grid place-items-center flex-shrink-0"
              style={{ background: `color-mix(in srgb, ${o.tone} 16%, transparent)`, color: o.tone }}>
              <Icon size={18} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-extrabold" style={{ color: 'var(--color-admin-text)' }}>
                {t(`admin.challenges.format_${o.value}`)}
              </span>
              <span className="block text-[11.5px] leading-snug mt-1" style={{ color: 'var(--color-admin-text-muted)' }}>
                {t(`admin.challenges.format_${o.value}_desc`)}
              </span>
              <span className="block text-[11px] leading-snug mt-1.5 italic" style={{ color: 'var(--color-admin-text-faint)' }}>
                {t(`admin.challenges.format_${o.value}_eg`)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
