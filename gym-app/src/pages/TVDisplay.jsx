import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabase';
import { derivePalette, TV_METRIC_DEFS } from '../lib/tv/palette';
import { getTvStrings, getMetricSlides, tvPeriodLabel } from '../lib/tv/strings';
import { PROD_WEB_URL } from '../lib/appUrls';
import TVStyleStadium from '../components/tv/TVStyleStadium';
import TVStyleBrutal from '../components/tv/TVStyleBrutal';
import TVStyleBoricua from '../components/tv/TVStyleBoricua';
import TVStyleTelemetry from '../components/tv/TVStyleTelemetry';

/**
 * TVDisplay — public, code-gated fullscreen leaderboard + challenge rotation.
 *
 * Flow:
 *   1. Visit /tv-display (no auth required).
 *   2. If no valid code stashed in localStorage → render the code-entry
 *      screen. Owner types the 6-char code from their admin panel.
 *   3. On success: rotate through metric leaderboards + one slide per active
 *      challenge with a join-this-challenge QR.
 *   4. Heartbeat every 30s via tv_get_dashboard_data. If the code was
 *      rotated, the RPC returns invalid_code and we bounce back to the
 *      entry screen + clear localStorage.
 *   5. The visual style (stadium / brutal / boricua / telemetry) is
 *      picked by the admin and returned on every heartbeat, so live TVs
 *      switch within ~30s of the admin changing the choice.
 *
 * URL params (per-TV, bookmarked on each device):
 *   ?lang=en|es          — TV display language (default: gym timezone-based)
 *   ?track=mixed         — both metric leaderboards AND challenges (default)
 *   ?track=leaderboards  — only metric leaderboards (no challenge slides)
 *   ?track=challenges    — only challenge slides (skip metric leaderboards)
 *
 * This lets a gym with 2+ TVs dedicate one to leaderboards and one to
 * challenges, or run an EN TV + ES TV side-by-side. Each TV maintains its
 * own session_id (per-device localStorage) so they all appear separately in
 * the admin's connected-sessions list.
 *
 * The page intentionally takes no auth context — it's expected to run on
 * a TV with no Supabase session. All access is gated by the code.
 */

const SLIDE_DURATION_MS = 20_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const STORAGE_KEY = 'tugympr_tv_credentials';
const SESSION_ID_KEY = 'tugympr_tv_session_id';

const STYLE_COMPONENTS = {
  stadium:   TVStyleStadium,
  brutal:    TVStyleBrutal,
  boricua:   TVStyleBoricua,
  telemetry: TVStyleTelemetry,
};

// Read URL params with safe defaults. Lang falls through to 'en' here and
// is reconciled later against the gym's timezone (PR gyms default to es).
function readUrlConfig() {
  try {
    const params = new URLSearchParams(window.location.search);
    const langRaw = (params.get('lang') || '').toLowerCase();
    const trackRaw = (params.get('track') || 'mixed').toLowerCase();
    return {
      lang: langRaw === 'es' || langRaw === 'en' ? langRaw : null,
      track: trackRaw === 'leaderboards' || trackRaw === 'challenges' ? trackRaw : 'mixed',
    };
  } catch {
    return { lang: null, track: 'mixed' };
  }
}

// Per-session UUID. Persists in localStorage so reconnects after a TV
// reboot are tracked as the same device in the admin connection list.
function getOrCreateSessionId() {
  try {
    let id = localStorage.getItem(SESSION_ID_KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID())
        || `tv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(SESSION_ID_KEY, id);
    }
    return id;
  } catch {
    return `tv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

// Read the saved code (set after a successful authenticate). Wrapped in
// try/catch for storage-unavailable contexts (Capacitor WebView quirks).
function readStoredCredentials() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function storeCredentials(creds) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(creds)); } catch {}
}

