/**
 * Precios y ofertas: dinero y vigencia.
 *
 * Vive aparte de la pantalla porque es la regla de QUÉ VE LA WEB, y esa regla
 * tiene que estar escrita en un sitio que se pueda probar. La copia autorizada
 * es la vista `gym_offers_public` (mig 0696) — lo de aquí es el mismo criterio
 * para poder avisar en pantalla antes de guardar.
 */

/**
 * Centavos → lo que se teclea, y al revés.
 *
 * Se guarda en enteros a propósito: un precio en coma flotante acaba enseñando
 * 44,99999 alguna vez, y en un precio eso se ve.
 *
 * `null` significa «consultar», que es un caso real —el plan corporativo se
 * cotiza— y NO es lo mismo que cero. Un cero dice «gratis».
 */
export const centsToInput = (c) => (c == null ? '' : (c / 100).toFixed(2).replace(/\.00$/, ''));

export function inputToCents(v) {
  // Se acepta la coma además del punto: en Puerto Rico se teclean las dos.
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Dinero legible. Cae a `$x.xx` si el entorno no tiene ese locale. */
export function formatMoney(cents, currency, lang, onRequestLabel) {
  if (cents == null) return onRequestLabel || '—';
  try {
    return new Intl.NumberFormat(lang === 'es' ? 'es-PR' : 'en-US', {
      style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

/**
 * ¿Sale hoy en la web?
 *
 * Mismo criterio que `gym_offers_public`. Aquí solo sirve para avisar en
 * pantalla — el filtro que manda está en el servidor, que es donde no se puede
 * olvidar. Si la vigencia la decidiera la web, la promo de agosto seguiría
 * puesta en diciembre, que es justo la pudrición que estas tablas evitan.
 *
 * Los nombres son los de `gym_offers` (0185): `valid_from`/`valid_until`, no
 * `starts_at`/`ends_at`. La tabla ya existía y la ven los miembros en MyGym.
 *
 * `today` se pasa como `YYYY-MM-DD` en vez de leerse aquí: así la comparación
 * es de cadenas —que para ISO corto ordena bien— y no hay que pelearse con la
 * zona horaria, donde `new Date('2026-08-31')` retrocede un día en UTC-4.
 */
export function offerLive(o, today) {
  if (!o) return false;
  return !!o.is_public && !!o.is_active
    && (!o.valid_from || o.valid_from <= today)
    && (!o.valid_until || o.valid_until >= today);
}
