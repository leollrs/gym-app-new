import { useState } from 'react';
import { Link, Copy, Check, Loader2, Share2, Mail, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { supabase } from '../../../lib/supabase';
import AdminModal from '../../../components/admin/AdminModal';
import logger from '../../../lib/logger';
import { logAdminAction } from '../../../lib/adminAudit';
import posthog from 'posthog-js';

/**
 * InviteModal — "Invite Member" (Invitar Miembro)
 * Sends an invitation to someone who isn't a member yet.
 * Generates an invite code and provides multiple sharing channels
 * (email, WhatsApp, SMS, native share, QR code).
 */
export default function InviteModal({ gymId, onClose }) {
  const { t } = useTranslation('pages');
  const k = (key) => t(`admin.inviteModal.${key}`);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const inviteCode = result?.invite_code || '';
  const inviteUrl = inviteCode ? `https://tugympr.app/invite/${inviteCode}` : '';

  const [sendMethod, setSendMethod] = useState('email'); // 'email' | 'phone'
  const canSubmit = name.trim() && (email.trim() || phone.trim());

  const handleGenerate = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_create_invite_code', {
        p_gym_id: gymId,
        p_member_name: name.trim(),
        p_email: email.trim() || null,
        p_phone: phone.trim() || null,
      });
      if (rpcError) throw rpcError;
      setResult(data);

      logAdminAction('invite_member', 'member', data?.id, {
        name: name.trim(),
        has_email: !!email.trim(),
        has_phone: !!phone.trim(),
        send_method: sendMethod,
      });
      posthog?.capture('admin_member_invited', { method: sendMethod || 'invite_link' });

      // Auto-send via selected method after code is generated
      const code = data?.invite_code || '';
      const url = code ? `https://tugympr.app/invite/${code}` : '';
      setTimeout(() => {
        if (sendMethod === 'email' && email.trim()) {
          const subject = encodeURIComponent(k('emailSubject') || "You're invited to join the gym!");
          const body = encodeURIComponent(`${k('emailBody') || 'Use this code to join'}: ${code}\n\n${url}`);
          window.open(`mailto:${email.trim()}?subject=${subject}&body=${body}`, '_self');
        } else if (sendMethod === 'phone' && phone.trim()) {
          const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
          const body = encodeURIComponent(`${k('smsText') || k('shareText') || "You're invited to join the gym! Use this code"}: ${code} ${url}`);
          window.open(`sms:${phone.trim()}${isIOS ? '&' : '?'}body=${body}`, '_self');
        }
      }, 500); // slight delay to let the result render first
    } catch (err) {
      logger.error('InviteModal: generate failed:', err);
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {}
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {}
  };

  const handleShare = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({ title: k('shareTitle'), text: `${k('shareText')} ${inviteCode}`, url: inviteUrl });
      } else if (navigator.share) {
        await navigator.share({ title: k('shareTitle'), text: `${k('shareText')} ${inviteCode}`, url: inviteUrl });
      } else {
        handleCopyLink();
      }
    } catch (err) {
      if (err.name !== 'AbortError') logger.error('Share failed:', err);
    }
  };

  const handleEmail = () => {
    const subject = encodeURIComponent(k('emailSubject') || "You're invited to join the gym!");
    const body = encodeURIComponent(
      `${k('emailBody') || 'Use this code to join'}: ${inviteCode}\n\n${inviteUrl}`
    );
    const mailto = email.trim()
      ? `mailto:${email.trim()}?subject=${subject}&body=${body}`
      : `mailto:?subject=${subject}&body=${body}`;
    window.open(mailto, '_blank');
  };

  const handleSMS = () => {
    const cleanPhone = phone.trim();
    const body = encodeURIComponent(
      `${k('smsText') || k('shareText') || 'You\'re invited to join the gym! Use this code'}: ${inviteCode} ${inviteUrl}`
    );
    // iOS uses &body= separator, Android uses ?body=
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    window.open(`sms:${cleanPhone}${isIOS ? '&' : '?'}body=${body}`, '_self');
  };

  const handleAnother = () => {
    setName('');
    setEmail('');
    setPhone('');
    setResult(null);
    setError(null);
    setCopiedCode(false);
    setCopiedLink(false);
    setSendMethod(null);
  };

  const expiryDate = result?.expires_at
    ? new Date(result.expires_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <AdminModal isOpen onClose={onClose} title={t('admin.inviteModal.inviteTitle', 'Invitar Miembro')} titleIcon={Mail} size="sm">
      {!result ? (
        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.inviteModal.memberName', 'Nombre')} <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('admin.inviteModal.memberNamePlaceholder', 'Nombre completo')}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.inviteModal.email', 'Correo electrónico')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('admin.inviteModal.emailPlaceholder', 'correo@ejemplo.com')}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.inviteModal.phone', 'Teléfono')}
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+34 612 345 678"
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
            />
            <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>
              {t('admin.inviteModal.phoneHintText', 'Formato internacional para SMS')}
            </p>
          </div>

          {/* How to send? */}
          <div>
            <label className="block text-[12px] font-semibold mb-2" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.inviteModal.howToSend', '¿Cómo enviar la invitación?')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setSendMethod('email')}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors"
                style={sendMethod === 'email'
                  ? { background: 'color-mix(in srgb, #3B82F6 12%, transparent)', color: '#3B82F6', border: '1px solid color-mix(in srgb, #3B82F6 30%, transparent)' }
                  : { background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }
                }>
                <Mail size={14} /> Email
              </button>
              <button type="button" onClick={() => setSendMethod('phone')}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors"
                style={sendMethod === 'phone'
                  ? { background: 'color-mix(in srgb, #10B981 12%, transparent)', color: '#10B981', border: '1px solid color-mix(in srgb, #10B981 30%, transparent)' }
                  : { background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }
                }>
                <Smartphone size={14} /> SMS
              </button>
            </div>
          </div>

          {error && <p className="text-[12px]" style={{ color: 'var(--color-danger)' }}>{error}</p>}

          <button
            onClick={handleGenerate}
            disabled={!canSubmit || loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
          >
            {loading ? (
              <><Loader2 size={14} className="animate-spin" /> {t('admin.inviteModal.generating', 'Generando...')}</>
            ) : (
              <><Mail size={14} /> {t('admin.inviteModal.sendInvitation', 'Enviar Invitación')}</>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Code display */}
          <div
            className="rounded-xl py-4 px-4 text-center"
            style={{
              background: 'var(--color-bg-input, var(--color-bg-elevated))',
              border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)',
            }}
          >
            <p
              className="text-[28px] font-bold tracking-[0.25em] font-mono select-all"
              style={{ color: 'var(--color-accent)' }}
            >
              {inviteCode}
            </p>
            <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>{name}</p>
          </div>

          {/* QR Code */}
          {inviteUrl && (
            <div className="flex justify-center">
              <div className="bg-white p-3 rounded-xl">
                <QRCodeSVG value={inviteUrl} size={140} level="H" includeMargin={false} />
              </div>
            </div>
          )}

          {/* Invite link */}
          <div
            className="rounded-xl px-3 py-2.5 text-center"
            style={{
              background: 'var(--color-bg-input, var(--color-bg-elevated))',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            <p className="text-[11px] mb-1" style={{ color: 'var(--color-text-subtle)' }}>{t('admin.inviteModal.inviteLink', 'Link de invitación')}</p>
            <p className="text-[12px] font-mono break-all select-all" style={{ color: 'var(--color-accent)' }}>{inviteUrl}</p>
          </div>

          {/* Send actions */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.inviteModal.sendVia', 'Enviar invitación vía')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleEmail}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors"
                style={{ background: 'color-mix(in srgb, #3B82F6 12%, transparent)', color: '#3B82F6', border: '1px solid color-mix(in srgb, #3B82F6 25%, transparent)' }}>
                <Mail size={13} /> Email
              </button>
              <button onClick={handleSMS}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors"
                style={{ background: 'color-mix(in srgb, var(--color-text-muted) 8%, transparent)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
                <Smartphone size={13} /> SMS
              </button>
              <button onClick={handleShare}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}>
                <Share2 size={13} /> {t('admin.inviteModal.share', 'Compartir')}
              </button>
            </div>
          </div>

          {/* Copy actions */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={handleCopyCode}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors"
              style={copiedCode
                ? { background: 'color-mix(in srgb, var(--color-success) 12%, transparent)', color: 'var(--color-success)', border: '1px solid color-mix(in srgb, var(--color-success) 20%, transparent)' }
                : { background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }
              }>
              {copiedCode ? <Check size={13} /> : <Copy size={13} />}
              {copiedCode ? t('admin.inviteModal.copied', 'Copiado') : t('admin.inviteModal.copyCode', 'Copiar Código')}
            </button>
            <button onClick={handleCopyLink}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors"
              style={copiedLink
                ? { background: 'color-mix(in srgb, var(--color-success) 12%, transparent)', color: 'var(--color-success)', border: '1px solid color-mix(in srgb, var(--color-success) 20%, transparent)' }
                : { background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }
              }>
              {copiedLink ? <Check size={13} /> : <Link size={13} />}
              {copiedLink ? t('admin.inviteModal.copied', 'Copiado') : t('admin.inviteModal.copyLink', 'Copiar Link')}
            </button>
          </div>

          {/* Expiry */}
          {expiryDate && (
            <p className="text-center text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>
              {t('admin.inviteModal.expires', 'Expira')} {expiryDate}
            </p>
          )}

          {/* Bottom actions */}
          <div className="flex gap-3">
            <button onClick={handleAnother}
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
              style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
              {t('admin.inviteModal.addAnother', 'Invitar Otro')}
            </button>
            <button onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}>
              {t('admin.inviteModal.done', 'Listo')}
            </button>
          </div>
        </div>
      )}
    </AdminModal>
  );
}
