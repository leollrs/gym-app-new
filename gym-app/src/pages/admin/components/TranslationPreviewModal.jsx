import { Check } from 'lucide-react';
import { AdminModal } from '../../../components/admin';

/**
 * Modal that surfaces the auto-translated class name + description before
 * commit, so the admin can edit either side if the auto-translation got
 * something wrong. Rendered as a second step of the create/edit flow:
 * the user saves → useAutoTranslate fills in the other-language fields →
 * this modal shows the diff and lets them confirm or tweak before write.
 */
export default function TranslationPreviewModal({ preview, onConfirm, onCancel, onChange, saving, t, tc }) {
  if (!preview) return null;
  const { name_en, name_es, desc_en, desc_es } = preview;
  return (
    <AdminModal isOpen onClose={onCancel} title={t('admin.classes.translationPreview')} size="lg">
      <div className="space-y-4">
        <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.translationPreviewDesc')}</p>

        {/* Name */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.className')} (EN)</label>
            <input value={name_en} onChange={e => onChange({ ...preview, name_en: e.target.value })}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:outline-none"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.className')} (ES)</label>
            <input value={name_es} onChange={e => onChange({ ...preview, name_es: e.target.value })}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:outline-none"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
          </div>
        </div>

        {/* Description */}
        {(desc_en || desc_es) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.description')} (EN)</label>
              <textarea value={desc_en} onChange={e => onChange({ ...preview, desc_en: e.target.value })} rows={3}
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:outline-none resize-none"
                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
            </div>
            <div>
              <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.description')} (ES)</label>
              <textarea value={desc_es} onChange={e => onChange({ ...preview, desc_es: e.target.value })} rows={3}
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:outline-none resize-none"
                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 mt-5">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors hover:opacity-80"
          style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-hover)' }}>
          {tc('back')}
        </button>
        <button onClick={onConfirm} disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: 'var(--color-accent, #D4AF37)', color: 'var(--color-text-on-accent)' }}>
          <Check size={14} /> {saving ? tc('saving') : t('admin.classes.confirmSave')}
        </button>
      </div>
    </AdminModal>
  );
}
