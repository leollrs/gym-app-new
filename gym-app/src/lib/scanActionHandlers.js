/**
 * Scan Action Handlers — business logic for each scan type.
 * Used by both the physical scanner (ScanFeedback) and camera scanner (QRScannerModal).
 *
 * Each handler receives: (parsed, ctx) where ctx = { gymId, adminId, supabase, t }
 * Each returns: { success, message, memberName?, data?, externalPayload? }
 */
import { addPoints, calculatePointsForAction } from './rewardsEngine';
import logger from './logger';
import { logAdminAction } from './adminAudit';

// Look up cards waiting for this member at check-in, in ONE query. Used by the
// check-in flow so the front desk sees what's owed the moment a member scans in
// — the actual moment the whole print-card system exists for. Split by status:
//   • printed → physically printed + signed, in inventory: hand it over now.
//   • pending → generated but not yet printed: a nudge so the desk knows
//     something is owed even when nobody pre-printed it (go print/grab it).
async function fetchCardsForMemberCheckin(supabase, gymId, memberId) {
  const { data } = await supabase
    .from('print_cards')
    .select('id, occasion, headline, subline, reward_label, status')
    .eq('gym_id', gymId)
    .eq('profile_id', memberId)
    .in('status', ['printed', 'pending'])
    .order('created_at', { ascending: true });
  const rows = data || [];
  return {
    cardsToDeliver: rows.filter((c) => c.status === 'printed'),
    cardsPending: rows.filter((c) => c.status === 'pending'),
  };
}

// Surface whether the member being checked in is a still-pending referee —
// i.e. someone referred them and the referral hasn't completed yet. Shown on
// the scan toast so the front desk sees it at the same moment-of-truth as
// points/cards (and can approve it on the Referrals page). Admin RLS ("Admins
// can see gym referrals", 0117) allows this read; non-fatal on any failure.
async function fetchPendingReferral(supabase, gymId, memberId) {
  try {
    const { data: ref } = await supabase
      .from('referrals')
      .select('id, referrer_id')
      .eq('gym_id', gymId)
      .eq('referred_id', memberId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!ref) return null;
    let referrerName = null;
    if (ref.referrer_id) {
      const { data: referrer } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', ref.referrer_id)
        .maybeSingle();
      referrerName = referrer?.full_name || null;
    }
    return { id: ref.id, referrerName };
  } catch {
    return null;
  }
}

// Fallback for gyms configured with qr_payload_type = external_id /
// custom_template: those members' passes display their RAW gym door code
// (profiles.qr_external_id), which never matches qr_code_payload. Route the
// scan through checkin_by_external_id (0371/0471) — the same SECURITY DEFINER
// RPC the desktop bridge uses: staff-only, scoped to the caller's gym, with
// the identical 3-hour duplicate guard + 24h-checked points budget as the
// JS path below. Returns null when nothing matched (caller shows not-found).
async function tryExternalIdCheckin(scanned, ctx) {
  const { gymId, supabase, t } = ctx;
  const code = typeof scanned === 'string' ? scanned.trim() : '';
  // Bounded: plain short codes only. Signed payloads carry a `|signature`
  // and never reach here; URLs/JSON blobs are skipped by the length guard.
  if (!code || code.length > 64 || code.includes('|')) return null;
  try {
    const { data, error } = await supabase.rpc('checkin_by_external_id', {
      p_external_id: code,
      p_source: 'admin_scanner',
    });
    // RPC missing (pre-0371 deploy), staff/gym rejection, or member_not_found
    // → fall through to the generic not-found message.
    if (error || !data || data.success !== true || !data.profile_id) return null;

    const { cardsToDeliver, cardsPending } = await fetchCardsForMemberCheckin(supabase, gymId, data.profile_id);
    const pendingReferral = await fetchPendingReferral(supabase, gymId, data.profile_id);
    if (data.duplicate) {
      return {
        success: true,
        message: t('admin.scan.alreadyCheckedIn', '{{name}} already checked in today', { name: data.member_name }),
        memberName: data.member_name,
        memberId: data.profile_id,
        avatarUrl: data.avatar_url,
        data: { duplicate: true, cardsToDeliver, cardsPending, pendingReferral },
      };
    }

    logAdminAction('checkin_scan', 'member', data.profile_id);

    const pointsAwarded = Number(data.points_awarded) || 0;
    const msg = pointsAwarded > 0
      ? t('admin.scan.checkinSuccess', '{{name}} checked in! +{{pts}}pts', { name: data.member_name, pts: pointsAwarded })
      : t('admin.scan.checkinSuccessNoPoints', '{{name}} checked in!', { name: data.member_name });

    return {
      success: true,
      message: msg,
      memberName: data.member_name,
      memberId: data.profile_id,
      avatarUrl: data.avatar_url,
      data: { pointsEarned: pointsAwarded, cardsToDeliver, cardsPending, pendingReferral },
      externalPayload: { action: 'checkin', memberId: data.profile_id, memberExternalId: data.external_id, memberName: data.member_name, timestamp: new Date().toISOString(), data: { pointsEarned: pointsAwarded } },
    };
  } catch (err) {
    logger.warn('checkin_by_external_id fallback failed:', err?.message);
    return null;
  }
}

