// El ritmo propio de cada socio — la base del modelo v4.
//
// v3 comparaba a todo el mundo contra un ideal fijo (3×/semana) y luego le
// pegaba parches: un amortiguador para no castigar al de baja frecuencia, un
// ajuste por cuartil del gimnasio, un override a los 30 días. Cada parche
// contradecía al anterior — el ancla decía «menos de 2×/semana se va» y el
// amortiguador decía «si es estable en lo suyo, está bien».
//
// Aquí no hay ideal. Cada socio se compara consigo mismo, y de eso salen
// gratis dos cosas que v3 necesitaba calibrar a mano:
//
//   · un box de CrossFit salta a los ~9 días y un estudio boutique a los ~42,
//     con la misma fórmula y sin tocar un solo peso
//   · el veterano se vuelve MÁS sensible, no menos: un año de historia le da
//     un ritmo estrechísimo, así que la misma ausencia pesa más
//
// Este fichero es matemática pura, sin red ni i18n, para que la edge function
// pueda reflejarlo línea por línea.

export const MS_PER_DAY = 86400000;

/** Día natural (UTC) de un instante. Dos visitas el mismo día son UNA visita. */
export const dayOf = (t) => Math.floor(new Date(t).getTime() / MS_PER_DAY);

// Un socio necesita ESTO para que su ritmo sea medible. Por debajo no hay
// mediana que valga y el modelo cae a la curva genérica, diciéndolo.
export const CLASS_A_MIN_VISITS = 8;
export const CLASS_A_MIN_SPAN = 42;

// El p90 se recorta por los dos lados. Abajo: alguien que vino 8 días seguidos
// tendría g90 = 1 y le sonaría la alarma a las 48 horas. Arriba: más de 3
// semanas de ritmo normal ya no es un ritmo, es un socio que apenas viene — y
// de ese se encarga el término de suelo absoluto.
export const G90_MIN = 3;
export const G90_MAX = 21;

/** Percentil con interpolación lineal sobre un array YA ordenado. */
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * @param {number[]} visitDays  días naturales con visita (sin ordenar, con repes)
 * @param {number}   todayDay   día natural de hoy
 * @returns {{
 *   klass: 'A'|'B'|'none', visits: number, spanDays: number,
 *   g90: number|null, daysSinceLastVisit: number|null,
 *   weeklyRate: number, recentWeekly: number, baseWeekly: number, drop: number|null
 * }}
 */
export function buildRhythm(visitDays, todayDay) {
  const days = [...new Set(visitDays)].sort((a, b) => a - b);
  if (days.length === 0) {
    return {
      klass: 'none', visits: 0, spanDays: 0, g90: null, daysSinceLastVisit: null,
      weeklyRate: 0, drop: null,
    };
  }

  const first = days[0];
  const last = days[days.length - 1];
  const spanDays = last - first;
  const daysSinceLastVisit = todayDay - last;

  // Ventana de observación real, no siempre 90: un socio con 50 días de cuenta
  // no tuvo 90 días en los que pudiera venir, y dividir por 90 le rebajaría la
  // frecuencia a la mitad sin haber hecho nada mal.
  const observedDays = Math.max(14, Math.min(90, todayDay - first + 1));
  const weeklyRate = (days.length / observedDays) * 7;

  // ── Caída: medida HASTA LA ÚLTIMA VISITA, no hasta hoy ──
  //
  // Es el arreglo que sacaron las pruebas. Midiéndola hasta hoy, el hueco actual
  // se comía la ventana reciente y la caída disparaba por la misma razón que la
  // brecha: un socio diario ausente 12 días marcaba caída del 52% cuando venía
  // como un reloj hasta el día que desapareció. Dos términos leyendo el mismo
  // hecho es justo el pecado de v3.
  //
  // Separadas, cada una dice lo suyo: la brecha, «no está viniendo AHORA»; la
  // caída, «ya venía menos ANTES de irse». Un socio puede tener una sin la otra,
  // y esa distinción es la que decide qué se le dice cuando lo llamas.
  const cut = last;
  const recentN = days.filter((d) => d > cut - 21 && d <= cut).length;
  const baseN = days.filter((d) => d <= cut - 21).length;
  const baseSpan = Math.max(0, Math.min(69, cut - 21 - first + 1));
  const recentWeekly = (recentN / 21) * 7;
  const baseWeekly = baseSpan >= 21 ? (baseN / baseSpan) * 7 : 0;

  // Solo tiene sentido con base suficiente: con menos de 1 visita/semana, una
  // ventana de 21 días espera menos de 3 visitas y el "ratio" es ruido — para
  // el de 1×/mes daba caída del 100% por haberse saltado UNA visita.
  // Sin recortar a 0: en negativo significa que venía MÁS que antes, y esa es la
  // única forma de que `trend: 'improving'` sea alcanzable — con el recorte, la
  // flecha de mejora del panel era una rama muerta. El riesgo ya lo acota
  // `sigDrop`, que manda cualquier negativo a cero.
  const drop = baseWeekly >= 1 ? 1 - recentWeekly / baseWeekly : null;

  const gaps = [];
  for (let i = 1; i < days.length; i++) gaps.push(days[i] - days[i - 1]);
  gaps.sort((a, b) => a - b);

  if (days.length >= CLASS_A_MIN_VISITS && spanDays >= CLASS_A_MIN_SPAN) {
    return {
      klass: 'A', visits: days.length, spanDays, daysSinceLastVisit, weeklyRate, drop,
      g90: Math.max(G90_MIN, Math.min(G90_MAX, percentile(gaps, 0.9))),
    };
  }

  // Clase B: pocas visitas para un percentil fiable, pero con 3+ intervalos SÍ
  // se sabe cuánto es "mucho" para esta persona. Se usa el intervalo MÁS LARGO
  // que se le ha visto — más conservador que un p90 con tres datos, y sigue
  // siendo su vara y no la de un ideal. Sin esto, el socio de 1×/3 semanas caía
  // a la curva genérica y salía Crítico a los 30 días sin haber faltado a nada.
  if (gaps.length >= 3) {
    return {
      klass: 'B', visits: days.length, spanDays, daysSinceLastVisit, weeklyRate, drop,
      g90: Math.max(G90_MIN, Math.min(G90_MAX, gaps[gaps.length - 1])),
    };
  }

  return {
    klass: 'C', visits: days.length, spanDays, daysSinceLastVisit, weeklyRate,
    drop: null, g90: null,
  };
}

/** Cuánta confianza merece la puntuación. Va como etiqueta aparte, NUNCA dentro del número. */
export function confidenceOf(rhythm) {
  if (rhythm.klass === 'A') return 'high';
  if (rhythm.klass === 'B') return 'medium';
  return 'low';
}
