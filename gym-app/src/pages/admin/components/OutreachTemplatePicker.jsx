import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { X, Search, Sparkles, FileText, Zap } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { dbRowToTemplate } from '../../../lib/admin/emailTemplateRenderer';
import { templateExcerpt } from '../../../lib/admin/emailExcerpt';
import { getPrebuiltTemplates } from './emailTemplatePrebuilts';
import { DESIGNER_CAMPAIGNS } from '../../../lib/admin/emailDesignerTemplates';
import { getEmailTemplates } from '../../../lib/adminMessageTemplates';

/**
 * Escoger una plantilla SIN salir del compositor.
 *
 * El problema que resuelve: había cuatro catálogos y desde aquí solo se veía el
 * más pobre —tres frases enlatadas—. Las tuyas, las doce prefabricadas y los
 * catorce diseños solo se alcanzaban yendo a /admin/email-templates, buscándolas
 * y pulsando un avión de papel que te devolvía aquí con `?template=<id>`.
 * Componer y escoger vivían en páginas distintas, en el orden equivocado.
 *
 * Y el paseo tenía un coste escondido peor: el prellenado APLANABA la plantilla
 * a asunto + texto plano, tirando maqueta, recompensa con su QR, botón, pie y
 * portada. Aquí no: una plantilla de bloques se entrega renderizada entera.
 */
const SOURCES = ['mine', 'prebuilt', 'design', 'quick'];