// ── Check-in ─────────────────────────────────────────────
export async function handleCheckinScan(parsed, ctx) {
  const { gymId, supabase, t } = ctx;

  // Look up member by qr_code_payload
  const { data: member, error: memberErr } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, qr_external_id')
    .eq('gym_id', gymId)
    .eq('qr_code_payload', parsed.qrPayload)
    .single();

  if (memberErr || !member) {
    // No qr_code_payload match — the scan may be a RAW external-id code
    // (gyms.qr_payload_type external_id/custom_template). Try the bounded
    // gym-scoped reverse lookup before giving up.
    const externalResult = await tryExternalIdCheckin(parsed.qrPayload, ctx);
    if (externalResult) return externalResult;
    return { success: false, message: t('admin.scan.memberNotFound', 'Member not found') };
  }

  // Rate limit: 1 check-in per 3 hours (prevents accidental double-scans)
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from('check_ins')
    .select('id')
    .eq('profile_id', member.id)
    .eq('gym_id', gymId)
    .gte('checked_in_at', threeHoursAgo)
    .limit(1);

  if (recent?.length > 0) {
    // Cards still need delivering even on duplicate check-in — the member
    // might be back at the desk for another reason and we shouldn't lose
    // the chance to hand off what's in inventory.
    const { cardsToDeliver, cardsPending } = await fetchCardsForMemberCheckin(supabase, gymId, member.id);
    const pendingReferral = await fetchPendingReferral(supabase, gymId, member.id);
    return {
      success: true,
      message: t('admin.scan.alreadyCheckedIn', '{{name}} already checked in today', { name: member.full_name }),
      memberName: member.full_name,
      memberId: member.id,
      avatarUrl: member.avatar_url,
      data: { duplicate: true, cardsToDeliver, cardsPending, pendingReferral },
    };
  }

  // Record check-in (points limited to once per 24hr via add_reward_points_checked)
  const { error: insertErr } = await supabase
    .from('check_ins')
    .insert({ profile_id: member.id, gym_id: gymId, method: 'qr' });

  if (insertErr) {
    logger.error('Check-in insert failed:', insertErr);
    return { success: false, message: t('admin.scan.checkinFailed', 'Check-in failed') };
  }

  // Award points (24hr limit enforced server-side via add_reward_points_checked).
  // supabase.rpc returns { data, error } — it does NOT throw on RPC error, so
  // we must check `error` explicitly. Previously we only destructured `data`
  // and silently lied to the admin ("+20pts") when the RPC actually failed.
  const pts = calculatePointsForAction('check_in');
  let pointsAwarded = pts;
  try {
    const { data: ptsResult, error: ptsErr } = await supabase.rpc('add_reward_points_checked', {
      p_user_id: member.id,
      p_gym_id: gymId,
      p_action: 'check_in',
      p_points: pts,
      p_description: 'QR check-in',
    });
    if (ptsErr) {
      logger.warn('add_reward_points_checked RPC error, falling back to addPoints:', ptsErr.message);
      const fallbackPts = await addPoints(member.id, gymId, 'check_in', pts, 'QR check-in');
      if (fallbackPts == null) pointsAwarded = 0;
    } else if (ptsResult === 0) {
      // RPC succeeded but 24h dedup kicked in
      pointsAwarded = 0;
    }
  } catch (err) {
    // Network/throw fallback
    logger.warn('add_reward_points_checked threw, falling back to addPoints:', err?.message);
    try {
      const fallbackPts = await addPoints(member.id, gymId, 'check_in', pts, 'QR check-in');
      if (fallbackPts == null) pointsAwarded = 0;
    } catch (fbErr) {
      logger.error('Both points paths failed:', fbErr);
      pointsAwarded = 0;
    }
  }

  logAdminAction('checkin_scan', 'member', member.id);

  // Fetch the member's cards (printed = hand over now, pending = print nudge)
  // so the toast can surface them. Awaited AFTER points so the check-in feels
  // fast — adds ~1 round trip but only on the success path.
  const { cardsToDeliver, cardsPending } = await fetchCardsForMemberCheckin(supabase, gymId, member.id);
  const pendingReferral = await fetchPendingReferral(supabase, gymId, member.id);

  const msg = pointsAwarded > 0
    ? t('admin.scan.checkinSuccess', '{{name}} checked in! +{{pts}}pts', { name: member.full_name, pts: pointsAwarded })
    : t('admin.scan.checkinSuccessNoPoints', '{{name}} checked in!', { name: member.full_name });

  return {
    success: true,
    message: msg,
    memberName: member.full_name,
    memberId: member.id,
    avatarUrl: member.avatar_url,
    data: { pointsEarned: pointsAwarded, cardsToDeliver, cardsPending, pendingReferral },
    externalPayload: { action: 'checkin', memberId: member.id, memberExternalId: member.qr_external_id, memberName: member.full_name, timestamp: new Date().toISOString(), data: { pointsEarned: pointsAwarded } },
  };
}

