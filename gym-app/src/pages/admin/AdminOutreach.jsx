import { useState, useMemo, useEffect } from 'react';
import posthogClient from 'posthog-js';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Send, Loader2, Sparkles, Eye, Mail, ChevronDown, History } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase, authHeader, isSessionError } from '../../lib/supabase';
import {
  PageHeader, AdminCard, AdminPageShell, FadeIn, AdminModal,
} from '../../components/admin';
import { getEmailTemplates, getSmsTemplates } from '../../lib/adminMessageTemplates';
import { resolveOutreachAudience } from '../../lib/admin/outreachAudience';
import { sendOutreach } from '../../lib/admin/outreachSender';
import { enqueueOutreach, nudgeOutreachJob, fetchOutreachProgress, cancelOutreachJob } from '../../lib/admin/outreachQueue';
import OutreachAudiencePicker from './components/OutreachAudiencePicker';
import OutreachChannelPicker from './components/OutreachChannelPicker';
import { getPrebuiltTemplates } from './components/emailTemplatePrebuilts';
import { dbRowToTemplate } from '../../lib/admin/emailTemplateRenderer';
import { renderDesignerEmail } from '../../lib/admin/emailDesignerTemplates';
import OutreachTemplatePicker from './components/OutreachTemplatePicker';
import { emailDoc } from '../../lib/admin/emailEngine';
import { templateToCfg } from '../../lib/admin/emailCfg';
import { pickVariant } from '../../lib/admin/emailVariants';

// Read the gym's current brand colors so designer templates render on-brand.
// branding.js sets these vars on :root (--accent-primary / --accent-secondary).
function readBrandColors() {
  if (typeof document === 'undefined') return { primary: '', secondary: '' };
  const css = getComputedStyle(document.documentElement);
  const pick = (...names) => {
    for (const n of names) {
      const v = css.getPropertyValue(n).trim();
      if (v) return v;
    }
    return '';
  };
  return {
    primary: pick('--accent-primary', '--color-accent'),
    secondary: pick('--accent-secondary'),
  };
}

const inputClass = 'w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors';
const inputStyle = {
  background: 'var(--color-bg-deep)',
  border: '1px solid var(--color-border-subtle)',
  color: 'var(--color-text-primary)',
};

