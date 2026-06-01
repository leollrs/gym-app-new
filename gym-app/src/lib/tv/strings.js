/**
 * TV display string dictionaries.
 *
 * The TV runs un-authenticated (anonymous public access via code), so it
 * can't use the app's i18next instance — that depends on a user's
 * profiles.language column. Instead, we ship its own tiny dictionary
 * keyed by the URL param `?lang=es|en`, defaulting to the gym's locale
 * (Puerto Rico = Spanish by default).
 *
 * Keep this dictionary tight — TVs at 10ft viewing distance need short,
 * punchy labels, not full sentences. Add a key only when it appears in a
 * style component; don't preemptively i18n strings nobody sees.
 */

const STRINGS = {
  en: {
    // Headers / status
    liveLeaderboard: 'Live Leaderboard',
    live: 'LIVE',
    streaming: 'STREAMING',
    // Footer
    rotatesEvery: 'rotates every 20s',
    updatedLive: 'updated live',
    next: 'NEXT',
    // Headlines
    losMasFuertes: 'Top Performers',
    nowMembers: 'ON THE BOARD',
    // Category/section labels
    category: 'Category',
    rank: 'Ranks',
    gymTotal: 'Gym total',
    topPerformer: 'Top performer',
    champion: 'Champion',
    onTheBoard: 'ON THE BOARD',
    // Empty states
    noActivity: 'No activity yet',
    noActivitySub: 'The first member on the board wins this slide',
    beTheFirst: 'Be the first to join',
    scanToJoin: 'Scan the code on the right to enter',
    // Challenges
    activeChallenge: 'Active Challenge',
    startsTomorrow: 'STARTS TOMORROW',
    startsIn: 'STARTS IN',
    endsTomorrow: 'ENDS TOMORROW',
    daysLeft: 'DAYS LEFT',
    finalHours: 'FINAL HOURS',
    ongoing: 'ONGOING',
    days: 'DAYS',
    joinNow: 'Join now',
    signUp: 'Sign up',
    scanWithPhone: 'Scan with your phone camera',
    membersIn: 'members in',
    memberIn: 'member in',
    // Metric labels (override TV_METRIC_DEFS in EN; keeps consistency)
    metric_volume: 'Volume',
    metric_workouts: 'Workouts',
    metric_prs: 'Top PRs',
    metric_improved: 'Most Improved',
    metric_consistency: 'Consistency',
    metric_checkins: 'Check-ins',
    // Periods
    period_30: 'LAST 30 DAYS',
    period_alltime: 'ALL TIME',
    period_month: 'THIS MONTH',
    // Units
    unit_lbs: 'LBS',
    unit_sessions: 'SESSIONS',
    unit_visits: 'VISITS',
    unit_records: 'RECORDS',
    unit_percent: '%',
    // Board labels / table column headers (style components)
    top: 'top',
    scale: 'scale',
    boardMonthly: 'The Board / Monthly',
    now: 'NOW',
    colRank: 'RANK',
    colLifter: 'LIFTER',
    colVsPeers: 'VS PEERS',
    colPosition: 'POSITION',
    colTotal: 'TOTAL',
    // Telemetry metric descriptions (human prose; terminal chrome stays EN by design)
    metricDesc_volume: 'Total weight (lbs) moved across logged sets, 30d window',
    metricDesc_workouts: 'Count of completed workout sessions, 30d window',
    metricDesc_prs: 'Estimated 1RM from logged personal records, all-time',
    metricDesc_improved: 'Volume gain vs prior month, %',
    metricDesc_consistency: 'Distinct workout days ÷ days elapsed in month, %',
    metricDesc_checkins: 'Door check-ins logged, 30d window',
    // Code-entry screen
    entryHeader: 'TuGymPR Display',
    entryTitle: 'Enter TV Code',
    entryHint: 'Find the code in your admin panel under TV Display.',
    entryConnect: 'Connect',
    entryConnecting: 'Connecting…',
    entryErrInvalid: 'Code not recognized. Check the admin panel for the current code.',
    entryErrPaused: 'This gym is paused.',
    entryErrGeneric: 'Could not connect. Try again.',
    entryErrRateLimited: 'Too many attempts. Wait a few minutes and try again.',
    entryErrExpired: 'Code expired. Please re-enter it.',
    entryErrRevoked: 'This screen was disconnected by an admin. Re-enter the code to reconnect.',
    entrySession: 'Session:',
  },
  es: {
    liveLeaderboard: 'Tabla en Vivo',
    live: 'EN VIVO',
    streaming: 'TRANSMITIENDO',
    rotatesEvery: 'rota cada 20s',
    updatedLive: 'actualizado en vivo',
    next: 'SIGUIENTE',
    losMasFuertes: 'Los Más Fuertes',
    nowMembers: 'EN LA TABLA',
    category: 'Categoría',
    rank: 'Posiciones',
    gymTotal: 'Total del gym',
    topPerformer: 'Mejor del mes',
    champion: 'Campeón',
    onTheBoard: 'EN LA TABLA',
    noActivity: 'Aún no hay actividad',
    noActivitySub: 'El primero en aparecer se lleva la slide',
    beTheFirst: 'Sé el primero en unirte',
    scanToJoin: 'Escanea el código para entrar',
    activeChallenge: 'Reto Activo',
    startsTomorrow: 'EMPIEZA MAÑANA',
    startsIn: 'EMPIEZA EN',
    endsTomorrow: 'TERMINA MAÑANA',
    daysLeft: 'DÍAS RESTANTES',
    finalHours: 'ÚLTIMAS HORAS',
    ongoing: 'EN CURSO',
    days: 'DÍAS',
    joinNow: 'Únete',
    signUp: 'Regístrate',
    scanWithPhone: 'Escanea con la cámara de tu celular',
    membersIn: 'miembros dentro',
    memberIn: 'miembro dentro',
    metric_volume: 'Volumen',
    metric_workouts: 'Sesiones',
    metric_prs: 'Top PRs',
    metric_improved: 'Más Mejorado',
    metric_consistency: 'Consistencia',
    metric_checkins: 'Visitas',
    period_30: 'ÚLTIMOS 30 DÍAS',
    period_alltime: 'TODO EL TIEMPO',
    period_month: 'ESTE MES',
    unit_lbs: 'LBS',
    unit_sessions: 'SESIONES',
    unit_visits: 'VISITAS',
    unit_records: 'RÉCORDS',
    unit_percent: '%',
    // Board labels / table column headers (style components)
    top: 'top',
    scale: 'escala',
    boardMonthly: 'La Tabla / Mensual',
    now: 'AHORA',
    colRank: 'PUESTO',
    colLifter: 'ATLETA',
    colVsPeers: 'VS RESTO',
    colPosition: 'POSICIÓN',
    colTotal: 'TOTAL',
    // Telemetry metric descriptions (human prose; terminal chrome stays EN by design)
    metricDesc_volume: 'Peso total (lbs) movido en series registradas, ventana de 30d',
    metricDesc_workouts: 'Sesiones de entrenamiento completadas, ventana de 30d',
    metricDesc_prs: '1RM estimado de récords personales registrados, todo el tiempo',
    metricDesc_improved: 'Aumento de volumen vs el mes anterior, %',
    metricDesc_consistency: 'Días distintos de entrenamiento ÷ días del mes transcurridos, %',
    metricDesc_checkins: 'Visitas registradas en la puerta, ventana de 30d',
    // Code-entry screen
    entryHeader: 'Pantalla TuGymPR',
    entryTitle: 'Escribe el código',
    entryHint: 'Encuentra el código en tu panel de admin, sección Pantalla TV.',
    entryConnect: 'Conectar',
    entryConnecting: 'Conectando…',
    entryErrInvalid: 'Código no reconocido. Revisa el panel de admin para ver el código actual.',
    entryErrPaused: 'Este gym está pausado.',
    entryErrGeneric: 'No se pudo conectar. Inténtalo de nuevo.',
    entryErrRateLimited: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
    entryErrExpired: 'El código expiró. Vuelve a escribirlo.',
    entryErrRevoked: 'Un admin desconectó esta pantalla. Vuelve a escribir el código para reconectar.',
    entrySession: 'Sesión:',
  },
};

export function getTvStrings(lang) {
  return STRINGS[lang === 'es' ? 'es' : 'en'];
}

// Builds the per-language slide list. The metric `key` stays identical
// across languages (it's a stable lookup into dashboardData.leaderboards)
// but `label`, `unit`, and `period` are translated for headline display.
export function getMetricSlides(lang) {
  const s = getTvStrings(lang);
  return [
    { key: 'volume',      label: s.metric_volume.toUpperCase(),      unit: s.unit_lbs,      period: s.period_30 },
    { key: 'workouts',    label: s.metric_workouts.toUpperCase(),    unit: s.unit_sessions, period: s.period_30 },
    { key: 'prs',         label: s.metric_prs.toUpperCase(),         unit: s.unit_records,  period: s.period_alltime },
    { key: 'improved',    label: s.metric_improved.toUpperCase(),    unit: s.unit_percent,  period: s.period_month },
    { key: 'consistency', label: s.metric_consistency.toUpperCase(), unit: s.unit_percent,  period: s.period_month },
    { key: 'checkins',    label: s.metric_checkins.toUpperCase(),    unit: s.unit_visits,   period: s.period_30 },
  ];
}