// ── Purchase ─────────────────────────────────────────────
export async function handlePurchaseScan(parsed, ctx) {
  const { gymId, adminId, supabase, t } = ctx;

  if (parsed.gymId !== gymId) {
    return { success: false, message: t('admin.scan.wrongGym', 'QR code is for a different gym') };
  }

  // Look up member
  const { data: member } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, qr_external_id')
    .eq('id', parsed.memberId)
    .eq('gym_id', gymId)
    .single();

  if (!member) {
    return { success: false, message: t('admin.scan.memberNotFound', 'Member not found') };
  }

  // Record purchase via RPC — it now logs the row as PENDING and grants
  // NOTHING (no points, no punch increment, no free reward, no wallet push).
  // Points/punch/free reward are only applied once an owner/admin approves
  // it from the Store → "Pending approvals" queue (approve_gym_purchase).
  const { error } = await supabase.rpc('record_gym_purchase', {
    p_gym_id: gymId,
    p_member_id: member.id,
    p_product_id: parsed.productId,
    p_recorded_by: adminId,
    p_quantity: 1,
  });

  if (error) {
    logger.error('Purchase record failed:', error);
    return { success: false, message: t('admin.scan.purchaseFailed', 'Purchase recording failed') };
  }

  logAdminAction('purchase_scan', 'member', member.id, { product: parsed.productId });

  // No wallet push and no points reported here — nothing has been granted
  // yet. The purchase is queued for an owner/admin to approve.
  return {
    success: true,
    message: t('admin.scan.purchaseQueued', '{{name}} — purchase queued for approval', { name: member.full_name }),
    memberName: member.full_name,
    memberId: member.id,
    avatarUrl: member.avatar_url,
    data: { queued: true },
    externalPayload: { action: 'purchase', memberId: member.id, memberExternalId: member.qr_external_id, memberName: member.full_name, timestamp: new Date().toISOString(), data: { productId: parsed.productId, queued: true } },
  };
}

