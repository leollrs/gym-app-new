import { useRef, useCallback, useState, useEffect } from 'react';
import { X, Download, Wallet, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import Barcode from 'react-barcode';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { useTranslation } from 'react-i18next';

const WalletPass = registerPlugin('WalletPass');
import { supabase } from '../lib/supabase';
import { signQRPayload } from '../lib/qrSecurity';

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

/**
 * Fullscreen modal that displays a member's QR code or barcode for scanning
 * at the gym's access system. Designed for maximum scanability:
 * white background, large code, high contrast.
 *
 * @param {string} payload       - The string to encode
 * @param {string} memberName    - Member's display name
 * @param {string} displayFormat - 'qr_code' | 'barcode_128' | 'barcode_39'
 * @param {string} gymName       - Gym name for wallet pass
 * @param {function} onClose     - Close handler
 * @param {boolean} skipSigning  - If true, display payload as-is without HMAC signing (for URLs like referral links)
 */
export default function QRCodeModal({ payload, memberName, displayFormat = 'qr_code', gymName, onClose, skipSigning = false }) {
  const { t } = useTranslation('pages');
  const codeRef = useRef(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [signedPayload, setSignedPayload] = useState(null);

  // Sign the QR payload with HMAC to prevent forgery (skip for raw URLs like referral links)
  useEffect(() => {
    if (!payload || skipSigning) return;
    let cancelled = false;
    signQRPayload(payload).then((signed) => {
      if (!cancelled) setSignedPayload(signed);
    });
    return () => { cancelled = true; };
  }, [payload, skipSigning]);

  // Max screen brightness while QR is displayed
  const originalBrightnessRef = useRef(null);
  useEffect(() => {
    setMaxBrightness().then(orig => { originalBrightnessRef.current = orig; });
    return () => { restoreBrightness(originalBrightnessRef.current); };
  }, []);

  const isBarcode = displayFormat === 'barcode_128' || displayFormat === 'barcode_39';
  const barcodeFormat = displayFormat === 'barcode_39' ? 'CODE39' : 'CODE128';

  const handleDownload = useCallback(() => {
    if (!codeRef.current) return;
    const svg = codeRef.current.querySelector('svg');
    if (!svg) return;

    const canvas = document.createElement('canvas');
    const size = 1024;
    const width = isBarcode ? size : size;
    const height = isBarcode ? 400 : size;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    const svgData = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const padding = isBarcode ? 40 : 80;
      ctx.drawImage(img, padding, padding, width - padding * 2, height - padding * 2);
      const link = document.createElement('a');
      link.download = `gym-pass-${memberName?.replace(/\s+/g, '-').toLowerCase() || 'code'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  }, [memberName, isBarcode]);

  const handleAddToWallet = useCallback(async () => {
    setWalletLoading(true);
    setWalletError('');
    try {
      const platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
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

      if (error) throw error;

      // Check for error in response body (function always returns 200)
      if (data?.error) {
        throw new Error(data.error + (data.stack ? '\n' + data.stack : ''));
      }

      // Edge function returns { unsupported: true } if certs aren't configured
      if (data?.unsupported) {
        throw new Error(t('qrCode.walletNotConfigured'));
      }

      if (platform === 'ios') {
        // Use native Swift plugin to present PKAddPassesViewController
        await WalletPass.addPass({ pkpassBase64: data.pkpass });
      } else {
        // Edge function returns a Google Wallet save URL
        if (typeof data.saveUrl !== 'string' || !data.saveUrl.startsWith('https://')) {
          throw new Error(t('qrCode.walletFailed'));
        }
        window.open(data.saveUrl, '_blank');
      }
    } catch (err) {
      setWalletError(err.message || t('qrCode.walletFailed'));
    } finally {
      setWalletLoading(false);
    }
  }, [payload, memberName, gymName]);

  if (!payload) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-modal-title"
        className="relative w-full max-w-sm mx-4 rounded-2xl overflow-hidden animate-fade-in max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label={t('qrCode.close', 'Close')}
          className="absolute top-4 right-4 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-black/20 transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          style={{ color: 'var(--color-text-subtle)' }}
        >
          <X size={18} />
        </button>

        {/* Code display area — white bg for max scanability */}
        <div className={`bg-white flex flex-col items-center ${isBarcode ? 'p-6 pt-10' : 'p-8'}`}>
          <div ref={codeRef}>
            {isBarcode ? (
              <Barcode
                value={signedPayload || payload}
                format={barcodeFormat}
                width={2}
                height={100}
                displayValue={false}
                background="#FFFFFF"
                lineColor="#000000"
              />
            ) : (
              <QRCodeSVG
                value={signedPayload || payload}
                size={240}
                level="H"
                includeMargin={false}
                bgColor="#FFFFFF"
                fgColor="#000000"
              />
            )}
          </div>
          <p className={`mt-4 font-mono font-bold text-black/70 text-center select-all ${isBarcode ? 'text-[18px] tracking-[0.25em]' : 'text-[14px] tracking-widest'}`}>
            {payload}
          </p>
        </div>

        {/* Info + actions — dark bg */}
        <div className="border-t border-white/8 p-5" style={{ background: 'var(--color-bg-card)' }}>
          <p id="qr-modal-title" className="text-[15px] font-bold text-center mb-1" style={{ color: 'var(--color-text-primary)' }}>
            {memberName || t('qrCode.yourGymPass')}
          </p>
          <p className="text-[12px] text-center mb-4" style={{ color: 'var(--color-text-subtle)' }}>
            {t('qrCode.showAtScanner')}
          </p>

          <div className="flex gap-2">
            <button
              onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{
                background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                border: '1.5px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
                color: 'var(--color-accent)',
              }}
            >
              <Download size={15} />
              {t('qrCode.saveImage')}
            </button>
            <button
              onClick={handleAddToWallet}
              disabled={walletLoading}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{
                background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                border: '1.5px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
                color: 'var(--color-accent)',
              }}
            >
              {walletLoading ? (
                <div className="w-4 h-4 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
              ) : (
                <Wallet size={15} />
              )}
              {walletLoading
                ? t('qrCode.generating')
                : Capacitor.getPlatform() === 'ios'
                  ? t('qrCode.appleWallet')
                  : Capacitor.getPlatform() === 'android'
                    ? t('qrCode.googleWallet')
                    : t('qrCode.addToWallet')}
            </button>
          </div>

          {walletError && (
            <p className="text-[11px] text-red-400 text-center mt-2">{walletError}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function base64ToBlob(base64, mimeType) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mimeType });
}
