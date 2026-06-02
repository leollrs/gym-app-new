// GrowthChart.jsx
// -----------------------------------------------------------------------------
// New members per MONTH across the current calendar year (Jan–Dec), so growth
// reads as a yearly shape — and any drop-off stands out — instead of the lone
// "Nuevos este mes" number. Future months are greyed. Hovering a month reveals
// the joins-per-week breakdown (with each week's date range) for that month.
// Data: growthSeries from overviewQuery (count + month + isFuture/isCurrent +
// weeks[{startDay,endDay,count}]) — no extra fetch.
// -----------------------------------------------------------------------------

import { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { AdminCard } from '../../../components/admin';

// Localized 3-letter month abbreviations (Jan…Dec), indexed by month 0–11.
const MONTHS_FALLBACK = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabels(t) {
  const parts = String(t('admin.overview.monthsShort', MONTHS_FALLBACK.join(','))).split(',').map((s) => s.trim());
  return parts.length === 12 ? parts : MONTHS_FALLBACK;
}

const GREEN = '#2FA66B';

export default function GrowthChart({ series = [], t }) {
  const [hovered, setHovered] = useState(null);

  // Scale + total ignore future (greyed, zero) months so the bars aren't dwarfed.
  const past = series.filter((s) => !s.isFuture);
  const max = Math.max(...past.map((s) => s.count), 1);
  const totalNew = past.reduce((a, s) => a + s.count, 0);
  const months = monthLabels(t);
  const displayFont = "var(--admin-font-display, 'Archivo', sans-serif)";
  const year = new Date().getFullYear();

  return (
    <AdminCard hover clipContent={false} padding="p-3 sm:p-4 md:p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `color-mix(in srgb, ${GREEN} 14%, transparent)` }}>
          <TrendingUp size={13} style={{ color: GREEN }} />
        </div>
        <p className="text-[14.5px] font-extrabold" style={{ color: 'var(--color-admin-text)', fontFamily: displayFont, letterSpacing: -0.2 }}>
          {t('admin.overview.growthTitle', 'Growth')}
        </p>
        <span className="admin-eyebrow ml-auto">{year}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'stretch', gap: 3 }}>
        {series.map((mo, i) => {
          const label = Number.isInteger(mo.month) ? months[mo.month] : '';
          const h = mo.isFuture || mo.count === 0 ? 2 : Math.max(6, (mo.count / max) * 48);
          // Past = green, current = brightest green, future = grey stub.
          const barColor = mo.isFuture ? 'var(--color-admin-border)' : GREEN;
          const barOpacity = mo.isFuture ? 0.6 : mo.isCurrent ? 0.95 : 0.4;
          const isHovered = hovered === i;
          // Edge-clamp the tooltip so Jan/Dec don't shoot off the card edge.
          const tx = i <= 1 ? 'translateX(-12%)' : i >= 10 ? 'translateX(-88%)' : 'translateX(-50%)';
          return (
            <div
              key={i}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h2) => (h2 === i ? null : h2))}
              onClick={() => setHovered((h2) => (h2 === i ? null : i))}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0, position: 'relative', cursor: 'default' }}
            >
              {/* Hover tooltip — joins per week (with date range) for this month */}
              {isHovered && (
                <div
                  role="tooltip"
                  style={{
                    position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: tx,
                    zIndex: 30, minWidth: 134, background: '#fff',
                    border: '1px solid var(--color-admin-border)', borderRadius: 10,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '9px 11px', pointerEvents: 'none',
                  }}
                >
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--color-admin-text)', fontFamily: displayFont, letterSpacing: -0.2 }}>
                    {label} {year} · {mo.count}
                  </div>
                  <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-admin-text-faint)', margin: '2px 0 6px' }}>
                    {t('admin.overview.growthWeeklyLabel', 'Joins per week')}
                  </div>
                  {mo.weeks && mo.weeks.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {mo.weeks.map((w, wi) => (
                        <div key={wi} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 11.5 }}>
                          <span style={{ fontVariantNumeric: 'tabular-nums', color: w.count > 0 ? 'var(--color-admin-text-sub)' : 'var(--color-admin-text-faint)' }}>
                            {label} {w.startDay}–{w.endDay}
                          </span>
                          <b style={{ fontVariantNumeric: 'tabular-nums', color: w.count > 0 ? GREEN : 'var(--color-admin-text-faint)' }}>{w.count}</b>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11.5, color: 'var(--color-admin-text-faint)' }}>
                      {t('admin.overview.growthNoWeekData', 'No data yet')}
                    </div>
                  )}
                </div>
              )}

              <span style={{ height: 14, lineHeight: '14px', fontSize: 10, fontWeight: 700, color: 'var(--color-admin-text)', fontVariantNumeric: 'tabular-nums' }}>
                {!mo.isFuture && mo.count > 0 ? mo.count : ''}
              </span>
              <div style={{ height: 48, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                <div style={{ width: '100%', height: h, borderRadius: 3, background: barColor, opacity: isHovered && !mo.isFuture ? 1 : barOpacity, transition: 'opacity 120ms' }} />
              </div>
              <span style={{ marginTop: 3, fontSize: 8.5, fontWeight: mo.isCurrent ? 800 : 500, color: mo.isFuture ? 'var(--color-admin-border)' : 'var(--color-admin-text-faint)' }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] mt-1" style={{ color: 'var(--color-admin-text-faint)' }}>
        {t('admin.overview.growthSummaryYear', { count: totalNew, year, defaultValue: '{{count}} new members in {{year}}' })}
      </p>
    </AdminCard>
  );
}
