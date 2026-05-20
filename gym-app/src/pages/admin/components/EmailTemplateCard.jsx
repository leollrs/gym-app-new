import { Pencil, Copy, Trash2, Sparkles, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AdminCard } from '../../../components/admin';
import { TEMPLATE_TYPES } from './emailTemplatePrebuilts';

/**
 * Card for an existing user-saved email template. Click anywhere on the card
 * opens the editor; hover surfaces duplicate / edit / delete affordances.
 */
export default function EmailTemplateCard({ template, onEdit, onDelete, onDuplicate, t, lang }) {
  const navigate = useNavigate();
  const typeInfo = TEMPLATE_TYPES.find(tt => tt.key === template.type) || TEMPLATE_TYPES[5];
  const updated = new Date(template.updatedAt || template.updated_at);
  const dateStr = updated.toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <AdminCard className="group hover:border-[#D4AF37]/20 transition-colors cursor-pointer" onClick={() => onEdit(template)}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0 text-lg">
          {typeInfo.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{template.name}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] font-medium text-[#D4AF37]/80 bg-[#D4AF37]/8 px-2 py-0.5 rounded-full">
              {t(`admin.emailTemplates.types.${template.type}`)}
            </span>
            <span className="text-[11px] text-[#6B7280]">{dateStr}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={e => {
              e.stopPropagation();
              navigate(`/admin/outreach?channel=email&template=${template.id}`);
            }}
            className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#D4AF37] hover:bg-white/[0.04] transition-colors"
            aria-label={t('admin.emailTemplates.useInOutreach', 'Use in Outreach')}
            title={t('admin.emailTemplates.useInOutreach', 'Use in Outreach')}
          >
            <Send size={14} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDuplicate(template); }}
            className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#D4AF37] hover:bg-white/[0.04] transition-colors"
            aria-label={t('admin.emailTemplates.duplicate')}
            title={t('admin.emailTemplates.duplicate')}
          >
            <Copy size={14} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onEdit(template); }}
            className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#D4AF37] hover:bg-white/[0.04] transition-colors"
            aria-label={t('admin.emailTemplates.edit')}
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(template.id); }}
            className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#EF4444] hover:bg-red-500/5 transition-colors"
            aria-label={t('admin.emailTemplates.delete')}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </AdminCard>
  );
}

/**
 * Card for a built-in starter template — shown in the "Prebuilt" tab.
 * No edit/delete affordances; a single "Use this template" button forks
 * the prebuilt into the editor so the admin can customize before saving.
 */
export function PrebuiltCard({ template, onUse, t }) {
  const navigate = useNavigate();
  const typeInfo = TEMPLATE_TYPES.find(tt => tt.key === template.type) || TEMPLATE_TYPES[5];
  // Prebuilts have no DB id — use the prebuilt key so AdminOutreach can
  // re-derive the template via getPrebuiltTemplates(...) at mount.
  const prebuiltKey = template.key || template.id?.replace(/^prebuilt-/, '') || '';
  return (
    <AdminCard className="hover:border-[#D4AF37]/20 transition-colors">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0 text-lg">
          {typeInfo.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-[#E5E7EB]">{template.name}</p>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            {t(`admin.emailTemplates.types.${template.type}`)}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => navigate(`/admin/outreach?channel=email&prebuilt=${encodeURIComponent(prebuiltKey)}`)}
            className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#D4AF37] hover:bg-white/[0.04] transition-colors"
            aria-label={t('admin.emailTemplates.useInOutreach', 'Use in Outreach')}
            title={t('admin.emailTemplates.useInOutreach', 'Use in Outreach')}
          >
            <Send size={14} />
          </button>
          <button
            onClick={() => onUse(template)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-[#D4AF37] bg-[#D4AF37]/10 border border-[#D4AF37]/20 hover:bg-[#D4AF37]/20 transition-colors"
          >
            <Sparkles size={13} /> {t('admin.emailTemplates.useTemplate')}
          </button>
        </div>
      </div>
    </AdminCard>
  );
}