// ── Reward Redemption ────────────────────────────────────
export async function handleRewardRedemptionScan(parsed, ctx) {
  const { gymId, supabase, t } = ctx;

  if (parsed.gymId !== gymId) {
    return { success: false, message: t('admin.scan.wrongGym', 'QR code is for a different gym') };
  }

  // Get member name up front (admin can read profiles in same gym)
  const { data: member } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, qr_external_id')
    .eq('id', parsed.memberId)
    .eq('gym_id', gymId)
    .single();

  if (!member) {
    return { success: false, message: t('admin.scan.memberNotFound', 'Member not found') };
  }

  // Guard: ensure the redemption row belongs to the member encoded in the QR
  // (prevents a stolen/forwarded QR from being claimed against the wrong member).
  const { data: redemptionRow, error: redemptionErr } = await supabase
    .from('reward_redemptions')
    .select('id, profile_id, gym_id')
    .eq('id', parsed.redemptionId)
    .maybeSingle();

  if (redemptionRow && !redemptionErr && redemptionRow.profile_id !== parsed.memberId) {
    return { success: false, message: t('admin.scan.rewardMemberMismatch', 'Reward does not match this member') };
  }

  // Claim via RPC directly — it's SECURITY DEFINER so it bypasses RLS
  // and handles all validation (status checks, permissions, point deduction)
  const { data: claimResult, error: claimErr } = await supabase.rpc('claim_redemption', {
    p_redemption_id: parsed.redemptionId,
  });

  if (claimErr) {
    const msg = claimErr.message || '';
    // Map known RPC errors to user-friendly messages
    if (msg.includes('already claimed') || msg.includes('Already claimed')) {
      return { success: false, message: t('admin.scan.alreadyClaimed', 'This reward was already claimed') };
    }
    if (msg.includes('cancelled')) {
      return { success: false, message: t('admin.scan.redemptionExpired', 'This redemption has expired or was cancelled') };
    }
    if (msg.includes('not found') || msg.includes('Not found')) {
      // Fallback: try referral_rewards (referral reward choice)
      const { data: referralReward } = await supabase
        .from('referral_rewards')
        .select('id, profile_id, reward_type, reward_value, choice_status')
        .eq('id', parsed.redemptionId)
        .eq('gym_id', gymId)
        .maybeSingle();

      if (referralReward) {
        if (referralReward.choice_status === 'chosen' || referralReward.choice_status === 'auto_assigned') {
          return { success: false, message: t('admin.scan.alreadyClaimed', 'This reward was already claimed') };
        }
        return {
          success: true,
          message: t('admin.scan.referralRewardPending', '{{name}} has a pending referral reward to pick', { name: member.full_name }),
          memberName: member.full_name,
          memberId: parsed.memberId,
          avatarUrl: member.avatar_url,
          data: { pendingChoice: true },
        };
      }

      return { success: false, message: t('admin.scan.redemptionNotFound', 'Redemption not found') };
    }
    logger.error('Redemption claim failed:', claimErr);
    // Include the real message so admins can see WHY claim failed
    // (RLS denial, insufficient permission, malformed payload, etc.)
    const detail = claimErr.message || claimErr.details || claimErr.hint || '';
    return {
      success: false,
      message: detail
        ? t('admin.scan.claimFailedWithReason', { reason: detail, defaultValue: 'Failed to claim reward: {{reason}}' })
        : t('admin.scan.claimFailed', 'Failed to claim reward'),
    };
  }

  logAdminAction('claim_reward', 'member', parsed.memberId, { reward: claimResult?.reward_name });

  const rewardName = claimResult?.reward_name || 'Reward';
  const pointsSpent = claimResult?.points_deducted || 0;

  return {
    success: true,
    message: t('admin.scan.rewardClaimed', '{{name}} claimed: {{reward}}', { name: member.full_name, reward: rewardName }),
    memberName: member.full_name,
    memberId: parsed.memberId,
    avatarUrl: member.avatar_url,
    data: { rewardName, pointsSpent },
    externalPayload: { action: 'reward', memberId: parsed.memberId, memberExternalId: member.qr_external_id, memberName: member.full_name, timestamp: new Date().toISOString(), data: { rewardName, redemptionId: parsed.redemptionId } },
  };
}

// ── Referral ─────────────────────────────────────────────
export async function handleReferralScan(parsed, ctx) {
  const { gymId, supabase, t } = ctx;

  if (parsed.gymId !== gymId) {
    return { success: false, message: t('admin.scan.wrongGym', 'QR code is for a different gym') };
  }

  // Find the pending referral by code
  const { data: referral } = await supabase
    .from('referrals')
    .select('id, referrer_id, referred_id, status')
    .eq('referral_code', parsed.referralCode)
    .eq('status', 'pending')
    .limit(1)
    .single();

  if (!referral) {
    return { success: false, message: t('admin.scan.referralNotFound', 'No pending referral found for this code') };
  }

  // Complete the referral
  const { error } = await supabase.rpc('safe_complete_referral', {
    p_referral_id: referral.id,
  });

  if (error) {
    logger.error('Referral completion failed:', error);
    return { success: false, message: t('admin.scan.referralFailed', 'Referral completion failed: {{msg}}', { msg: error.message }) };
  }

  logAdminAction('referral_scan', 'member', referral.referrer_id);

  // Get referrer name
  const { data: referrer } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, qr_external_id')
    .eq('id', referral.referrer_id)
    .single();

  return {
    success: true,
    message: t('admin.scan.referralCompleted', 'Referral completed for {{name}}!', { name: referrer?.full_name || 'Member' }),
    memberName: referrer?.full_name,
    memberId: referral.referrer_id,
    avatarUrl: referrer?.avatar_url,
    data: { referrerId: referral.referrer_id, referredId: referral.referred_id },
    externalPayload: { action: 'referral', memberId: referral.referrer_id, memberExternalId: referrer?.qr_external_id, memberName: referrer?.full_name, timestamp: new Date().toISOString(), data: { referralCode: parsed.referralCode } },
  };
}

