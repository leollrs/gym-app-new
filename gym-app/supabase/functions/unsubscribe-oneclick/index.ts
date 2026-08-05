// =============================================================
// unsubscribe-oneclick — el POST de RFC 8058 que Gmail y Yahoo ejecutan
// =============================================================
//
// POR QUÉ EXISTE
//
// send-automated-email declaraba `List-Unsubscribe-Post: List-Unsubscribe=
// One-Click` apuntando a https://app.tugympr.com/u/<token>?scope=all. Esa ruta
// es React del lado del cliente y vercel.json reescribe /(.*) → /index.html, así
// que el POST de Gmail recibía el HTML del shell, no ejecutaba JS, y NO DABA DE
// BAJA A NADIE. Gmail le decía al miembro "listo, cancelado" y el correo seguía
// llegando — que es precisamente lo que convierte una baja en una queja de spam.
//
// Y como toda la plataforma manda desde el mismo noreply@tugympr.com, las quejas
// de un gimnasio degradan la entregabilidad de las invitaciones, los resets y
// los códigos de acceso de todos los demás.
//
// Declarar la cabecera y no honrarla es PEOR que no declararla. Este endpoint la
// honra.
//
// CONTRATO (RFC 8058)
//
//   POST <List-Unsubscribe URL>
//   Content-Type: application/x-www-form-urlencoded
//   List-Unsubscribe=One-Click
//
// El proveedor no manda cookies ni credenciales: el token de la URL ES la
// credencial. Es un gen_random_uuid() (122 bits, mig 0685), no enumerable.
//
// Requiere `verify_jwt = false` en config.toml — Gmail no trae JWT. Sin esa
// entrada, un `supabase functions deploy` lo vuelve a poner tras la puerta y el
// one-click se rompe en silencio otra vez.
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  // Gmail manda POST. Un GET aquí es una persona que pegó la URL en el
  // navegador: se le manda a la página de preferencias, que sí es para humanos.
  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';

  if (req.method === 'GET') {
    return new Response(null, {
      status: 302,
      headers: {
        Location: UUID_RE.test(token)
          ? `https://app.tugympr.com/u/${token}`
          : 'https://app.tugympr.com/',
        // La URL ES la credencial: que no acabe en un índice.
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // 200 incluso con un token inválido. Un proveedor que recibe un error de una
  // URL de List-Unsubscribe lo apunta contra la reputación del remitente, y un
  // token inexistente no es culpa del miembro que hizo clic. Se registra y ya.
  if (!UUID_RE.test(token)) {
    console.warn('unsubscribe-oneclick: malformed or missing token');
    return new Response(null, { status: 200, headers: { 'X-Robots-Tag': 'noindex, nofollow' } });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('unsubscribe-oneclick: missing env');
    return new Response(null, { status: 500 });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // p_on = false → baja. Ámbito 'all': el one-click es "no me mandes más",
    // no un ajuste fino. La página /u/:token sigue ahí para los tres ámbitos.
    const { data, error } = await supabase.rpc('unsubscribe_by_token', {
      p_token: token,
      p_scope: 'all',
      p_on: false,
    });

    if (error) {
      console.error('unsubscribe-oneclick: rpc failed:', error.message);
      // 500 sí: aquí el fallo es NUESTRO, y un reintento del proveedor puede
      // salvar la baja. Es lo contrario del token malformado de arriba.
      return new Response(null, { status: 500 });
    }

    if (data && data.success === false) {
      console.warn('unsubscribe-oneclick: rejected:', data.error);
    }

    return new Response(null, { status: 200, headers: { 'X-Robots-Tag': 'noindex, nofollow' } });
  } catch (err) {
    console.error('unsubscribe-oneclick error:', err);
    return new Response(null, { status: 500 });
  }
});
