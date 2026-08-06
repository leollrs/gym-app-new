/**
 * AdminSettingsPricing — precios y ofertas del gimnasio.
 *
 * POR QUÉ ESTO VIVE EN LA APP Y NO EN LA WEB
 *
 * La web de cada gimnasio se construye a mano, pero se alimenta de los datos que
 * el gimnasio ya mantiene aquí. Los precios eran el hueco: iban escritos dentro
 * de cada web, así que cambiar una tarifa significaba editar la web — y como eso
 * no lo hace el dueño, no se hacía. Un precio viejo en la web es el tipo de
 * error que le cuesta una llamada incómoda a alguien.
 *
 * PLANES Y OFERTAS SON COSAS DISTINTAS. Un plan es permanente; una oferta
 * caduca, y esa caducidad se filtra en el servidor (vista `gym_offers_public`)
 * para que la promo de agosto no siga puesta en diciembre.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { adminKeys } from '../../lib/adminQueryKeys';
import { FadeIn, CardSkeleton, AdminPageShell } from '../../components/admin';
import {
  TK, FK, Card, DIC, Ico, SettingsHeader, CardHd, Help, Fld, Toggle, TextField, SaveBar, fieldStyle,
} from './components/settingsKit';
import { centsToInput, inputToCents, formatMoney, offerLive } from '../../lib/admin/gymPricing';

const PERIODS = ['month', 'year', 'week', 'day', 'once'];
const CTA_KINDS = ['contact', 'trial', 'link'];

const blankPlan = (order) => ({
  _new: true, id: `new-${Math.random().toString(36).slice(2)}`,
  name: '', price_cents: null, currency: 'USD', period: 'month',
  description: '', features: [], is_featured: false, is_public: true, is_active: true,
  sort_order: order,
});

// Los nombres son los de `gym_offers` (mig 0185), que ya existía y que los
// miembros ven en MyGym. `title`/`title_es` y `valid_from`/`valid_until` no son
// caprichos: renombrarlos habría partido esa pantalla.
const blankOffer = (order) => ({
  _new: true, id: `new-${Math.random().toString(36).slice(2)}`,
  title: '', title_es: '', description: '', description_es: '', terms: '', terms_es: '',
  offer_type: 'custom', badge_label: '',
  price_cents: null, compare_at_cents: null, currency: 'USD',
  valid_from: '', valid_until: '', cta_kind: 'contact', cta_url: '',
  is_public: true, is_active: true, sort_order: order,
});

/** Fila plegable con su cabecera siempre visible. */
function Row({ title, subtitle, open, onToggleOpen, onDelete, published, onTogglePublished, children, t }) {
  return (
    <div style={{ border: `1px solid ${TK.borderSolid}`, borderRadius: 14, background: TK.surface2, marginTop: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px' }}>
        <button
          type="button"
          onClick={onToggleOpen}
          style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
        >
          <div style={{ fontFamily: FK.display, fontSize: 15, fontWeight: 800, color: TK.text, letterSpacing: -0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title || t('admin.pricing.untitled', 'Sin nombre')}
          </div>
          {subtitle && (
            <div style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textMute, marginTop: 3 }}>{subtitle}</div>
          )}
        </button>
        {/* Publicar es lo que decide si sale en la web, y es la acción que más
            se toca — por eso vive en la cabecera y no dentro del plegable. */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontFamily: FK.body, fontSize: 11.5, color: TK.textFaint }}>
            {t('admin.pricing.publish', 'En la web')}
          </span>
          <Toggle on={published} onClick={onTogglePublished} />
        </span>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('common.delete', 'Eliminar')}
          style={{ background: 'none', border: 0, cursor: 'pointer', padding: 6, flexShrink: 0 }}
        >
          <Ico ch={DIC.trash} size={16} color={TK.textFaint} stroke={2} />
        </button>
        <button type="button" onClick={onToggleOpen} aria-label={t('common.expand', 'Abrir')} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 6, flexShrink: 0 }}>
          <Ico ch={open ? DIC.chevU : DIC.chevD} size={16} color={TK.textFaint} stroke={2} />
        </button>
      </div>
      {open && <div style={{ padding: '2px 15px 16px', borderTop: `1px solid ${TK.borderSolid}` }}>{children}</div>}
    </div>
  );
}