function SourceTab({ active, count, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-[9px] text-[12px] font-bold whitespace-nowrap"
      style={{
        color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
        background: active ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent',
        border: `${active ? 2 : 1}px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
      }}
    >
      {label}{count != null ? <span className="ml-1.5 opacity-60">{count}</span> : null}
    </button>
  );
}

// `icon` llega YA RENDERIZADO. `no-unused-vars` no exime a los parámetros en
// mayúscula —solo a las variables—, así que `icon: Icon` da un falso positivo
// aunque el JSX lo use. Mismo apaño que `ExtraChip` en el editor.
function Row({ title, note, excerpt, icon, onPick, cta }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="w-full text-left rounded-xl p-3 flex items-start gap-3 transition-colors hover:bg-[var(--color-bg-hover)]"
      style={{ border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-card)' }}
    >
      <div
        className="grid place-items-center flex-shrink-0"
        style={{ width: 34, height: 34, borderRadius: 10, background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{title}</div>
        {note && <div className="truncate text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{note}</div>}
        {/* El extracto es lo que permite reconocerla sin abrirla. */}
        {excerpt && (
          <div
            className="text-[11.5px] mt-1"
            style={{
              color: 'var(--color-text-muted)', lineHeight: 1.35,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}
          >
            {excerpt}
          </div>
        )}
      </div>
      <span
        className="flex-shrink-0 text-[11.5px] font-bold px-2.5 py-1.5 rounded-[8px] mt-0.5"
        style={{ color: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
      >
        {cta}
      </span>
    </button>
  );
}

export default function OutreachTemplatePicker({ gymId, gymName, primaryColor, onPick, onClose }) {
  const { t, i18n } = useTranslation('pages');
  const lang = i18n.language?.startsWith('es') ? 'es' : 'en';
  useScrollLock(true);

  const [source, setSource] = useState('mine');
  const [q, setQ] = useState('');

  // Las tuyas. `dbRowToTemplate` es el mismo hidratador que usa el editor, así
  // que lo que se escoge aquí es exactamente la plantilla que guardaste.
  const { data: mine = [], isLoading } = useQuery({
    queryKey: ['outreach-gym-templates', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_email_templates')
        .select('id, name, template_type, template_data, step_key, auto_enabled, is_prebuilt, created_at, updated_at')
        .eq('gym_id', gymId)
        .order('updated_at', { ascending: false });
      return (data || []).map(dbRowToTemplate);
    },
    enabled: !!gymId,
    staleTime: 60_000,
  });

  const prebuilt = useMemo(() => getPrebuiltTemplates(gymName, primaryColor, t), [gymName, primaryColor, t]);
  const quick = useMemo(() => getEmailTemplates(t, '{{first_name}}'), [t]);
  const designs = useMemo(
    () => DESIGNER_CAMPAIGNS.flatMap((c) => c.items.map((i) => ({
      id: i.id, label: i.label[lang] || i.id, campaign: c.title[lang] || c.id,
    }))),
    [lang],
  );

  const match = (s) => !q.trim() || String(s || '').toLowerCase().includes(q.trim().toLowerCase());

  const counts = { mine: mine.length, prebuilt: prebuilt.length, design: designs.length, quick: quick.length };
  const tabLabel = {
    mine: t('admin.outreach.tplMine', 'Mis plantillas'),
    prebuilt: t('admin.outreach.tplPrebuilt', 'Prediseñadas'),
    design: t('admin.outreach.tplDesign', 'Diseños'),
    quick: t('admin.outreach.tplQuick', 'Frases rápidas'),
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
      <div
        className="w-full sm:max-w-[620px] max-h-[86vh] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <h3 className="flex-1 text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {t('admin.outreach.pickTemplate', 'Escoger una plantilla')}
          </h3>
          <button type="button" onClick={onClose} aria-label={t('common.close', 'Close')} className="p-2 rounded-lg">
            <X size={18} style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        </div>

        <div className="px-4 pt-3 pb-2 flex-shrink-0 space-y-2.5">
          <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
            <Search size={14} style={{ color: 'var(--color-text-muted)' }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('admin.outreach.tplSearch', 'Buscar por nombre o texto')}
              className="flex-1 bg-transparent outline-none text-[13px]"
              style={{ color: 'var(--color-text-primary)' }}
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {SOURCES.map((s) => (
              <SourceTab key={s} label={tabLabel[s]} count={counts[s]} active={source === s} onClick={() => setSource(s)} />
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
          {source === 'mine' && (
            isLoading
              ? <p className="text-[12.5px] py-6 text-center" style={{ color: 'var(--color-text-muted)' }}>…</p>
              : mine.filter((x) => match(x.name) || match(x.body?.text)).length === 0
                ? (
                  <p className="text-[12.5px] py-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.outreach.tplNoneMine', 'Todavía no has guardado ninguna. Las prediseñadas de al lado se pueden usar tal cual.')}
                  </p>
                )
                : mine.filter((x) => match(x.name) || match(x.body?.text)).map((tpl) => {
                  const x = templateExcerpt(tpl, { gymName, name: tpl.name });
                  return (
                    <Row
                      key={tpl.id}
                      icon={tpl.designer_id ? <Sparkles size={15} style={{ color: 'var(--color-accent)' }} /> : <FileText size={15} style={{ color: 'var(--color-accent)' }} />}
                      title={tpl.name || t('admin.emailTemplates.untitled', 'Sin título')}
                      note={tpl.auto_enabled && tpl.step_key ? t('admin.outreach.tplAuto', 'Se envía sola en un momento automático') : ''}
                      excerpt={[x.title, x.body].filter(Boolean).join(' — ')}
                      cta={t('admin.outreach.tplUse', 'Usar')}
                      onPick={() => onPick({ kind: 'template', template: tpl })}
                    />
                  );
                })
          )}

          {source === 'prebuilt' && prebuilt.filter((x) => match(x.name) || match(x.body?.text)).map((tpl) => {
            const x = templateExcerpt(tpl, { gymName, name: tpl.name });
            return (
              <Row
                key={tpl.id}
                icon={<FileText size={15} style={{ color: 'var(--color-accent)' }} />}
                title={tpl.name}
                excerpt={[x.title, x.body].filter(Boolean).join(' — ')}
                cta={t('admin.outreach.tplUse', 'Usar')}
                onPick={() => onPick({ kind: 'template', template: tpl })}
              />
            );
          })}

          {source === 'design' && designs.filter((d) => match(d.label) || match(d.campaign)).map((d) => (
            <Row
              key={d.id}
              icon={<Sparkles size={15} style={{ color: 'var(--color-accent)' }} />}
              title={d.label}
              note={d.campaign}
              cta={t('admin.outreach.tplUse', 'Usar')}
              onPick={() => onPick({ kind: 'design', id: d.id })}
            />
          ))}

          {source === 'quick' && (
            <>
              <p className="text-[11.5px] pb-1" style={{ color: 'var(--color-text-muted)' }}>
                {/* Honestidad sobre qué son: texto suelto, no un correo maquetado. */}
                {t('admin.outreach.tplQuickHint', 'Texto suelto, sin maqueta. Sirve igual para push, SMS y notificación.')}
              </p>
              {quick.filter((x) => match(x.label) || match(x.body)).map((tpl) => (
                <Row
                  key={tpl.key}
                  icon={<Zap size={15} style={{ color: 'var(--color-accent)' }} />}
                  title={tpl.label}
                  excerpt={tpl.body}
                  cta={t('admin.outreach.tplUse', 'Usar')}
                  onPick={() => onPick({ kind: 'quick', template: tpl })}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
