import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { logAdminAction } from '../../../lib/adminAudit';
import { FadeIn } from '../../../components/admin';
import { rewardKeys } from './rewardConstants';
import { TK, FK, TONE, Ico, ICON, Card } from './retosKit';

const eyebrow = { fontFamily: FK.body, fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: TK.textFaint };

// status sort rank: pending/active first, then expired, then claimed/redeemed
const STATUS_RANK = { pending: 0, active: 0, expired: 1, redeemed: 2, claimed: 2 };
const rankOf = (s) => (STATUS_RANK[s] ?? 3);

// filter key → matching db statuses (null = all)
const FILTER_MATCH = {
  all: null,
  pending: ['pending', 'active'],
  expired: ['expired'],
  claimed: ['redeemed', 'claimed'],
};

// db status → design status pill
function CanjeStatus({ kind, t }) {
  const tone = (kind === 'pending' || kind === 'active') ? 'accent'
    : (kind === 'redeemed' || kind === 'claimed') ? 'good'
    : 'neutral';
  const dot = tone === 'accent';
  const c = {
    accent:  { fg: TK.accentInk, bg: TK.accentSoft, line: TK.accentLine, dot: TK.accent },
    good:    { fg: 'var(--color-success-ink, var(--color-success))', bg: 'var(--color-success-soft)', line: 'color-mix(in srgb, var(--color-success) 35%, transparent)', dot: 'var(--color-success)' },
    neutral: { fg: TK.textMute, bg: TK.surface3, line: TK.borderSolid, dot: TK.textFaint },
  }[tone];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: c.bg, border: `1px solid ${c.line}`, fontFamily: FK.body, fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: 'capitalize', color: c.fg, whiteSpace: 'nowrap' }}>
      {dot && <span style={{ width: 5, height: 5, borderRadius: 99, background: c.dot }} />}
      {t(`admin.rewards.statusPill.${kind}`, kind)}
    </span>
  );
}

const LEAD = {
  challenge:  { icon: ICON.trophy, tone: 'accent' },
  email:      { icon: ICON.mail,   tone: 'coach' },
  redemption: { icon: ICON.gift,   tone: 'warn' },
};
const MED = { gold: { c: '#E0A82E' }, silver: { c: '#9AA4AE' }, bronze: { c: '#C77B3E' } };

/**
 * Unified activity log (Canjes) for AdminRewards — merges challenge_prizes,
 * email_reward_vouchers and reward_redemptions, then organizes into a
 * collapsible date timeline: grouped by month (months grouped under past
 * years). The current month is open; past months/years collapse until opened.
 * Status filter pills sit on top; within a month, pending/active sort first.
 */
