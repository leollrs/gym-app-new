// CardioSessionDetail.jsx
// -----------------------------------------------------------------------------
// Read-only summary of a completed cardio session. Mirrors the layout the
// user sees right after Finish & Log, but loads the session by id from the
// activity log so they can come back to it any time.
//
//   • Hero map (uses the renderRouteMap fallback chain — cache → Mapbox → ...)
//   • Stats grid: distance, duration, pace, calories, elevation
//   • Splits list (per km/mi)
//   • Re-share button (opens ShareCardioSheet with the same data)
// -----------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { ChevronLeft, Share2, MapPin, Clock, Zap, TrendingUp, Activity as ActivityIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatPace } from '../lib/gpsTracker';
import StaticRouteMapImage from '../components/share/StaticRouteMapImage';
import ShareCardioSheet from '../components/share/ShareCardioSheet';

const FONT_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const FONT_BODY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function Stat({ label, value, sub }) {
  return (
    <div
      style={{
        background: 'var(--color-surface-hover, rgba(255,255,255,0.04))',
        borderRadius: 16,
        padding: '14px 16px',
        border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
      }}
    >
      <div
        style={{
          fontSize: 11, fontWeight: 800, letterSpacing: 1.4,
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 28,
          letterSpacing: -0.5, lineHeight: 1,
          color: 'var(--color-text-primary)',
        }}
      >
        {value}
        {sub && (
          <span
            style={{
              fontSize: 14, color: 'var(--color-text-muted)',
              marginLeft: 6, fontWeight: 700,
            }}
          >
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

export default function CardioSessionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
  const { profile, user, gymName, gymLogoUrl } = useAuth();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showShare, setShowShare] = useState(false);

  // Default to imperial when metric_units is undefined — matches ActiveSession's
  // weight-unit default (lb) so PR/US users get consistent units across the app.
  const unit = profile?.metric_units === true ? 'km' : 'mi';
  const accent = 'var(--color-accent, #FC5200)';

  useEffect(() => {
    let alive = true;
    if (!id) { setLoading(false); setError('No id'); return; }
    if (!user?.id) { setLoading(false); setError('Not authenticated'); return; }
    (async () => {
      try {
        const { data, error: err } = await supabase
          .from('cardio_sessions')
          .select('*')
          .eq('id', id)
          .eq('profile_id', user.id)
          .single();
        if (err) throw err;
        if (alive) { setSession(data); setLoading(false); }
      } catch (err) {
        if (alive) { setError(err?.message || 'Failed to load'); setLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, [id, user?.id]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
        {t('cardioDetail.loading', { defaultValue: 'Loading…' })}
      </div>
    );
  }

  if (error || !session) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: 24, color: 'var(--color-text-primary)', fontFamily: FONT_BODY }}>
        <button type="button" onClick={() => navigate(-1)} style={{ background: 'transparent', border: 'none', color: 'var(--color-accent)', fontWeight: 700, cursor: 'pointer' }}>
          <ChevronLeft size={18} style={{ verticalAlign: 'middle' }} /> {t('cardioDetail.back', { defaultValue: 'Back' })}
        </button>
        <div style={{ marginTop: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          {t('cardioDetail.notFound', { defaultValue: 'Session not found.' })}
        </div>
      </div>
    );
  }

  const route = Array.isArray(session.route) ? session.route : [];
  const distanceUnits = session.distance_km != null
    ? (unit === 'mi' ? session.distance_km / 1.60934 : session.distance_km).toFixed(2)
    : null;
  const paceSec = session.avg_pace_sec_per_km;
  const paceUnit = paceSec != null
    ? formatPace(unit === 'mi' ? paceSec * 1.60934 : paceSec)
    : null;
  const splits = Array.isArray(session.splits) ? session.splits : [];

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--color-bg)',
        color: 'var(--color-text-primary)',
        fontFamily: FONT_BODY,
        // Mobile bottom nav is fixed and ~80px tall + safe-area inset; without
        // matching the rest of the member pages (pb-28 = 7rem), the bottom of
        // the cardio summary hides behind the footer after the share sheet
        // closes.
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 7rem)',
      }}
    >
      {/* Top bar — the app-wrapper already pads safe-area-inset-top + the
          fixed mobile header. Adding another safe-area inset here doubled
          the top gap on devices with a notch and left a white strip above
          the Back / Share buttons. */}
      <div
        style={{
          padding: '12px 16px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <button
          type="button" onClick={() => navigate(-1)}
          aria-label={t('cardioDetail.back', { defaultValue: 'Back' })}
          style={{
            width: 38, height: 38, borderRadius: 19, border: 'none',
            background: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
            color: 'var(--color-text-primary)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <ChevronLeft size={20} />
        </button>
        <button
          type="button" onClick={() => setShowShare(true)}
          aria-label={t('cardioDetail.share', { defaultValue: 'Share' })}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 999,
            background: accent, color: 'var(--color-bg-card, #0A0D10)',
            border: 'none', cursor: 'pointer',
            fontWeight: 800, fontSize: 13,
          }}
        >
          <Share2 size={15} />
          {t('cardio.share.shareRun', 'Share')}
        </button>
      </div>

      {/* Title */}
      <div style={{ padding: '8px 20px 16px' }}>
        <div
          style={{
            fontSize: 11, fontWeight: 800, letterSpacing: 1.4,
            textTransform: 'uppercase',
            color: 'var(--color-accent)',
          }}
        >
          {t(`cardio.types.${session.cardio_type}`, (session.cardio_type || '').replace(/_/g, ' '))}
        </div>
        <div
          style={{
            fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 28,
            letterSpacing: -0.6, marginTop: 4, lineHeight: 1.1,
          }}
        >
          {new Date(session.completed_at || session.started_at).toLocaleString(
            i18n.language === 'es' ? 'es-ES' : 'en-US',
            {
              weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            },
          )}
        </div>
      </div>

      {/* Map */}
      {route.length >= 2 && (
        <div style={{ padding: '0 20px 18px' }}>
          <div
            style={{
              borderRadius: 22,
              overflow: 'hidden',
              border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
            }}
          >
            <StaticRouteMapImage
              route={route}
              width={Math.min(typeof window !== 'undefined' ? window.innerWidth - 40 : 560, 800)}
              height={300}
              accent={getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#FC5200'}
              sessionId={session.id}
              borderRadius={0}
            />
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{ padding: '0 20px 18px', display: 'grid', gridTemplateColumns: distanceUnits != null ? 'repeat(2, 1fr)' : '1fr', gap: 10 }}>
        {distanceUnits != null && (
          <Stat label={t('cardio.distance', 'Distance')} value={distanceUnits} sub={unit} />
        )}
        <Stat label={t('cardio.duration', 'Duration')} value={formatDuration(session.duration_seconds || 0)} />
        {paceUnit && (
          <Stat label={t('cardio.avgPace', 'Avg pace')} value={paceUnit} sub={`/${unit}`} />
        )}
        {session.calories_burned != null && (
          <Stat label={t('cardio.cal', 'cal')} value={`${session.calories_burned}`} />
        )}
        {session.elevation_gain_m > 0 && (
          <Stat label={t('cardio.elevation', 'Elevation')} value={`${Math.round(session.elevation_gain_m)}`} sub="m" />
        )}
        {session.avg_heart_rate != null && (
          <Stat label={t('cardio.avgHr', 'Avg HR')} value={`${session.avg_heart_rate}`} sub="bpm" />
        )}
      </div>

      {/* Splits */}
      {splits.length > 0 && (
        <div style={{ padding: '0 20px 18px' }}>
          <div
            style={{
              fontSize: 11, fontWeight: 800, letterSpacing: 1.2,
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)', marginBottom: 8,
            }}
          >
            {t('cardio.splits', 'Splits')}
          </div>
          <div
            style={{
              background: 'var(--color-surface-hover, rgba(255,255,255,0.04))',
              borderRadius: 16,
              border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
              overflow: 'hidden',
            }}
          >
            {splits.map((s, i) => {
              const idx = s.index ?? i + 1;
              const splitUnit = s.unit || unit;
              const sec = s.seconds ?? s.pace_sec_per_unit ?? 0;
              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '12px 16px',
                    borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--color-text-primary)' }}>
                    #{idx} <span style={{ color: 'var(--color-text-muted)', fontWeight: 700, marginLeft: 4 }}>{splitUnit}</span>
                  </div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 16, color: 'var(--color-accent)' }}>
                    {formatPace(sec)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {session.notes && (
        <div style={{ padding: '0 20px 18px' }}>
          <div
            style={{
              background: 'var(--color-surface-hover, rgba(255,255,255,0.04))',
              borderRadius: 16, padding: '14px 16px',
              border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
              fontSize: 14, lineHeight: 1.5, color: 'var(--color-text-primary)',
            }}
          >
            {session.notes}
          </div>
        </div>
      )}

      {/* Share sheet */}
      <ShareCardioSheet
        open={showShare}
        onClose={() => setShowShare(false)}
        accent={getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#2EC4C4'}
        data={{
          sessionId: session.id,
          cardioType: session.cardio_type,
          durationSeconds: session.duration_seconds,
          distanceKm: session.distance_km,
          calories: session.calories_burned,
          avgPaceSecPerKm: session.avg_pace_sec_per_km,
          elevationGainM: session.elevation_gain_m,
          route,
          unit,
          gymName,
          gymLogoUrl,
        }}
      />
    </div>
  );
}
