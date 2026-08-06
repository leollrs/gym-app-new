import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import { emailDoc } from '../../../lib/admin/emailEngine';

/**
 * Vista previa del editor de plantillas.
 *
 * UNA SOLA IMPLEMENTACIÓN, A PROPÓSITO
 *
 * Esto eran 192 líneas de JSX que imitaban a mano la maqueta del correo, con
 * `fontSize: 13`, `borderRadius: 12` y el relleno CLAVADOS. Leía los colores y
 * nada más, así que el panel de estilo parecía roto: cambiabas de maqueta y la
 * vista previa no se movía. El correo que salía SÍ cambiaba — lo único que no
 * cambiaba era lo que el admin podía ver.
 *
 * Ahora renderiza `emailDoc`, exactamente el documento que se envía, dentro de
 * un iframe. No puede divergir del envío porque no hay de qué divergir.
 *
 * `sandbox=""` deniega todo: sin scripts, sin formularios, sin navegación. Es
 * HTML nuestro, pero lleva texto que escribe el admin.
 */
export default function EmailLivePreview({ cfg }) {
  const { t } = useTranslation('pages');

  const html = useMemo(() => {
    try { return emailDoc(cfg); } catch { return ''; }
  }, [cfg]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <Eye size={14} style={{ color: 'var(--color-accent)' }} />
        <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.7)', letterSpacing: '0.1em' }}>
          {t('admin.emailTemplates.preview')}
        </span>
      </div>
      <div className="flex-1 overflow-hidden" style={{ background: '#0b0b12' }}>
        <iframe
          title={t('admin.emailTemplates.preview')}
          srcDoc={html}
          sandbox=""
          style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
        />
      </div>
    </div>
  );
}
