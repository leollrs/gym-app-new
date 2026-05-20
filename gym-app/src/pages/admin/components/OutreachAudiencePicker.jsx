import { useQuery } from '@tanstack/react-query';
import { Users, AlertTriangle, Filter as FilterIcon, UserPlus, Cake, User } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

/**
 * Audience picker for the Outreach composer. Six preset audience types,
 * each with a count chip pulled from the appropriate counting query.
 *
 * The picker only emits a `selector` upward — the actual recipient list is
 * resolved later by `resolveOutreachAudience` so the picker can stay snappy
 * (counts only) and the resolver runs once at send time.
 */
export default function OutreachAudiencePicker({ gymId, value, onChange, t }) {
  const { data: counts = {} } = useQuery({
    queryKey: ['admin', 'outreach', gymId, 'audience-counts'],
    queryFn: async () => {
      const [allRes, scoredRes, unonboardedRes, segmentsRes] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).eq('role', 'member'),
        supabase.from('churn_risk_scores').select('risk_tier').eq('gym_id', gymId),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).eq('role', 'member').eq('is_onboarded', false),
        supabase.from('member_segments').select('id, name').eq('gym_id', gymId),
      ]);
      const tiers = { critical: 0, high: 0, medium: 0, low: 0 };
      (scoredRes.data || []).forEach(r => { if (tiers[r.risk_tier] !== undefined) tiers[r.risk_tier]++; });
      return {
        all: allRes.count ?? 0,
        tiers,
        unonboarded: unonboardedRes.count ?? 0,
        segments: segmentsRes.data || [],
      };
    },
    enabled: !!gymId,
  });

  const options = [
    {
      type: 'all',
      icon: Users,
      label: t('admin.outreach.everyMember', 'Every member'),
      count: counts.all,
      isActive: value?.type === 'all',
      next: { type: 'all' },
    },
    {
      type: 'tier-critical',
      icon: AlertTriangle,
      label: t('admin.outreach.criticalRisk', 'Critical churn risk'),
      count: counts.tiers?.critical ?? 0,
      isActive: value?.type === 'tier' && value.tier === 'critical',
      next: { type: 'tier', tier: 'critical' },
      accent: 'var(--color-danger)',
    },
    {
      type: 'tier-high',
      icon: AlertTriangle,
      label: t('admin.outreach.atRisk', 'At risk'),
      count: counts.tiers?.high ?? 0,
      isActive: value?.type === 'tier' && value.tier === 'high',
      next: { type: 'tier', tier: 'high' },
      accent: 'var(--color-warning)',
    },
    {
      type: 'unonboarded',
      icon: UserPlus,
      label: t('admin.outreach.unonboarded', "Haven't finished onboarding"),
      count: counts.unonboarded,
      isActive: value?.type === 'unonboarded',
      next: { type: 'unonboarded' },
    },
    {
      type: 'birthdays',
      icon: Cake,
      label: t('admin.outreach.birthdaysWeek', 'Birthdays this week'),
      count: null,
      isActive: value?.type === 'birthdays',
      next: { type: 'birthdays' },
    },
  ];

  return (
    <div className="space-y-2.5">
      <label className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
        {t('admin.outreach.audience', 'Audience')}
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map(opt => {
          const Icon = opt.icon;
          return (
            <button
              key={opt.type}
              type="button"
              onClick={() => onChange(opt.next)}
              className="flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-all border"
              style={{
                background: opt.isActive
                  ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)'
                  : 'var(--color-bg-deep)',
                borderColor: opt.isActive
                  ? 'var(--color-accent)'
                  : 'var(--color-border-subtle)',
              }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: opt.accent ? `color-mix(in srgb, ${opt.accent} 18%, transparent)` : 'var(--color-bg-hover)' }}
              >
                <Icon size={15} style={{ color: opt.accent || 'var(--color-text-muted)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {opt.label}
                </p>
                {opt.count !== null && (
                  <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    {opt.count} {t(opt.count === 1 ? 'admin.outreach.members' : 'admin.outreach.members_plural', { count: opt.count, defaultValue: opt.count === 1 ? 'member' : 'members' })}
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Segment picker — only renders if the gym has saved segments. Selecting
          one stores its id on the selector so the resolver can fan it out. */}
      {counts.segments?.length > 0 && (
        <div className="pt-2">
          <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('admin.outreach.fromSegment', 'Or pick a saved segment')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {counts.segments.map(seg => {
              const active = value?.type === 'segment' && value.segmentId === seg.id;
              return (
                <button
                  key={seg.id}
                  type="button"
                  onClick={() => onChange({ type: 'segment', segmentId: seg.id, segmentName: seg.name })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors border"
                  style={{
                    background: active ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'var(--color-bg-deep)',
                    color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    borderColor: active ? 'var(--color-accent)' : 'var(--color-border-subtle)',
                  }}
                >
                  <FilterIcon size={11} />
                  {seg.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* "Specific member" is supported by deep links from Members/Churn pages,
          but we don't expose a multi-select in the picker itself — that would
          duplicate the Members table. The composer just shows who is currently
          selected when arriving via deep link. */}
      {value?.type === 'members' && (
        <div className="mt-2 p-3 rounded-xl flex items-center gap-2"
          style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
          <User size={14} style={{ color: 'var(--color-accent)' }} />
          <p className="text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
            {(() => {
              const n = value.ids?.length || 0;
              const key = n === 1 ? 'admin.outreach.specificMembersCount' : 'admin.outreach.specificMembersCount_plural';
              return t(key, { count: n, defaultValue: n === 1 ? '{{count}} specific member selected' : '{{count}} specific members selected' });
            })()}
          </p>
        </div>
      )}
    </div>
  );
}
