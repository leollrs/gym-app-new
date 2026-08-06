import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Mail, Gift, CheckCircle2, AlertTriangle, Clock, Send, Inbox, ShieldAlert, Power } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { selectAllRows } from '../../../lib/churn/batchedSelect';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { AdminCard, Skeleton, ErrorCard } from '../../../components/admin';
import { stepLabel } from '../../../lib/admin/emailAutoSteps';
// `readResult` mira el error ANTES que los datos y marca el resultado como
// ilegible en vez de devolver []. Es la diferencia entre «no hay regalos» y
// «no puedo leer la tabla», que esta pantalla pintaba igual.
// Cubierto por src/lib/__tests__/panelData.test.js.
import { readResult, panelState } from '../../../lib/admin/panelData';

const DISPLAY_FONT = 'var(--admin-font-display, "Archivo", system-ui, sans-serif)';
const WINDOW_DAYS = 30;

/**
 * Qué está pasando de verdad con el correo — y, cuando no está pasando nada,
 * POR QUÉ.
 *
 * ESTA PANTALLA MENTÍA, Y DE TRES FORMAS DISTINTAS:
 *
 *   1. Contaba solo `automated_email_log`, que escribe únicamente
 *      send-automated-email. Las campañas de Outreach viven en
 *      `admin_audit_log`. El rótulo decía «Correos enviados» a secas, así que un
 *      gimnasio que acababa de mandar cuatrocientos correos a mano leía «0» y
 *      entendía «de aquí no ha salido nada nunca».
 *
 *   2. La consulta de regalos hacía `if (error) return []`. Con la vista de la
 *      0694 sin aplicar, «no puedo leerlo» y «no hay ninguno» se pintaban
 *      exactamente igual: un cero.
 *
 *   3. Un cero no distinguía «no se ha disparado» de «se disparó y se descartó
 *      todo». send-automated-email sale por `no_template`, `opted_out`,
 *      `no_address` y `duplicate` ANTES de escribir su fila, así que una
 *      automatización rota da el mismo cero que una apagada.
 *
 * La regla de esta pantalla es que ningún número pueda significar dos cosas.
 * Cuando algo no se puede leer, se dice. Y lo primero que se enseña es si hay
 * alguna automatización encendida, porque cuando la respuesta es «ninguna», ese
 * es el dato — no el cero.
 */