export default function RewardLog({ gymId, isEs, t }) {
  const lang = isEs ? 'es' : 'en';
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [deactivating, setDeactivating] = useState(null);

  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth();
  const [openYears, setOpenYears] = useState(() => new Set([new Date().getFullYear()]));
  const [openMonths, setOpenMonths] = useState(() => new Set([`${new Date().getFullYear()}-${new Date().getMonth()}`]));
  const toggleYear = (y) => setOpenYears(s => { const n = new Set(s); n.has(y) ? n.delete(y) : n.add(y); return n; });
  const toggleMonth = (k) => setOpenMonths(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const handleDeactivate = async (entry) => {
    setDeactivating(entry.id);
    try {
      const { error } = await supabase
        .from(entry.table)
        .update({ status: 'expired' })
        .eq('id', entry.dbId)
        .eq('gym_id', gymId);
      if (error) throw error;
      logAdminAction('expire_reward_redemption', entry.table, entry.dbId);
      queryClient.invalidateQueries({ queryKey: [...rewardKeys.all(gymId), 'activity-log'] });
      showToast(t('admin.rewards.rewardCancelled', 'Reward expired — held points released'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setDeactivating(null);
    }
  };

  const { data: logEntries = [], isLoading } = useQuery({
    queryKey: [...rewardKeys.all(gymId), 'activity-log'],
    queryFn: async () => {
      const [challengeRes, voucherRes, redemptionRes] = await Promise.all([
        supabase
          .from('challenge_prizes')
          .select('id, profile_id, placement, reward_label, points_awarded, status, created_at, redeemed_at, challenges(name), profiles!challenge_prizes_profile_id_fkey(full_name)')
          .eq('gym_id', gymId)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('email_reward_vouchers')
          .select('id, member_id, reward_label, reward_type, status, created_at, redeemed_at, profiles!email_reward_vouchers_member_id_fkey(full_name)')
          .eq('gym_id', gymId)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('reward_redemptions')
          .select('id, profile_id, reward_name, points_spent, status, created_at, claimed_at, profiles!reward_redemptions_profile_id_fkey(full_name)')
          .eq('gym_id', gymId)
          .order('created_at', { ascending: false })
          .limit(100),
      ]);

      const entries = [];
      const MEDAL = ['gold', 'silver', 'bronze'];

      (challengeRes.data || []).forEach(p => {
        entries.push({
          id: `cp-${p.id}`, dbId: p.id, table: 'challenge_prizes', type: 'challenge',
          member: p.profiles?.full_name || '?',
          meta: p.challenges?.name || t('admin.rewards.logChallenge', 'Challenge'),
          medal: MEDAL[p.placement - 1] || null,
          reward: p.reward_label,
          points: p.points_awarded || 0,
          status: p.status,
          date: p.redeemed_at || p.created_at,
          canDeactivate: p.status === 'pending',
        });
      });

      (voucherRes.data || []).forEach(v => {
        entries.push({
          id: `ev-${v.id}`, dbId: v.id, table: 'email_reward_vouchers', type: 'email',
          member: v.profiles?.full_name || '?',
          meta: t('admin.rewards.logEmailCampaign', 'Email campaign'),
          reward: v.reward_label,
          points: 0,
          status: v.status,
          date: v.redeemed_at || v.created_at,
          canDeactivate: v.status === 'active',
        });
      });

      (redemptionRes.data || []).forEach(r => {
        entries.push({
          id: `rd-${r.id}`, dbId: r.id, table: 'reward_redemptions', type: 'redemption',
          member: r.profiles?.full_name || '?',
          meta: t('admin.rewards.logPointsRedemption', 'Points redemption'),
          reward: r.reward_name,
          points: r.points_spent || 0,
          status: r.status,
          date: r.claimed_at || r.created_at,
          canDeactivate: r.status === 'pending',
        });
      });

      return entries;
    },
    enabled: !!gymId,
    staleTime: 30_000,
  });

  // sort by status priority, then recency
  const ranked = useMemo(() => {
    return [...logEntries].sort((a, b) => (rankOf(a.status) - rankOf(b.status)) || (new Date(b.date) - new Date(a.date)));
  }, [logEntries]);

  const counts = useMemo(() => {
    const c = { all: ranked.length, pending: 0, expired: 0, claimed: 0 };
    ranked.forEach(e => {
      if (e.status === 'pending' || e.status === 'active') c.pending++;
      else if (e.status === 'expired') c.expired++;
      else c.claimed++;
    });
    return c;
  }, [ranked]);

  const filtered = useMemo(() => {
    const m = FILTER_MATCH[filter];
    return m ? ranked.filter(e => m.includes(e.status)) : ranked;
  }, [ranked, filter]);

  // group filtered → year → month (each preserving the ranked order)
  const grouped = useMemo(() => {
    const byYear = new Map();
    filtered.forEach(e => {
      const d = new Date(e.date);
      const y = d.getFullYear(), m = d.getMonth();
      if (!byYear.has(y)) byYear.set(y, new Map());
      const months = byYear.get(y);
      if (!months.has(m)) months.set(m, []);
      months.get(m).push(e);
    });
    return [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, months]) => ({
      year,
      count: [...months.values()].reduce((n, arr) => n + arr.length, 0),
      months: [...months.entries()].sort((a, b) => b[0] - a[0]).map(([month, items]) => ({ month, items })),
    }));
  }, [filtered]);

  // When a filter is applied, seed every matching group OPEN (still collapsible).
  // "Todos" resets to the default: only the current month/year open.
  useEffect(() => {
    if (filter === 'all') {
      setOpenYears(new Set([curY]));
      setOpenMonths(new Set([`${curY}-${curM}`]));
      return;
    }
    const ys = new Set();
    const ms = new Set();
    grouped.forEach(yg => {
      ys.add(yg.year);
      yg.months.forEach(mg => ms.add(`${yg.year}-${mg.month}`));
    });
    setOpenYears(ys);
    setOpenMonths(ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const monthName = (y, m) => {
    const s = new Date(y, m, 1).toLocaleDateString(lang, { month: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  // flatten to an ordered render list so borders/separators are trivial
  const items = [];
  grouped.forEach(yg => {
    const isCurrentYear = yg.year === curY;
    // current year has no header → always render its months when it has any
    const yearOpen = isCurrentYear || openYears.has(yg.year);
    if (!isCurrentYear) items.push({ kind: 'year', year: yg.year, count: yg.count, open: yearOpen });
    if (yearOpen) {
      yg.months.forEach(mg => {
        const key = `${yg.year}-${mg.month}`;
        const monthOpen = openMonths.has(key);
        items.push({ kind: 'month', key, name: monthName(yg.year, mg.month), count: mg.items.length, open: monthOpen, nested: !isCurrentYear });
        if (monthOpen) mg.items.forEach(entry => items.push({ kind: 'row', entry, nested: !isCurrentYear }));
      });
    }
  });

  const FILTERS = [
    { key: 'all', label: t('admin.rewards.filterAll', 'All') },
    { key: 'pending', label: t('admin.rewards.filterPending', 'Pending') },
    { key: 'expired', label: t('admin.rewards.filterExpired', 'Expired') },
    { key: 'claimed', label: t('admin.rewards.filterClaimed', 'Claimed') },
  ];

  const renderRow = (entry, topBorder, nested) => {
    const lead = LEAD[entry.type] || LEAD.redemption;
    const lt = TONE[lead.tone] || TONE.accent;
    return (
      <div key={entry.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 15, padding: `16px 22px 16px ${nested ? 40 : 22}px`, borderTop: topBorder ? `1px solid ${TK.divider}` : 'none' }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center', background: lt.bg, border: `1px solid ${lt.line}` }}>
          <Ico ch={lead.icon} size={18} color={lt.ink} stroke={2} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: FK.display, fontSize: 15, fontWeight: 800, color: TK.text, letterSpacing: -0.2 }}>{entry.member}</span>
            <span style={{ width: 4, height: 4, borderRadius: 99, background: TK.textFaint }} />
            <span style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute }}>{entry.meta}</span>
            {entry.status && <CanjeStatus kind={entry.status} t={t} />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 7, flexWrap: 'wrap' }}>
            {entry.medal && (
              <span style={{ width: 22, height: 22, borderRadius: 99, background: `color-mix(in srgb, ${MED[entry.medal].c} 18%, transparent)`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Ico ch={ICON.medal} size={13} color={MED[entry.medal].c} stroke={2} />
              </span>
            )}
            {entry.reward && <span style={{ fontFamily: FK.body, fontSize: 13.5, fontWeight: 600, color: TK.textSub }}>{entry.reward}</span>}
            {entry.points > 0 && <span style={{ fontFamily: FK.mono, fontSize: 12.5, fontWeight: 700, color: TK.accent }}>+{entry.points.toLocaleString()} pts</span>}
          </div>
          {entry.canDeactivate && (
            <button type="button" onClick={() => handleDeactivate(entry)} disabled={deactivating === entry.id}
              style={{ marginTop: 10, padding: '5px 13px', borderRadius: 999, cursor: 'pointer', background: 'var(--color-danger-soft)', border: '1px solid color-mix(in srgb, var(--color-danger) 28%, transparent)', fontFamily: FK.body, fontSize: 12.5, fontWeight: 700, color: 'var(--color-danger)', opacity: deactivating === entry.id ? 0.5 : 1 }}>
              {deactivating === entry.id ? '…' : t('admin.rewards.expire', 'Expire')}
            </button>
          )}
        </div>
        <span style={{ fontFamily: FK.mono, fontSize: 12.5, color: TK.textFaint, flexShrink: 0, paddingTop: 2, whiteSpace: 'nowrap' }}>{format(new Date(entry.date), 'MMM d', dateFnsLocale)}</span>
      </div>
    );
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '26px 0 14px' }}>
        <Ico ch={ICON.clock} size={15} color={TK.textFaint} stroke={2} />
        <span style={eyebrow}>{t('admin.rewards.activityLog', 'Activity Log')}</span>
      </div>

      {/* filter pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {FILTERS.map(f => {
          const on = filter === f.key;
          return (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 999, cursor: 'pointer',
                fontFamily: FK.body, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap',
                border: `1px solid ${on ? 'transparent' : TK.borderSolid}`,
                background: on ? TK.accent : TK.surface,
                color: on ? '#fff' : TK.textSub,
                boxShadow: on ? '0 2px 8px color-mix(in srgb, var(--color-accent) 30%, transparent)' : 'none',
              }}>
              {f.label}
              <span style={{ fontFamily: FK.mono, fontSize: 11, fontWeight: 800, color: on ? 'rgba(255,255,255,0.85)' : TK.textFaint }}>{counts[f.key] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <FadeIn>
        <Card style={{ overflow: 'hidden' }}>
          {isLoading ? (
            <div style={{ padding: '48px 0', textAlign: 'center', fontFamily: FK.body, fontSize: 12.5, color: TK.textMute }}>{t('common:loading')}</div>
          ) : logEntries.length === 0 ? (
            <div style={{ padding: '48px 0', textAlign: 'center' }}>
              <Ico ch={ICON.clock} size={26} color={TK.textMute} stroke={1.6} style={{ margin: '0 auto 8px' }} />
              <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, margin: 0 }}>{t('admin.rewards.noActivity', 'No reward activity yet')}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, margin: 0 }}>{t('admin.rewards.noFilterResults', 'Nothing matches this filter')}</p>
            </div>
          ) : (
            items.map((it, i) => {
              if (it.kind === 'year') {
                return (
                  <button key={`y-${it.year}`} type="button" onClick={() => toggleYear(it.year)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 22px', background: TK.surface2, border: 'none', borderTop: i > 0 ? `1px solid ${TK.divider}` : 'none', cursor: 'pointer' }}>
                    <Ico ch={it.open ? ICON.chevU : ICON.chevD} size={16} color={TK.textMute} stroke={2.2} />
                    <span style={{ fontFamily: FK.display, fontSize: 15, fontWeight: 800, color: TK.text, letterSpacing: -0.2 }}>{it.year}</span>
                    <span style={{ marginLeft: 'auto', fontFamily: FK.mono, fontSize: 12, fontWeight: 700, color: TK.textFaint }}>{it.count}</span>
                  </button>
                );
              }
              if (it.kind === 'month') {
                return (
                  <button key={`m-${it.key}`} type="button" onClick={() => toggleMonth(it.key)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: `11px 22px 11px ${it.nested ? 40 : 22}px`, background: 'transparent', border: 'none', borderTop: i > 0 ? `1px solid ${TK.divider}` : 'none', cursor: 'pointer' }}>
                    <Ico ch={it.open ? ICON.chevU : ICON.chevD} size={15} color={TK.textMute} stroke={2.2} />
                    <span style={{ fontFamily: FK.body, fontSize: 13.5, fontWeight: 800, letterSpacing: 0.3, color: it.open ? TK.text : TK.textSub }}>{it.name}</span>
                    <span style={{ marginLeft: 'auto', fontFamily: FK.mono, fontSize: 12, fontWeight: 700, color: TK.textFaint }}>{it.count}</span>
                  </button>
                );
              }
              return renderRow(it.entry, i > 0, it.nested);
            })
          )}
        </Card>
      </FadeIn>
    </>
  );
}
