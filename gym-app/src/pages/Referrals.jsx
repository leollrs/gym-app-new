// ── Referrals Page ──────────────────────────────────────────────────────────
// Liquid Glass / iOS 26 redesign (Referral B reference)
import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Copy, Check, Share2, Gift, Users, Clock, X,
  CheckCircle, UserPlus, QrCode, Coins, CreditCard,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { WalletPass } from '../lib/walletPass';
import { supabase } from '../lib/supabase';
import { rewardLabelText } from '../lib/rewardSymbols';
import { PROD_WEB_URL } from '../lib/appUrls';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useScrollLock } from '../hooks/useScrollLock';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import FeatureDisabledScreen from '../components/FeatureDisabledScreen';
import { useFeatureEnabled } from '../hooks/usePlatformFlags';
import { formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale';
import { usePostHog } from '@posthog/react';

const REFERRAL_BASE_URL = `${PROD_WEB_URL}/referral`;

// Allow-list of hostnames we are willing to open in the in-app browser /
// system browser. Prevents arbitrary navigation if a server response ever
// supplies a saveUrl we did not expect.
// TODO: extend with gymConfig.customDomain when added to gym schema
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'wallet.google.com',
  'pay.google.com',
  'apple.com',
  'www.apple.com',
  'tugympr.com',
  'www.tugympr.com',
  new URL(PROD_WEB_URL).hostname, // app.tugympr.com — canonical web host
]);

// Open an external URL using SFSafariViewController (via @capacitor/browser)
// when available, falling back to window.open for the web build.
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