const AddButton = ({ onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      marginTop: 12, width: '100%', padding: '12px 16px', borderRadius: 12, cursor: 'pointer',
      background: 'none', border: `1px dashed ${TK.borderSolid}`, color: TK.textSub,
      fontFamily: FK.body, fontSize: 13.5, fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44,
    }}
  >
    <Ico ch={DIC.plus} size={15} color={TK.textSub} stroke={2.2} /> {label}
  </button>
);

export default function AdminSettingsPricing() {
  const { profile, availableRoles } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('pages');
  const gymId = profile?.gym_id;
  const isAuthorized = profile && availableRoles.some(r => r === 'admin' || r === 'super_admin') && !!gymId;
  const lang = i18n.language?.startsWith('es') ? 'es' : 'en';

  // El borrador es NULL mientras no se toque nada, y entonces se lee lo cargado.
  //
  // Antes esto era estado espejo rellenado desde un `useEffect`, que además de
  // ser lo que la regla `set-state-in-effect` señala, tenía un fallo real:
  // después de guardar, el espejo se quedaba con lo viejo hasta que el efecto
  // volviera a correr. Derivándolo, `setDraft(null)` tras guardar vuelve a leer
  // lo que la base de datos acaba de confirmar.
  const [draft, setDraft] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { document.title = `${t('admin.pricing.title', 'Precios y ofertas')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  const { data, isLoading } = useQuery({
    queryKey: [...adminKeys.settings(gymId), 'pricing'],
    queryFn: async () => {
      const [p, o] = await Promise.all([
        supabase.from('gym_plans').select('*').eq('gym_id', gymId).order('sort_order'),
        supabase.from('gym_offers').select('*').eq('gym_id', gymId).order('sort_order'),
      ]);
      // `error` se comprueba SIEMPRE: el constructor de Supabase resuelve con
      // `{data, error}` y nunca lanza, así que un fallo de permisos llegaría
      // aquí como una lista vacía y parecería "todavía no hay precios".
      if (p.error) logger.error('gym_plans load failed', p.error);
      if (o.error) logger.error('gym_offers load failed', o.error);
      return { plans: p.data || [], offers: o.data || [] };
    },
    enabled: !!gymId,
  });

  // Lo cargado, normalizado. `''` y no `null` en las fechas porque un <input
  // type="date"> controlado con null se vuelve no controlado y React chilla.
  const base = useMemo(() => ({
    plans: (data?.plans || []).map(x => ({ ...x, features: x.features || [] })),
    offers: (data?.offers || []).map(x => ({ ...x, valid_from: x.valid_from || '', valid_until: x.valid_until || '' })),
    // Los ids borrados en pantalla. El borrado real ocurre al GUARDAR, para que
    // un "eliminar" sin querer se deshaga saliendo sin guardar.
    removed: { plans: [], offers: [] },
  }), [data]);

  const cur = draft || base;
  const { plans, offers, removed } = cur;
  const edit = (patch) => setDraft({ ...cur, ...patch });

  const setPlan = (id, patch) => edit({ plans: plans.map(x => (x.id === id ? { ...x, ...patch } : x)) });
  const setOffer = (id, patch) => edit({ offers: offers.map(x => (x.id === id ? { ...x, ...patch } : x)) });

  const dropPlan = (row) => edit({
    plans: plans.filter(x => x.id !== row.id),
    removed: row._new ? removed : { ...removed, plans: [...removed.plans, row.id] },
  });
  const dropOffer = (row) => edit({
    offers: offers.filter(x => x.id !== row.id),
    removed: row._new ? removed : { ...removed, offers: [...removed.offers, row.id] },
  });

  const money = (cents, currency) => formatMoney(cents, currency, lang, t('admin.pricing.onRequest', 'Consultar'));

  const periodLabel = (p) => t(`admin.pricing.period.${p}`, p);

  // Lo que la web vería HOY: mismo criterio que la vista `gym_offers_public`.
  // Se calcula aquí solo para avisar en pantalla — el filtro de verdad está en
  // el servidor, que es donde no se puede olvidar.
  const today = new Date().toISOString().slice(0, 10);
  const publishedPlans = plans.filter(p => p.is_public && p.is_active).length;
  const liveOffers = offers.filter(o => offerLive(o, today)).length;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const stripNew = (r, i) => {
        const { _new, id, ...rest } = r;
        return { ...(_new ? {} : { id }), ...rest, gym_id: gymId, sort_order: i };
      };

      if (removed.plans.length) {
        const { error } = await supabase.from('gym_plans').delete().in('id', removed.plans);
        if (error) throw error;
      }
      if (removed.offers.length) {
        const { error } = await supabase.from('gym_offers').delete().in('id', removed.offers);
        if (error) throw error;
      }

      if (plans.length) {
        const rows = plans.map((r, i) => ({
          ...stripNew(r, i),
          price_cents: r.price_cents,
          features: (r.features || []).filter(f => String(f).trim() !== ''),
        }));
        const { error } = await supabase.from('gym_plans').upsert(rows).select('id');
        if (error) throw error;
      }
      if (offers.length) {
        const rows = offers.map((r, i) => ({
          ...stripNew(r, i),
          // Cadena vacía NO es una fecha. Sin esto Postgres rechaza `''::date`
          // y el guardado entero falla por un campo que el admin dejó en blanco.
          valid_from: r.valid_from || null,
          valid_until: r.valid_until || null,
          cta_url: r.cta_kind === 'link' ? (r.cta_url || null) : null,
        }));
        const { error } = await supabase.from('gym_offers').upsert(rows).select('id');
        if (error) throw error;
      }

      await logAdminAction('gym_pricing_update', 'settings', gymId, {
        plans: plans.length, offers: offers.length,
        removed: removed.plans.length + removed.offers.length,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...adminKeys.settings(gymId), 'pricing'] });
      // Se suelta el borrador: a partir de aquí se lee lo que la base confirmó,
      // así que los ids reales de las filas nuevas entran solos.
      setDraft(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
      showToast(t('admin.pricing.savedToast', 'Precios guardados'), 'success');
    },
    onError: (e) => showToast(e?.message || t('common.error', 'Error'), 'error'),
  });

  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[14px] font-semibold" style={{ color: 'var(--color-danger, #EF4444)' }}>
          {t('admin.overview.accessDenied', 'Access denied. You are not authorized to view this page.')}
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <AdminPageShell className="space-y-4">
        <CardSkeleton h="h-[60px]" />
        <CardSkeleton h="h-[240px]" />
        <CardSkeleton h="h-[240px]" />
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell>
      <SettingsHeader
        t={t}
        title={t('admin.pricing.title', 'Precios y ofertas')}
        sub={t('admin.pricing.subtitle', 'Lo que cobras y lo que estás promocionando. Marcado «en la web» sale en tu página; lo demás se queda aquí.')}
      />

      {/* ══ Planes ══════════════════════════════════════════════ */}
      <FadeIn>
        <Card style={{ padding: '20px 22px', marginTop: 18 }}>
          <CardHd icon={DIC.dollar}>{t('admin.pricing.plansTitle', 'Planes')}</CardHd>
          <Help style={{ marginTop: 0 }}>
            {t('admin.pricing.plansHelp', 'Una fila por precio, como en la pizarra de recepción. Deja el precio en blanco para que diga «Consultar».')}
          </Help>

          {plans.map((p) => (
            <Row
              key={p.id}
              t={t}
              title={p.name}
              subtitle={`${money(p.price_cents, p.currency)} · ${periodLabel(p.period)}`}
              open={openId === p.id}
              onToggleOpen={() => setOpenId(openId === p.id ? null : p.id)}
              onDelete={() => dropPlan(p)}
              published={!!p.is_public}
              onTogglePublished={() => setPlan(p.id, { is_public: !p.is_public })}
            >
              <Fld>{t('admin.pricing.planName', 'Nombre')}</Fld>
              <TextField value={p.name} onChange={e => setPlan(p.id, { name: e.target.value })} placeholder={t('admin.pricing.planNamePh', 'Mensualidad')} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <Fld>{t('admin.pricing.price', 'Precio')}</Fld>
                  <TextField
                    inputMode="decimal"
                    value={centsToInput(p.price_cents)}
                    onChange={e => setPlan(p.id, { price_cents: inputToCents(e.target.value) })}
                    placeholder={t('admin.pricing.onRequest', 'Consultar')}
                  />
                </div>
                <div>
                  <Fld>{t('admin.pricing.periodLabel', 'Cada')}</Fld>
                  <select value={p.period} onChange={e => setPlan(p.id, { period: e.target.value })} style={{ ...fieldStyle, marginTop: 0 }}>
                    {PERIODS.map(k => <option key={k} value={k}>{periodLabel(k)}</option>)}
                  </select>
                </div>
              </div>

              <Fld>{t('admin.pricing.planDesc', 'Descripción')}</Fld>
              <TextField value={p.description || ''} onChange={e => setPlan(p.id, { description: e.target.value })} />

              <Fld>{t('admin.pricing.features', 'Qué incluye')}</Fld>
              <textarea
                value={(p.features || []).join('\n')}
                onChange={e => setPlan(p.id, { features: e.target.value.split('\n') })}
                rows={4}
                style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.5 }}
                placeholder={t('admin.pricing.featuresPh', 'Una por línea')}
              />
              <Help>{t('admin.pricing.featuresHelp', 'Una por línea. La web las maqueta como lista.')}</Help>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
                <Toggle on={!!p.is_featured} onClick={() => setPlan(p.id, { is_featured: !p.is_featured })} />
                <span style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textSub }}>
                  {t('admin.pricing.featured', 'Destacar este plan')}
                </span>
              </div>
            </Row>
          ))}

          <AddButton onClick={() => { const r = blankPlan(plans.length); edit({ plans: [...plans, r] }); setOpenId(r.id); }} label={t('admin.pricing.addPlan', 'Añadir plan')} />

          <Help style={{ marginTop: 14 }}>
            {t('admin.pricing.plansCount', { count: publishedPlans, defaultValue: '{{count}} plan(es) saldrían en la web.' })}
          </Help>
        </Card>
      </FadeIn>

      {/* ══ Ofertas ═════════════════════════════════════════════ */}
      <FadeIn>
        <Card style={{ padding: '20px 22px', marginTop: 16 }}>
          <CardHd icon={DIC.cal}>{t('admin.pricing.offersTitle', 'Ofertas')}</CardHd>
          <Help style={{ marginTop: 0 }}>
            {t('admin.pricing.offersHelp', 'Promociones con fecha. Al pasar la fecha de fin dejan de salir en la web solas — no hay que acordarse de quitarlas.')}
          </Help>

          {offers.map((o) => {
            const live = offerLive(o, today);
            return (
              <Row
                key={o.id}
                t={t}
                title={o.title_es || o.title}
                subtitle={[
                  o.price_cents != null ? money(o.price_cents, o.currency) : null,
                  o.valid_until ? t('admin.pricing.until', { date: o.valid_until, defaultValue: 'hasta {{date}}' }) : null,
                  !live && o.is_public ? t('admin.pricing.notLive', 'fuera de fecha — no sale') : null,
                ].filter(Boolean).join(' · ')}
                open={openId === o.id}
                onToggleOpen={() => setOpenId(openId === o.id ? null : o.id)}
                onDelete={() => dropOffer(o)}
                published={!!o.is_public}
                onTogglePublished={() => setOffer(o.id, { is_public: !o.is_public })}
              >
                {/* Los dos idiomas porque la app ya los usa: MyGym enseña
                    `title_es` y cae a `title`. Dejar uno vacío es válido. */}
                <Fld>{t('admin.pricing.headline', 'Titular (español)')}</Fld>
                <TextField value={o.title_es || ''} onChange={e => setOffer(o.id, { title_es: e.target.value })} placeholder={t('admin.pricing.headlinePh', 'Primer mes a mitad de precio')} />

                <Fld>{t('admin.pricing.headlineEn', 'Titular (inglés)')}</Fld>
                <TextField value={o.title || ''} onChange={e => setOffer(o.id, { title: e.target.value })} placeholder="First month half price" />

                <Fld>{t('admin.pricing.offerDesc', 'Descripción (español)')}</Fld>
                <TextField value={o.description_es || ''} onChange={e => setOffer(o.id, { description_es: e.target.value })} />

                <Fld>{t('admin.pricing.offerDescEn', 'Descripción (inglés)')}</Fld>
                <TextField value={o.description || ''} onChange={e => setOffer(o.id, { description: e.target.value })} />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <Fld>{t('admin.pricing.offerPrice', 'Precio de la oferta')}</Fld>
                    <TextField inputMode="decimal" value={centsToInput(o.price_cents)} onChange={e => setOffer(o.id, { price_cents: inputToCents(e.target.value) })} />
                  </div>
                  <div>
                    <Fld>{t('admin.pricing.compareAt', 'Precio normal (tachado)')}</Fld>
                    <TextField inputMode="decimal" value={centsToInput(o.compare_at_cents)} onChange={e => setOffer(o.id, { compare_at_cents: inputToCents(e.target.value) })} />
                  </div>
                  <div>
                    <Fld>{t('admin.pricing.startsAt', 'Empieza')}</Fld>
                    <TextField type="date" value={o.valid_from || ''} onChange={e => setOffer(o.id, { valid_from: e.target.value })} />
                  </div>
                  <div>
                    <Fld>{t('admin.pricing.endsAt', 'Termina')}</Fld>
                    <TextField type="date" value={o.valid_until || ''} onChange={e => setOffer(o.id, { valid_until: e.target.value })} />
                  </div>
                </div>
                <Help>{t('admin.pricing.datesHelp', 'Sin fechas, la oferta sale siempre mientras esté marcada «en la web».')}</Help>

                <Fld>{t('admin.pricing.terms', 'Letra pequeña')}</Fld>
                <TextField value={o.terms_es || ''} onChange={e => setOffer(o.id, { terms_es: e.target.value })} placeholder={t('admin.pricing.termsPh', 'Solo para nuevos socios')} />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <Fld>{t('admin.pricing.cta', 'Qué hace el botón')}</Fld>
                    <select value={o.cta_kind} onChange={e => setOffer(o.id, { cta_kind: e.target.value })} style={{ ...fieldStyle, marginTop: 0 }}>
                      {CTA_KINDS.map(k => <option key={k} value={k}>{t(`admin.pricing.ctaKind.${k}`, k)}</option>)}
                    </select>
                  </div>
                  {o.cta_kind === 'link' && (
                    <div>
                      <Fld>{t('admin.pricing.ctaUrl', 'Enlace')}</Fld>
                      <TextField value={o.cta_url || ''} onChange={e => setOffer(o.id, { cta_url: e.target.value })} placeholder="https://" />
                    </div>
                  )}
                </div>
              </Row>
            );
          })}

          <AddButton onClick={() => { const r = blankOffer(offers.length); edit({ offers: [...offers, r] }); setOpenId(r.id); }} label={t('admin.pricing.addOffer', 'Añadir oferta')} />

          <Help style={{ marginTop: 14 }}>
            {t('admin.pricing.offersCount', { count: liveOffers, defaultValue: '{{count}} oferta(s) están vigentes hoy.' })}
          </Help>
        </Card>
      </FadeIn>

      <SaveBar
        label={t('common.save', 'Guardar')}
        onClick={() => saveMutation.mutate()}
        saving={saveMutation.isPending}
        saved={saved}
        savingLabel={t('common.saving', 'Guardando…')}
        savedLabel={t('common.saved', 'Guardado')}
      />
    </AdminPageShell>
  );
}
