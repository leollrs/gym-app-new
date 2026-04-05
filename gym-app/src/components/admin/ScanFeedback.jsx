import { useState, useEffect, useCallback, useRef } from 'react';
import { ScanLine, CheckCircle, XCircle, LogIn, ShoppingBag, Gift, Users, Ticket, X } from 'lucide-react';
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
const playAlert = () => playBeep(660, 0.2);

// Action types that require admin approval before processing
const REQUIRES_APPROVAL = new Set(['checkin', 'purchase']);

// Action-specific config for display
const ACTION_CONFIG = {
  checkin:            { icon: LogIn,       color: '#8B5CF6', label: 'Check-in' },
  purchase:           { icon: ShoppingBag, color: '#D4AF37', label: 'Purchase' },
  reward_redemption:  { icon: Gift,        color: '#10B981', label: 'Reward' },
  referral:           { icon: Users,       color: '#3B82F6', label: 'Referral' },
  voucher:            { icon: Ticket,      color: '#F59E0B', label: 'Voucher' },
};

/**
 * Look up member info from a parsed scan without executing the action.
 * Used for the approval step.
 */
async function lookupMemberForScan(parsed, gymId) {
  if (parsed.type === 'checkin') {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .eq('gym_id', gymId)
      .eq('qr_code_payload', parsed.qrPayload)
      .single();
    return data;
  }
  if (parsed.type === 'purchase') {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .eq('id', parsed.memberId)
      .eq('gym_id', gymId)
      .single();
    // Also look up product name
    const { data: product } = await supabase
      .from('gym_products')
      .select('name')
      .eq('id', parsed.productId)
      .single();
    if (data) data._productName = product?.name;
    return data;
  }
  return null;
}