function clearCredentials() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export default function TVDisplay() {
  const sessionIdRef = useRef(getOrCreateSessionId());
  const urlConfigRef = useRef(readUrlConfig());
  const [credentials, setCredentials] = useState(readStoredCredentials);
  const [dashboardData, setDashboardData] = useState(null);
  const [slideIdx, setSlideIdx] = useState(0);
  const [clock, setClock] = useState(new Date());
  const [authError, setAuthError] = useState(null);
  const [resolvedLogoUrl, setResolvedLogoUrl] = useState(null);

  // Lang resolution: explicit ?lang= wins; otherwise infer from gym timezone
  // (Puerto Rico = America/Puerto_Rico → Spanish). Defaults to English.
  const lang = (() => {
    if (urlConfigRef.current.lang) return urlConfigRef.current.lang;
    const tz = credentials?.gym_timezone || '';
    if (tz.includes('Puerto_Rico') || tz.startsWith('America/Puerto')) return 'es';
    return 'en';
  })();
  const track = urlConfigRef.current.track;

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Silent re-auth when stored credentials are missing fields the latest
  // tv_authenticate version returns (gym_timezone, primary_color, tv_style,
  // real gym name). This happens after a server-side RPC upgrade — the TV
  // was authenticated before the new fields existed, so localStorage holds
  // the old credential shape.
  useEffect(() => {
    if (!credentials?.code) return;
    if (
      credentials.gym_timezone !== undefined
      && credentials.primary_color !== undefined
      && credentials.tv_style !== undefined
    ) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('tv_authenticate', {
          p_code: credentials.code,
          p_session_id: sessionIdRef.current,
          p_user_agent: navigator.userAgent || null,
        });
        if (cancelled || error || !data?.success) return;
        const fresh = {
          code: credentials.code,
          gym_id: data.gym_id,
          gym_name: data.gym_name,
          gym_slug: data.gym_slug,
          gym_timezone: data.gym_timezone || null,
          accent_color: data.accent_color,
          primary_color: data.primary_color,
          logo_url: data.logo_url,
          tv_style: data.tv_style || 'stadium',
        };
        storeCredentials(fresh);
        setCredentials(fresh);
      } catch { /* silent — let regular heartbeat catch issues */ }
    })();
    return () => { cancelled = true; };
  }, [credentials?.code, credentials?.gym_timezone, credentials?.primary_color, credentials?.tv_style]);

  // Resolve the logo storage path → signed URL. The auth RPC returns the
  // RAW storage path (e.g. "<gym_id>/logo.png") because RPCs can't mint
  // signed URLs themselves. We sign it client-side with a 24-hour expiry —
  // way longer than any TV viewing session, and the TV's heartbeat will
  // re-resolve next time it re-authenticates if it ever lapses.
  useEffect(() => {
    if (!credentials?.logo_url) { setResolvedLogoUrl(null); return; }
    const path = credentials.logo_url;
    // Already a full URL (signed earlier or admin-uploaded direct link) — pass through.
    if (path.startsWith('http://') || path.startsWith('https://')) {
      setResolvedLogoUrl(path);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.storage
          .from('gym-logos')
          .createSignedUrl(path, 60 * 60 * 24);
        if (cancelled) return;
        if (!error && data?.signedUrl) {
          setResolvedLogoUrl(data.signedUrl);
        } else {
          setResolvedLogoUrl(null);
        }
      } catch {
        if (!cancelled) setResolvedLogoUrl(null);
      }
    })();
    return () => { cancelled = true; };
  }, [credentials?.logo_url]);

  // Format the clock in the gym's timezone (not the TV device's local time).
  // Falls back to the device's TZ if the gym has no timezone set — safer
  // than crashing on an Intl error. Locale flows from the `lang` URL param
  // so a Spanish TV shows "JUEVES, MAY 21" instead of "THURSDAY, MAY 21".
  const tz = credentials?.gym_timezone || undefined;
  const intlLocale = lang === 'es' ? 'es-ES' : 'en-US';
  // Clock time is always rendered en-US so the marker reads "AM/PM" (one token)
  // rather than Spanish "p. m." (which also broke the Brutal style's space-split,
  // showing "6:19p."). The date below stays localized.
  const timeFmt = (() => {
    try { return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }); }
    catch { return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); }
  })();
  const dateFmt = (() => {
    try { return new Intl.DateTimeFormat(intlLocale, { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz }); }
    catch { return new Intl.DateTimeFormat(intlLocale, { weekday: 'long', month: 'short', day: 'numeric' }); }
  })();

  // Build the full slide list once credentials + data land. Order:
  //   1. Metric leaderboards (localized labels per ?lang=)
  //   2. Active challenges (one slide each, sorted by start_date asc)
  // Empty metric leaderboards still take a slot — they show "no activity
  // yet" which is itself a useful prompt for an empty gym.
  //
  // Track filter (?track=) lets a gym dedicate a TV to one type:
  //   - mixed (default): metric + challenge slides interleaved
  //   - leaderboards: metric slides only
  //   - challenges: challenge slides only (empty state = no active challenges)
  const slides = useMemo(() => {
    if (!dashboardData) return [];
    // The gym-chosen window applies to the count-based boards only; the other
    // three keep their intrinsic labels (PRs = all-time, Improved/Consistency
    // = this month). Mirrors the period applied server-side in 0518.
    const windowedLabel = tvPeriodLabel(lang, dashboardData.tv_period || 'month');
    const WINDOWED = new Set(['volume', 'workouts', 'checkins']);
    const metricSlides = getMetricSlides(lang).map((m) => ({
      kind: 'metric',
      key: m.key,
      label: m.label,
      unit: m.unit,
      period: WINDOWED.has(m.key) ? windowedLabel : m.period,
      entries: dashboardData.leaderboards?.[m.key] || [],
    }));
    const challengeSlides = (dashboardData.challenges || []).map((c) => ({
      kind: 'challenge',
      key: `challenge-${c.id}`,
      challenge: c,
    }));
    if (track === 'leaderboards') return metricSlides;
    if (track === 'challenges') return challengeSlides;
    return [...metricSlides, ...challengeSlides];
  }, [dashboardData, lang, track]);

  // Auto-rotate the slide cursor. If the slide count drops between cycles
  // (a challenge ended mid-rotation), clamp back into range.
  useEffect(() => {
    if (slides.length === 0) return;
    if (slideIdx >= slides.length) {
      setSlideIdx(0);
      return;
    }
    const t = setInterval(() => {
      setSlideIdx((i) => (i + 1) % slides.length);
    }, SLIDE_DURATION_MS);
    return () => clearInterval(t);
  }, [slides.length, slideIdx]);

  // Heartbeat + data refresh. One RPC fetches everything. Also serves as
  // the rotation invalidation check — if the admin rotated the code, this
  // returns invalid_code and we bounce to the entry screen.
  const refreshData = useCallback(async () => {
    if (!credentials?.code) return;
    try {
      const { data, error } = await supabase.rpc('tv_get_dashboard_data', {
        p_code: credentials.code,
        p_session_id: sessionIdRef.current,
      });
      if (error) throw error;
      if (!data?.success) {
        // Code rotated, this screen revoked by an admin, or otherwise
        // invalidated. Drop back to the entry screen so it can re-auth.
        clearCredentials();
        setCredentials(null);
        setDashboardData(null);
        const tStr = getTvStrings(lang);
        setAuthError(
          data?.error === 'revoked'
            ? (tStr.entryErrRevoked || tStr.entryErrGeneric)
            : (tStr.entryErrExpired || tStr.entryErrGeneric),
        );
        return;
      }
      setDashboardData(data);
    } catch (err) {
      // Transient network failure — don't drop the TV from valid state,
      // just leave the last-known data on screen and try again next tick.
      console.warn('[TV] refresh failed:', err?.message || err);
    }
    // lang is included only for the bounce-error message; it's effectively
    // static per TV (URL param / gym timezone), so it won't churn the interval.
  }, [credentials?.code, lang]);

  useEffect(() => {
    if (!credentials?.code) return;
    refreshData();
    const t = setInterval(refreshData, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(t);
  }, [credentials?.code, refreshData]);

  // ── Code-entry screen ─────────────────────────────────────────────────
  if (!credentials) {
    return (
      <CodeEntryScreen
        sessionId={sessionIdRef.current}
        initialError={authError}
        lang={lang}
        onAuthenticated={(creds) => {
          storeCredentials(creds);
          setCredentials(creds);
          setAuthError(null);
        }}
      />
    );
  }

  // ── Display screen ────────────────────────────────────────────────────
  // The "style" choice ships from the server on every heartbeat so changes
  // an admin makes in /admin/tv-setup propagate to live TVs within ~30s
  // without a page reload. Defaults to `stadium` if the server hasn't
  // assigned one yet (gym pre-0427) or if an unknown value comes in.
  const styleKey = dashboardData?.tv_style || credentials.tv_style || 'stadium';
  const StyleComponent = STYLE_COMPONENTS[styleKey] || TVStyleStadium;
  const palette = derivePalette({
    primary: credentials.primary_color,
    accent: credentials.accent_color,
  });
  const slide = slides[slideIdx];

  // Empty-track guard: if owner set ?track=challenges and there are no
  // active challenges, the slide list is empty. Show a hint screen instead
  // of an infinite spinner so the TV doesn't look broken.
  const tvStrings = getTvStrings(lang);
  const isEmptyChallengeTrack = dashboardData && track === 'challenges' && slides.length === 0;

  return (
    <div className="h-screen overflow-hidden select-none" style={{ height: '100dvh', background: palette.ink }}>
      {isEmptyChallengeTrack ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-10" style={{ background: palette.ink, color: palette.text }}>
          <div className="text-[20px] tracking-[0.3em] font-bold uppercase mb-3" style={{ color: palette.hot }}>
            {tvStrings.activeChallenge}
          </div>
          <div className="text-[64px] font-black mb-3" style={{ letterSpacing: '-2px' }}>
            {tvStrings.noActivity}
          </div>
          <div className="text-[20px]" style={{ color: palette.textDim }}>
            {tvStrings.noActivitySub}
          </div>
        </div>
      ) : !slide ? (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: palette.ink }}>
          <div className="w-12 h-12 border-2 rounded-full animate-spin" style={{ borderColor: `${palette.hot}30`, borderTopColor: palette.hot }} />
        </div>
      ) : slide.kind === 'challenge' ? (
        <ChallengeSlide
          slide={slide}
          accent={palette.hot}
          palette={palette}
          gymSlug={credentials.gym_slug}
          gymName={credentials.gym_name}
          logoUrl={resolvedLogoUrl}
          clock={clock}
          timeFmt={timeFmt}
          dateFmt={dateFmt}
          slideIdx={slideIdx}
          totalSlides={slides.length}
          lang={lang}
        />
      ) : (
        <StyleComponent
          slide={slide}
          palette={palette}
          gymName={credentials.gym_name}
          logoUrl={resolvedLogoUrl}
          clock={clock}
          timeFmt={timeFmt}
          dateFmt={dateFmt}
          slideIdx={slideIdx}
          totalSlides={slides.length}
          metricKey={slide.key}
          lang={lang}
        />
      )}
    </div>
  );
}