export default function EmailCampaignsTab({ gymId }) {
  const { t } = useTranslation('pages');

  // Inicializador perezoso de useState y NO useMemo: `Date.now()` es impuro y
  // llamarlo durante el render rompe la regla de pureza de React (y el lint lo
  // marca). Así se evalúa una sola vez, al montar, que es justo lo que quiere
  // decir "los últimos 30 días" para esta pantalla.
  const [since] = useState(() => new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString());

  // ── Lo primero: ¿hay algo encendido? ──
  //
  // Sin esto, el resto de la pantalla son ceros sin explicación. `auto_enabled`
  // nace en FALSE (0687), así que lo normal en un gimnasio nuevo es que no haya
  // ninguna — y eso hay que DECIRLO, no dejarlo deducir.
  const { data: autos, isLoading: loadingAutos } = useQuery({
    queryKey: [...adminKeys.emailTemplates(gymId), 'automations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_email_templates')
        .select('id, name, step_key')
        .eq('gym_id', gymId)
        .eq('auto_enabled', true)
        .not('step_key', 'is', null);
      return readResult(error, data);
    },
    enabled: !!gymId,
    staleTime: 60_000,
  });

  const { data: sends = [], isLoading: loadingSends, error: sendsError, refetch } = useQuery({
    queryKey: [...adminKeys.emailTemplates(gymId), 'campaign-sends', WINDOW_DAYS],
    queryFn: async () => {
      // Paginado y con orden TOTAL. `created_at` solo no desempata: el cron
      // dispara los envíos de una tanda en el mismo instante, así que sin `id`
      // detrás las filas empatadas cambian de sitio entre páginas y los
      // conteos salen mal justo en los gimnasios con más envíos.
      const { data, error } = await selectAllRows((from, to) => supabase
        .from('automated_email_log')
        .select('scope, step_key, status, created_at')
        .eq('gym_id', gymId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to));
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 60_000,
  });

  // ── Lo que salió A MANO ──
  //
  // Vive en otra tabla porque lo dispara una persona, no un cron. Juntarlo en el
  // mismo número que lo automático volvería a hacer imposible responder «¿por
  // qué no sale mi automatización?», que es la pregunta de esta pantalla.
  const { data: manual, isLoading: loadingManual } = useQuery({
    queryKey: [...adminKeys.emailTemplates(gymId), 'manual-sends', WINDOW_DAYS],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_audit_log')
        .select('id, created_at, details')
        .eq('gym_id', gymId)
        .in('action', ['outreach_send', 'outreach_enqueue'])
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) return { campaigns: 0, recipients: 0, last: null, unavailable: true };
      const rows = data || [];
      return {
        campaigns: rows.length,
        recipients: rows.reduce((n, r) => n + Number(r.details?.recipientCount || 0), 0),
        last: rows[0]?.created_at || null,
        unavailable: false,
      };
    },
    enabled: !!gymId,
    staleTime: 60_000,
  });

  // ── Lo que pasó DESPUÉS de que Resend aceptara ──
  //
  // «Enviado» solo significa que el proveedor aceptó el payload. El rebote llega
  // minutos después por el webhook (0700). Mientras esa migración y esa función
  // no estén desplegadas, aquí no hay datos — y se dice, en vez de pintar ceros
  // que parecerían «no ha rebotado nada».
  const { data: delivery, isLoading: loadingDelivery } = useQuery({
    queryKey: [...adminKeys.emailTemplates(gymId), 'deliverability'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_deliverability_30d')
        .select('delivered, bounced, bounced_hard, complained, last_event_at')
        .eq('gym_id', gymId)
        .maybeSingle();
      if (error) return { row: null, unavailable: true };
      return { row: data, unavailable: false };
    },
    enabled: !!gymId,
    staleTime: 60_000,
  });

  const { data: rewards, isLoading: loadingRewards } = useQuery({
    queryKey: [...adminKeys.emailTemplates(gymId), 'campaign-rewards'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_campaign_rewards_summary')
        .select('*')
        .eq('gym_id', gymId)
        .order('last_granted_at', { ascending: false });
      // La vista llega con la 0694. Sin ella NO se devuelve una lista vacía:
      // eso pintaba «0 regalos» cuando la verdad era «no puedo leerlo».
      return readResult(error, data);
    },
    enabled: !!gymId,
    staleTime: 60_000,
  });

  // PostgREST no agrupa, así que se tallan aquí. El volumen está acotado por
  // la ventana de 30 días.
  const byStep = useMemo(() => {
    const map = new Map();
    for (const row of sends) {
      const key = row.step_key || row.scope || '—';
      const e = map.get(key) || { key, sent: 0, failed: 0, claimed: 0, last: null };
      if (row.status === 'sent') e.sent++;
      else if (row.status === 'failed') e.failed++;
      else e.claimed++;
      if (!e.last || row.created_at > e.last) e.last = row.created_at;
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => (b.last || '').localeCompare(a.last || ''));
  }, [sends]);

  // El `|| []` va DENTRO del useMemo. Fuera creaba un array nuevo en cada
  // render, así que la dependencia cambiaba siempre y el memo no memorizaba
  // nada — el aviso de react-hooks tenía razón.
  const rewardRows = useMemo(() => rewards?.rows || [], [rewards]);
  const totals = useMemo(() => ({
    sent: byStep.reduce((n, s) => n + s.sent, 0),
    failed: byStep.reduce((n, s) => n + s.failed, 0),
    granted: rewardRows.reduce((n, r) => n + Number(r.granted_count || 0), 0),
    redeemed: rewardRows.reduce((n, r) => n + Number(r.redeemed_count || 0), 0),
  }), [byStep, rewardRows]);

  const fmt = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  };

  if (loadingSends || loadingRewards || loadingAutos || loadingManual || loadingDelivery) {
    return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-[80px] rounded-[14px]" />)}</div>;
  }
  if (sendsError) {
    return <ErrorCard message={t('admin.emailTemplates.campaignsFailed', 'Could not load campaign activity')} onRetry={refetch} />;
  }

  const autoRows = autos?.rows || [];
  const del = delivery?.row;

  return (
    <div className="space-y-5">
      <p className="text-[12.5px]" style={{ color: 'var(--color-text-muted)' }}>
        {t('admin.emailTemplates.campaignsIntro', 'Automatic email and gifts over the last {{days}} days.', { days: WINDOW_DAYS })}
      </p>

      {/* ── Lo primero, porque cuando no hay nada encendido ESE es el dato ── */}
      <AdminCard>
        <p className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-admin-text-muted)' }}>
          <Power size={12} /> {t('admin.emailTemplates.automationsOn', 'Automations switched on')}
        </p>
        {panelState(autos) === 'unavailable' ? (
          <Unavailable text={t('admin.emailTemplates.cantRead', 'Could not read this. It is not a zero — the data is unavailable.')} />
        ) : panelState(autos) === 'empty' ? (
          <EmptyNote text={t(
            'admin.emailTemplates.noAutomations',
            'No automation is switched on, so no automatic email can go out. Assign a template to a moment and switch it on.',
          )} />
        ) : (
          <div className="flex flex-wrap gap-2">
            {autoRows.map(a => (
              <span key={a.id} className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
                style={{ background: 'var(--color-admin-panel)', color: 'var(--color-admin-text)' }}>
                {stepLabel(t, a.step_key)} · {a.name}
              </span>
            ))}
          </div>
        )}
      </AdminCard>

      {/* ── Automático vs manual, SEPARADOS y rotulados ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={<Mail size={15} style={{ color: 'var(--color-accent)' }} />}
          value={totals.sent}
          label={t('admin.emailTemplates.statSentAuto', 'Sent automatically')}
        />
        <StatTile
          icon={<AlertTriangle size={15} style={{ color: 'var(--color-danger)' }} />}
          value={totals.failed}
          label={t('admin.emailTemplates.statFailed', 'Failed')}
        />
        <StatTile
          icon={<Send size={15} style={{ color: 'var(--color-accent)' }} />}
          value={manual?.unavailable ? '—' : manual?.recipients ?? 0}
          label={t('admin.emailTemplates.statSentManual', 'Sent by hand')}
          note={manual?.unavailable
            ? t('admin.emailTemplates.cantReadShort', 'unavailable')
            : t('admin.emailTemplates.acrossCampaigns', '{{count}} campaigns', { count: manual?.campaigns ?? 0 })}
        />
        <StatTile
          icon={<Gift size={15} style={{ color: 'var(--color-accent)' }} />}
          value={rewards?.unavailable ? '—' : totals.granted}
          label={t('admin.emailTemplates.statGranted', 'Gifts sent')}
          note={rewards?.unavailable ? t('admin.emailTemplates.cantReadShort', 'unavailable') : null}
        />
      </div>

      {/* ── Lo que pasó después de «enviado» ── */}
      <AdminCard>
        <p className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-admin-text-muted)' }}>
          <Inbox size={12} /> {t('admin.emailTemplates.deliverability', 'Actually delivered')}
        </p>
        {delivery?.unavailable ? (
          <Unavailable text={t(
            'admin.emailTemplates.deliveryUnavailable',
            'Bounce tracking is not live yet. Until the Resend webhook is deployed, "sent" only means the provider accepted it.',
          )} />
        ) : !del ? (
          <EmptyNote text={t('admin.emailTemplates.noDeliveryYet', 'No delivery events yet.')} />
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <MiniStat value={del.delivered ?? 0} label={t('admin.emailTemplates.statDelivered', 'Delivered')} tone="var(--color-success-ink)" />
            <MiniStat value={del.bounced_hard ?? 0} label={t('admin.emailTemplates.statBounced', 'Hard bounces')} tone="var(--color-danger)" />
            <MiniStat value={del.complained ?? 0} label={t('admin.emailTemplates.statComplained', 'Spam complaints')} tone="var(--color-danger)" />
          </div>
        )}
        {del && Number(del.complained || 0) > 0 && (
          <p className="mt-3 flex items-start gap-1.5 text-[11.5px]" style={{ color: 'var(--color-danger)' }}>
            <ShieldAlert size={13} className="mt-px flex-shrink-0" />
            {t(
              'admin.emailTemplates.complaintWarning',
              'Spam complaints hurt the sending domain shared by every gym. Keep them under 0.3% of delivered mail.',
            )}
          </p>
        )}
      </AdminCard>

      <AdminCard>
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-admin-text-muted)' }}>
          {t('admin.emailTemplates.byMoment', 'By moment')}
        </p>
        {byStep.length === 0 ? (
          <EmptyNote text={autoRows.length === 0
            // Dos vacíos distintos: «no hay nada encendido» y «está encendido y
            // aun así no ha salido nada», que es una avería y no un estado.
            ? t('admin.emailTemplates.noSends', 'No automatic email has gone out yet. Assign a template to a moment and switch it on.')
            : t('admin.emailTemplates.onButSilent', 'Switched on, but nothing has gone out yet. Nobody has hit these moments — or the send is being dropped before it is recorded.')} />
        ) : (
          <div className="space-y-2">
            {byStep.map(s => (
              <div key={s.key} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: 'var(--color-admin-panel)' }}>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold" style={{ color: 'var(--color-admin-text)' }}>
                    {stepLabel(t, s.key)}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                    <Clock size={10} /> {fmt(s.last)}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3 text-[12.5px] font-bold">
                  <span style={{ color: 'var(--color-admin-text)' }}>{s.sent}</span>
                  {s.failed > 0 && <span style={{ color: 'var(--color-danger)' }}>{s.failed} ✕</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      <AdminCard>
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-admin-text-muted)' }}>
          {t('admin.emailTemplates.giftsByTemplate', 'Gifts by template')}
        </p>
        {panelState(rewards) === 'unavailable' ? (
          <Unavailable text={t('admin.emailTemplates.cantRead', 'Could not read this. It is not a zero — the data is unavailable.')} />
        ) : panelState(rewards) === 'empty' ? (
          <EmptyNote text={t('admin.emailTemplates.noGifts', 'No gifts have gone out. Turn on the Reward block in a template to start sending them.')} />
        ) : (
          <div className="space-y-2">
            {rewardRows.map(r => {
              const granted = Number(r.granted_count || 0);
              const redeemed = Number(r.redeemed_count || 0);
              const pct = granted > 0 ? Math.round((redeemed / granted) * 100) : 0;
              return (
                <div key={r.template_id || 'none'} className="rounded-xl px-3 py-2.5" style={{ background: 'var(--color-admin-panel)' }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-bold" style={{ color: 'var(--color-admin-text)' }}>
                        {r.template_name || t('admin.emailTemplates.deletedTemplate', 'Deleted template')}
                      </div>
                      <div className="mt-0.5 text-[11.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                        {t('admin.emailTemplates.redeemedOf', '{{redeemed}} of {{granted}} redeemed', { redeemed, granted })}
                      </div>
                    </div>
                    <span className="flex-shrink-0 text-[15px] font-extrabold" style={{ color: pct > 0 ? 'var(--color-success-ink)' : 'var(--color-admin-text-muted)' }}>
                      {pct}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--color-admin-border)' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-accent)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AdminCard>
    </div>
  );
}

// Recibe el icono YA RENDERIZADO, no el componente. Pasarlo como componente
// (`{ icon: Icon }` y luego `<Icon />`) dispara un falso `no-unused-vars`:
// eslint no cuenta un nombre usado solo como etiqueta JSX. El repo ya arrastra
// tres de esos; no hacía falta un cuarto.
function StatTile({ icon, value, label, note }) {
  return (
    <AdminCard padding="p-3.5">
      {icon}
      <div className="mt-2 text-[22px] font-extrabold leading-none" style={{ fontFamily: DISPLAY_FONT, color: 'var(--color-admin-text)' }}>
        {value}
      </div>
      <div className="mt-1 text-[11.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>{label}</div>
      {note && <div className="mt-0.5 text-[10.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>{note}</div>}
    </AdminCard>
  );
}

function MiniStat({ value, label, tone }) {
  return (
    <div className="rounded-xl px-3 py-2.5 text-center" style={{ background: 'var(--color-admin-panel)' }}>
      <div className="text-[19px] font-extrabold leading-none" style={{ fontFamily: DISPLAY_FONT, color: tone }}>{value}</div>
      <div className="mt-1 text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>{label}</div>
    </div>
  );
}

function EmptyNote({ text }) {
  return (
    <p className="py-6 text-center text-[12.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>{text}</p>
  );
}

/**
 * «No lo puedo leer» NO es «no hay nada». Distinguirlo es el punto entero de
 * esta pantalla: un cero silencioso sobre una tabla que no existe es la mentira
 * más cara que puede contar un panel, porque parece un dato.
 */
function Unavailable({ text }) {
  return (
    <p className="flex items-start justify-center gap-1.5 py-6 text-center text-[12.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>
      <AlertTriangle size={13} className="mt-px flex-shrink-0" style={{ color: 'var(--color-danger)' }} />
      {text}
    </p>
  );
}
