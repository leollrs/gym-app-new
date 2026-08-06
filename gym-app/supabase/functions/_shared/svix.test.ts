// Ejecutar:  deno test supabase/functions/_shared/svix.test.ts
//
// Esta firma es la ÚNICA autenticación de `resend-webhook`, que corre con
// verify_jwt = false y por tanto está abierto a internet. Aceptar de más aquí
// significa que cualquiera puede POSTear «rebote permanente» con la dirección de
// quien quiera y dejarlo sin correo para siempre, en silencio. Por eso las
// pruebas de rechazo importan más que la de aceptación.

import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { svixSign, verifySvix, timingSafeEqual } from './svix.ts';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const BODY = '{"type":"email.bounced","data":{"email_id":"re_123","to":["nadie@ejemplo.com"]}}';
const NOW = 1_700_000_000;
const TS = String(NOW);

const hdr = (sig: string, ts = TS, id = ID) => ({ id, timestamp: ts, signature: sig });

Deno.test('acepta una firma legítima', async () => {
  const sig = await svixSign(SECRET, ID, TS, BODY);
  assert(await verifySvix(SECRET, BODY, hdr(`v1,${sig}`), NOW));
});

// Durante una rotación de secreto, Svix manda las dos firmas separadas por un
// espacio. Sin recorrer la lista, cada rotación tira todos los rebotes.
Deno.test('acepta cuando la buena viene acompañada en la lista', async () => {
  const sig = await svixSign(SECRET, ID, TS, BODY);
  assert(await verifySvix(SECRET, BODY, hdr(`v1,firmadeotrosecreto v1,${sig}`), NOW));
});

// EL CASO QUE IMPORTA: el atacante cambia a quién se suprime.
Deno.test('rechaza si el cuerpo cambió aunque sea un byte', async () => {
  const sig = await svixSign(SECRET, ID, TS, BODY);
  const tampered = BODY.replace('nadie@ejemplo.com', 'victima@ejemplo.com');
  assertFalse(await verifySvix(SECRET, tampered, hdr(`v1,${sig}`), NOW));
});

Deno.test('rechaza una firma de otro secreto', async () => {
  const sig = await svixSign('whsec_bm90dGhlcmVhbHNlY3JldGF0YWxsMDAwMA==', ID, TS, BODY);
  assertFalse(await verifySvix(SECRET, BODY, hdr(`v1,${sig}`), NOW));
});

// El id entra en el contenido firmado, así que reusar una firma buena con otro
// id —para esquivar la idempotencia y contar el mismo rebote mil veces— falla.
Deno.test('rechaza una firma reutilizada con otro id de mensaje', async () => {
  const sig = await svixSign(SECRET, ID, TS, BODY);
  assertFalse(await verifySvix(SECRET, BODY, hdr(`v1,${sig}`, TS, 'msg_otro'), NOW));
});

Deno.test('rechaza un mensaje viejo (repetición)', async () => {
  const oldTs = String(NOW - 600);
  const sig = await svixSign(SECRET, ID, oldTs, BODY);
  // La firma es criptográficamente correcta; lo que lo tumba es la antigüedad.
  assert(await verifySvix(SECRET, BODY, hdr(`v1,${sig}`, oldTs), NOW - 600));
  assertFalse(await verifySvix(SECRET, BODY, hdr(`v1,${sig}`, oldTs), NOW));
});

// Un reloj adelantado en el emisor no debe abrir la puerta indefinidamente.
Deno.test('rechaza un mensaje del futuro', async () => {
  const future = String(NOW + 600);
  const sig = await svixSign(SECRET, ID, future, BODY);
  assertFalse(await verifySvix(SECRET, BODY, hdr(`v1,${sig}`, future), NOW));
});

Deno.test('rechaza cabeceras ausentes, vacías o basura', async () => {
  const sig = await svixSign(SECRET, ID, TS, BODY);
  assertFalse(await verifySvix(SECRET, BODY, { id: null, timestamp: TS, signature: `v1,${sig}` }, NOW));
  assertFalse(await verifySvix(SECRET, BODY, { id: ID, timestamp: null, signature: `v1,${sig}` }, NOW));
  assertFalse(await verifySvix(SECRET, BODY, { id: ID, timestamp: TS, signature: null }, NOW));
  assertFalse(await verifySvix(SECRET, BODY, hdr(`v1,${sig}`, 'no-es-un-numero'), NOW));
  assertFalse(await verifySvix(SECRET, BODY, hdr(''), NOW));
});

// Sin secreto configurado NO se acepta nada. Degradar a «paso todo» convertiría
// el endpoint en un botón público para silenciar el correo de cualquiera.
Deno.test('sin secreto no se acepta nada', async () => {
  const sig = await svixSign(SECRET, ID, TS, BODY);
  assertFalse(await verifySvix('', BODY, hdr(`v1,${sig}`), NOW));
});

// Un secreto no descodificable revienta `atob`. Debe caer a `false`, no propagar
// la excepción: un 500 le dice a Svix que reintente eternamente algo que nunca
// va a funcionar.
Deno.test('un secreto mal formado devuelve false en vez de lanzar', async () => {
  assertFalse(await verifySvix('whsec_no-es-base64-!!!', BODY, hdr('v1,x'), NOW));
});

// Solo se admite v1. Una versión futura no debe colarse por defecto.
Deno.test('ignora versiones de firma desconocidas', async () => {
  const sig = await svixSign(SECRET, ID, TS, BODY);
  assertFalse(await verifySvix(SECRET, BODY, hdr(`v2,${sig}`), NOW));
});

Deno.test('timingSafeEqual compara bien', () => {
  assert(timingSafeEqual('abc', 'abc'));
  assertFalse(timingSafeEqual('abc', 'abd'));
  assertFalse(timingSafeEqual('abc', 'abcd'));
  assertEquals(timingSafeEqual('', ''), true);
});
