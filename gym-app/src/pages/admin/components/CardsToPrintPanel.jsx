import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow, format } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import {
  Printer, Check, X, Loader2, Gift, ChevronRight, Truck, UserCheck, ChevronDown, CalendarClock,
} from 'lucide-react';
import { getCardPaperType } from '../../../components/printCards/cardPaperType.js';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import { AdminCard, AdminModal } from '../../../components/admin';
import PrintPreviewModal from '../../../components/admin/PrintPreviewModal';
import RewardAttachModal from './RewardAttachModal';
import MarkDeliveredModal from './MarkDeliveredModal';
import { occasionMeta, CardAvatar, OccasionPill } from './cardOccasions';
import { computeExpectedDue, describeDue } from './cardDueDate';

const DISPLAY_FONT = "var(--admin-font-display, 'Archivo', 'Barlow', sans-serif)";
const SERIF_FONT = "'EB Garamond', Georgia, serif";
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Postcard format options — folded cards (tenure_365, milestone_500) skip
// this selector entirely since they always need Letter landscape.
const FORMAT_OPTIONS = [
  { key: 'postcard',    short: '4×6',   label: 'Postcard 4×6' },
  { key: 'letter-2up',  short: '2-up',  label: '2 per Letter' },
  { key: 'letter-1up',  short: 'Flyer', label: 'Flyer (Letter)' },
];

