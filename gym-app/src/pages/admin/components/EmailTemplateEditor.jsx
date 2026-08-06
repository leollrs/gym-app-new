import { useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Image, Type, MousePointerClick, FileText, Loader2,
  Save, Send, Copy, ArrowLeft, Eye, Gift, Zap, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { supabase, ensureFreshSession, isSessionError, readFunctionError } from '../../../lib/supabase';
import logger from '../../../lib/logger';
import { rewardLabelText } from '../../../lib/rewardSymbols';
import { AdminCard, Toggle } from '../../../components/admin';
// `emailDoc`, no `generateEmailHtml`: la prueba que el admin se manda a sí
// mismo y el HTML que copia tienen que salir del MISMO motor que la vista
// previa y que el envío real. Eran tres renderizadores distintos desde una
// sola pantalla — y la prueba, que existe justo para dar confianza, no
// validaba ninguno de los otros dos.

import { normalizeHex } from '../../../lib/admin/emailThemes';
import { emailDoc, PRESETS, PRESET_IDS } from '../../../lib/admin/emailEngine';
import { templateToCfg } from '../../../lib/admin/emailCfg';
import { LANGS, baseLang, pathFor, pickVariant, seedVariantFromBase, variantProgress } from '../../../lib/admin/emailVariants';
import EmailPresetGallery from './EmailPresetGallery';
import { AUTO_STEPS } from '../../../lib/admin/emailAutoSteps';
import { appDeepLink, gymShareUrl } from '../../../lib/appUrls';
import { TEMPLATE_TYPES, variablesForStep } from './emailTemplatePrebuilts';

// Las secciones que tienen sentido como destino de un botón de correo. Es un
// subconjunto a propósito de APP_SECTIONS (appUrls.js:96): 'streak' y 'profile'
// apuntan a la misma pantalla, y 'log' o 'records' no son un sitio al que
// mandes a alguien desde un correo de retención.
const CTA_SECTIONS = ['home', 'workout', 'classes', 'checkin', 'rewards', 'challenges', 'progress', 'nutrition', 'social', 'leaderboard', 'messages'];
import { kindMeta, toneStyles } from './emailTemplateKinds';
import EmailLivePreview from './EmailLivePreview';
import EmailImagePicker from './EmailImagePicker';

const DISPLAY_FONT = 'var(--admin-font-display, "Archivo", system-ui, sans-serif)';
const inputClass = 'w-full rounded-[10px] px-3 py-2.5 text-[13.5px] outline-none transition-colors bg-[var(--color-bg-deep)] border border-[var(--color-admin-border)] text-[var(--color-admin-text)] placeholder:text-[var(--color-admin-text-faint)] focus:border-[var(--color-accent)]';

// Inline UI helpers — only used inside this editor.
function VariablePill({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[7px] text-[11px] font-semibold transition-colors"
      style={{
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        color: 'var(--color-accent)',
        background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
      }}
    >
      <span>{label}</span>
    </button>
  );
}

function SectionBlock({ title, icon: Icon, enabled, onToggle, children, toggleAriaLabel }) {
  const open = onToggle ? enabled : true;
  return (
    <AdminCard padding="p-0">
      <div
        className="flex items-center gap-3 px-4 py-3.5"
        style={{ background: 'var(--color-bg-deep)', borderBottom: open ? '1px solid var(--color-border-subtle)' : 'none' }}
      >
        <div
          className="grid place-items-center flex-shrink-0"
          style={{ width: 30, height: 30, borderRadius: 9, background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}
        >
          <Icon size={15} strokeWidth={2} style={{ color: 'var(--color-accent)' }} />
        </div>
        <span className="flex-1" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: 14, color: 'var(--color-admin-text)', letterSpacing: '-0.2px' }}>{title}</span>
        {onToggle && <Toggle value={enabled} onChange={onToggle} label={toggleAriaLabel || title} />}
      </div>
      {open && <div className="p-[18px] space-y-3">{children}</div>}
    </AdminCard>
  );
}

/** Cabecera de un paso numerado. La IA "Guiado": tres decisiones, en orden. */
function StepHead({ n, title, sub }) {
  return (
    <div className="mb-3.5 flex items-center gap-2.5">
      <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full text-[12px] font-extrabold"
        style={{ background: 'var(--color-admin-text)', color: 'var(--color-bg-card)', fontFamily: DISPLAY_FONT }}>{n}</span>
      <div className="min-w-0">
        <div className="text-[14px] font-extrabold" style={{ fontFamily: DISPLAY_FONT, color: 'var(--color-admin-text)', letterSpacing: '-0.35px' }}>{title}</div>
        {sub && <div className="text-[11.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>{sub}</div>}
      </div>
    </div>
  );
}

/**
 * Los tres extras opcionales, como chips en fila.
 *
 * Antes cada uno era una tarjeta plegable con su interruptor dentro, lo que
 * hacia que la pagina fuera una lista larga de secciones donde el paso
 * importante y el opcional pesaban igual. Como chips se ve de un vistazo que
 * son opcionales y cuales estan puestos.
 */
// Recibe el icono YA RENDERIZADO: pasarlo como componente dispara un falso
// `no-unused-vars` — eslint no cuenta un nombre usado solo como etiqueta JSX.
function ExtraChip({ icon, label, on, onClick }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors"
      style={{
        background: on ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'var(--color-admin-panel)',
        // 2px cuando está puesto: el estado no puede distinguirse SOLO por
        // color (WCAG 1.4.1). El Toggle al que sustituye además movía la
        // perilla, así que había una señal de forma que aquí se había perdido.
        border: `${on ? 2 : 1}px solid ${on ? 'var(--color-accent)' : 'var(--color-admin-border)'}`,
        paddingBlock: on ? 9 : 10,
      }}
    >
      <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-lg"
        style={{
          background: on ? 'color-mix(in srgb, var(--color-accent) 18%, transparent)' : 'var(--color-bg-deep)',
          // `color` aqui y no en el icono: el icono llega ya renderizado con
          // `currentColor`, asi que hereda de este contenedor.
          color: on ? 'var(--color-accent)' : 'var(--color-admin-text-muted)',
        }}>
        {icon}
      </span>
      <span className="truncate text-[12.5px] font-bold" style={{ color: on ? 'var(--color-accent)' : 'var(--color-admin-text-sub)' }}>{label}</span>
    </button>
  );
}

