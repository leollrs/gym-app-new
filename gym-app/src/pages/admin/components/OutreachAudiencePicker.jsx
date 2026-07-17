import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, AlertTriangle, Filter as FilterIcon, UserPlus, Cake, UserCheck, Search, Check } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

// Icon-chip tones for the audience cards — semantic category hues (the gym's
// accent for "all"/specific, danger/warning for churn tiers, a fixed coach
// purple for lifecycle). The selection state itself always uses --color-accent.
const TONES = {
  accent:  { bg: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',  fg: 'var(--color-accent)' },
  danger:  { bg: 'color-mix(in srgb, var(--color-danger) 15%, transparent)',  fg: 'var(--color-danger)' },
  warning: { bg: 'color-mix(in srgb, var(--color-warning) 16%, transparent)', fg: 'var(--color-warning)' },
  coach:   { bg: 'color-mix(in srgb, var(--color-coach) 18%, transparent)',   fg: 'var(--color-coach)' },
};

/**
 * Audience picker for the Outreach composer. Preset audience types plus a
 * "Specific members" multi-select so the admin can hand-pick exactly who to
 * message. Saved segments render as chips when the gym has any.
 *
 * The picker only emits a `selector` upward — the concrete recipient list is
 * resolved by `resolveOutreachAudience` (the composer also previews it). For
 * the `members` selector the picker carries the chosen ids directly.
 */
export default function OutreachAudiencePicker({ gymId, value, onChange, t }) {
  const [memberSearch, setMemberSearch] = useState('');

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

  const isMembers = value?.type === 'members';

  // Member roster for the hand-pick multi-select — only fetched once the admin
  // opens the "Specific members" mode, so the rest of the picker stays snappy.
  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['admin', 'outreach', gymId, 'member-roster'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, username')
        .eq('gym_id', gymId)
        .eq('role', 'member')
        .order('full_name', { ascending: true })
        .limit(2000);
      return data || [];
    },
    enabled: !!gymId && isMembers,
  });

  const selectedIds = useMemo(() => new Set(isMembers ? (value.ids || []) : []), [isMembers, value]);

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter(m =>
      (m.full_name || '').toLowerCase().includes(q) || (m.username || '').toLowerCase().includes(q));
  }, [members, memberSearch]);

  const toggleMember = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange({ type: 'members', ids: [...next] });
  };
  const selectAllFiltered = () => {
    const next = new Set(selectedIds);
    filteredMembers.forEach(m => next.add(m.id));
    onChange({ type: 'members', ids: [...next] });
  };
  const clearSelection = () => onChange({ type: 'members', ids: [] });

  const options = [
    {
      type: 'all', icon: Users, label: t('admin.outreach.everyMember', 'Every member'),
      count: counts.all, isActive: value?.type === 'all', next: { type: 'all' }, tone: 'accent',
    },
    {
      type: 'members', icon: UserCheck, label: t('admin.outreach.specificMembers', 'Specific members'),
      count: isMembers ? (value.ids?.length || 0) : null, isActive: isMembers,
      next: { type: 'members', ids: isMembers ? (value.ids || []) : [] }, tone: 'accent',
    },
    {
      type: 'tier-critical', icon: AlertTriangle, label: t('admin.outreach.criticalRisk', 'Critical churn risk'),
      count: counts.tiers?.critical ?? 0, isActive: value?.type === 'tier' && value.tier === 'critical',
      next: { type: 'tier', tier: 'critical' }, tone: 'danger',
    },
    {
      type: 'tier-high', icon: AlertTriangle, label: t('admin.outreach.atRisk', 'At risk'),
      count: counts.tiers?.high ?? 0, isActive: value?.type === 'tier' && value.tier === 'high',
      next: { type: 'tier', tier: 'high' }, tone: 'warning',
    },
    {
      type: 'unonboarded', icon: UserPlus, label: t('admin.outreach.unonboarded', "Haven't finished onboarding"),
      count: counts.unonboarded, isActive: value?.type === 'unonboarded', next: { type: 'unonboarded' }, tone: 'coach',
    },
    {
      type: 'birthdays', icon: Cake, label: t('admin.outreach.birthdaysWeek', 'Birthdays this week'),
      count: null, isActive: value?.type === 'birthdays', next: { type: 'birthdays' }, tone: 'coach',
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
          {t('admin.outreach.audience', 'Audience')}
        </label>
        <span className="text-[11.5px]" style={{ color: 'var(--color-text-muted)' }}>
          {t('admin.outreach.pickGroup', 'Pick a group')}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {options.map(opt => {
          const Icon = opt.icon;
          const on = opt.isActive;
          const tone = TONES[opt.tone] || TONES.accent;
          return (
            <button
              key={opt.type}
              type="button"
              onClick={() => onChange(opt.next)}
              className="flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-all"
              style={{
                background: on ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'var(--color-bg-deep)',
                border: `${on ? 1.5 : 1}px solid ${on ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                boxShadow: on ? '0 0 0 3px color-mix(in srgb, var(--color-accent) 11%, transparent)' : 'none',
              }}
            >
              <div
                className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center flex-shrink-0"
                style={{ background: tone.bg }}
              >
                <Icon size={17} strokeWidth={2} style={{ color: tone.fg }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-bold truncate" style={{ color: 'var(--color-text-primary)', letterSpacing: '-0.2px' }}>{opt.label}</p>
                {opt.count !== null && (
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    {opt.count} {t(opt.count === 1 ? 'admin.outreach.members' : 'admin.outreach.members_other', { count: opt.count, defaultValue: opt.count === 1 ? 'member' : 'members' })}
                  </p>
                )}
              </div>
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  border: on ? 'none' : '1.5px solid var(--color-border-subtle)',
                  background: on ? 'var(--color-accent)' : 'transparent',
                }}
              >
                {on && <Check size={12} strokeWidth={3} style={{ color: 'var(--color-text-on-accent)' }} />}
              </span>
            </button>
          );
        })}
      </div>

      {/* Specific-members hand-pick multi-select */}
      {isMembers && (
        <div className="mt-1 rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-deep)' }}>
          <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
            <Search size={14} style={{ color: 'var(--color-text-muted)' }} />
            <input
              value={memberSearch}
              onChange={e => setMemberSearch(e.target.value)}
              placeholder={t('admin.outreach.searchMembers', 'Search members…')}
              aria-label={t('admin.outreach.searchMembers', 'Search members')}
              className="flex-1 bg-transparent text-[12.5px] outline-none"
              style={{ color: 'var(--color-text-primary)' }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-1.5" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
            <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.outreach.selectedCount', { count: selectedIds.size, defaultValue: '{{count}} selected' })}
            </span>
            <div className="flex items-center gap-3">
              <button type="button" onClick={selectAllFiltered} className="text-[11px] font-semibold transition-colors hover:underline" style={{ color: 'var(--color-accent)' }}>
                {t('admin.outreach.selectAllShown', 'Select all shown')}
              </button>
              {selectedIds.size > 0 && (
                <button type="button" onClick={clearSelection} className="text-[11px] font-semibold transition-colors hover:underline" style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.outreach.clear', 'Clear')}
                </button>
              )}
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {membersLoading ? (
              <p className="text-[12px] text-center py-5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.outreach.loadingMembers', 'Loading members…')}</p>
            ) : filteredMembers.length === 0 ? (
              <p className="text-[12px] text-center py-5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.outreach.noMembersFound', 'No members found')}</p>
            ) : (
              filteredMembers.map(m => {
                const on = selectedIds.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMember(m.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
                    style={{ background: on ? 'color-mix(in srgb, var(--color-accent) 9%, transparent)' : 'transparent' }}
                    onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
                    onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span
                      className="w-[18px] h-[18px] rounded-md flex items-center justify-center flex-shrink-0 transition-colors"
                      style={{
                        background: on ? 'var(--color-accent)' : 'transparent',
                        border: `1.5px solid ${on ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                      }}
                    >
                      {on && <Check size={12} style={{ color: 'var(--color-text-on-accent)' }} strokeWidth={3} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{m.full_name || t('admin.outreach.unnamed', 'Unnamed')}</p>
                      {m.username && <p className="text-[10.5px] truncate" style={{ color: 'var(--color-text-muted)' }}>@{m.username}</p>}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Segment picker — only renders if the gym has saved segments. */}
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
    </div>
  );
}
