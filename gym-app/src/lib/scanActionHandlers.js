/**
 * Scan Action Handlers — business logic for each scan type.
 * Used by both the physical scanner (ScanFeedback) and camera scanner (QRScannerModal).
 *
 * Each handler receives: (parsed, ctx) where ctx = { gymId, adminId, supabase, t }
 * Each returns: { success, message, memberName?, data?, externalPayload? }
 */
import { addPoints, calculatePointsForAction } from './rewardsEngine';
import logger from './logger';

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
    return {
      success: true,
      message: t('admin.scan.alreadyCheckedIn', '{{name}} already checked in today', { name: member.full_name }),
      memberName: member.full_name,
      memberId: member.id,
      avatarUrl: member.avatar_url,
      data: { duplicate: true },
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

  // Award points (24hr limit enforced server-side via add_reward_points_checked)
  const pts = calculatePointsForAction('check_in');
  let pointsAwarded = pts;
  try {
    const { data: ptsResult } = await supabase.rpc('add_reward_points_checked', {
      p_user_id: member.id,
      p_gym_id: gymId,
      p_action: 'check_in',
      p_points: pts,
      p_description: 'QR check-in',
    });
    // Returns 0 if points were already awarded in last 24h
    if (ptsResult === 0) pointsAwarded = 0;
  } catch {
    // Fallback to regular addPoints if the new RPC doesn't exist yet
    await addPoints(member.id, gymId, 'check_in', pts, 'QR check-in');
  }

  const msg = pointsAwarded > 0
    ? t('admin.scan.checkinSuccess', '{{name}} checked in! +{{pts}}pts', { name: member.full_name, pts: pointsAwarded })
    : t('admin.scan.checkinSuccessNoPoints', '{{name}} checked in!', { name: member.full_name });

  return {
    success: true,
    message: msg,
    memberName: member.full_name,
    memberId: member.id,
    avatarUrl: member.avatar_url,
    data: { pointsEarned: pointsAwarded },
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

  // Record purchase via RPC
  const { data, error } = await supabase.rpc('record_gym_purchase', {
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

  // Trigger wallet update for punch cards
  supabase.functions.invoke('push-wallet-update', {
    body: { profileId: member.id, reason: 'punch_card_update' },
  }).catch(() => {});

  const pointsEarned = data?.points_earned ?? 0;
  const freeReward = data?.free_reward_earned;
  let msg = t('admin.scan.purchaseSuccess', '{{name}} — purchase recorded! +{{pts}}pts', { name: member.full_name, pts: pointsEarned });
  if (freeReward) msg += ` ${t('admin.scan.freeItemEarned', 'Free item earned!')}`;

  return {
    success: true,
    message: msg,
    memberName: member.full_name,
    memberId: member.id,
    avatarUrl: member.avatar_url,
    data: { pointsEarned, freeReward, punchCard: data?.punch_card_progress },
    externalPayload: { action: 'purchase', memberId: member.id, memberExternalId: member.qr_external_id, memberName: member.full_name, timestamp: new Date().toISOString(), data: { productId: parsed.productId, pointsEarned } },
  };
}

// ── Reward Redemption ────────────────────────────────────
export async function handleRewardRedemptionScan(parsed, ctx) {
  const { gymId, supabase, t } = ctx;

  if (parsed.gymId !== gymId) {
    return { success: false, message: t('admin.scan.wrongGym', 'QR code is for a different gym') };
  }

  // Fetch the redemption
  const { data: redemption, error: fetchErr } = await supabase
    .from('reward_redemptions')
    .select('id, profile_id, reward_name, points_spent, status')
    .eq('id', parsed.redemptionId)
    .eq('gym_id', gymId)
    .single();

  if (fetchErr || !redemption) {
    return { success: false, message: t('admin.scan.redemptionNotFound', 'Redemption not found') };
  }

  if (redemption.status === 'claimed') {
    return { success: false, message: t('admin.scan.alreadyClaimed', 'This reward was already claimed') };
  }

  if (redemption.status === 'expired') {
    return { success: false, message: t('admin.scan.redemptionExpired', 'This redemption has expired') };
  }

  // Verify member matches
  if (redemption.profile_id !== parsed.memberId) {
    return { success: false, message: t('admin.scan.memberMismatch', 'Redemption does not belong to this member') };
  }

  // Mark as claimed
  const { error: updateErr } = await supabase
    .from('reward_redemptions')
    .update({ status: 'claimed', claimed_at: new Date().toISOString() })
    .eq('id', redemption.id);

  if (updateErr) {
    logger.error('Redemption claim failed:', updateErr);
    return { success: false, message: t('admin.scan.claimFailed', 'Failed to claim reward') };
  }

  // Get member name
  const { data: member } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, qr_external_id')
    .eq('id', parsed.memberId)
    .single();

  return {
    success: true,
    message: t('admin.scan.rewardClaimed', '{{name}} claimed: {{reward}}', { name: member?.full_name || 'Member', reward: redemption.reward_name }),
    memberName: member?.full_name,
    memberId: parsed.memberId,
    avatarUrl: member?.avatar_url,
    data: { rewardName: redemption.reward_name, pointsSpent: redemption.points_spent },
    externalPayload: { action: 'reward', memberId: parsed.memberId, memberExternalId: member?.qr_external_id, memberName: member?.full_name, timestamp: new Date().toISOString(), data: { rewardName: redemption.reward_name, redemptionId: redemption.id } },
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

// ── Dispatcher ───────────────────────────────────────────
const HANDLERS = {
  checkin: handleCheckinScan,
  purchase: handlePurchaseScan,
  reward_redemption: handleRewardRedemptionScan,
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
