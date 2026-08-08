/**
 * Los números de una clase, en un solo sitio.
 *
 * POR QUÉ VIVE AQUÍ. La cabecera del detalle enseña ocupación y no-show, y la
 * pestaña de Analíticas enseña ocupación y no-show. Si cada una los calcula por
 * su cuenta, tarde o temprano dicen cosas distintas en la MISMA pantalla — y
 * quien mira no sabe a cuál creerle. Una definición, dos consumidores.
 *
 * Todo son funciones puras: entran filas, salen números. Nada de red aquí.
 */

/** ¿Esa reserva es de una sesión que ya pasó? */
export const isPastBooking = (b, today = new Date()) => {
  if (!b?.booking_date) return false;
  const d = new Date(`${String(b.booking_date).slice(0, 10)}T23:59:59`);
  return d < today;
};

/**
 * Las métricas de un conjunto de reservas.
 *
 * `noShowRate` se mide contra las sesiones YA PASADAS y confirmadas, no contra
 * el total: contar contra el total mete las reservas futuras en el denominador
 * y el porcentaje sale siempre bajo, justo cuando peor está el problema.
 */
export function calcClassStats(rows, maxCapacity, today = new Date()) {
  const list = rows || [];
  const total = list.length;
  const attended = list.filter(b => b.attended).length;
  const cancelled = list.filter(b => b.status === 'cancelled').length;
  const noShows = list.filter(b => !b.attended && b.status === 'confirmed' && isPastBooking(b, today)).length;
  const confirmedPast = list.filter(b => isPastBooking(b, today) && (b.status === 'confirmed' || b.attended)).length;
  const rated = list.filter(b => b.attended && b.rating != null);
  const avgRating = rated.length ? rated.reduce((s, b) => s + b.rating, 0) / rated.length : null;
  const sessions = new Set(list.map(b => b.booking_date)).size;

  return {
    total, attended, cancelled, noShows, confirmedPast, sessions,
    // ¿ALGUIEN marca la asistencia de esta clase?
    //
    // `attended` solo se pone a true de dos formas: el socio hace check-in
    // desde la app, o el entrenador la marca desde su pantalla de clases. Un
    // gimnasio que no hace ninguna de las dos tiene la columna entera a false —
    // y entonces «no-show» sale 100 %, que se lee como «no vino nadie» cuando
    // lo que pasa es que nadie lo apunta. Es el peor tipo de número: creíble,
    // alarmante y falso. Con esto la pantalla puede decir un guion en vez de
    // una cifra inventada.
    attendanceTracked: attended > 0,
    attendanceRate: total ? Math.round((attended / total) * 100) : 0,
    noShowRate: confirmedPast ? Math.round((noShows / confirmedPast) * 100) : 0,
    cancellationRate: total ? Math.round((cancelled / total) * 100) : 0,
    avgRating: avgRating != null ? avgRating.toFixed(1) : null,
    avgFill: (sessions && maxCapacity) ? Math.round((total / sessions / maxCapacity) * 100) : null,
  };
}

/**
 * Horarios DUPLICADOS dentro de la misma clase: mismo día (o misma fecha) y
 * misma hora de inicio.
 *
 * No es una rareza teórica: el formulario permite añadir la misma franja dos
 * veces y el socio ve la clase repetida en la app, normalmente con todas las
 * reservas en una y ninguna en la otra. Nadie lo detectaba.
 */
export function duplicateSlots(schedules) {
  const byKey = new Map();
  (schedules || []).forEach((s) => {
    const key = s.specific_date
      ? `d|${s.specific_date}|${String(s.start_time).slice(0, 5)}`
      : `r|${s.day_of_week}|${String(s.start_time).slice(0, 5)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(s);
  });
  return [...byKey.values()].filter(g => g.length > 1);
}

/** Ocupación de una franja en porcentaje, con su aforo propio si lo tiene. */
export function slotFill(bookedCount, slot, classCapacity) {
  const cap = slot?.override_capacity || classCapacity || 0;
  if (!cap) return null;
  return Math.round((bookedCount / cap) * 100);
}

/**
 * El color de una ocupación. Verde llena, ámbar floja, rojo vacía — para que la
 * rejilla de la semana se lea de un vistazo sin tener que sumar nada.
 */
export function fillTone(pct) {
  if (pct == null) return 'var(--color-admin-text-faint)';
  if (pct >= 80) return 'var(--color-success)';
  if (pct >= 45) return 'var(--color-accent)';
  if (pct >= 20) return 'var(--color-warning, #F59E0B)';
  return 'var(--color-danger)';
}

/** Cuántas sesiones a la semana genera este conjunto de franjas. */
export const weeklySessions = (schedules) =>
  (schedules || []).filter(s => !s.specific_date).length;

/**
 * La primera sesión que viene, ya formateada para la tira de cifras.
 * Vive aquí y no en el componente para que no rompa su fast-refresh — y para
 * poder probarla sin montar nada.
 */
export function describeNextSession(sessions, lang, labels) {
  const first = sessions?.[0];
  if (!first) return null;
  const isToday = first.date.toDateString() === new Date().toDateString();
  return {
    label: isToday ? labels.today : first.date.toLocaleDateString(lang, { weekday: 'short', day: 'numeric' }),
    sub: labels.time(first.slot.start_time),
    isToday,
  };
}
