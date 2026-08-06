/**
 * «No hay ninguno» y «no lo puedo leer» son cosas distintas, y un panel que las
 * pinta igual miente.
 *
 * EL FALLO DEL QUE SALE ESTO
 *
 * La pestaña de Actividad hacía, sobre la vista de regalos:
 *
 *   if (error) return [];
 *
 * O sea que con la migración 0694 sin aplicar la consulta fallaba, devolvía una
 * lista vacía, y la pantalla enseñaba «0 regalos enviados». Un cero es un DATO:
 * el gimnasio lo lee como «mi campaña no ha regalado nada» y va a tocar la
 * campaña. La verdad era «esta tabla no existe todavía».
 *
 * Ese es el patrón caro: un fallo que se disfraza de medición. Un hueco se ve y
 * se pregunta; un cero se cree.
 *
 * Vive fuera del componente porque el entorno de pruebas de este repo es `node`
 * —sin jsdom ni testing-library— así que una función pura es lo único que se
 * puede blindar aquí de verdad, y es donde estaba el error.
 */

/**
 * Envuelve una respuesta de Supabase sin tragarse el error.
 *
 * OJO con el orden: se mira `error` ANTES que `data`. PostgREST devuelve
 * `data: null` junto al error, así que comprobar primero los datos vuelve a
 * confundir los dos casos — que es exactamente el bug.
 */
export function readResult(error, data) {
  if (error) return { rows: [], unavailable: true, error };
  return { rows: data || [], unavailable: false, error: null };
}

/**
 * Los tres estados que puede pintar un bloque del panel. Son TRES y no dos:
 * meter «no disponible» dentro de «vacío» es como se llegó al cero mentiroso.
 *
 * `undefined` cuenta como no disponible, no como vacío: es lo que hay mientras
 * la consulta no ha resuelto o si alguien llama sin pasar nada, y en ninguno de
 * los dos casos se ha comprobado que no haya datos.
 */
export function panelState(result) {
  if (!result || result.unavailable) return 'unavailable';
  return (result.rows?.length ?? 0) === 0 ? 'empty' : 'data';
}

/**
 * Un número para enseñar, o un guion cuando no se pudo leer.
 *
 * Devuelve CADENA a propósito: si devolviera 0 en el caso ilegible, el sitio
 * donde se pinta volvería a no distinguirlo de un cero de verdad, y habríamos
 * movido el problema en vez de arreglarlo.
 */
export function statValue(result, compute, placeholder = '—') {
  if (!result || result.unavailable) return placeholder;
  return compute(result.rows);
}
