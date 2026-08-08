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
/**
 * Tarjeta de plantilla, con la forma de las de ejercicio del lado miembro
 * (ExerciseTile): 4:5, dos por fila, el contenido a sangre y el nombre encima
 * de un degradado abajo.
 *
 * Allí el "medio" es el vídeo del ejercicio. Aquí no hay imagen, así que el
 * medio es LA VISTA PREVIA DEL MENSAJE: asunto y cuerpo maquetados en pequeño,
 * como asomarse al correo. Es lo que la lista anterior no daba — dos líneas de
 * extracto no dejan reconocer una plantilla de un vistazo, y había que abrirla
 * para saber si era la que buscabas.
 */
function Tile({ title, note, subject, body, icon, onPick, cta }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="group relative text-left overflow-hidden transition-transform active:scale-[0.98] flex flex-col"
      style={{
        borderRadius: 16,
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)',
      }}
    >
      {/* La hoja: el mensaje en pequeño. Altura FIJA, no proporción — las de
          ejercicio pueden ser 4:5 porque el vídeo llena la caja; aquí el
          contenido es texto de largo variable y una caja alta dejaba medio
          naipe vacío. `pointer-events-none` porque quien recibe el clic es la
          tarjeta entera, no el texto de dentro. */}
      <div className="relative p-3 pointer-events-none flex-shrink-0" style={{ height: 148, background: 'var(--color-bg-deep)' }}>
        <div className="flex items-center gap-1.5 mb-2">
          <span className="grid place-items-center flex-shrink-0"
            style={{ width: 22, height: 22, borderRadius: 7, background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}>
            {icon}
          </span>
          {note && (
            <span className="truncate text-[9.5px] font-bold uppercase tracking-[0.06em]" style={{ color: 'var(--color-text-muted)' }}>
              {note}
            </span>
          )}
        </div>
        {subject && (
          <p className="text-[11.5px] font-bold mb-1" style={{
            color: 'var(--color-text-primary)', lineHeight: 1.25,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {subject}
          </p>
        )}
        {body && (
          <p className="text-[10.5px]" style={{
            color: 'var(--color-text-muted)', lineHeight: 1.45,
            display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {body}
          </p>
        )}
        {!subject && !body && (
          <p className="text-[10.5px]" style={{ color: 'var(--color-text-faint)' }}>{note}</p>
        )}
        {/* Difuminado al pie de la hoja: dice «sigue» sin cortar una letra por
            la mitad, que es lo que hace un overflow a secas. */}
        <span className="absolute inset-x-0 bottom-0 pointer-events-none" style={{
          height: 26,
          background: 'linear-gradient(to top, var(--color-bg-deep), transparent)',
        }} />
      </div>

      {/* Pie: el nombre, sobre el fondo de la tarjeta. En las de ejercicio el
          nombre va encima de la imagen con un degradado porque no hay otro
          sitio; aquí sí lo hay, y separado se lee mejor. */}
      <div className="px-3 py-2.5 flex-1 min-h-0">
        <p style={{
          color: 'var(--color-text-primary)', fontWeight: 800, fontSize: 12.5, lineHeight: 1.16,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {title}
        </p>
      </div>

      {/* «Usar» aparece al pasar por encima. En táctil no hay hover, así que se
          queda visible: si no, la tarjeta no diría en ninguna parte qué hace. */}
      <span
        className="absolute top-2.5 right-2.5 text-[10.5px] font-bold px-2 py-1 rounded-[7px] opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus:opacity-100 transition-opacity"
        style={{ color: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)' }}
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
                : (
                  <div className="grid grid-cols-2 gap-3">
                    {mine.filter((x) => match(x.name) || match(x.body?.text)).map((tpl) => {
                      const x = templateExcerpt(tpl, { gymName, name: tpl.name });
                      return (
                        <Tile
                          key={tpl.id}
                          icon={tpl.designer_id ? <Sparkles size={13} style={{ color: 'var(--color-accent)' }} /> : <FileText size={13} style={{ color: 'var(--color-accent)' }} />}
                          title={tpl.name || t('admin.emailTemplates.untitled', 'Sin título')}
                          note={tpl.auto_enabled && tpl.step_key ? t('admin.outreach.tplAutoShort', 'Automática') : ''}
                          subject={x.title}
                          body={x.body}
                          cta={t('admin.outreach.tplUse', 'Usar')}
                          onPick={() => onPick({ kind: 'template', template: tpl })}
                        />
                      );
                    })}
                  </div>
                )
          )}

          {source === 'prebuilt' && (
            <div className="grid grid-cols-2 gap-3">
              {prebuilt.filter((x) => match(x.name) || match(x.body?.text)).map((tpl) => {
                const x = templateExcerpt(tpl, { gymName, name: tpl.name });
                return (
                  <Tile
                    key={tpl.id}
                    icon={<FileText size={13} style={{ color: 'var(--color-accent)' }} />}
                    title={tpl.name}
                    subject={x.title}
                    body={x.body}
                    cta={t('admin.outreach.tplUse', 'Usar')}
                    onPick={() => onPick({ kind: 'template', template: tpl })}
                  />
                );
              })}
            </div>
          )}

          {source === 'design' && (
            <div className="grid grid-cols-2 gap-3">
              {designs.filter((d) => match(d.label) || match(d.campaign)).map((d) => (
                // Los diseños no traen texto: son maquetas. La tarjeta enseña la
                // campaña a la que pertenecen, que es lo único que las distingue
                // sin abrirlas.
                <Tile
                  key={d.id}
                  icon={<Sparkles size={13} style={{ color: 'var(--color-accent)' }} />}
                  title={d.label}
                  note={d.campaign}
                  cta={t('admin.outreach.tplUse', 'Usar')}
                  onPick={() => onPick({ kind: 'design', id: d.id })}
                />
              ))}
            </div>
          )}

          {source === 'quick' && (
            <>
              <p className="text-[11.5px] pb-1" style={{ color: 'var(--color-text-muted)' }}>
                {/* Honestidad sobre qué son: texto suelto, no un correo maquetado. */}
                {t('admin.outreach.tplQuickHint', 'Texto suelto, sin maqueta. Sirve igual para push, SMS y notificación.')}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {quick.filter((x) => match(x.label) || match(x.body)).map((tpl) => (
                  // Sin asunto: una frase rápida es solo cuerpo. Va al hueco del
                  // cuerpo para que la vista previa enseñe el texto entero que se
                  // va a enviar, no un asunto inventado.
                  <Tile
                    key={tpl.key}
                    icon={<Zap size={13} style={{ color: 'var(--color-accent)' }} />}
                    title={tpl.label}
                    body={tpl.body}
                    cta={t('admin.outreach.tplUse', 'Usar')}
                    onPick={() => onPick({ kind: 'quick', template: tpl })}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
