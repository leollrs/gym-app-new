import { Pencil, Copy, Trash2, Sparkles, Send, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AdminCard } from '../../../components/admin';
import { KindIconChip, KindPill } from './emailTemplateKinds';
import { templateExcerpt } from '../../../lib/admin/emailExcerpt';

const DISPLAY_FONT = 'var(--admin-font-display, "Archivo", system-ui, sans-serif)';

/**
 * Lo que la plantilla dice, bajo el nombre.
 *
 * Sin esto la lista era nombre + categoría, y para saber qué decía «Recuperación»
 * había que abrirla: doce prefabricadas, doce viajes de ida y vuelta.
 *
 * Los tokens salen rellenos con los valores de muestra, igual que en la vista
 * previa — «Llevas {{streak_count}} días» no se lee de un vistazo.
 */
function Excerpt({ template, gymName }) {
  const { title, body } = templateExcerpt(template, { gymName, name: template.name });
  if (!title && !body) return null;
  return (
    <div className="mt-1.5 min-w-0">
      {title && (
        <div
          className="truncate"
          style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-admin-text-sub)', letterSpacing: '-0.1px' }}
        >
          {title}
        </div>
      )}
      {body && (
        // Dos líneas y corta. Una sola no llega a decir de qué va; tres hacen
        // que la tarjeta compita con el correo en vez de resumirlo.
        <div
          style={{
            marginTop: title ? 2 : 0,
            fontSize: 11.5,
            lineHeight: 1.35,
            color: 'var(--color-admin-text-muted)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {body}
        </div>
      )}
    </div>
  );
}

// Small square ghost button used for the secondary row actions (the design's
// GhostBtn). 32×32, hairline border, theme-aware.
function GhostBtn({ icon: Icon, onClick, label, danger = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid place-items-center rounded-[9px] border transition-colors hover:bg-[var(--color-bg-hover)]"
      style={{ width: 32, height: 32, borderColor: 'var(--color-admin-border)', background: 'var(--color-bg-card)' }}
    >
      <Icon size={15} strokeWidth={2} style={{ color: danger ? 'var(--color-danger)' : 'var(--color-admin-text-sub)' }} />
    </button>
  );
}

// Accent-wash pill button — the primary row action.
function AccentButton({ icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-[9px] font-bold transition-colors"
      style={{
        padding: '8px 13px',
        fontSize: 12.5,
        color: 'var(--color-accent)',
        background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
        border: '1px solid color-mix(in srgb, var(--color-accent) 22%, transparent)',
      }}
    >
      <Icon size={13} strokeWidth={2} /> {label}
    </button>
  );
}

/**
 * Card for an existing user-saved email template — restyled to the "Plantillas
 * de Email" design language: tone-coded icon chip + name + kind pill + meta,
 * with an explicit Edit action plus quick ghost actions (use-in-outreach,
 * duplicate, delete). Theme-aware + white-label accent throughout.
 */
export default function EmailTemplateCard({ template, onEdit, onDelete, onDuplicate, t, lang, gymName }) {
  const navigate = useNavigate();
  const updated = new Date(template.updatedAt || template.updated_at);
  const dateStr = Number.isNaN(updated.getTime())
    ? ''
    : updated.toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <AdminCard padding="p-3.5">
      <div className="flex items-start gap-3">
        <KindIconChip type={template.type} size={40} />
        <button onClick={() => onEdit(template)} className="flex-1 min-w-0 text-left">
          <div className="truncate" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: 14, color: 'var(--color-admin-text)', letterSpacing: '-0.2px' }}>
            {template.name || t('admin.emailTemplates.untitled', 'Untitled')}
          </div>
          <div className="flex items-center gap-2 mt-1.5 min-w-0">
            <KindPill type={template.type} t={t} />
            {/* Un diseño de la galería y una plantilla de bloques viven en la
                misma lista pero se editan en sitios distintos. Sin distintivo,
                el admin abre "Editar" esperando el editor de bloques y le sale
                otra cosa. */}
            {template.designer_id && (
              <span
                className="inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', color: 'var(--color-accent)' }}
              >
                <Sparkles size={9} />
                {t('admin.emailTemplates.designBadge', 'Design')}
              </span>
            )}
            {/* Only shown when the template is actually wired to an automatic
                moment AND switched on (mig 0687). A template that merely HAS a
                step_key is still manual — the pill would otherwise imply this
                gym is sending mail it isn't. */}
            {template.auto_enabled && template.step_key && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider flex-shrink-0"
                style={{ background: 'var(--color-success-soft)', color: 'var(--color-success-ink)' }}
                title={t('admin.emailTemplates.autoOnHint', 'Sends automatically at this moment')}
              >
                <Zap size={9} />
                {t(`admin.emailTemplates.step.${template.step_key}`, template.step_key)}
              </span>
            )}
            {dateStr && <span className="text-[11.5px] truncate" style={{ color: 'var(--color-admin-text-muted)' }}>{dateStr}</span>}
          </div>
          <Excerpt template={template} gymName={gymName} />
        </button>
        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
          <GhostBtn
            icon={Send}
            label={t('admin.emailTemplates.useInOutreach', 'Use in Outreach')}
            onClick={() => navigate(`/admin/outreach?channel=email&template=${template.id}`)}
          />
          <GhostBtn icon={Copy} label={t('admin.emailTemplates.duplicate')} onClick={() => onDuplicate(template)} />
          <GhostBtn icon={Trash2} danger label={t('admin.emailTemplates.delete')} onClick={() => onDelete(template.id)} />
          <AccentButton icon={Pencil} label={t('admin.emailTemplates.edit')} onClick={() => onEdit(template)} />
        </div>
      </div>
    </AdminCard>
  );
}

/**
 * Card for a built-in starter template — shown in the "Prebuilt" tab. Same row
 * design; a single "Use this template" forks the prebuilt into the editor.
 */
export function PrebuiltCard({ template, onUse, t, gymName }) {
  const navigate = useNavigate();
  // Prebuilts have no DB id — use the prebuilt key so AdminOutreach can
  // re-derive the template via getPrebuiltTemplates(...) at mount.
  const prebuiltKey = template.key || template.id?.replace(/^prebuilt-/, '') || '';
  return (
    <AdminCard padding="p-3.5">
      <div className="flex items-start gap-3">
        <KindIconChip type={template.type} size={40} />
        <div className="flex-1 min-w-0">
          <div className="truncate" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: 14, color: 'var(--color-admin-text)', letterSpacing: '-0.2px' }}>
            {template.name}
          </div>
          <div className="mt-1.5">
            <KindPill type={template.type} t={t} />
          </div>
          <Excerpt template={template} gymName={gymName} />
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
          <GhostBtn
            icon={Send}
            label={t('admin.emailTemplates.useInOutreach', 'Use in Outreach')}
            onClick={() => navigate(`/admin/outreach?channel=email&prebuilt=${encodeURIComponent(prebuiltKey)}`)}
          />
          <AccentButton icon={Sparkles} label={t('admin.emailTemplates.useTemplate')} onClick={() => onUse(template)} />
        </div>
      </div>
    </AdminCard>
  );
}