// ── Win-Back Voucher ─────────────────────────────────────
export async function handleVoucherScan(parsed, ctx) {
  const { supabase, t } = ctx;

  // Look up the voucher to get member_id first
  const { data: voucher } = await supabase
    .from('email_reward_vouchers')
    .select('id, member_id, reward_label, status, expires_at')
    .eq('qr_code', parsed.voucherCode)
    .single();

  if (!voucher) {
    return { success: false, message: t('admin.scan.voucherNotFound', 'Voucher not found') };
  }

  if (voucher.status === 'redeemed') {
    return { success: false, message: t('admin.scan.voucherAlreadyUsed', 'This voucher was already redeemed') };
  }

  if (voucher.status === 'expired' || (voucher.expires_at && new Date(voucher.expires_at) < new Date())) {
    return { success: false, message: t('admin.scan.voucherExpired', 'This voucher has expired') };
  }

  // Call the admin_redeem_voucher RPC
  const { data, error } = await supabase.rpc('admin_redeem_voucher', {
    p_qr_code: parsed.voucherCode,
    p_member_id: voucher.member_id,
  });

  if (error) {
    logger.error('Voucher redemption failed:', error);
    return { success: false, message: t('admin.scan.voucherFailed', 'Voucher redemption failed') };
  }

  if (data?.error) {
    return { success: false, message: data.error };
  }

  // Get member name
  const { data: member } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, qr_external_id')
    .eq('id', voucher.member_id)
    .single();

  return {
    success: true,
    message: t('admin.scan.voucherRedeemed', '{{name}} redeemed: {{reward}}', { name: member?.full_name || 'Member', reward: voucher.reward_label }),
    memberName: member?.full_name,
    memberId: voucher.member_id,
    avatarUrl: member?.avatar_url,
    data: { rewardLabel: voucher.reward_label },
    externalPayload: { action: 'voucher', memberId: voucher.member_id, memberExternalId: member?.qr_external_id, memberName: member?.full_name, timestamp: new Date().toISOString(), data: { voucherCode: parsed.voucherCode, rewardLabel: voucher.reward_label } },
  };
}

// ── Earned reward (birthday / referral milestone / manual grant) ────
export async function handleEarnedRewardScan(parsed, ctx) {
  const { gymId, supabase, t } = ctx;

  if (!parsed?.qrCode || parsed.qrCode.length < 6) {
    return { success: false, message: t('admin.scan.invalidQR', 'Invalid QR code') };
  }

  // Look up the earned reward by qr_code (admin RLS allows reading rows in own gym)
  const { data: earned, error: lookupErr } = await supabase
    .from('earned_rewards')
    .select('id, gym_id, profile_id, reward_label, reward_label_es, reward_emoji, source, status')
    .eq('qr_code', parsed.qrCode)
    .maybeSingle();

  if (lookupErr || !earned) {
    return { success: false, message: t('admin.scan.earnedNotFound', 'Earned reward not found') };
  }

  if (earned.gym_id !== gymId) {
    return { success: false, message: t('admin.scan.wrongGym', 'QR code is for a different gym') };
  }

  if (earned.status !== 'pending') {
    return { success: false, message: t('admin.scan.alreadyClaimed', 'This reward was already claimed') };
  }

  const { data: member } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, qr_external_id')
    .eq('id', earned.profile_id)
    .eq('gym_id', gymId)
    .single();

  if (!member) {
    return { success: false, message: t('admin.scan.memberNotFound', 'Member not found') };
  }

  const { error: redeemErr } = await supabase.rpc('redeem_earned_reward', { p_id: earned.id });
  if (redeemErr) {
    logger.error('redeem_earned_reward failed:', redeemErr);
    return { success: false, message: t('admin.scan.claimFailed', 'Failed to claim reward') };
  }

  logAdminAction('redeem_earned_reward', 'member', earned.profile_id, {
    earned_id: earned.id, source: earned.source, reward: earned.reward_label,
  });

  return {
    success: true,
    message: t('admin.scan.earnedRewardClaimed', '{{name}} claimed: {{reward}}', {
      name: member.full_name, reward: earned.reward_label,
    }),
    memberName: member.full_name,
    memberId: earned.profile_id,
    avatarUrl: member.avatar_url,
    data: { rewardName: earned.reward_label, source: earned.source },
    externalPayload: {
      action: 'earned_reward',
      memberId: earned.profile_id,
      memberExternalId: member.qr_external_id,
      memberName: member.full_name,
      timestamp: new Date().toISOString(),
      data: { earnedId: earned.id, rewardName: earned.reward_label, source: earned.source },
    },
  };
}

