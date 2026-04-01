import { useEffect, useState, useMemo } from 'react';
import {
  Plus, ShoppingBag, Pencil, Trash2, Search, Package, Gift,
  Hash, DollarSign, Star, ToggleLeft, ToggleRight, Minus, Clock,
  Filter, ChevronDown, X, ScanLine,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { format } from 'date-fns';
import { PageHeader, AdminCard, AdminModal, FadeIn, CardSkeleton, SectionLabel } from '../../components/admin';
import QRScannerModal from '../../components/admin/QRScannerModal';
import PasswordResetApprovalModal from './components/PasswordResetApprovalModal';

// ── Constants ──────────────────────────────────────────────
const CATEGORY_OPTS = [
  { value: 'supplement', label: 'Supplement', color: 'text-blue-400 bg-blue-500/10' },
  { value: 'drink', label: 'Drink', color: 'text-cyan-400 bg-cyan-500/10' },
  { value: 'snack', label: 'Snack', color: 'text-amber-400 bg-amber-500/10' },
  { value: 'merchandise', label: 'Merch', color: 'text-purple-400 bg-purple-500/10' },
  { value: 'service', label: 'Service', color: 'text-emerald-400 bg-emerald-500/10' },
  { value: 'other', label: 'Other', color: 'text-[#9CA3AF] bg-white/6' },
];

const TABS = [
  { key: 'products', label: 'Products', icon: Package },
  { key: 'purchase', label: 'Log Purchase', icon: DollarSign },
  { key: 'history', label: 'History', icon: Clock },
];

const storeKeys = {
  products: (gymId) => ['admin', 'store', gymId, 'products'],
  purchases: (gymId, filters) => ['admin', 'store', gymId, 'purchases', filters],
  members: (gymId) => ['admin', 'store', gymId, 'members'],
};

const categoryStyle = (cat) =>
  CATEGORY_OPTS.find(c => c.value === cat)?.color ?? 'text-[#9CA3AF] bg-white/6';

const categoryLabel = (cat) =>
  CATEGORY_OPTS.find(c => c.value === cat)?.label ?? cat;

// ── Product Modal ──────────────────────────────────────────
const ProductModal = ({ isOpen, onClose, gymId, product }) => {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!product;

  const [form, setForm] = useState({
    name: '',
    category: 'supplement',
    price: '',
    emoji_icon: '',
    points_per_purchase: '10',
    punch_card_enabled: false,
    punch_card_target: '10',
  });

  useEffect(() => {
    if (product) {
      setForm({
        name: product.name || '',
        category: product.category || 'supplement',
        price: product.price?.toString() || '',
        emoji_icon: product.emoji_icon || '',
        points_per_purchase: product.points_per_purchase?.toString() || '10',
        punch_card_enabled: product.punch_card_enabled || false,
        punch_card_target: product.punch_card_target?.toString() || '10',
      });
    } else {
      setForm({
        name: '', category: 'supplement', price: '', emoji_icon: '',
        points_per_purchase: '10', punch_card_enabled: false, punch_card_target: '10',
      });
    }
  }, [product, isOpen]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Product name is required.');
      if (!form.price || parseFloat(form.price) < 0) throw new Error('Valid price is required.');

      const payload = {
        gym_id: gymId,
        name: form.name.trim(),
        category: form.category,
        price: parseFloat(form.price),
        emoji_icon: form.emoji_icon || null,
        points_per_purchase: parseInt(form.points_per_purchase) || 0,
        punch_card_enabled: form.punch_card_enabled,
        punch_card_target: form.punch_card_enabled ? parseInt(form.punch_card_target) || 10 : null,
      };

      if (isEdit) {
        const { error } = await supabase.from('gym_products').update(payload).eq('id', product.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('gym_products').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storeKeys.products(gymId) });
      showToast(isEdit ? 'Product updated' : 'Product created', 'success');
      onClose();
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Product' : 'New Product'}
      titleIcon={Package}
      footer={
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] disabled:opacity-50"
        >
          {saveMutation.isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Product'}
        </button>
      }
    >
      <div className="space-y-4">
        {/* Name + Emoji */}
        <div className="flex gap-3">
          <div className="w-20">
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Emoji</label>
            <input
              value={form.emoji_icon}
              onChange={e => set('emoji_icon', e.target.value)}
              placeholder="🥤"
              maxLength={4}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-center text-[20px] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Product Name</label>
            <input
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Protein Shake"
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            />
          </div>
        </div>

        {/* Category */}
        <div>
          <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Category</label>
          <div className="flex gap-2 flex-wrap">
            {CATEGORY_OPTS.map(c => (
              <button
                key={c.value}
                onClick={() => set('category', c.value)}
                className={`flex-1 min-w-[70px] py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                  form.category === c.value ? c.color : 'bg-[#111827] border border-white/6 text-[#9CA3AF]'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Price + Points */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Price ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.price}
              onChange={e => set('price', e.target.value)}
              placeholder="0.00"
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Points / Purchase</label>
            <input
              type="number"
              min="0"
              value={form.points_per_purchase}
              onChange={e => set('points_per_purchase', e.target.value)}
              placeholder="10"
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            />
          </div>
        </div>

        {/* Punch Card Toggle */}
        <div>
          <button
            onClick={() => set('punch_card_enabled', !form.punch_card_enabled)}
            className="flex items-center gap-2.5 w-full"
          >
            {form.punch_card_enabled ? (
              <ToggleRight size={28} className="text-[#D4AF37] flex-shrink-0" />
            ) : (
              <ToggleLeft size={28} className="text-[#6B7280] flex-shrink-0" />
            )}
            <div className="text-left">
              <p className="text-[13px] font-medium text-[#E5E7EB]">Punch Card</p>
              <p className="text-[11px] text-[#6B7280]">Free item after X purchases</p>
            </div>
          </button>

          {form.punch_card_enabled && (
            <div className="mt-3 ml-10">
              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Purchases needed for free item</label>
              <input
                type="number"
                min="2"
                value={form.punch_card_target}
                onChange={e => set('punch_card_target', e.target.value)}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              />
            </div>
          )}
        </div>
      </div>
    </AdminModal>
  );
};

// ── Products Tab ───────────────────────────────────────────
const ProductsTab = ({ gymId }) => {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const { data: products = [], isLoading } = useQuery({
    queryKey: storeKeys.products(gymId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_products')
        .select('*')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }) => {
      const { error } = await supabase.from('gym_products').update({ is_active: !is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storeKeys.products(gymId) });
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('gym_products').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storeKeys.products(gymId) });
      setConfirmDeleteId(null);
      showToast('Product deleted', 'success');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const openEdit = (p) => {
    setEditProduct(p);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditProduct(null);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map(i => <CardSkeleton key={i} h="h-[100px]" />)}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <SectionLabel>{products.length} Product{products.length !== 1 ? 's' : ''}</SectionLabel>
        <button
          onClick={() => { setEditProduct(null); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#D4AF37] text-black font-bold text-[14px] rounded-xl hover:bg-[#C4A030] transition-colors whitespace-nowrap flex-shrink-0"
        >
          <Plus size={15} /> Add Product
        </button>
      </div>

      {products.length === 0 ? (
        <div className="text-center py-20">
          <Package size={32} className="text-[#6B7280] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">No products yet. Add your first product above.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {products.map((p, idx) => (
            <FadeIn key={p.id} delay={idx * 40}>
              <AdminCard hover>
                <div className="flex items-start gap-3">
                  {/* Emoji */}
                  <div className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/6 flex items-center justify-center flex-shrink-0 text-[22px]">
                    {p.emoji_icon || '📦'}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className={`text-[14px] font-semibold truncate ${p.is_active !== false ? 'text-[#E5E7EB]' : 'text-[#6B7280] line-through'}`}>
                        {p.name}
                      </p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${categoryStyle(p.category)}`}>
                        {categoryLabel(p.category)}
                      </span>
                      {p.is_active === false && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-red-400 bg-red-500/10">
                          Inactive
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-[12px] text-[#9CA3AF]">
                      <span className="font-semibold text-[#E5E7EB]">${parseFloat(p.price).toFixed(2)}</span>
                      <span className="flex items-center gap-1">
                        <Star size={11} className="text-[#D4AF37]" />
                        {p.points_per_purchase ?? 0} pts
                      </span>
                      {p.punch_card_enabled && (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <Gift size={11} />
                          1 free / {p.punch_card_target}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {confirmDeleteId === p.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-[#9CA3AF]">Delete?</span>
                        <button
                          onClick={() => deleteMutation.mutate(p.id)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/5 text-[#9CA3AF] hover:bg-white/10 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => toggleMutation.mutate({ id: p.id, is_active: p.is_active !== false })}
                          className={`p-1 transition-colors ${
                            p.is_active !== false ? 'text-emerald-400 hover:text-emerald-300' : 'text-[#6B7280] hover:text-[#9CA3AF]'
                          }`}
                          title={p.is_active !== false ? 'Deactivate' : 'Activate'}
                          aria-label={p.is_active !== false ? 'Deactivate product' : 'Activate product'}
                        >
                          {p.is_active !== false ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                        </button>
                        <button onClick={() => openEdit(p)} aria-label="Edit product" className="text-[#6B7280] hover:text-[#D4AF37] transition-colors p-1 min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => setConfirmDeleteId(p.id)} aria-label="Delete product" className="text-[#6B7280] hover:text-red-400 transition-colors p-1 min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </AdminCard>
            </FadeIn>
          ))}
        </div>
      )}

      {showModal && (
        <ProductModal isOpen={showModal} onClose={closeModal} gymId={gymId} product={editProduct} />
      )}
    </>
  );
};

// ── Log Purchase Tab ───────────────────────────────────────
const LogPurchaseTab = ({ gymId }) => {
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

  // Load all gym members — include all non-admin roles so trainers can also purchase
  const { data: allMembers = [], isLoading: membersLoading, error: membersError } = useQuery({
    queryKey: storeKeys.members(gymId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url, role')
        .eq('gym_id', gymId)
        .in('role', ['member', 'trainer'])
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
  const { data: punchProgress } = useQuery({
    queryKey: ['admin', 'store', gymId, 'punch', selectedMember?.id, selectedProduct?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('member_purchases')
        .select('id', { count: 'exact', head: true })
        .eq('member_id', selectedMember.id)
        .eq('product_id', selectedProduct.id)
        .eq('is_free_reward', false);
      return data;
    },
    enabled: !!selectedMember && !!selectedProduct?.punch_card_enabled,
    select: (_, { count } = {}) => count ?? 0,
  });

  // Get actual count for punch card
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

  const recordMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMember || !selectedProduct) throw new Error('Select a member and product.');

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
      queryClient.invalidateQueries({ queryKey: ['admin', 'store', gymId] });
      const totalPoints = (selectedProduct.points_per_purchase ?? 0) * quantity;
      let msg = `Purchase recorded! ${totalPoints} points earned.`;
      if (data?.free_reward_earned) {
        msg += ` Free ${selectedProduct.name} earned!`;
      }
      showToast(msg, 'success');

      // Trigger wallet pass push update if punch card product
      if (selectedProduct.punch_card_enabled && selectedMember) {
        supabase.functions.invoke('push-wallet-update', {
          body: { profileId: selectedMember.id, reason: 'punch_card_update' },
        }).catch(() => {}); // Fire and forget
      }

      setSelectedMember(null);
      setSelectedProduct(null);
      setQuantity(1);
      setMemberSearch('');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  // ── QR Scan handler ──
  const handleQRScan = async (parsed) => {
    setShowScanner(false);

    if (parsed.type === 'purchase') {
      // Validate gym
      if (parsed.gymId !== gymId) {
        showToast('QR code is for a different gym', 'error');
        return;
      }

      // Look up member
      const { data: memberData } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .eq('id', parsed.memberId)
        .eq('gym_id', gymId)
        .single();

      if (!memberData) {
        showToast('Member not found', 'error');
        return;
      }
      setSelectedMember(memberData);
      setMemberSearch('');

      // Find product in already-fetched list
      const product = products.find(p => p.id === parsed.productId);
      if (!product) {
        showToast('Product not found or inactive', 'error');
        return;
      }
      setSelectedProduct(product);
      setQuantity(1);
      showToast(`${memberData.full_name} — ${product.name}`, 'success');
    } else if (parsed.type === 'password_reset') {
      // Password reset QR — open approval modal
      setResetApprovalId(parsed.request_id);
    } else if (parsed.type === 'checkin') {
      // Plain check-in QR — look up member by qr_code_payload
      const { data: memberData } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .eq('qr_code_payload', parsed.qrPayload)
        .eq('gym_id', gymId)
        .single();

      if (!memberData) {
        showToast('Member not found for this QR code', 'error');
        return;
      }
      setSelectedMember(memberData);
      setMemberSearch('');
      showToast(`Member: ${memberData.full_name} — select a product`, 'info');
    }
  };

  const totalPrice = selectedProduct ? (parseFloat(selectedProduct.price) * quantity).toFixed(2) : '0.00';
  const totalPoints = selectedProduct ? (selectedProduct.points_per_purchase ?? 0) * quantity : 0;

  return (
    <div className="max-w-lg mx-auto space-y-5">
      {/* Scan QR button */}
      <button
        onClick={() => setShowScanner(true)}
        className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] hover:bg-[#C4A030] active:scale-[0.98] transition-all whitespace-nowrap"
      >
        <ScanLine size={18} />
        Scan Purchase QR
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
            showToast('Password reset handled', 'success');
          }}
        />
      )}
      <AdminCard clipContent={false} className="relative z-10">
        <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Member</label>
        {selectedMember ? (
          <div className="flex items-center gap-3 bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5">
            <div className="w-8 h-8 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
              <span className="text-[11px] font-bold text-[#D4AF37]">
                {selectedMember.full_name?.[0]?.toUpperCase() ?? '?'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{selectedMember.full_name}</p>
              <p className="text-[11px] text-[#6B7280] truncate">@{selectedMember.username}</p>
            </div>
            <button onClick={() => { setSelectedMember(null); setMemberSearch(''); }} aria-label="Remove selected member" className="text-[#6B7280] hover:text-red-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
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
              placeholder="Search member by name..."
              className="w-full bg-[#111827] border border-white/6 rounded-xl pl-9 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
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
                  ? 'No members loaded for this gym. Check your connection or try refreshing.'
                  : 'No member matches that search.'}
              </div>
            )}
          </div>
        )}
      </AdminCard>

      {/* Product Selection */}
      <AdminCard>
        <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2">Product</label>
        {products.length === 0 ? (
          <p className="text-[13px] text-[#6B7280]">No active products. Create products in the Products tab first.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {products.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedProduct(p)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all ${
                  selectedProduct?.id === p.id
                    ? 'bg-[#D4AF37]/10 border border-[#D4AF37]/30 ring-1 ring-[#D4AF37]/20'
                    : 'bg-[#111827] border border-white/6 hover:border-white/12'
                }`}
              >
                <span className="text-[18px]">{p.emoji_icon || '📦'}</span>
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
      </AdminCard>

      {/* Quantity */}
      {selectedProduct && (
        <AdminCard>
          <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2">Quantity</label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQuantity(q => Math.max(1, q - 1))}
              className="w-10 h-10 rounded-xl bg-[#111827] border border-white/6 flex items-center justify-center text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/12 transition-colors"
            >
              <Minus size={16} />
            </button>
            <span className="text-[20px] font-bold text-[#E5E7EB] w-12 text-center">{quantity}</span>
            <button
              onClick={() => setQuantity(q => q + 1)}
              className="w-10 h-10 rounded-xl bg-[#111827] border border-white/6 flex items-center justify-center text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/12 transition-colors"
            >
              <Plus size={16} />
            </button>
          </div>
        </AdminCard>
      )}

      {/* Summary */}
      {selectedProduct && selectedMember && (
        <AdminCard>
          <SectionLabel>Purchase Summary</SectionLabel>
          <div className="space-y-2 mt-3">
            <div className="flex justify-between text-[13px]">
              <span className="text-[#9CA3AF]">Total Price</span>
              <span className="text-[#E5E7EB] font-semibold">${totalPrice}</span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-[#9CA3AF]">Points Earned</span>
              <span className="text-[#D4AF37] font-semibold flex items-center gap-1">
                <Star size={12} /> +{totalPoints}
              </span>
            </div>
            {selectedProduct.punch_card_enabled && (
              <div className="flex justify-between text-[13px] items-center">
                <span className="text-[#9CA3AF]">Punch Card</span>
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
                <p className="text-[12px] text-emerald-400 font-medium">Free item will be earned with this purchase!</p>
              </div>
            )}
          </div>
        </AdminCard>
      )}

      {/* Record Button */}
      <button
        onClick={() => recordMutation.mutate()}
        disabled={!selectedMember || !selectedProduct || recordMutation.isPending}
        className="w-full py-3.5 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#C4A030] transition-colors whitespace-nowrap"
      >
        {recordMutation.isPending ? 'Recording...' : 'Record Purchase'}
      </button>
    </div>
  );
};

// ── History Tab ────────────────────────────────────────────
const HistoryTab = ({ gymId }) => {
  const [filterProduct, setFilterProduct] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filters = useMemo(() => ({ filterProduct, dateFrom, dateTo }), [filterProduct, dateFrom, dateTo]);

  // Fetch products for filter dropdown
  const { data: products = [] } = useQuery({
    queryKey: storeKeys.products(gymId),
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_products')
        .select('id, name, emoji_icon')
        .eq('gym_id', gymId)
        .order('name');
      return data || [];
    },
    enabled: !!gymId,
  });

  const { data: purchases = [], isLoading } = useQuery({
    queryKey: storeKeys.purchases(gymId, filters),
    queryFn: async () => {
      let query = supabase
        .from('member_purchases')
        .select('*, profiles:member_id(full_name, avatar_url), gym_products:product_id(name, emoji_icon, price)')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (filterProduct !== 'all') {
        query = query.eq('product_id', filterProduct);
      }
      if (dateFrom) {
        query = query.gte('created_at', new Date(dateFrom).toISOString());
      }
      if (dateTo) {
        const end = new Date(dateTo);
        end.setDate(end.getDate() + 1);
        query = query.lt('created_at', end.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <AdminCard>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[11px] font-medium text-[#6B7280] mb-1">Product</label>
            <select
              value={filterProduct}
              onChange={e => setFilterProduct(e.target.value)}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            >
              <option value="all">All Products</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.emoji_icon} {p.name}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[130px]">
            <label className="block text-[11px] font-medium text-[#6B7280] mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            />
          </div>
          <div className="min-w-[130px]">
            <label className="block text-[11px] font-medium text-[#6B7280] mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            />
          </div>
          {(filterProduct !== 'all' || dateFrom || dateTo) && (
            <button
              onClick={() => { setFilterProduct('all'); setDateFrom(''); setDateTo(''); }}
              className="px-3 py-2 rounded-xl text-[12px] font-medium text-[#9CA3AF] bg-white/5 hover:bg-white/8 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </AdminCard>

      {/* Purchase List */}
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map(i => <CardSkeleton key={i} h="h-[60px]" />)}
        </div>
      ) : purchases.length === 0 ? (
        <div className="text-center py-16">
          <ShoppingBag size={32} className="text-[#6B7280] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">No purchases found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {purchases.map((p, idx) => (
            <FadeIn key={p.id} delay={idx * 30}>
              <AdminCard>
                <div className="flex items-center gap-3">
                  {/* Product emoji */}
                  <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/6 flex items-center justify-center flex-shrink-0 text-[18px]">
                    {p.gym_products?.emoji_icon || '📦'}
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13px] font-medium text-[#E5E7EB] truncate">
                        {p.profiles?.full_name ?? 'Unknown'}
                      </p>
                      <span className="text-[11px] text-[#6B7280]">bought</span>
                      <p className="text-[13px] font-medium text-[#E5E7EB] truncate">
                        {p.quantity > 1 ? `${p.quantity}x ` : ''}{p.gym_products?.name ?? 'Unknown'}
                      </p>
                      {p.is_free_reward && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-emerald-400 bg-emerald-500/10 flex items-center gap-0.5">
                          <Gift size={10} /> FREE
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
                      <span>{format(new Date(p.created_at), 'MMM d, h:mm a')}</span>
                    </div>
                  </div>
                </div>
              </AdminCard>
            </FadeIn>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main Page ──────────────────────────────────────────────
export default function AdminStore() {
  const { profile } = useAuth();
  const gymId = profile?.gym_id;
  const [activeTab, setActiveTab] = useState('products');

  useEffect(() => { document.title = 'Admin - Store | TuGymPR'; }, []);

  return (
    <div className="px-4 md:px-8 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto">
      <PageHeader
        title="Store"
        subtitle="Manage products, log purchases, and track sales"
        className="mb-6"
      />

      {/* Tabs */}
      <div className="flex gap-1 bg-[#0F172A] border border-white/8 rounded-[14px] p-1 mb-6 overflow-hidden">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                isActive
                  ? 'bg-[#D4AF37]/10 text-[#D4AF37] shadow-sm'
                  : 'text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/[0.02]'
              }`}
            >
              <Icon size={15} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'products' && <ProductsTab gymId={gymId} />}
      {activeTab === 'purchase' && <LogPurchaseTab gymId={gymId} />}
      {activeTab === 'history' && <HistoryTab gymId={gymId} />}
    </div>
  );
}
