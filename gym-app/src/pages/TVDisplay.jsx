import { useEffect, useState, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabase';

/**
 * TVDisplay — public, code-gated fullscreen leaderboard + challenge rotation.
 *
 * Flow:
 *   1. Visit /tv-display (no auth required).
 *   2. If no valid code stashed in localStorage → render the code-entry
 *      screen. Owner types the 6-char code from their admin panel.
 *   3. On success: rotate through 6 metric leaderboards (volume, workouts,
 *      PRs, most improved, consistency, check-ins) + one slide per active
 *      challenge with a join-this-challenge QR.
 *   4. Heartbeat every 30s via tv_get_dashboard_data. If the code was
 *      rotated, the RPC returns invalid_code and we bounce back to the
 *      entry screen + clear localStorage.
 *
 * The page intentionally takes no auth context — it's expected to run on
 * a TV with no Supabase session. All access is gated by the code.
 */

const SLIDE_DURATION_MS = 20_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const STORAGE_KEY = 'tugympr_tv_credentials';
const SESSION_ID_KEY = 'tugympr_tv_session_id';

const METRIC_SLIDES = [
  { key: 'volume',      label: 'VOLUME',        unit: 'LBS',      period: 'LAST 30 DAYS' },
  { key: 'workouts',    label: 'WORKOUTS',      unit: 'SESSIONS', period: 'LAST 30 DAYS' },
  { key: 'prs',         label: 'TOP PRs',       unit: 'RECORDS',  period: 'ALL TIME' },
  { key: 'improved',    label: 'MOST IMPROVED', unit: '%',        period: 'THIS MONTH' },
  { key: 'consistency', label: 'CONSISTENCY',   unit: '%',        period: 'THIS MONTH' },
  { key: 'checkins',    label: 'CHECK-INS',     unit: 'VISITS',   period: 'LAST 30 DAYS' },
];

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
  const [credentials, setCredentials] = useState(readStoredCredentials);
  const [dashboardData, setDashboardData] = useState(null);
  const [slideIdx, setSlideIdx] = useState(0);
  const [clock, setClock] = useState(new Date());
  const [authError, setAuthError] = useState(null);
  const [resolvedLogoUrl, setResolvedLogoUrl] = useState(null);

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

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
  // than crashing on an Intl error. Memoize the formatters so we're not
  // rebuilding them every tick.
  const tz = credentials?.gym_timezone || undefined;
  const timeFmt = (() => {
    try { return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }); }
    catch { return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); }
  })();
  const dateFmt = (() => {
    try { return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz }); }
    catch { return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); }
  })();

  // Build the full slide list once credentials + data land. Order:
  //   1. Metric leaderboards (in METRIC_SLIDES order)
  //   2. Active challenges (one slide each, sorted by start_date asc)
  // Empty metric leaderboards still take a slot — they show "no activity
  // yet" which is itself a useful prompt for an empty gym.
  const slides = (() => {
    if (!dashboardData) return [];
    const metricSlides = METRIC_SLIDES.map((m) => ({
      kind: 'metric',
      key: m.key,
      label: m.label,
      unit: m.unit,
      period: m.period,
      entries: dashboardData.leaderboards?.[m.key] || [],
    }));
    const challengeSlides = (dashboardData.challenges || []).map((c) => ({
      kind: 'challenge',
      key: `challenge-${c.id}`,
      challenge: c,
    }));
    return [...metricSlides, ...challengeSlides];
  })();

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
        // Code was rotated or otherwise invalidated. Drop back to entry.
        clearCredentials();
        setCredentials(null);
        setDashboardData(null);
        setAuthError('Code expired. Please re-enter.');
        return;
      }
      setDashboardData(data);
    } catch (err) {
      // Transient network failure — don't drop the TV from valid state,
      // just leave the last-known data on screen and try again next tick.
      console.warn('[TV] refresh failed:', err?.message || err);
    }
  }, [credentials?.code]);

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
        onAuthenticated={(creds) => {
          storeCredentials(creds);
          setCredentials(creds);
          setAuthError(null);
        }}
      />
    );
  }

  // ── Display screen ────────────────────────────────────────────────────
  const accent = credentials.accent_color || '#10B981';
  const primary = credentials.primary_color || '#0F172A';
  const slide = slides[slideIdx];

  return (
    // h-screen + overflow-hidden + 100dvh fallback so the layout NEVER
    // scrolls — every child uses flex-1/flex-basis-0 or fixed flex-shrink-0.
    // Using primary_color for the page background so the gym's brand tints
    // the whole stage (subtle, mixed with deep slate so text contrast holds).
    <div
      className="h-screen flex flex-col overflow-hidden select-none"
      style={{
        height: '100dvh',
        background: `linear-gradient(180deg, ${primary}40 0%, #05070B 60%)`,
        color: '#E5E7EB',
        fontFamily: 'Barlow, sans-serif',
      }}
    >
      {/* ── Header ───────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-8 lg:px-12 py-4 lg:py-5 flex-shrink-0"
        style={{ borderBottom: `2px solid ${accent}33` }}
      >
        <div className="flex items-center gap-4 lg:gap-5 min-w-0">
          {resolvedLogoUrl && (
            <img
              src={resolvedLogoUrl}
              alt={`${credentials.gym_name} logo`}
              className="h-12 w-12 lg:h-14 lg:w-14 object-contain rounded-xl flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.06)' }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}
          <div className="min-w-0">
            <p className="text-[12px] lg:text-[13px] font-bold tracking-[0.3em] uppercase" style={{ color: accent }}>
              Live Leaderboard
            </p>
            <p className="text-[24px] lg:text-[28px] font-black text-white leading-tight truncate">{credentials.gym_name}</p>
          </div>
        </div>

        {/* Slide indicator strip — collapses to dots only on tighter widths */}
        <div className="hidden xl:flex items-center gap-3 overflow-hidden flex-1 justify-center px-6">
          {slides.slice(0, 10).map((s, i) => (
            <div key={s.key} className="flex items-center gap-1.5" style={{ opacity: i === slideIdx ? 1 : 0.3 }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
              <span className="text-[11px] font-bold tracking-widest uppercase text-white whitespace-nowrap">
                {s.kind === 'metric' ? s.label : 'RETO'}
              </span>
            </div>
          ))}
        </div>

        <div className="text-right flex-shrink-0">
          <p className="text-[28px] lg:text-[34px] font-black text-white leading-none tabular-nums">
            {timeFmt.format(clock)}
          </p>
          <p className="text-[11px] lg:text-[12px] tracking-widest uppercase mt-1" style={{ color: accent }}>
            {dateFmt.format(clock)}
          </p>
        </div>
      </header>

      {/* ── Slide body ──
           min-h-0 lets the flex child actually shrink below its content size
           when the rows overflow — without it, flex-1 + content > viewport
           expands the parent and we lose the no-scroll guarantee. */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {!slide && (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-12 h-12 border-2 rounded-full animate-spin" style={{ borderColor: `${accent}30`, borderTopColor: accent }} />
          </div>
        )}
        {slide?.kind === 'metric' && <MetricSlide slide={slide} accent={accent} />}
        {slide?.kind === 'challenge' && (
          <ChallengeSlide
            slide={slide}
            accent={accent}
            gymSlug={credentials.gym_slug}
          />
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer
        className="px-8 lg:px-12 py-3 flex items-center justify-between flex-shrink-0"
        style={{ borderTop: `1px solid rgba(255,255,255,0.04)` }}
      >
        <p className="text-[11px] font-bold tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.25)' }}>
          Updates live · rotates every 20s · {slides.length} slides
        </p>
        <div className="flex gap-1.5 max-w-[50%] overflow-hidden">
          {slides.map((_, i) => (
            <span
              key={i}
              className="h-1 rounded-full transition-all duration-500 flex-shrink-0"
              style={{ width: i === slideIdx ? '24px' : '6px', background: i === slideIdx ? accent : 'rgba(255,255,255,0.15)' }}
            />
          ))}
        </div>
      </footer>
    </div>
  );
}

// ── Code entry screen ────────────────────────────────────────────────────
function CodeEntryScreen({ sessionId, initialError, onAuthenticated }) {
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
          data?.error === 'invalid_code' ? 'Code not recognized. Check the admin panel for the current code.' :
          data?.error === 'gym_inactive' ? 'This gym is paused.' :
          'Could not connect. Try again.'
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
      });
    } catch (err) {
      setError(err?.message || 'Connection failed');
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
          TuGymPR Display
        </p>
        <h1 className="text-[56px] font-black leading-none mb-2 text-white">Enter TV Code</h1>
        <p className="text-[15px] mb-10" style={{ color: '#9CA3AF' }}>
          Find the 6-character code in your admin panel under TV Display.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            placeholder="••••••"
            maxLength={6}
            autoFocus
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="w-full text-center bg-transparent outline-none border-0 border-b-4 font-mono font-black tabular-nums tracking-[0.4em]"
            style={{
              fontSize: '88px',
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
            disabled={code.length !== 6 || submitting}
            className="px-10 py-4 rounded-xl text-[15px] font-bold transition-all disabled:opacity-30"
            style={{
              background: '#D4AF37',
              color: '#000',
              minWidth: 200,
            }}
          >
            {submitting ? 'Connecting…' : 'Connect'}
          </button>
        </form>

        <p className="text-[11px] mt-12" style={{ color: 'rgba(255,255,255,0.25)' }}>
          Session: <code className="font-mono">{sessionId.slice(0, 8)}…</code>
        </p>
      </div>
    </div>
  );
}

// ── Metric leaderboard slide ─────────────────────────────────────────────
// IMPORTANT: this slide is rendered inside a `flex-1 min-h-0` parent. All
// vertical sizing here uses flex distribution (flex-1, flex-basis-0) instead
// of fixed pixel heights so that whether the gym has 3 rows or 10 rows, on
// a 720p TV or 4K screen, everything fits in the viewport with no scroll.
function MetricSlide({ slide, accent }) {
  const fmt = (score) => {
    if (slide.key === 'improved') return `+${score}%`;
    if (slide.key === 'consistency') return `${score}%`;
    if (slide.key === 'volume') {
      if (score >= 1_000_000) return `${(score / 1_000_000).toFixed(2)}M`;
      if (score >= 1000) return `${(score / 1000).toFixed(1)}K`;
      return Number(score).toLocaleString();
    }
    return Number(score).toLocaleString();
  };
  const maxScore = slide.entries[0]?.score || 1;

  return (
    <>
      <div className="px-8 lg:px-12 pt-5 lg:pt-7 pb-3 flex-shrink-0">
        <div className="flex items-baseline gap-4">
          <h1 className="text-[48px] lg:text-[64px] xl:text-[72px] font-black leading-none tracking-tight" style={{ color: accent }}>
            {slide.label}
          </h1>
          <p className="text-[22px] font-bold tracking-widest uppercase text-white/70 pb-2">
            {slide.period}
          </p>
        </div>
      </div>

      {/* min-h-0 = critical for the flex-1 inside to shrink properly.
          flex-col + flex-1 children below give each row a proportional
          share of the available height; no fixed pixel sizes. */}
      <div className="flex-1 min-h-0 px-8 lg:px-12 pb-5 lg:pb-7 overflow-hidden">
        {slide.entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <p className="text-[28px] font-bold text-white/60">No activity yet</p>
            <p className="text-[16px] text-white/20 mt-2">Start training to appear on the board</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 h-full">
            {slide.entries.map((e, i) => {
              const barWidth = Math.round((Number(e.score) / Number(maxScore)) * 100);
              const isTop3 = i < 3;
              // Top row gets 1.4x the share so the leader stands out;
              // everyone else gets equal flex distribution.
              const flexBasis = i === 0 ? '1.4 1 0' : '1 1 0';
              return (
                <div
                  key={`${e.id || e.profile_id || i}`}
                  className="relative flex items-center gap-4 lg:gap-6 rounded-xl lg:rounded-2xl overflow-hidden min-h-0"
                  style={{
                    flex: flexBasis,
                    background: isTop3 ? `${accent}10` : 'rgba(255,255,255,0.03)',
                    border: isTop3 ? `1px solid ${accent}33` : '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  <div
                    className="absolute inset-0 opacity-20 rounded-xl lg:rounded-2xl transition-all duration-1000"
                    style={{ width: `${barWidth}%`, background: `linear-gradient(90deg, ${accent}55, transparent)` }}
                  />
                  <div className="flex-shrink-0 w-12 lg:w-16 flex items-center justify-center relative z-10">
                    {i < 3 ? (
                      <span className={i === 0 ? 'text-[34px] lg:text-[40px]' : 'text-[26px] lg:text-[30px]'}>{['🥇', '🥈', '🥉'][i]}</span>
                    ) : (
                      <span className="text-[20px] lg:text-[24px] font-black" style={{ color: 'rgba(255,255,255,0.3)' }}>{i + 1}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 relative z-10 pr-3">
                    <p
                      className={`font-black truncate ${i === 0 ? 'text-[26px] lg:text-[32px]' : 'text-[18px] lg:text-[22px]'}`}
                      style={{
                        color: i === 0 ? accent : 'rgba(255,255,255,0.9)',
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {e.name}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right pr-4 lg:pr-6 relative z-10">
                    <p
                      className={`font-black tabular-nums leading-none ${i === 0 ? 'text-[28px] lg:text-[36px]' : 'text-[20px] lg:text-[26px]'}`}
                      style={{ color: i === 0 ? accent : 'rgba(255,255,255,0.75)' }}
                    >
                      {fmt(e.score)}
                    </p>
                    <p className="text-[10px] lg:text-[11px] font-bold uppercase tracking-widest mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      {slide.unit}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ── Challenge slide ──────────────────────────────────────────────────────
// Left: challenge name, type, time remaining, top-5 leaderboard.
// Right: large QR code that links into the app's challenges page so a
// member walking by can scan + join. The deep link includes the challenge
// id so the page can scroll to / open the right card on landing.
function ChallengeSlide({ slide, accent, gymSlug }) {
  const c = slide.challenge;
  const now = new Date();
  const endDate = c.end_date ? new Date(c.end_date) : null;
  const startDate = c.start_date ? new Date(c.start_date) : null;
  const notStartedYet = startDate && startDate > now;

  // Time-remaining / starts-in label. Days are the right resolution for
  // a TV slide — minutes/hours-level countdowns are noise at 10ft viewing.
  let timeLabel = '';
  if (notStartedYet) {
    const days = Math.ceil((startDate - now) / 86_400_000);
    timeLabel = days <= 1 ? 'STARTS TOMORROW' : `STARTS IN ${days} DAYS`;
  } else if (endDate) {
    const days = Math.ceil((endDate - now) / 86_400_000);
    timeLabel = days <= 0 ? 'FINAL HOURS' : days === 1 ? 'ENDS TOMORROW' : `${days} DAYS LEFT`;
  } else {
    timeLabel = 'ONGOING';
  }

  // QR deep link: opens the gym's web app on the challenges page, focused on
  // this challenge. The member's phone browser handles auth — if signed in,
  // they land on the challenge detail; otherwise they're routed through
  // login first. The gym slug helps post-login routing land in the right
  // tenant when the member uses a fresh browser.
  const qrUrl = (() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://tugympr.app';
    const params = new URLSearchParams({ challenge: c.id });
    if (gymSlug) params.set('gym', gymSlug);
    return `${origin}/challenges?${params.toString()}`;
  })();

  const participants = c.participants || [];
  const topFive = participants.slice(0, 5);

  return (
    // Same no-scroll discipline as MetricSlide: grid + min-h-0 + flex-1
    // inside each column lets the rows distribute across whatever height
    // is left after the header, not push past it.
    <div className="flex-1 min-h-0 grid grid-cols-[1fr_360px] xl:grid-cols-[1fr_420px] gap-8 lg:gap-12 px-8 lg:px-12 pt-5 lg:pt-7 pb-5 lg:pb-7 overflow-hidden">
      {/* ── Left column: name + leaderboard ─────────────────────── */}
      <div className="flex flex-col min-h-0 overflow-hidden">
        <div className="mb-4 lg:mb-5 flex-shrink-0">
          <p className="text-[12px] lg:text-[13px] font-bold tracking-[0.3em] uppercase mb-2" style={{ color: accent }}>
            Active Challenge · {timeLabel}
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

        {/* Top-5 within this challenge — flex distribution, no fixed heights */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {topFive.length === 0 ? (
            <div className="h-full flex items-center justify-center rounded-2xl border-2 border-dashed" style={{ borderColor: `${accent}30` }}>
              <div className="text-center px-8">
                <p className="text-[26px] lg:text-[32px] font-black" style={{ color: accent }}>Be the first to join</p>
                <p className="text-[14px] lg:text-[16px] mt-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Scan the code on the right to enter</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 h-full">
              {topFive.map((p, i) => {
                const flexBasis = i === 0 ? '1.35 1 0' : '1 1 0';
                return (
                  <div
                    key={p.profile_id}
                    className="relative flex items-center gap-3 lg:gap-5 rounded-xl px-3 lg:px-5 min-h-0"
                    style={{
                      flex: flexBasis,
                      background: i < 3 ? `${accent}10` : 'rgba(255,255,255,0.03)',
                      border: i < 3 ? `1px solid ${accent}33` : '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="w-10 lg:w-12 flex items-center justify-center flex-shrink-0">
                      {i < 3 ? (
                        <span className={i === 0 ? 'text-[28px] lg:text-[32px]' : 'text-[22px] lg:text-[26px]'}>{['🥇', '🥈', '🥉'][i]}</span>
                      ) : (
                        <span className="text-[18px] lg:text-[20px] font-black" style={{ color: 'rgba(255,255,255,0.3)' }}>{i + 1}</span>
                      )}
                    </div>
                    <p
                      className={`flex-1 font-black truncate ${i === 0 ? 'text-[22px] lg:text-[26px]' : 'text-[16px] lg:text-[20px]'}`}
                      style={{
                        color: i === 0 ? accent : 'rgba(255,255,255,0.9)',
                      }}
                    >
                      {p.name}
                    </p>
                    <p
                      className={`font-black tabular-nums flex-shrink-0 ${i === 0 ? 'text-[24px] lg:text-[28px]' : 'text-[18px] lg:text-[22px]'}`}
                      style={{ color: i === 0 ? accent : 'rgba(255,255,255,0.75)' }}
                    >
                      {p.score != null ? Number(p.score).toLocaleString() : '—'}
                    </p>
                  </div>
                );
              })}
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
          {notStartedYet ? 'Sign up' : 'Join now'}
        </p>
        <p className="text-[12px] lg:text-[14px] font-semibold text-center" style={{ color: 'rgba(255,255,255,0.5)' }}>
          Scan with your phone camera
        </p>
        {participants.length > 0 && (
          <p className="text-[11px] lg:text-[13px] font-bold uppercase tracking-widest mt-3 lg:mt-4" style={{ color: accent }}>
            {participants.length} member{participants.length === 1 ? '' : 's'} in
          </p>
        )}
      </div>
    </div>
  );
}
