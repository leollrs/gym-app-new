import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { signQRPayload } from '../lib/qrSecurity';

/**
 * Modal showing a per-product QR code for a member.
 * The QR encodes: gym-purchase:{gymId}:{memberId}:{productId}
 * When scanned by admin, it auto-fills member + product in AdminStore.
 */
export default function ProductQRModal({ memberId, memberName, gymId, product, onClose }) {
  const [signedPayload, setSignedPayload] = useState(null);

  const payload = `gym-purchase:${gymId}:${memberId}:${product?.id}`;

  useEffect(() => {
    if (product && memberId) {
      signQRPayload(payload).then(setSignedPayload);
    }
  }, [payload, product, memberId]);

  if (!product || !memberId) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-sm mx-4 rounded-2xl overflow-hidden animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/20 text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
        >
          <X size={18} />
        </button>

        {/* QR — white bg for scanability */}
        <div className="bg-white flex flex-col items-center p-8 pt-10">
          <QRCodeSVG
            value={signedPayload || payload}
            size={220}
            level="H"
            includeMargin={false}
            bgColor="#FFFFFF"
            fgColor="#000000"
          />
        </div>

        {/* Info */}
        <div className="bg-[#0F172A] border-t border-white/8 p-5">
          <div className="flex items-center justify-center gap-2 mb-1">
            {product.emoji_icon && (
              <span className="text-[20px]">{product.emoji_icon}</span>
            )}
            <p className="text-[16px] font-bold text-[#E5E7EB]">
              {product.name}
            </p>
          </div>
          <p className="text-[13px] text-[#9CA3AF] text-center mb-1">
            {memberName}
          </p>
          <p className="text-[12px] text-[#6B7280] text-center">
            Show this to staff to log your purchase
          </p>
        </div>
      </div>
    </div>
  );
}
