/**
 * Los momentos automáticos a los que se puede atar una plantilla de correo.
 *
 * Vive aquí y no dentro de EmailTemplateEditor porque ahora hay DOS sitios que
 * asignan un momento — el editor de bloques y el guardado desde la galería de
 * diseños — y una lista duplicada acaba divergiendo en silencio: un momento que
 * una pantalla ofrece y la otra no, o peor, una clave que ningún generador
 * dispara y que por tanto nunca envía nada.
 *
 * CADA CLAVE DE AQUÍ TIENE QUE EXISTIR DEL LADO DEL SERVIDOR, Y NO ES RETÓRICA:
 * la plantilla se busca con `.eq('step_key', …)` a secas (send-automated-email),
 * así que una clave que ningún disparador emite no da error — devuelve
 * `no_template` con un 200, sin fila en automated_email_log y sin rastro en
 * ninguna parte. El momento se ve encendido en la pantalla y no sale un correo.
 * Así estuvieron muertos los tres `winback_*` hasta la 0701.
 *
 * De dónde sale cada familia:
 *   - `day_*`     → lifecycle_steps()  (definida en 0400, AMPLIADA en 0420:47
 *                   con day_5 y day_60 — mirar 0420, no 0400)
 *   - `winback_*` → winback_steps() (0402:77) emite day_7/30/60 DESNUDAS, y
 *                   fire_winback_email les antepone 'winback_' (0701). El
 *                   prefijo es obligatorio: sin él las tres chocan con las
 *                   homónimas del ciclo de vida y quien canceló recibe el correo
 *                   de bienvenida.
 *   - `classes`   → scheduled-reminders, que pasa 'classes' como scope y paso.
 *
 * El índice único (gym_id, step_key) WHERE auto_enabled (0687:40-42) garantiza
 * que solo UNA plantilla sirve cada momento con el envío encendido.
 */

/**
 * Lo que el servidor emite de verdad, transcrito de las migraciones. Existe
 * para que `emailAutoSteps.test.js` pueda comparar las dos listas: es la única
 * forma de que añadir un momento a la interfaz sin su emisor falle en una
 * prueba en vez de fallar en silencio delante de un cliente.
 */
export const SERVER_EMITTED_STEPS = {
  // lifecycle_steps() — 0420:47
  lifecycle: ['day_1', 'day_3', 'day_5', 'day_7', 'day_14', 'day_21', 'day_30', 'day_60'],
  // winback_steps() 0402:77, ya con el prefijo que pone fire_winback_email (0701)
  winback: ['winback_day_7', 'winback_day_30', 'winback_day_60'],
  // scheduled-reminders/index.ts:509
  classes: ['classes'],
};

export const AUTO_STEPS = [
  ...SERVER_EMITTED_STEPS.lifecycle,
  ...SERVER_EMITTED_STEPS.winback,
  ...SERVER_EMITTED_STEPS.classes,
];

/**
 * De qué familia es un momento. Decide qué variables tienen sentido: a alguien
 * que canceló no se le puede prometer "tu plan de hoy".
 */
export function scopeForStep(stepKey) {
  if (!stepKey) return null;
  if (stepKey === 'classes') return 'classes';
  if (stepKey.startsWith('winback_')) return 'winback';
  return 'lifecycle';
}

/** Etiqueta traducida de un momento, con la clave cruda como último recurso. */
export const stepLabel = (t, stepKey) =>
  t(`admin.emailTemplates.step.${stepKey}`, stepKey);
