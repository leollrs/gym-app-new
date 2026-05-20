import { useState, useEffect } from 'react';
import { Package, Plus, Pencil, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { logAdminAction } from '../../../lib/adminAudit';
import { AdminCard, FadeIn, CardSkeleton } from '../../../components/admin';
import { storeKeys, categoryLabel } from './storeConstants';
import ProductCoverBadge from './ProductCoverBadge';
import ProductModal from './ProductModal';

/**
 * "Products" tab on AdminStore — CRUD for the gym's product catalog.
 *
 * Activates / deactivates rows via `is_active` toggle (members see only
 * active products). Delete uses an inline-confirm pattern (no extra
 * modal) because product deletion is rare and the confirm is small.
 *
 * "Add Product" can also be triggered from the page-level header, hence
 * the `addProductOpen` prop bridge — when the parent sets it true we
 * open the modal and immediately fire `onAddProductClose` to reset the
 * trigger.
 */
export default function ProductsTab({ gymId, t, addProductOpen, onAddProductClose }) {
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 md:gap-3">
          {products.map((p, idx) => {
            // category tone for tint
            const toneMap = {
              supplement: 'info', drink: 'info', snack: 'warn',
              merchandise: 'coach', service: 'good', other: 'info',
            };
            const tone = toneMap[p.category] || 'info';
            const tintBg = tone === 'good' ? 'var(--color-success-soft)'
              : tone === 'warn' ? 'var(--color-warning-soft)'
              : tone === 'coach' ? 'var(--color-coach-soft)'
              : 'var(--color-info-soft)';
            return (
            <FadeIn key={p.id} delay={idx * 40}>
              <div className={`admin-card p-3 sm:p-4 h-full flex flex-col ${p.is_active === false ? 'opacity-60' : ''}`}>
                {/* Cover / Emoji */}
                {p.cover_preset ? (
                  <div className="mb-3">
                    <ProductCoverBadge preset={p.cover_preset} size={44} iconSize={22} />
                  </div>
                ) : (
                  <div className="w-11 h-11 rounded-[11px] grid place-items-center flex-shrink-0 text-[22px] mb-3"
                    style={{ background: tintBg }}>
                    📦
                  </div>
                )}

                {/* Name + category pill */}
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  <span className="admin-kpi text-[14.5px]" style={{ fontWeight: 800 }}>
                    {p.name}
                  </span>
                  <span className={`admin-pill admin-pill--${tone === 'info' ? 'info' : tone}`} style={{ fontSize: '9.5px' }}>
                    {categoryLabel(p.category, t)}
                  </span>
                  {p.is_active === false && (
                    <span className="admin-pill admin-pill--hot" style={{ fontSize: '9.5px' }}>
                      {t('admin.store.inactive', 'Inactive')}
                    </span>
                  )}
                </div>

                {/* Price / points / punch meta */}
                <div className="flex items-center gap-2.5 text-[11.5px] flex-wrap mb-2" style={{ color: 'var(--color-admin-text-muted)' }}>
                  <span className="admin-mono font-bold" style={{ color: 'var(--color-admin-text)' }}>
                    ${parseFloat(p.price).toFixed(2)}
                  </span>
                  <span>⭐ {p.points_per_purchase ?? 0} {t('admin.store.pts', 'pts')}</span>
                  {p.punch_card_enabled && (
                    <span>🎫 {t('admin.store.freeEvery', '1 free / {{count}}', { count: p.punch_card_target })}</span>
                  )}
                </div>

                {/* Actions row */}
                <div className="flex items-center justify-end gap-1 mt-auto pt-2 flex-nowrap">
                  {confirmDeleteId === p.id ? (
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
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
                        className={`p-1.5 sm:p-2 rounded-lg transition-colors ${
                          p.is_active !== false ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10' : 'text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/[0.04]'
                        }`}
                        title={p.is_active !== false ? t('admin.store.deactivate', 'Deactivate') : t('admin.store.activate', 'Activate')}
                        aria-label={p.is_active !== false ? t('admin.store.deactivate', 'Deactivate product') : t('admin.store.activate', 'Activate product')}
                      >
                        {p.is_active !== false ? <ToggleRight size={16} className="sm:w-[18px] sm:h-[18px]" /> : <ToggleLeft size={16} className="sm:w-[18px] sm:h-[18px]" />}
                      </button>
                      <button
                        onClick={() => openEdit(p)}
                        aria-label={t('admin.store.editProduct', 'Edit product')}
                        className="p-1.5 sm:p-2 rounded-lg text-[#6B7280] hover:text-[#D4AF37] hover:bg-[#D4AF37]/10 transition-colors flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none md:min-w-[44px] md:min-h-[44px]"
                      >
                        <Pencil size={14} className="sm:w-[15px] sm:h-[15px]" />
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(p.id)}
                        aria-label={t('admin.store.deleteProduct', 'Delete product')}
                        className="p-1.5 sm:p-2 rounded-lg text-[#6B7280] hover:text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none md:min-w-[44px] md:min-h-[44px]"
                      >
                        <Trash2 size={14} className="sm:w-[15px] sm:h-[15px]" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </FadeIn>
          );
          })}
        </div>
      )}

      {showModal && (
        <ProductModal isOpen={showModal} onClose={closeModal} gymId={gymId} product={editProduct} t={t} />
      )}
    </>
  );
}
