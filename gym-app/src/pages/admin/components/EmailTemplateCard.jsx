import { Pencil, Copy, Trash2, Sparkles, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AdminCard } from '../../../components/admin';
import { KindIconChip, KindPill } from './emailTemplateKinds';

const DISPLAY_FONT = 'var(--admin-font-display, "Archivo", system-ui, sans-serif)';

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
export default function EmailTemplateCard({ template, onEdit, onDelete, onDuplicate, t, lang }) {
  const navigate = useNavigate();
  const updated = new Date(template.updatedAt || template.updated_at);
  const dateStr = Number.isNaN(updated.getTime())
    ? ''
    : updated.toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <AdminCard padding="p-3.5">
      <div className="flex items-center gap-3">
        <KindIconChip type={template.type} size={40} />
        <button onClick={() => onEdit(template)} className="flex-1 min-w-0 text-left">
          <div className="truncate" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: 14, color: 'var(--color-admin-text)', letterSpacing: '-0.2px' }}>
            {template.name || t('admin.emailTemplates.untitled', 'Untitled')}
          </div>
          <div className="flex items-center gap-2 mt-1.5 min-w-0">
            <KindPill type={template.type} t={t} />
            {dateStr && <span className="text-[11.5px] truncate" style={{ color: 'var(--color-admin-text-muted)' }}>{dateStr}</span>}
          </div>
        </button>
        <div className="flex items-center gap-1.5 flex-shrink-0">
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
export function PrebuiltCard({ template, onUse, t }) {
  const navigate = useNavigate();
  // Prebuilts have no DB id — use the prebuilt key so AdminOutreach can
  // re-derive the template via getPrebuiltTemplates(...) at mount.
  const prebuiltKey = template.key || template.id?.replace(/^prebuilt-/, '') || '';
  return (
    <AdminCard padding="p-3.5">
      <div className="flex items-center gap-3">
        <KindIconChip type={template.type} size={40} />
        <div className="flex-1 min-w-0">
          <div className="truncate" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: 14, color: 'var(--color-admin-text)', letterSpacing: '-0.2px' }}>
            {template.name}
          </div>
          <div className="mt-1.5">
            <KindPill type={template.type} t={t} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
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
