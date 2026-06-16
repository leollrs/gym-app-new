import { useState, useEffect, useCallback, useRef } from 'react';
import { ScanLine, CheckCircle, XCircle, LogIn, ShoppingBag, Gift, Users, Ticket, X, Mail, Trophy, Printer, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import useBarcodeScanner from '../../hooks/useBarcodeScanner';
import { handleScannedValue } from '../../lib/scanRouter';
import { dispatchScanAction } from '../../lib/scanActionHandlers';
import { dispatchToIntegration } from '../../lib/integrationBridge';
import { dispatchToLocalBridge } from '../../lib/localBridge';
import { adminKeys } from '../../lib/adminQueryKeys';
import { logAdminAction } from '../../lib/adminAudit';
import { signCheckinPhoto } from '../../lib/checkinPhoto';
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
  checkin:            { icon: LogIn,       color: 'var(--color-coach)', label: 'Check-in' },
  purchase:           { icon: ShoppingBag, color: 'var(--color-accent)', label: 'Purchase' },
  reward_redemption:  { icon: Gift,        color: 'var(--color-success)', label: 'Reward' },
  referral:           { icon: Users,       color: 'var(--color-info)', label: 'Referral' },
  voucher:            { icon: Ticket,      color: 'var(--color-warning)', label: 'Voucher' },
  earned_reward:      { icon: Gift,        color: 'var(--color-success)', label: 'Reward' },
  challenge_prize:    { icon: Trophy,      color: 'var(--color-accent)', label: 'Prize' },
};

/**
 * Look up member info from a parsed scan without executing the action.
 * Used for the approval step.
 */
async function lookupMemberForScan(parsed, gymId) {
  if (parsed.type === 'checkin') {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, checkin_photo_path')
      .eq('gym_id', gymId)
      .eq('qr_code_payload', parsed.qrPayload)
      .single();
    // Sign the staff reference photo so the approval card can show the face.
    if (data?.checkin_photo_path) data._checkinPhotoUrl = await signCheckinPhoto(data.checkin_photo_path);
    return data;
  }
  if (parsed.type === 'purchase') {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, checkin_photo_path')
      .eq('id', parsed.memberId)
      .eq('gym_id', gymId)
      .single();
    // Also look up product name
    const { data: product } = await supabase
      .from('gym_products')
      .select('name')
      .eq('id', parsed.productId)
      .single();
    if (data) {
      data._productName = product?.name;
      if (data.checkin_photo_path) data._checkinPhotoUrl = await signCheckinPhoto(data.checkin_photo_path);
    }
    return data;
  }
  return null;
}

/**
 * Build the toast for a benign double-scan (same signed QR re-scanned before
 * its single-use nonce aged out). Renders as a SUCCESS-style check-in toast
 * with the "already checked in today" copy — the same friendly outcome a
 * within-3h re-scan produces — instead of a red invalid-QR error.
 *
 * Best-effort member lookup: a check-in payload lets us name the member; any
 * lookup failure (or a non-check-in original) just falls back to a generic
 * "already scanned" line. Never throws — the caller is on the no-freeze path.
 */
async function buildAlreadyScannedToast(original, gymId, t) {
  // Default: generic, no name.
  const generic = {
    success: true,
    actionType: original?.type === 'checkin' ? 'checkin' : undefined,
    message: t('admin.scan.alreadyScanned', 'Already scanned — this code was just used'),
    data: { duplicate: true },
  };
  try {
    if (original?.type === 'checkin' && original.qrPayload && gymId) {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('gym_id', gymId)
        .eq('qr_code_payload', original.qrPayload)
        .maybeSingle();
      if (data?.full_name) {
        return {
          success: true,
          actionType: 'checkin',
          memberName: data.full_name,
          avatarUrl: data.avatar_url || null,
          message: t('admin.scan.alreadyCheckedIn', '{{name}} already checked in today', { name: data.full_name }),
          data: { duplicate: true },
        };
      }
    }
  } catch { /* fall through to generic */ }
  return generic;
}

