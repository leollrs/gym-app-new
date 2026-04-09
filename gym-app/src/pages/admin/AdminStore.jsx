import { useEffect, useState, useMemo } from 'react';
import {
  Plus, ShoppingBag, Pencil, Trash2, Search, Package, Gift,
  Hash, DollarSign, Star, ToggleLeft, ToggleRight, Minus, Clock,
  Filter, ChevronDown, X, ScanLine, Users, Receipt,
  CupSoda, Ticket, Dumbbell, Crown, Percent, Droplets, Wind,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { adminKeys } from '../../lib/adminQueryKeys';
import { logAdminAction } from '../../lib/adminAudit';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { format } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import {
  PageHeader, AdminCard, AdminModal, FadeIn, CardSkeleton,
  SectionLabel, FilterBar, AdminPageShell, AdminTable, AdminTabs,
} from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import QRScannerModal from '../../components/admin/QRScannerModal';
import PasswordResetApprovalModal from './components/PasswordResetApprovalModal';

// ── Constants ──────────────────────────────────────────────
const CATEGORY_OPTS = [
  { value: 'supplement', labelKey: 'admin.store.catSupplement', color: 'text-blue-400 bg-blue-500/10' },
  { value: 'drink', labelKey: 'admin.store.catDrink', color: 'text-cyan-400 bg-cyan-500/10' },
  { value: 'snack', labelKey: 'admin.store.catSnack', color: 'text-amber-400 bg-amber-500/10' },
  { value: 'merchandise', labelKey: 'admin.store.catMerch', color: 'text-purple-400 bg-purple-500/10' },
  { value: 'service', labelKey: 'admin.store.catService', color: 'text-emerald-400 bg-emerald-500/10' },
  { value: 'other', labelKey: 'admin.store.catOther', color: 'text-[#9CA3AF] bg-white/6' },
];

const storeKeys = adminKeys.store;

const categoryStyle = (cat) =>
  CATEGORY_OPTS.find(c => c.value === cat)?.color ?? 'text-[#9CA3AF] bg-white/6';

const categoryLabel = (cat, t) => {
  const opt = CATEGORY_OPTS.find(c => c.value === cat);
  return opt ? t(opt.labelKey) : cat;
};

// ── Product Modal ──────────────────────────────────────────
const PRODUCT_COVERS = [
  { key: 'smoothie',   label: 'Batido',        icon: CupSoda,     gradient: 'linear-gradient(135deg, #10B981 0%, #047857 100%)' },
  { key: 'guest_pass', label: 'Pase Invitado', icon: Ticket,      gradient: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)' },
  { key: 'merch',      label: 'Merchandise',   icon: ShoppingBag, gradient: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)' },
  { key: 'pt_session', label: 'Sesión PT',     icon: Dumbbell,    gradient: 'linear-gradient(135deg, #D4AF37 0%, #92751E 100%)' },
  { key: 'free_month', label: 'Mes Gratis',    icon: Crown,       gradient: 'linear-gradient(135deg, #EC4899 0%, #BE185D 100%)' },
  { key: 'discount',   label: 'Descuento',     icon: Percent,     gradient: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' },
  { key: 'water',      label: 'Agua/Bebida',   icon: Droplets,    gradient: 'linear-gradient(135deg, #06B6D4 0%, #0E7490 100%)' },
  { key: 'towel',      label: 'Toalla',        icon: Wind,        gradient: 'linear-gradient(135deg, #6366F1 0%, #4338CA 100%)' },
];

function ProductCoverBadge({ preset, size = 40, iconSize = 18 }) {
  const cover = PRODUCT_COVERS.find(c => c.key === preset);
  if (!cover) return null;
  const Icon = cover.icon;
  return (
    <div className="rounded-xl flex items-center justify-center flex-shrink-0" style={{ width: size, height: size, background: cover.gradient }}>
      <Icon size={iconSize} className="text-white/90" />
    </div>
  );
}

const ProductModal = ({ isOpen, onClose, gymId, product, t }) => {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!product;

  const [form, setForm] = useState({
    name: '',
    category: 'supplement',
    price: '',
    cover_preset: '',
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
        cover_preset: product.cover_preset || '',
        points_per_purchase: product.points_per_purchase?.toString() || '10',
        punch_card_enabled: product.punch_card_enabled || false,
        punch_card_target: product.punch_card_target?.toString() || '10',
      });
    } else {
      setForm({
        name: '', category: 'supplement', price: '', cover_preset: '',
        points_per_purchase: '10', punch_card_enabled: false, punch_card_target: '10',
      });
    }
  }, [product, isOpen]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error(t('admin.store.nameRequired', 'Product name is required.'));
      if (!form.price || parseFloat(form.price) < 0) throw new Error(t('admin.store.priceRequired', 'Valid price is required.'));

      const payload = {
        gym_id: gymId,
        name: form.name.trim(),
        category: form.category,
        price: parseFloat(form.price),
        cover_preset: form.cover_preset || null,
        points_per_purchase: parseInt(form.points_per_purchase) || 0,
        punch_card_enabled: form.punch_card_enabled,
        punch_card_target: form.punch_card_enabled ? parseInt(form.punch_card_target) || 10 : null,
      };

      if (isEdit) {
        const { error } = await supabase.from('gym_products').update(payload).eq('id', product.id).eq('gym_id', gymId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('gym_products').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      if (isEdit) {
        logAdminAction('update_product', 'product', product.id, { name: form.name.trim() });
      } else {
        logAdminAction('create_product', 'product', null, { name: form.name.trim() });
      }
      queryClient.invalidateQueries({ queryKey: storeKeys.products(gymId) });
      showToast(isEdit ? t('admin.store.productUpdated', 'Product updated') : t('admin.store.productCreated', 'Product created'), 'success');
      onClose();
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const inputClass = 'w-full bg-white/[0.04] border border-white/8 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 focus:ring-1 focus:ring-[#D4AF37]/30 transition-all';

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? t('admin.store.editProduct', 'Edit Product') : t('admin.store.newProduct', 'New Product')}
      titleIcon={Package}
      footer={
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] hover:bg-[#C5A028] disabled:opacity-50 transition-colors"
        >
          {saveMutation.isPending
            ? t('admin.store.saving', 'Saving...')
            : isEdit
              ? t('admin.store.saveChanges', 'Save Changes')
              : t('admin.store.createProduct', 'Create Product')}
        </button>
      }
    >
      <div className="space-y-5">
        {/* Cover preset grid */}
        <div>
          <label className="block text-[12px] font-medium mb-2" style={{ color: 'var(--color-text-muted)' }}>
            {t('admin.store.coverImage', 'Imagen del producto')}
          </label>
          <div className="grid grid-cols-4 gap-2 mb-2">
            {PRODUCT_COVERS.map(c => {
              const Icon = c.icon;
              const selected = form.cover_preset === c.key;
              return (
                <button key={c.key} type="button"
                  onClick={() => set('cover_preset', selected ? '' : c.key)}
                  className={`rounded-xl p-2.5 flex flex-col items-center gap-1 transition-all ${selected ? 'ring-2 ring-white scale-[1.03]' : 'opacity-70 hover:opacity-100'}`}
                  style={{ background: c.gradient }}>
                  <Icon size={20} className="text-white/90" />
                  <span className="text-[8px] font-bold text-white/80 uppercase tracking-wide">{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.store.productName', 'Nombre del Producto')}</label>
          <input
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder={t('admin.store.productNamePlaceholder', 'ej. Batido de Proteína')}
            className={inputClass}
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2">{t('admin.store.category', 'Category')}</label>
          <div className="flex gap-2 flex-wrap">
            {CATEGORY_OPTS.map(c => (
              <button
                key={c.value}
                onClick={() => set('category', c.value)}
                className={`flex-1 min-w-[70px] py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                  form.category === c.value ? c.color : 'bg-white/[0.03] border border-white/6 text-[#6B7280]'
                }`}
              >
                {t(c.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Price + Points */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.store.price', 'Price ($)')}</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="99999"
              value={form.price}
              onChange={e => set('price', e.target.value)}
              placeholder="0.00"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.store.pointsPerPurchase', 'Points / Purchase')}</label>
            <input
              type="number"
              min="0"
              max="99999"
              value={form.points_per_purchase}
              onChange={e => set('points_per_purchase', e.target.value)}
              placeholder="10"
              className={inputClass}
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
              <p className="text-[13px] font-medium text-[#E5E7EB]">{t('admin.store.punchCard', 'Punch Card')}</p>
              <p className="text-[11px] text-[#6B7280]">{t('admin.store.punchCardDesc', 'Free item after X purchases')}</p>
            </div>
          </button>

          {form.punch_card_enabled && (
            <div className="mt-3 ml-10">
              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">
                {t('admin.store.punchCardTarget', 'Purchases needed for free item')}
              </label>
              <input
                type="number"
                min="2"
                value={form.punch_card_target}
                onChange={e => set('punch_card_target', e.target.value)}
                className={inputClass}
              />
            </div>
          )}
        </div>
      </div>
    </AdminModal>
  );
};

// ── Products Tab ───────────────────────────────────────────
const ProductsTab = ({ gymId, t, addProductOpen, onAddProductClose }) => {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Open "Add Product" modal when triggered from PageHeader
  useEffect(() => {
    if (addProductOpen) {
      setEditProduct(null);
      setShowModal(true);
      onAddProductClose?.();
    }
  }, [addProductOpen, onAddProductClose]);

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
      const { error } = await supabase.from('gym_products').update({ is_active: !is_active }).eq('id', id).eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: (_, { id, is_active }) => {
      logAdminAction('toggle_product', 'product', id, { is_active: !is_active });
      queryClient.invalidateQueries({ queryKey: storeKeys.products(gymId) });
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('gym_products').delete().eq('id', id).eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: (_, productId) => {
      logAdminAction('delete_product', 'product', productId);
      queryClient.invalidateQueries({ queryKey: storeKeys.products(gymId) });
      setConfirmDeleteId(null);
      showToast(t('admin.store.productDeleted', 'Product deleted'), 'success');
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map(i => <CardSkeleton key={i} h="h-[100px]" />)}
      </div>
    );
  }

  return (
    <>
      {products.length === 0 ? (
        <FadeIn>
          <AdminCard>
            <div className="text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center mx-auto mb-4">
                <Package size={24} className="text-[#D4AF37]" />
              </div>
              <p className="text-[15px] font-bold text-[#E5E7EB] mb-1">{t('admin.store.emptyTitle', 'No products yet')}</p>
              <p className="text-[13px] text-[#6B7280] mb-5">{t('admin.store.emptyDesc', 'Add your first product to start selling.')}</p>
              <button
                onClick={() => { setEditProduct(null); setShowModal(true); }}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#D4AF37] text-black font-bold text-[13px] rounded-xl hover:bg-[#C5A028] transition-colors"
              >
                <Plus size={15} /> {t('admin.store.addProduct', 'Add Product')}
              </button>
            </div>
          </AdminCard>
        </FadeIn>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p, idx) => (
            <FadeIn key={p.id} delay={idx * 40}>
              <AdminCard hover>
                <div className="flex items-start gap-3">
                  {/* Cover / Emoji */}
                  {p.cover_preset ? (
                    <ProductCoverBadge preset={p.cover_preset} size={44} iconSize={20} />
                  ) : (
                    <div className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/6 flex items-center justify-center flex-shrink-0">
                      <Package size={22} className="text-[#6B7280]" />
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className={`text-[14px] font-semibold truncate ${p.is_active !== false ? 'text-[#E5E7EB]' : 'text-[#6B7280] line-through'}`}>
                        {p.name}
                      </p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${categoryStyle(p.category)}`}>
                        {categoryLabel(p.category, t)}
                      </span>
                      {p.is_active === false && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-red-400 bg-red-500/10">
                          {t('admin.store.inactive', 'Inactive')}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-[12px] text-[#9CA3AF]">
                      <span className="font-semibold text-[#E5E7EB]">${parseFloat(p.price).toFixed(2)}</span>
                      <span className="flex items-center gap-1">
                        <Star size={11} className="text-[#D4AF37]" />
                        {p.points_per_purchase ?? 0} {t('admin.store.pts', 'pts')}
                      </span>
                      {p.punch_card_enabled && (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <Gift size={11} />
                          {t('admin.store.freeEvery', '1 free / {{count}}', { count: p.punch_card_target })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions row */}
                <div className="flex items-center justify-end gap-1 mt-3 pt-3 border-t border-white/[0.04]">
                  {confirmDeleteId === p.id ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-[#9CA3AF]">{t('admin.store.deleteConfirm', 'Delete?')}</span>
                      <button
                        onClick={() => deleteMutation.mutate(p.id)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
                      >
                        {t('admin.store.confirm', 'Confirm')}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/5 text-[#9CA3AF] hover:bg-white/10 transition-colors"
                      >
                        {t('admin.store.cancel', 'Cancel')}
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => toggleMutation.mutate({ id: p.id, is_active: p.is_active !== false })}
                        className={`p-2 rounded-lg transition-colors ${
                          p.is_active !== false ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10' : 'text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/[0.04]'
                        }`}
                        title={p.is_active !== false ? t('admin.store.deactivate', 'Deactivate') : t('admin.store.activate', 'Activate')}
                        aria-label={p.is_active !== false ? t('admin.store.deactivate', 'Deactivate product') : t('admin.store.activate', 'Activate product')}
                      >
                        {p.is_active !== false ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                      </button>
                      <button
                        onClick={() => openEdit(p)}
                        aria-label={t('admin.store.editProduct', 'Edit product')}
                        className="p-2 rounded-lg text-[#6B7280] hover:text-[#D4AF37] hover:bg-[#D4AF37]/10 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(p.id)}
                        aria-label={t('admin.store.deleteProduct', 'Delete product')}
                        className="p-2 rounded-lg text-[#6B7280] hover:text-red-400 hover:bg-red-500/10 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              </AdminCard>
            </FadeIn>
          ))}
        </div>
      )}

      {showModal && (
        <ProductModal isOpen={showModal} onClose={closeModal} gymId={gymId} product={editProduct} t={t} />
      )}
    </>
  );
};

// ── Redemptions Tab ───────────────────────────────────────
const RedemptionsTab = ({ gymId, t, dateFnsLocale }) => {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filters = useMemo(() => ({ dateFrom, dateTo }), [dateFrom, dateTo]);

  const { data: purchases = [], isLoading } = useQuery({
    queryKey: storeKeys.purchases(gymId, { ...filters, redeemed: true }),
    queryFn: async () => {
      let query = supabase
        .from('member_purchases')
        .select('*, profiles:member_id(full_name, avatar_url), gym_products:product_id(name, price)')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false })
        .limit(100);

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

  const recentRedemptions = useMemo(() =>
    purchases.filter(p => p.is_free_reward),
    [purchases]
  );

  const columns = [
    {
      key: 'member',
      label: t('admin.store.member', 'Member'),
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-bold text-[#D4AF37]">
              {row.profiles?.full_name?.[0]?.toUpperCase() ?? '?'}
            </span>
          </div>
          <span className="text-[13px] font-medium text-[#E5E7EB] truncate">
            {row.profiles?.full_name ?? t('admin.store.unknown', 'Unknown')}
          </span>
        </div>
      ),
    },
    {
      key: 'product',
      label: t('admin.store.item', 'Item'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <Package size={15} className="text-[#6B7280]" />
          <span className="text-[13px] text-[#E5E7EB]">
            {row.quantity > 1 ? `${row.quantity}x ` : ''}{row.gym_products?.name ?? t('admin.store.unknown', 'Unknown')}
          </span>
        </div>
      ),
    },
    {
      key: 'date',
      label: t('admin.store.date', 'Date'),
      sortable: true,
      render: (row) => (
        <span className="text-[12px] text-[#9CA3AF]">
          {format(new Date(row.created_at), 'MMM d, h:mm a', dateFnsLocale)}
        </span>
      ),
    },
    {
      key: 'status',
      label: t('admin.store.status', 'Status'),
      render: (row) => (
        <div className="flex items-center gap-2">
          {row.is_free_reward ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full text-emerald-400 bg-emerald-500/10">
              <Gift size={10} /> {t('admin.store.freeReward', 'FREE')}
            </span>
          ) : (
            <span className="text-[12px] text-[#9CA3AF]">${parseFloat(row.total_price || 0).toFixed(2)}</span>
          )}
          {row.points_earned > 0 && (
            <span className="text-[#D4AF37] text-[11px] flex items-center gap-0.5">
              <Star size={10} /> +{row.points_earned}
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Date filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[140px]">
          <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.store.from', 'From')}</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/8 rounded-xl px-3 py-2 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-1 focus:ring-[#D4AF37]/30 transition-all"
          />
        </div>
        <div className="min-w-[140px]">
          <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.store.to', 'To')}</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/8 rounded-xl px-3 py-2 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-1 focus:ring-[#D4AF37]/30 transition-all"
          />
        </div>
        {(dateFrom || dateTo) && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); }}
            className="px-3 py-2 rounded-xl text-[12px] font-medium text-[#9CA3AF] bg-white/5 hover:bg-white/8 transition-colors"
          >
            {t('admin.store.clear', 'Clear')}
          </button>
        )}
      </div>

      {/* Redemption queue */}
      {recentRedemptions.length > 0 && (
        <FadeIn delay={0.05}>
          <AdminCard borderLeft="#10B981">
            <div className="flex items-center gap-2 mb-3">
              <Gift size={14} className="text-emerald-400" />
              <SectionLabel>{t('admin.store.recentRedemptions', 'Recent Redemptions')}</SectionLabel>
              <span className="text-[11px] text-[#6B7280] ml-auto">{recentRedemptions.length}</span>
            </div>
            <div className="space-y-2">
              {recentRedemptions.slice(0, 5).map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-1.5">
                  <div className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold text-emerald-400">
                      {p.profiles?.full_name?.[0]?.toUpperCase() ?? '?'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-[#E5E7EB] truncate">
                      <span className="font-medium">{p.profiles?.full_name}</span>
                      <span className="text-[#6B7280]"> {t('admin.store.redeemed', 'redeemed')} </span>
                      <span className="font-medium">{p.gym_products?.name}</span>
                    </p>
                  </div>
                  <span className="text-[11px] text-[#6B7280] flex-shrink-0">
                    {format(new Date(p.created_at), 'MMM d', dateFnsLocale)}
                  </span>
                </div>
              ))}
            </div>
          </AdminCard>
        </FadeIn>
      )}

      {/* Full table */}
      <FadeIn delay={0.1}>
        <AdminTable
          columns={columns}
          data={purchases}
          loading={isLoading}
          emptyIcon={Receipt}
          emptyText={t('admin.store.noRedemptions', 'No redemptions found')}
        />
      </FadeIn>
    </div>
  );
};

// ── Member Purchases Tab ──────────────────────────────────
const MemberPurchasesTab = ({ gymId, t, dateFnsLocale }) => {
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

  // Load all gym members
  const { data: allMembers = [], isLoading: membersLoading } = useQuery({
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
    }
  };

  const totalPrice = selectedProduct ? (parseFloat(selectedProduct.price) * quantity).toFixed(2) : '0.00';
  const totalPoints = selectedProduct ? (selectedProduct.points_per_purchase ?? 0) * quantity : 0;

  return (
    <div className="space-y-6">
      {/* ── Log Purchase section ── */}
      <FadeIn>
        <AdminCard borderLeft="#D4AF37">
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
                    onClick={() => setQuantity(q => q + 1)}
                    aria-label={t('admin.store.increaseQuantity', 'Increase quantity')}
                    className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/6 flex items-center justify-center text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/12 transition-colors"
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
};

// ── Main Page ──────────────────────────────────────────────
export default function AdminStore() {
  const { t, i18n } = useTranslation('pages');
  const { profile } = useAuth();
  const gymId = profile?.gym_id;
  const [storeTab, setStoreTab] = useState('products');
  const [addProductOpen, setAddProductOpen] = useState(false);
  const dateFnsLocale = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;

  useEffect(() => { document.title = `Admin - Store | ${window.__APP_NAME || 'TuGymPR'}`; }, []);

  const tabOptions = useMemo(() => [
    { key: 'products', label: t('admin.store.products', 'Products') },
    { key: 'redemptions', label: t('admin.store.ordersRedemptions', 'Orders / Redemptions') },
    { key: 'purchases', label: t('admin.store.members', 'Members') },
  ], [t]);

  return (
    <AdminPageShell>
      <FadeIn>
        <PageHeader
          title={t('admin.store.title', 'Store')}
          subtitle={t('admin.store.subtitle', 'Product and redemption management')}
          actions={
            storeTab === 'products' ? (
              <button
                onClick={() => setAddProductOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#D4AF37] text-black font-bold text-[13px] rounded-xl hover:bg-[#C5A028] transition-colors"
              >
                <Plus size={15} /> {t('admin.store.addProduct', 'Add Product')}
              </button>
            ) : null
          }
        />
      </FadeIn>

      {/* Sub-nav tabs */}
      <FadeIn delay={0.05}>
        <AdminTabs tabs={tabOptions} active={storeTab} onChange={setStoreTab} className="mt-5 mb-6" />
      </FadeIn>

      {/* Tab Content */}
      <SwipeableTabContent tabs={tabOptions} active={storeTab} onChange={setStoreTab}>
        {(tabKey) => {
          if (tabKey === 'products') return <ProductsTab gymId={gymId} t={t} addProductOpen={addProductOpen} onAddProductClose={() => setAddProductOpen(false)} />;
          if (tabKey === 'redemptions') return <RedemptionsTab gymId={gymId} t={t} dateFnsLocale={dateFnsLocale} />;
          if (tabKey === 'purchases') return <MemberPurchasesTab gymId={gymId} t={t} dateFnsLocale={dateFnsLocale} />;
          return null;
        }}
      </SwipeableTabContent>
    </AdminPageShell>
  );
}
