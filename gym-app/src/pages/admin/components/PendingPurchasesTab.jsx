import { useMemo, useState } from 'react';
import posthogClient from 'posthog-js';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { CardSkeleton } from '../../../components/admin';
import { storeKeys } from './storeConstants';
import { TK, FK, Ico, ICON, Card } from './retosKit';

const eyebrow = { fontFamily: FK.body, fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: TK.textFaint };

const Avatar = ({ name, size = 30 }) => (
  <span style={{ width: size, height: size, borderRadius: 99, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)', color: TK.accent, fontFamily: FK.display, fontSize: size * 0.42, fontWeight: 800 }}>
    {name?.[0]?.toUpperCase() ?? '?'}
  </span>
);

/**
 * "Aprobaciones pendientes" tab on AdminStore — the async approval queue.
 *
 * Every scanned/recorded purchase now lands here as PENDING and grants
 * nothing until an owner/admin approves it. Approve → award points,
 * increment/complete punch card (+ free reward) + wallet push, via
 * approve_gym_purchase. Reject → discard, grant nothing, via
 * reject_gym_purchase. Both RPCs are admin-only, gym-scoped, idempotent.
 */
export default function PendingPurchasesTab({ gymId, t, dateFnsLocale }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [actingId, setActingId] = useState(null);

  // Keyed under the store namespace so storeKeys.all(gymId) invalidation
  // (fired after approve/reject and by the scanner) refreshes this queue too.
  const { data: pending = [], isLoading } = useQuery({
    queryKey: [...storeKeys.all(gymId), 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_purchases')
        .select('*, profiles:member_id(full_name, avatar_url), gym_products:product_id(name, price, points_per_purchase, punch_card_enabled)')
        .eq('gym_id', gymId)
        .eq('status', 'pending')
        .eq('is_free_reward', false)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  // Approve / reject share one mutation keyed by action so a single button
  // press locks just that row. Both invalidate the whole store namespace so
  // the queue, the history tab and the page stats all refresh.
  const decideMutation = useMutation({
    mutationFn: async ({ id, action }) => {
      const rpc = action === 'approve' ? 'approve_gym_purchase' : 'reject_gym_purchase';
      const { data, error } = await supabase.rpc(rpc, { p_purchase_id: id });
      if (error) throw error;
      return { data, action };
    },
    onMutate: ({ id }) => setActingId(id),
    onSuccess: ({ data, action }) => {
      posthogClient?.capture('admin_purchase_decided', { action, free_earned: !!data?.free_item_earned });
      queryClient.invalidateQueries({ queryKey: storeKeys.all(gymId) });
      queryClient.invalidateQueries({ queryKey: ['admin', 'store', 'summary', gymId] });
      if (action === 'approve') {
        let msg = t('admin.store.purchaseApproved', 'Purchase approved.');
        if (data?.points_earned > 0) {
          msg = t('admin.store.purchaseApprovedPoints', 'Purchase approved — {{points}} points granted.', { points: data.points_earned });
        }
        if (data?.free_item_earned) {
          msg += ` ${t('admin.store.freeItemEarnedGeneric', 'Free item earned!')}`;
        }
        showToast(msg, 'success');
        // Wallet pass push is fired server-side by approve_gym_purchase; mirror
        // the client nudge the POS uses so the punch card updates promptly.
        if (data?.member_id && data?.punch_card_progress) {
          supabase.functions.invoke('push-wallet-update', {
            body: { profileId: data.member_id, reason: data.free_item_earned ? 'free_reward_earned' : 'punch_card_update' },
          }).catch(() => {});
        }
      } else {
        showToast(t('admin.store.purchaseRejected', 'Purchase rejected.'), 'info');
      }
    },
    onError: (err) => showToast(err.message, 'error'),
    onSettled: () => setActingId(null),
  });

  // group pending by day (created_at desc → day order desc)
  const groups = useMemo(() => {
    const byDay = new Map();
    pending.forEach(p => {
      const d = new Date(p.created_at);
      const key = format(d, 'yyyy-MM-dd');
      if (!byDay.has(key)) byDay.set(key, { label: format(d, 'd MMM yyyy', dateFnsLocale), items: [] });
      byDay.get(key).items.push(p);
    });
    return [...byDay.values()];
  }, [pending, dateFnsLocale]);

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '0 0 16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Ico ch={ICON.clock} size={15} color={TK.accent} stroke={2} />
          <span style={{ ...eyebrow, color: TK.accent }}>{t('admin.store.pendingApprovals', 'Pending approvals')}</span>
          {pending.length > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22, height: 22, padding: '0 7px', borderRadius: 999, background: TK.accentSoft, border: `1px solid ${TK.accentLine}`, fontFamily: FK.mono, fontSize: 11.5, fontWeight: 800, color: TK.accentInk }}>
              {pending.length}
            </span>
          )}
        </div>
      </div>

      <p style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textMute, margin: '0 0 16px', lineHeight: 1.5, maxWidth: 640 }}>
        {t('admin.store.pendingHint', 'Scanned purchases wait here. Nothing is granted — no points, punch-card stamps or free items — until you approve.')}
      </p>

      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2].map(i => <CardSkeleton key={i} h="h-[64px]" />)}
        </div>
      ) : pending.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '48px 0' }}>
          <Ico ch={ICON.checkCircle} size={28} color={TK.textMute} stroke={1.6} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, margin: 0 }}>{t('admin.store.noPending', 'No purchases awaiting approval')}</p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          {groups.map((g, gi) => (
            <div key={gi}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', background: TK.surface2, borderTop: gi > 0 ? `1px solid ${TK.divider}` : 'none' }}>
                <Ico ch={ICON.cal} size={13} color={TK.textMute} stroke={2} />
                <span style={{ fontFamily: FK.mono, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, color: TK.textMute }}>{g.label}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 600, color: TK.textFaint }}>
                  {g.items.length === 1 ? t('admin.store.onePending', '1 pending') : t('admin.store.manyPending', '{{count}} pending', { count: g.items.length })}
                </span>
              </div>
              {g.items.map(p => {
                const busy = actingId === p.id && decideMutation.isPending;
                const willPoints = p.points_earned ?? 0;
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderTop: `1px solid ${TK.divider}`, flexWrap: 'wrap' }}>
                    <Avatar name={p.profiles?.full_name} size={32} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: FK.body, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <b style={{ fontWeight: 700, color: TK.text }}>{p.profiles?.full_name ?? t('admin.store.unknown', 'Unknown')}</b>
                        <span style={{ color: TK.textMute }}> · </span>
                        <span style={{ color: TK.textSub }}>{p.quantity > 1 ? `${p.quantity}× ` : ''}{p.gym_products?.name ?? t('admin.store.unknown', 'Unknown')}</span>
                        {p.gym_products?.punch_card_enabled && (
                          <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: TK.accentSoft, border: `1px solid ${TK.accentLine}`, fontFamily: FK.body, fontSize: 10, fontWeight: 800, color: TK.accentInk, verticalAlign: 'middle' }}>
                            <Ico ch={ICON.ticket} size={10} color={TK.accent} stroke={2} />{t('admin.store.punchCardTag', 'PUNCH')}
                          </span>
                        )}
                      </div>
                      <span style={{ fontFamily: FK.mono, fontSize: 11.5, color: TK.textFaint }}>{format(new Date(p.created_at), 'h:mm a', dateFnsLocale)}</span>
                    </div>

                    {/* will-grant summary */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, whiteSpace: 'nowrap' }}>
                      <span style={{ fontFamily: FK.display, fontSize: 15, fontWeight: 800, color: TK.text }}>${parseFloat(p.total_price || 0).toFixed(2)}</span>
                      {willPoints > 0 && (
                        <span title={t('admin.store.pointsWillGrant', 'Points granted on approval')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 999, background: TK.accentSoft, border: `1px solid ${TK.accentLine}`, fontFamily: FK.mono, fontSize: 11, fontWeight: 700, color: TK.accentInk }}>
                          <Ico ch={ICON.star} size={10} color={TK.accent} stroke={2} />+{willPoints}
                        </span>
                      )}
                    </div>

                    {/* actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                      <button type="button" disabled={busy} onClick={() => decideMutation.mutate({ id: p.id, action: 'reject' })}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 10, cursor: busy ? 'default' : 'pointer', background: 'transparent', border: '1px solid color-mix(in srgb, var(--color-danger) 26%, transparent)', color: 'var(--color-danger)', fontFamily: FK.body, fontSize: 12.5, fontWeight: 700, opacity: busy ? 0.55 : 1 }}>
                        <Ico ch={ICON.x} size={14} color="var(--color-danger)" stroke={2.2} />{t('admin.store.reject', 'Reject')}
                      </button>
                      <button type="button" disabled={busy} onClick={() => decideMutation.mutate({ id: p.id, action: 'approve' })}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 15px', borderRadius: 10, cursor: busy ? 'default' : 'pointer', background: TK.accent, border: 'none', color: '#fff', fontFamily: FK.body, fontSize: 12.5, fontWeight: 700, boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)', opacity: busy ? 0.55 : 1 }}>
                        <Ico ch={ICON.check} size={14} color="#fff" stroke={2.4} />{busy ? t('admin.store.approving', 'Saving...') : t('admin.store.approve', 'Approve')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
