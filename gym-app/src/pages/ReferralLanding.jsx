import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Copy, Check, ExternalLink, MapPin } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { textOnColor } from '../lib/themeGenerator';
import logger from '../lib/logger';

// Public landing for /referral/:code.
//
// This page exists because of who receives a referral link: BY DEFINITION,
// someone who does not have the app. Not "mostly" — all of them. So the
// no-app branch isn't an edge case here, it's the entire use case.
//
// What they used to get: App.jsx stashed the code and pushed them straight to
// `/signup` — a bare form, no gym name, no logo, no offer, no reason. The first
// thing a stranger saw of the gym their friend trains at was a password field.
//
// What they get now: the GYM. Its logo, its colours, its offer, and the code
// presented as what it actually is — a coupon. The app is a footnote at the
// bottom, because nobody walks into a gym for the software.
//
// Everything here comes from one anonymous RPC (get_share_preview, migration
// 0653). No session, no app, no account.

const FALLBACK_PRIMARY = '#D4AF37';
const FALLBACK_SURFACE = '#0B0F12';

export default function ReferralLanding() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');

  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logoBroken, setLogoBroken] = useState(false);
  const [copied, setCopied] = useState(false);

  // Stash the code regardless of what the preview lookup does. Even if the RPC
  // is down or the code is unknown, someone who taps "create account" from here
  // must still land in signup carrying their referral — the credit for the
  // referral is the whole point, and it must not depend on a preview render.
  useEffect(() => {
    if (!code) return;
    try { localStorage.setItem('pendingReferralCode', code); } catch { /* private mode */ }
  }, [code]);

  useEffect(() => {
    if (!code) { setLoading(false); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_share_preview', {
          p_kind: 'referral',
          p_id: code,
        });
        if (cancelled) return;
        if (error) throw error;
        setPreview(data?.found ? data : null);
      } catch (err) {
        logger.error?.('ReferralLanding: preview lookup failed', err);
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  const gym     = preview?.gym || null;
  const offer   = preview?.offer || {};
  const inviter = preview?.referrer_first_name || null;

  const primary = gym?.primary_color || FALLBACK_PRIMARY;
  const onPrimary = textOnColor(primary);

  const isEn = String(i18n.language || 'es').startsWith('en');
  // headline_en is optional and falls back to the Spanish the owner wrote —
  // an English-speaking visitor seeing Spanish beats one seeing nothing.
  const offerHeadline = offer?.enabled
    ? ((isEn && offer.headline_en) || offer.headline || null)
    : null;

  const logoUrl = gym?.logo_url && !logoBroken
    ? supabase.storage.from('gym-logos').getPublicUrl(gym.logo_url).data?.publicUrl
    : null;

  let endsLabel = null;
  if (offerHeadline && offer.ends_on) {
    try {
      // Parse as local midnight — a bare 'YYYY-MM-DD' is treated as UTC by the
      // Date constructor, which shows the day BEFORE for anyone west of GMT.
      const d = new Date(`${offer.ends_on}T00:00:00`);
      if (!Number.isNaN(d.getTime()) && d.getTime() >= Date.now() - 86400000) {
        endsLabel = d.toLocaleDateString(i18n.language || 'es', { day: 'numeric', month: 'long' });
      }
    } catch { /* a bad date just hides the line */ }
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the code is on screen anyway */ }
  };

  const shell = (children) => (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '40px 22px calc(32px + env(safe-area-inset-bottom, 0px))',
        background: `radial-gradient(circle at 50% 0%, color-mix(in srgb, ${primary} 22%, ${FALLBACK_SURFACE}) 0%, ${FALLBACK_SURFACE} 62%)`,
        color: '#fff',
        fontFamily: 'Barlow, system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>{children}</div>
    </div>
  );

  if (loading) {
    return shell(
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
        <div style={{ width: 76, height: 76, borderRadius: 22, background: 'rgba(255,255,255,0.07)' }} />
        <div style={{ width: 180, height: 16, borderRadius: 8, background: 'rgba(255,255,255,0.07)' }} />
        <div style={{ width: 240, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.05)' }} />
      </div>,
    );
  }

  // Unknown / expired / inactive code. Never a dead end: the visitor still came
  // from a friend, so send them somewhere useful instead of an error.
  if (!gym) {
    return shell(
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontFamily: '"Barlow Condensed", Barlow, system-ui, sans-serif',
          fontWeight: 800, fontSize: 30, letterSpacing: -0.4, lineHeight: 1.1, marginBottom: 10,
        }}>
          {t('referralLanding.genericTitle', 'Te invitaron a entrenar')}
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.5, color: 'rgba(255,255,255,0.7)', marginBottom: 26 }}>
          {t('referralLanding.genericBody', 'Crea tu cuenta y únete al gimnasio de tu amigo.')}
        </p>
        <button
          type="button"
          onClick={() => navigate('/signup')}
          style={{
            width: '100%', height: 54, borderRadius: 15, border: 'none', cursor: 'pointer',
            background: FALLBACK_PRIMARY, color: textOnColor(FALLBACK_PRIMARY),
            fontFamily: '"Barlow Condensed", Barlow, system-ui, sans-serif',
            fontWeight: 800, fontSize: 17, letterSpacing: 0.2,
          }}
        >
          {t('referralLanding.createAccount', 'Crear mi cuenta')}
        </button>
      </div>,
    );
  }

  return shell(
    <div style={{ textAlign: 'center' }}>

      {/* ── The gym, not the app ─────────────────────────────────────────── */}
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={gym.name}
          onError={() => setLogoBroken(true)}
          style={{
            width: 84, height: 84, borderRadius: 24, objectFit: 'cover',
            margin: '0 auto 16px', display: 'block',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
          }}
        />
      ) : (
        <div style={{
          width: 84, height: 84, borderRadius: 24, margin: '0 auto 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: primary, color: onPrimary,
          fontFamily: '"Barlow Condensed", Barlow, system-ui, sans-serif',
          fontWeight: 800, fontSize: 38, lineHeight: 1,
        }}>
          {(gym.name || '?').trim().charAt(0).toUpperCase()}
        </div>
      )}

      {/* color is EXPLICIT and must stay that way. index.css:900 sets
          `h1,h2,…{ color: var(--color-text-primary) }`, and a rule on the
          element beats the `color:#fff` this page inherits from its shell.
          Worse, nobody is signed in here so applyBranding() never runs and that
          variable sits at its LIGHT-mode default — near-black text on a
          near-black gradient. The heading renders, measures 331×34, and is
          completely invisible. */}
      <h1 style={{
        fontFamily: '"Barlow Condensed", Barlow, system-ui, sans-serif',
        fontWeight: 800, fontSize: 32, lineHeight: 1.05, letterSpacing: -0.4, margin: '0 0 8px',
        color: '#fff',
      }}>
        {gym.name}
      </h1>

      <p style={{ fontSize: 15.5, lineHeight: 1.45, color: 'rgba(255,255,255,0.74)', margin: '0 0 4px' }}>
        {inviter
          ? t('referralLanding.invitedBy', '{{name}} te invita a entrenar aquí.', { name: inviter })
          : t('referralLanding.invitedGeneric', 'Te invitaron a entrenar aquí.')}
      </p>

      {gym.address && (
        <p style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6,
          fontSize: 13, color: 'rgba(255,255,255,0.5)',
        }}>
          <MapPin size={13} strokeWidth={2} />{gym.address}
        </p>
      )}

      {/* ── The offer — the reason a stranger keeps reading ───────────────── */}
      {offerHeadline && (
        <div style={{
          marginTop: 26, padding: '20px 18px', borderRadius: 20,
          background: `color-mix(in srgb, ${primary} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${primary} 38%, transparent)`,
        }}>
          <div style={{
            fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase',
            color: `color-mix(in srgb, ${primary} 70%, #fff)`, fontWeight: 700, marginBottom: 8,
          }}>
            {t('referralLanding.offerEyebrow', 'Tu oferta de bienvenida')}
          </div>
          <div style={{
            fontFamily: '"Barlow Condensed", Barlow, system-ui, sans-serif',
            fontWeight: 800, fontSize: 27, lineHeight: 1.08, letterSpacing: -0.3,
          }}>
            {offerHeadline}
          </div>
          {offer.detail && (
            <p style={{ fontSize: 13.5, lineHeight: 1.45, color: 'rgba(255,255,255,0.68)', margin: '10px 0 0' }}>
              {offer.detail}
            </p>
          )}
          {endsLabel && (
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', margin: '10px 0 0' }}>
              {t('referralLanding.validUntil', 'Válida hasta el {{date}}', { date: endsLabel })}
            </p>
          )}
        </div>
      )}

      {/* ── The code IS the coupon ────────────────────────────────────────
          There is no billing in the app by design, so no discount is applied
          or validated in software — the front desk honours it. That makes this
          string the thing the visitor has to SHOW someone, not a hidden token
          the signup form consumes. It gets to be big. */}
      <button
        type="button"
        onClick={copyCode}
        style={{
          width: '100%', marginTop: 14, padding: '14px 16px', borderRadius: 16, cursor: 'pointer',
          background: 'rgba(255,255,255,0.05)',
          border: '1px dashed rgba(255,255,255,0.24)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        }}
      >
        <span style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>
          {t('referralLanding.codeLabel', 'Menciona este código en recepción')}
        </span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 9,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 20, fontWeight: 700, letterSpacing: 1, color: '#fff',
        }}>
          {code}
          {copied
            ? <Check size={16} strokeWidth={2.6} style={{ color: primary }} />
            : <Copy size={15} strokeWidth={2.2} style={{ color: 'rgba(255,255,255,0.55)' }} />}
        </span>
        {copied && (
          <span style={{ fontSize: 11.5, color: primary, fontWeight: 600 }}>
            {t('referralLanding.copied', 'Copiado')}
          </span>
        )}
      </button>

      {/* ── Actions ───────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => navigate('/signup')}
        style={{
          width: '100%', height: 54, marginTop: 18, borderRadius: 15, border: 'none', cursor: 'pointer',
          background: primary, color: onPrimary,
          fontFamily: '"Barlow Condensed", Barlow, system-ui, sans-serif',
          fontWeight: 800, fontSize: 17.5, letterSpacing: 0.2,
        }}
      >
        {t('referralLanding.createAccount', 'Crear mi cuenta')}
      </button>

      {gym.website_url && (
        <a
          href={gym.website_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            width: '100%', height: 50, marginTop: 10, borderRadius: 15,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.14)',
            color: '#fff', textDecoration: 'none',
            fontWeight: 700, fontSize: 14.5,
          }}
        >
          <ExternalLink size={15} strokeWidth={2.2} />
          {t('referralLanding.visitGym', 'Conoce {{name}}', { name: gym.name })}
        </a>
      )}

      <div style={{ marginTop: 26, fontSize: 11.5, color: 'rgba(255,255,255,0.35)', letterSpacing: 0.3 }}>
        {t('referralLanding.poweredBy', 'con tecnología de TuGymPR')}
      </div>
    </div>,
  );
}