export default function Referrals() {
  const navigate = useNavigate();
  const { user, profile, gymName } = useAuth();
  const { showToast } = useToast();
  const { t, i18n } = useTranslation('pages');
  const posthog = usePostHog();
  const referralsEnabled = useFeatureEnabled('referrals');

  const [referralCode, setReferralCode] = useState(null);
  const [referralConfig, setReferralConfig] = useState(null);
  const [rewardsById, setRewardsById] = useState({}); // { [gym_rewards.id]: { name, name_es, emoji_icon } }
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  useScrollLock(showQRModal); // lock background scroll while the QR modal is open
  const [walletLoading, setWalletLoading] = useState(false);
  const isEs = i18n.language?.startsWith('es');

  // Body-scroll lock is owned exclusively by QRCodeModal itself — locking
  // here too caused a save/restore race that left `body.overflow: hidden`
  // stuck after the modal closed (page unscrollable until full reload).

  // ── Load referral data ──────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!user) return;
    try {
      const { data: existing, error: codeErr } = await supabase
        .from('referral_codes')
        .select('code')
        .eq('profile_id', user.id)
        .maybeSingle();

      if (!codeErr && existing?.code) {
        setReferralCode(existing.code);
      } else if (!codeErr) {
        const gymId = profile?.gym_id;
        if (gymId) {
          const { data: generated, error: rpcErr } = await supabase
            .rpc('generate_referral_code', { p_profile_id: user.id, p_gym_id: gymId });
          if (!rpcErr && generated) {
            setReferralCode(generated);
            posthog?.capture('referral_code_generated');
          } else if (rpcErr) {
            // Without a code the member can't share at all — surface it instead
            // of leaving the placeholder dashes sitting there silently.
            setReferralCode('');
            showToast(t('referrals.codeError', "Couldn't generate your referral code. Pull to refresh or try again later."), 'error');
          }
        }
      }

      if (profile?.gym_id) {
        try {
          const { data: gym } = await supabase
            .from('gyms')
            .select('referral_config')
            .eq('id', profile.gym_id)
            .maybeSingle();
          if (gym?.referral_config) {
            setReferralConfig(gym.referral_config);

            // If the admin chose "from inventory" for either side, fetch those
            // gym_rewards rows so we can render real names + emojis instead of
            // falling through to the generic "500 puntos de bonificación" string.
            const ids = [];
            if (gym.referral_config?.referrer_reward?.type === 'gym_reward'
                && gym.referral_config.referrer_reward.reward_id) {
              ids.push(gym.referral_config.referrer_reward.reward_id);
            }
            if (gym.referral_config?.referred_reward?.type === 'gym_reward'
                && gym.referral_config.referred_reward.reward_id) {
              ids.push(gym.referral_config.referred_reward.reward_id);
            }
            if (ids.length) {
              try {
                const { data: rewards } = await supabase
                  .from('gym_rewards')
                  .select('id, name, name_es, emoji_icon')
                  .in('id', ids);
                if (rewards) {
                  setRewardsById(Object.fromEntries(rewards.map(r => [r.id, r])));
                }
              } catch { /* gym_rewards not ready */ }
            }
          }
        } catch { /* column not ready */ }
      }

      try {
        // Two-step fetch: the profiles embed is RLS-nulled unless the
        // referred member happens to be an accepted friend, so history rows
        // read "Unknown user". Fetch bare rows, resolve names through the
        // same-gym gym_member_profiles_safe view, and reattach them under
        // the `referred_profile` key the render already expects.
        const { data: refs } = await supabase
          .from('referrals')
          .select('id, status, created_at, referred_id, points_awarded')
          .eq('referrer_id', user.id)
          .order('created_at', { ascending: false });
        const rows = refs ?? [];
        const referredIds = [...new Set(rows.map(r => r.referred_id).filter(Boolean))];
        const profileById = {};
        if (referredIds.length) {
          const { data: profs } = await supabase
            .from('gym_member_profiles_safe')
            .select('id, full_name')
            .in('id', referredIds);
          (profs ?? []).forEach(p => { profileById[p.id] = p; });
        }
        setReferrals(rows.map(r => ({ ...r, referred_profile: profileById[r.referred_id] ?? null })));
      } catch { /* table not ready */ }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [user, profile?.gym_id, posthog, showToast, t]);

  useEffect(() => { load(); }, [load]);

  // ── Derived stats ───────────────────────────────────────────────────────
  const totalReferrals = referrals.length;
  const completedReferrals = referrals.filter(r => r.status === 'completed').length;
  const totalPointsEarned = referrals.reduce((sum, r) => sum + (r.points_awarded || 0), 0);

  const referralLink = referralCode ? `${REFERRAL_BASE_URL}/${referralCode}` : '';
  const referralQrPayload = (referralCode && profile?.gym_id && user?.id)
    ? `gym-referral:${profile.gym_id}:${user.id}:${referralCode}`
    : '';

  // ── Copy code ───────────────────────────────────────────────────────────
  const handleCopy = useCallback(async () => {
    if (!referralCode) return;
    try {
      await navigator.clipboard.writeText(referralCode);
      setCopied(true);
      posthog?.capture('referral_code_shared', { method: 'copy' });
      showToast(t('referrals.codeCopied'), 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast(t('referrals.copyFailed'), 'error');
    }
  }, [referralCode, showToast, t, posthog]);

  // ── Share ───────────────────────────────────────────────────────────────
  // The invitee isn't a member yet, so an in-app /referral/<code> deep link is
  // useless to them (and on a phone WITH the app it just opens the app). Give
  // them the CODE (copied to clipboard, to paste at signup) + a link to GET the
  // app — never the deep link. In-person sharing still uses the QR button,
  // which shows the QR + the code below it (and is what the gym scans).
  const handleShare = useCallback(async () => {
    if (!referralCode) return;
    const message = t('referrals.shareMessage', {
      gymName: gymName || 'TuGymPR',
      code: referralCode,
    });
    try { await navigator.clipboard?.writeText(referralCode); } catch { /* clipboard blocked */ }
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({
          title: t('referrals.shareTitle'),
          text: message,
          url: PROD_WEB_URL,
        });
        posthog?.capture('referral_code_shared', { method: 'native_share' });
      } else if (navigator.share) {
        await navigator.share({ title: t('referrals.shareTitle'), text: `${message}\n${PROD_WEB_URL}` });
        posthog?.capture('referral_code_shared', { method: 'native_share' });
      } else {
        await navigator.clipboard.writeText(`${message}\n${PROD_WEB_URL}`);
        posthog?.capture('referral_code_shared', { method: 'copy' });
        showToast(t('referrals.linkCopied'), 'success');
      }
    } catch {
      /* user cancelled */
    }
  }, [referralCode, gymName, showToast, t, posthog]);

  // ── Add to Apple/Google Wallet ──────────────────────────────────────────
  const handleAddToWallet = useCallback(async () => {
    if (!referralCode) return;
    setWalletLoading(true);
    try {
      const platform = Capacitor.getPlatform();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const fnName = platform === 'android' ? 'generate-google-pass' : 'generate-apple-pass';
      // Derive the same way the page renders it, so the Wallet pass shows the
      // real configured reward (points value or inventory item) instead of the
      // legacy `.label` field that the new admin form no longer sets.
      const r = referralConfig?.referrer_reward;
      let referrerReward = null;
      if (r) {
        if (r.label) {
          referrerReward = r.label;
        } else if (r.type === 'gym_reward' && r.reward_id && rewardsById[r.reward_id]) {
          const gr = rewardsById[r.reward_id];
          referrerReward = (gr.name_es && /^es/.test(i18n.language || '')) ? gr.name_es : gr.name;
        } else {
          const v = Number(r.value ?? r.points);
          if (Number.isFinite(v) && v > 0) referrerReward = `${v} ${/^es/.test(i18n.language || '') ? 'puntos' : 'points'}`;
        }
      }
      const { data, error } = await supabase.functions.invoke(fnName, {
        body: {
          kind: 'referral',
          payload: referralQrPayload || referralCode,
          referralCode,
          referralReward: referrerReward,
          memberName: profile?.full_name,
          gymName: gymName || 'TuGymPR',
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) {
        const ctx = error.context;
        let details = '';
        if (ctx) {
          try { const body = await ctx.json(); details = body?.details || body?.error || ''; }
          catch { try { details = await ctx.text(); } catch { /* swallow */ } }
        }
        throw new Error(details || error.message || 'Wallet pass failed');
      }
      if (data?.error) throw new Error(data.details ? `${data.error}: ${data.details}` : data.error);
      if (data?.unsupported) throw new Error(t('referrals.walletUnsupported', 'Wallet passes not yet configured for this gym'));

      if (platform === 'ios') {
        await WalletPass.addPass({ pkpassBase64: data.pkpass });
      } else if (data?.saveUrl) {
        await openExternalUrl(data.saveUrl);
      }
      posthog?.capture('referral_code_shared', { method: 'wallet' });
    } catch (err) {
      showToast(err.message || t('referrals.walletFailed', 'Could not add to wallet'), 'error');
    } finally {
      setWalletLoading(false);
    }
  }, [referralCode, referralQrPayload, referralConfig, rewardsById, profile, gymName, showToast, t, i18n.language, posthog]);

  // ── Status helpers ──────────────────────────────────────────────────────
  const STATUS_META = {
    pending:   { icon: Clock,       color: 'var(--color-warning)', labelKey: 'statusPending' },
    completed: { icon: CheckCircle, color: 'var(--color-success)', labelKey: 'statusCompleted' },
    expired:   { icon: Clock,       color: 'var(--color-text-subtle)', labelKey: 'statusExpired' },
  };

  // Translate the JSONB reward shape saved by Admin → Referidos into a display string.
  // Handles both the current shape ({type, value} | {type, reward_id}), the legacy
  // shape ({type:'points', points:N, label}), and an explicit user-set label.
  const formatRewardLabel = (reward, fallbackKey) => {
    if (!reward || typeof reward !== 'object') return t(fallbackKey);
    if (reward.label && typeof reward.label === 'string') return reward.label;

    if (reward.type === 'gym_reward' && reward.reward_id) {
      const r = rewardsById[reward.reward_id];
      if (r) {
        const name = (isEs && r.name_es) ? r.name_es : r.name;
        return rewardLabelText(r.emoji_icon, name);
      }
      // Inventory not loaded yet — show a neutral placeholder, not the
      // "500 puntos" default which is misleading for a non-points reward.
      return t('referrals.rewardLoading', '...');
    }

    // Points (current uses .value; legacy default rows use .points).
    const v = Number(reward.value ?? reward.points);
    if (Number.isFinite(v) && v > 0) {
      return `${v.toLocaleString(isEs ? 'es' : 'en')} ${t('referrals.ptsLong', isEs ? 'puntos' : 'points')}`;
    }
    return t(fallbackKey);
  };

  const referrerReward = formatRewardLabel(referralConfig?.referrer_reward, 'referrals.defaultReferrerReward');
  const friendReward = formatRewardLabel(
    referralConfig?.referred_reward || referralConfig?.friend_reward,
    'referrals.defaultFriendReward'
  );

  // Hero progress (milestone: 5 invites)
  const MILESTONE = 5;
  const progressDots = Array.from({ length: MILESTONE }, (_, i) => i < Math.min(totalReferrals, MILESTONE));

  // Typography tokens per user spec (Familjen Grotesk for display, Archivo for body)
  const FONT_DISPLAY = "'Familjen Grotesk', 'Archivo', system-ui, -apple-system, sans-serif";
  const FONT_BODY = "'Archivo', 'Familjen Grotesk', system-ui, -apple-system, sans-serif";

  // Platform kill switch (Operations → feature_referrals). After all hooks so
  // a mid-session flip can't change the hook order.
  if (!referralsEnabled) return <FeatureDisabledScreen />;

  return (
    <div
      className="mx-auto w-full max-w-[480px] md:max-w-4xl lg:max-w-6xl px-4 pt-6 pb-36 md:pb-12 animate-fade-in"
      style={{ fontFamily: FONT_BODY }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          aria-label={t('referrals.goBack', { defaultValue: 'Go back' })}
          className="w-11 h-11 flex items-center justify-center rounded-2xl focus:outline-none focus:ring-2 transition-all duration-200 active:scale-95"
          style={{
            background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)',
            border: '1px solid var(--color-border-subtle)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <ArrowLeft size={18} style={{ color: 'var(--color-text-muted)' }} />
        </button>
        <div className="flex-1 min-w-0">
          <h1
            className="text-[24px] truncate"
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 800,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.4px',
            }}
          >
            {t('referrals.title')}
          </h1>
          <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
            {t('referrals.subtitle')}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map(i => (
            <div
              key={i}
              className="h-32 rounded-3xl animate-pulse"
              style={{ background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)' }}
            />
          ))}
        </div>
      ) : (
        <>
          {/* ── HERO · Gradient reward card ──────────────────────────────── */}
          <div
            className="relative overflow-hidden rounded-3xl p-6 mb-4"
            style={{
              background: 'linear-gradient(135deg, var(--color-accent) 0%, color-mix(in srgb, var(--color-accent) 65%, #000 35%) 120%)',
              color: 'var(--color-text-on-accent, #fff)',
              boxShadow: '0 10px 30px -10px color-mix(in srgb, var(--color-accent) 45%, transparent)',
            }}
          >
            {/* Decorative bubble */}
            <div
              aria-hidden
              className="absolute rounded-full"
              style={{
                top: -40, right: -40, width: 180, height: 180,
                background: 'rgba(255,255,255,0.14)',
              }}
            />
            <div
              aria-hidden
              className="absolute rounded-full"
              style={{
                bottom: -60, left: -30, width: 140, height: 140,
                background: 'rgba(255,255,255,0.07)',
              }}
            />

            <div className="relative">
              <div
                className="text-[11px] opacity-85 mb-1"
                style={{ fontWeight: 800, letterSpacing: '1.4px' }}
              >
                {t('referrals.title').toUpperCase()}
              </div>
              <div
                className="mt-1"
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 30,
                  fontWeight: 800,
                  letterSpacing: '-1px',
                  lineHeight: 1.05,
                }}
              >
                {referrerReward}
              </div>
              <div className="text-[13px] mt-3 opacity-90">
                {completedReferrals > 0
                  ? t('referrals.shareMessage', { gymName: gymName || 'TuGymPR', code: referralCode || '—' })
                  : t('referrals.noReferralsHint')}
              </div>

              {/* Progress dots */}
              <div className="flex gap-2 mt-5">
                {progressDots.map((filled, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-full"
                    style={{
                      height: 8,
                      background: filled ? '#fff' : 'rgba(255,255,255,0.3)',
                    }}
                  />
                ))}
              </div>
              <div
                className="flex justify-between mt-2 text-[10px]"
                style={{ fontWeight: 700, opacity: 0.85 }}
              >
                <span>{totalReferrals} / {MILESTONE}</span>
                <span>{t('referrals.youGet')}: {referrerReward}</span>
              </div>
            </div>
          </div>

          {/* ── Code + Share channels card ───────────────────────────────── */}
          <div
            className="rounded-3xl p-4 mb-4"
            style={{
              background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)',
              border: '1px solid var(--color-border-subtle)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
          >
            {/* Code pill + copy */}
            <div className="flex items-center gap-2.5 mb-4">
              <div
                className="flex-1 px-4 py-3 rounded-2xl text-center"
                style={{
                  background: 'color-mix(in srgb, var(--color-text-primary) 6%, transparent)',
                  border: '1.5px dashed var(--color-border-strong)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 15,
                  fontWeight: 800,
                  letterSpacing: '2px',
                  color: 'var(--color-text-primary)',
                }}
              >
                {referralCode || '— — — —'}
              </div>
              <button
                onClick={handleCopy}
                disabled={!referralCode}
                aria-label={copied ? t('referrals.codeCopied') : t('referrals.copy', 'Copy')}
                className="px-4 py-3 rounded-2xl flex items-center gap-1.5 transition-all duration-200 active:scale-95 disabled:opacity-40"
                style={{
                  background: 'var(--color-accent)',
                  color: 'var(--color-text-on-accent, #000)',
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: '0.3px',
                  minHeight: 44,
                }}
              >
                {copied ? <Check size={15} strokeWidth={3} /> : <Copy size={14} strokeWidth={2.5} />}
                {copied ? t('referrals.statusCompleted') : t('referrals.copy', 'Copy')}
              </button>
            </div>

            {/* Channel buttons row */}
            <div className="grid grid-cols-3 gap-2.5">
              <button
                onClick={handleShare}
                disabled={!referralCode}
                className="flex flex-col items-center gap-1.5 p-3 rounded-2xl transition-all duration-200 active:scale-95 disabled:opacity-40"
                style={{
                  background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
                }}
              >
                <div
                  className="w-11 h-11 rounded-2xl flex items-center justify-center"
                  style={{ background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)' }}
                >
                  <Share2 size={19} style={{ color: 'var(--color-accent)' }} />
                </div>
                <span className="text-[11px]" style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {t('referrals.shareButton').split(' ')[0]}
                </span>
              </button>

              <button
                onClick={() => { if (referralQrPayload) { setShowQRModal(true); posthog?.capture('referral_code_shared', { method: 'qr' }); } }}
                disabled={!referralQrPayload}
                className="flex flex-col items-center gap-1.5 p-3 rounded-2xl transition-all duration-200 active:scale-95 disabled:opacity-40"
                style={{
                  background: 'color-mix(in srgb, var(--color-text-primary) 5%, transparent)',
                  border: '1px solid var(--color-border-subtle)',
                }}
              >
                <div
                  className="w-11 h-11 rounded-2xl flex items-center justify-center"
                  style={{ background: 'color-mix(in srgb, var(--color-text-primary) 8%, transparent)' }}
                >
                  <QrCode size={19} style={{ color: 'var(--color-text-primary)' }} />
                </div>
                <span className="text-[11px]" style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {t('referrals.openQR')}
                </span>
              </button>

              <button
                onClick={handleAddToWallet}
                disabled={!referralCode || walletLoading}
                className="flex flex-col items-center gap-1.5 p-3 rounded-2xl transition-all duration-200 active:scale-95 disabled:opacity-40"
                style={{
                  background: 'color-mix(in srgb, var(--color-text-primary) 5%, transparent)',
                  border: '1px solid var(--color-border-subtle)',
                }}
                aria-label={t('referrals.addToWallet', 'Add to Wallet')}
              >
                <div
                  className="w-11 h-11 rounded-2xl flex items-center justify-center"
                  style={{ background: 'color-mix(in srgb, var(--color-text-primary) 8%, transparent)' }}
                >
                  {walletLoading
                    ? <div className="w-4 h-4 border-[1.5px] border-current/20 border-t-current rounded-full animate-spin" style={{ color: 'var(--color-text-primary)' }} />
                    : <CreditCard size={19} style={{ color: 'var(--color-text-primary)' }} />
                  }
                </div>
                <span className="text-[11px]" style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {t('referrals.wallet', 'Wallet')}
                </span>
              </button>
            </div>
          </div>

          {/* ── Stats row (Invited / Joined / Points) ────────────────────── */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: t('referrals.statTotal'), value: totalReferrals, icon: UserPlus, color: 'var(--color-accent)' },
              { label: t('referrals.statCompleted'), value: completedReferrals, icon: Users, color: 'var(--color-success)' },
              { label: t('referrals.statPoints'), value: totalPointsEarned, icon: Coins, color: 'var(--color-warning)' },
            ].map((stat, i) => (
              <div
                key={i}
                className="rounded-3xl p-4 flex flex-col items-center text-center"
                style={{
                  background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)',
                  border: '1px solid var(--color-border-subtle)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                }}
              >
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center mb-2"
                  style={{ background: `color-mix(in srgb, ${stat.color} 15%, transparent)` }}
                >
                  <stat.icon size={18} style={{ color: stat.color }} />
                </div>
                <p
                  className="tabular-nums"
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 22,
                    fontWeight: 800,
                    letterSpacing: '-0.5px',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {stat.value}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)', fontWeight: 600 }}>
                  {stat.label}
                </p>
              </div>
            ))}
          </div>

          {/* (Inline QR card removed — the "Mostrar Código QR" button above
              already opens the full QR modal, so showing the same QR inline
              below the stats was redundant.) */}

          {/* ── Rewards info ─────────────────────────────────────────────── */}
          <div
            className="rounded-3xl p-5 mb-4"
            style={{
              background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)',
              border: '1px solid var(--color-border-subtle)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Gift size={16} style={{ color: 'var(--color-accent)' }} />
              <p
                className="text-[14px]"
                style={{ fontWeight: 800, color: 'var(--color-text-primary)', fontFamily: FONT_DISPLAY, letterSpacing: '-0.2px' }}
              >
                {t('referrals.rewardsTitle')}
              </p>
            </div>

            <div className="space-y-2.5">
              <div
                className="flex items-start gap-3 p-3 rounded-2xl"
                style={{
                  background: 'color-mix(in srgb, var(--color-accent) 7%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)',
                }}
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'color-mix(in srgb, var(--color-accent) 20%, transparent)' }}
                >
                  <Gift size={16} style={{ color: 'var(--color-accent)' }} />
                </div>
                <div>
                  <p className="text-[13px]" style={{ fontWeight: 800, color: 'var(--color-text-primary)' }}>
                    {t('referrals.youGet')}
                  </p>
                  <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{referrerReward}</p>
                </div>
              </div>

              <div
                className="flex items-start gap-3 p-3 rounded-2xl"
                style={{
                  background: 'color-mix(in srgb, var(--color-success) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-success) 18%, transparent)',
                }}
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'color-mix(in srgb, var(--color-success) 20%, transparent)' }}
                >
                  <UserPlus size={16} style={{ color: 'var(--color-success)' }} />
                </div>
                <div>
                  <p className="text-[13px]" style={{ fontWeight: 800, color: 'var(--color-text-primary)' }}>
                    {t('referrals.friendGets')}
                  </p>
                  <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{friendReward}</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Referral History ─────────────────────────────────────────── */}
          <div
            className="rounded-3xl overflow-hidden"
            style={{
              background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)',
              border: '1px solid var(--color-border-subtle)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
          >
            <p
              className="text-[14px] px-5 pt-4 pb-2"
              style={{ fontWeight: 800, color: 'var(--color-text-primary)', fontFamily: FONT_DISPLAY, letterSpacing: '-0.2px' }}
            >
              {t('referrals.historyTitle')}
            </p>

            {referrals.length === 0 ? (
              <div className="py-10 text-center">
                <Users size={28} style={{ color: 'var(--color-text-muted)', margin: '0 auto 12px' }} strokeWidth={1.5} />
                <p className="text-[13px]" style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>
                  {t('referrals.noReferralsYet')}
                </p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('referrals.noReferralsHint')}
                </p>
              </div>
            ) : (
              <div>
                {referrals.map((ref, idx) => {
                  const meta = STATUS_META[ref.status] || STATUS_META.pending;
                  const StatusIcon = meta.icon;
                  const isLast = idx === referrals.length - 1;
                  return (
                    <div
                      key={ref.id}
                      className="flex items-center gap-3 px-5 py-3"
                      style={{
                        borderBottom: isLast ? 'none' : '1px solid var(--color-border-subtle)',
                      }}
                    >
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: `color-mix(in srgb, ${meta.color} 15%, transparent)` }}
                      >
                        <StatusIcon size={16} style={{ color: meta.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] truncate" style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>
                          {ref.referred_profile?.full_name || t('referrals.unknownUser')}
                        </p>
                        <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          {t(`referrals.${meta.labelKey}`)}
                          {ref.points_awarded ? ` · +${ref.points_awarded} ${t('referrals.ptsShort', 'pts')}` : ''}
                        </p>
                      </div>
                      <p className="text-[11px] flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }}>
                        {formatDistanceToNow(new Date(ref.created_at), { addSuffix: true, locale: i18n.language === 'es' ? esLocale : undefined })}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Fullscreen QR modal — portaled to body */}
      {showQRModal && referralQrPayload && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={() => setShowQRModal(false)}
        >
          <div className="absolute inset-0 backdrop-blur-xl bg-black/70" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('referrals.openQR')}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[340px] rounded-[28px] overflow-hidden animate-fade-in"
            style={{ background: 'var(--color-bg-card)', boxShadow: '0 24px 64px rgba(0,0,0,0.55)' }}
          >
            <button
              onClick={() => setShowQRModal(false)}
              aria-label={t('referrals.close', { defaultValue: 'Close' })}
              className="absolute top-4 right-4 z-10 w-9 h-9 flex items-center justify-center rounded-full transition-colors"
              style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}
            >
              <X size={17} />
            </button>

            <div className="flex flex-col items-center text-center pt-9 pb-6 px-7">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)' }}
              >
                <Gift size={28} style={{ color: 'var(--color-accent)' }} />
              </div>
              <p className="text-[18px] font-extrabold leading-tight" style={{ color: 'var(--color-text-primary)' }}>
                {t('referrals.scanToJoin', { gym: gymName || 'TuGymPR', defaultValue: 'Scan to join {{gym}}' })}
              </p>
            </div>

            <div className="flex items-center justify-center px-7">
              <div className="bg-white rounded-[20px] p-5" style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}>
                <QRCodeSVG value={referralQrPayload} size={200} level="H" includeMargin={false} bgColor="#FFFFFF" fgColor="#000000" />
              </div>
            </div>

            {referralCode && (
              <p className="text-center font-mono text-[14px] font-bold tracking-[0.2em] px-7 pt-4" style={{ color: 'var(--color-text-primary)' }}>
                {referralCode}
              </p>
            )}
            <p className="text-[12.5px] text-center px-7 pt-2 pb-8" style={{ color: 'var(--color-text-muted)' }}>
              {t('referrals.showQrHint', { defaultValue: 'Have your friend scan this to sign up.' })}
            </p>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
