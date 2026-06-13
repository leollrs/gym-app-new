import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Wallet, Share2, Info, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import Barcode from 'react-barcode';
import { Capacitor } from '@capacitor/core';
import { useTranslation } from 'react-i18next';
import { WalletPass } from '../lib/walletPass';
import { supabase } from '../lib/supabase';
import useSignedQR from '../hooks/useSignedQR';
import { useAuth } from '../contexts/AuthContext';

const FONT_DISPLAY = "'Familjen Grotesk', 'Archivo', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

// Allow-list of hostnames we are willing to open in the in-app browser /
// system browser. Prevents arbitrary navigation if a malicious server response
// ever supplies a saveUrl we did not expect.
// TODO: extend with gymConfig.customDomain when added to gym schema
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'wallet.google.com',
  'pay.google.com',
  'apple.com',
  'www.apple.com',
  'tugympr.com',
  'www.tugympr.com',
]);

// Open an external URL using SFSafariViewController (via @capacitor/browser)
// when available, falling back to window.open for the web build. Apple prefers
// in-app browser sessions over leaving the app.
async function openExternalUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed');
    if (!ALLOWED_EXTERNAL_HOSTS.has(u.hostname)) {
      throw new Error(`Blocked external host: ${u.hostname}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[openExternalUrl] rejected', err);
    return;
  }
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } catch {
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* swallow */ }
  }
}

// Max brightness when showing QR so physical scanners can read easily
async function setMaxBrightness() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { ScreenBrightness } = await import('@capacitor-community/screen-brightness');
    const { brightness: original } = await ScreenBrightness.getBrightness();
    await ScreenBrightness.setBrightness({ brightness: 1.0 });
    return original;
  } catch { return null; }
}

async function restoreBrightness(original) {
  if (original == null || !Capacitor.isNativePlatform()) return;
  try {
    const { ScreenBrightness } = await import('@capacitor-community/screen-brightness');
    await ScreenBrightness.setBrightness({ brightness: original });
  } catch { /* best effort */ }
}

// ── Card palette (matches Gym Wallet v2 reference) ──────────────────────────
const CARD_GRADIENT = 'linear-gradient(165deg, #12181E 0%, #0A0E12 60%, #0D1318 100%)';
const GOLD_GRADIENT = 'linear-gradient(135deg, #D4A835 0%, #8E6A1A 100%)';

function formatMonthYear(iso, lang) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(lang?.startsWith('es') ? 'es-ES' : 'en-US', {
      month: 'long', year: 'numeric',
    }).format(d);
  } catch { return null; }
}

// ── Pass header with PR logo tile ────────────────────────────────────────────
// Gym initials for the logo-less fallback tile. White-label: NEVER hardcode
// "PR" (TuGymPR's mark) on a gym's member pass — derive from the gym name.
// "Iron Temple" → "IT", "Powerhouse" → "PO", empty → "GP".
function gymInitials(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'GP';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function PassHeader({ label = 'MEMBER PASS', title = 'TuGymPR', logoUrl = '' }) {
  const { t } = useTranslation('pages');
  // Fall back to the initials tile if the signed logo URL is missing OR the
  // image fails to load (expired signature, deleted object, offline).
  const [imgFailed, setImgFailed] = useState(false);
  const showLogo = !!logoUrl && !imgFailed;
  return (
    <div
      className="flex items-center justify-between px-[18px] pt-4 pb-3.5 relative"
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {showLogo ? (
          <div
            className="flex items-center justify-center overflow-hidden flex-shrink-0"
            style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <img
              src={logoUrl}
              alt={title}
              onError={() => setImgFailed(true)}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>
        ) : (
          <div
            className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0"
            style={{
              background: GOLD_GRADIENT,
              boxShadow: '0 2px 6px rgba(212,168,53,0.35)',
            }}
          >
            <span
              className="text-[14px] font-extrabold leading-none"
              style={{ fontFamily: FONT_DISPLAY, color: '#1a1208', letterSpacing: '-0.5px' }}
            >{gymInitials(title)}</span>
          </div>
        )}
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase text-white/65" style={{ letterSpacing: '1.4px' }}>
            {label}
          </div>
          <div
            className="text-[14px] font-extrabold text-white truncate"
            style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.2px', marginTop: 1 }}
          >{title}</div>
        </div>
      </div>
      <div className="text-right shrink-0 ml-3">
        <div className="text-[9px] font-semibold text-white/55" style={{ letterSpacing: '1.2px' }}>{t('qrCode.statusLabel', { defaultValue: 'STATUS' })}</div>
        <div className="flex items-center gap-1.5 justify-end mt-0.5">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: '#2EC4C4', boxShadow: '0 0 6px #2EC4C4' }}
          />
          <span
            className="text-[12px] font-extrabold text-white uppercase"
            style={{ fontFamily: FONT_DISPLAY, letterSpacing: '0.4px' }}
          >{t('qrCode.statusActive', { defaultValue: 'ACTIVE' })}</span>
        </div>
      </div>
    </div>
  );
}

// ── Secondary "Apple Wallet fields" row ──────────────────────────────────────
function PassFields({ fields }) {
  return (
    <div
      className="grid grid-cols-3 gap-3 px-[18px] py-3.5"
      style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
    >
      {fields.map((f, i) => (
        <div key={i}>
          <div className="text-[9px] font-extrabold text-white/40" style={{ letterSpacing: '1.2px' }}>
            {f.label}
          </div>
          <div
            className="font-extrabold text-white mt-1"
            style={{
              fontFamily: f.mono ? FONT_MONO : FONT_DISPLAY,
              fontSize: f.mono ? 13 : 14,
              letterSpacing: f.mono ? '0.5px' : '-0.2px',
            }}
          >{f.value}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Fullscreen modal that displays a member's QR code or barcode for scanning
 * at the gym's access system. Redesigned to match the Apple-Wallet-style
 * "Gym Wallet v2" mock: dark gradient pass card with gold PR tile, member
 * name, secondary fields, large QR, and action row below.
 *
 * @param {string} payload       - The string to encode
 * @param {string} memberName    - Member's display name
 * @param {string} displayFormat - 'qr_code' | 'barcode_128' | 'barcode_39'
 * @param {string} gymName       - Gym name for wallet pass
 * @param {function} onClose     - Close handler
 * @param {boolean} skipSigning  - If true, display payload as-is without HMAC signing
 */
export default function QRCodeModal({ payload, memberName, displayFormat = 'qr_code', gymName, onClose, skipSigning = false }) {
  const { t, i18n } = useTranslation('pages');
  const { profile, gymLogoUrl, gymConfig } = useAuth() || {};
  const codeRef = useRef(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState('');

  // Detect special payload types for display tweaks
  const isReferral = typeof payload === 'string' && payload.startsWith('gym-referral:');
  const isRewardPayload = typeof payload === 'string' && payload.startsWith('gym-reward:');
  const isSpecial = isReferral || isRewardPayload || skipSigning;

  // ── Gym-configured payload source (gyms.qr_payload_type, 0084) ────────────
  // The platform GymSettingsTab can point the member pass at the gym's own
  // access system instead of the signed TuGymPR payload:
  //   auto_id (default) → rawSource null: HMAC-signed flow below, unchanged.
  //   external_id       → the member's profiles.qr_external_id RAW (their
  //                       existing door/keypad code — the gym's scanner owns
  //                       verification, so no HMAC). No external id on file →
  //                       fall back to auto_id silently.
  //   custom_template   → gyms.qr_payload_template with {member_id},
  //                       {external_id}, {full_name}, {username} substituted,
  //                       rendered raw. Empty/missing template → auto_id.
  // Special payloads (referral / reward / skipSigning) keep their contracts.
  const rawSource = useMemo(() => {
    if (isSpecial) return null;
    const type = gymConfig?.qrPayloadType;
    if (type === 'external_id') {
      const ext = typeof profile?.qr_external_id === 'string' ? profile.qr_external_id.trim() : '';
      return ext || null;
    }
    if (type === 'custom_template') {
      const tpl = typeof gymConfig?.qrPayloadTemplate === 'string' ? gymConfig.qrPayloadTemplate.trim() : '';
      if (!tpl) return null;
      return tpl
        .replace(/\{member_id\}/g, profile?.id || '')
        .replace(/\{external_id\}/g, typeof profile?.qr_external_id === 'string' ? profile.qr_external_id.trim() : '')
        .replace(/\{full_name\}/g, profile?.full_name || '')
        .replace(/\{username\}/g, profile?.username || '');
    }
    return null;
  }, [isSpecial, gymConfig?.qrPayloadType, gymConfig?.qrPayloadTemplate, profile?.id, profile?.qr_external_id, profile?.full_name, profile?.username]);

  // Sign the QR payload with HMAC to prevent forgery (skip for raw URLs like
  // referral links). rawSource short-circuits signing: external/template codes
  // are for the gym's own scanner and are displayed verbatim.
  // sign-qr only signs allowlisted `gym-*` payload types (security pass).
  // The member check-in payload is the BARE 8-char code from profiles (0084),
  // so wrap it as gym-checkin: — without this every check-in QR signing 400'd
  // ("Unsupported payload type") and fell back unsigned. scanRouter strips the
  // prefix back off on the scanner side.
  // useSignedQR re-signs every 45s while the modal is open (verify-qr expires
  // signatures after 60s, so a pass held open at the desk used to scan as
  // "expired") and never exposes the unsigned→signed mid-render swap.
  const toSign = (!payload || skipSigning || rawSource)
    ? null
    : (payload.startsWith('gym-') ? payload : `gym-checkin:${payload}`);
  const { signed: signedPayload, failed: signFailed, pending: signPending } = useSignedQR(toSign);
  // Reward QRs MUST be signed (admin scanner rejects unsigned ones), so
  // surface the failure to the member instead of showing a dead QR. Other
  // payloads degrade gracefully to the unsigned code (check-in catch-all
  // accepts bare codes).
  const signError = signFailed && isRewardPayload
    ? t('qrCode.signFailed', "Couldn't generate a valid QR — check your connection and reopen")
    : null;

  // Real last check-in (latest check_ins row). profile.last_active_at is
  // "last app activity" — ANY action bumps it — and was wrongly shown under
  // the "Last check-in" label (said "2h ago" after a workout with zero gym
  // visits). No row yet → the QuickStats line is hidden.
  const [lastCheckinAt, setLastCheckinAt] = useState(null);
  useEffect(() => {
    if (isSpecial || !profile?.id) return undefined;
    let cancelled = false;
    supabase
      .from('check_ins')
      .select('checked_in_at')
      .eq('profile_id', profile.id)
      .order('checked_in_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setLastCheckinAt(data?.checked_in_at ?? null); });
    return () => { cancelled = true; };
  }, [isSpecial, profile?.id]);

  // Max screen brightness while QR is displayed. Wrapped in catches so a plugin-
  // missing or permission-denied response doesn't crash the modal.
  const originalBrightnessRef = useRef(null);
  useEffect(() => {
    setMaxBrightness()
      .then(orig => { originalBrightnessRef.current = orig; })
      .catch((err) => { console.warn('[QRCodeModal] setMaxBrightness failed:', err); });
    return () => {
      try {
        const result = restoreBrightness(originalBrightnessRef.current);
        if (result && typeof result.catch === 'function') {
          result.catch((err) => console.warn('[QRCodeModal] restoreBrightness failed:', err));
        }
      } catch (err) {
        console.warn('[QRCodeModal] restoreBrightness threw:', err);
      }
    };
  }, []);

  // Lock body scroll while modal is mounted
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const isBarcode = displayFormat === 'barcode_128' || displayFormat === 'barcode_39';
  const barcodeFormat = displayFormat === 'barcode_39' ? 'CODE39' : 'CODE128';

  // Derive member ID (short hash from qr payload or profile id)
  const memberId = useMemo(() => {
    if (isSpecial) return null;
    const src = profile?.qr_code_payload || profile?.id || '';
    // Use 8-char alphanumeric uppercase slice
    const cleaned = String(src).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
    return cleaned || null;
  }, [profile?.qr_code_payload, profile?.id, isSpecial]);

  const memberSince = useMemo(
    () => formatMonthYear(profile?.created_at || profile?.onboarded_at, i18n.language),
    [profile?.created_at, profile?.onboarded_at, i18n.language]
  );

  const planLabel = useMemo(() => {
    const tier = profile?.membership_tier || profile?.plan_name;
    if (tier && typeof tier === 'string') return tier.toUpperCase();
    return t('qrCode.planDefault', 'MEMBER');
  }, [profile?.membership_tier, profile?.plan_name, t]);

  const visitsLeft = profile?.passes_remaining ?? profile?.visits_remaining ?? null;

  const handleAddToWallet = useCallback(async () => {
    setWalletLoading(true);
    setWalletError('');
    try {
      const platform = Capacitor.getPlatform();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error(t('qrCode.notAuthenticated'));

      // Fetch member's active punch cards to include on the wallet pass
      let punchCards = [];
      try {
        const { data: cards } = await supabase
          .from('member_punch_cards')
          .select('punches, total_completed, gym_products!inner(name, punch_card_target, punch_card_enabled)')
          .eq('member_id', session.user.id)
          .eq('gym_products.punch_card_enabled', true);

        if (cards?.length) {
          punchCards = cards.map(c => ({
            name: c.gym_products.name,
            punches: c.punches,
            target: c.gym_products.punch_card_target,
            completed: c.total_completed,
          }));
        }
      } catch { /* proceed without punch card data */ }

      const { data, error } = await supabase.functions.invoke(
        platform === 'ios' ? 'generate-apple-pass' : 'generate-google-pass',
        {
          body: { payload, memberName, gymName, punchCards },
          headers: { Authorization: `Bearer ${session.access_token}` },
        }
      );

      if (error) {
        const ctx = error.context;
        let details = '';
        if (ctx) {
          try { const body = await ctx.json(); details = body?.details || body?.error || ''; }
          catch { try { details = await ctx.text(); } catch {} }
        }
        // eslint-disable-next-line no-console
        console.error('[wallet-pass] server error:', error.message, '\nDETAILS:', details);
        throw new Error(details || error.message || 'Wallet pass server error');
      }
      if (data?.error) {
        // eslint-disable-next-line no-console
        console.error('[wallet-pass] data.error:', data.error, '\nDETAILS:', data.details, '\nSTACK:', data.stack);
        throw new Error(data.details ? `${data.error}: ${data.details}` : data.error);
      }
      if (data?.unsupported) throw new Error(t('qrCode.walletNotConfigured'));

      if (platform === 'ios') {
        await WalletPass.addPass({ pkpassBase64: data.pkpass });
      } else {
        if (typeof data.saveUrl !== 'string' || !data.saveUrl.startsWith('https://')) {
          throw new Error(t('qrCode.walletFailed'));
        }
        await openExternalUrl(data.saveUrl);
      }
    } catch (err) {
      setWalletError(err.message || t('qrCode.walletFailed'));
    } finally {
      setWalletLoading(false);
    }
  }, [payload, memberName, gymName, t]);

  const handleSharePass = useCallback(async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({
          title: memberName ? `${memberName} — ${gymName || 'TuGymPR'}` : t('qrCode.gymPass', 'Gym Pass'),
          text: t('qrCode.shareText', { defaultValue: 'Check out my gym pass on {{gym}}', gym: gymName || 'TuGymPR' }),
        });
      } else if (navigator.share) {
        await navigator.share({
          title: memberName || t('qrCode.gymPass', 'Gym Pass'),
          text: t('qrCode.shareText', { defaultValue: 'Check out my gym pass on {{gym}}', gym: gymName || 'TuGymPR' }),
        });
      }
    } catch { /* user cancelled */ }
  }, [memberName, gymName, t]);

  if (!payload) return null;

  // Display mnemonic below QR (8-char hash for member pass)
  const qrCaption = memberId && !isSpecial
    ? memberId
    : isReferral
      ? payload.split(':').pop()
      : isRewardPayload
        ? (payload.split(':').pop() || '').substring(0, 8).toUpperCase()
        : '';

  const platform = Capacitor.getPlatform();

  const modalContent = (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
      style={{
        padding: 'max(env(safe-area-inset-top, 0px) + 12px, 16px) 16px max(env(safe-area-inset-bottom, 0px) + 12px, 16px)',
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Wallet card + actions stack — centered, with bottom Close button as the only dismiss UI (top X removed per UX feedback) */}
      <div
        className="relative w-full max-w-[380px] max-h-full overflow-y-auto animate-fade-in"
        onClick={e => e.stopPropagation()}
        style={{ fontFamily: FONT_DISPLAY }}
      >
        {/* ── Pass Card ───────────────────────────────────────────── */}
        <div
          className="relative overflow-hidden"
          style={{
            borderRadius: 22,
            background: CARD_GRADIENT,
            boxShadow: '0 24px 50px rgba(0,0,0,0.35), inset 0 0 0 0.5px rgba(255,255,255,0.06)',
          }}
        >
          {/* Ambient glows */}
          <div
            className="absolute pointer-events-none"
            style={{
              top: -80, right: -40, width: 220, height: 220, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(46,196,196,0.22) 0%, transparent 60%)',
            }}
          />
          <div
            className="absolute pointer-events-none"
            style={{
              bottom: 140, left: -60, width: 200, height: 200, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(212,168,53,0.10) 0%, transparent 60%)',
            }}
          />

          {/* Header */}
          <PassHeader
            label={isReferral ? t('qrCode.referralPass', 'REFERRAL PASS') : isRewardPayload ? t('qrCode.rewardPass', 'REWARD PASS') : t('qrCode.memberPass', 'MEMBER PASS')}
            title={gymName || 'TuGymPR'}
            logoUrl={gymLogoUrl}
          />

          {/* Member name block */}
          <div className="px-[18px] pt-[18px] pb-5 relative">
            <div className="text-[10px] font-extrabold" style={{ color: '#2EC4C4', letterSpacing: '1.6px' }}>
              {isReferral ? t('qrCode.referral', 'REFERRAL') : isRewardPayload ? t('qrCode.reward', 'REWARD') : t('qrCode.member', 'MEMBER')}
            </div>
            <div
              id="qr-modal-title"
              className="text-white mt-1 leading-none"
              style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 700, letterSpacing: '-1px' }}
            >
              {memberName || t('qrCode.yourGymPass')}
            </div>
            {memberSince && !isSpecial && (
              <div className="text-[12px] text-white/55 mt-1.5">
                {t('qrCode.memberSince', 'Member since')} {memberSince}
              </div>
            )}
          </div>

          {/* Secondary fields — only for member pass */}
          {!isSpecial && (
            <PassFields
              fields={[
                ...(memberId ? [{ label: t('qrCode.memberId', 'MEMBER ID'), value: memberId, mono: true }] : []),
                ...(visitsLeft != null ? [{ label: t('qrCode.visitsLeft', 'VISITS LEFT'), value: String(visitsLeft) }] : []),
                { label: t('qrCode.plan', 'PLAN'), value: planLabel },
              ]}
            />
          )}

          {/* QR / Barcode — on white tile centered */}
          <div
            className="px-[18px] pt-1 pb-6 text-center relative"
            style={{
              borderTop: isSpecial ? '1px solid rgba(255,255,255,0.06)' : 'none',
            }}
          >
            <div className="inline-block bg-white rounded-[12px] p-3" ref={codeRef}>
              {/* Never render the unsigned payload while the signature is in
                  flight — the code would visibly morph into a different QR a
                  beat later, and a scan in that window misroutes. Spinner
                  until settled; on failure fall back unsigned (valid for
                  check-in / non-reward payloads). */}
              {signPending ? (
                <div
                  className="flex items-center justify-center"
                  style={{ width: 176, height: isBarcode ? 80 : 176 }}
                  role="status"
                  aria-label={t('common.loading', 'Loading')}
                >
                  <div
                    className="w-8 h-8 rounded-full animate-spin"
                    style={{ border: '3px solid #E5E7EB', borderTopColor: '#111827' }}
                  />
                </div>
              ) : isBarcode ? (
                <Barcode
                  value={rawSource || signedPayload || payload}
                  format={barcodeFormat}
                  width={2}
                  height={80}
                  displayValue={false}
                  background="#FFFFFF"
                  lineColor="#000000"
                />
              ) : (
                <QRCodeSVG
                  value={rawSource || signedPayload || payload}
                  size={176}
                  level="H"
                  includeMargin={false}
                  bgColor="#FFFFFF"
                  fgColor="#000000"
                />
              )}
              {signError && (
                <div className="mt-2 text-center" style={{ fontSize: 10, color: '#B91C1C', fontWeight: 600 }}>
                  ⚠️ {signError}
                </div>
              )}
              {qrCaption && (
                <>
                  <div
                    className="mt-2 text-center"
                    style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '1.4px',
                      textTransform: 'uppercase',
                      color: 'rgba(0,0,0,0.55)',
                    }}
                  >
                    {t('qrCode.manualCode', 'Manual entry code')}
                  </div>
                  <div
                    className="text-center"
                    style={{
                      fontFamily: FONT_MONO, fontSize: 18, fontWeight: 800, letterSpacing: '3px',
                      color: '#000000',
                      marginTop: 2,
                    }}
                  >
                    {qrCaption}
                  </div>
                </>
              )}
            </div>
            <div
              className="text-white/45 mt-2"
              style={{ fontSize: 10, letterSpacing: '0.4px', fontWeight: 500 }}
            >
              {t('qrCode.scanAtFrontDesk', 'SCAN AT FRONT DESK · HOLD STEADY')}
            </div>
          </div>
        </div>

        {/* ── QuickStats (only for member pass) ───────────────────── */}
        {!isSpecial && lastCheckinAt && (
          <div
            className="mt-3.5 mx-0 px-4 py-3.5 rounded-[16px] flex items-center gap-3"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            <div
              className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0"
              style={{ background: '#2EC4C4' }}
            >
              <QrCode size={18} color="#001512" strokeWidth={2.4} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-extrabold text-[var(--color-text-primary)] truncate" style={{ letterSpacing: '-0.1px' }}>
                {t('qrCode.lastCheckIn', 'Last check-in')} · {formatRelative(lastCheckinAt, i18n.language)}
              </div>
              {gymName && (
                <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{gymName}</div>
              )}
            </div>
            <Info size={16} className="text-[var(--color-text-muted)]" />
          </div>
        )}

        {/* ── Action Row ──────────────────────────────────────────── */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            onClick={handleAddToWallet}
            disabled={walletLoading || isReferral}
            className="py-3 px-2 rounded-[14px] flex flex-col items-center gap-1.5 disabled:opacity-40 transition active:scale-95 focus:ring-2 focus:ring-[#D4A835] focus:outline-none"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-primary)',
            }}
          >
            {walletLoading ? (
              <div className="w-[18px] h-[18px] border-[2px] border-[#D4A835]/30 border-t-[#D4A835] rounded-full animate-spin" />
            ) : (
              <Wallet size={18} />
            )}
            <span className="text-[11px] font-semibold leading-tight text-center" style={{ whiteSpace: 'pre-line' }}>
              {walletLoading
                ? t('qrCode.generating')
                : platform === 'ios'
                  ? t('qrCode.appleWallet', 'Apple Wallet')
                  : platform === 'android'
                    ? t('qrCode.googleWallet', 'Google Wallet')
                    : t('qrCode.addToWallet', 'Add to Wallet')}
            </span>
          </button>

          <button
            onClick={handleSharePass}
            className="py-3 px-2 rounded-[14px] flex flex-col items-center gap-1.5 transition active:scale-95 focus:ring-2 focus:ring-[#D4A835] focus:outline-none"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-primary)',
            }}
          >
            <Share2 size={18} />
            <span className="text-[11px] font-semibold leading-tight text-center" style={{ whiteSpace: 'pre-line' }}>
              {t('qrCode.sharePass', 'Share\npass')}
            </span>
          </button>

          <button
            onClick={onClose}
            className="py-3 px-2 rounded-[14px] flex flex-col items-center gap-1.5 transition active:scale-95 focus:ring-2 focus:ring-[#D4A835] focus:outline-none"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-primary)',
            }}
          >
            <X size={18} />
            <span className="text-[11px] font-semibold leading-tight text-center" style={{ whiteSpace: 'pre-line' }}>
              {t('qrCode.close', 'Close')}
            </span>
          </button>
        </div>

        {walletError && (
          <p className="text-[11px] text-red-400 text-center mt-3 px-2">{walletError}</p>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

function formatRelative(iso, lang) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return lang?.startsWith('es') ? 'hace un momento' : 'moments ago';
    if (mins < 60) return lang?.startsWith('es') ? `hace ${mins} min` : `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return lang?.startsWith('es') ? `hace ${hrs} h` : `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return lang?.startsWith('es') ? `hace ${days} d` : `${days}d ago`;
  } catch { return ''; }
}
