/**
 * La fecha de un `Date`, en LOCAL, como «YYYY-MM-DD».
 *
 * POR QUÉ EXISTE UN MÓDULO PARA UNA LÍNEA. Porque la alternativa evidente
 * —`d.toISOString().slice(0, 10)`— convierte a UTC primero, y Puerto Rico va en
 * UTC-4: a partir de las 8 de la noche devuelve MAÑANA. Con eso, «hoy» empieza
 * a las 8pm, la semana Dom–Sáb se corre un día entero, y las reservas de esta
 * tarde pasan a contar como pasadas — o sea, como no-shows de una clase que
 * todavía no ha empezado. No falla nunca por la mañana, así que no se nota
 * hasta que alguien mira el panel de noche y los números no cuadran.
 *
 * Estaba escrito tres veces (`scheduleOverrides`, el detalle de clase, y a
 * pelo en varios sitios) y mal en unos cuantos más. Una definición.
 */
export function dateKey(d) {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** La fecha de hoy, en local. */
export const todayKey = () => dateKey(new Date());

/**
 * Medianoche local del día de `d`.
 *
 * Hace falta antes de cualquier aritmética de días: un `Date` que arrastra la
 * hora actual, al restarle `getDay()` para buscar el domingo, cruza a UTC en
 * cuanto se formatea de noche — y la semana entera sale corrida.
 */
export function startOfDay(d) {
  const x = d instanceof Date ? new Date(d) : new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