// ── Challenge prize (podium rewards from ended challenges) ──
export async function handleChallengePrizeScan(parsed, ctx) {
  const { gymId, supabase, t } = ctx;

  if (!parsed?.qrCode || parsed.qrCode.length < 6) {
    return { success: false, message: t('admin.scan.invalidQR', 'Invalid QR code') };
  }

  // Look up the prize by qr_code (admin RLS allows reading rows in own gym)
  const { data: prize, error: lookupErr } = await supabase
    .from('challenge_prizes')
    .select('id, gym_id, profile_id, placement, reward_label, status, challenges(name)')
    .eq('qr_code', parsed.qrCode)
    .maybeSingle();

  if (lookupErr || !prize) {
    return { success: false, message: t('admin.scan.prizeNotFound', 'Challenge prize not found') };
  }

  if (prize.gym_id !== gymId) {
    return { success: false, message: t('admin.scan.wrongGym', 'QR code is for a different gym') };
  }

  if (prize.status !== 'pending') {
    return { success: false, message: t('admin.scan.alreadyClaimed', 'This reward was already claimed') };
  }

  const { data: member } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, qr_external_id')
    .eq('id', prize.profile_id)
    .eq('gym_id', gymId)
    .single();

  if (!member) {
    return { success: false, message: t('admin.scan.memberNotFound', 'Member not found') };
  }

  // SECURITY DEFINER RPC (0471): admin-gated, gym-checked, pending-only.
  const { error: redeemErr } = await supabase.rpc('redeem_challenge_prize', { p_prize_id: prize.id });
  if (redeemErr) {
    logger.error('redeem_challenge_prize failed:', redeemErr);
    return { success: false, message: t('admin.scan.claimFailed', 'Failed to claim reward') };
  }

  logAdminAction('redeem_challenge_prize', 'member', prize.profile_id, {
    prize_id: prize.id, placement: prize.placement, reward: prize.reward_label,
    challenge: prize.challenges?.name,
  });

  return {
    success: true,
    message: t('admin.scan.earnedRewardClaimed', '{{name}} claimed: {{reward}}', {
      name: member.full_name, reward: prize.reward_label,
    }),
    memberName: member.full_name,
    memberId: prize.profile_id,
    avatarUrl: member.avatar_url,
    data: { rewardName: prize.reward_label, placement: prize.placement, challengeName: prize.challenges?.name },
    externalPayload: {
      action: 'challenge_prize',
      memberId: prize.profile_id,
      memberExternalId: member.qr_external_id,
      memberName: member.full_name,
      timestamp: new Date().toISOString(),
      data: { prizeId: prize.id, rewardName: prize.reward_label, placement: prize.placement },
    },
  };
}

// ── Dispatcher ───────────────────────────────────────────
const HANDLERS = {
  checkin: handleCheckinScan,
  purchase: handlePurchaseScan,
  reward_redemption: handleRewardRedemptionScan,
  earned_reward: handleEarnedRewardScan,
  challenge_prize: handleChallengePrizeScan,
  referral: handleReferralScan,
  voucher: handleVoucherScan,
};

/**
 * Dispatch a parsed scan result to the appropriate handler.
 * @param {Object} parsed - Output from scanRouter.parseQRContent
 * @param {Object} ctx - { gymId, adminId, supabase, t }
 * @returns {Promise<{ success, message, memberName?, data?, externalPayload? }>}
 */
export async function dispatchScanAction(parsed, ctx) {
  const handler = HANDLERS[parsed?.type];
  if (!handler) {
    return { success: false, message: ctx.t('admin.scan.unknownType', 'Unknown scan type') };
  }

  try {
    return await handler(parsed, ctx);
  } catch (err) {
    logger.error('Scan action error:', err);
    return { success: false, message: err.message || 'Scan action failed' };
  }
}