// Group outreach-send audit rows (already sorted newest-first) into year → month
// buckets for the history modal. Returns [{ year, months: [{ key, monthIdx, year, items }] }].
function groupSendsByYearMonth(rows) {
  const years = [];
  const yearIdx = new Map();
  for (const row of rows) {
    const d = new Date(row.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const year = d.getFullYear();
    const monthIdx = d.getMonth();
    let y = yearIdx.get(year);
    if (!y) { y = { year, months: [], mIdx: new Map() }; yearIdx.set(year, y); years.push(y); }
    let mo = y.mIdx.get(monthIdx);
    if (!mo) { mo = { key: `${year}-${monthIdx}`, monthIdx, year, items: [] }; y.mIdx.set(monthIdx, mo); y.months.push(mo); }
    mo.items.push(row);
  }
  return years;
}

// One outreach-send line — audience, recipients · channels, timestamp. Shared by
// the "Recent sends" list and the grouped history modal.
function SendRow({ row, t }) {
  return (
    <div>
      <p className="font-semibold truncate text-[12px]" style={{ color: 'var(--color-text-primary)' }}>
        {row.details?.audience || '—'}
      </p>
      <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
        {row.details?.recipientCount ?? 0} {t('admin.outreach.recipients', 'recipients')}
        {' · '}
        {(row.details?.channels || []).join(', ')}
      </p>
      <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
        {new Date(row.created_at).toLocaleString()}
      </p>
    </div>
  );
}

/**
 * Unified Outreach composer — one place to message members regardless of
 * channel. Replaces the per-page bulk message / win-back / broadcast popups
 * that used to live in AdminMembers, AdminChurn, AdminMessaging, etc.
 *
 * Deep-link query params let other pages prefill the composer:
 *  - ?audience=critical | high | medium | low — pre-selects a churn tier
 *  - ?audience=member&ids=uuid,uuid           — pre-selects specific members
 *  - ?audience=segment&id=<uuid>              — pre-selects a saved segment
 *  - ?audience=unonboarded | birthdays        — pre-selects the preset
 *  - ?channel=push|email|sms|inApp            — pre-toggles a single channel
 */
export default function AdminOutreach() {
  const { t, i18n } = useTranslation('pages');
  const { user, profile, gymName, gymLogoUrl } = useAuth();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const gymId = profile?.gym_id;

  // ── Audience (audience picker)
  const [audience, setAudience] = useState(() => {
    const a = searchParams.get('audience');
    const id = searchParams.get('id');
    const ids = searchParams.get('ids');
    if (a === 'critical' || a === 'high' || a === 'medium' || a === 'low') return { type: 'tier', tier: a };
    if (a === 'segment' && id) return { type: 'segment', segmentId: id };
    if (a === 'member' && ids) return { type: 'members', ids: ids.split(',') };
    if (a === 'unonboarded') return { type: 'unonboarded' };
    if (a === 'birthdays') return { type: 'birthdays' };
    return { type: 'all' };
  });

  // ── Channels
  const [channels, setChannels] = useState(() => {
    const ch = searchParams.get('channel');
    return {
      push: ch ? ch === 'push' : true,
      inApp: ch === 'inApp',
      email: ch === 'email',
      sms: ch === 'sms',
    };
  });

  // ── Content
  // `?body=` deep-link param lets other pages (e.g. AdminABTesting "Ship
  // winner to Outreach") prefill the composer body. Decoded once on mount.
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState(() => {
    const b = searchParams.get('body');
    return b ? decodeURIComponent(b) : '';
  });
  const [templateKey, setTemplateKey] = useState('');
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [sendingTest, setSendingTest] = useState(false);
  // When a designer template is in play, `designer.html` is the pre-rendered
  // email (with the {{first_name}} merge token still inside) that gets sent as
  // the email body verbatim. The body textarea then only feeds push/SMS/in-app.
  const [designer, setDesigner] = useState(null); // { id, html, subject, kind }
  const [pickerOpen, setPickerOpen] = useState(false);
  // El trabajo de correo en curso. Sobrevive a que se cierre la pestaña; esto
  // solo es la ventana para mirarlo mientras siga abierta.
  const [activeJobId, setActiveJobId] = useState(null);
  // La recompensa de la campaña: qué conceder, no el código. El código lo crea
  // el enviador por miembro.
  const [reward, setReward] = useState(null);

  // Se sondea la VISTA de progreso, no el resultado de los empujones: así la
  // cuenta es la del servidor y sigue siendo correcta aunque quien empuje sea el
  // cron. `refetchInterval` se apaga solo al terminar.
  const { data: jobProgress } = useQuery({
    queryKey: ['outreach-job', activeJobId],
    queryFn: () => fetchOutreachProgress(activeJobId),
    enabled: !!activeJobId,
    // Se para cuando el trabajo termina Y TAMBIÉN si el progreso no se puede
    // leer. `fetchOutreachProgress` devuelve null ante un error o una fila que
    // la RLS no deja ver, y con null la tarjeta ni se pinta: el sondeo seguía
    // cada 2 s hasta desmontar la página, sin nada que lo detuviera.
    refetchInterval: (q) => {
      const st = q.state.data?.status;
      if (st) return st === 'queued' || st === 'running' ? 2000 : false;
      return q.state.dataUpdateCount >= 5 ? false : 2000;
    },
  });
  const [showRecipients, setShowRecipients] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // null = default (most-recent month auto-expanded); otherwise an explicit Set of open month keys.
  const [openMonths, setOpenMonths] = useState(null);

  // Un DISEÑO de la galería es un correo por naturaleza: su HTML no puede viajar
  // por push/SMS/in-app, que solo llevan el `body` plano, y ahí `body` es una
  // línea de vista previa. Por eso bloquea el compositor al canal email.
  //
  // Una plantilla de BLOQUES no bloquea: se adjunta su HTML para el correo Y se
  // rellena el cuerpo con su texto de verdad, así que los otros canales tienen
  // algo que decir. Bloquearla también habría convertido "escoger plantilla" en
  // "renunciar a los demás canales", que no es lo que pediste.
  const emailLocked = designer?.kind === 'design';

  useEffect(() => { document.title = `${t('admin.outreach.pageTitle', 'Outreach')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  // Clamp channels to email-only while a designer email is locked in, so a
  // channel toggled on before the design was attached can't sneak through.
  useEffect(() => {
    if (!emailLocked) return;
    setChannels(prev =>
      prev.email && !prev.push && !prev.inApp && !prev.sms
        ? prev
        : { push: false, inApp: false, email: true, sms: false },
    );
  }, [emailLocked]);

  // ── Prefill from email template deep-link (?template=<id> or ?prebuilt=<key>)
  // Runs once on mount. If a saved template id is provided, we hydrate from the
  // gym_email_templates row; if a prebuilt key is provided, we look it up in
  // the in-memory prebuilt catalog. Either way we flip channels.email on and
  // set subject + body from the template's stored content.
  // ── Prefill from a designer template (?designer=<id>). Renders the polished
  // editorial HTML with the gym's name/logo, an adaptive palette derived from
  // the gym's brand colors, and keeps the per-recipient merge tokens literal
  // so the sender personalizes them per recipient.
  useEffect(() => {
    const designerId = searchParams.get('designer');
    if (!designerId) return;
    const lang = i18n.language?.startsWith('es') ? 'es' : 'en';
    const { primary, secondary } = readBrandColors();
    const r = renderDesignerEmail(designerId, {
      lang, gymName, logoUrl: gymLogoUrl,
      primaryColor: primary, secondaryColor: secondary,
      coachName: gymName,
      name: '{{first_name}}',
      vars: {
        streak_count: '{{streak_count}}',
        workout_count: '{{workout_count}}',
        days_inactive: '{{days_inactive}}',
      },
    });
    if (!r) return;
    setDesigner({ id: designerId, html: r.html, subject: r.subject });
    setSubject(r.subject);
    setBody(prev => prev || r.preview);
    setChannels(prev => ({ ...prev, email: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId, gymName, gymLogoUrl]);


  // Las frases rápidas siguen existiendo para SMS —donde no hay maqueta que
  // valga— y como fila de acceso directo. El catálogo completo vive en el
  // selector.
  const emailTemplates = useMemo(() => getEmailTemplates(t, '{{first_name}}'), [t]);
  const smsTemplates = useMemo(() => getSmsTemplates(t, '{{first_name}}'), [t]);
  const activeTemplates = channels.email ? emailTemplates : smsTemplates;

  const handleTemplate = (key) => {
    setTemplateKey(key);
    setDesigner(null); // a plain template replaces any active designer design
    const tpl = activeTemplates.find(x => x.key === key);
    if (!tpl) return;
    if (tpl.subject) setSubject(tpl.subject);
    setBody(tpl.body);
  };

  /**
   * El texto plano de una plantilla de bloques — para push, SMS y notificación.
   * El correo va con su maqueta; los otros canales solo llevan texto.
   */
  const plainOf = (tpl) => {
    const head = tpl.hero?.headline ? `${tpl.hero.headline}\n\n` : '';
    return `${head}${tpl.body?.text || ''}`.trim();
  };

  /**
   * Lo que se escogió en el selector, aplicado al compositor.
   *
   * La diferencia con el prellenado viejo: una plantilla de bloques se
   * RENDERIZA ENTERA con el motor y se adjunta como `html`. Antes se aplanaba a
   * asunto + texto plano, o sea que la plantilla que habías diseñado —maqueta,
   * recompensa con su QR, botón, pie, portada— llegaba al buzón desvestida y
   * reenvuelta en la plantilla genérica de send-admin-email. Nadie lo notaba
   * porque para verlo había que comparar con la vista previa del editor.
   */
  const applyPicked = (picked) => {
    setPickerOpen(false);
    if (!picked) return;

    if (picked.kind === 'quick') {
      setReward(null);
      handleTemplate(picked.template.key);
      return;
    }

    const { primary, secondary } = readBrandColors();
    const lang = i18n.language?.startsWith('es') ? 'es' : 'en';

    if (picked.kind === 'design') {
      const r = renderDesignerEmail(picked.id, {
        lang, gymName, logoUrl: gymLogoUrl,
        primaryColor: primary, secondaryColor: secondary,
        coachName: gymName,
        name: '{{first_name}}',
        vars: {
          streak_count: '{{streak_count}}',
          workout_count: '{{workout_count}}',
          days_inactive: '{{days_inactive}}',
        },
      });
      if (!r) return;
      setReward(null);
      setDesigner({ id: picked.id, html: r.html, subject: r.subject, kind: 'design' });
      setSubject(r.subject);
      setBody(prev => prev || r.preview);
      setTemplateKey('');
      setChannels(prev => ({ ...prev, email: true }));
      return;
    }

    const tpl = picked.template;
    // Una plantilla guardada DESDE la galería ya viene renderizada: no tiene
    // bloques que montar, y pasarla por el motor la dejaría en blanco.
    if (tpl.designer_id && tpl.designer_html) {
      setReward(null);
      setDesigner({ id: tpl.designer_id, html: tpl.designer_html, subject: tpl.designer_subject || tpl.name, kind: 'design' });
      setSubject(tpl.designer_subject || tpl.name || '');
      setBody(prev => prev || tpl.designer_preview || '');
      setTemplateKey('');
      setChannels(prev => ({ ...prev, email: true }));
      return;
    }

    // `sampleCode` y `allowPlaceholder` se quedan en false a propósito: el
    // código de muestra con su QR y el marcador a rayas de la portada existen
    // SOLO para la vista previa del editor. Aquí esto sale a un buzón.
    // `pickVariant` PRIMERO: el envío manual se saltaba las variantes de idioma
    // enteras, así que traducías la plantilla al inglés y a todo el mundo le
    // salía el texto base. El único que las aplicaba era el envío automático.
    //
    // `keepTokens`: los merge tags tienen que llegar LITERALES. outreachSender
    // los sustituye por destinatario justo antes de enviar; si el motor los
    // rellenara aquí, lo haría con sus valores de MUESTRA y a toda la lista le
    // llegaría el mismo «Hola José Rivera».
    // La recompensa solo se puede conceder contra una plantilla GUARDADA:
    // `grant_email_campaign_reward` valida `p_template_id` contra el gimnasio,
    // y una prefabricada no tiene fila. Sin id no se adjunta y el bloque no sale
    // — mejor eso que una tarjeta con un código que no existe.
    const savedId = tpl.id && !String(tpl.id).startsWith('prebuilt-') ? tpl.id : null;
    const withReward = !!(tpl.reward?.enabled && tpl.reward?.title && savedId);
    setReward(withReward ? {
      template_id: savedId,
      label: tpl.reward.title,
      reward_id: tpl.reward.reward_id || null,
      expires_at: /^\d{4}-\d{2}-\d{2}$/.test(tpl.reward.expiry || '') ? tpl.reward.expiry : null,
    } : null);

    const html = emailDoc({
      ...templateToCfg(pickVariant(tpl, lang), {
        lang, gymName, gymLogoUrl, accent: primary,
        // El código como token: se sustituye por miembro al enviar.
        codeToken: withReward,
      }),
      keepTokens: true,
    });
    setDesigner({ id: tpl.id, html, subject: tpl.header?.text || tpl.name || '', kind: 'template' });
    setSubject(tpl.header?.text || tpl.name || '');
    // `|| prev`: una plantilla sin titular ni cuerpo dejaba `body` vacío, y
    // `canSend` lo exige — el botón se apagaba sin explicación. Las otras dos
    // ramas ya conservaban lo escrito.
    const plain = plainOf(pickVariant(tpl, lang));
    setBody(prev => plain || prev);
    setTemplateKey('');
    setChannels(prev => ({ ...prev, email: true }));
  };

  // El deep-link desde Plantillas de Email (?template / ?prebuilt) sigue
  // funcionando, pero YA NO APLANA. Antes traía solo `header.text` de asunto y
  // `hero.headline + body.text` de cuerpo, tirando la maqueta, la recompensa con
  // su QR, el botón, el pie y la portada: la plantilla que habías diseñado
  // llegaba al buzón desvestida. Ahora entra por el mismo camino que el selector.
  useEffect(() => {
    const templateId = searchParams.get('template');
    const prebuiltKey = searchParams.get('prebuilt');
    if (!templateId && !prebuiltKey) return;
    let cancelled = false;

    if (templateId && gymId) {
      (async () => {
        const { data } = await supabase
          .from('gym_email_templates')
          .select('id, name, template_type, template_data, step_key, auto_enabled, is_prebuilt, created_at, updated_at')
          .eq('id', templateId)
          .eq('gym_id', gymId)
          .maybeSingle();
        if (!data || cancelled) return;
        applyPicked({ kind: 'template', template: dbRowToTemplate(data) });
      })();
    } else if (prebuiltKey) {
      const list = getPrebuiltTemplates(gymName, readBrandColors().primary || '#D4AF37', t);
      const match = list.find(p => p.id === `prebuilt-${prebuiltKey}` || p.id === prebuiltKey);
      if (match) applyPicked({ kind: 'template', template: match });
    }

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId]);

  // ── Audience label for audit log + UI summary
  const audienceLabel = useMemo(() => {
    if (audience.type === 'all') return t('admin.outreach.everyMember', 'Every member');
    if (audience.type === 'tier') return t(`admin.outreach.tier.${audience.tier}`, audience.tier);
    if (audience.type === 'segment') return audience.segmentName || t('admin.outreach.savedSegment', 'Saved segment');
    if (audience.type === 'members') return t('admin.outreach.specificMembersCount', { count: audience.ids?.length || 0, defaultValue: '{{count}} specific member(s) selected' });
    if (audience.type === 'unonboarded') return t('admin.outreach.unonboarded', "Haven't finished onboarding");
    if (audience.type === 'birthdays') return t('admin.outreach.birthdaysWeek', 'Birthdays this week');
    return '';
  }, [audience, t]);

  // Live recipient resolution — re-resolves whenever the audience selector
  // changes. Drives both the count and the "who will receive this" preview so
  // the admin can verify the exact audience before sending. Keyed by the
  // serialized audience so identical selectors dedupe through the cache.
  const { data: recipients = [], isFetching: recipientsLoading } = useQuery({
    queryKey: ['admin', 'outreach', gymId, 'recipients', JSON.stringify(audience)],
    queryFn: () => resolveOutreachAudience(gymId, audience),
    enabled: !!gymId,
    staleTime: 30_000,
  });
  const recipientCount = recipients.length;

  // Recent sends — pulled from admin_audit_log so admins see what went out.
  const { data: recent = [], refetch: refetchRecent } = useQuery({
    queryKey: ['admin', 'outreach', gymId, 'recent'],
    queryFn: async () => {
      // admin_audit_log column is `action` (not `action_type`); see migration 0164.
      const { data } = await supabase
        .from('admin_audit_log')
        .select('id, created_at, details')
        .eq('gym_id', gymId)
        .in('action', ['outreach_send', 'outreach_enqueue'])
        .order('created_at', { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!gymId,
  });

  // Full send history for the "View history" modal — grouped by year → month.
  // Lazy: only fetched once the admin opens the modal, so it never slows the page.
  const { data: history = [], isFetching: historyLoading } = useQuery({
    queryKey: ['admin', 'outreach', gymId, 'history'],
    queryFn: async () => {
      const { data } = await supabase
        .from('admin_audit_log')
        .select('id, created_at, details')
        .eq('gym_id', gymId)
        .in('action', ['outreach_send', 'outreach_enqueue'])
        .order('created_at', { ascending: false })
        .limit(1000);
      return data || [];
    },
    enabled: !!gymId && showHistory,
    staleTime: 60_000,
  });

  const groupedHistory = useMemo(() => groupSendsByYearMonth(history), [history]);
  const firstMonthKey = groupedHistory[0]?.months[0]?.key || null;
  const isMonthOpen = (key) => (openMonths ?? new Set(firstMonthKey ? [firstMonthKey] : [])).has(key);
  const toggleMonth = (key) => setOpenMonths((prev) => {
    const next = new Set(prev ?? (firstMonthKey ? [firstMonthKey] : []));
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const anyChannelOn = channels.push || channels.inApp || channels.email || channels.sms;
  // `!jobRunning`: la rama de correo NO espera al empujón —a propósito, para que
  // cerrar la pestaña no importe—, así que `sending` volvía a false en cuanto la
  // RPC devolvía y un segundo clic creaba OTRA campaña sobre la misma audiencia.
  // `UNIQUE (job_id, profile_id)` deduplica DENTRO de un trabajo, no entre dos.
  // Y `setActiveJobId` pisaba el anterior, dejando la primera sin poder mirarla.
  const jobRunning = jobProgress?.status === 'queued' || jobProgress?.status === 'running';
  const canSend = !!gymId && anyChannelOn && body.trim().length > 0 && !sending && !jobRunning;

  // Send a one-off test of the current designer email to the admin's own
  // address — same edge function as the broadcast, just an audience of one.
  // Lets the admin preview the rich design in their real inbox before blasting.
  const handleSendTest = async () => {
    if (!user?.email || !designer?.html) return;
    setSendingTest(true);
    try {
      const first = (profile?.full_name || 'there').split(' ')[0] || 'there';
      const html = designer.html.replace(/\{\{first_name\}\}/g, first);
      const subj = (subject || designer.subject || 'Message from your gym').replace(/\{\{first_name\}\}/g, first);
      // testMode=true is REQUIRED: it routes the edge fn down the self-send
      // preview path (free-form `to` + raw `html`, no memberId). Without it the
      // request falls through to the live-send branch, which 400s on the missing
      // memberId — that was why "Send test" silently failed.
      const { error } = await supabase.functions.invoke('send-admin-email', {
        headers: await authHeader(),
        body: { testMode: true, to: user.email, subject: `[TEST] ${subj}`, html },
      });
      if (error) throw error;
      showToast(t('admin.outreach.testSent', { email: user.email, defaultValue: 'Test sent to {{email}}' }), 'success');
    } catch (err) {
      showToast(
        isSessionError(err)
          ? t('platformLayout.sessionExpiredMsg', 'Your session expired — please sign in again.')
          : t('admin.outreach.testFailed', 'Test send failed'),
        'error',
      );
    } finally {
      setSendingTest(false);
    }
  };

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const recipients = await resolveOutreachAudience(gymId, audience);
      if (!recipients.length) {
        showToast(t('admin.outreach.emptyAudience', 'No members match this audience'), 'error');
        setSending(false);
        return;
      }

      // ── El correo va por la COLA; los demás canales, directos.
      //
      // Push, SMS y notificación son rápidos y no dependen de un proveedor que
      // limite por segundo, así que mandarlos desde aquí sigue siendo correcto.
      // El correo no: es el que tarda, el que topa y el que se perdía a mitad al
      // cerrar la pestaña. Ese se encola (mig 0695) y lo remata el servidor.
      const others = { ...channels, email: false };
      const anyOther = others.push || others.sms || others.inApp;

      let results = null;
      if (anyOther) {
        results = await sendOutreach({
          gymId, recipients, channels: others, subject, body,
          personalize: { gymName, coachName: gymName },
          templateKey: designer ? `designer:${designer.id}` : templateKey,
          audienceLabel,
        });
      }

      if (channels.email) {
        // Ya no hace falta hidratar direcciones aquí: el procesador las resuelve
        // en servidor con `member_email_context`, que además trae el token de
        // baja y las estadísticas del miembro de una sola vez.
        const { jobId } = await enqueueOutreach({
          recipients, subject,
          body,
          html: designer?.html || null,
          personalize: { gymName, coachName: gymName },
          templateKey: designer ? `designer:${designer.id}` : templateKey,
          audienceLabel,
          reward,
        });
        setActiveJobId(jobId);
        showToast(
          t('admin.outreach.queued', { count: recipients.length, defaultValue: 'En cola para {{count}} miembro(s). Puedes cerrar esta página.' }),
          'success',
        );
        // Sin `await`: los empujones aceleran mientras la pestaña esté abierta,
        // y si se cierra a mitad el cron sigue. Bloquear aquí volvería a atar la
        // campaña a la pestaña, que es justo lo que se está quitando.
        nudgeOutreachJob(jobId).catch(() => {});
      }

      if (results) {
        setLastResult({ recipients: recipients.length, results });
        const sent = (results.sms?.sent || 0) + (results.push?.sent || 0) + (results.inApp?.sent || 0);
        const failed = (results.sms?.failed || 0) + (results.push?.failed || 0) + (results.inApp?.failed || 0);
        if (sent > 0) {
          posthogClient?.capture('admin_outreach_email_sent', {
            sent, failed,
            channels: Object.entries(channels).filter(([, v]) => v).map(([k]) => k),
          });
        }
        if (results.aborted) {
          const why = results.aborted.reason === 'admin_hourly_limit_exceeded'
            ? t('admin.outreach.abortedRateLimit', 'llegaste al tope de envíos por hora')
            : t('admin.outreach.abortedSession', 'la sesión caducó');
          showToast(t('admin.outreach.aborted', {
            sent, pending: results.pending.length, why,
            defaultValue: 'Se detuvo el envío: {{why}}. Enviados {{sent}}, faltan {{pending}}.',
          }), 'error');
        } else if (failed > 0) {
          const reasons = { ...(results.sms?.reasons || {}) };
          const top = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
          showToast(t('admin.outreach.partialSentWhy', {
            sent, failed, why: top ? top[0] : '',
            defaultValue: 'Enviados {{sent}}, {{failed}} fallaron ({{why}})',
          }), 'error');
        } else if (!channels.email) {
          showToast(t('admin.outreach.sentToast', { count: recipients.length, defaultValue: 'Sent to {{count}} member(s)' }), 'success');
        }
      }
      refetchRecent();
    } catch (err) {
      showToast(
        isSessionError(err)
          ? t('platformLayout.sessionExpiredMsg', 'Your session expired — please sign in again.')
          : (err.message || 'Failed'),
        'error',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <AdminPageShell>
      <div data-admin-tour="outreach">
      <PageHeader
        title={t('admin.outreach.title', 'Send a message')}
        subtitle={t('admin.outreach.subtitle', 'Reach the right members on the right channel — one place, no copy-paste')}
        className="mb-5"
      />
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-5 min-w-0">
        {/* ── Left column: composer ─────────────────────────── */}
        <div className="space-y-4 min-w-0">
          <FadeIn>
            <AdminCard padding="p-4 sm:p-5">
              <OutreachAudiencePicker gymId={gymId} value={audience} onChange={setAudience} t={t} />
            </AdminCard>
          </FadeIn>

          <FadeIn delay={40}>
            <AdminCard padding="p-4 sm:p-5">
              <OutreachChannelPicker value={channels} onChange={setChannels} t={t} lockedToEmail={emailLocked} />
            </AdminCard>
          </FadeIn>

          <FadeIn delay={80}>
            <AdminCard padding="p-4 sm:p-5">
              <div className="space-y-3">
                <label className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
                  {t('admin.outreach.content', 'Message')}
                </label>

                {designer && (
                  <div
                    className="rounded-xl overflow-hidden"
                    style={{ border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)', background: 'color-mix(in srgb, var(--color-accent) 7%, transparent)' }}
                  >
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Sparkles size={13} style={{ color: 'var(--color-accent)' }} />
                        <span className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                          {t('admin.outreach.designerAttached', 'Designer email attached')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSendTest}
                          disabled={sendingTest || !user?.email}
                          title={user?.email || ''}
                          className="flex items-center gap-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50"
                          style={{ color: 'var(--color-accent)' }}
                        >
                          {sendingTest ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />}
                          {t('admin.outreach.sendTest', 'Send test')}
                        </button>
                        <span style={{ color: 'var(--color-text-subtle)' }}>·</span>
                        <button
                          type="button"
                          onClick={() => setDesigner(null)}
                          className="text-[11px] font-semibold transition-colors hover:underline"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          {t('admin.outreach.designerRemove', 'Remove')}
                        </button>
                      </div>
                    </div>
                    <div style={{ height: 280, overflow: 'hidden', background: '#f0eee9' }}>
                      <iframe
                        title="designer-preview"
                        srcDoc={designer.html}
                        scrolling="no"
                        tabIndex={-1}
                        aria-hidden="true"
                        style={{ width: 640, height: 620, border: 0, transform: 'scale(0.45)', transformOrigin: 'top left', pointerEvents: 'none' }}
                      />
                    </div>
                    <p className="px-3 py-2 text-[10.5px]" style={{ color: 'var(--color-text-muted)' }}>
                      {t('admin.outreach.designerHint', 'Email recipients get this full design. The body below is only used for push, SMS and in-app.')}
                    </p>
                  </div>
                )}

                {activeTemplates.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="flex-1 text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                        <Sparkles size={11} className="inline mr-1" />
                        {t('admin.outreach.useTemplate', 'Start from a template')}
                      </p>
                      {/* El catálogo COMPLETO, aquí dentro. Antes había que ir a
                          Plantillas de Email, buscarla y pulsar un avión de papel
                          que te devolvía a esta misma pantalla. */}
                      <button
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        className="px-3 py-1.5 rounded-[9px] text-[11.5px] font-bold min-h-[36px]"
                        style={{
                          color: 'var(--color-accent)',
                          background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                          border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
                        }}
                      >
                        {t('admin.outreach.browseTemplates', 'Ver todas mis plantillas')}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {activeTemplates.map(tpl => (
                        <button
                          key={tpl.key}
                          type="button"
                          onClick={() => handleTemplate(tpl.key)}
                          className="px-3 py-1.5 rounded-[9px] text-[11.5px] font-semibold transition-colors border"
                          style={{
                            background: templateKey === tpl.key ? 'var(--color-text-primary)' : 'var(--color-bg-deep)',
                            color: templateKey === tpl.key ? 'var(--color-bg-card)' : 'var(--color-text-secondary)',
                            borderColor: templateKey === tpl.key ? 'transparent' : 'var(--color-border-subtle)',
                          }}
                        >
                          {tpl.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {channels.email && (
                  <div>
                    <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                      {t('admin.outreach.subject', 'Subject')}
                    </label>
                    <input
                      value={subject}
                      onChange={e => setSubject(e.target.value)}
                      placeholder={t('admin.outreach.subjectPlaceholder', 'e.g. We miss you, {{first_name}}!')}
                      className={inputClass}
                      style={inputStyle}
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.outreach.body', 'Body')}
                  </label>
                  <textarea
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    rows={8}
                    placeholder={t('admin.outreach.bodyPlaceholder', 'Write your message — use {{first_name}} for personalization')}
                    className={`${inputClass} resize-y min-h-[140px]`}
                    style={inputStyle}
                  />
                  <div className="flex items-center flex-wrap gap-1.5 mt-2">
                    {['{{first_name}}', '{{name}}'].map(v => (
                      <span
                        key={v}
                        className="font-mono text-[10.5px] px-1.5 py-0.5 rounded-md"
                        style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', color: 'var(--color-accent)' }}
                      >
                        {v}
                      </span>
                    ))}
                    <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {t('admin.outreach.varsHint', 'are replaced per recipient.')}
                    </span>
                  </div>
                </div>
              </div>
            </AdminCard>
          </FadeIn>

        </div>

        {/* ── Right column: summary + recent sends (sticky) ─── */}
        <div className="space-y-4 lg:sticky lg:top-6 self-start">
          <FadeIn>
            <AdminCard padding="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Eye size={14} style={{ color: 'var(--color-accent)' }} />
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
                  {t('admin.outreach.summary', 'Summary')}
                </span>
              </div>
              <dl className="space-y-2 text-[12.5px]">
                <div className="flex items-start justify-between gap-3">
                  <dt style={{ color: 'var(--color-text-muted)' }}>{t('admin.outreach.audienceLabel', 'Audience')}</dt>
                  <dd className="text-right font-semibold" style={{ color: 'var(--color-text-primary)' }}>{audienceLabel}</dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt style={{ color: 'var(--color-text-muted)' }}>{t('admin.outreach.recipientsLabel', 'Recipients')}</dt>
                  <dd className="text-right font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {recipientsLoading && recipients.length === 0
                      ? <Loader2 size={12} className="inline animate-spin" />
                      : (
                        <span
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-bold tabular-nums"
                          style={{
                            background: 'var(--color-accent)',
                            color: 'var(--color-text-on-accent)',
                          }}
                        >
                          {recipientCount}
                        </span>
                      )}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt style={{ color: 'var(--color-text-muted)' }}>{t('admin.outreach.channelsLabel', 'Channels')}</dt>
                  <dd className="text-right font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {Object.entries(channels).filter(([, v]) => v).map(([k]) => ({
                      push: t('admin.outreach.channelPushShort', 'Push'),
                      inApp: t('admin.outreach.channelInAppShort', 'In-app'),
                      email: t('admin.outreach.channelEmailShort', 'Email'),
                      sms: t('admin.outreach.channelSmsShort', 'SMS'),
                    }[k] || k)).join(', ') || '—'}
                  </dd>
                </div>
              </dl>

              {/* Who will receive this — resolved recipient preview */}
              {recipientCount > 0 && (
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                  <button
                    type="button"
                    onClick={() => setShowRecipients(s => !s)}
                    className="flex items-center justify-between w-full text-[12px] font-semibold transition-colors"
                    style={{ color: 'var(--color-accent)' }}
                  >
                    <span>{showRecipients ? t('admin.outreach.hideRecipients', 'Hide recipients') : t('admin.outreach.viewRecipients', 'View recipients')}</span>
                    <ChevronDown size={14} className="transition-transform" style={{ transform: showRecipients ? 'rotate(180deg)' : 'none' }} />
                  </button>
                  {showRecipients && (
                    <div className="mt-2 max-h-64 overflow-y-auto space-y-1">
                      {recipients.slice(0, 100).map(r => (
                        <div key={r.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: 'var(--color-bg-deep)' }}>
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)' }}>
                            {(r.full_name || '?')[0].toUpperCase()}
                          </div>
                          <span className="text-[12px] truncate" style={{ color: 'var(--color-text-secondary)' }}>{r.full_name || t('admin.outreach.unnamed', 'Unnamed')}</span>
                        </div>
                      ))}
                      {recipients.length > 100 && (
                        <p className="text-[11px] text-center py-1.5" style={{ color: 'var(--color-text-muted)' }}>
                          {t('admin.outreach.andMore', { count: recipients.length - 100, defaultValue: '+{{count}} more' })}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Send action lives in the summary so the CTA sits with the count it acts on. */}
              <button
                onClick={handleSend}
                disabled={!canSend}
                className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-[14px] transition-all disabled:cursor-not-allowed hover:brightness-[1.04] active:scale-[0.99]"
                style={{
                  background: canSend ? 'var(--color-accent)' : 'var(--color-bg-hover)',
                  color: canSend ? 'var(--color-text-on-accent)' : 'var(--color-text-muted)',
                  boxShadow: canSend ? '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)' : 'none',
                }}
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {sending ? t('admin.outreach.sending', 'Sending…') : t('admin.outreach.send', 'Send message')}
              </button>
              {recipientCount > 0 && (
                <p className="text-[11.5px] text-center mt-2" style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.outreach.willReceive', { count: recipientCount, defaultValue: '{{count}} people will receive this message' })}
                </p>
              )}
              {lastResult && (
                <p className="text-[11px] text-center mt-1" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('admin.outreach.lastSent', { count: lastResult.recipients, defaultValue: 'Last sent to {{count}} recipient(s)' })}
                </p>
              )}
            </AdminCard>
          </FadeIn>

          <FadeIn delay={40}>
            <AdminCard padding="p-4">
              <span className="text-[11px] font-bold uppercase tracking-wider block mb-3" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
                {t('admin.outreach.recentSends', 'Recent sends')}
              </span>
              {recent.length === 0 ? (
                <p className="text-[12px] italic" style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.outreach.noRecent', 'No outreach sent yet.')}
                </p>
              ) : (
                <>
                  <ul className="space-y-2.5">
                    {recent.map(row => (
                      <li key={row.id} className="pb-2.5 border-b last:border-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
                        <SendRow row={row} t={t} />
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => setShowHistory(true)}
                    className="mt-3 w-full flex items-center justify-center gap-1.5 pt-3 text-[12px] font-semibold transition-colors hover:opacity-80"
                    style={{ color: 'var(--color-accent)', borderTop: '1px solid var(--color-border-subtle)' }}
                  >
                    <History size={13} /> {t('admin.outreach.viewHistory', 'View history')}
                  </button>
                </>
              )}
            </AdminCard>
          </FadeIn>
        </div>
      </div>

      {/* Send history — full log grouped by year → month, collapsible, lazy-loaded */}
      <AdminModal
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        title={t('admin.outreach.historyTitle', 'Send history')}
        titleIcon={History}
        size="md"
      >
        {historyLoading && history.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={22} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
          </div>
        ) : groupedHistory.length === 0 ? (
          <p className="text-[13px] italic text-center py-8" style={{ color: 'var(--color-text-muted)' }}>
            {t('admin.outreach.noRecent', 'No outreach sent yet.')}
          </p>
        ) : (
          <div className="space-y-5">
            {groupedHistory.map((y) => (
              <div key={y.year}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[13px] font-extrabold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>{y.year}</span>
                  <span className="flex-1 h-px" style={{ background: 'var(--color-border-subtle)' }} />
                </div>
                <div className="space-y-2">
                  {y.months.map((mo) => {
                    const open = isMonthOpen(mo.key);
                    const recipTotal = mo.items.reduce((s, r) => s + (r.details?.recipientCount || 0), 0);
                    return (
                      <div key={mo.key} className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border-subtle)' }}>
                        <button
                          type="button"
                          onClick={() => toggleMonth(mo.key)}
                          className="w-full flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--color-bg-hover)]"
                          style={{ background: 'var(--color-bg-deep)' }}
                        >
                          <span className="text-[13px] font-bold capitalize" style={{ color: 'var(--color-text-primary)' }}>
                            {new Date(mo.year, mo.monthIdx, 1).toLocaleDateString(i18n.language, { month: 'long' })}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="text-[10.5px]" style={{ color: 'var(--color-text-muted)' }}>
                              {t('admin.outreach.historyMonthMeta', { sends: mo.items.length, recipients: recipTotal, defaultValue: '{{sends}} sends · {{recipients}} recipients' })}
                            </span>
                            <ChevronDown size={15} className="transition-transform" style={{ color: 'var(--color-text-muted)', transform: open ? 'rotate(180deg)' : 'none' }} />
                          </span>
                        </button>
                        {open && (
                          <div className="px-3 py-2.5 space-y-2.5" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                            {mo.items.map((row) => <SendRow key={row.id} row={row} t={t} />)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminModal>

      {/* ══ La campaña en curso ══════════════════════════════════════════
          Existe para decir una cosa: esto ya no depende de esta pestaña. */}
      {activeJobId && jobProgress && (
        <FadeIn>
          <AdminCard className="mt-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <p className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                  {jobProgress.status === 'done'
                    ? t('admin.outreach.jobDone', 'Campaña terminada')
                    : jobProgress.status === 'cancelled'
                      ? t('admin.outreach.jobCancelled', 'Campaña cancelada')
                      : t('admin.outreach.jobRunning', 'Enviando…')}
                </p>
                <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.outreach.jobCounts', {
                    sent: jobProgress.sent, total: jobProgress.total,
                    failed: jobProgress.failed, skipped: jobProgress.skipped,
                    defaultValue: '{{sent}} de {{total}} · {{failed}} fallidos · {{skipped}} omitidos',
                  })}
                </p>
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-deep)' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.round(((jobProgress.total - jobProgress.remaining) / Math.max(1, jobProgress.total)) * 100)}%`,
                      background: 'var(--color-accent)',
                      transition: 'width 400ms ease',
                    }}
                  />
                </div>
              </div>
              {(jobProgress.status === 'queued' || jobProgress.status === 'running') ? (
                <button
                  type="button"
                  onClick={async () => {
                    try { await cancelOutreachJob(activeJobId); }
                    catch (e) { showToast(e.message || 'Failed', 'error'); }
                  }}
                  className="px-3 py-2 rounded-[9px] text-[12px] font-bold min-h-[40px]"
                  style={{ color: 'var(--color-danger)', border: '1px solid var(--color-border-subtle)' }}
                >
                  {t('admin.outreach.jobCancel', 'Detener')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveJobId(null)}
                  className="px-3 py-2 rounded-[9px] text-[12px] font-bold min-h-[40px]"
                  style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-subtle)' }}
                >
                  {t('common.close', 'Cerrar')}
                </button>
              )}
            </div>
            {/* Lo único que de verdad importa saber. */}
            {(jobProgress.status === 'queued' || jobProgress.status === 'running') && (
              <p className="mt-2 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.outreach.jobSafeToLeave', 'Sigue en el servidor. Puedes cerrar esta página.')}
              </p>
            )}
          </AdminCard>
        </FadeIn>
      )}

      {pickerOpen && (
        <OutreachTemplatePicker
          gymId={gymId}
          gymName={gymName}
          primaryColor={readBrandColors().primary || '#D4AF37'}
          onPick={applyPicked}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </AdminPageShell>
  );
}