// AUTO_STEPS vive en lib/admin/emailAutoSteps.js: ahora hay dos pantallas que
// asignan un momento (esta y el guardado desde la galería de diseños) y dos
// copias de la lista acaban divergiendo.

/**
 * El color de marca del gimnasio — lo único que un tema inyecta. Sale del CSS
 * var que branding.js pinta al arrancar; si no está, o no es un hex usable, se
 * cae al dorado por defecto. Nunca devuelve `var(--…)`: ese valor terminaría
 * escrito en la BD como si fuera un color, que es lo que ya rompió el asistente
 * de alta una vez.
 */
function readAccentHex() {
  if (typeof document === 'undefined') return '#D4AF37';
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
  return normalizeHex(raw, '#D4AF37');
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>{label}</label>
      {children}
    </div>
  );
}

/**
 * Edit-an-email-template view. Two columns on desktop (form on the left,
 * `EmailLivePreview` on the right); single column with a slide-in preview
 * drawer below `lg`. Owns local template state, the test-email flow, and
 * HTML clipboard export. Persistence is delegated to the parent via `onSave`.
 */
export default function EmailTemplateEditor({ initial, onSave, onCancel, gymName, gymLogoUrl, saving }) {
  const { t, i18n } = useTranslation('pages');
  const { showToast } = useToast();
  const { user, profile } = useAuth();
  const gymId = profile?.gym_id;
  const isEs = i18n.language?.startsWith('es');

  // Web propia del gimnasio (0653 añadió gyms.website_url); si no la tienen,
  // su página pública /g/:slug, que siempre existe.
  const { data: gymLinks } = useQuery({
    queryKey: ['gym-cta-links', gymId],
    queryFn: async () => {
      const { data } = await supabase.from('gyms').select('slug, website_url').eq('id', gymId).maybeSingle();
      return data || null;
    },
    enabled: !!gymId,
    staleTime: 5 * 60 * 1000,
  });
  const gymWebsite = gymLinks?.website_url || '';
  const gymLanding = gymLinks?.slug ? gymShareUrl(gymLinks.slug) : '';

  // The gym's own rewards catalog — what the admin already configured under
  // /admin/rewards. We surface these as a picker inside the Reward section so
  // the email can attach to a real listed reward instead of free-form copy.
  const { data: gymRewards = [] } = useQuery({
    queryKey: ['gym-rewards-active', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_rewards')
        .select('id, name, name_es, description, description_es, emoji_icon, cost_points, is_active')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('sort_order');
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 5 * 60_000,
  });
  const [template, setTemplate] = useState(initial);
  const bodyRef = useRef(null);

  // OJO CON EL ORDEN: esto va DESPUÉS de `template`, no antes.
  //
  // Estaba arriba del todo, veintiséis líneas por encima de su propia
  // declaración, y `const` no se iza como `var`: leer `template` ahí dentro cae
  // en la zona muerta temporal y revienta con "Cannot access 'template' before
  // initialization" NADA MÁS montar. O sea que el editor de plantillas entero
  // no abría — cada "Editar" caía en el ErrorBoundary.
  //
  // No lo cazó nada de lo estático: `no-undef` no se queja porque `template` SÍ
  // existe en el ámbito (solo que más abajo), y el build compila igual. Solo
  // aparece pulsando el botón.
  //
  // El modo se DERIVA de la URL guardada, no se guarda aparte: así una
  // plantilla vieja con un enlace pegado a mano abre en "Personalizado" sin
  // migración ni columna nueva.
  const ctaUrl = template?.cta?.url || '';
  const appMatch = ctaUrl.match(/\/invite\/go\/([a-z]+)$/i);
  const ctaSection = appMatch ? appMatch[1] : '';
  const ctaMode = appMatch ? 'app'
    : (ctaUrl && (ctaUrl === gymWebsite || ctaUrl === gymLanding)) ? 'gym'
    : 'custom';

  const [testEmail, setTestEmail] = useState(user?.email || '');
  const [sendingTest, setSendingTest] = useState(false);
  // Mobile preview drawer — desktop has the side panel; below `lg` we surface
  // a fullscreen preview behind a button so admins can actually see what they're editing.
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  // Las perillas crudas de estilo, plegadas por defecto. Arrancan ABIERTAS si
  // la plantilla ya viene fuera de todos los temas: a quien la retocó a mano no
  // se le pueden esconder los controles que explican por qué se ve así. El
  // inicializador es perezoso a propósito — solo se evalúa al montar, así que
  // aplicar un tema después no vuelve a plegar el panel bajo los dedos.
  const [showAdvancedStyle, setShowAdvancedStyle] = useState(false);

  // ── Idioma que se está editando ──────────────────────────────────────
  //
  // Una plantilla, dos idiomas. Los campos de siempre son el idioma BASE; el
  // otro vive en `i18n[lang]` y solo guarda TEXTO — maqueta, colores, enlaces e
  // interruptores son compartidos. Ver lib/admin/emailVariants.js.
  const [editLang, setEditLang] = useState(() => baseLang(initial));

  // Lo que se LEE en pantalla. Idéntico a `template` salvo en los campos de
  // texto, que vienen del idioma en edición. `template` sigue siendo la verdad
  // que se guarda.
  const view = useMemo(() => pickVariant(template, editLang), [template, editLang]);
  const tradProgress = useMemo(() => variantProgress(template, editLang), [template, editLang]);

  // Por `editLang`, no por el idioma de la INTERFAZ. Con `isEs` un admin que
  // tuviera la app en inglés metía copy inglés dentro de la versión española.
  const rewardName = (r) => (editLang === 'es' ? (r.name_es || r.name) : r.name);
  const rewardDesc = (r) => (editLang === 'es' ? (r.description_es || r.description) : r.description);

  // Dotted-path setter. Auto-creates missing intermediates — older templates
  // (rows from before `reward` was part of the schema) don't have every nested
  // object seeded, and writing `set('reward.enabled', true)` was crashing in
  // Safari with "undefined is not an object (evaluating 'obj[parts[…]] = …')".
  //
  // Y desvía la escritura al idioma en edición: `pathFor` devuelve
  // `i18n.en.hero.headline` en vez de `hero.headline` cuando toca. Solo para los
  // campos de texto — todo lo demás va siempre al base, para que no puedan
  // existir dos maquetas ni dos enlaces por plantilla.
  const set = useCallback((rawPath, value) => {
    setTemplate(prev => {
      const path = pathFor(prev, editLang, rawPath);
      const parts = path.split('.');
      const copy = JSON.parse(JSON.stringify(prev));
      let obj = copy;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (obj[key] == null || typeof obj[key] !== 'object') obj[key] = {};
        obj = obj[key];
      }
      obj[parts[parts.length - 1]] = value;
      copy.updatedAt = new Date().toISOString();
      return copy;
    });
  }, [editLang]);

  // ── Temas ────────────────────────────────────────────────────────────
  const accentHex = useMemo(() => readAccentHex(), []);

  // ── Motor v2 ────────────────────────────────────────────────────────
  // La plantilla guardada se traduce a la forma que el motor entiende. Se hace
  // aquí y no al guardar para que las plantillas que YA existen se rendericen
  // con la maqueta nueva sin migrar nada.
  //
  // Se le pasa `view`, no `template`: la previa —y la prueba que se envía— son
  // del idioma que se está editando. Y `lang` es ese idioma y no el de la
  // interfaz del admin: las frases que pone el motor (etiqueta del botón, aviso
  // de "abre la app si la tienes", baja) tienen que ir en el idioma en el que le
  // va a llegar al miembro, no en el que tenga puesto quien lo escribe.
  const engineCfg = useMemo(() => templateToCfg(view, {
    lang: editLang,
    gymName,
    gymLogoUrl,
    accent: accentHex,
    gymUrl: gymWebsite || gymLanding,
    // El marcador a rayas de la portada existe SOLO en el editor: sirve para
    // ver la composición antes de subir la foto. Nunca sale a un buzón.
    allowPlaceholder: true,
    // Código de muestra con su QR, solo para ver el bloque completo. El real
    // lo genera el enviador, uno por miembro.
    sampleCode: true,
  }), [view, editLang, gymName, gymLogoUrl, accentHex, gymWebsite, gymLanding]);

  const setPreset = useCallback((preset) => {
    setTemplate(prev => ({ ...prev, preset, updatedAt: new Date().toISOString() }));
  }, []);


  const insertVariable = useCallback((token) => {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = view.body.text;
    const newText = text.substring(0, start) + token + text.substring(end);
    set('body.text', newText);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  }, [view.body.text, set]);

  const handleSave = () => {
    if (!template.name.trim()) {
      showToast(t('admin.emailTemplates.nameRequired'), 'error');
      return;
    }
    onSave(template);
  };

  const handleExportHtml = async () => {
    const html = emailDoc(engineCfg);
    try {
      await navigator.clipboard.writeText(html);
      showToast(t('admin.emailTemplates.htmlCopied'), 'success');
    } catch {
      showToast(t('admin.emailTemplates.htmlCopyFailed'), 'error');
    }
  };

  const handleSendTest = async () => {
    if (!testEmail.trim()) {
      showToast(t('admin.emailTemplates.enterEmail'), 'error');
      return;
    }
    setSendingTest(true);
    try {
      const html = emailDoc(engineCfg);
      // Attach a freshly-refreshed token (the fn's gateway is verify_jwt=on, so a
      // stale/missing session is bounced before the function runs).
      const session = await ensureFreshSession();
      const { error } = await supabase.functions.invoke('send-admin-email', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {
          testMode: true,
          to: testEmail.trim(),
          subject: `[Test] ${template.name || 'Email Template'}`,
          html,
        },
      });
      if (error) throw error;
      showToast(t('admin.emailTemplates.testSent'), 'success');
    } catch (err) {
      logger.error('send test template email failed', err);
      const fnMsg = await readFunctionError(err);
      showToast(
        isSessionError(err)
          ? t('platformLayout.sessionExpiredMsg', 'Your session expired — please sign in again.')
          : fnMsg
            ? t('admin.emailTemplates.sendTestFailedReason', { reason: fnMsg, defaultValue: 'Test send failed: {{reason}}' })
            : t('admin.emailTemplates.testFailed'),
        'error',
      );
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-0 h-full min-h-[calc(100vh-120px)]">
      {/* Left: Editor */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto w-full max-w-[780px] space-y-4">
        {/* Top bar */}
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={onCancel}
            className="p-2 rounded-lg transition-colors hover:bg-[var(--color-bg-hover)]"
            style={{ color: 'var(--color-admin-text-sub)' }}
            aria-label={t('admin.emailTemplates.back')}
          >
            <ArrowLeft size={18} />
          </button>
          <h2 className="flex-1" style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 18, color: 'var(--color-admin-text)', letterSpacing: '-0.3px' }}>
            {initial.name ? t('admin.emailTemplates.editTemplate') : t('admin.emailTemplates.newTemplate')}
          </h2>
          {/* Mobile-only preview trigger — desktop has the side panel. */}
          <button
            onClick={() => setMobilePreviewOpen(true)}
            className="lg:hidden flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold min-h-[44px]"
            style={{ color: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}
          >
            <Eye size={14} /> {t('admin.emailTemplates.preview', 'Preview')}
          </button>
        </div>

        {/* ══ Idioma ═══════════════════════════════════════════════════════
            Una plantilla, dos idiomas. Va ARRIBA DEL TODO y fuera de los tres
            pasos a propósito: no es un paso más, es el modo en el que estás
            escribiendo — afecta a todo lo que se teclee debajo. */}
        <AdminCard>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-admin-text-faint)' }}>
              {t('admin.emailTemplates.writingIn', 'Escribiendo en')}
            </span>
            {LANGS.map((lg) => {
              const on = editLang === lg;
              const isBase = lg === baseLang(template);
              const prog = variantProgress(template, lg);
              return (
                <button
                  key={lg}
                  type="button"
                  onClick={() => setEditLang(lg)}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold min-h-[36px]"
                  style={{
                    color: on ? 'var(--color-accent)' : 'var(--color-admin-text-sub)',
                    background: on ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent',
                    border: `${on ? 2 : 1}px solid ${on ? 'var(--color-accent)' : 'var(--color-admin-border)'}`,
                  }}
                >
                  {lg === 'es' ? 'Español' : 'English'}
                  {isBase
                    ? <span className="ml-1.5 opacity-60">· {t('admin.emailTemplates.langBase', 'base')}</span>
                    : prog.total > 0 && !prog.done
                      ? <span className="ml-1.5 opacity-60">· {prog.filled}/{prog.total}</span>
                      : null}
                </button>
              );
            })}
            {/* Traducir sobre un formulario en blanco es lo que hace que nadie
                traduzca. Esto copia el texto base para editar encima, y NUNCA
                pisa lo que ya esté traducido. */}
            {editLang !== baseLang(template) && tradProgress.filled < tradProgress.total && (
              <button
                type="button"
                onClick={() => setTemplate(prev => ({ ...seedVariantFromBase(prev, editLang), updatedAt: new Date().toISOString() }))}
                className="px-3 py-1.5 rounded-lg text-[12px] font-semibold min-h-[36px]"
                style={{ color: 'var(--color-admin-text-sub)', border: '1px dashed var(--color-admin-border)' }}
              >
                {t('admin.emailTemplates.copyFromBase', 'Copiar el texto base')}
              </button>
            )}
          </div>
          <p className="mt-2 text-[11.5px] leading-snug" style={{ color: 'var(--color-admin-text-faint)' }}>
            {editLang === baseLang(template)
              ? t('admin.emailTemplates.langBaseHelp', 'Solo cambia el texto. La maqueta, los colores, los enlaces y la recompensa son los mismos en los dos idiomas. A cada miembro le llega el suyo; si falta, le llega este.')
              : t('admin.emailTemplates.langAltHelp', 'Solo cambia el texto. Un campo que dejes vacío sale en el idioma base, no en blanco.')}
          </p>
        </AdminCard>

        {/* Name & Type */}
        <AdminCard>
          <div className="space-y-3">
            <Field label={t('admin.emailTemplates.templateName')}>
              <input
                value={template.name}
                onChange={e => set('name', e.target.value)}
                placeholder={t('admin.emailTemplates.templateNamePlaceholder')}
                className={inputClass}
              />
            </Field>
            <Field label={t('admin.emailTemplates.templateType')}>
              <div className="flex flex-wrap gap-2">
                {TEMPLATE_TYPES.map(({ key }) => {
                  const { Icon, tone } = kindMeta(key);
                  const c = toneStyles(tone);
                  const on = template.type === key;
                  return (
                    <button
                      key={key}
                      onClick={() => set('type', key)}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[12.5px] font-bold transition-colors"
                      style={{
                        color: on ? c.ink : 'var(--color-admin-text-sub)',
                        background: on ? c.bg : 'var(--color-admin-panel)',
                        border: `1px solid ${on ? 'transparent' : 'var(--color-admin-border)'}`,
                      }}
                    >
                      <Icon size={14} strokeWidth={2} style={{ color: on ? c.fg : 'var(--color-admin-text-muted)' }} />
                      {t(`admin.emailTemplates.types.${key}`)}
                    </button>
                  );
                })}
              </div>
            </Field>

            {/* Automation (mig 0687). Two separate decisions on purpose:
                choosing a moment does NOT start sending. Nothing goes out until
                the switch is on, so a gym can prepare copy without waking up
                emailing its members. */}
            <Field label={t('admin.emailTemplates.automation', 'Automatic sending')}>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={template.step_key || ''}
                  onChange={e => set('step_key', e.target.value || null)}
                  className="rounded-xl px-3 py-2 text-[13px] outline-none"
                  style={{
                    background: 'var(--color-bg-input, var(--color-bg-elevated))',
                    border: '1px solid var(--color-border-subtle)',
                    color: 'var(--color-text-primary)',
                    minWidth: 210,
                  }}
                >
                  <option value="">{t('admin.emailTemplates.stepNone', 'Manual only')}</option>
                  {AUTO_STEPS.map(s => (
                    <option key={s} value={s}>{t(`admin.emailTemplates.step.${s}`, s)}</option>
                  ))}
                </select>

                <button
                  type="button"
                  role="switch"
                  aria-checked={!!template.auto_enabled}
                  disabled={!template.step_key}
                  onClick={() => set('auto_enabled', !template.auto_enabled)}
                  className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-[12.5px] font-bold transition-colors disabled:opacity-40"
                  style={{
                    background: template.auto_enabled ? 'var(--color-success-soft)' : 'var(--color-admin-panel)',
                    color: template.auto_enabled ? 'var(--color-success-ink)' : 'var(--color-admin-text-sub)',
                    border: `1px solid ${template.auto_enabled ? 'transparent' : 'var(--color-admin-border)'}`,
                  }}
                >
                  <Zap size={13} />
                  {template.auto_enabled
                    ? t('admin.emailTemplates.autoOn', 'Sending automatically')
                    : t('admin.emailTemplates.autoOff', 'Not sending')}
                </button>
              </div>
              <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--color-admin-text-faint)' }}>
                {t('admin.emailTemplates.automationHint', 'Members only get this if they haven\'t opted out of that kind of email. Every automatic message carries an unsubscribe link.')}
              </p>
            </Field>
          </div>
        </AdminCard>

        {/* ══ PASO 1 · La maqueta ══════════════════════════════════
            Cada miniatura es el correo real renderizado por el motor y
            escalado, no un dibujo. El selector anterior ensenaba rayas grises
            sobre una maqueta que no cambiaba nunca. */}
        <AdminCard>
          <StepHead n="1"
            title={t('admin.emailTemplates.step1Title', 'Pick a style')}
            sub={t('admin.emailTemplates.step1Sub', 'Changes the whole layout — type, header, button and spacing.')}/>
          <EmailPresetGallery cfg={engineCfg} value={engineCfg.preset} onChange={setPreset} lang={isEs ? 'es' : 'en'} />
        </AdminCard>

        {/* ══ PASO 2 · El mensaje ══════════════════════════════════
            Titular, bajada, cuerpo y boton en una sola tarjeta. Estaban
            repartidos en cuatro secciones plegables distintas, asi que
            escribir un correo era abrir y cerrar cajas. */}
        <AdminCard>
          <StepHead n="2"
            title={t('admin.emailTemplates.step2Title', 'Write the message')}
            sub={t('admin.emailTemplates.step2Sub', 'The layout takes care of the rest.')}/>
          <div className="space-y-3">
          <Field label={t('admin.emailTemplates.heroHeadline')}>
            <input
              value={view.hero.headline}
              onChange={e => set('hero.headline', e.target.value)}
              placeholder={t('admin.emailTemplates.heroHeadlinePlaceholder')}
              className={inputClass}
            />
          </Field>
          <Field label={t('admin.emailTemplates.heroSubtitle')}>
            <input
              value={view.hero.subtitle}
              onChange={e => set('hero.subtitle', e.target.value)}
              placeholder={t('admin.emailTemplates.heroSubtitlePlaceholder')}
              className={inputClass}
            />
          </Field>

          <div className="flex flex-wrap gap-1.5 mb-2">
            <span className="text-[10px] font-semibold text-[var(--color-admin-text-muted)] uppercase tracking-wider mr-1 self-center">
              {t('admin.emailTemplates.insertVariable')}
            </span>
            {/* Filtrado por el momento asignado: los tokens ricos
                (plan de hoy, próxima clase, enlaces a la app) solo los rellena
                el envío automático, y solo algunos tienen sentido en cada
                flujo. Ofrecerlos en una plantilla manual garantizaba que
                llegara el {{token}} literal al buzón. */}
            {variablesForStep(template.step_key).map(v => (
              <VariablePill
                key={v.key}
                label={t(`admin.emailTemplates.variables.${v.key}`)}
                onClick={() => insertVariable(v.token)}
              />
            ))}
          </div>
          <textarea
            ref={bodyRef}
            value={view.body.text}
            onChange={e => set('body.text', e.target.value)}
            rows={10}
            placeholder={t('admin.emailTemplates.bodyPlaceholder')}
            className={`${inputClass} resize-y min-h-[160px]`}
          />
          <p className="text-[10px] text-[var(--color-admin-text-muted)]">{t('admin.emailTemplates.bodyHint')}</p>

            <div className="pt-1" style={{ borderTop: '1px solid var(--color-admin-border)' }} />
          <Field label={t('admin.emailTemplates.ctaText')}>
            <input
              value={view.cta.text}
              onChange={e => set('cta.text', e.target.value)}
              placeholder={t('admin.emailTemplates.ctaTextPlaceholder')}
              className={inputClass}
            />
          </Field>
          {/* Destino, no una caja de URL en blanco.
              Pegar un enlace a mano tenía dos problemas: nadie sabe qué URL
              poner, y la que se pegaba solía ser una del navegador que NO abre
              la app. `appDeepLink()` (appUrls.js:144) ya resuelve las dos
              cosas: con la app instalada el enlace universal la abre en la
              sección; sin ella, cae en la web y desde ahí se le puede ofrecer
              la descarga. Eso es lo que debía estar preseleccionado. */}
          <Field label={t('admin.emailTemplates.ctaDestination', 'Button destination')}>
            <select
              value={ctaMode}
              onChange={(e) => {
                const mode = e.target.value;
                if (mode === 'app') set('cta.url', appDeepLink(ctaSection || 'home'));
                else if (mode === 'gym') set('cta.url', gymWebsite || gymLanding);
                else set('cta.url', '');
              }}
              className={inputClass}
            >
              <option value="app">{t('admin.emailTemplates.ctaDestApp', 'Open the app')}</option>
              <option value="gym">{t('admin.emailTemplates.ctaDestGym', "Gym's website")}</option>
              <option value="custom">{t('admin.emailTemplates.ctaDestCustom', 'Custom link')}</option>
            </select>
          </Field>

          {/* ctaAppSection, no ctaSection: esa clave ya era el TÍTULO de esta
              sección ("Llamada a la Acción") y reutilizarla la pisaba. */}
          {ctaMode === 'app' && (
            <Field label={t('admin.emailTemplates.ctaAppSection', 'Where in the app')}>
              <select
                value={ctaSection || 'home'}
                onChange={(e) => set('cta.url', appDeepLink(e.target.value))}
                className={inputClass}
              >
                {CTA_SECTIONS.map(s => (
                  <option key={s} value={s}>
                    {t(`admin.emailTemplates.appSection.${s}`, { defaultValue: s })}
                  </option>
                ))}
              </select>
              <p className="text-[10.5px] mt-1.5" style={{ color: 'var(--color-admin-text-faint)' }}>
                {t('admin.emailTemplates.ctaAppHint', 'Opens the app if they have it — otherwise the web version, which offers the download.')}
              </p>
            </Field>
          )}

          {ctaMode === 'custom' && (
            <Field label={t('admin.emailTemplates.ctaUrl')}>
              <input
                value={template.cta.url}
                onChange={e => set('cta.url', e.target.value)}
                placeholder={t('admin.emailTemplates.urlPlaceholder', 'https://...')}
                className={inputClass}
              />
            </Field>
          )}

          {ctaMode === 'gym' && !gymWebsite && (
            <p className="text-[10.5px] -mt-1" style={{ color: 'var(--color-admin-text-faint)' }}>
              {t('admin.emailTemplates.ctaGymFallback', 'No website saved for this gym — using its public page instead.')}
            </p>
          )}

          {template.cta.enabled && !template.cta.url && (
            <p className="text-[10.5px] -mt-1" style={{ color: 'var(--color-warning, #F59E0B)' }}>
              {t('admin.emailTemplates.ctaUrlMissing', 'Button has no link — recipients clicking it will go nowhere.')}
            </p>
          )}
          <Field label={t('admin.emailTemplates.ctaColor')}>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={template.cta.color}
                onChange={e => set('cta.color', e.target.value)}
                className="w-8 h-8 rounded-lg border border-[var(--color-admin-border)] cursor-pointer bg-transparent"
              />
              <input
                value={template.cta.color}
                onChange={e => set('cta.color', e.target.value)}
                className={`${inputClass} flex-1`}
              />
            </div>
          </Field>
          </div>
        </AdminCard>

        {/* ══ PASO 3 · La marca ════════════════════════════════════
            El color y el logo NO se editan aqui: salen de Ajustes → Marca y
            valen para todas las plantillas. Repetirlos por plantilla es como
            se acaba con seis correos de seis colores distintos. */}
        <AdminCard>
          <StepHead n="3"
            title={t('admin.emailTemplates.step3Title', 'Your brand')}
            sub={t('admin.emailTemplates.step3Sub', 'Applies to every template — you only set it once.')}/>
          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: 'var(--color-admin-panel)' }}>
            <span className="h-7 w-7 flex-shrink-0 rounded-lg" style={{ background: accentHex, border: '1px solid var(--color-admin-border)' }} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-bold" style={{ color: 'var(--color-admin-text)' }}>{gymName}</div>
              <div className="text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                {t('admin.emailTemplates.brandFromSettings', 'Colour and logo come from your gym settings.')}
              </div>
            </div>
          </div>
          {/* Los dos interruptores de la cabecera. `header.enabled` perdió el
              suyo al reestructurar y quedó solo legible: una plantilla guardada
              con la cabecera apagada —como las que salen de la galería de
              diseños— no se podía volver a encender desde ningún sitio. */}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[12px]" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.emailTemplates.headerSection')}</span>
            <Toggle value={template.header.enabled} onChange={v => set('header.enabled', v)} label={t('admin.emailTemplates.headerSection')} />
          </div>
          {template.header.enabled && (
            <div className="mt-2.5 flex items-center justify-between">
              <span className="text-[12px]" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.emailTemplates.showLogo')}</span>
              <Toggle value={template.header.showLogo} onChange={v => set('header.showLogo', v)} label={t('admin.emailTemplates.showLogo')} />
            </div>
          )}
        </AdminCard>

        {/* ══ Extras opcionales ════════════════════════════════════ */}
        <div className="flex flex-wrap gap-2">
          <ExtraChip icon={<Image size={13} strokeWidth={2.2} style={{ color: 'currentColor' }} />} label={t('admin.emailTemplates.extraPhoto', 'Cover photo')}
            on={!!template.hero.enabled} onClick={() => set('hero.enabled', !template.hero.enabled)} />
          <ExtraChip icon={<Gift size={13} strokeWidth={2.2} style={{ color: 'currentColor' }} />} label={t('admin.emailTemplates.extraReward', 'Reward')}
            on={!!template.reward?.enabled} onClick={() => set('reward.enabled', !template.reward?.enabled)} />
          <ExtraChip icon={<MousePointerClick size={13} strokeWidth={2.2} style={{ color: 'currentColor' }} />} label={t('admin.emailTemplates.extraCta', 'Button')}
            on={!!template.cta.enabled} onClick={() => set('cta.enabled', !template.cta.enabled)} />
          <ExtraChip icon={<FileText size={13} strokeWidth={2.2} style={{ color: 'currentColor' }} />} label={t('admin.emailTemplates.extraFooter', 'Footer')}
            on={!!template.footer.enabled} onClick={() => set('footer.enabled', !template.footer.enabled)} />
        </div>

        {template.hero.enabled && (
          <SectionBlock title={t('admin.emailTemplates.extraPhoto', 'Cover photo')} icon={Image} enabled>
          {/* Subir, no pegar una URL. Ver EmailImagePicker para el porqué. */}
          <Field label={t('admin.emailTemplates.heroImage', 'Image')}>
            <EmailImagePicker
              value={template.hero.imageUrl}
              onChange={(url) => set('hero.imageUrl', url)}
              gymId={gymId}
              t={t}
            />
          </Field>
          </SectionBlock>
        )}

        {template.reward?.enabled && (
          <SectionBlock title={t('admin.emailTemplates.rewardSection', 'Reward / Offer')} icon={Gift} enabled>
          {/* Catalog picker — pulls from the gym's configured rewards
              (/admin/rewards). Picking one prefills title + description; the
              fields below stay editable so admins can tweak the copy. */}
          <Field label={t('admin.emailTemplates.chooseFromCatalog', 'Choose from your rewards')}>
            <select
              value={template.reward?.reward_id || ''}
              onChange={e => {
                const id = e.target.value;
                const picked = gymRewards.find(r => r.id === id);
                // `set()`, NO `setTemplate` directo.
                //
                // Era el único sitio del editor que escribía a pelo, y por eso
                // se saltaba `pathFor`: editando en inglés, el título y la
                // descripción se escribían en el ESPAÑOL base. El campo visible
                // no cambiaba (parecía roto) y de paso te pisaba la otra versión
                // sin decir nada.
                set('reward.reward_id', id || '');
                if (picked) {
                  set('reward.title', rewardLabelText(picked.emoji_icon, rewardName(picked)));
                  set('reward.description', rewardDesc(picked) || view.reward?.description || '');
                }
              }}
              className={inputClass}
            >
              <option value="">
                {gymRewards.length === 0
                  ? t('admin.emailTemplates.catalogEmpty', 'No rewards configured — set them up in Rewards')
                  : t('admin.emailTemplates.customReward', '— Custom (enter manually) —')}
              </option>
              {gymRewards.map(r => (
                <option key={r.id} value={r.id}>
                  {rewardLabelText(r.emoji_icon, rewardName(r))}
                  {r.cost_points ? ` · ${r.cost_points} ${t('admin.emailTemplates.pointsShort', 'pts')}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('admin.emailTemplates.rewardTitle', 'Reward Title')}>
            <input
              value={view.reward?.title || ''}
              onChange={e => set('reward.title', e.target.value)}
              placeholder={t('admin.emailTemplates.rewardTitlePlaceholder', 'e.g. Free PT Session, 50% Off')}
              className={inputClass}
            />
          </Field>
          <Field label={t('admin.emailTemplates.rewardDescription', 'Description')}>
            <input
              value={view.reward?.description || ''}
              onChange={e => set('reward.description', e.target.value)}
              placeholder={t('admin.emailTemplates.rewardDescPlaceholder', 'Show this email at the front desk')}
              className={inputClass}
            />
          </Field>
          <Field label={t('admin.emailTemplates.rewardCode', 'Promo Code (optional)')}>
            <input
              value={template.reward?.code || ''}
              onChange={e => set('reward.code', e.target.value)}
              placeholder={t('admin.emailTemplates.promoCodePlaceholder', 'COMEBACK20')}
              className={inputClass}
            />
          </Field>
          {/* Fecha real, no texto libre. Escrita a mano se quedaba desfasada
              en cuanto pasaba la fecha (correos automáticos prometiendo una
              oferta caducada), no se podía comparar contra nada y cada quien
              la escribía en un formato distinto. El renderizador la formatea
              en el idioma del envío, y `formatExpiry` sigue devolviendo tal
              cual el texto de las plantillas viejas para no perderlo. */}
          <Field label={t('admin.emailTemplates.rewardExpiryDate', 'Valid through (optional)')}>
            <input
              type="date"
              value={/^\d{4}-\d{2}-\d{2}$/.test(template.reward?.expiry || '') ? template.reward.expiry : ''}
              min={new Date().toISOString().slice(0, 10)}
              onChange={e => set('reward.expiry', e.target.value)}
              className={inputClass}
            />
            {template.reward?.expiry && !/^\d{4}-\d{2}-\d{2}$/.test(template.reward.expiry) && (
              <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--color-admin-text-faint)' }}>
                {t('admin.emailTemplates.rewardExpiryLegacy', 'Currently set to free text: “{{value}}”. Pick a date to replace it.', { value: template.reward.expiry })}
              </p>
            )}
          </Field>
          </SectionBlock>
        )}

        {template.footer.enabled && (
          <SectionBlock title={t('admin.emailTemplates.footerSection')} icon={FileText} enabled>
          <Field label={t('admin.emailTemplates.footerText')}>
            <input
              value={view.footer.text}
              onChange={e => set('footer.text', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={t('admin.emailTemplates.unsubscribeText')}>
            <input
              value={view.footer.unsubscribeText}
              onChange={e => set('footer.unsubscribeText', e.target.value)}
              className={inputClass}
            />
          </Field>
          </SectionBlock>
        )}

        {/* ══ Ajustes finos ════════════════════════════════════════
            Densidad, tipografia, etiqueta de cabecera y colores. Plegado por
            defecto a proposito: nadie necesita abrirlo para mandar un correo
            que se vea bien, y esa es justamente la promesa. */}
        <AdminCard padding="p-0">
          <button
            type="button"
            onClick={() => setShowAdvancedStyle(v => !v)}
            className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left"
            style={{ background: 'var(--color-bg-deep)', border: 'none', cursor: 'pointer' }}
          >
            <div className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg" style={{ background: 'var(--color-admin-panel)' }}>
              <Type size={14} strokeWidth={2} style={{ color: 'var(--color-admin-text-muted)' }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-extrabold" style={{ fontFamily: DISPLAY_FONT, color: 'var(--color-admin-text)', letterSpacing: '-0.2px' }}>
                {t('admin.emailTemplates.advancedStyle', 'Advanced')}
              </div>
              <div className="text-[10.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                {t('admin.emailTemplates.advancedSub', 'Spacing, type size, header label. Nobody needs to open this.')}
              </div>
            </div>
            {showAdvancedStyle ? <ChevronUp size={16} style={{ color: 'var(--color-admin-text-muted)' }} /> : <ChevronDown size={16} style={{ color: 'var(--color-admin-text-muted)' }} />}
          </button>
          {showAdvancedStyle && (
            <div className="space-y-3 p-[18px]" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
              <Field label={t('admin.emailTemplates.headerText')}>
                <input
                  value={view.header.text}
                  onChange={e => set('header.text', e.target.value)}
                  placeholder={t('admin.emailTemplates.headerTextPlaceholder')}
                  className={inputClass}
                />
              </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('admin.emailTemplates.fontSize', 'Body Font Size')}>
              <select
                value={template.typography?.fontSize || '15'}
                onChange={e => set('typography.fontSize', e.target.value)}
                className={inputClass}
              >
                <option value="13">13px — {t('admin.emailTemplates.fontSizeCompact', 'Compact')}</option>
                <option value="14">14px — {t('admin.emailTemplates.fontSizeSmall', 'Small')}</option>
                <option value="15">15px — {t('admin.emailTemplates.fontSizeDefault', 'Default')}</option>
                <option value="16">16px — {t('admin.emailTemplates.fontSizeMedium', 'Medium')}</option>
                <option value="17">17px — {t('admin.emailTemplates.fontSizeLarge', 'Large')}</option>
              </select>
            </Field>
            <Field label={t('admin.emailTemplates.borderRadius', 'Card Corners')}>
              <select
                value={template.typography?.borderRadius || '12'}
                onChange={e => set('typography.borderRadius', e.target.value)}
                className={inputClass}
              >
                <option value="0">{t('admin.emailTemplates.cornersSharp', 'Sharp')} (0px)</option>
                <option value="8">{t('admin.emailTemplates.cornersSubtle', 'Subtle')} (8px)</option>
                <option value="12">{t('admin.emailTemplates.cornersRounded', 'Rounded')} (12px)</option>
                <option value="20">{t('admin.emailTemplates.cornersExtra', 'Extra Round')} (20px)</option>
              </select>
            </Field>
            {/* TRES opciones, no cuatro: el motor tiene tres densidades. Ofrecer
                una cuarta era prometer una diferencia que no existe. */}
            <Field label={t('admin.emailTemplates.padding', 'Content Padding')}>
              <select
                value={engineCfg.density}
                onChange={e => set('density', e.target.value)}
                className={inputClass}
              >
                <option value="compacto">{t('admin.emailTemplates.paddingTight', 'Tight')}</option>
                <option value="comodo">{t('admin.emailTemplates.paddingNormal', 'Normal')}</option>
                <option value="espacioso">{t('admin.emailTemplates.paddingSpacious', 'Spacious')}</option>
              </select>
            </Field>
          </div>

          {/* Los tres selectores de color se fueron. El motor v2 toma UN acento y
              es el del gimnasio: su docblock dice que del gimnasio solo entran
              logo, nombre, dirección y ese color, y que el resto es la maqueta.
              Fondo y tinta salen del preset. Los tres se guardaban, se
              recargaban intactos y no pintaban NADA — y `colors.primary` además
              lo pisaba siempre el acento de la marca. Guardar la paleta dentro
              de cada plantilla es justo lo que dejaba plantillas viejas con los
              colores de antes al recolorear el gimnasio. */}
            </div>
          )}
        </AdminCard>

        {/* Send Test Email */}
        <AdminCard>
          <p className="text-[12px] font-semibold text-[var(--color-admin-text-muted)] uppercase tracking-wider mb-3">
            {t('admin.emailTemplates.sendTestTitle')}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={testEmail}
              onChange={e => setTestEmail(e.target.value)}
              placeholder={t('admin.emailTemplates.testEmailPlaceholder')}
              className={`${inputClass} flex-1`}
            />
            <button
              onClick={handleSendTest}
              disabled={sendingTest}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-[13px] text-[var(--color-admin-text)] border border-[var(--color-admin-border)] hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50"
              style={{ background: 'var(--color-admin-panel)' }}
            >
              {sendingTest ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {t('admin.emailTemplates.sendTest')}
            </button>
          </div>
        </AdminCard>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pb-8">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-[13px] transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-accent, #D4AF37)', color: 'var(--color-text-on-accent, #000)' }}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {t('admin.emailTemplates.save')}
          </button>
          <button
            onClick={handleExportHtml}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-[13px] text-[var(--color-admin-text)] border border-[var(--color-admin-border)] hover:bg-[var(--color-bg-hover)] transition-colors"
            style={{ background: 'var(--color-admin-panel)' }}
          >
            <Copy size={15} /> {t('admin.emailTemplates.exportHtml')}
          </button>
        </div>
        </div>
      </div>

      {/* Right: Live Preview (desktop) — dark "stage" backdrop, per the design */}
      <div className="hidden lg:flex flex-col w-[460px] flex-shrink-0" style={{ borderLeft: '1px solid var(--color-admin-border)', background: '#0b0b12' }}>
        <EmailLivePreview cfg={engineCfg} />
      </div>

      {/* Mobile preview overlay — fullscreen drawer slides in from the right */}
      {mobilePreviewOpen && (
        <div className="lg:hidden fixed inset-0 z-[120] flex flex-col bg-[#0b0b12]" role="dialog" aria-modal="true">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/6 flex-shrink-0"
            style={{ paddingTop: 'calc(12px + env(safe-area-inset-top))' }}>
            <button
              onClick={() => setMobilePreviewOpen(false)}
              className="p-2 -ml-2 rounded-lg text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/[0.06]"
              aria-label={t('admin.emailTemplates.back', 'Back')}
            >
              <ArrowLeft size={18} />
            </button>
            <p className="text-[14px] font-semibold text-[#E5E7EB] flex-1">
              {t('admin.emailTemplates.preview', 'Preview')}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto"
            style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
            <EmailLivePreview cfg={engineCfg} />
          </div>
        </div>
      )}
    </div>
  );
}
