/**
 * Adaptadores de fila para las pantallas de plantillas de correo.
 *
 * `dbRowToTemplate` / `templateToDbPayload` traducen entre la fila de
 * `gym_email_templates` y la forma que maneja el editor. Funciones puras, sin
 * React.
 *
 * AQUÍ NO SE RENDERIZA NADA. El renderizador que vivía en este archivo se borró
 * —ver la nota más abajo—: el único motor es `lib/admin/emailEngine.js`.
 */

// ── XSS helpers ───────────────────────────────────────────────

export function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function safeColor(c) {
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#000000';
}

/**
 * Caducidad legible. Acepta la fecha ISO que escribe el selector nuevo y, si
 * no lo es, devuelve el texto tal cual: las plantillas guardadas antes de que
 * el campo fuera un calendario tienen ahí frases sueltas ("Caduca el 31 de
 * diciembre") y perderlas al renderizar sería peor que no formatearlas.
 */
export function formatExpiry(value, lang = 'es') {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // Se parte a mano en vez de `new Date(raw)`: esa forma interpreta el ISO
  // corto como UTC y en Puerto Rico (UTC-4) retrocede un día.
  const [y, m, d] = raw.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return raw;
  try {
    return dt.toLocaleDateString(lang === 'en' ? 'en-US' : 'es', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch {
    return raw;
  }
}

// ── QR helpers ────────────────────────────────────────────────
// El QR salió de aquí. Se generaba como SVG en data-URI y NUNCA llegaba a
// verse: Gmail, Outlook y Yahoo bloquean SVG, y Gmail además tira toda imagen
// en `data:`. Lo que recibía el miembro era el texto alternativo dentro de un
// recuadro vacío. `rewardQrPayload` y `rewardQrSvg` se borraron con él —
// nadie más los usaba — y con ellos la dependencia de `qrcode` en este módulo.
// El bloque de recompensa manda ahora el código en texto y un botón a
// Recompensas de la app, donde el QR sí se ve y se escanea en recepción.

// ── Template-variable substitution ────────────────────────────
// Preview uses fake but plausible values so the admin can see how the
// merge looks. Production sends do their own substitution server-side.
export function replaceVariables(text, gymName) {
  if (!text) return '';
  return text
    .replace(/\{\{member_name\}\}/g, 'John Doe')
    .replace(/\{\{gym_name\}\}/g, gymName || 'Your Gym')
    .replace(/\{\{streak_count\}\}/g, '14')
    .replace(/\{\{workout_count\}\}/g, '47')
    .replace(/\{\{days_inactive\}\}/g, '7');
}

// ── Full HTML renderer ────────────────────────────────────────

/**
 * `generateEmailHtml` VIVIÓ AQUÍ Y SE BORRÓ. ~190 líneas.
 *
 * Era un SEGUNDO renderizador de correo, con maqueta propia, sin un solo
 * llamador en todo el repo — y su docblock seguía afirmando que lo usaba la
 * vista previa. Justo la situación que `emailEngineSync.test.js` existe para
 * impedir: dos renderizadores vivos que divergen mientras las dos suites siguen
 * en verde. El único motor es `lib/admin/emailEngine.js`, y su copia de Deno la
 * genera un script con un test que las compara byte a byte.
 *
 * Este archivo se queda con los dos adaptadores de fila, que sí se usan.
 */

export function dbRowToTemplate(row) {
  const d = row.template_data || {};
  return {
    id: row.id,
    name: row.name,
    type: row.template_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    is_prebuilt: row.is_prebuilt,
    header: d.header || { enabled: true, showLogo: true, text: '' },
    hero: d.hero || { enabled: false, imageUrl: '', headline: '', subtitle: '' },
    body: d.body || { text: '' },
    cta: d.cta || { enabled: false, text: '', url: '', color: '#D4AF37' },
    reward: d.reward || { enabled: false, reward_id: '', title: '', description: '', code: '', expiry: '' },
    footer: d.footer || { enabled: true, text: '', unsubscribeText: 'Unsubscribe' },
    colors: d.colors || { primary: '#D4AF37', background: '#ffffff', text: '#333333' },
    // Was never hydrated, so every saved template silently reverted to the
    // 15/12/40/gradient fallback the moment it was reloaded — the editor's
    // typography panel looked like it did nothing.
    typography: d.typography || { fontSize: '15', borderRadius: '12', padding: '40', headerStyle: 'gradient' },
    step_key: row.step_key ?? null,
    auto_enabled: row.auto_enabled ?? false,
    // La maqueta del motor v2. Vive dentro de template_data (JSONB), sin
    // columna nueva. Sin esta línea el paso 1 del editor era un no-op: se
    // escogía, la vista previa cambiaba, y al recargar volvía a 'editorial'.
    preset: d.preset || null,
    density: d.density || null,
    // Idioma de los campos de arriba, y la traducción del texto al otro. Una
    // plantilla vieja no trae ninguno de los dos: es español base sin traducir,
    // que es justo lo que es. Ver lib/admin/emailVariants.js.
    lang: d.lang === 'en' ? 'en' : 'es',
    i18n: d.i18n && typeof d.i18n === 'object' ? d.i18n : {},
    // Plantillas guardadas desde la galería de diseños. `designer_id` es la
    // marca: cuando está, la fila NO es de bloques y no debe abrirse en el
    // editor de bloques (no hay nada que editar ahí, y guardar desde él
    // pisaría el HTML con bloques vacíos).
    designer_id: d.designer_id || null,
    designer_html: d.designer_html || null,
    designer_lang: d.designer_lang || null,
    designer_subject: d.designer_subject || '',
    designer_preview: d.designer_preview || '',
  };
}

export function templateToDbPayload(tpl, gymId) {
  return {
    ...(tpl.id && !tpl.id.startsWith('prebuilt-') ? { id: tpl.id } : {}),
    gym_id: gymId,
    name: tpl.name,
    template_type: tpl.type,
    is_prebuilt: false,
    // Which automated moment this template serves, and whether it's live.
    // Both default to "manual only" (mig 0687) so nothing starts sending on its
    // own just because a template exists.
    step_key: tpl.step_key || null,
    auto_enabled: !!tpl.auto_enabled,
    template_data: {
      // `preset` y `density` PRIMERO para que se vean: son lo que decide la
      // maqueta, y estuvieron fuera de esta lista blanca desde el principio.
      ...(tpl.preset ? { preset: tpl.preset } : {}),
      ...(tpl.density ? { density: tpl.density } : {}),
      // El idioma base y la traducción. Van en esta lista blanca desde el
      // primer día a propósito: quedarse fuera de ella es exactamente lo que
      // hizo que `preset` y `typography` fueran de solo-edición durante meses.
      lang: tpl.lang === 'en' ? 'en' : 'es',
      ...(tpl.i18n && Object.keys(tpl.i18n).length ? { i18n: tpl.i18n } : {}),
      header: tpl.header,
      hero: tpl.hero,
      body: tpl.body,
      cta: tpl.cta,
      reward: tpl.reward,
      footer: tpl.footer,
      colors: tpl.colors,
      // El tamaño de letra y el radio de esquina que lee `templateToCfg`. No se
      // persistía, así que el panel de tipografía era de solo-edición.
      typography: tpl.typography,
      // Un diseño de la galería se guarda ya renderizado. Hay que devolverlo
      // tal cual al guardar de nuevo (cambiar nombre, momento o interruptor) o
      // la plantilla se convertiría en una de bloques vacía — y como los
      // bloques están todos deshabilitados, el correo saldría en blanco.
      ...(tpl.designer_id ? {
        designer_id: tpl.designer_id,
        designer_html: tpl.designer_html,
        designer_lang: tpl.designer_lang,
        designer_subject: tpl.designer_subject,
        designer_preview: tpl.designer_preview,
      } : {}),
    },
  };
}