// ── Code entry screen ────────────────────────────────────────────────────
function CodeEntryScreen({ sessionId, initialError, onAuthenticated, lang = 'en' }) {
  const tStr = getTvStrings(lang);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(initialError || null);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('tv_authenticate', {
        p_code: code.trim().toUpperCase(),
        p_session_id: sessionId,
        p_user_agent: navigator.userAgent || null,
      });
      if (rpcErr) throw rpcErr;
      if (!data?.success) {
        setError(
          data?.error === 'invalid_code' ? tStr.entryErrInvalid :
          data?.error === 'gym_inactive' ? tStr.entryErrPaused :
          data?.error === 'rate_limited' ? tStr.entryErrRateLimited :
          tStr.entryErrGeneric
        );
        return;
      }
      onAuthenticated({
        code: code.trim().toUpperCase(),
        gym_id: data.gym_id,
        gym_name: data.gym_name,
        gym_slug: data.gym_slug,
        gym_timezone: data.gym_timezone || null,
        accent_color: data.accent_color,
        primary_color: data.primary_color,
        logo_url: data.logo_url,
        tv_style: data.tv_style || 'stadium',
      });
    } catch (err) {
      setError(err?.message || tStr.entryErrGeneric);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-10"
      style={{ background: '#05070B', fontFamily: 'Barlow, sans-serif' }}
    >
      <div className="text-center max-w-xl w-full">
        <p className="text-[12px] font-bold tracking-[0.4em] uppercase mb-3" style={{ color: '#9CA3AF' }}>
          {tStr.entryHeader}
        </p>
        <h1 className="text-[56px] font-black leading-none mb-2 text-white">{tStr.entryTitle}</h1>
        <p className="text-[15px] mb-10" style={{ color: '#9CA3AF' }}>
          {tStr.entryHint}
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
            placeholder="••••••••"
            maxLength={8}
            autoFocus
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="w-full text-center bg-transparent outline-none border-0 border-b-4 font-mono font-black tabular-nums tracking-[0.3em]"
            style={{
              // clamp so an 8-char code (migration 0491) fits the max-w-xl
              // (576px) entry container WITHOUT horizontal overflow: at ~0.9em
              // per monospace glyph incl. 0.3em tracking, 8 chars ≈ 7.2em, so
              // the 72px cap keeps it ≈518px (< 576). Still a big hero input on
              // a TV; scales down toward 44px on phones.
              fontSize: 'clamp(44px, 9vw, 72px)',
              color: '#FFFFFF',
              borderColor: 'rgba(212,175,55,0.4)',
              padding: '12px 0',
              caretColor: '#D4AF37',
            }}
          />

          {error && (
            <p className="text-[14px] font-semibold" style={{ color: '#F87171' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={(code.length !== 6 && code.length !== 8) || submitting}
            className="px-10 py-4 rounded-xl text-[15px] font-bold transition-all disabled:opacity-30"
            style={{
              background: '#D4AF37',
              color: '#000',
              minWidth: 200,
            }}
          >
            {submitting ? tStr.entryConnecting : tStr.entryConnect}
          </button>
        </form>

        <p className="text-[11px] mt-12" style={{ color: 'rgba(255,255,255,0.25)' }}>
          {tStr.entrySession} <code className="font-mono">{sessionId.slice(0, 8)}…</code>
        </p>
      </div>
    </div>
  );
}

// ── Challenge slide ──────────────────────────────────────────────────────
// Left: challenge name, type, time remaining, top-5 leaderboard.
// Right: large QR code that links into the app's challenges page so a
// member walking by can scan + join. The deep link includes the challenge
// id so the page can scroll to / open the right card on landing.
function ChallengeSlide({ slide, accent, gymSlug, lang = 'en' }) {
  const c = slide.challenge;
  const tStr = getTvStrings(lang);
  const now = new Date();
  const endDate = c.end_date ? new Date(c.end_date) : null;
  const startDate = c.start_date ? new Date(c.start_date) : null;
  const notStartedYet = startDate && startDate > now;

  // Time-remaining / starts-in label. Days are the right resolution for
  // a TV slide — minutes/hours-level countdowns are noise at 10ft viewing.
  let timeLabel = '';
  if (notStartedYet) {
    const days = Math.ceil((startDate - now) / 86_400_000);
    timeLabel = days <= 1 ? tStr.startsTomorrow : `${tStr.startsIn} ${days} ${tStr.days}`;
  } else if (endDate) {
    const days = Math.ceil((endDate - now) / 86_400_000);
    timeLabel = days <= 0 ? tStr.finalHours : days === 1 ? tStr.endsTomorrow : `${days} ${tStr.daysLeft}`;
  } else {
    timeLabel = tStr.ongoing;
  }

  // QR deep link: opens the gym's web app on the challenges page, focused on
  // this challenge. The member's phone browser handles auth — if signed in,
  // they land on the challenge detail; otherwise they're routed through
  // login first. The gym slug helps post-login routing land in the right
  // tenant when the member uses a fresh browser.
  const qrUrl = (() => {
    // Must be a publicly reachable URL — a phone scanning the TV can't reach the
    // TV's own origin when that's localhost (dev) or a kiosk host. In dev we use
    // the canonical production URL; in prod the real serving origin is correct
    // (handles custom domains too).
    const base = import.meta.env.DEV ? PROD_WEB_URL : window.location.origin;
    const params = new URLSearchParams({ challenge: c.id });
    if (gymSlug) params.set('gym', gymSlug);
    return `${base}/challenges?${params.toString()}`;
  })();

  const participants = c.participants || [];
  const topTen = participants.slice(0, 10);

  return (
    // Same no-scroll discipline as the metric leaderboard slides: grid + min-h-0 + flex-1
    // inside each column lets the rows distribute across whatever height
    // is left after the header, not push past it.
    <div className="flex-1 min-h-0 grid grid-cols-[1fr_360px] xl:grid-cols-[1fr_420px] gap-8 lg:gap-12 px-8 lg:px-12 pt-5 lg:pt-7 pb-5 lg:pb-7 overflow-hidden">
      {/* ── Left column: name + leaderboard ─────────────────────── */}
      <div className="flex flex-col min-h-0 overflow-hidden">
        <div className="mb-4 lg:mb-5 flex-shrink-0">
          <p className="text-[12px] lg:text-[13px] font-bold tracking-[0.3em] uppercase mb-2" style={{ color: accent }}>
            {tStr.activeChallenge} · {timeLabel}
          </p>
          <h1
            className="font-black leading-none tracking-tight mb-3 text-[40px] lg:text-[48px] xl:text-[56px]"
            style={{ color: '#FFFFFF', letterSpacing: '-0.02em' }}
          >
            {c.name}
          </h1>
          {c.description && (
            <p className="text-[15px] lg:text-[17px] leading-snug max-w-2xl line-clamp-2" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {c.description}
            </p>
          )}
          {c.reward_description && (
            <div
              className="inline-flex items-center gap-2 px-3 lg:px-4 py-1.5 lg:py-2 rounded-full mt-3 lg:mt-4 text-[12px] lg:text-[14px] font-bold"
              style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}44` }}
            >
              🏆 {c.reward_description}
            </div>
          )}
        </div>

        {/* Top-10 within this challenge — uniform flex rows distribute across
            the available height, so the list always fits (no overflow / clip)
            no matter how many of the 10 are filled. */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {topTen.length === 0 ? (
            <div className="h-full flex items-center justify-center rounded-2xl border-2 border-dashed" style={{ borderColor: `${accent}30` }}>
              <div className="text-center px-8">
                <p className="text-[26px] lg:text-[32px] font-black" style={{ color: accent }}>{tStr.beTheFirst}</p>
                <p className="text-[14px] lg:text-[16px] mt-2" style={{ color: 'rgba(255,255,255,0.4)' }}>{tStr.scanToJoin}</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 lg:gap-2 h-full">
              {topTen.map((p, i) => (
                <div
                  key={p.profile_id}
                  className="relative flex items-center gap-3 lg:gap-4 rounded-lg lg:rounded-xl px-3 lg:px-4 min-h-0"
                  style={{
                    flex: '1 1 0',
                    background: i < 3 ? `${accent}10` : 'rgba(255,255,255,0.03)',
                    border: i < 3 ? `1px solid ${accent}33` : '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  <div className="w-8 lg:w-10 flex items-center justify-center flex-shrink-0">
                    {i < 3 ? (
                      <span className="text-[20px] lg:text-[26px]">{['🥇', '🥈', '🥉'][i]}</span>
                    ) : (
                      <span className="text-[15px] lg:text-[19px] font-black" style={{ color: 'rgba(255,255,255,0.3)' }}>{i + 1}</span>
                    )}
                  </div>
                  <p
                    className="flex-1 font-black truncate text-[15px] lg:text-[20px]"
                    style={{ color: i === 0 ? accent : 'rgba(255,255,255,0.9)' }}
                  >
                    {p.name}
                  </p>
                  <p
                    className="font-black tabular-nums flex-shrink-0 text-[15px] lg:text-[20px]"
                    style={{ color: i === 0 ? accent : 'rgba(255,255,255,0.75)' }}
                  >
                    {p.score != null ? Number(p.score).toLocaleString() : '—'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right column: QR join code ────────────────────────────
           min-h-0 + overflow-hidden, QR sized at 280-320 instead of 336
           so 720p TVs don't push the bottom labels off-screen. */}
      <div className="flex flex-col items-center justify-center min-h-0 overflow-hidden">
        <div className="rounded-2xl lg:rounded-3xl p-4 lg:p-6 mb-4 lg:mb-5" style={{ background: '#FFFFFF' }}>
          <QRCodeSVG
            value={qrUrl}
            size={280}
            level="M"
            bgColor="#FFFFFF"
            fgColor="#000000"
            includeMargin={false}
            className="block max-w-[40vh] max-h-[40vh] w-auto h-auto"
          />
        </div>
        <p className="text-[18px] lg:text-[20px] font-black uppercase tracking-widest mb-1" style={{ color: '#FFFFFF' }}>
          {notStartedYet ? tStr.signUp : tStr.joinNow}
        </p>
        <p className="text-[12px] lg:text-[14px] font-semibold text-center" style={{ color: 'rgba(255,255,255,0.5)' }}>
          {tStr.scanWithPhone}
        </p>
        {participants.length > 0 && (
          <p className="text-[11px] lg:text-[13px] font-bold uppercase tracking-widest mt-3 lg:mt-4" style={{ color: accent }}>
            {participants.length} {participants.length === 1 ? tStr.memberIn : tStr.membersIn}
          </p>
        )}
      </div>
    </div>
  );
}
