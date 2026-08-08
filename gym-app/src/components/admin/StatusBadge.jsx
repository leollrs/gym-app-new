/**
 * Status badge for membership status and risk tiers.
 */
import { useTranslation } from 'react-i18next';
import { AlertTriangle, AlertOctagon, Info, CheckCircle, HelpCircle, PauseCircle, XCircle } from 'lucide-react';
// El modelo de churn es el dueño de los umbrales. Importar sin ciclo: riskScoring
// no depende de componentes, solo de i18next.
import { getRiskTier } from '../../lib/churn/riskScoring';
import { riskToneKey } from '../../lib/churn/riskTone';

// All status/risk colors now route through CSS vars so they auto-adapt to
// light/dark and to the premium triage palette (danger=hot orange, warning=amber,
// success=green, coach=purple). Background uses the *-soft tint, text uses *-ink.
const STATUS_CONFIG = {
  active:      { dot: true,  key: 'active',      tone: 'good' },
  frozen:      { dot: false, key: 'frozen',      tone: 'info' },
  deactivated: { dot: false, key: 'deactivated', tone: 'warn' },
  cancelled:   { dot: false, key: 'cancelled',   tone: 'neutral' },
  banned:      { dot: false, key: 'banned',      tone: 'hot' },
};

const RISK_CONFIG = {
  critical:          { key: 'critical',          Icon: AlertOctagon },
  high:              { key: 'high',              Icon: AlertTriangle },
  medium:            { key: 'medium',            Icon: Info },
  low:               { key: 'low',               Icon: CheckCircle },
  insufficient_data: { key: 'insufficient_data', Icon: HelpCircle },
  paused:            { key: 'paused',            Icon: PauseCircle },
  churned:           { key: 'churned',           Icon: XCircle },
};

const TONE_VARS = {
  good:    { bg: 'var(--color-success-soft)', fg: 'var(--color-success-ink)', dot: 'var(--color-success)' },
  warn:    { bg: 'var(--color-warning-soft)', fg: 'var(--color-warning-ink)', dot: 'var(--color-warning)' },
  hot:     { bg: 'var(--color-danger-soft)',  fg: 'var(--color-danger-ink)',  dot: 'var(--color-danger)' },
  coach:   { bg: 'var(--color-coach-soft)',   fg: 'var(--color-coach-ink)',   dot: 'var(--color-coach)' },
  info:    { bg: 'var(--color-info-soft)',    fg: 'var(--color-info)',        dot: 'var(--color-info)' },
  neutral: { bg: 'var(--color-admin-panel)',  fg: 'var(--color-admin-text-sub)', dot: 'var(--color-admin-text-muted)' },
};

export function StatusBadge({ status }) {
  const { t } = useTranslation('pages');
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.active;
  // STATUS_CONFIG, no riskToneKey: esto pinta el ESTADO DE MEMBRESÍA
  // (activo/congelado/baneado), que no tiene nada que ver con el riesgo.
  const tone = TONE_VARS[cfg.tone] ?? TONE_VARS.neutral;
  const label = t(`admin.statusLabels.${(status || 'active').toLowerCase()}`);
  if (cfg.dot) {
    return (
      <span className="flex items-center gap-1" title={label}>
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: tone.dot }} />
      </span>
    );
  }
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {label}
    </span>
  );
}

/**
 * Compact status dot — color-coded by membership status (active=green,
 * frozen=blue, deactivated=amber, cancelled=neutral, banned=red). Used in the
 * members directory table where a clean liveness dot beats a text pill; the
 * exact status stays available on hover (title) and to screen readers.
 */
export function StatusDot({ status, size = 9 }) {
  const { t } = useTranslation('pages');
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.active;
  // Igual que StatusBadge: estado de membresía, no riesgo.
  const tone = TONE_VARS[cfg.tone] ?? TONE_VARS.neutral;
  const label = t(`admin.statusLabels.${(status || 'active').toLowerCase()}`);
  return (
    <span className="inline-flex items-center justify-center" title={label} aria-label={label} role="img">
      <span className="rounded-full flex-shrink-0" style={{ width: size, height: size, background: tone.dot, boxShadow: `0 0 0 3px color-mix(in srgb, ${tone.dot} 16%, transparent)` }} />
    </span>
  );
}

