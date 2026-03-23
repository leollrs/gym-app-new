import { useState } from 'react';
import { X, Camera, ScanLine } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

/**
 * QR scanner for admins.
 * Native (iOS/Android): uses @capacitor-mlkit/barcode-scanning
 * Web: falls back to html5-qrcode
 */
export default function QRScannerModal({ isOpen, onClose, onScan }) {
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);

  const startNativeScan = async () => {
    try {
      setError('');
      setScanning(true);

      const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');

      // Request permission
      const { camera } = await BarcodeScanner.requestPermissions();
      if (camera !== 'granted') {
        setError('Camera permission denied. Allow camera access in Settings.');
        setScanning(false);
        return;
      }

      // Scan — opens native fullscreen scanner
      const { barcodes } = await BarcodeScanner.scan({
        formats: [BarcodeFormat.QrCode],
      });

      setScanning(false);

      if (barcodes.length > 0 && barcodes[0].rawValue) {
        const parsed = parseQRPayload(barcodes[0].rawValue);
        if (parsed) {
          onScan(parsed);
        } else {
          setError(`Not a valid purchase QR: "${barcodes[0].rawValue.substring(0, 50)}"`);
        }
      }
    } catch (err) {
      setScanning(false);
      if (err?.message?.includes('canceled') || err?.message?.includes('cancelled')) {
        // User cancelled — just close
        return;
      }
      setError(err?.message || 'Scanner error');
    }
  };

  const startWebScan = async () => {
    try {
      setError('');
      setScanning(true);

      const { Html5Qrcode } = await import('html5-qrcode');

      // Wait for DOM
      await new Promise(r => setTimeout(r, 100));

      const html5Qrcode = new Html5Qrcode('web-qr-reader', { verbose: false });
      const qrboxSize = Math.min(window.innerWidth * 0.6, 280);

      await html5Qrcode.start(
        { facingMode: 'environment' },
        { fps: 15, qrbox: { width: Math.round(qrboxSize), height: Math.round(qrboxSize) } },
        (decodedText) => {
          html5Qrcode.stop().catch(() => {});
          setScanning(false);
          const parsed = parseQRPayload(decodedText);
          if (parsed) {
            onScan(parsed);
          } else {
            setError(`Not a valid purchase QR: "${decodedText.substring(0, 50)}"`);
          }
        },
        () => {}
      );
    } catch (err) {
      setScanning(false);
      setError(err?.message || 'Camera error');
    }
  };

  if (!isOpen) return null;

  const isNative = Capacitor.isNativePlatform();

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#05070B]">
      {/* Header */}
      <div className="relative flex items-center justify-center py-4 px-4 border-b border-white/[0.06]">
        <button
          onClick={onClose}
          className="absolute left-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/[0.06] text-[#9CA3AF] hover:text-white transition-colors"
        >
          <X size={18} />
        </button>
        <div className="flex items-center gap-2">
          <Camera size={16} className="text-[#D4AF37]" />
          <span className="text-[15px] font-bold text-white">Scan Purchase QR</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        {!scanning && !error && (
          <>
            <div className="w-20 h-20 rounded-3xl bg-[#D4AF37]/10 flex items-center justify-center mb-6">
              <ScanLine size={36} className="text-[#D4AF37]" />
            </div>
            <p className="text-[17px] font-bold text-white mb-2">Ready to Scan</p>
            <p className="text-[14px] text-[#6B7280] text-center mb-8">
              Point your camera at the member's purchase QR code
            </p>
            <button
              onClick={isNative ? startNativeScan : startWebScan}
              className="px-8 py-3.5 rounded-xl font-bold text-[15px] text-black bg-[#D4AF37] hover:bg-[#C4A030] active:scale-[0.97] transition-all"
            >
              Open Camera
            </button>
          </>
        )}

        {scanning && isNative && (
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 border-[3px] border-[#D4AF37]/20 border-t-[#D4AF37] rounded-full animate-spin mb-4" />
            <p className="text-[14px] text-[#9CA3AF]">Scanner open...</p>
          </div>
        )}

        {error && (
          <>
            <Camera size={40} className="text-[#6B7280] mb-4" />
            <p className="text-[14px] text-[#EF4444] text-center mb-6">{error}</p>
            <button
              onClick={() => setError('')}
              className="px-6 py-2.5 rounded-xl text-[13px] font-semibold text-black bg-[#D4AF37]"
            >
              Try Again
            </button>
          </>
        )}

        {/* Web scanner container */}
        {!isNative && scanning && (
          <div className="w-full max-w-sm rounded-2xl overflow-hidden">
            <div id="web-qr-reader" style={{ width: '100%', minHeight: 300 }} />
            <style>{`
              #web-qr-reader video { width: 100% !important; height: auto !important; border: none !important; border-radius: 16px; }
              #web-qr-reader { border: none !important; padding: 0 !important; }
              #web-qr-reader__dashboard { display: none !important; }
            `}</style>
          </div>
        )}
      </div>
    </div>
  );
}

function parseQRPayload(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  if (trimmed.startsWith('gym-purchase:')) {
    const parts = trimmed.split(':');
    if (parts.length === 4 && parts[1] && parts[2] && parts[3]) {
      return { type: 'purchase', gymId: parts[1], memberId: parts[2], productId: parts[3] };
    }
    return null;
  }

  if (trimmed.length > 0) {
    return { type: 'checkin', qrPayload: trimmed };
  }

  return null;
}
