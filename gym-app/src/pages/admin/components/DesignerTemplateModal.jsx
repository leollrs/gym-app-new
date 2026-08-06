import { useState } from 'react';
import { Loader2, Zap, Trash2 } from 'lucide-react';
import { AdminModal } from '../../../components/admin';
import { AUTO_STEPS, stepLabel } from '../../../lib/admin/emailAutoSteps';

/**
 * Ajustes de una plantilla guardada desde la galería de diseños.
 *
 * Un diseño NO tiene bloques que editar — es HTML fijo — así que abrirlo en
 * EmailTemplateEditor sería enseñar seis paneles vacíos, y guardar desde allí
 * sobrescribiría el HTML con bloques deshabilitados: el correo saldría en
 * blanco. Aquí solo se toca lo que realmente es ajustable: el nombre, a qué
 * momento sirve y si envía.
 *
 * La previsualización es el propio HTML guardado, en un iframe con sandbox
 * vacío (sin scripts, sin formularios, sin navegación). Es HTML que generamos
 * nosotros, pero pasa por aquí igual: es exactamente lo que le va a llegar al
 * miembro, tokens incluidos, y verlo antes de encender el envío es el punto.
 */
export default function DesignerTemplateModal({ template, saving, onSave, onClose, onDelete, t }) {
  const [name, setName] = useState(template?.name || '');
  const [stepKey, setStepKey] = useState(template?.step_key || '');
  const [autoEnabled, setAutoEnabled] = useState(!!template?.auto_enabled);

  if (!template) return null;

  const finalName = name.trim().slice(0, 120);
  const canSave = !!finalName && !saving;

  const inputStyle = {
    background: 'var(--color-bg-input, var(--color-bg-elevated))',
    border: '1px solid var(--color-border-subtle)',
    color: 'var(--color-text-primary)',
  };

  return (
    <AdminModal
      isOpen
      onClose={() => !saving && onClose()}
      title={t('admin.emailTemplates.designSettings', 'Design settings')}
      subtitle={template.designer_subject || template.name}
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="flex-1 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors disabled:opacity-50"
            style={{ color: 'var(--color-admin-text-sub)', background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}
          >
            {t('admin.emailTemplates.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() => canSave && onSave({
              ...template,
              name: finalName,
              step_key: stepKey || null,
              auto_enabled: !!stepKey && autoEnabled,
            })}
            disabled={!canSave}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold transition-all disabled:opacity-50"
            style={{ background: 'var(--color-accent)', color: '#fff' }}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            {t('admin.emailTemplates.save', 'Save')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[12px] font-semibold" style={{ color: 'var(--color-admin-text-sub)' }}>
            {t('admin.emailTemplates.templateName', 'Name')}
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
            style={inputStyle}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-semibold" style={{ color: 'var(--color-admin-text-sub)' }}>
            {t('admin.emailTemplates.automation', 'Automatic sending')}
          </label>
          <select
            value={stepKey}
            onChange={(e) => {
              setStepKey(e.target.value);
              if (!e.target.value) setAutoEnabled(false);
            }}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
            style={inputStyle}
          >
            <option value="">{t('admin.emailTemplates.stepNone', 'Manual only')}</option>
            {AUTO_STEPS.map((s) => (
              <option key={s} value={s}>{stepLabel(t, s)}</option>
            ))}
          </select>

          <button
            type="button"
            role="switch"
            aria-checked={autoEnabled}
            disabled={!stepKey}
            onClick={() => setAutoEnabled((v) => !v)}
            className="mt-2 inline-flex items-center gap-2 rounded-full px-3 py-2 text-[12.5px] font-bold transition-colors disabled:opacity-40"
            style={{
              background: autoEnabled ? 'var(--color-success-soft)' : 'var(--color-admin-panel)',
              color: autoEnabled ? 'var(--color-success-ink)' : 'var(--color-admin-text-sub)',
              border: `1px solid ${autoEnabled ? 'transparent' : 'var(--color-admin-border)'}`,
            }}
          >
            <Zap size={13} />
            {autoEnabled
              ? t('admin.emailTemplates.autoOn', 'Sending automatically')
              : t('admin.emailTemplates.autoOff', 'Not sending')}
          </button>

          <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--color-admin-text-faint)' }}>
            {t('admin.emailTemplates.automationHint', 'Members only get this if they haven\'t opted out of that kind of email. Every automatic message carries an unsubscribe link.')}
          </p>
        </div>

        {template.designer_html && (
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold" style={{ color: 'var(--color-admin-text-sub)' }}>
              {t('admin.emailTemplates.preview', 'Preview')}
            </label>
            <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--color-admin-border)', background: '#fff' }}>
              <iframe
                title={t('admin.emailTemplates.preview', 'Preview')}
                srcDoc={template.designer_html}
                sandbox=""
                style={{ width: '100%', height: 380, border: 0, display: 'block' }}
              />
            </div>
            <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--color-admin-text-faint)' }}>
              {/* Es la consecuencia de guardar el HTML ya renderizado, y hay que
                  decirla donde se ve — no en un changelog. */}
              {t('admin.emailTemplates.designFrozenHint', 'The design was saved with your current colors and logo. If you change your branding, save this design again from Designs to refresh it.')}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => !saving && onDelete(template.id)}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
          style={{ color: 'var(--color-danger)', background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}
        >
          <Trash2 size={14} /> {t('admin.emailTemplates.delete', 'Delete')}
        </button>
      </div>
    </AdminModal>
  );
}
