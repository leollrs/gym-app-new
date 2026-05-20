import { useState, useMemo } from 'react';
import {
  DollarSign, ScanLine, Search, X, Package, Minus, Plus, Star,
  Gift, Clock, ShoppingBag,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { AdminCard, FadeIn, SectionLabel, CardSkeleton } from '../../../components/admin';
import QRScannerModal from '../../../components/admin/QRScannerModal';
import PasswordResetApprovalModal from './PasswordResetApprovalModal';
import { storeKeys } from './storeConstants';

/**
 * "Log Purchase" tab on AdminStore — the staff-facing checkout surface.
 *
 * Two halves:
 *   1. Log Purchase form: pick a member (search or QR scan), pick a
 *      product, choose quantity. Punch-card progress dots render in
 *      real time; if this purchase tips the card into reward territory
 *      we surface a "Free item will be earned" banner.
 *   2. Purchase History list: filter by product / date range, paginate
 *      at 100 most recent rows.
 *
 * QR scan accepts four types:
 *   - `purchase`: prefills member + product from the scanned payload
 *   - `password_reset`: routes to the PasswordResetApprovalModal
 *   - `checkin`: prefills the member only (admin then picks product)
 *   - `reward_redemption`: marks the redemption claimed + deducts points
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
      const { count } = await supabase
        .from('member_purchases')
        .select('id', { count: 'exact', head: true })
        .eq('member_id', selectedMember.id)
        .eq('product_id', selectedProduct.id)
        .eq('is_free_reward', false);
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: storeKeys.all(gymId) });
      const totalPoints = (selectedProduct.points_per_purchase ?? 0) * quantity;
      let msg = t('admin.store.purchaseRecorded', 'Purchase recorded! {{points}} points earned.', { points: totalPoints });
      if (data?.free_reward_earned) {
        msg += ` ${t('admin.store.freeItemEarned', 'Free {{name}} earned!', { name: selectedProduct.name })}`;
      }
      showToast(msg, 'success');

      // Trigger wallet pass push update if punch card product
      if (selectedProduct.punch_card_enabled && selectedMember) {
        supabase.functions.invoke('push-wallet-update', {
          body: { profileId: selectedMember.id, reason: 'punch_card_update' },
        }).catch(() => {});
      }

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

      // Mark as claimed and deduct points
      const { error: claimErr } = await supabase
        .from('reward_redemptions')
        .update({ status: 'claimed', claimed_at: new Date().toISOString() })
        .eq('id', parsed.redemptionId);

      if (claimErr) {
        showToast(claimErr.message || t('admin.store.claimFailed', 'Failed to claim reward'), 'error');
        return;
      }

      // Deduct points from total (they were "held" while pending, now actually spent)
      const { data: currentPts } = await supabase
        .from('reward_points')
        .select('total_points')
        .eq('profile_id', redemption.profile_id)
        .single();
      if (currentPts) {
        await supabase
          .from('reward_points')
          .update({ total_points: Math.max(0, (currentPts.total_points || 0) - redemption.points_spent) })
          .eq('profile_id', redemption.profile_id);
      }

      showToast(`${redemption.profiles?.full_name || t('admin.store.memberFallback', 'Member')} — ${redemption.reward_name} (${redemption.points_spent} pts) ${t('admin.store.rewardClaimed', 'claimed!')}`, 'success');
    }
  };

  const totalPrice = selectedProduct ? (parseFloat(selectedProduct.price) * quantity).toFixed(2) : '0.00';
  const totalPoints = selectedProduct ? (selectedProduct.points_per_purchase ?? 0) * quantity : 0;

  return (
    <div className="space-y-6">
      {/* ── Log Purchase section ── */}
      <FadeIn>
        <AdminCard borderLeft="var(--color-accent)">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign size={14} className="text-[#D4AF37]" />
            <SectionLabel>{t('admin.store.logPurchase', 'Log Purchase')}</SectionLabel>
          </div>

          <div className="max-w-lg space-y-4">
            {/* Scan QR */}
            <button
              onClick={() => setShowScanner(true)}
              className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl font-bold text-[13px] text-black bg-[#D4AF37] hover:bg-[#C5A028] active:scale-[0.98] transition-all"
            >
              <ScanLine size={16} />
              {t('admin.store.scanQR', 'Scan Purchase QR')}
            </button>

            {showScanner && (
              <QRScannerModal
                isOpen={showScanner}
                onClose={() => setShowScanner(false)}
                onScan={handleQRScan}
              />
            )}
            {resetApprovalId && (
              <PasswordResetApprovalModal
                requestId={resetApprovalId}
                onClose={() => setResetApprovalId(null)}
                onComplete={() => {
                  setResetApprovalId(null);
                  showToast(t('admin.store.resetHandled', 'Password reset handled'), 'success');
                }}
              />
            )}

            {/* Member search */}
            <div className="relative">
              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.store.member', 'Member')}</label>
              {selectedMember ? (
                <div className="flex items-center gap-3 bg-white/[0.04] border border-white/8 rounded-xl px-4 py-2.5">
                  <div className="w-8 h-8 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                    <span className="text-[11px] font-bold text-[#D4AF37]">
                      {selectedMember.full_name?.[0]?.toUpperCase() ?? '?'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{selectedMember.full_name}</p>
                    <p className="text-[11px] text-[#6B7280] truncate">@{selectedMember.username}</p>
                  </div>
                  <button onClick={() => { setSelectedMember(null); setMemberSearch(''); }} aria-label={t('admin.store.removeMember', 'Remove selected member')} className="text-[#6B7280] hover:text-red-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
                  <input
                    value={memberSearch}
                    onChange={e => { setMemberSearch(e.target.value); setShowMemberDropdown(true); }}
                    onFocus={() => setShowMemberDropdown(true)}
                    placeholder={t('admin.store.searchMember', 'Search member by name...')}
                    aria-label={t('admin.store.searchMember', 'Search member by name')}
                    className="w-full bg-white/[0.04] border border-white/8 rounded-xl pl-9 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 focus:ring-1 focus:ring-[#D4AF37]/30 transition-all"
                  />
                  {showMemberDropdown && memberSearch.trim().length > 0 && members.length > 0 && (
                    <div className="absolute z-30 top-full left-0 right-0 mt-1 w-full bg-[#0F172A] border border-white/8 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
                      {members.map(m => (
                        <button
                          key={m.id}
                          onClick={() => { setSelectedMember(m); setShowMemberDropdown(false); setMemberSearch(''); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition-colors text-left"
                        >
                          <div className="w-7 h-7 rounded-full bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] font-bold text-[#D4AF37]">{m.full_name?.[0]?.toUpperCase() ?? '?'}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[13px] text-[#E5E7EB] truncate">{m.full_name}</p>
                            <p className="text-[11px] text-[#6B7280] truncate">@{m.username}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {showMemberDropdown && memberSearch.trim().length > 0 && !membersLoading && members.length === 0 && (
                    <div className="absolute z-30 top-full left-0 right-0 mt-1 w-full rounded-xl border border-white/8 bg-[#0F172A] px-4 py-3 text-[12px] text-[#6B7280]">
                      {allMembers.length === 0
                        ? t('admin.store.noMembersLoaded', 'No members loaded. Check connection or refresh.')
                        : t('admin.store.noMatch', 'No member matches that search.')}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Product Selection */}
            <div>
              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2">{t('admin.store.product', 'Product')}</label>
              {products.length === 0 ? (
                <p className="text-[13px] text-[#6B7280]">{t('admin.store.noActiveProducts', 'No active products. Create products in the Products tab first.')}</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {products.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProduct(p)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all ${
                        selectedProduct?.id === p.id
                          ? 'bg-[#D4AF37]/10 border border-[#D4AF37]/30 ring-1 ring-[#D4AF37]/20'
                          : 'bg-white/[0.03] border border-white/6 hover:border-white/12'
                      }`}
                    >
                      <Package size={18} className="text-[#6B7280]" />
                      <div className="min-w-0 flex-1">
                        <p className={`text-[12px] font-medium truncate ${selectedProduct?.id === p.id ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                          {p.name}
                        </p>
                        <p className="text-[11px] text-[#6B7280]">${parseFloat(p.price).toFixed(2)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quantity */}
            {selectedProduct && (
              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2">{t('admin.store.quantity', 'Quantity')}</label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setQuantity(q => Math.max(1, q - 1))}
                    aria-label={t('admin.store.decreaseQuantity', 'Decrease quantity')}
                    className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/6 flex items-center justify-center text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/12 transition-colors"
                  >
                    <Minus size={16} />
                  </button>
                  <span className="text-[20px] font-bold text-[#E5E7EB] w-12 text-center tabular-nums">{quantity}</span>
                  <button
                    onClick={() => setQuantity(q => Math.min(1000, q + 1))}
                    disabled={quantity >= 1000}
                    aria-label={t('admin.store.increaseQuantity', 'Increase quantity')}
                    className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/6 flex items-center justify-center text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/12 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* Summary */}
            {selectedProduct && selectedMember && (
              <div className="bg-white/[0.02] border border-white/6 rounded-xl p-4 space-y-2">
                <p className="text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wide">{t('admin.store.summary', 'Purchase Summary')}</p>
                <div className="flex justify-between text-[13px]">
                  <span className="text-[#9CA3AF]">{t('admin.store.totalPrice', 'Total Price')}</span>
                  <span className="text-[#E5E7EB] font-semibold">${totalPrice}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-[#9CA3AF]">{t('admin.store.pointsEarned', 'Points Earned')}</span>
                  <span className="text-[#D4AF37] font-semibold flex items-center gap-1">
                    <Star size={12} /> +{totalPoints}
                  </span>
                </div>
                {selectedProduct.punch_card_enabled && (
                  <div className="flex justify-between text-[13px] items-center">
                    <span className="text-[#9CA3AF]">{t('admin.store.punchCard', 'Punch Card')}</span>
                    <div className="flex items-center gap-2">
                      <div className="flex gap-0.5">
                        {Array.from({ length: selectedProduct.punch_card_target }).map((_, i) => (
                          <div
                            key={i}
                            className={`w-2.5 h-2.5 rounded-full ${
                              i < ((punchCount % selectedProduct.punch_card_target) + quantity)
                                ? 'bg-[#D4AF37]'
                                : 'bg-white/10'
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-[11px] text-[#6B7280]">
                        {Math.min((punchCount % selectedProduct.punch_card_target) + quantity, selectedProduct.punch_card_target)}/{selectedProduct.punch_card_target}
                      </span>
                    </div>
                  </div>
                )}
                {selectedProduct.punch_card_enabled &&
                  (punchCount % selectedProduct.punch_card_target) + quantity >= selectedProduct.punch_card_target && (
                  <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2 mt-1">
                    <Gift size={16} className="text-emerald-400 flex-shrink-0" />
                    <p className="text-[12px] text-emerald-400 font-medium">{t('admin.store.freeItemWillBeEarned', 'Free item will be earned with this purchase!')}</p>
                  </div>
                )}
              </div>
            )}

            {/* Record Button */}
            <button
              onClick={() => recordMutation.mutate()}
              disabled={!selectedMember || !selectedProduct || recordMutation.isPending}
              className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#C5A028] transition-colors"
            >
              {recordMutation.isPending ? t('admin.store.recording', 'Recording...') : t('admin.store.recordPurchase', 'Record Purchase')}
            </button>
          </div>
        </AdminCard>
      </FadeIn>

      {/* ── Purchase History section ── */}
      <FadeIn delay={0.1}>
        <div className="flex items-center gap-2 mb-3">
          <Clock size={14} className="text-[#D4AF37]" />
          <SectionLabel>{t('admin.store.purchaseHistory', 'Purchase History')}</SectionLabel>
        </div>

        {/* Filters */}
        <AdminCard padding="p-3" className="mb-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.store.product', 'Product')}</label>
              <select
                value={filterProduct}
                onChange={e => setFilterProduct(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/8 rounded-xl px-3 py-2 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-1 focus:ring-[#D4AF37]/30"
              >
                <option value="all">{t('admin.store.allProducts', 'All Products')}</option>
                {allProducts.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="min-w-[130px]">
              <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.store.from', 'From')}</label>
              <input
                type="date"
                value={historyDateFrom}
                onChange={e => setHistoryDateFrom(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/8 rounded-xl px-3 py-2 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-1 focus:ring-[#D4AF37]/30"
              />
            </div>
            <div className="min-w-[130px]">
              <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.store.to', 'To')}</label>
              <input
                type="date"
                value={historyDateTo}
                onChange={e => setHistoryDateTo(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/8 rounded-xl px-3 py-2 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-1 focus:ring-[#D4AF37]/30"
              />
            </div>
            {(filterProduct !== 'all' || historyDateFrom || historyDateTo) && (
              <button
                onClick={() => { setFilterProduct('all'); setHistoryDateFrom(''); setHistoryDateTo(''); }}
                className="px-3 py-2 rounded-xl text-[12px] font-medium text-[#9CA3AF] bg-white/5 hover:bg-white/8 transition-colors"
              >
                {t('admin.store.clear', 'Clear')}
              </button>
            )}
          </div>
        </AdminCard>

        {/* Purchase List */}
        {historyLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map(i => <CardSkeleton key={i} h="h-[60px]" />)}
          </div>
        ) : purchaseHistory.length === 0 ? (
          <AdminCard>
            <div className="text-center py-12">
              <ShoppingBag size={28} className="text-[#6B7280]/40 mx-auto mb-2" />
              <p className="text-[13px] text-[#6B7280]">{t('admin.store.noPurchases', 'No purchases found')}</p>
            </div>
          </AdminCard>
        ) : (
          <div className="space-y-2">
            {purchaseHistory.map((p, idx) => (
              <FadeIn key={p.id} delay={idx * 30}>
                <AdminCard padding="p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/6 flex items-center justify-center flex-shrink-0">
                      <Package size={18} className="text-[#6B7280]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[13px] font-medium text-[#E5E7EB] truncate">
                          {p.profiles?.full_name ?? t('admin.store.unknown', 'Unknown')}
                        </p>
                        <span className="text-[11px] text-[#6B7280]">{t('admin.store.bought', 'bought')}</span>
                        <p className="text-[13px] font-medium text-[#E5E7EB] truncate">
                          {p.quantity > 1 ? `${p.quantity}x ` : ''}{p.gym_products?.name ?? t('admin.store.unknown', 'Unknown')}
                        </p>
                        {p.is_free_reward && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-emerald-400 bg-emerald-500/10 flex items-center gap-0.5">
                            <Gift size={10} /> {t('admin.store.freeReward', 'FREE')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-[#6B7280]">
                        <span>${parseFloat(p.total_price || 0).toFixed(2)}</span>
                        {p.points_earned > 0 && (
                          <span className="text-[#D4AF37] flex items-center gap-0.5">
                            <Star size={10} /> +{p.points_earned}
                          </span>
                        )}
                        <span>{format(new Date(p.created_at), 'MMM d, h:mm a', dateFnsLocale)}</span>
                      </div>
                    </div>
                  </div>
                </AdminCard>
              </FadeIn>
            ))}
          </div>
        )}
      </FadeIn>
    </div>
  );
}