// ── Segmented tab control (matches the admin "section tabs" pattern) ──
function SectionTabs({ items, active, onChange }) {
  return (
    <div
      style={{
        display: 'inline-flex', gap: 4, padding: 4, borderRadius: 10,
        background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)',
        maxWidth: '100%', overflowX: 'auto',
      }}
    >
      {items.map((it) => {
        const isActive = it.id === active;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap transition-colors active:scale-[0.98]"
            style={{
              padding: '6px 13px', borderRadius: 7, border: 'none', cursor: 'pointer',
              fontSize: 12.5, fontWeight: 700, letterSpacing: -0.1,
              background: isActive ? 'var(--color-admin-text)' : 'transparent',
              // Inverse (panel) so the active label reads on the inverted pill in
              // BOTH themes — hardcoded #fff went invisible on the light dark-mode pill.
              color: isActive ? 'var(--color-admin-panel)' : 'var(--color-admin-text-sub)',
            }}
          >
            {it.label}
            {it.count != null && (
              <span
                className="admin-mono"
                style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
                  background: isActive ? 'color-mix(in srgb, var(--color-admin-panel) 20%, transparent)' : 'var(--color-admin-panel)',
                  color: isActive ? 'var(--color-admin-panel)' : 'var(--color-admin-text-muted)',
                }}
              >
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Compact icon button used in the per-row action cluster ──
function IconBtn({ icon: Icon, onClick, title, tone = 'neutral', danger = false }) {
  const tones = {
    neutral: { bg: 'var(--color-admin-panel)', fg: 'var(--color-admin-text-muted)' },
    coach:   { bg: 'var(--color-coach-soft)',  fg: 'var(--color-coach-ink)' },
    good:    { bg: 'var(--color-success-soft)', fg: 'var(--color-success-ink)' },
    accent:  { bg: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', fg: 'var(--color-accent)' },
  };
  const c = tones[tone] || tones.neutral;
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex items-center justify-center transition active:scale-95"
      style={{
        width: 30, height: 30, borderRadius: 8, border: 'none', cursor: 'pointer',
        background: c.bg,
        color: danger ? 'var(--color-danger)' : c.fg,
        flexShrink: 0,
      }}
    >
      <Icon size={14} />
    </button>
  );
}

export default function CardsToPrintPanel({ gymId }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { profile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateLocale = isEs ? { locale: esLocale } : undefined;

  // 'pending'   = needs printing
  // 'printed'   = printed + signed, waiting at front desk to hand over
  // 'delivered' = handed to member; archive (retention signal downstream).
  const [tab, setTab] = useState('pending');

  const { data: cards = [], isLoading, error } = useQuery({
    queryKey: [...adminKeys.printCards(gymId), tab],
    queryFn: async () => {
      // The hand-over columns (migration 0506) are only needed on the delivered
      // tab, where they're displayed. Selecting them only there keeps the daily
      // pending/printed tabs loading even before 0506 is applied.
      const handoverCols = tab === 'delivered' ? ', delivered_by_name, delivery_note' : '';
      const { data, error } = await supabase
        .from('print_cards')
        .select(`
          id, profile_id, occasion, occasion_data, headline, subline, printed_note,
          status, printed_at, delivered_at, created_at, expires_at, print_format,
          expected_delivery_at, delivery_fulfilled_by,
          reward_qr_code, reward_label${handoverCols},
          profiles:profile_id(full_name, avatar_url, created_at, date_of_birth)
        `)
        .eq('gym_id', gymId)
        .eq('status', tab)
        .order('created_at', { ascending: false })
        .limit(tab === 'delivered' ? 500 : 200);
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 30_000,
  });

  // Per-status counts for the tab badges. Three cheap head-counts; invalidated
  // by the same prefix the mutations already touch (adminKeys.printCards).
  const { data: counts = { pending: 0, printed: 0, delivered: 0 } } = useQuery({
    queryKey: [...adminKeys.printCards(gymId), 'counts'],
    queryFn: async () => {
      const statuses = ['pending', 'printed', 'delivered'];
      const results = await Promise.all(
        statuses.map((s) =>
          supabase
            .from('print_cards')
            .select('id', { count: 'exact', head: true })
            .eq('gym_id', gymId)
            .eq('status', s)
        )
      );
      const out = {};
      statuses.forEach((s, i) => { out[s] = results[i].count || 0; });
      return out;
    },
    enabled: !!gymId,
    staleTime: 30_000,
  });

  // Members physically present today (checked in since midnight). Drives the
  // "Here today" flag so staff can prioritize handing cards to people in the
  // building right now. Plain array (not Set) so the persisted React Query
  // cache rehydrates correctly; the Set is rebuilt in a useMemo.
  const { data: presentTodayList } = useQuery({
    queryKey: [...adminKeys.printCards(gymId), 'present-today'],
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('check_ins')
        .select('profile_id')
        .eq('gym_id', gymId)
        .gte('checked_in_at', start.toISOString())
        .limit(2000);
      if (error) throw error;
      return (data || []).map((c) => c.profile_id);
    },
    enabled: !!gymId,
    staleTime: 60_000,
  });
  const presentTodayIds = useMemo(
    () => new Set(Array.isArray(presentTodayList) ? presentTodayList : []),
    [presentTodayList]
  );

  const [selected, setSelected] = useState(new Set());
  const [previewIds, setPreviewIds] = useState(null);
  const [rewardCard, setRewardCard] = useState(null);
  const [deliverCard, setDeliverCard] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [monthOverride, setMonthOverride] = useState({});

  // Recent activity (check-ins + completed workouts = "was at the gym") for the
  // pending members — powers each card's expected hand-over date. Pending tab
  // only; degrades gracefully if either table is blocked by RLS.
  const pendingProfileIds = useMemo(
    () => (tab === 'pending' ? [...new Set(cards.map((c) => c.profile_id))] : []),
    [tab, cards]
  );
  const pendingKey = useMemo(() => pendingProfileIds.slice().sort().join(','), [pendingProfileIds]);

  const { data: activityByProfile = {} } = useQuery({
    queryKey: [...adminKeys.printCards(gymId), 'card-activity', pendingKey],
    queryFn: async () => {
      if (pendingProfileIds.length === 0) return {};
      const since = new Date();
      since.setDate(since.getDate() - 120);
      const sinceIso = since.toISOString();
      const [ci, ws] = await Promise.all([
        supabase.from('check_ins').select('profile_id, checked_in_at')
          .eq('gym_id', gymId).in('profile_id', pendingProfileIds).gte('checked_in_at', sinceIso).limit(5000),
        supabase.from('workout_sessions').select('profile_id, completed_at')
          .eq('status', 'completed').in('profile_id', pendingProfileIds).gte('completed_at', sinceIso).limit(5000),
      ]);
      const map = {};
      if (ci.error) console.warn('[CardsToPrintPanel] check-in history failed:', ci.error.message);
      else for (const r of ci.data || []) (map[r.profile_id] ||= []).push(r.checked_in_at);
      if (ws.error) console.warn('[CardsToPrintPanel] workout history failed:', ws.error.message);
      else for (const r of ws.data || []) if (r.completed_at) (map[r.profile_id] ||= []).push(r.completed_at);
      return map;
    },
    enabled: !!gymId && tab === 'pending' && pendingProfileIds.length > 0,
    staleTime: 5 * 60_000,
  });

  // Expected hand-over (next-visit) date per pending card.
  const dueByCard = useMemo(() => {
    const out = {};
    if (tab !== 'pending') return out;
    for (const c of cards) out[c.id] = computeExpectedDue(c, activityByProfile[c.profile_id] || []);
    return out;
  }, [tab, cards, activityByProfile]);

  // Ordering: members in the building right now float to the top; within the
  // pending tab the rest sort by soonest expected hand-over date.
  const orderedCards = useMemo(() => {
    const present = (id) => (presentTodayIds?.has(id) ? 1 : 0);
    if (tab === 'pending') {
      return [...cards].sort((a, b) => {
        const p = present(b.profile_id) - present(a.profile_id);
        if (p !== 0) return p;
        const da = dueByCard[a.id]?.date;
        const db = dueByCard[b.id]?.date;
        if (da && db) return da - db;   // soonest due first
        if (da) return -1;              // dated before undated
        if (db) return 1;
        return 0;
      });
    }
    if (!presentTodayIds || presentTodayIds.size === 0) return cards;
    return [...cards].sort((a, b) => present(b.profile_id) - present(a.profile_id));
  }, [cards, presentTodayIds, tab, dueByCard]);

  // Delivered archive grouped by year → month, most-recent first. Newest month
  // expands by default; older months collapse and only render their rows once
  // the owner clicks to open them.
  const deliveredGroups = useMemo(() => {
    if (tab !== 'delivered') return [];
    const byKey = new Map();
    for (const c of cards) {
      const d = new Date(c.delivered_at || c.created_at);
      const y = d.getFullYear();
      const m = d.getMonth();
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (!byKey.has(key)) byKey.set(key, { key, year: y, month: m, date: new Date(y, m, 1), cards: [] });
      byKey.get(key).cards.push(c);
    }
    const groups = [...byKey.values()];
    for (const g of groups) {
      g.cards.sort((a, b) => new Date(b.delivered_at || b.created_at) - new Date(a.delivered_at || a.created_at));
    }
    groups.sort((a, b) => b.date - a.date);
    return groups;
  }, [tab, cards]);

  // A month is open if explicitly toggled, else the newest group (index 0) only.
  const isMonthOpen = (key, idx) => (key in monthOverride ? monthOverride[key] : idx === 0);
  const toggleMonth = (key, idx) => setMonthOverride((o) => ({ ...o, [key]: !isMonthOpen(key, idx) }));

  const allSelected = cards.length > 0 && selected.size === cards.length;
  const someSelected = selected.size > 0;

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(cards.map((c) => c.id)));
  };

  // ── Mutations ──
  const markPrintedMutation = useMutation({
    mutationFn: async (ids) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('print_cards')
        .update({ status: 'printed', printed_at: now, printed_by: profile?.id ?? null })
        .in('id', ids)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: (_data, ids) => {
      logAdminAction('print_cards_marked', 'print_card', ids[0], { count: ids.length });
      queryClient.invalidateQueries({ queryKey: adminKeys.printCards(gymId) });
      setSelected(new Set());
      showToast(t('admin.printCards.toastPrinted', { count: ids.length, defaultValue: 'Marked printed' }), 'success');
    },
    onError: () => showToast(t('admin.printCards.toastFailed', { defaultValue: 'Action failed' }), 'error'),
  });

  const dismissMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('print_cards')
        .update({ status: 'dismissed' })
        .eq('id', id)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.printCards(gymId) });
      showToast(t('admin.printCards.toastRemoved', { defaultValue: 'Card removed' }), 'success');
    },
    onError: () => showToast(t('admin.printCards.toastFailed', { defaultValue: 'Action failed' }), 'error'),
  });

  // Set print format for one or many cards. The print preview groups by format
  // so all same-format cards print together.
  const setFormatMutation = useMutation({
    mutationFn: async ({ ids, format }) => {
      const { error } = await supabase
        .from('print_cards')
        .update({ print_format: format })
        .in('id', ids)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: (_data, { ids }) => {
      logAdminAction('print_cards_format_set', 'print_card', ids[0], { count: ids.length });
      queryClient.invalidateQueries({ queryKey: adminKeys.printCards(gymId) });
    },
    onError: () => showToast(t('admin.printCards.toastFailed', { defaultValue: 'Action failed' }), 'error'),
  });

  // Selected cards that are postcards (folded cards always use Letter landscape).
  const selectedPostcardIds = [...selected].filter((id) => {
    const c = cards.find((x) => x.id === id);
    return c && getCardPaperType(c.occasion) !== 'folded';
  });

  const handlePrintSelected = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setPreviewIds(ids);
  };

  // Footer summary line per tab.
  const footerCount = counts[tab] ?? cards.length;
  const footerLabel =
    tab === 'pending'
      ? t('admin.printCards.readyToPrint', { count: footerCount, defaultValue: '{{count}} cards ready to print' })
      : tab === 'printed'
        ? t('admin.printCards.readyToDeliver', { count: footerCount, defaultValue: '{{count}} cards ready to hand out' })
        : t('admin.printCards.deliveredCount', { count: footerCount, defaultValue: '{{count}} cards delivered' });

  // ── Per-row renderer ──
  const renderCard = (card, idx) => {
    const member = card.profiles || {};
    const { tone } = occasionMeta(card.occasion);
    const isPending = card.status === 'pending';
    const isPrinted = card.status === 'printed';
    const isDelivered = card.status === 'delivered';
    const isPostcardOccasion = getCardPaperType(card.occasion) !== 'folded';
    const cardFormat = card.print_format || 'postcard';
    const hereToday = presentTodayIds?.has(card.profile_id);

    // Expected hand-over date (pending only).
    const dueDesc = isPending ? describeDue(dueByCard[card.id], { t, isEs, dateLocale }) : null;
    const dueColor = dueDesc
      ? (dueDesc.tone === 'danger' ? 'var(--color-danger)'
        : dueDesc.tone === 'accent' ? 'var(--color-accent)'
        : dueDesc.tone === 'muted' ? 'var(--color-admin-text-faint)'
        : 'var(--color-admin-text-sub)')
      : undefined;

    let timestampLine;
    if (isDelivered && card.delivered_at) {
      timestampLine = t('admin.printCards.deliveredTimeAgo', {
        when: formatDistanceToNow(new Date(card.delivered_at), { addSuffix: true, ...dateLocale }),
        defaultValue: 'Delivered {{when}}',
      });
    } else if (isPrinted && card.printed_at) {
      timestampLine = t('admin.printCards.printedTimeAgo', {
        when: formatDistanceToNow(new Date(card.printed_at), { addSuffix: true, ...dateLocale }),
        defaultValue: 'Printed {{when}}',
      });
    } else {
      timestampLine = t('admin.printCards.generatedTimeAgo', {
        when: formatDistanceToNow(new Date(card.created_at), { addSuffix: true, ...dateLocale }),
        defaultValue: 'Generated {{when}}',
      });
    }

    return (
      <div
        key={card.id}
        className="flex items-center gap-3.5 px-3 sm:px-4 py-3 flex-wrap sm:flex-nowrap"
        style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--color-admin-border)' }}
      >
        {isPending && (
          <input
            type="checkbox"
            checked={selected.has(card.id)}
            onChange={() => toggleSelect(card.id)}
            aria-label={t('admin.printCards.selectCard', 'Select card')}
            style={{ accentColor: 'var(--color-accent)', width: 15, height: 15, flexShrink: 0 }}
          />
        )}
        <CardAvatar name={member.full_name} src={member.avatar_url} tone={tone} size={34} />

        {/* Member + occasion + generated-time */}
        <div className="min-w-0" style={{ width: 196, flexShrink: 0 }}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[13px] font-bold truncate" style={{ color: 'var(--color-admin-text)' }}>
              {member.full_name || t('admin.printCards.unknownMember', 'Unknown member')}
            </span>
            <OccasionPill occasion={card.occasion} label={t(`admin.printCards.occasions.${card.occasion}`, card.occasion)} />
            {hereToday && (
              <span className="admin-pill admin-pill--good">
                <UserCheck size={11} />
                {t('admin.printCards.hereToday', 'Here today')}
              </span>
            )}
          </div>
          {isPending ? (
            <div
              className="text-[11px] mt-0.5 flex items-center gap-1 truncate"
              style={{ color: dueColor, fontWeight: (dueDesc.tone === 'accent' || dueDesc.tone === 'danger') ? 700 : 500 }}
              title={t('admin.printCards.expectedHandoverTip', { defaultValue: 'Expected next visit — when you can hand the card over' })}
            >
              <CalendarClock size={11} style={{ flexShrink: 0 }} />
              <span className="truncate">{dueDesc.text}</span>
            </div>
          ) : (
            <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--color-admin-text-muted)' }}>
              {timestampLine}
            </div>
          )}
          {(isPrinted || isDelivered) && card.expected_delivery_at && (
            <div className="text-[10.5px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--color-accent)' }}>
              <Truck size={10} />
              {card.delivery_fulfilled_by === 'platform'
                ? t('admin.printCards.expectedDeliveryPlatform', {
                    date: format(new Date(card.expected_delivery_at), isEs ? "d 'de' MMM" : 'MMM d', dateLocale),
                    defaultValue: 'Arriving ~{{date}}',
                  })
                : t('admin.printCards.expectedDeliverySelf', {
                    date: format(new Date(card.expected_delivery_at), isEs ? "d 'de' MMM" : 'MMM d', dateLocale),
                    defaultValue: 'Hand out by {{date}}',
                  })}
            </div>
          )}
          {/* Accountability: who handed it over + optional note (delivered tab) */}
          {isDelivered && card.delivered_by_name && (
            <div className="text-[11px] mt-0.5 flex items-center gap-1 truncate" style={{ color: 'var(--color-admin-text-sub)' }}>
              <UserCheck size={11} style={{ flexShrink: 0 }} />
              <span className="truncate">
                {t('admin.printCards.deliveredByLine', { name: card.delivered_by_name, defaultValue: 'By {{name}}' })}
              </span>
            </div>
          )}
          {isDelivered && card.delivery_note && (
            <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--color-admin-text-muted)', fontStyle: 'italic' }}>
              “{card.delivery_note}”
            </div>
          )}
        </div>

        {/* The handwritten message — headline as the editorial quote, subline under */}
        <div className="flex-1 min-w-0 order-last sm:order-none w-full sm:w-auto">
          <div
            className="truncate"
            style={{ fontFamily: SERIF_FONT, fontStyle: 'italic', fontSize: 15, color: 'var(--color-admin-text)' }}
          >
            “{card.headline}”
          </div>
          {card.subline && (
            <div className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--color-admin-text-sub)' }}>
              {card.subline}
            </div>
          )}
        </div>

        {/* Per-card format selector — pending postcards only */}
        {isPending && isPostcardOccasion && (
          <div className="relative flex-shrink-0">
            <select
              value={cardFormat}
              onChange={(e) => setFormatMutation.mutate({ ids: [card.id], format: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              title={t('admin.printCards.formatTooltip', { defaultValue: 'Print format' })}
              className="appearance-none cursor-pointer admin-mono"
              style={{
                fontSize: 11.5, fontWeight: 700, color: 'var(--color-admin-text-sub)',
                background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)',
                borderRadius: 8, padding: '5px 24px 5px 9px',
              }}
            >
              {FORMAT_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.short}</option>
              ))}
            </select>
            <ChevronDown
              size={12}
              style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-admin-text-muted)', pointerEvents: 'none' }}
            />
          </div>
        )}

        {/* Action cluster */}
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto sm:ml-0">
          {isPending && card.occasion !== 'returning' && (
            <IconBtn
              icon={Gift}
              tone={card.reward_qr_code ? 'accent' : 'neutral'}
              onClick={() => setRewardCard(card)}
              title={card.reward_qr_code
                ? t('admin.printCards.rewardManage', { defaultValue: 'Manage reward' })
                : t('admin.printCards.attachReward', { defaultValue: 'Attach reward' })}
            />
          )}
          {isPending && (
            <IconBtn
              icon={Printer}
              tone="coach"
              onClick={() => setPreviewIds([card.id])}
              title={t('admin.printCards.previewCard', { defaultValue: 'Preview & print' })}
            />
          )}
          {isPending && (
            <IconBtn
              icon={X}
              danger
              onClick={() => dismissMutation.mutate(card.id)}
              title={t('admin.printCards.dismiss', 'Dismiss')}
            />
          )}
          {isPrinted && (
            <IconBtn
              icon={Check}
              tone="good"
              onClick={() => setDeliverCard(card)}
              title={t('admin.printCards.markDelivered', 'Mark delivered')}
            />
          )}
          {/* Couldn't deliver (circumstances) — pull it from the queue */}
          {isPrinted && (
            <IconBtn
              icon={X}
              danger
              onClick={() => setConfirmRemove(card)}
              title={t('admin.printCards.cantDeliver', { defaultValue: "Couldn't deliver" })}
            />
          )}
          {/* Remove a delivery record (marked by mistake / didn't actually happen) */}
          {isDelivered && (
            <IconBtn
              icon={X}
              danger
              onClick={() => setConfirmRemove(card)}
              title={t('admin.printCards.removeDelivery', { defaultValue: 'Remove delivery' })}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3.5">
      {/* Section tabs */}
      <SectionTabs
        active={tab}
        onChange={(id) => { setTab(id); setSelected(new Set()); }}
        items={[
          { id: 'pending',   label: t('admin.printCards.tabPending', 'To print'),    count: counts.pending },
          { id: 'printed',   label: t('admin.printCards.tabPrinted', 'To deliver'),  count: counts.printed },
          { id: 'delivered', label: t('admin.printCards.tabDelivered', 'Delivered'), count: counts.delivered },
        ]}
      />

      {/* Print preview modal */}
      {previewIds && (
        <PrintPreviewModal ids={previewIds} onClose={() => setPreviewIds(null)} />
      )}

      {/* Reward attach/detach modal */}
      {rewardCard && (
        <RewardAttachModal card={rewardCard} gymId={gymId} onClose={() => setRewardCard(null)} />
      )}

      {/* Accountable hand-over modal */}
      {deliverCard && (
        <MarkDeliveredModal card={deliverCard} gymId={gymId} onClose={() => setDeliverCard(null)} />
      )}

      {/* Remove / couldn't-deliver confirmation (printed + delivered tabs) */}
      {confirmRemove && (
        <AdminModal
          isOpen
          onClose={() => setConfirmRemove(null)}
          size="sm"
          titleIcon={X}
          title={confirmRemove.status === 'delivered'
            ? t('admin.printCards.removeTitleDelivered', { defaultValue: 'Remove this delivery?' })
            : t('admin.printCards.removeTitlePrinted', { defaultValue: "Couldn't deliver this card?" })}
          subtitle={`${t(`admin.printCards.occasions.${confirmRemove.occasion}`, confirmRemove.occasion)} — ${confirmRemove.profiles?.full_name || ''}`}
          footer={
            <>
              <button
                onClick={() => setConfirmRemove(null)}
                className="flex-1 px-3 py-2.5 rounded-lg text-[12px] font-bold transition active:scale-95"
                style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-primary)' }}
              >
                {t('admin.printCards.cancelBtn', { defaultValue: 'Cancel' })}
              </button>
              <button
                onClick={() => { dismissMutation.mutate(confirmRemove.id); setConfirmRemove(null); }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-[12px] font-bold transition active:scale-95"
                style={{ background: 'var(--color-danger)', color: '#fff' }}
              >
                <X size={13} />
                {t('admin.printCards.removeConfirm', { defaultValue: 'Remove' })}
              </button>
            </>
          }
        >
          <p className="text-[12.5px]" style={{ color: 'var(--color-text-muted)' }}>
            {confirmRemove.status === 'delivered'
              ? t('admin.printCards.removeBodyDelivered', { defaultValue: 'This delivery will be removed from the history. The record is kept but hidden.' })
              : t('admin.printCards.removeBodyPrinted', { defaultValue: 'This card will be removed from the delivery queue. The record is kept but hidden.' })}
          </p>
        </AdminModal>
      )}

      <AdminCard padding="p-0">
        {/* Selection bar — pending tab only */}
        {tab === 'pending' && cards.length > 0 && (
          <div
            className="flex items-center gap-3 px-3 sm:px-4 py-2.5 flex-wrap"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
              borderBottom: '1px solid var(--color-admin-border)',
            }}
          >
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              aria-label={allSelected ? t('admin.printCards.clearAll', 'Clear all') : t('admin.printCards.selectAll', 'Select all')}
              style={{ accentColor: 'var(--color-accent)', width: 15, height: 15 }}
            />
            <button
              onClick={toggleSelectAll}
              className="text-[12.5px] font-bold transition-colors"
              style={{ color: 'var(--color-accent)' }}
            >
              {allSelected ? t('admin.printCards.clearAll', 'Clear all') : t('admin.printCards.selectAll', 'Select all')}
            </button>
            <span className="text-[12.5px]" style={{ color: 'var(--color-admin-text-sub)' }}>
              · {t('admin.printCards.selectedCount', { count: selected.size, defaultValue: '{{count}} selected' })}
            </span>

            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {/* Bulk set-format — applies to selected postcards only */}
              {selectedPostcardIds.length > 0 && (
                <div className="relative">
                  <select
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      setFormatMutation.mutate({ ids: selectedPostcardIds, format: v });
                      e.target.value = '';
                    }}
                    defaultValue=""
                    title={t('admin.printCards.bulkFormatTooltip', { defaultValue: 'Set format for selected postcards' })}
                    className="appearance-none cursor-pointer"
                    style={{
                      fontSize: 11.5, fontWeight: 700, color: 'var(--color-admin-text-sub)',
                      background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)',
                      borderRadius: 8, padding: '6px 24px 6px 10px',
                    }}
                  >
                    <option value="" disabled>{t('admin.printCards.bulkFormatLabel', { defaultValue: 'Set size…' })}</option>
                    {FORMAT_OPTIONS.map((opt) => (
                      <option key={opt.key} value={opt.key}>{opt.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-admin-text-muted)', pointerEvents: 'none' }} />
                </div>
              )}
              <button
                onClick={handlePrintSelected}
                disabled={!someSelected}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-bold transition active:scale-95 disabled:opacity-40"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)', color: 'var(--color-accent)' }}
              >
                <Printer size={12} />
                {t('admin.printCards.printSelected', 'Print preview')}
              </button>
              <button
                onClick={() => markPrintedMutation.mutate([...selected])}
                disabled={!someSelected || markPrintedMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-bold transition active:scale-95 disabled:opacity-40"
                style={{ background: 'var(--color-bg-card)', color: 'var(--color-admin-text)', border: '1px solid var(--color-admin-border)' }}
              >
                <Check size={12} />
                {t('admin.printCards.markPrintedBulk', 'Mark printed')}
              </button>
            </div>
          </div>
        )}

        {/* List / states */}
        {error ? (
          <div className="text-center py-12 px-4">
            <Printer size={26} className="mx-auto mb-2" style={{ color: 'var(--color-admin-text-faint)' }} />
            <p className="text-[13px]" style={{ color: 'var(--color-danger)' }}>
              {t('admin.printCards.loadError', 'Could not load cards. Try again in a moment.')}
            </p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-admin-text-muted)' }} />
          </div>
        ) : cards.length === 0 ? (
          <div className="text-center py-12 px-4">
            <Printer size={26} className="mx-auto mb-2" style={{ color: 'var(--color-admin-text-faint)' }} />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--color-admin-text-sub)' }}>
              {tab === 'pending'
                ? t('admin.printCards.emptyPending', 'No cards waiting to print.')
                : tab === 'printed'
                  ? t('admin.printCards.emptyPrinted', 'No printed cards waiting for delivery.')
                  : t('admin.printCards.emptyDelivered', 'No cards have been delivered yet.')}
            </p>
            <p className="text-[11.5px] mt-1" style={{ color: 'var(--color-admin-text-muted)' }}>
              {tab === 'delivered'
                ? t('admin.printCards.emptyDeliveredHint', 'Cards you hand to members show up here as a retention archive.')
                : t('admin.printCards.emptyHint', 'New cards are created automatically each day for milestones and returning members.')}
            </p>
          </div>
        ) : (
          <>
            {tab === 'delivered' ? (
              <div>
                {deliveredGroups.map((g, gi) => {
                  const open = isMonthOpen(g.key, gi);
                  const showYear = gi === 0 || deliveredGroups[gi - 1].year !== g.year;
                  const monthName = capitalize(format(g.date, 'LLLL', dateLocale));
                  return (
                    <div key={g.key}>
                      {showYear && (
                        <div
                          className="px-3 sm:px-4 pt-3 pb-1 text-[11px] font-extrabold"
                          style={{
                            color: 'var(--color-admin-text-muted)', letterSpacing: '0.08em',
                            borderTop: gi === 0 ? 'none' : '1px solid var(--color-admin-border)',
                          }}
                        >
                          {g.year}
                        </div>
                      )}
                      <button
                        onClick={() => toggleMonth(g.key, gi)}
                        className="w-full flex items-center gap-2 px-3 sm:px-4 py-2.5 transition-colors"
                        style={{
                          borderTop: showYear ? 'none' : '1px solid var(--color-admin-border)',
                          background: open ? 'var(--color-admin-sidebar)' : 'transparent',
                        }}
                      >
                        {open
                          ? <ChevronDown size={14} style={{ color: 'var(--color-admin-text-muted)' }} />
                          : <ChevronRight size={14} style={{ color: 'var(--color-admin-text-muted)' }} />}
                        <span className="text-[12.5px] font-bold" style={{ color: 'var(--color-admin-text)' }}>{monthName}</span>
                        <span
                          className="admin-mono"
                          style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-muted)' }}
                        >
                          {g.cards.length}
                        </span>
                      </button>
                      {open && (
                        <div style={{ borderTop: '1px solid var(--color-admin-border)' }}>
                          {g.cards.map(renderCard)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div>{orderedCards.map(renderCard)}</div>
            )}
            {/* Footer */}
            <div
              className="flex items-center justify-between gap-3 px-3 sm:px-4 py-3"
              style={{ borderTop: '1px solid var(--color-admin-border)', background: 'var(--color-admin-sidebar)' }}
            >
              <span className="text-[11.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                {footerLabel}
              </span>
              {tab !== 'delivered' && (
                <button
                  onClick={() => { setTab('delivered'); setSelected(new Set()); }}
                  className="inline-flex items-center gap-1 text-[11.5px] font-bold transition-colors"
                  style={{ color: 'var(--color-admin-text-sub)' }}
                >
                  {t('admin.printCards.viewHistory', { defaultValue: 'View delivery history' })}
                  <ChevronRight size={13} />
                </button>
              )}
            </div>
          </>
        )}
      </AdminCard>
    </div>
  );
}
