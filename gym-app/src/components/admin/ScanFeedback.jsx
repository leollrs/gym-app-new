import { useState, useEffect, useCallback, useRef } from 'react';
import { ScanLine, CheckCircle, XCircle, LogIn, ShoppingBag, Gift, Users, Ticket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import useBarcodeScanner from '../../hooks/useBarcodeScanner';
import { handleScannedValue } from '../../lib/scanRouter';
import { dispatchScanAction } from '../../lib/scanActionHandlers';
import { dispatchToIntegration } from '../../lib/integrationBridge';
import { adminKeys } from '../../lib/adminQueryKeys';
import { useScanClaimContext } from '../../contexts/ScanClaimContext';

// ── Sound feedback ───────────────────────────────────────
function playBeep(frequency = 880, duration = 0.15) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch { /* AudioContext not available */ }
}

const playSuccess = () => playBeep(880, 0.15);
const playError = () => playBeep(330, 0.3);

// Action-specific config for toast display
const ACTION_CONFIG = {
  checkin:            { icon: LogIn,       color: '#8B5CF6', label: 'Check-in' },
  purchase:           { icon: ShoppingBag, color: '#D4AF37', label: 'Purchase' },
  reward_redemption:  { icon: Gift,        color: '#10B981', label: 'Reward' },
  referral:           { icon: Users,       color: '#3B82F6', label: 'Referral' },
  voucher:            { icon: Ticket,      color: '#F59E0B', label: 'Voucher' },
};

/**
 * ScanFeedback — overlay toast + scanner indicator for physical USB scanners.
 * Mount at the AdminLayout level so it works on any admin page.
 */
