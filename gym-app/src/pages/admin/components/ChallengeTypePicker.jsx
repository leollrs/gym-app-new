// «¿Qué se mide?» — la primera pregunta, y la que decide todo lo demás.
//
// Antes eran cinco radios en una lista. El problema no era el aspecto: era que
// escoger «levantamiento específico» no preguntaba CUÁL, así que el reto salía
// sin ejercicio y no puntuaba nunca. Cada tarjeta dice ahora en qué se mide, y
// el bloque de debajo pide lo que ese tipo necesita para funcionar.
import { Flame, Dumbbell, TrendingUp, Target, Users, Medal, DoorOpen } from 'lucide-react';
import { CHALLENGE_TYPES } from '../../../lib/admin/challengeConfig';

const ICONS = {
  consistency: Flame,
  volume: Dumbbell,
  pr_count: TrendingUp,
  specific_lift: Target,
  team: Users,
  milestone: Medal,
  check_in: DoorOpen,
};

export default function ChallengeTypePicker({ value, onPick, t }) {
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {CHALLENGE_TYPES.map((ct) => {
        const Icon = ICONS[ct.value];
        const on = value === ct.value;
        return (
          <button key={ct.value} type="button" onClick={() => onPick(ct.value)} aria-pressed={on}
            className="flex items-start gap-2.5 p-3 rounded-xl text-left transition-all"
            style={{
              background: on ? `color-mix(in srgb, ${ct.tone} 10%, transparent)` : 'var(--color-admin-panel)',
              border: `1px solid ${on ? ct.tone : 'var(--color-admin-border)'}`,
            }}>
            <span className="w-[30px] h-[30px] rounded-[9px] grid place-items-center flex-shrink-0"
              style={{ background: `color-mix(in srgb, ${ct.tone} 16%, transparent)`, color: ct.tone }}>
              <Icon size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-bold" style={{ color: 'var(--color-admin-text)' }}>
                {t(`admin.challengeTypes.${ct.value}`)}
              </span>
              <span className="block text-[11px] leading-snug mt-0.5" style={{ color: 'var(--color-admin-text-muted)' }}>
                {t(`admin.challengeTypes.${ct.value}_desc`)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