/**
 * Punto de estado por RIESGO DE BAJA, no por estado de membresía.
 *
 * El de antes (StatusDot) pintaba activo/congelado, así que en un gimnasio donde
 * nadie está congelado TODOS los puntos salían del mismo color y la columna no
 * decía nada. Este dice lo único que el admin quiere ver de un vistazo bajando
 * por la lista: a quién está a punto de perder.
 *
 * El color sale de riskTone.js, igual que en toda la app. Lo único propio de
 * aquí es que CONGELADO manda sobre el tier y pinta azul: no es un nivel de
 * riesgo, es una membresía en pausa, y mezclarlo con los tiers haría que un
 * congelado se leyera como alguien a quien vas a perder.
 */
export function RiskDot({ score, state = 'scored', membershipStatus, size = 9 }) {
  const { t } = useTranslation('pages');
  const frozen = membershipStatus === 'frozen';
  // Mismo tierFromScore que la barra de Riesgo de Baja, que a su vez delega en
  // el modelo. Mismo número → mismo color, por construcción.
  const tier = tierFromScore(score, state);
  const tone = frozen ? TONE_VARS.info : (TONE_VARS[riskToneKey(tier)] ?? TONE_VARS.neutral);
  const label = frozen
    ? t('admin.statusLabels.frozen')
    : t(`admin.riskLabels.${(tier || 'low').toLowerCase()}`);
  return (
    <span className="inline-flex items-center" title={label} aria-label={label} role="img">
      <span className="rounded-full flex-shrink-0" style={{ width: size, height: size, background: tone.dot, boxShadow: `0 0 0 3px color-mix(in srgb, ${tone.dot} 16%, transparent)` }} />
    </span>
  );
}

export function RiskBadge({ tier, score }) {
  const { t } = useTranslation('pages');
  const cfg = RISK_CONFIG[tier] ?? RISK_CONFIG.low;
  const tone = TONE_VARS[riskToneKey(tier)] ?? TONE_VARS.neutral;
  const RiskIcon = cfg.Icon;
  const label = t(`admin.riskLabels.${(tier || 'low').toLowerCase()}`);
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10.5px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider"
      style={{ color: tone.fg, background: tone.bg }}
      role="status"
      aria-label={`${label}${score != null ? ` ${typeof score === 'number' && score % 1 === 0 ? score : score?.toFixed?.(1)}` : ''}`}
    >
      <RiskIcon size={12} className="flex-shrink-0" aria-hidden="true" />
      {label}
      {score != null && (
        <span className="admin-mono opacity-70 font-semibold">
          {typeof score === 'number' && score % 1 === 0 ? score : score?.toFixed?.(1)}
        </span>
      )}
    </span>
  );
}

/**
 * Tier a partir del puntaje, delegando en getRiskTier — el del MODELO de churn.
 *
 * Había tres definiciones del mismo umbral y no coincidían: el modelo cortaba
 * «Alto» en 55, la tarjeta de Riesgo de Baja decía «55–79» en su propio texto,
 * y ScoreBar cortaba en 60. Un miembro con 57 se contaba como Alto arriba y se
 * pintaba de color Medio abajo, en la misma pantalla.
 *
 * El modelo manda. Aquí solo se traduce su `tier` a un tono del tema: los
 * colores que getRiskTier devuelve son hex fijos y no siguen la marca del
 * gimnasio, así que de ahí se toma el NIVEL, nunca el color.
 */
function tierFromScore(score, state = 'scored') {
  const n = Number(score);
  return getRiskTier(Number.isFinite(n) ? n : 0, state).tier;
}

export function ScoreBar({ score, state = 'scored' }) {
  const tier = tierFromScore(score, state);
  const tone = TONE_VARS[riskToneKey(tier)];
  const display = score % 1 === 0 ? score : score.toFixed(1);
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex-1 md:min-w-[120px] h-1.5 rounded-full overflow-hidden"
        style={{ background: 'var(--color-admin-panel)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, score)}%`, background: tone.dot }}
        />
      </div>
      <span
        className="admin-mono text-[11px] font-bold w-10 text-right"
        style={{ color: tone.fg }}
      >
        {display}%
      </span>
    </div>
  );
}

export { STATUS_CONFIG, RISK_CONFIG };