export default function ScanFeedback() {
  const { profile } = useAuth();
  const { t } = useTranslation('pages');
  const queryClient = useQueryClient();
  const scanClaim = useScanClaimContext();
  const navigate = useNavigate();

  // States: null → pending (approval) → processing → toast (result)
  const [pending, setPending] = useState(null);   // { parsed, member } — waiting for approval
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState(null);        // result toast
  const [deliveringId, setDeliveringId] = useState(null); // card id currently being flipped to delivered
  const dismissTimer = useRef(null);

  const gymId = profile?.gym_id;
  const adminId = profile?.id;

  // Flip a queued card from 'printed' to 'delivered' the moment the front
  // desk hands it over. Mutates the toast state in place so the row
  // disappears immediately — feels instant, no spinner waiting for re-fetch.
  const markCardDelivered = useCallback(async (cardId) => {
    if (!cardId || !gymId) return;
    setDeliveringId(cardId);
    const { error } = await supabase
      .from('print_cards')
      .update({ status: 'delivered', delivered_at: new Date().toISOString(), delivered_by: adminId ?? null })
      .eq('id', cardId)
      .eq('gym_id', gymId);
    setDeliveringId(null);
    if (error) {
      // Don't yank the row on failure — let the admin retry or dismiss
      return;
    }
    logAdminAction('print_cards_delivered_at_checkin', 'print_card', cardId);
    queryClient.invalidateQueries({ queryKey: adminKeys.printCards(gymId) });
    setToast((prev) => {
      if (!prev) return prev;
      const nextCards = (prev.data?.cardsToDeliver || []).filter((c) => c.id !== cardId);
      const stillPending = (prev.data?.cardsPending?.length ?? 0) > 0;
      // If that was the last deliverable card AND nothing's still queued to
      // print, auto-dismiss; otherwise keep the toast open so the admin can
      // deliver the rest (or read the print nudge) before scanning next person.
      if (nextCards.length === 0 && !stillPending && (prev.data?.cardsToDeliver?.length ?? 0) > 0) {
        return null;
      }
      return { ...prev, data: { ...prev.data, cardsToDeliver: nextCards } };
    });
  }, [gymId, adminId, queryClient]);

  // Jump to the Print Cards page (lands on the "To print" tab) so the front
  // desk can print/grab the pending card. Closes the toast on the way out so
  // it doesn't linger over the page they just navigated to.
  const goToPrintCards = useCallback(() => {
    setToast(null);
    navigate('/admin/print-cards');
  }, [navigate]);

  // ── Handle incoming scan ──────────────────────────────
  const handleScan = useCallback(async (rawText) => {
    // tryClaim is the only thing that runs before the busy-guard, so wrap it:
    // a throw here would escape to the ErrorBoundary and force an app restart.
    try { if (scanClaim?.tryClaim(rawText)) return; } catch { /* ignore claim errors */ }
    if (!gymId || !adminId || processing || pending) return;

    try {
      let errorMsg = null;
      const parsed = await handleScannedValue(rawText, (err) => { errorMsg = err; });

      // Benign double-scan: same signed QR scanned again before its single-use
      // nonce aged out. NOT an error — show the same "already checked in"
      // message a within-3h re-scan gets, and (critically) DO NOT freeze the
      // scanner. We fall through the busy-guard cleanly because we never set
      // `pending`/`processing` on this path.
      if (parsed?.type === 'already_scanned') {
        playAlert();
        const friendly = await buildAlreadyScannedToast(parsed.original, gymId, t);
        setToast(friendly);
        return;
      }

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
      setToast({ success: false, message: err?.message || t('admin.scan.scanFailed', 'Scan processing failed') });
    } finally {
      // Always release the scanner. Both `processing` and `pending` are reset
      // so NO error/early-exit path can leave the busy-guard latched (which is
      // what forced the "close and reopen the app" recovery). `pending` is only
      // set on the approval path, which returns before this runs — but resetting
      // it here too is a cheap, defensive belt-and-suspenders against any future
      // path that throws after setPending.
      setProcessing(false);
    }
  }, [gymId, adminId, processing, pending, t, scanClaim]);

  // ── Approve pending action ────────────────────────────
  const handleApprove = useCallback(async () => {
    if (!pending) return;
    const { parsed } = pending;
    // Carry the already-signed reference photo into the success toast so the
    // confirmed check-in keeps showing the same face (no second sign round-trip).
    const photoOverride = pending.member?._checkinPhotoUrl || null;
    // Clear the approval modal FIRST. This is what un-latches the scanner's
    // busy-guard (`if (... || pending) return`); doing it before any await
    // guarantees the scanner is never stuck waiting on a network round-trip,
    // and that a throw below can't strand `pending` set forever (the bug that
    // forced an app restart).
    setPending(null);
    setProcessing(true);

    try {
      const ctx = { gymId, adminId, supabase, t };
      const result = await dispatchScanAction(parsed, ctx);
      handleResult(parsed, result, photoOverride);
    } catch (err) {
      try {
        playError();
        setToast({ success: false, message: err?.message || t('admin.scan.actionFailed', 'Action failed') });
      } catch { /* never let toast/beep failure escape to the ErrorBoundary */ }
    } finally {
      setProcessing(false);
    }
  }, [pending, gymId, adminId, t]);

  // ── Deny pending action ───────────────────────────────
  const handleDeny = useCallback(() => {
    setPending(null);
  }, []);

  // ── Process result (shared by immediate + approved) ───
  const handleResult = useCallback((parsed, result, photoOverride = null) => {
    // Defensive: dispatchScanAction always returns an object, but a null/undefined
    // result here would throw a TypeError on `result.success` and — depending on
    // the caller's try boundary — could bubble to the ErrorBoundary and restart
    // the app. Treat a missing result as a soft failure instead.
    if (!result) {
      try { playError(); } catch { /* no-op */ }
      setToast({ success: false, message: t('admin.scan.scanFailed', 'Scan processing failed') });
      return;
    }
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
      avatarUrl: photoOverride || result.avatarUrl,
      actionType: parsed.type,
      data: result.data,
    });

    if (result.success && result.externalPayload) {
      // Wrapped so a synchronous throw from either bridge can't escape this
      // result handler (and thus the surrounding try) into the ErrorBoundary.
      // Both are fire-and-forget side effects — the check-in already succeeded.
      try {
        // Cloud integrations (Mindbody, ClubReady, etc.) via gym_integrations
        // table — server-to-server webhook from a Supabase edge function.
        dispatchToIntegration(gymId, parsed.type, result.externalPayload);
        // Local sidecar on the same machine — bridges to whatever legacy
        // gym software is running alongside TuGymPR. Fire-and-forget,
        // graceful no-op if the sidecar isn't running.
        dispatchToLocalBridge({
          gymId,
          action: parsed.type,
          payload: result.externalPayload,
        });
      } catch { /* integration delivery is best-effort; never block the scan */ }
    }
  }, [gymId, queryClient, t]);

  const { isConnected } = useBarcodeScanner({
    onScan: handleScan,
    enabled: !!gymId && !!adminId,
  });

  // Auto-dismiss result toast after 5s — UNLESS cards are queued for delivery
  // OR waiting to be printed. The whole point of the check-in prompt is for the
  // front desk to act on what's owed; an auto-dismiss would yank it before they
  // finish. Admin closes manually (X tap) or marks all deliverable cards done.
  useEffect(() => {
    if (!toast) return;
    const hasCards = (toast.data?.cardsToDeliver?.length ?? 0) > 0
      || (toast.data?.cardsPending?.length ?? 0) > 0;
    if (hasCards) return undefined;
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
              {/* Member info — for a check-in WITH a staff reference photo, show
                  it big so the front desk can match the face at a glance. */}
              {pending.parsed.type === 'checkin' && pending.member._checkinPhotoUrl ? (
                <div className="flex flex-col items-center text-center mb-5">
                  <div className="relative">
                    <img
                      src={pending.member._checkinPhotoUrl}
                      alt=""
                      className="w-40 h-40 rounded-2xl object-cover"
                      style={{ border: `3px solid ${pendingCfg?.color || 'var(--color-accent)'}` }}
                    />
                    {PendingIcon && (
                      <div className="absolute -bottom-2 -right-2 w-9 h-9 rounded-full flex items-center justify-center shadow-lg"
                        style={{ background: pendingCfg.color, border: '3px solid var(--color-bg-card)' }}>
                        <PendingIcon size={16} color="#fff" />
                      </div>
                    )}
                  </div>
                  <p className="text-[20px] font-bold mt-3 max-w-full truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {pending.member.full_name}
                  </p>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full mt-1"
                    style={{ background: `color-mix(in srgb, ${pendingCfg?.color} 15%, transparent)`, color: pendingCfg?.color }}>
                    {pendingCfg?.label}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-4 mb-5">
                  <div className="relative">
                    {(pending.member._checkinPhotoUrl || pending.member.avatar_url) ? (
                      <img src={pending.member._checkinPhotoUrl || pending.member.avatar_url} alt="" className="w-14 h-14 rounded-full object-cover" />
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
              )}

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
            // Tap-to-dismiss only when there's nothing to act on; if any card is
            // queued for delivery OR waiting to print, the toast stays put so the
            // admin can act — the inner card sections catch clicks separately.
            onClick={((toast.data?.cardsToDeliver?.length ?? 0) > 0 || (toast.data?.cardsPending?.length ?? 0) > 0) ? undefined : () => setToast(null)}
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
                      {/* Purchases are now queued for approval — they grant
                          nothing at scan time, so never show a points/punch/free
                          chip here. The cashier sees a "queued" flag instead and
                          the owner approves it from the Store queue. */}
                      {toast.actionType === 'purchase' ? (
                        toast.data.queued && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg"
                            style={{ background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', color: 'var(--color-warning)' }}>
                            {t('admin.scan.purchaseQueuedChip', 'Queued for approval')}
                          </span>
                        )
                      ) : (
                        <>
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
                        </>
                      )}
                    </div>
                  )}
                  {/* Pending-referee flag — this member was referred by someone and
                      the referral hasn't completed yet. Surfaced here so the desk
                      can approve it on the Referrals page. */}
                  {toast.success && toast.data?.pendingReferral && (
                    <div
                      className="mt-2 flex items-center gap-1.5 px-2 py-1 rounded-lg"
                      style={{
                        background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--color-warning) 22%, transparent)',
                      }}
                    >
                      <Gift size={12} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
                      <span className="text-[11px] font-semibold leading-tight" style={{ color: 'var(--color-warning)' }}>
                        {toast.data.pendingReferral.referrerName
                          ? t('admin.scan.pendingReferralBy', { name: toast.data.pendingReferral.referrerName, defaultValue: 'Pending referral — referred by {{name}}' })
                          : t('admin.scan.pendingReferral', 'Pending referral — approve on the Referrals page')}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex-shrink-0 mt-1">
                  {toast.success
                    ? <CheckCircle size={20} style={{ color: toastCfg?.color || 'var(--color-success)' }} />
                    : <XCircle size={20} style={{ color: 'var(--color-danger)' }} />}
                </div>
              </div>

              {/* Cards-to-deliver — the moment the whole print-card system
                  exists for. Front desk sees what's waiting in inventory
                  for this member and hands it over in the same breath as
                  the check-in. One tap marks delivered + drops the row. */}
              {(toast.data?.cardsToDeliver?.length ?? 0) > 0 && (
                <div
                  className="mt-3 pt-3"
                  style={{ borderTop: '1px solid var(--color-border-subtle)' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <Mail size={12} style={{ color: 'var(--color-accent)' }} />
                    <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent)' }}>
                      {t('admin.scan.cardsToDeliverTitle', { count: toast.data.cardsToDeliver.length, defaultValue: 'Card to hand over' })}
                    </p>
                  </div>
                  <ul className="space-y-2">
                    {toast.data.cardsToDeliver.map((card) => {
                      const isDelivering = deliveringId === card.id;
                      return (
                        <li
                          key={card.id}
                          className="flex items-start gap-2.5 rounded-xl px-3 py-2.5"
                          style={{
                            background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)',
                            border: '1px solid color-mix(in srgb, var(--color-accent) 14%, transparent)',
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent)' }}>
                              {t(`admin.printCards.occasions.${card.occasion}`, card.occasion)}
                            </p>
                            <p className="text-[13px] font-semibold leading-snug mt-0.5" style={{ color: 'var(--color-text-primary)' }}>
                              "{card.headline}"
                            </p>
                            {card.reward_label && (
                              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                                + {card.reward_label}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => markCardDelivered(card.id)}
                            disabled={isDelivering}
                            className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 disabled:opacity-50"
                            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
                          >
                            {isDelivering
                              ? t('admin.scan.cardDelivering', { defaultValue: '...' })
                              : t('admin.scan.cardDeliver', { defaultValue: 'Handed over' })}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Cards waiting to print — generated for an occasion (birthday,
                  milestone, returning…) but NOT yet printed, so there's nothing
                  to physically hand over. This is a NUDGE: tell the desk
                  something is owed so they go print/grab it. No hand-over button
                  by design — you can't deliver a card that doesn't exist yet. */}
              {(toast.data?.cardsPending?.length ?? 0) > 0 && (
                <div
                  className="mt-3 pt-3"
                  style={{ borderTop: '1px solid var(--color-border-subtle)' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <Printer size={12} style={{ color: 'var(--color-warning)' }} />
                    <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-warning)' }}>
                      {t('admin.scan.cardsPendingTitle', { count: toast.data.cardsPending.length, defaultValue: 'Card waiting to print' })}
                    </p>
                  </div>
                  <ul className="space-y-2">
                    {toast.data.cardsPending.map((card) => (
                      <li key={card.id}>
                        <button
                          type="button"
                          onClick={goToPrintCards}
                          className="w-full flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition active:scale-[0.99]"
                          style={{
                            background: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
                            border: '1px solid color-mix(in srgb, var(--color-warning) 18%, transparent)',
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-warning)' }}>
                              {t(`admin.printCards.occasions.${card.occasion}`, card.occasion)}
                            </p>
                            <p className="text-[13px] font-semibold leading-snug mt-0.5" style={{ color: 'var(--color-text-primary)' }}>
                              "{card.headline}"
                            </p>
                            {card.reward_label && (
                              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                                + {card.reward_label}
                              </p>
                            )}
                          </div>
                          <ChevronRight size={16} style={{ color: 'var(--color-warning)', flexShrink: 0, marginTop: 1 }} />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10.5px] mt-2 leading-snug" style={{ color: 'var(--color-text-subtle)' }}>
                    {t('admin.scan.cardsPendingHint', { defaultValue: 'Not printed yet — tap to open the Cards page and print it.' })}
                  </p>
                </div>
              )}

              {/* Shared close — shown whenever any card (deliverable or pending)
                  is on the toast, since neither auto-dismisses. */}
              {((toast.data?.cardsToDeliver?.length ?? 0) > 0 || (toast.data?.cardsPending?.length ?? 0) > 0) && (
                <button
                  onClick={() => setToast(null)}
                  className="mt-2 w-full text-center py-1.5 rounded-lg text-[11px] font-medium transition-colors"
                  style={{ color: 'var(--color-text-subtle)' }}
                >
                  {t('admin.scan.cardDismissLater', { defaultValue: 'Close (hand over later)' })}
                </button>
              )}
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
