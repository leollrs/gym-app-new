// WeeklyVolumeSection.jsx
// -----------------------------------------------------------------------------
// Renders the per-muscle WEEKLY VOLUME assessment inside the Recovery modal:
// each muscle group's sets this week vs its MEV–MAV–MRV band, colour-coded
// (under / optimal / high / over) with a concrete add-/cut-sets recommendation.
//
// This is the visible half of the volume-landmarks layer (#3); the science
// lives in lib/volumeLandmarks.js.
// -----------------------------------------------------------------------------

import React, { useMemo } from 'react';
import { assessWeeklyVolume } from '../lib/volumeLandmarks';

const STATUS_COLOR = {
  under:   '#5B8DEF', // below MEV — info/blue, "do more"
  optimal: '#3DAD7C', // MEV–MAV — green (matches readiness "fresh")
  high:    '#E0A042', // MAV–MRV — amber (matches "moderate")
  over:    '#E26B5C', // > MRV   — red (matches "fatigued")
};

function VolumeRow({ row, t }) {
  const color = STATUS_COLOR[row.status] || STATUS_COLOR.optimal;
  // Track scales a little past MRV so the "over" zone is visible.
  const trackMax = Math.max(row.mrv * 1.3, row.sets * 1.05, 1);
  const pct = (v) => `${Math.max(0, Math.min(100, (v / trackMax) * 100))}%`;
  const mevPct = (row.mev / trackMax) * 100;
  const mavPct = (row.mav / trackMax) * 100;

  const statusLabel = t(`readinessModal.volumeStatus.${row.status}`, {
    defaultValue: { under: 'Add volume', optimal: 'Optimal', high: 'High', over: 'Too much' }[row.status],
  });
  const groupLabel = t(`readinessModal.volumeGroups.${row.key}`, { defaultValue: row.key });
  const rec = (() => {
    if (row.status === 'under') {
      return t('readinessModal.volumeRec.under', { count: row.delta, defaultValue: `Add ${row.delta} sets to reach your minimum` });
    }
    if (row.status === 'over') {
      return t('readinessModal.volumeRec.over', { count: Math.abs(row.delta), defaultValue: `Above your recoverable max — cut ${Math.abs(row.delta)} sets` });
    }
    if (row.status === 'high') {
      return t('readinessModal.volumeRec.high', { defaultValue: 'Productive but near your limit — hold here' });
    }
    return t('readinessModal.volumeRec.optimal', { defaultValue: 'In the productive range' });
  })();

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>{groupLabel}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {row.sets}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4,
            color, padding: '2px 7px', borderRadius: 999,
            background: `color-mix(in srgb, ${color} 14%, transparent)`,
          }}>
            {statusLabel}
          </span>
        </span>
      </div>

      {/* Track: gray base, green "optimal" band (MEV→MAV), marker at current sets */}
      <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'var(--color-surface-hover, rgba(15,20,25,0.06))', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${mevPct}%`, width: `${Math.max(0, mavPct - mevPct)}%`,
          background: 'color-mix(in srgb, #3DAD7C 22%, transparent)',
        }} />
        <div style={{
          position: 'absolute', top: -1, bottom: -1, width: 3, borderRadius: 2,
          left: pct(row.sets), transform: 'translateX(-50%)',
          background: color, boxShadow: '0 0 0 1px var(--color-bg-card, #fff)',
        }} />
      </div>

      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{rec}</div>
    </div>
  );
}

export default function WeeklyVolumeSection({ sessions, level, meso, t }) {
  const rows = useMemo(
    () => assessWeeklyVolume(sessions || [], level || 'intermediate', { windowDays: 7 }),
    [sessions, level],
  );
  const totalSets = rows.reduce((a, r) => a + r.sets, 0);

  return (
    <div style={{ margin: '4px 22px 14px' }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-text-primary)', marginBottom: 2 }}>
        {t('readinessModal.volumeTitle', { defaultValue: 'Weekly volume' })}
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 14 }}>
        {t('readinessModal.volumeSubtitle', { defaultValue: 'Sets per muscle this week vs. the productive range' })}
      </div>

      {/* Mesocycle phase banner (#4) */}
      {meso && (() => {
        const deload = meso.isDeloadWeek;
        const c = deload ? '#5B8DEF' : '#3DAD7C';
        const title = deload
          ? t('readinessModal.mesoDeload', { defaultValue: 'Deload week' })
          : t('readinessModal.mesoAccumulation', { week: meso.week, weeks: meso.accumulationWeeks, defaultValue: `Week ${meso.week} of ${meso.accumulationWeeks} · Accumulation` });
        const hint = deload
          ? t('readinessModal.mesoDeloadHint', { defaultValue: 'Pull back ~40% and let your body supercompensate before the next block.' })
          : t('readinessModal.mesoAccumulationHint', { defaultValue: 'Build week — nudge volume or load up and push toward your max.' });
        return (
          <div style={{
            marginBottom: 14, padding: '10px 12px', borderRadius: 12,
            background: `color-mix(in srgb, ${c} 10%, transparent)`,
            border: `1px solid color-mix(in srgb, ${c} 24%, transparent)`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: c, textTransform: 'uppercase', letterSpacing: 0.4 }}>{title}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3 }}>{hint}</div>
          </div>
        );
      })()}

      {totalSets <= 0 ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '8px 0' }}>
          {t('readinessModal.volumeEmpty', { defaultValue: 'Log a workout this week to see your volume balance.' })}
        </div>
      ) : (
        rows.map((row) => <VolumeRow key={row.key} row={row} t={t} />)
      )}
    </div>
  );
}
