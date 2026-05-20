import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, KeyRound, Flag, UserPlus, MessageSquare,
  ShieldAlert, ChevronRight,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { AdminCard, FadeIn } from '../../../components/admin';

/**
 * "Needs your attention" inbox surfaced on AdminOverview. One place that
 * shows the admin every pending item across the platform (password resets,
 * critical churn risks not yet contacted, reports awaiting review, etc.)
 * so they don't have to visit six pages to discover what's pending.
 *
 * Each row has a primary action that either deep-links into the relevant
 * admin page pre-filtered, or opens a modal via the `onResetClick` callback
 * the parent supplies (so we don't duplicate the reset-approval modal).
 *
 * `atRiskCount`, `pendingResetsCount`, `onboardingCount` are passed in from
 * the parent's existing overview query — we only fetch what's NEW
 * (reports, referrals) here so we don't double-query.
 */
export default function NeedsAttentionCard({
  gymId,
  atRiskCount = 0,
  pendingResetsCount = 0,
  onboardingCount = 0,
  firstPendingResetId = null,
  onResetClick,
}) {
  const navigate = useNavigate();
  const { t } = useTranslation('pages');

  const { data: extra = { reports: 0, referrals: 0 } } = useQuery({
    queryKey: ['admin', 'overview', gymId, 'needs-attention'],
    queryFn: async () => {
      const [reportsRes, referralsRes] = await Promise.all([
        supabase
          .from('content_reports')
          .select('id', { count: 'exact', head: true })
          .eq('gym_id', gymId)
          .eq('status', 'pending'),
        supabase
          .from('referrals')
          .select('id', { count: 'exact', head: true })
          .eq('gym_id', gymId)
          .eq('status', 'pending'),
      ]);
      return {
        reports: reportsRes.count ?? 0,
        referrals: referralsRes.count ?? 0,
      };
    },
    enabled: !!gymId,
    staleTime: 30_000,
  });

  // i18next v3-compat plural inference (`{ count }` → auto `_plural` lookup)
  // wasn't reliably selecting the plural form here in production, leaving
  // strings like "32 miembro en riesgo crítico de baja". We pick the key
  // explicitly so the right variant always wins regardless of i18next config.
  const plural = (base, n) => `${base}${n === 1 ? '' : '_plural'}`;

  const items = [];

  if (pendingResetsCount > 0) {
    items.push({
      icon: KeyRound,
      color: 'var(--color-warning)',
      text: t(plural('admin.overview.attentionPendingResets', pendingResetsCount), { count: pendingResetsCount }),
      action: t('admin.overview.review', 'Review'),
      onClick: () => firstPendingResetId ? onResetClick?.(firstPendingResetId) : navigate('/admin/members?tab=resets'),
    });
  }

  if (atRiskCount > 0) {
    items.push({
      icon: AlertTriangle,
      color: 'var(--color-danger)',
      text: t(plural('admin.overview.attentionAtRisk', atRiskCount), { count: atRiskCount }),
      action: t('admin.overview.sendOutreach', 'Send win-back'),
      onClick: () => navigate('/admin/outreach?audience=critical'),
    });
  }

  if (extra.reports > 0) {
    items.push({
      icon: Flag,
      color: 'var(--color-warning)',
      text: t(plural('admin.overview.attentionReports', extra.reports), { count: extra.reports }),
      action: t('admin.overview.openModeration', 'Open moderation'),
      onClick: () => navigate('/admin/moderation'),
    });
  }

  if (extra.referrals > 0) {
    items.push({
      icon: ShieldAlert,
      color: 'var(--color-coach)',
      text: t(plural('admin.overview.attentionReferrals', extra.referrals), { count: extra.referrals }),
      action: t('admin.overview.openReferrals', 'Open referrals'),
      onClick: () => navigate('/admin/referrals'),
    });
  }

  if (onboardingCount > 0) {
    items.push({
      icon: UserPlus,
      color: 'var(--color-danger)',
      text: t(plural('admin.overview.attentionOnboarding', onboardingCount), { count: onboardingCount }),
      action: t('admin.overview.sendReminder', 'Send reminder'),
      onClick: () => navigate('/admin/outreach?audience=unonboarded'),
    });
  }

  if (items.length === 0) return null;

  return (
    <FadeIn>
      <AdminCard hover className="mb-5" padding="p-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div className="flex items-center gap-2">
            <MessageSquare size={14} style={{ color: 'var(--color-accent)' }} />
            <span className="text-[12px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent)', letterSpacing: '0.1em' }}>
              {t('admin.overview.needsAttentionTitle', 'Needs your attention')}
            </span>
          </div>
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', color: 'var(--color-accent)' }}>
            {items.length}
          </span>
        </div>

        <ul className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
          {items.map((item, i) => {
            const Icon = item.icon;
            return (
              <li key={i}>
                <button
                  onClick={item.onClick}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[color:var(--color-admin-panel)]"
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `color-mix(in srgb, ${item.color} 16%, transparent)` }}
                  >
                    <Icon size={14} style={{ color: item.color }} />
                  </div>
                  <p className="flex-1 text-[12.5px] leading-snug" style={{ color: 'var(--color-text-primary)' }}>
                    {item.text}
                  </p>
                  <span
                    className="text-[11px] font-semibold flex items-center gap-0.5 flex-shrink-0"
                    style={{ color: item.color }}
                  >
                    {item.action} <ChevronRight size={11} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </AdminCard>
    </FadeIn>
  );
}
