import { useEffect, useMemo, useState } from 'react';
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
import AdminPagination from '../../../components/admin/AdminPagination';
import { translateQueueReason } from '../../../lib/churn/signalI18n';
import QueueItemResolveModal from './QueueItemResolveModal';
import ContactPanel from './ContactPanel';

// Segment metadata — drives badge colors + ordering.
// "Critical" first (red, urgent), then at_risk (amber), then cooling (blue).
// Design handoff tones (semantic, not white-label): hot / warn / info.
const SEGMENT_META = {
  critical: { rank: 0, color: '#E8522A', soft: '#FBE6DD' },
  at_risk:  { rank: 1, color: '#E8A93A', soft: '#FBEED4' },
  cooling:  { rank: 2, color: '#4A7AE6', soft: '#E2EAFB' },
};

const ACTION_ICONS = {
  call:      Phone,
  message:   MessageSquare,
  in_person: MapPin,
};

// Approx churn score per segment — ContactPanel renders a risk badge + score bar
// and the queue item only carries the segment, not the raw score.
const SEGMENT_SCORE = { critical: 85, at_risk: 60, cooling: 40 };

const SNOOZE_HOURS = 24;
const PAGE_SIZE = 10;

export default function MorningQueuePanel({ gymId, cardHeight = 0 }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { profile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateLocale = isEs ? { locale: esLocale } : undefined;

  const [resolving, setResolving] = useState(null);   // queue item being resolved
  const [actingId, setActingId]   = useState(null);   // id of item being mutated (for spinner)
  const [convPage, setConvPage] = useState(1);        // 1-based page for the conversations list
  const [showExplainer, setShowExplainer] = useState(false);  // toggles the "what is this?" inline help
  const [contacting, setContacting] = useState(null);         // member whose contact modal is open

  // ── Fetch pending queue items ──
  const { data: items = [], isLoading } = useQuery({
    queryKey: adminKeys.ownerQueue(gymId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('owner_queue_items')
        .select(`
          id, profile_id, segment, top_signal, reason, suggested_action,
          status, snoozed_until, created_at, expires_at,
          profiles:profile_id(full_name, avatar_url, username, phone_number)
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

  // Keep the page in range as items get resolved/snoozed/dismissed off the list.
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE));
  useEffect(() => {
    if (convPage > totalPages) setConvPage(totalPages);
  }, [convPage, totalPages]);

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
      <span style={{
        display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 999,
        background: meta.soft, color: meta.color,
        fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', whiteSpace: 'nowrap',
      }}>
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
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-admin-text-muted)' }} />
        </div>
      </AdminCard>
    );
  }

  if (items.length === 0) {
    return (
      <AdminCard>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#DFF1E6' }}>
            <Sparkles size={18} style={{ color: '#2FA66B' }} />
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-bold" style={{ color: 'var(--color-admin-text)' }}>
              {t('admin.morningQueue.emptyTitle', "Inbox zero. Nobody needs you right now.")}
            </p>
            <p className="text-[12px] mt-1" style={{ color: 'var(--color-admin-text-muted)' }}>
              {t('admin.morningQueue.emptyDesc', "We check your members every morning at 5am. New conversations will appear here.")}
            </p>
          </div>
        </div>
      </AdminCard>
    );
  }

  // ── Main view ──
  // Paginate the conversations 5 at a time (shared Miembros-style pager in the
  // footer). The card keeps its matched height; any overflow scrolls inside.
  const safePage = Math.min(convPage, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageItems = sortedItems.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <>
      <div style={cardHeight ? { height: cardHeight } : undefined}>
      <AdminCard padding="p-0" className={cardHeight ? 'flex flex-col h-full' : ''}>
        {/* Header — coffee(hot) icon · title · count, segment pills right */}
        <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--color-admin-border)' }}>
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: '#FBE6DD', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Coffee size={15} strokeWidth={2.1} style={{ color: '#E8522A' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: "var(--admin-font-display, 'Archivo', sans-serif)", fontSize: 14.5, fontWeight: 800, letterSpacing: -0.2, color: 'var(--color-admin-text)' }}>
                  {t('admin.morningQueue.title', "Today's conversations")}
                </span>
                <button
                  onClick={() => setShowExplainer((v) => !v)}
                  aria-label={t('admin.morningQueue.whatIsThis', { defaultValue: 'What is this?' })}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', opacity: showExplainer ? 1 : 0.5 }}
                >
                  <HelpCircle size={13} style={{ color: 'var(--color-admin-text-muted)' }} />
                </button>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--color-admin-text-muted)', marginTop: 1 }}>
                {t('admin.morningQueue.countLabel', { count: items.length, defaultValue: '{{count}} member needs you' })}
              </div>
            </div>
          </div>
          {(stats.critical > 0 || stats.at_risk > 0 || stats.cooling > 0) && (
            <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {[['critical', stats.critical], ['at_risk', stats.at_risk], ['cooling', stats.cooling]]
                .filter(([, n]) => n > 0)
                .map(([seg, n]) => {
                  const m = SEGMENT_META[seg];
                  return (
                    <span key={seg} style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 999, background: m.soft, color: m.color, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3, whiteSpace: 'nowrap' }}>
                      {n} {t(`admin.morningQueue.segments.${seg}`, seg)}
                    </span>
                  );
                })}
            </div>
          )}
        </div>

        {/* "What is this?" inline explainer */}
        {showExplainer && (
          <div style={{ margin: '14px 18px 0', padding: '12px 14px', borderRadius: 12, fontSize: 12.5, lineHeight: 1.55, background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)', color: 'var(--color-admin-text-sub)' }}>
            <div style={{ fontWeight: 800, marginBottom: 4, color: 'var(--color-accent)' }}>
              {t('admin.morningQueue.explainerTitle', { defaultValue: 'What is this?' })}
            </div>
            {t('admin.morningQueue.explainerBody', { defaultValue: "This queue lists the members most likely to cancel this week, ranked by urgency. Each row suggests what to say based on the pattern. Your daily job is to message them — a personal note, not a broadcast. That routine is the difference between 70% and 85% annual retention." })}
          </div>
        )}

        {/* Rows — fills the matched height; rows beyond what fits scroll inside. */}
        <ul style={cardHeight
          ? { listStyle: 'none', margin: 0, padding: 0, flex: '1 1 0', minHeight: 0, overflowY: 'auto' }
          : { listStyle: 'none', margin: 0, padding: 0, maxHeight: 440, overflowY: 'auto' }}>
          {pageItems.map((item, idx) => {
            const ActionIcon = ACTION_ICONS[item.suggested_action] || MessageSquare;
            const isActing = actingId === item.id;
            const p = item.profiles || {};
            return (
              <li key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', borderTop: idx === 0 ? 'none' : '1px solid var(--color-admin-border)' }}>
                <Avatar name={p.full_name} size="sm" src={p.avatar_url} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <button
                      onClick={() => navigate(`/admin/members?member=${item.profile_id}`)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: 'var(--color-admin-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 170, textAlign: 'left' }}
                    >
                      {p.full_name || t('admin.morningQueue.unknownMember', 'Unknown member')}
                    </button>
                    {segmentBadge(item.segment)}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--color-admin-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {translateQueueReason(t, item.reason)}
                  </div>
                </div>
                {/* Action — opens the contact modal RIGHT HERE (message / SMS /
                    email + the member's phone for a call). No page redirect. */}
                <button
                  onClick={() => setContacting({
                    id: item.profile_id,
                    full_name: p.full_name || t('admin.morningQueue.unknownMember', 'Unknown member'),
                    phone_number: p.phone_number ?? null,
                    churnScore: SEGMENT_SCORE[item.segment] ?? 50,
                    _queueItemId: item.id,
                    _suggestedAction: item.suggested_action,
                  })}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 9, border: 'none', cursor: 'pointer', flexShrink: 0, fontSize: 12, fontWeight: 700, background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', color: 'var(--color-accent)' }}
                >
                  <ActionIcon size={13} />
                  {t(`admin.morningQueue.actions.${item.suggested_action}`, item.suggested_action)}
                </button>
                {/* Quick actions */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => setResolving(item)} disabled={isActing} title={t('admin.morningQueue.markDone', 'Mark done')}
                    style={{ width: 30, height: 30, borderRadius: 8, border: 'none', display: 'grid', placeItems: 'center', background: '#DFF1E6', color: '#2FA66B', cursor: isActing ? 'default' : 'pointer', opacity: isActing ? 0.4 : 1 }}>
                    <Check size={14} />
                  </button>
                  <button onClick={() => snoozeMutation.mutate(item.id)} disabled={isActing} title={t('admin.morningQueue.snooze24h', 'Snooze 24h')}
                    style={{ width: 30, height: 30, borderRadius: 8, border: 'none', display: 'grid', placeItems: 'center', background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-sub)', cursor: isActing ? 'default' : 'pointer', opacity: isActing ? 0.4 : 1 }}>
                    <Clock size={14} />
                  </button>
                  <button onClick={() => handleDismiss(item)} disabled={isActing} title={t('admin.morningQueue.dismiss', 'Dismiss')}
                    style={{ width: 30, height: 30, borderRadius: 8, border: 'none', display: 'grid', placeItems: 'center', background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-muted)', cursor: isActing ? 'default' : 'pointer', opacity: isActing ? 0.4 : 1 }}>
                    <X size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Pagination — 5 conversations per page (shared Miembros-style pager) */}
        {sortedItems.length > PAGE_SIZE && (
          <div style={{ padding: '0 18px 4px' }}>
            <AdminPagination
              page={safePage}
              pageSize={PAGE_SIZE}
              total={sortedItems.length}
              onPageChange={setConvPage}
            />
          </div>
        )}

        {/* Footer — total in follow-up · open retention board. Rows scroll
            inside the card above, so this bar stays put. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 18px', borderTop: '1px solid var(--color-admin-border)', background: 'var(--color-admin-panel)' }}>
          <span style={{ fontSize: 11.5, color: 'var(--color-admin-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {t('admin.morningQueue.totalInQueue', { count: sortedItems.length, defaultValue: '{{count}} in follow-up' })}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <button onClick={() => navigate('/admin/churn')}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 700, color: 'var(--color-admin-text-sub)' }}>
              {t('admin.morningQueue.viewRetention', 'Open full retention board')}
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </AdminCard>
      </div>

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

      {/* Contact modal — opens in place from the queue's action button. Reaching
          out (message / SMS / email, or "mark contacted" after a call) resolves
          the queue item in the background, so the row clears once you close. */}
      {contacting && (
        <ContactPanel
          member={contacting}
          gymId={gymId}
          adminId={profile?.id}
          isContacted={false}
          contactedAt={null}
          defaultChannel={contacting._suggestedAction === 'message' ? 'message' : null}
          onMarkContacted={async (memberId, channel, note) => {
            // Persist the contact (date · channel · content) so it shows in the
            // panel's history and marks the member as contacted.
            try {
              await supabase.from('admin_contact_log').insert({
                admin_id: profile?.id ?? null, member_id: memberId, gym_id: gymId,
                method: channel || 'manual', note: note ?? null,
              });
            } catch (e) { logger.error('admin_contact_log insert failed:', e); }
            // Reaching out also resolves the queue item (reached_out).
            const qid = contacting?._queueItemId;
            if (qid) {
              try {
                await supabase.from('owner_queue_items')
                  // resolved_outcome is constrained to reached_out/no_response/returned/lost.
                  .update({ status: 'done', resolved_at: new Date().toISOString(), resolved_by: profile?.id ?? null, resolved_outcome: 'reached_out', resolved_note: channel ? `via ${channel}` : null })
                  .eq('id', qid).eq('gym_id', gymId);
                logAdminAction('resolve_queue_item', 'owner_queue_item', qid, { status: 'done', outcome: 'reached_out', via: channel });
                queryClient.invalidateQueries({ queryKey: adminKeys.ownerQueue(gymId) });
              } catch (e) { logger.error('Queue contact-resolve failed:', e); }
            }
          }}
          onUnmarkContacted={async (memberId) => {
            try { await supabase.from('admin_contact_log').delete().eq('member_id', memberId).eq('gym_id', gymId); }
            catch (e) { logger.error('admin_contact_log delete failed:', e); }
          }}
          onClose={() => setContacting(null)}
        />
      )}
    </>
  );
}
