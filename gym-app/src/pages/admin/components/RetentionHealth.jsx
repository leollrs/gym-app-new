// RetentionHealth.jsx
// -----------------------------------------------------------------------------
// The AGGREGATE retention picture — REAL churn, not churn-risk. "Dados de baja"
// (churned) = members explicitly marked left (cancelled/deactivated) OR whose
// activity is too stale to assume they're still around (≥30d inactive). That is
// distinct from "En riesgo" (at-risk): an at-risk member is still here, just
// trending out. The 3-band split (healthy / at-risk / churned) makes the
// difference unmistakable. Data: `retention` from overviewQuery.
// -----------------------------------------------------------------------------

import { ShieldAlert, ChevronRight } from 'lucide-react';
import { AdminCard } from '../../../components/admin';

export default function RetentionHealth({ retention = {}, onOpen, t }) {
  const total    = retention.total   || 0;
  const churned  = retention.churned || 0;
  const atRisk   = retention.atRisk  || 0;
  const healthy  = retention.healthy || 0;
  const denom    = total || 1;
  const retentionPct = retention.retentionPct ?? Math.round(((total - churned) / denom) * 100);
  const churnedPct   = Math.round((churned / denom) * 100);
  const retentionColor = retentionPct < 50 ? '#E8522A' : retentionPct < 70 ? '#E8A93A' : '#2FA66B';
  const displayFont = "var(--admin-font-display, 'Archivo', sans-serif)";

  // Healthy → at-risk → churned, in order of concern.
  const segs = [
    { key: 'healthy', n: healthy, color: '#2FA66B' },
    { key: 'atRisk',  n: atRisk,  color: '#E8A93A' },
    { key: 'churned', n: churned, color: '#E8522A' },
  ];

  return (
    <AdminCard hover padding="p-3 sm:p-4 md:p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, #E8522A 14%, transparent)' }}>
          <ShieldAlert size={13} style={{ color: '#E8522A' }} />
        </div>
        <p className="text-[14.5px] font-extrabold" style={{ color: 'var(--color-admin-text)', fontFamily: displayFont, letterSpacing: -0.2 }}>
          {t('admin.overview.retentionTitle', 'Retention')}
        </p>
        <button
          onClick={onOpen}
          className="admin-eyebrow ml-auto"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-admin-text-muted)' }}
        >
          {t('admin.overview.viewAll', 'View all')} <ChevronRight size={11} />
        </button>
      </div>

      {/* Retention rate = members still around (not churned). */}
      <div className="flex items-baseline gap-2 mb-1">
        <span className="tabular-nums" style={{ fontFamily: displayFont, fontSize: 32, fontWeight: 800, letterSpacing: -1, lineHeight: 1, color: retentionColor }}>
          {retentionPct}%
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--color-admin-text-muted)' }}>
          {t('admin.overview.retentionRateLabel', 'retained')}
        </span>
      </div>
      <div className="mb-3" style={{ fontSize: 12, fontWeight: 700, color: '#E8522A' }}>
        {t('admin.overview.churnedSub', { count: churned, pct: churnedPct, defaultValue: '{{count}} churned ({{pct}}%)' })}
      </div>

      {/* distribution bar — healthy / at-risk / churned */}
      <div style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', background: 'var(--color-admin-panel)' }}>
        {segs.map((s) => (s.n > 0 ? (
          <div key={s.key} title={`${s.n}`} style={{ width: `${(s.n / denom) * 100}%`, background: s.color }} />
        ) : null))}
      </div>

      {/* legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
        {segs.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5" style={{ fontSize: 11.5, color: 'var(--color-admin-text-sub)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            {t(`admin.overview.retentionSeg.${s.key}`, s.key)}
            <b style={{ color: 'var(--color-admin-text)' }}>{s.n}</b>
          </span>
        ))}
      </div>
    </AdminCard>
  );
}