export default function ScanFeedback() {
  const { profile } = useAuth();
  const { t } = useTranslation('pages');
  const queryClient = useQueryClient();
  const [toast, setToast] = useState(null);
  const [processing, setProcessing] = useState(false);
  const dismissTimer = useRef(null);

  const scanClaim = useScanClaimContext();
  const gymId = profile?.gym_id;
  const adminId = profile?.id;

  const handleScan = useCallback(async (rawText) => {
    // If a form has claimed the scan, route to it instead
    if (scanClaim?.tryClaim(rawText)) return;

    if (!gymId || !adminId || processing) return;
    setProcessing(true);

    try {
      // Parse and verify the scanned payload
      let errorMsg = null;
      const parsed = await handleScannedValue(rawText, (err) => { errorMsg = err; });

      if (errorMsg && !parsed) {
        playError();
        setToast({ success: false, message: errorMsg });
        setProcessing(false);
        return;
      }

      if (!parsed) {
        playError();
        setToast({ success: false, message: t('admin.scan.unrecognized', 'Unrecognized QR code') });
        setProcessing(false);
        return;
      }

      // Password reset scans are handled by existing modal flow, not here
      if (parsed.type === 'password_reset') {
        setProcessing(false);
        return;
      }

      // Dispatch to the appropriate action handler
      const ctx = { gymId, adminId, supabase, t };
      const result = await dispatchScanAction(parsed, ctx);

      if (result.success) {
        playSuccess();
        // Invalidate admin caches so overview/attendance update
        queryClient.invalidateQueries({ queryKey: adminKeys.overview(gymId) });
        queryClient.invalidateQueries({ queryKey: adminKeys.attendance(gymId) });
        if (parsed.type === 'purchase') {
          queryClient.invalidateQueries({ queryKey: adminKeys.store.all(gymId) });
        }
      } else {
        playError();
      }

      setToast({
        success: result.success,
        message: result.message,
        memberName: result.memberName,
        memberId: result.memberId,
        avatarUrl: result.avatarUrl,
        actionType: parsed.type,
        data: result.data,
      });

      // Fire-and-forget: dispatch to external integration if configured
      if (result.success && result.externalPayload) {
        dispatchToIntegration(gymId, parsed.type, result.externalPayload);
      }
    } catch (err) {
      playError();
      setToast({ success: false, message: err.message || 'Scan processing failed' });
    } finally {
      setProcessing(false);
    }
  }, [gymId, adminId, processing, t, queryClient]);

  const { isConnected } = useBarcodeScanner({
    onScan: handleScan,
    enabled: !!gymId && !!adminId,
  });

  // Auto-dismiss toast after 5s
  useEffect(() => {
    if (!toast) return;
    clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(dismissTimer.current);
  }, [toast]);

  const actionCfg = toast?.actionType ? ACTION_CONFIG[toast.actionType] : null;
  const ActionIcon = actionCfg?.icon;

  return (
    <>
      {/* Scanner connection indicator */}
      {isConnected && (
        <div className="fixed top-2 right-2 z-[80] md:fixed md:top-4 md:right-4 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full"
          style={{ background: 'color-mix(in srgb, var(--color-success) 12%, var(--color-bg-card))', border: '1px solid color-mix(in srgb, var(--color-success) 20%, transparent)' }}>
          <ScanLine size={12} style={{ color: 'var(--color-success)' }} />
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--color-success)' }} />
          <span className="text-[10px] font-semibold hidden md:inline" style={{ color: 'var(--color-success)' }}>
            {t('admin.scan.scannerConnected', 'Scanner')}
          </span>
        </div>
      )}

      {/* Scan result toast overlay */}
      {toast && (
        <div className="fixed inset-x-0 top-0 z-[90] flex justify-center pt-4 px-4 pointer-events-none"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}>
          <div
            className="pointer-events-auto w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
            style={{
              background: 'var(--color-bg-card)',
              border: `1px solid ${toast.success
                ? `color-mix(in srgb, ${actionCfg?.color || 'var(--color-success)'} 25%, transparent)`
                : 'color-mix(in srgb, var(--color-danger) 25%, transparent)'}`,
            }}
            onClick={() => setToast(null)}
          >
            {/* Colored top accent bar */}
            <div className="h-1" style={{ background: toast.success ? (actionCfg?.color || 'var(--color-success)') : 'var(--color-danger)' }} />

            <div className="px-5 py-4">
              <div className="flex items-start gap-3.5">
                {/* Avatar with action badge */}
                <div className="relative flex-shrink-0">
                  {toast.avatarUrl ? (
                    <img src={toast.avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover" />
                  ) : toast.memberName ? (
                    <div className="w-12 h-12 rounded-full flex items-center justify-center"
                      style={{ background: `color-mix(in srgb, ${actionCfg?.color || 'var(--color-accent)'} 15%, transparent)` }}>
                      <span className="text-[16px] font-bold" style={{ color: actionCfg?.color || 'var(--color-accent)' }}>
                        {toast.memberName[0]?.toUpperCase()}
                      </span>
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-full flex items-center justify-center"
                      style={{ background: toast.success ? 'color-mix(in srgb, var(--color-success) 15%, transparent)' : 'color-mix(in srgb, var(--color-danger) 15%, transparent)' }}>
                      {toast.success
                        ? <CheckCircle size={22} style={{ color: 'var(--color-success)' }} />
                        : <XCircle size={22} style={{ color: 'var(--color-danger)' }} />}
                    </div>
                  )}
                  {/* Action type badge */}
                  {ActionIcon && toast.success && (
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center shadow-lg"
                      style={{ background: actionCfg.color, border: '2px solid var(--color-bg-card)' }}>
                      <ActionIcon size={11} color="#fff" />
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {/* Member name + action badge */}
                  <div className="flex items-center gap-2 mb-0.5">
                    {toast.memberName && (
                      <p className="text-[15px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                        {toast.memberName}
                      </p>
                    )}
                    {actionCfg && toast.success && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: `color-mix(in srgb, ${actionCfg.color} 15%, transparent)`, color: actionCfg.color }}>
                        {actionCfg.label}
                      </span>
                    )}
                  </div>

                  {/* Main message */}
                  <p className="text-[13px] leading-snug" style={{ color: 'var(--color-text-muted)' }}>
                    {toast.message}
                  </p>

                  {/* Extra details based on action type */}
                  {toast.success && toast.data && (
                    <div className="flex items-center gap-3 mt-2">
                      {toast.data.pointsEarned > 0 && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg"
                          style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', color: 'var(--color-accent)' }}>
                          +{toast.data.pointsEarned} pts
                        </span>
                      )}
                      {toast.data.punchCard && (
                        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-subtle)' }}>
                          Punch {toast.data.punchCard.current}/{toast.data.punchCard.target}
                        </span>
                      )}
                      {toast.data.freeReward && (
                        <span className="text-[11px] font-bold" style={{ color: 'var(--color-success)' }}>
                          {t('admin.scan.freeItemEarned', 'Free item earned!')}
                        </span>
                      )}
                      {toast.data.duplicate && (
                        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-subtle)' }}>
                          {t('admin.scan.duplicateNote', 'Already in today')}
                        </span>
                      )}
                      {toast.data.rewardName && (
                        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-subtle)' }}>
                          {toast.data.rewardName}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Status icon */}
                <div className="flex-shrink-0 mt-1">
                  {toast.success
                    ? <CheckCircle size={20} style={{ color: actionCfg?.color || 'var(--color-success)' }} />
                    : <XCircle size={20} style={{ color: 'var(--color-danger)' }} />}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Processing indicator */}
      {processing && (
        <div className="fixed inset-x-0 top-0 z-[85] flex justify-center pt-4 px-4 pointer-events-none"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}>
          <div className="w-full max-w-md rounded-2xl px-5 py-3.5 flex items-center gap-3"
            style={{ background: 'var(--color-bg-card)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}>
            <div className="w-5 h-5 border-2 rounded-full animate-spin flex-shrink-0"
              style={{ borderColor: 'color-mix(in srgb, var(--color-accent) 20%, transparent)', borderTopColor: 'var(--color-accent)' }} />
            <span className="text-[13px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.scan.processing', 'Processing scan...')}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
