// =============================================================
// svix.ts — verificación de firma de webhooks (Resend, y cualquiera que use Svix)
// =============================================================
//
// Vive aparte de la función que lo usa por una razón concreta: `index.ts` llama
// a `Deno.serve` al importarse, así que no se puede cargar desde una prueba sin
// levantar un servidor. Y ESTO HAY QUE PROBARLO. Es la única autenticación de un
// endpoint abierto a internet: si acepta de más, cualquiera puede POSTear
// «rebote permanente» con la dirección de quien quiera y dejarlo sin correo para
// siempre.
//
// EL ESQUEMA, QUE NO ES «HMAC DEL CUERPO»
//
//   contenido = `${id}.${timestamp}.${cuerpo crudo}`
//   firma     = base64( HMAC-SHA256( base64decode(secreto sin 'whsec_'), contenido ) )
//
// Tres cosas que lo rompen si se hacen de oído:
//   1. La clave son los BYTES decodificados del secreto, no sus caracteres.
//   2. Se firma el cuerpo CRUDO. Un JSON.parse + stringify cambia los bytes.
//   3. La cabecera trae una lista separada por espacios (`v1,aaa v1,bbb`),
//      porque durante una rotación de secreto conviven dos firmas válidas.
// =============================================================

/** Tolerancia de reloj, en segundos. La misma que usa Svix. */
export const SVIX_TOLERANCE_SECONDS = 300;

/** Comparación en tiempo constante: un `===` sobre firmas filtra por cuánto tarda. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Devuelve `ArrayBuffer` y no `Uint8Array` a propósito: `importKey` pide un
// `BufferSource`, y un `Uint8Array` genérico no lo satisface en el TypeScript de
// Deno porque su `.buffer` podría ser un `SharedArrayBuffer`.
export function b64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return buf;
}

export function bytesToB64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

/** La firma que DEBERÍA traer un mensaje. Expuesta para poder probarla. */
export async function svixSign(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  rawBody: string,
): Promise<string> {
  // `whsec_` es un prefijo humano, no parte de la clave.
  const raw = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const key = await crypto.subtle.importKey(
    'raw',
    b64ToBytes(raw),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = `${svixId}.${svixTimestamp}.${rawBody}`;
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  return bytesToB64(mac);
}

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

/**
 * Verificación completa. NUNCA lanza: un secreto mal formado no debe poder
 * distinguirse de una firma incorrecta, ni por la respuesta ni por el tiempo.
 *
 * `nowSeconds` es inyectable para que las pruebas puedan comprobar el rechazo
 * por antigüedad sin esperar cinco minutos ni tocar el reloj del proceso.
 */
export async function verifySvix(
  secret: string,
  rawBody: string,
  headers: SvixHeaders,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;

  // ── Antirrepetición. Sin esto, un POST legítimo capturado sirve para siempre.
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowSeconds - ts) > SVIX_TOLERANCE_SECONDS) return false;

  try {
    const expected = await svixSign(secret, headers.id, headers.timestamp, rawBody);
    for (const part of headers.signature.split(' ')) {
      const [version, sig] = part.split(',');
      if (version !== 'v1' || !sig) continue;
      if (timingSafeEqual(sig, expected)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
