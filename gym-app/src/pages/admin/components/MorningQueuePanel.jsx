import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import {
  Coffee, Phone, MessageSquare, MapPin, Check, X, Clock, ChevronRight, Loader2, Sparkles, HelpCircle,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import logger from '../../../lib/logger';
import { AdminCard, Avatar } from '../../../components/admin';
import { translateQueueReason } from '../../../lib/churn/signalI18n';
import QueueItemResolveModal from './QueueItemResolveModal';

// Segment metadata — drives badge colors + ordering.
// "Critical" first (red, urgent), then at_risk (amber), then cooling (blue).
const SEGMENT_META = {
  critical: { rank: 0, color: '#EF4444', tintBg: 'bg-[#EF4444]/8', tintBorder: 'border-[#EF4444]/20', textColor: 'text-[#EF4444]' },
  at_risk:  { rank: 1, color: '#F59E0B', tintBg: 'bg-[#F59E0B]/8', tintBorder: 'border-[#F59E0B]/20', textColor: 'text-[#F59E0B]' },
  cooling:  { rank: 2, color: '#60A5FA', tintBg: 'bg-[#60A5FA]/8', tintBorder: 'border-[#60A5FA]/20', textColor: 'text-[#60A5FA]' },
};

const ACTION_ICONS = {
  call:      Phone,
  message:   MessageSquare,
  in_person: MapPin,
};

const SNOOZE_HOURS = 24;
const INITIAL_VISIBLE = 5;
const LOAD_MORE_STEP = 5;

export default function MorningQueuePanel({ gymId }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { profile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateLocale = isEs ? { locale: esLocale } : undefined;

  const [resolving, setResolving] = useState(null);   // queue item being resolved
  const [actingId, setActingId]   = useState(null);   // id of item being mutated (for spinner)
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [showExplainer, setShowExplainer] = useState(false);  // toggles the "what is this?" inline help

  // ── Fetch pending queue items ──
  const { data: items = [], isLoading } = useQuery({
    queryKey: adminKeys.ownerQueue(gymId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('owner_queue_items')
        .select(`
          id, profile_id, segment, top_signal, reason, suggested_action,
          status, snoozed_until, created_at, expires_at,
          profiles:profile_id(full_name, avatar_url, username)
        `)
        .eq('gym_id', gymId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const now = Date.now();
      return (data || []).filter(row =>
        !row.snoozed_until || new Date(row.snoozed_until).getTime() <= now,
      );
    },
    enabled: !!gymId,
    staleTime: 30_000,
  });

  // Sort: critical → at_risk → cooling, then oldest within each (so the most
  // patient request gets handled first, not just the freshest)
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => {
      const rankA = SEGMENT_META[a.segment]?.rank ?? 99;
      const rankB = SEGMENT_META[b.segment]?.rank ?? 99;
      if (rankA !== rankB) return rankA - rankB;
      return new Date(a.created_at) - new Date(b.created_at);
    }),
    [items],
  );

  const stats = useMemo(() => {
    const counts = { critical: 0, at_risk: 0, cooling: 0 };
    items.forEach(i => { if (counts[i.segment] != null) counts[i.segment]++; });
    return counts;
  }, [items]);

  // ── Mutations ──
  const resolveMutation = useMutation({
    mutationFn: async ({ id, status, outcome, note }) => {
      // "Mark done" goes through the resolve_queue_item RPC so the
      // server can fan out a member-facing reflection notification
      // ("Your gym noticed you") when the outcome implies the owner
      // actually reached out. Snooze/dismiss paths still use direct
      // UPDATEs — they don't need server-side fanout.
      if (status === 'done') {
        const { error } = await supabase.rpc('resolve_queue_item', {
          p_item_id: id,
          p_outcome: outcome,
          p_note:    note ?? null,
        });
        if (error) throw error;
        return;
      }

      const payload = {
        status,
        resolved_at: new Date().toISOString(),
        resolved_by: profile?.id ?? null,
      };
      if (outcome) payload.resolved_outcome = outcome;
      if (note)    payload.resolved_note    = note;

      const { error } = await supabase
        .from('owner_queue_items')
        .update(payload)
        .eq('id', id)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onMutate: ({ id }) => setActingId(id),
    onSuccess: (_data, vars) => {
      logAdminAction('resolve_queue_item', 'owner_queue_item', vars.id, { status: vars.status, outcome: vars.outcome });
      queryClient.invalidateQueries({ queryKey: adminKeys.ownerQueue(gymId) });
      setResolving(null);
      showToast(t('admin.morningQueue.toastResolved', { defaultValue: 'Marked resolved' }), 'success');
    },
    onError: (err) => {
      logger.error('Failed to resolve queue item:', err);
      showToast(err?.message || t('admin.morningQueue.toastFailed', { defaultValue: 'Action failed' }), 'error');
    },
    onSettled: () => setActingId(null),
  });

  const snoozeMutation = useMutation({
    mutationFn: async (id) => {
      const snoozedUntil = new Date(Date.now() + SNOOZE_HOURS * 3600 * 1000).toISOString();
      const { error } = await supabase
        .from('owner_queue_items')
        .update({ snoozed_until: snoozedUntil })
        .eq('id', id)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onMutate: (id) => setActingId(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.ownerQueue(gymId) });
      showToast(t('admin.morningQueue.toastSnoozed', { defaultValue: 'Snoozed 24h' }), 'success');
    },
    onError: () => showToast(t('admin.morningQueue.toastFailed', { defaultValue: 'Action failed' }), 'error'),
    onSettled: () => setActingId(null),
  });

  // ── Render helpers ──
  const segmentBadge = (segment) => {
    const meta = SEGMENT_META[segment];
    if (!meta) return null;
    return (
      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${meta.tintBg} ${meta.tintBorder} ${meta.textColor}`}>
        {t(`admin.morningQueue.segments.${segment}`, segment)}
      </span>
    );
  };

  const handleDismiss = (item) => {
    resolveMutation.mutate({ id: item.id, status: 'dismissed' });
  };

  // ── Empty / loading states ──
  if (isLoading) {
    return (
      <AdminCard>
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="animate-spin text-[#6B7280]" />
        </div>
      </AdminCard>
    );
  }

  if (items.length === 0) {
    return (
      <AdminCard>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#10B981]/10 flex items-center justify-center flex-shrink-0">
            <Sparkles size={18} className="text-[#10B981]" />
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-bold text-[#E5E7EB]">
              {t('admin.morningQueue.emptyTitle', "Inbox zero. Nobody needs you right now.")}
            </p>
            <p className="text-[12px] text-[#9CA3AF] mt-1">
              {t('admin.morningQueue.emptyDesc', "The orchestrator checks every morning at 5am. New conversations will appear here.")}
            </p>
          </div>
        </div>
      </AdminCard>
    );
  }

  // ── Main view ──
  return (
    <>
      <AdminCard>
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
              <Coffee size={18} className="text-[#D4AF37]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[15px] font-bold text-[#E5E7EB]">
                  {t('admin.morningQueue.title', "Today's conversations")}
                </p>
                <button
                  onClick={() => setShowExplainer((v) => !v)}
                  aria-label={t('admin.morningQueue.whatIsThis', { defaultValue: 'What is this?' })}
                  className="rounded-full transition-colors hover:opacity-100"
                  style={{ opacity: showExplainer ? 1 : 0.55 }}
                >
                  <HelpCircle size={14} className="text-[#9CA3AF]" />
                </button>
              </div>
              <p className="text-[11px] text-[#6B7280] mt-0.5">
                {t('admin.morningQueue.countLabel', {
                  count: items.length,
                  defaultValue: '{{count}} member needs you',
                })}
              </p>
            </div>
          </div>
        </div>

        {/* "What is this?" inline explainer — toggled by the help icon next
            to the title. Kept inline (not a modal) so the owner can read it
            without leaving the morning's flow. Single paragraph because the
            value of this panel collapses into one sentence: "Text these
            people today before they cancel." */}
        {showExplainer && (
          <div
            className="mb-4 px-4 py-3 rounded-xl border text-[12.5px] leading-relaxed"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)',
              borderColor: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
              color: 'var(--color-text-muted)',
            }}
          >
            <p className="font-semibold mb-1" style={{ color: 'var(--color-accent)' }}>
              {t('admin.morningQueue.explainerTitle', { defaultValue: 'What is this?' })}
            </p>
            <p>
              {t('admin.morningQueue.explainerBody', {
                defaultValue: "This queue lists the members most likely to cancel this week, ranked by urgency. Each row suggests what to say based on the pattern (haven't shown up, broken streak, etc.). Your daily job is to message them — a personal note, not a broadcast. That routine is the difference between 70% and 85% annual retention.",
              })}
            </p>
          </div>
        )}

        {/* Stat chips */}
        {(stats.critical > 0 || stats.at_risk > 0 || stats.cooling > 0) && (
          <div className="flex gap-1.5 mb-4 flex-wrap">
            {stats.critical > 0 && (
              <span className="px-2 py-1 rounded-md text-[11px] font-semibold bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20">
                {stats.critical} {t('admin.morningQueue.segments.critical', 'critical')}
              </span>
            )}
            {stats.at_risk > 0 && (
              <span className="px-2 py-1 rounded-md text-[11px] font-semibold bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/20">
                {stats.at_risk} {t('admin.morningQueue.segments.at_risk', 'at risk')}
              </span>
            )}
            {stats.cooling > 0 && (
              <span className="px-2 py-1 rounded-md text-[11px] font-semibold bg-[#60A5FA]/10 text-[#60A5FA] border border-[#60A5FA]/20">
                {stats.cooling} {t('admin.morningQueue.segments.cooling', 'cooling')}
              </span>
            )}
          </div>
        )}

        {/* Cards (paged — show INITIAL_VISIBLE at a time, "Load more" reveals +LOAD_MORE_STEP) */}
        <ul className="divide-y divide-white/[0.06]">
          {sortedItems.slice(0, visibleCount).map(item => {
            const ActionIcon = ACTION_ICONS[item.suggested_action] || MessageSquare;
            const isActing = actingId === item.id;
            const profile = item.profiles || {};
            return (
              <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <Avatar name={profile.full_name} size="sm" src={profile.avatar_url} />
                  <div className="flex-1 min-w-0">
                    {/* Name + segment badge */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => navigate(`/admin/members?member=${item.profile_id}`)}
                        className="text-[13px] font-semibold text-[#E5E7EB] truncate hover:text-[#D4AF37] transition-colors"
                      >
                        {profile.full_name || t('admin.morningQueue.unknownMember', 'Unknown member')}
                      </button>
                      {segmentBadge(item.segment)}
                    </div>
                    {/* Reason — composed in SQL with English fragments,
                        translated client-side to match the app's locale. */}
                    <p className="text-[12px] text-[#9CA3AF] mt-1 line-clamp-2">{translateQueueReason(t, item.reason)}</p>
                    {/* Suggested action + age */}
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-[11px] text-[#D4AF37]">
                        <ActionIcon size={11} />
                        {t(`admin.morningQueue.actions.${item.suggested_action}`, item.suggested_action)}
                      </span>
                      <span className="text-[10px] text-[#6B7280]">
                        {formatDistanceToNow(new Date(item.created_at), { addSuffix: true, ...dateLocale })}
                      </span>
                    </div>
                  </div>
                  {/* Quick actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setResolving(item)}
                      disabled={isActing}
                      title={t('admin.morningQueue.markDone', 'Mark done')}
                      className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#10B981]/10 text-[#10B981] hover:bg-[#10B981]/20 transition-colors disabled:opacity-40"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={() => snoozeMutation.mutate(item.id)}
                      disabled={isActing}
                      title={t('admin.morningQueue.snooze24h', 'Snooze 24h')}
                      className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.04] text-[#9CA3AF] hover:bg-white/[0.08] hover:text-[#E5E7EB] transition-colors disabled:opacity-40"
                    >
                      <Clock size={14} />
                    </button>
                    <button
                      onClick={() => handleDismiss(item)}
                      disabled={isActing}
                      title={t('admin.morningQueue.dismiss', 'Dismiss')}
                      className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.04] text-[#6B7280] hover:bg-white/[0.08] hover:text-[#EF4444] transition-colors disabled:opacity-40"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Count + Load more — shows "Showing X of Y" with a CTA to reveal more.
            Reveal step matches INITIAL_VISIBLE so each click adds one "page". */}
        {sortedItems.length > INITIAL_VISIBLE && (
          <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[11px] text-[#6B7280] tabular-nums">
              {t('admin.morningQueue.showingCount', {
                shown: Math.min(visibleCount, sortedItems.length),
                total: sortedItems.length,
                defaultValue: 'Showing {{shown}} of {{total}}',
              })}
            </span>
            {visibleCount < sortedItems.length && (
              <button
                onClick={() => setVisibleCount(n => n + LOAD_MORE_STEP)}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-md bg-[#D4AF37]/10 text-[#D4AF37] hover:bg-[#D4AF37]/18 transition-colors"
              >
                {t('admin.morningQueue.loadMore', {
                  count: Math.min(LOAD_MORE_STEP, sortedItems.length - visibleCount),
                  defaultValue: 'Load {{count}} more',
                })}
              </button>
            )}
            {visibleCount >= sortedItems.length && visibleCount > INITIAL_VISIBLE && (
              <button
                onClick={() => setVisibleCount(INITIAL_VISIBLE)}
                className="text-[11px] font-semibold text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors"
              >
                {t('admin.morningQueue.collapse', 'Collapse')}
              </button>
            )}
          </div>
        )}

        {/* Footer: link to full retention page */}
        <button
          onClick={() => navigate('/admin/churn')}
          className="mt-4 w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold text-[#9CA3AF] hover:text-[#D4AF37] transition-colors"
        >
          {t('admin.morningQueue.viewRetention', 'Open full retention board')}
          <ChevronRight size={12} />
        </button>
      </AdminCard>

      <QueueItemResolveModal
        isOpen={!!resolving}
        onClose={() => setResolving(null)}
        onConfirm={({ outcome, note }) => {
          resolveMutation.mutate({ id: resolving.id, status: 'done', outcome, note });
        }}
        memberName={resolving?.profiles?.full_name}
        suggestedAction={resolving?.suggested_action}
        saving={resolveMutation.isPending}
      />
    </>
  );
}
