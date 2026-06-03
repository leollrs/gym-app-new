// WeeklyPulse.jsx
// -----------------------------------------------------------------------------
// "Pulso de la semana" — the business-momentum strip that turns the admin
// overview from a churn list into a dashboard. This-week-vs-last-week for
// check-ins, workouts logged, new members and % active, plus a 14-day check-in
// sparkline. All data is derived in overviewQuery (no extra fetch).
// -----------------------------------------------------------------------------

import { useState } from 'react';
import { TrendingUp, TrendingDown, Minus, CalendarCheck } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { AdminCard } from '../../../components/admin';

function pctDelta(cur, prev) {
  if (!prev) return { pct: cur > 0 ? 100 : 0, dir: cur > 0 ? 'up' : 'flat' };
  const p = Math.round(((cur - prev) / prev) * 100);
  return { pct: Math.abs(p), dir: p > 0 ? 'up' : p < 0 ? 'down' : 'flat' };
}

function DeltaChip({ cur, prev, t }) {
  const { pct, dir } = pctDelta(cur, prev);
  const color = dir === 'up' ? 'var(--color-success)' : dir === 'down' ? 'var(--color-danger)' : 'var(--color-admin-text-faint)';
  const Icon = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : Minus;
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold" style={{ color }}>
      <Icon size={11} />
      {dir === 'flat' ? '—' : `${pct}%`}
    </span>
  );
}

// Sunday-indexed narrow weekday letters (getDay(): 0=Sun … 6=Sat), localized.
const DOW_FALLBACK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
function dowLetters(t) {
  const parts = String(t('admin.overview.dowNarrow', 'S,M,T,W,T,F,S')).split(',').map((s) => s.trim());
  return parts.length === 7 ? parts : DOW_FALLBACK;
}

// Tiny dependency-free bar sparkline. Last 7 bars (this week) use the accent
// color; the prior 7 are muted, so the week-over-week shape reads instantly.
// Bottom axis = weekday letters (not day-of-month, which read like counts).
function Sparkline({ data, t, dateFnsLocale }) {
  const [hovered, setHovered] = useState(null);
  const max = Math.max(...data.map((d) => d.count), 1);
  const n = data.length;
  const letters = dowLetters(t);
  const displayFont = "var(--admin-font-display, 'Archivo', sans-serif)";
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 3 }}>
      {data.map((d, i) => {
        const isThisWeek = i >= n - 7;
        const h = d.count === 0 ? 2 : Math.max(6, (d.count / max) * 40);
        const axis = Number.isInteger(d.dow) ? letters[d.dow] : d.label;
        const dateStr = d.iso ? format(parseISO(d.iso), 'd MMM', dateFnsLocale) : String(d.label);
        const isHovered = hovered === i;
        // Edge-clamp the tooltip so the first/last days don't shoot off the card.
        const tx = i <= 1 ? 'translateX(-12%)' : i >= n - 2 ? 'translateX(-88%)' : 'translateX(-50%)';
        return (
          <div
            key={i}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered((h2) => (h2 === i ? null : h2))}
            onClick={() => setHovered((h2) => (h2 === i ? null : i))}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0, position: 'relative', cursor: 'default' }}
          >
            {/* Hover tooltip — styled to match GrowthChart (Crecimiento) */}
            {isHovered && (
              <div
                role="tooltip"
                style={{
                  position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: tx,
                  zIndex: 30, minWidth: 110, background: '#fff', whiteSpace: 'nowrap',
                  border: '1px solid var(--color-admin-border)', borderRadius: 10,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '9px 11px', pointerEvents: 'none',
                }}
              >
                <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--color-admin-text)', fontFamily: displayFont, letterSpacing: -0.2 }}>
                  {dateStr} · {d.count}
                </div>
                <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-admin-text-faint)', marginTop: 2 }}>
                  {t('admin.overview.pulseSparkUnit', 'check-ins')}
                </div>
              </div>
            )}

            <span style={{ height: 12, lineHeight: '12px', fontSize: 9, fontWeight: 700, color: 'var(--color-admin-text)', fontVariantNumeric: 'tabular-nums' }}>
              {d.count > 0 ? d.count : ''}
            </span>
            <div style={{ height: 40, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ width: '100%', height: h, borderRadius: 3, background: isThisWeek ? 'var(--color-accent)' : 'var(--color-admin-text-faint)', opacity: isHovered ? 1 : (isThisWeek ? 0.95 : 0.45), transition: 'opacity 120ms' }} />
            </div>
            {/* Weekday letter (top) + calendar date (under) — the letter says
                which weekday, the number says which date, neither reads as a count. */}
            <span style={{ marginTop: 3, fontSize: 8.5, fontWeight: 700, lineHeight: 1.05, color: 'var(--color-admin-text-faint)' }}>{axis}</span>
            <span style={{ fontSize: 7.5, lineHeight: 1.05, color: 'var(--color-admin-text-faint)', opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function WeeklyPulse({ pulse, t, dateFnsLocale }) {
  if (!pulse) return null;
  // Check-in momentum: THIS WEEK's count vs last week + the 14-day daily trend.
  // The top KPI shows TODAY's check-ins, so the windows don't overlap (today vs
  // this week). The bar dates carry the "per day" meaning, so no caption needed.
  const { checkins, series14 } = pulse;
  const displayFont = "var(--admin-font-display, 'Archivo', sans-serif)";
  return (
    <AdminCard hover clipContent={false} padding="p-3 sm:p-4 md:p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}>
          <CalendarCheck size={13} style={{ color: 'var(--color-accent)' }} />
        </div>
        <p className="text-[14.5px] font-extrabold" style={{ color: 'var(--color-admin-text)', fontFamily: displayFont, letterSpacing: -0.2 }}>
          {t('admin.overview.pulseCheckinsThisWeek', 'Check-ins this week')}
        </p>
        <span className="admin-eyebrow ml-auto">{t('admin.overview.pulseVsLast', 'vs last week')}</span>
      </div>

      <div className="flex items-baseline gap-2 mb-4">
        <span className="tabular-nums" style={{ fontFamily: displayFont, fontSize: 32, fontWeight: 800, letterSpacing: -1, lineHeight: 1, color: 'var(--color-admin-text)' }}>
          {checkins.current}
        </span>
        <DeltaChip cur={checkins.current} prev={checkins.prev} t={t} />
      </div>

      {Array.isArray(series14) && series14.some((d) => d.count > 0) && (
        <Sparkline data={series14} t={t} dateFnsLocale={dateFnsLocale} />
      )}
    </AdminCard>
  );
}
