// Por dónde se reenvía una invitación — en un solo sitio.
//
// Había dos copias con criterios distintos: la fila de la tabla elegía canal
// SOLA (correo si lo hay, si no SMS) y el detalle ofrecía los tres. Elegir por
// el admin es cómodo hasta que la invitación tiene el correo mal escrito y el
// teléfono bien — entonces el botón manda al sitio equivocado sin decirlo.
// Ahora los dos sitios preguntan, y preguntan lo mismo porque es el mismo
// componente.
//
// Reenviar NO toca el código: el que ya diste por teléfono sigue valiendo. Esa
// es la razón de que esta pantalla exista en vez de «borrar y crear otra».
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, MessageSquare, Loader2, Check } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { inviteUrl as buildInviteUrl } from '../../../lib/appUrls';
import { whatsappUrl } from '../../../lib/socialHandles';
import { logAdminAction } from '../../../lib/adminAudit';
import { useToast } from '../../../contexts/ToastContext';
import logger from '../../../lib/logger';
import { inviteChannels, WHATSAPP_GREEN } from '../../../lib/admin/inviteChannels';

// `Phone` no dice WhatsApp. El glifo sí, y con el verde de la marca el botón se
// reconoce sin leerlo. Todo lo demás del componente sigue con variables del tema.
export function WhatsAppIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

/**
 * Botones de reenvío. `layout="grid"` los pone en rejilla (detalle);
 * `layout="stack"` los apila a ancho completo (modal corto de la fila).
 */
export default function InviteResendButtons({ invite, layout = 'grid', onSent }) {
  const { t, i18n } = useTranslation('pages');
  const { showToast } = useToast();
  const k = (key, fallback) => t(`admin.inviteDetail.${key}`, fallback);

  const [sending, setSending] = useState(null);
  const [sentVia, setSentVia] = useState(null);

  const channels = inviteChannels(invite);
  if (!invite || channels.length === 0) return null;

  const url = buildInviteUrl(invite.invite_code);

  // Correo y SMS salen por NUESTROS proveedores (Resend / Twilio) vía
  // send-invite, la misma función que usa el alta.
  const send = async (channel) => {
    const to = channel === 'email' ? invite.email : invite.phone;
    if (!to) return;
    setSending(channel);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('send-invite', {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        body: {
          channel,
          to,
          memberName: invite.member_name || '',
          inviteCode: invite.invite_code,
          inviteUrl: url,
          lang: i18n.language?.startsWith('es') ? 'es' : 'en',
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'send_failed');
      // Sin esta línea el reenvío del detalle no aparecía en ningún historial:
      // solo lo registraba el de la fila.
      logAdminAction('resend_invite', 'invite', invite.id, { channel });
      setSentVia(channel);
      showToast(k('resent', 'Invitación reenviada'), 'success');
      onSent?.(channel);
    } catch (err) {
      logger.error('resend invite failed:', err);
      showToast(k('resendFailed', 'No se pudo reenviar — copia el enlace y mándalo a mano'), 'error');
    } finally {
      setSending(null);
    }
  };

  // WhatsApp no pasa por el servidor: abre el chat con el mensaje escrito y lo
  // manda el admin desde su propio número.
  const openWhatsApp = () => {
    const msg = `${k('waText', 'Tu invitación')}: ${url}`;
    const wa = whatsappUrl(invite.phone, msg);
    // whatsappUrl devuelve null con menos de 10 dígitos. Sin esto abriríamos
    // "https://wa.me/null" en una pestaña nueva.
    if (!wa) { showToast(k('badPhone', 'El teléfono no es válido para WhatsApp'), 'error'); return; }
    window.open(wa, '_blank', 'noopener,noreferrer');
    logAdminAction('resend_invite', 'invite', invite.id, { channel: 'whatsapp' });
    setSentVia('whatsapp');
    onSent?.('whatsapp');
  };

  const btn = 'flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[12.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[42px]';
  const neutral = { background: 'var(--color-bg-hover)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' };
  const whatsapp = {
    background: `color-mix(in srgb, ${WHATSAPP_GREEN} 12%, transparent)`,
    border: `1px solid color-mix(in srgb, ${WHATSAPP_GREEN} 34%, transparent)`,
    color: WHATSAPP_GREEN,
  };

  const glyph = (id) => {
    if (sending === id) return <Loader2 size={14} className="animate-spin" />;
    if (sentVia === id) return <Check size={14} />;
    if (id === 'email') return <Mail size={14} />;
    if (id === 'sms') return <MessageSquare size={14} />;
    return <WhatsAppIcon size={15} />;
  };

  const wrap = layout === 'stack'
    ? 'flex flex-col gap-2'
    : `grid gap-2 ${channels.length >= 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`;

  return (
    <div className={wrap}>
      {channels.includes('email') && (
        <button type="button" className={btn} style={neutral} onClick={() => send('email')} disabled={!!sending}>
          {glyph('email')} {k('email', 'Correo')}
        </button>
      )}
      {channels.includes('sms') && (
        <button type="button" className={btn} style={neutral} onClick={() => send('sms')} disabled={!!sending}>
          {glyph('sms')} SMS
        </button>
      )}
      {channels.includes('whatsapp') && (
        <button type="button" className={btn} style={whatsapp} onClick={openWhatsApp} disabled={!!sending}>
          {glyph('whatsapp')} WhatsApp
        </button>
      )}
    </div>
  );
}
