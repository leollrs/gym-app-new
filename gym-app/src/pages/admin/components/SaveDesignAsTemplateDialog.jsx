import { useState } from 'react';
import { Loader2, Zap } from 'lucide-react';
import { AdminModal } from '../../../components/admin';
import { AUTO_STEPS, stepLabel } from '../../../lib/admin/emailAutoSteps';

/**
 * Guardar un diseño de la galería como plantilla del gimnasio.
 *
 * Existe porque los quince diseños de emailDesignerTemplates.js estaban
 * DESCONECTADOS del sistema de plantillas: "Usar este diseño" solo llevaba a
 * Outreach, o sea que servían para un envío puntual y nada más. No se podían
 * guardar, y por tanto no podían llevar `step_key` — así que todo el correo
 * automático solo podía usar el editor de bloques.
 *
 * Aquí se piden las tres cosas que hacen falta y ninguna más: cómo se llama, a
 * qué momento sirve, y si ya envía. El momento y el interruptor son decisiones
 * SEPARADAS a propósito, igual que en el editor de bloques: escoger un momento
 * no enciende nada. Nadie debe despertar mandando correos.
 */
export default function SaveDesignAsTemplateDialog({
  open, designLabel, defaultName, saving, onCancel, onSave, t,
}) {
  const [name, setName] = useState('');
  const [stepKey, setStepKey] = useState('');
  const [autoEnabled, setAutoEnabled] = useState(false);

  if (!open) return null;

  const finalName = (name.trim() || defaultName || designLabel || '').slice(0, 120);
  const canSave = !!finalName && !saving;

  const inputStyle = {
    background: 'var(--color-bg-input, var(--color-bg-elevated))',
    border: '1px solid var(--color-border-subtle)',
    color: 'var(--color-text-primary)',
  };

  return (
    <AdminModal
      isOpen
      onClose={() => !saving && onCancel()}
      title={t('admin.emailTemplates.saveDesignTitle', 'Save as a template')}
      subtitle={designLabel}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={() => !saving && onCancel()}
            disabled={saving}
            className="flex-1 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors disabled:opacity-50"
            style={{ color: 'var(--color-admin-text-sub)', background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}
          >
            {t('admin.emailTemplates.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() => canSave && onSave({ name: finalName, stepKey: stepKey || null, autoEnabled: !!stepKey && autoEnabled })}
            disabled={!canSave}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold transition-all disabled:opacity-50"
            style={{ background: 'var(--color-accent)', color: '#fff' }}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            {t('admin.emailTemplates.saveDesign', 'Save template')}
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
            placeholder={defaultName || designLabel}
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
              // Quitar el momento tiene que apagar el envío: dejar
              // auto_enabled colgando sin momento guarda una fila que dice
              // "enviando" y no envía nada.
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
      </div>
    </AdminModal>
  );
}
