import i18n from 'i18next';
import { getRiskTier } from '../../../lib/churnScore';

/**
 * Compact risk pill rendered next to a member row in the Members table.
 * Hidden when score < 30 (the "Healthy" bucket) to avoid visual noise.
 * Clicking the badge navigates to /admin/churn — the row's own click
 * handler that opens the member detail is stopped via stopPropagation.
 */
export default function ChurnRiskBadge({ member, navigate }) {
  const score = member.score ?? 0;
  const tier = getRiskTier(score);
  if (score < 30) return null;
  const toneClass = score >= 80 ? 'admin-pill--hot' : score >= 55 ? 'admin-pill--hot' : 'admin-pill--warn';
  const label = i18n.t(`admin.members.riskTier.${tier.tier}`, { ns: 'pages', defaultValue: tier.label });
  return (
    <span
      onClick={e => { e.stopPropagation(); navigate('/admin/churn'); }}
      role="link"
      tabIndex={0}
      title={i18n.t('admin.members.churnTooltip', { ns: 'pages', defaultValue: '{{label}} — click to view in Churn Intel', label })}
      className={`admin-pill ${toneClass} flex items-center gap-1 cursor-pointer hover:opacity-80 flex-shrink-0`}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'currentColor' }} />
      {label}
    </span>
  );
}