export default function ScanFeedback() {
  const { profile } = useAuth();
  const { t } = useTranslation('pages');
  const queryClient = useQueryClient();
  const scanClaim = useScanClaimContext();

  // States: null → pending (approval) → processing → toast (result)
  const [pending, setPending] = useState(null);   // { parsed, member } — waiting for approval
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState(null);        // result toast
  const dismissTimer = useRef(null);

  const gymId = profile?.gym_id;
  const adminId = profile?.id;

  // ── Handle incoming scan ──────────────────────────────
  const handleScan = useCallback(async (rawText) => {
    if (scanClaim?.tryClaim(rawText)) return;
    if (!gymId || !adminId || processing || pending) return;

    try {
      let errorMsg = null;
      const parsed = await handleScannedValue(rawText, (err) => { errorMsg = err; });

      if (errorMsg && !parsed) {
        playError();
        setToast({ success: false, message: errorMsg });
        return;
      }
      if (!parsed) {
        playError();
        setToast({ success: false, message: t('admin.scan.unrecognized', 'Unrecognized QR code') });
        return;
      }
      if (parsed.type === 'password_reset') return;

      // Actions that need approval: show confirmation first
      if (REQUIRES_APPROVAL.has(parsed.type)) {
        playAlert();
        const member = await lookupMemberForScan(parsed, gymId);
        if (!member) {
          playError();
          setToast({ success: false, message: t('admin.scan.memberNotFound', 'Member not found') });
          return;
        }
        setPending({ parsed, member });
        return;
      }

      // Other actions (reward, referral, voucher): execute immediately
      setProcessing(true);
      const ctx = { gymId, adminId, supabase, t };
      const result = await dispatchScanAction(parsed, ctx);
      handleResult(parsed, result);
    } catch (err) {
      playError();
      setToast({ success: false, message: err.message || 'Scan processing failed' });
    } finally {
      setProcessing(false);
    }
  }, [gymId, adminId, processing, pending, t, scanClaim]);

  // ── Approve pending action ────────────────────────────
  const handleApprove = useCallback(async () => {
    if (!pending) return;
    const { parsed } = pending;
    setPending(null);
    setProcessing(true);

    try {
      const ctx = { gymId, adminId, supabase, t };
      const result = await dispatchScanAction(parsed, ctx);
      handleResult(parsed, result);
    } catch (err) {
      playError();
      setToast({ success: false, message: err.message || 'Action failed' });
    } finally {
      setProcessing(false);
    }
  }, [pending, gymId, adminId, t]);

  // ── Deny pending action ───────────────────────────────
  const handleDeny = useCallback(() => {
    setPending(null);
  }, []);

  // ── Process result (shared by immediate + approved) ───
  const handleResult = useCallback((parsed, result) => {
    if (result.success) {
      playSuccess();
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

    if (result.success && result.externalPayload) {
      dispatchToIntegration(gymId, parsed.type, result.externalPayload);
    }
  }, [gymId, queryClient]);

  const { isConnected } = useBarcodeScanner({
    onScan: handleScan,
    enabled: !!gymId && !!adminId,
  });

  // Auto-dismiss result toast after 5s
  useEffect(() => {
    if (!toast) return;
    clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(dismissTimer.current);
  }, [toast]);

  const pendingCfg = pending ? ACTION_CONFIG[pending.parsed.type] : null;
  const PendingIcon = pendingCfg?.icon;
  const toastCfg = toast?.actionType ? ACTION_CONFIG[toast.actionType] : null;
  const ToastIcon = toastCfg?.icon;

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

      {/* ── APPROVAL MODAL — check-in & purchase ─────────── */}
      {pending && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: 'var(--color-bg-card)', border: `1px solid color-mix(in srgb, ${pendingCfg?.color || 'var(--color-accent)'} 30%, transparent)` }}>

            {/* Accent bar */}
            <div className="h-1.5" style={{ background: pendingCfg?.color || 'var(--color-accent)' }} />

            <div className="px-6 py-5">
              {/* Member info */}
              <div className="flex items-center gap-4 mb-5">
                <div className="relative">
                  {pending.member.avatar_url ? (
                    <img src={pending.member.avatar_url} alt="" className="w-14 h-14 rounded-full object-cover" />
                  ) : (
                    <div className="w-14 h-14 rounded-full flex items-center justify-center"
                      style={{ background: `color-mix(in srgb, ${pendingCfg?.color || 'var(--color-accent)'} 15%, transparent)` }}>
                      <span className="text-[20px] font-bold" style={{ color: pendingCfg?.color || 'var(--color-accent)' }}>
                        {pending.member.full_name?.[0]?.toUpperCase()}
                      </span>
                    </div>
                  )}
                  {PendingIcon && (
                    <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center shadow-lg"
                      style={{ background: pendingCfg.color, border: '2.5px solid var(--color-bg-card)' }}>
                      <PendingIcon size={13} color="#fff" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[17px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {pending.member.full_name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                      style={{ background: `color-mix(in srgb, ${pendingCfg?.color} 15%, transparent)`, color: pendingCfg?.color }}>
                      {pendingCfg?.label}
                    </span>
                    {pending.member._productName && (
                      <span className="text-[12px] truncate" style={{ color: 'var(--color-text-muted)' }}>
                        {pending.member._productName}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Confirmation text */}
              <p className="text-[13px] text-center mb-5" style={{ color: 'var(--color-text-muted)' }}>
                {pending.parsed.type === 'checkin'
                  ? t('admin.scan.confirmCheckin', 'Confirm check-in for this member?')
                  : t('admin.scan.confirmPurchase', 'Confirm this purchase?')}
              </p>

              {/* Action buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleDeny}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold transition-colors"
                  style={{ background: 'var(--color-bg-input)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                  <X size={16} />
                  {t('admin.scan.deny', 'Cancel')}
                </button>
                <button
                  onClick={handleApprove}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-bold transition-all active:scale-[0.97]"
                  style={{ background: pendingCfg?.color || 'var(--color-accent)', color: '#fff' }}>
                  <CheckCircle size={16} />
                  {t('admin.scan.approve', 'Approve')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── RESULT TOAST ─────────────────────────────────── */}
      {toast && (
        <div className="fixed inset-x-0 top-0 z-[90] flex justify-center pt-4 px-4 pointer-events-none"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}>
          <div
            className="pointer-events-auto w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
            style={{
              background: 'var(--color-bg-card)',
              border: `1px solid ${toast.success
                ? `color-mix(in srgb, ${toastCfg?.color || 'var(--color-success)'} 25%, transparent)`
                : 'color-mix(in srgb, var(--color-danger) 25%, transparent)'}`,
            }}
            onClick={() => setToast(null)}
          >
            <div className="h-1" style={{ background: toast.success ? (toastCfg?.color || 'var(--color-success)') : 'var(--color-danger)' }} />

            <div className="px-5 py-4">
              <div className="flex items-start gap-3.5">
                <div className="relative flex-shrink-0">
                  {toast.avatarUrl ? (
                    <img src={toast.avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover" />
                  ) : toast.memberName ? (
                    <div className="w-12 h-12 rounded-full flex items-center justify-center"
                      style={{ background: `color-mix(in srgb, ${toastCfg?.color || 'var(--color-accent)'} 15%, transparent)` }}>
                      <span className="text-[16px] font-bold" style={{ color: toastCfg?.color || 'var(--color-accent)' }}>
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
                  {ToastIcon && toast.success && (
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center shadow-lg"
                      style={{ background: toastCfg.color, border: '2px solid var(--color-bg-card)' }}>
                      <ToastIcon size={11} color="#fff" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {toast.memberName && (
                      <p className="text-[15px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                        {toast.memberName}
                      </p>
                    )}
                    {toastCfg && toast.success && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: `color-mix(in srgb, ${toastCfg.color} 15%, transparent)`, color: toastCfg.color }}>
                        {toastCfg.label}
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] leading-snug" style={{ color: 'var(--color-text-muted)' }}>
                    {toast.message}
                  </p>
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
                    </div>
                  )}
                </div>

                <div className="flex-shrink-0 mt-1">
                  {toast.success
                    ? <CheckCircle size={20} style={{ color: toastCfg?.color || 'var(--color-success)' }} />
                    : <XCircle size={20} style={{ color: 'var(--color-danger)' }} />}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Processing spinner */}
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
