import { useState, useMemo } from 'react';
import posthogClient from 'posthog-js';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { FadeIn, CardSkeleton } from '../../../components/admin';
import QRScannerModal from '../../../components/admin/QRScannerModal';
import PasswordResetApprovalModal from './PasswordResetApprovalModal';
import { storeKeys } from './storeConstants';
import { TK, FK, Ico, ICON, Card, IconChip } from './retosKit';

const eyebrow = { fontFamily: FK.body, fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: TK.textFaint };
const fieldStyle = { width: '100%', background: TK.surface2, border: `1px solid ${TK.borderSolid}`, borderRadius: 12, padding: '13px 15px', fontFamily: FK.body, fontSize: 14.5, color: TK.text, outline: 'none' };
const smallSelect = { background: TK.surface, border: `1px solid ${TK.borderSolid}`, borderRadius: 10, padding: '8px 12px', fontFamily: FK.body, fontSize: 12.5, fontWeight: 600, color: TK.textSub, outline: 'none' };
const Avatar = ({ name, size = 30 }) => (
  <span style={{ width: size, height: size, borderRadius: 99, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)', color: TK.accent, fontFamily: FK.display, fontSize: size * 0.42, fontWeight: 800 }}>
    {name?.[0]?.toUpperCase() ?? '?'}
  </span>
);

/**
 * "Historial de compras" tab on AdminStore — staff checkout surface.
 *   Left:  Registrar compra (POS) — pick member (search/QR), product, qty.
 *   Right: Compras recientes — day-grouped purchase timeline w/ filters.
 * QR scan handles purchase / password_reset / checkin / reward_redemption.
 */
export default function MemberPurchasesTab({ gymId, t, dateFnsLocale }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [showMemberDropdown, setShowMemberDropdown] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [resetApprovalId, setResetApprovalId] = useState(null);
  const [filterProduct, setFilterProduct] = useState('all');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');

  // Fetch active products
  const { data: products = [] } = useQuery({
    queryKey: [...storeKeys.products(gymId), 'active'],
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_products')
        .select('*')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('name');
      return data || [];
    },
    enabled: !!gymId,
  });

  // All products for filter dropdown
  const { data: allProducts = [] } = useQuery({
    queryKey: storeKeys.products(gymId),
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_products')
        .select('id, name')
        .eq('gym_id', gymId)
        .order('name');
      return data || [];
    },
    enabled: !!gymId,
  });

  // Load all gym members. Excludes deactivated/banned members so they don't
  // surface in the redemption recipient picker (they can't redeem either way).
  const { data: allMembers = [], isLoading: membersLoading } = useQuery({
    queryKey: storeKeys.members(gymId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url, role, membership_status')
        .eq('gym_id', gymId)
        .in('role', ['member', 'trainer'])
        .not('membership_status', 'in', '(deactivated,banned)')
        .order('full_name')
        .limit(500);
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  const members = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return [];
    return allMembers.filter(m =>
      m.full_name?.toLowerCase().includes(q) ||
      m.username?.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [memberSearch, allMembers]);

  // Fetch punch card progress for selected member + product
  const { data: punchCount = 0 } = useQuery({
    queryKey: ['admin', 'store', gymId, 'punchCount', selectedMember?.id, selectedProduct?.id],
    queryFn: async () => {
      // Count only APPROVED purchases as punches — punch-card stamps are granted
      // on approval (migration 0602), so pending/rejected rows aren't punches yet.
      const { count } = await supabase
        .from('member_purchases')
        .select('id', { count: 'exact', head: true })
        .eq('member_id', selectedMember.id)
        .eq('product_id', selectedProduct.id)
        .eq('is_free_reward', false)
        .eq('status', 'approved');
      return count ?? 0;
    },
    enabled: !!selectedMember && !!selectedProduct?.punch_card_enabled,
  });

  // History query
  const historyFilters = useMemo(() => ({ filterProduct, historyDateFrom, historyDateTo }), [filterProduct, historyDateFrom, historyDateTo]);

  const { data: purchaseHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: storeKeys.purchases(gymId, historyFilters),
    queryFn: async () => {
      let query = supabase
        .from('member_purchases')
        .select('*, profiles:member_id(full_name, avatar_url), gym_products:product_id(name, price)')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (filterProduct !== 'all') {
        query = query.eq('product_id', filterProduct);
      }
      if (historyDateFrom) {
        query = query.gte('created_at', new Date(historyDateFrom).toISOString());
      }
      if (historyDateTo) {
        const end = new Date(historyDateTo);
        end.setDate(end.getDate() + 1);
        query = query.lt('created_at', end.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  const recordMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMember || !selectedProduct) throw new Error(t('admin.store.selectBoth', 'Select a member and product.'));

      const { data, error } = await supabase.rpc('record_gym_purchase', {
        p_gym_id: gymId,
        p_member_id: selectedMember.id,
        p_product_id: selectedProduct.id,
        p_recorded_by: profile.id,
        p_quantity: quantity,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      posthogClient?.capture('admin_purchase_logged', { quantity, queued: true });
      queryClient.invalidateQueries({ queryKey: storeKeys.all(gymId) });
      // Purchases now enter the approval queue (migration 0602): nothing is
      // granted — no points, punch-card stamps, free items or wallet update —
      // until an admin approves it on the Pending approvals tab. So we no longer
      // claim points were earned or push a wallet update here.
      showToast(t('admin.store.purchaseQueued', 'Purchase queued for approval.'), 'success');

      setSelectedMember(null);
      setSelectedProduct(null);
      setQuantity(1);
      setMemberSearch('');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  // QR Scan handler
  const handleQRScan = async (parsed) => {
    setShowScanner(false);

    if (parsed.type === 'purchase') {
      if (parsed.gymId !== gymId) {
        showToast(t('admin.store.wrongGym', 'QR code is for a different gym'), 'error');
        return;
      }

      const { data: memberData } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .eq('id', parsed.memberId)
        .eq('gym_id', gymId)
        .single();

      if (!memberData) {
        showToast(t('admin.store.memberNotFound', 'Member not found'), 'error');
        return;
      }
      setSelectedMember(memberData);
      setMemberSearch('');

      const product = products.find(p => p.id === parsed.productId);
      if (!product) {
        showToast(t('admin.store.productNotFound', 'Product not found or inactive'), 'error');
        return;
      }
      setSelectedProduct(product);
      setQuantity(1);
      showToast(`${memberData.full_name} - ${product.name}`, 'success');
    } else if (parsed.type === 'password_reset') {
      setResetApprovalId(parsed.request_id);
    } else if (parsed.type === 'checkin') {
      const { data: memberData } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .eq('qr_code_payload', parsed.qrPayload)
        .eq('gym_id', gymId)
        .single();

      if (!memberData) {
        showToast(t('admin.store.memberNotFound', 'Member not found for this QR code'), 'error');
        return;
      }
      setSelectedMember(memberData);
      setMemberSearch('');
      showToast(`${t('admin.store.member', 'Member')}: ${memberData.full_name} - ${t('admin.store.selectProduct', 'select a product')}`, 'info');
    } else if (parsed.type === 'reward_redemption') {
      // Member is cashing in a reward — mark as claimed
      if (parsed.gymId !== gymId) {
        showToast(t('admin.store.wrongGym', 'QR code is for a different gym'), 'error');
        return;
      }
      const { data: redemption, error: fetchErr } = await supabase
        .from('reward_redemptions')
        .select('id, profile_id, reward_name, points_spent, status, profiles!reward_redemptions_profile_id_fkey(full_name)')
        .eq('id', parsed.redemptionId)
        .eq('gym_id', gymId)
        .single();

      if (fetchErr || !redemption) {
        showToast(t('admin.store.redemptionNotFound', 'Redemption not found'), 'error');
        return;
      }
      if (redemption.status === 'claimed') {
        showToast(t('admin.store.alreadyClaimed', 'This reward was already claimed'), 'info');
        return;
      }
      if (redemption.status === 'expired') {
        showToast(t('admin.store.redemptionExpired', 'This redemption has expired'), 'error');
        return;
      }

      const { error: claimErr } = await supabase.rpc('claim_redemption', {
        p_redemption_id: parsed.redemptionId,
      });

      if (claimErr) {
        showToast(claimErr.message || t('admin.store.claimFailed', 'Failed to claim reward'), 'error');
        return;
      }

      showToast(`${redemption.profiles?.full_name || t('admin.store.memberFallback', 'Member')} — ${redemption.reward_name} (${redemption.points_spent} pts) ${t('admin.store.rewardClaimed', 'claimed!')}`, 'success');
    }
  };

  const totalPrice = selectedProduct ? (parseFloat(selectedProduct.price) * quantity).toFixed(2) : '0.00';
  const totalPoints = selectedProduct ? (selectedProduct.points_per_purchase ?? 0) * quantity : 0;
  const hasFilters = filterProduct !== 'all' || historyDateFrom || historyDateTo;

  // group purchase history by day (purchaseHistory is created_at desc → day order desc)
  const historyGroups = useMemo(() => {
    const byDay = new Map();
    purchaseHistory.forEach(p => {
      const d = new Date(p.created_at);
      const key = format(d, 'yyyy-MM-dd');
      if (!byDay.has(key)) byDay.set(key, { label: format(d, 'd MMM yyyy', dateFnsLocale), items: [] });
      byDay.get(key).items.push(p);
    });
    return [...byDay.values()];
  }, [purchaseHistory, dateFnsLocale]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-6" style={{ marginTop: 26, alignItems: 'start' }}>
      {/* ── LEFT · Registrar compra (POS) ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '0 0 16px' }}>
          <Ico ch={ICON.dollar} size={15} color={TK.accent} stroke={2} />
          <span style={{ ...eyebrow, color: TK.accent }}>{t('admin.store.logPurchase', 'Log Purchase')}</span>
        </div>
        <Card style={{ overflow: 'hidden', position: 'relative' }}>
          <span style={{ position: 'absolute', left: 0, top: 18, bottom: 18, width: 3.5, borderRadius: 99, background: TK.accent }} />
          <div style={{ padding: '22px 24px 24px' }}>
            {/* Scan QR */}
            <button type="button" onClick={() => setShowScanner(true)}
              style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 11, padding: '15px 0', borderRadius: 13, cursor: 'pointer', border: 'none', background: TK.accent, color: '#fff', fontFamily: FK.body, fontSize: 15.5, fontWeight: 700, boxShadow: '0 4px 14px color-mix(in srgb, var(--color-accent) 35%, transparent)' }}>
              <Ico ch={ICON.qr} size={20} color="#fff" stroke={2.1} />{t('admin.store.scanQR', 'Scan Purchase QR')}
            </button>

            {showScanner && (
              <QRScannerModal isOpen={showScanner} onClose={() => setShowScanner(false)} onScan={handleQRScan} />
            )}
            {resetApprovalId && (
              <PasswordResetApprovalModal
                requestId={resetApprovalId}
                onClose={() => setResetApprovalId(null)}
                onComplete={() => { setResetApprovalId(null); showToast(t('admin.store.resetHandled', 'Password reset handled'), 'success'); }}
              />
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
              <span style={{ flex: 1, height: 1, background: TK.divider }} />
              <span style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, color: TK.textFaint }}>{t('admin.store.orManual', 'or record manually')}</span>
              <span style={{ flex: 1, height: 1, background: TK.divider }} />
            </div>

            {/* Member */}
            <div>
              <div style={{ fontFamily: FK.body, fontSize: 12.5, fontWeight: 700, color: TK.textSub, marginBottom: 9 }}>{t('admin.store.member', 'Member')}</div>
              {selectedMember ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 12, background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
                  <Avatar name={selectedMember.full_name} size={32} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedMember.full_name}</p>
                    <p style={{ margin: 0, fontFamily: FK.body, fontSize: 11.5, color: TK.textMute }}>@{selectedMember.username}</p>
                  </div>
                  <button type="button" onClick={() => { setSelectedMember(null); setMemberSearch(''); }} aria-label={t('admin.store.removeMember', 'Remove selected member')}
                    style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', cursor: 'pointer', background: 'transparent', border: `1px solid ${TK.borderSolid}` }}>
                    <Ico ch={ICON.x} size={15} color={TK.textMute} stroke={2.2} />
                  </button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                    <Ico ch={ICON.search} size={16} color={TK.textMute} stroke={2} />
                  </span>
                  <input
                    value={memberSearch}
                    onChange={e => { setMemberSearch(e.target.value); setShowMemberDropdown(true); }}
                    onFocus={() => setShowMemberDropdown(true)}
                    placeholder={t('admin.store.searchMember', 'Search member by name...')}
                    aria-label={t('admin.store.searchMember', 'Search member by name')}
                    style={{ ...fieldStyle, paddingLeft: 42 }}
                  />
                  {showMemberDropdown && memberSearch.trim().length > 0 && members.length > 0 && (
                    <div style={{ position: 'absolute', zIndex: 30, top: 'calc(100% + 6px)', left: 0, right: 0, background: TK.surface, border: `1px solid ${TK.borderSolid}`, borderRadius: 12, boxShadow: TK.shadowLg, maxHeight: 220, overflowY: 'auto', padding: 6 }}>
                      {members.map(m => (
                        <button key={m.id} type="button" onClick={() => { setSelectedMember(m); setShowMemberDropdown(false); setMemberSearch(''); }}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 9, cursor: 'pointer', background: 'transparent', border: 'none', textAlign: 'left' }}>
                          <Avatar name={m.full_name} size={28} />
                          <div style={{ minWidth: 0 }}>
                            <p style={{ margin: 0, fontFamily: FK.body, fontSize: 13.5, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.full_name}</p>
                            <p style={{ margin: 0, fontFamily: FK.body, fontSize: 11.5, color: TK.textMute }}>@{m.username}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {showMemberDropdown && memberSearch.trim().length > 0 && !membersLoading && members.length === 0 && (
                    <div style={{ position: 'absolute', zIndex: 30, top: 'calc(100% + 6px)', left: 0, right: 0, background: TK.surface, border: `1px solid ${TK.borderSolid}`, borderRadius: 12, padding: '12px 14px', fontFamily: FK.body, fontSize: 12.5, color: TK.textMute }}>
                      {allMembers.length === 0
                        ? t('admin.store.noMembersLoaded', 'No members loaded. Check connection or refresh.')
                        : t('admin.store.noMatch', 'No member matches that search.')}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Product */}
            <div style={{ marginTop: 18 }}>
              <div style={{ fontFamily: FK.body, fontSize: 12.5, fontWeight: 700, color: TK.textSub, marginBottom: 9 }}>{t('admin.store.product', 'Product')}</div>
              {products.length === 0 ? (
                <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, margin: 0 }}>{t('admin.store.noActiveProducts', 'No active products. Create products in the Products tab first.')}</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13 }}>
                  {products.map(p => {
                    const sel = selectedProduct?.id === p.id;
                    return (
                      <button key={p.id} type="button" onClick={() => setSelectedProduct(p)}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', background: sel ? TK.accentWash : TK.surface2, border: `1.5px solid ${sel ? TK.accent : TK.borderSolid}` }}>
                        <IconChip ch={ICON.box} tone={sel ? 'accent' : 'neutral'} size={36} r={10} strokeW={1.9} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: FK.body, fontSize: 14, fontWeight: 700, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                          <div style={{ fontFamily: FK.display, fontSize: 15, fontWeight: 800, color: sel ? TK.accent : TK.textSub, marginTop: 2 }}>${parseFloat(p.price).toFixed(2)}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Quantity */}
            {selectedProduct && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontFamily: FK.body, fontSize: 12.5, fontWeight: 700, color: TK.textSub, marginBottom: 9 }}>{t('admin.store.quantity', 'Quantity')}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button type="button" onClick={() => setQuantity(q => Math.max(1, q - 1))} aria-label={t('admin.store.decreaseQuantity', 'Decrease quantity')}
                    style={{ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', cursor: 'pointer', background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
                    <Ico ch={ICON.minus} size={16} color={TK.textSub} stroke={2.2} />
                  </button>
                  <span style={{ fontFamily: FK.display, fontSize: 20, fontWeight: 800, color: TK.text, width: 44, textAlign: 'center' }}>{quantity}</span>
                  <button type="button" onClick={() => setQuantity(q => Math.min(1000, q + 1))} disabled={quantity >= 1000} aria-label={t('admin.store.increaseQuantity', 'Increase quantity')}
                    style={{ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', cursor: quantity >= 1000 ? 'default' : 'pointer', background: TK.surface2, border: `1px solid ${TK.borderSolid}`, opacity: quantity >= 1000 ? 0.4 : 1 }}>
                    <Ico ch={ICON.plus} size={16} color={TK.textSub} stroke={2.2} />
                  </button>
                </div>
              </div>
            )}

            {/* Summary */}
            {selectedProduct && selectedMember && (
              <div style={{ marginTop: 18, borderRadius: 12, background: TK.surface2, border: `1px solid ${TK.borderSolid}`, padding: '14px 16px' }}>
                <p style={{ margin: '0 0 8px', ...eyebrow, fontSize: 11 }}>{t('admin.store.summary', 'Purchase Summary')}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: FK.body, fontSize: 13.5, marginBottom: 6 }}>
                  <span style={{ color: TK.textMute }}>{t('admin.store.totalPrice', 'Total Price')}</span>
                  <span style={{ color: TK.text, fontWeight: 700 }}>${totalPrice}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: FK.body, fontSize: 13.5 }}>
                  <span style={{ color: TK.textMute }}>{t('admin.store.pointsEarned', 'Points Earned')}</span>
                  <span style={{ color: TK.accent, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Ico ch={ICON.star} size={13} color={TK.accent} stroke={2} /> +{totalPoints}
                  </span>
                </div>
                {selectedProduct.punch_card_enabled && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontFamily: FK.body, fontSize: 13 }}>
                    <span style={{ color: TK.textMute }}>{t('admin.store.punchCard', 'Punch Card')}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 3 }}>
                        {Array.from({ length: selectedProduct.punch_card_target }).map((_, i) => (
                          <span key={i} style={{ width: 10, height: 10, borderRadius: 99, background: i < ((punchCount % selectedProduct.punch_card_target) + quantity) ? TK.accent : TK.surface3 }} />
                        ))}
                      </div>
                      <span style={{ fontFamily: FK.mono, fontSize: 11, color: TK.textMute }}>
                        {Math.min((punchCount % selectedProduct.punch_card_target) + quantity, selectedProduct.punch_card_target)}/{selectedProduct.punch_card_target}
                      </span>
                    </div>
                  </div>
                )}
                {selectedProduct.punch_card_enabled && (punchCount % selectedProduct.punch_card_target) + quantity >= selectedProduct.punch_card_target && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '9px 12px', borderRadius: 11, background: 'var(--color-success-soft)', border: '1px solid color-mix(in srgb, var(--color-success) 32%, transparent)' }}>
                    <Ico ch={ICON.gift} size={16} color="var(--color-success)" stroke={2} />
                    <span style={{ fontFamily: FK.body, fontSize: 12.5, fontWeight: 600, color: 'var(--color-success-ink, var(--color-success))' }}>{t('admin.store.freeItemWillBeEarned', 'Free item will be earned with this purchase!')}</span>
                  </div>
                )}
              </div>
            )}

            {/* Record */}
            <button type="button" onClick={() => recordMutation.mutate()} disabled={!selectedMember || !selectedProduct || recordMutation.isPending}
              style={{ width: '100%', marginTop: 20, padding: '14px 0', borderRadius: 13, cursor: (!selectedMember || !selectedProduct) ? 'default' : 'pointer', border: 'none', background: TK.accent, color: '#fff', fontFamily: FK.body, fontSize: 15, fontWeight: 700, boxShadow: '0 4px 14px color-mix(in srgb, var(--color-accent) 35%, transparent)', opacity: (!selectedMember || !selectedProduct || recordMutation.isPending) ? 0.45 : 1 }}>
              {recordMutation.isPending ? t('admin.store.recording', 'Recording...') : t('admin.store.recordPurchase', 'Record Purchase')}
            </button>
          </div>
        </Card>
      </div>

      {/* ── RIGHT · Compras recientes ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '0 0 16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Ico ch={ICON.clock} size={15} color={TK.textFaint} stroke={2} />
            <span style={eyebrow}>{t('admin.store.recentPurchases', 'Recent purchases')}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)} style={smallSelect}>
              <option value="all">{t('admin.store.allProducts', 'All Products')}</option>
              {allProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input type="date" value={historyDateFrom} onChange={e => setHistoryDateFrom(e.target.value)} aria-label={t('admin.store.from', 'From')} style={smallSelect} />
            <input type="date" value={historyDateTo} onChange={e => setHistoryDateTo(e.target.value)} aria-label={t('admin.store.to', 'To')} style={smallSelect} />
            {hasFilters && (
              <button type="button" onClick={() => { setFilterProduct('all'); setHistoryDateFrom(''); setHistoryDateTo(''); }}
                style={{ padding: '8px 12px', borderRadius: 10, cursor: 'pointer', background: TK.surface2, border: `1px solid ${TK.borderSolid}`, fontFamily: FK.body, fontSize: 12.5, fontWeight: 600, color: TK.textSub }}>
                {t('admin.store.clear', 'Clear')}
              </button>
            )}
          </div>
        </div>

        {historyLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2, 3].map(i => <CardSkeleton key={i} h="h-[56px]" />)}
          </div>
        ) : purchaseHistory.length === 0 ? (
          <Card style={{ textAlign: 'center', padding: '48px 0' }}>
            <Ico ch={ICON.bag} size={28} color={TK.textMute} stroke={1.6} style={{ margin: '0 auto 8px' }} />
            <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, margin: 0 }}>{t('admin.store.noPurchases', 'No purchases found')}</p>
          </Card>
        ) : (
          <Card style={{ overflow: 'hidden' }}>
            {historyGroups.map((g, gi) => (
              <div key={gi}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', background: TK.surface2, borderTop: gi > 0 ? `1px solid ${TK.divider}` : 'none' }}>
                  <Ico ch={ICON.cal} size={13} color={TK.textMute} stroke={2} />
                  <span style={{ fontFamily: FK.mono, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, color: TK.textMute }}>{g.label}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 600, color: TK.textFaint }}>
                    {g.items.length === 1 ? t('admin.store.onePurchase', '1 purchase') : t('admin.store.manyPurchases', '{{count}} purchases', { count: g.items.length })}
                  </span>
                </div>
                {g.items.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderTop: `1px solid ${TK.divider}` }}>
                    <Avatar name={p.profiles?.full_name} size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: FK.body, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <b style={{ fontWeight: 700, color: TK.text }}>{p.profiles?.full_name ?? t('admin.store.unknown', 'Unknown')}</b>
                        <span style={{ color: TK.textMute }}> · </span>
                        <span style={{ color: TK.textSub }}>{p.quantity > 1 ? `${p.quantity}× ` : ''}{p.gym_products?.name ?? t('admin.store.unknown', 'Unknown')}</span>
                        {p.is_free_reward && (
                          <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: 'var(--color-success-soft)', border: '1px solid color-mix(in srgb, var(--color-success) 32%, transparent)', fontFamily: FK.body, fontSize: 10, fontWeight: 800, color: 'var(--color-success-ink, var(--color-success))', verticalAlign: 'middle' }}>
                            <Ico ch={ICON.gift} size={10} color="var(--color-success)" stroke={2} />{t('admin.store.freeReward', 'FREE')}
                          </span>
                        )}
                      </div>
                      <span style={{ fontFamily: FK.mono, fontSize: 11.5, color: TK.textFaint }}>{format(new Date(p.created_at), 'h:mm a', dateFnsLocale)}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, whiteSpace: 'nowrap' }}>
                      <span style={{ fontFamily: FK.display, fontSize: 15, fontWeight: 800, color: TK.text }}>${parseFloat(p.total_price || 0).toFixed(2)}</span>
                      {p.points_earned > 0 && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 999, background: TK.accentSoft, border: `1px solid ${TK.accentLine}`, fontFamily: FK.mono, fontSize: 11, fontWeight: 700, color: TK.accentInk }}>
                          <Ico ch={ICON.star} size={10} color={TK.accent} stroke={2} />+{p.points_earned}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
