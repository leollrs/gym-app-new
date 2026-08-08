// Tier de riesgo → tono visual. Un solo sitio.
//
// Estaba repetido en seis: StatusBadge (RISK_CONFIG), la mini-barra de
// AdminChurn, ChurnRiskBadge, MemberDetailPanel, ContactPanel y el punto de la
// tabla de Miembros. No coincidían — «Alto» salía ámbar en tres y rojo en los
// otros, y varios se saltaban `medium` o nunca llegaban a `low`.
//
// Los UMBRALES viven en getRiskTier (riskScoring.js); esto solo traduce el tier
// que aquella devuelve. Separado a propósito: el modelo decide QUÉ nivel es, la
// interfaz decide DE QUÉ COLOR se pinta.
//
// getRiskTier también devuelve colores, pero son hex fijos que no siguen la
// marca del gimnasio. De allí se toma el nivel, de aquí el color.

export const RISK_TONE = {
  critical: 'hot',
  high: 'warn',
  medium: 'warn',
  low: 'good',
  // Estados, no niveles: no sabemos o no aplica. Neutro, porque pintarlos de
  // verde sería decir que van bien sin que nadie lo haya medido.
  insufficient_data: 'neutral',
  paused: 'neutral',
  churned: 'neutral',
};

const TONE_CSS = {
  hot: 'var(--color-danger)',
  warn: 'var(--color-warning)',
  good: 'var(--color-success)',
  info: 'var(--color-info)',
  neutral: 'var(--color-admin-text-muted)',
};

/** Clave de tono ('hot' | 'warn' | 'good' | 'neutral') para un tier. */
export const riskToneKey = (tier) => RISK_TONE[tier] || 'good';

/** Variable CSS del color para un tier. Sigue la marca del gimnasio. */
export const riskColorVar = (tier) => TONE_CSS[riskToneKey(tier)];
