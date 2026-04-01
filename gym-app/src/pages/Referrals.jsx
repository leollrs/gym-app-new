// ── Referrals Page ──────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Copy, Check, Share2, Gift, Users, Clock,
  CheckCircle, AlertCircle, UserPlus, Star, Coins,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';

const REFERRAL_BASE_URL = 'https://tugympr.app/referral';

export default function Referrals() {
  const navigate = useNavigate();
  const { user, profile, gymName } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation('pages');

  const [referralCode, setReferralCode] = useState(null);
  const [referralConfig, setReferralConfig] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // ── Load referral data ──────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!user) return;
    try {
      // 1. Try to fetch existing referral code (table may not exist yet)
      const { data: existing, error: codeErr } = await supabase
        .from('referral_codes')
        .select('code')
        .eq('profile_id', user.id)
        .maybeSingle();

      if (!codeErr && existing?.code) {
        setReferralCode(existing.code);
      } else if (!codeErr) {
        // Generate new code via RPC (needs gym_id)
        const gymId = profile?.gym_id;
        if (gymId) {
          const { data: generated, error: rpcErr } = await supabase
            .rpc('generate_referral_code', { p_profile_id: user.id, p_gym_id: gymId });
          if (!rpcErr && generated) {
            setReferralCode(generated);
          }
        }
      }
      // If table doesn't exist (404), silently continue — feature not deployed yet

      // 2. Fetch gym's referral config (column may not exist yet)
      if (profile?.gym_id) {
        try {
          const { data: gym } = await supabase
            .from('gyms')
            .select('referral_config')
            .eq('id', profile.gym_id)
            .maybeSingle();
          if (gym?.referral_config) {
            setReferralConfig(gym.referral_config);
          }
        } catch { /* column doesn't exist yet */ }
      }

      // 3. Fetch referral history (table may not exist yet)
      try {
        const { data: refs } = await supabase
          .from('referrals')
          .select('id, status, created_at, referred_id, referred_profile:profiles!referrals_referred_id_fkey(full_name)')
          .eq('referrer_id', user.id)
          .order('created_at', { ascending: false });
        setReferrals(refs ?? []);
      } catch { /* table doesn't exist yet */ }
    } catch {
      // silent — DB not ready
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // ── Derived stats ───────────────────────────────────────────────────────────
  const totalReferrals = referrals.length;
  const completedReferrals = referrals.filter(r => r.status === 'completed').length;
  const totalPointsEarned = referrals.reduce((sum, r) => sum + (r.points_awarded || 0), 0);

  const referralLink = referralCode ? `${REFERRAL_BASE_URL}/${referralCode}` : '';

  // ── Copy code ───────────────────────────────────────────────────────────────
  const handleCopy = useCallback(async () => {
    if (!referralCode) return;
    try {
      await navigator.clipboard.writeText(referralCode);
      setCopied(true);
      showToast(t('referrals.codeCopied'), 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast(t('referrals.copyFailed'), 'error');
    }
  }, [referralCode, showToast, t]);

  // ── Share ───────────────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    if (!referralCode) return;
    const message = t('referrals.shareMessage', {
      gymName: gymName || 'TuGymPR',
      code: referralCode,
    });
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({
          title: t('referrals.shareTitle'),
          text: message,
          url: referralLink,
        });
      } else {
        // Fallback: copy link
        await navigator.clipboard.writeText(`${message}\n${referralLink}`);
        showToast(t('referrals.linkCopied'), 'success');
      }
    } catch {
      // user cancelled share sheet
    }
  }, [referralCode, referralLink, gymName, showToast, t]);

  // ── Status helpers ──────────────────────────────────────────────────────────
  const STATUS_META = {
    pending:   { icon: Clock,       color: 'var(--color-warning)', labelKey: 'statusPending' },
    completed: { icon: CheckCircle, color: 'var(--color-success)', labelKey: 'statusCompleted' },
    expired:   { icon: AlertCircle, color: 'var(--color-text-subtle)', labelKey: 'statusExpired' },
  };

  // ── Reward info defaults ────────────────────────────────────────────────────
  const referrerReward = referralConfig?.referrer_reward?.label || t('referrals.defaultReferrerReward');
  const friendReward = (referralConfig?.referred_reward?.label || referralConfig?.friend_reward?.label) || t('referrals.defaultFriendReward');

  return (
    <div className="mx-auto w-full max-w-[480px] md:max-w-4xl px-4 pt-6 pb-28 md:pb-12 animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.06] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
        >
          <ArrowLeft size={18} style={{ color: 'var(--color-text-muted)' }} />
        </button>
        <div>
          <h1 className="text-[22px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{t('referrals.title')}</h1>
          <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('referrals.subtitle')}</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-28 rounded-2xl bg-white/[0.04] animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* ── Hero: Referral Code ──────────────────────────────────────────── */}
          <div className="bg-white/[0.04] rounded-2xl border border-white/[0.06] overflow-hidden p-5 mb-5 flex flex-col items-center text-center">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
              style={{
                background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                border: '3px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
              }}
            >
              <UserPlus size={28} style={{ color: 'var(--color-accent)' }} strokeWidth={1.5} />
            </div>

            <p className="text-[13px] mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('referrals.yourCode')}</p>

            {referralCode ? (
              <button
                onClick={handleCopy}
                className="flex items-center gap-2.5 px-5 py-3 rounded-xl mb-4 transition-all duration-200 active:scale-95"
                style={{
                  background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
                  border: '1.5px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
                }}
              >
                <span
                  className="text-[20px] font-mono font-black tracking-[0.15em] select-all"
                  style={{ color: 'var(--color-accent)' }}
                >
                  {referralCode}
                </span>
                {copied ? (
                  <Check size={18} style={{ color: 'var(--color-success)' }} />
                ) : (
                  <Copy size={18} style={{ color: 'var(--color-accent)' }} />
                )}
              </button>
            ) : (
              <p className="text-[13px] mb-4" style={{ color: 'var(--color-text-subtle)' }}>{t('referrals.noCode')}</p>
            )}

            {/* QR Code */}
            {referralLink && (
              <div className="bg-white p-4 rounded-xl mb-4">
                <QRCodeSVG
                  value={referralLink}
                  size={180}
                  level="H"
                  includeMargin={false}
                  bgColor="#FFFFFF"
                  fgColor="#000000"
                />
              </div>
            )}

            <p className="text-[11px] mb-4" style={{ color: 'var(--color-text-subtle)' }}>{t('referrals.scanOrShare')}</p>

            {/* Share Button */}
            <button
              onClick={handleShare}
              disabled={!referralCode}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold transition-all duration-200 active:scale-[0.98] disabled:opacity-40"
              style={{
                background: 'var(--color-accent)',
                color: '#000',
              }}
            >
              <Share2 size={17} />
              {t('referrals.shareButton')}
            </button>
          </div>

          {/* ── Stats Row ────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: t('referrals.statTotal'), value: totalReferrals, icon: Users, color: 'var(--color-accent)' },
              { label: t('referrals.statCompleted'), value: completedReferrals, icon: CheckCircle, color: 'var(--color-success)' },
              { label: t('referrals.statPoints'), value: totalPointsEarned, icon: Coins, color: 'var(--color-warning)' },
            ].map((stat, i) => (
              <div
                key={i}
                className="bg-white/[0.04] rounded-2xl border border-white/[0.06] p-4 flex flex-col items-center text-center"
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center mb-2"
                  style={{ background: `${stat.color}15` }}
                >
                  <stat.icon size={17} style={{ color: stat.color }} />
                </div>
                <p className="text-[20px] font-black tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                  {stat.value}
                </p>
                <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{stat.label}</p>
              </div>
            ))}
          </div>

          {/* ── Reward Info Card ──────────────────────────────────────────────── */}
          <div className="bg-white/[0.04] rounded-2xl border border-white/[0.06] overflow-hidden p-5 mb-5">
            <div className="flex items-center gap-2 mb-4">
              <Gift size={18} style={{ color: 'var(--color-accent)' }} />
              <p className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {t('referrals.rewardsTitle')}
              </p>
            </div>

            <div className="space-y-3">
              {/* You get */}
              <div
                className="flex items-start gap-3 p-3 rounded-xl"
                style={{
                  background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-accent) 12%, transparent)',
                }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}
                >
                  <Star size={16} style={{ color: 'var(--color-accent)' }} />
                </div>
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {t('referrals.youGet')}
                  </p>
                  <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{referrerReward}</p>
                </div>
              </div>

              {/* Friend gets */}
              <div
                className="flex items-start gap-3 p-3 rounded-xl"
                style={{
                  background: 'rgba(16,185,129,0.06)',
                  border: '1px solid rgba(16,185,129,0.12)',
                }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: 'rgba(16,185,129,0.15)' }}
                >
                  <UserPlus size={16} style={{ color: 'var(--color-success)' }} />
                </div>
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {t('referrals.friendGets')}
                  </p>
                  <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{friendReward}</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Referral History ──────────────────────────────────────────────── */}
          <div className="bg-white/[0.04] rounded-2xl border border-white/[0.06] overflow-hidden">
            <p className="text-[14px] font-semibold px-5 pt-4 pb-2" style={{ color: 'var(--color-text-muted)' }}>
              {t('referrals.historyTitle')}
            </p>

            {referrals.length === 0 ? (
              <div className="py-10 text-center">
                <Users size={28} style={{ color: 'var(--color-text-muted)', margin: '0 auto 12px' }} strokeWidth={1.5} />
                <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('referrals.noReferralsYet')}</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>{t('referrals.noReferralsHint')}</p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {referrals.map(ref => {
                  const meta = STATUS_META[ref.status] || STATUS_META.pending;
                  const StatusIcon = meta.icon;
                  return (
                    <div key={ref.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.06] transition-colors duration-200">
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: `${meta.color}15` }}
                      >
                        <StatusIcon size={16} style={{ color: meta.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                          {ref.referred_profile?.full_name || t('referrals.unknownUser')}
                        </p>
                        <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          {t(`referrals.${meta.labelKey}`)}
                          {ref.points_awarded ? ` · +${ref.points_awarded} pts` : ''}
                        </p>
                      </div>
                      <p className="text-[11px] flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }}>
                        {formatDistanceToNow(new Date(ref.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
