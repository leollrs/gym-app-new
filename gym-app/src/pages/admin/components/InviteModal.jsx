import { useState } from 'react';
import { Link, Copy, Check, Loader2, Share2, Mail, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { inviteUrl as buildInviteUrl } from '../../../lib/appUrls';
import { supabase } from '../../../lib/supabase';
import AdminModal from '../../../components/admin/AdminModal';
import PhoneInput from '../../../components/admin/PhoneInput';
import NameFields from './NameFields';
import { composeFullName, areNamePartsValid } from '../../../lib/admin/memberName';
import logger from '../../../lib/logger';
import { logAdminAction } from '../../../lib/adminAudit';
import { useToast } from '../../../contexts/ToastContext';
import posthog from 'posthog-js';

/**
 * InviteModal — "Invite Member" (Invitar Miembro)
 * Sends an invitation to someone who isn't a member yet.
 * Generates an invite code and provides multiple sharing channels
 * (email, WhatsApp, SMS, native share, QR code).
 */
export default function InviteModal({ gymId, onClose }) {
  const { t, i18n } = useTranslation('pages');
  const { showToast } = useToast();
  const k = (key) => t(`admin.inviteModal.${key}`);

  const [nameParts, setNameParts] = useState({ first: '', middle: '', last: '', second: '' });
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [sending, setSending] = useState(null); // 'email' | 'phone'
  const [sentVia, setSentVia] = useState(null);  // 'email' | 'phone'

  const inviteCode = result?.invite_code || '';
  const inviteUrl = inviteCode ? buildInviteUrl(inviteCode) : '';

  const [sendMethod, setSendMethod] = useState('email'); // 'email' | 'phone'
  const fullName = composeFullName(nameParts);
  const namesOk = areNamePartsValid(nameParts);
  const canSubmit = namesOk && (email.trim() || phone.trim());

  // Deliver the invite through our own providers — Resend (email) / Twilio (SMS)
  // — via the admin-gated send-invite edge function, instead of opening the
  // device's mailto:/sms: composer. Falls back to a toast on failure so the
  // admin can still copy/share the code manually.
  const sendInvite = async (channel, codeArg, urlArg) => {
    const code = codeArg ?? inviteCode;
    const url = urlArg ?? inviteUrl;
    const target = channel === 'email' ? email.trim() : phone.trim();
    if (!code || !target) return;
    setSending(channel);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error: fnError } = await supabase.functions.invoke('send-invite', {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        body: {
          channel: channel === 'phone' ? 'sms' : 'email',
          to: target,
          memberName: fullName,
          inviteCode: code,
          inviteUrl: url,
          lang: i18n.language?.startsWith('es') ? 'es' : 'en',
        },
      });
      if (fnError || data?.error) throw new Error(data?.error || fnError?.message || 'send_failed');
      setSentVia(channel);
      showToast(channel === 'email' ? k('emailSent') : k('smsSent'), 'success');
    } catch (err) {
      logger.error('send-invite failed:', err);
      showToast(k('sendFailed'), 'error');
    } finally {
      setSending(null);
    }
  };

  const handleGenerate = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_create_invite_code', {
        p_gym_id: gymId,
        p_member_name: fullName,
        p_email: email.trim() || null,
        p_phone: phone.trim() || null,
      });
      if (rpcError) throw rpcError;
      setResult(data);

      logAdminAction('invite_member', 'member', data?.id, {
        name: fullName,
        has_email: !!email.trim(),
        has_phone: !!phone.trim(),
        send_method: sendMethod,
      });
      posthog?.capture('admin_member_invited', { method: sendMethod || 'invite_link' });

      // Auto-deliver via our own provider (Resend / Twilio), using the freshly-
      // generated code (state isn't updated yet). Prefer the chosen channel, but
      // fall back to whichever contact was actually provided.
      const code = data?.invite_code || '';
      const url = code ? buildInviteUrl(code) : '';
      const autoChannel = (sendMethod === 'email' && email.trim()) || (sendMethod === 'phone' && phone.trim())
        ? sendMethod
        : (email.trim() ? 'email' : (phone.trim() ? 'phone' : null));
      if (autoChannel) sendInvite(autoChannel, code, url);
    } catch (err) {
      logger.error('InviteModal: generate failed:', err);
      setError(err.message || t('common:somethingWentWrong', 'Something went wrong'));
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

  // Re-send via our providers (email = Resend, SMS = Twilio).
  const handleEmail = () => sendInvite('email');
  const handleSMS = () => sendInvite('phone');

  const handleAnother = () => {
    setNameParts({ first: '', middle: '', last: '', second: '' });
    setEmail('');
    setPhone('');
    setResult(null);
    setError(null);
    setCopiedCode(false);
    setCopiedLink(false);
    setSendMethod('email');
    setSending(null);
    setSentVia(null);
  };

  const expiryDate = result?.expires_at
    ? new Date(result.expires_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <AdminModal isOpen onClose={onClose} title={t('admin.inviteModal.inviteTitle', 'Invite Member')} titleIcon={Mail} size="sm">
      {!result ? (
        <div className="space-y-4">
          {/* Name — structured (first / middle / last / second last) */}
          <NameFields value={nameParts} onChange={setNameParts} />

          {/* Email */}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.inviteModal.email', 'Email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('admin.inviteModal.emailPlaceholder', 'email@example.com')}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.inviteModal.phone', 'Phone')}
            </label>
            <PhoneInput
              value={phone}
              onChange={setPhone}
              placeholder={t('admin.inviteModal.phonePlaceholderShort', '555 123 4567')}
              ariaLabel={t('admin.inviteModal.phone', 'Phone')}
            />
            <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>
              {t('admin.inviteModal.phoneHintText', 'International format for SMS')}
            </p>
          </div>

          {/* How to send? */}
          <div>
            <label className="block text-[12px] font-semibold mb-2" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.inviteModal.howToSend', 'How to send the invitation?')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setSendMethod('email')}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors"
                style={sendMethod === 'email'
                  ? { background: 'color-mix(in srgb, #3B82F6 12%, transparent)', color: 'var(--color-info)', border: '1px solid color-mix(in srgb, #3B82F6 30%, transparent)' }
                  : { background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }
                }>
                <Mail size={14} /> {t('admin.inviteModal.channelEmail', 'Email')}
              </button>
              <button type="button" onClick={() => setSendMethod('phone')}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors"
                style={sendMethod === 'phone'
                  ? { background: 'color-mix(in srgb, #10B981 12%, transparent)', color: 'var(--color-success)', border: '1px solid color-mix(in srgb, #10B981 30%, transparent)' }
                  : { background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }
                }>
                <Smartphone size={14} /> {t('admin.inviteModal.channelSms', 'SMS')}
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
              <><Loader2 size={14} className="animate-spin" /> {t('admin.inviteModal.generating', 'Generating...')}</>
            ) : (
              <><Mail size={14} /> {t('admin.inviteModal.sendInvitation', 'Send Invitation')}</>
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
            <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>{fullName}</p>
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
            <p className="text-[11px] mb-1" style={{ color: 'var(--color-text-subtle)' }}>{t('admin.inviteModal.inviteLink', 'Invite link')}</p>
            <p className="text-[12px] font-mono break-all select-all" style={{ color: 'var(--color-accent)' }}>{inviteUrl}</p>
          </div>

          {/* Send actions — delivered via our own providers (Resend / Twilio) */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.inviteModal.sendVia', 'Send invitation via')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {email.trim() && (
                <button onClick={handleEmail} disabled={sending === 'email'}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors disabled:opacity-60"
                  style={sentVia === 'email'
                    ? { background: 'color-mix(in srgb, var(--color-success) 12%, transparent)', color: 'var(--color-success)', border: '1px solid color-mix(in srgb, var(--color-success) 25%, transparent)' }
                    : { background: 'color-mix(in srgb, #3B82F6 12%, transparent)', color: 'var(--color-info)', border: '1px solid color-mix(in srgb, #3B82F6 25%, transparent)' }}>
                  {sending === 'email' ? <Loader2 size={13} className="animate-spin" /> : sentVia === 'email' ? <Check size={13} /> : <Mail size={13} />}
                  {sentVia === 'email' ? t('admin.inviteModal.sent', 'Sent') : t('admin.inviteModal.channelEmail', 'Email')}
                </button>
              )}
              {phone.trim() && (
                <button onClick={handleSMS} disabled={sending === 'phone'}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors disabled:opacity-60"
                  style={sentVia === 'phone'
                    ? { background: 'color-mix(in srgb, var(--color-success) 12%, transparent)', color: 'var(--color-success)', border: '1px solid color-mix(in srgb, var(--color-success) 25%, transparent)' }
                    : { background: 'color-mix(in srgb, var(--color-text-muted) 8%, transparent)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
                  {sending === 'phone' ? <Loader2 size={13} className="animate-spin" /> : sentVia === 'phone' ? <Check size={13} /> : <Smartphone size={13} />}
                  {sentVia === 'phone' ? t('admin.inviteModal.sent', 'Sent') : t('admin.inviteModal.channelSms', 'SMS')}
                </button>
              )}
              <button onClick={handleShare}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}>
                <Share2 size={13} /> {t('admin.inviteModal.share', 'Share')}
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
              {copiedCode ? t('admin.inviteModal.copied', 'Copied') : t('admin.inviteModal.copyCode', 'Copy Code')}
            </button>
            <button onClick={handleCopyLink}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors"
              style={copiedLink
                ? { background: 'color-mix(in srgb, var(--color-success) 12%, transparent)', color: 'var(--color-success)', border: '1px solid color-mix(in srgb, var(--color-success) 20%, transparent)' }
                : { background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }
              }>
              {copiedLink ? <Check size={13} /> : <Link size={13} />}
              {copiedLink ? t('admin.inviteModal.copied', 'Copied') : t('admin.inviteModal.copyLink', 'Copy Link')}
            </button>
          </div>

          {/* Expiry */}
          {expiryDate && (
            <p className="text-center text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>
              {t('admin.inviteModal.expires', 'Expires')} {expiryDate}
            </p>
          )}

          {/* Bottom actions */}
          <div className="flex gap-3">
            <button onClick={handleAnother}
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
              style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
              {t('admin.inviteModal.addAnother', 'Invite Another')}
            </button>
            <button onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}>
              {t('admin.inviteModal.done', 'Done')}
            </button>
          </div>
        </div>
      )}
    </AdminModal>
  );
}
