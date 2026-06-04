import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { logAdminAction } from '../../../lib/adminAudit';
import { FadeIn, CardSkeleton } from '../../../components/admin';
import { storeKeys, categoryLabel } from './storeConstants';
import ProductCoverBadge from './ProductCoverBadge';
import ProductModal from './ProductModal';
import { TK, FK, TONE, Ico, ICON, Card, IconChip, Pill, PrimaryBtn } from './retosKit';

const eyebrow = { fontFamily: FK.body, fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: TK.textFaint };
const CAT_TONE = { supplement: 'info', drink: 'info', snack: 'warn', merchandise: 'coach', service: 'good', other: 'neutral' };

// square switch (active = green)
function ProductToggle({ active, onClick, title }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} style={{
      width: 42, height: 42, borderRadius: 11, display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0,
      background: active ? 'var(--color-success-soft)' : TK.surface,
      border: `1px solid ${active ? 'color-mix(in srgb, var(--color-success) 35%, transparent)' : TK.borderSolid}`,
    }}>
      <span style={{ width: 26, height: 15, borderRadius: 99, background: active ? 'var(--color-success)' : TK.surface3, position: 'relative', display: 'inline-block' }}>
        <span style={{ position: 'absolute', top: 1.5, left: active ? 12.5 : 1.5, width: 12, height: 12, borderRadius: 99, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.25)', transition: 'left .15s' }} />
      </span>
    </button>
  );
}

/**
 * "Products" tab on AdminStore — CRUD for the gym's product catalog.
 * Toggle activates/deactivates (is_active); delete is inline-confirm.
 */
export default function ProductsTab({ gymId, t, addProductOpen, onAddProductClose }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

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

  const openEdit = (p) => { setEditProduct(p); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditProduct(null); };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[18px]" style={{ marginTop: 22 }}>
        {[0, 1, 2].map(i => <CardSkeleton key={i} h="h-[210px]" />)}
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '26px 0 16px' }}>
        <Ico ch={ICON.box} size={15} color={TK.textFaint} stroke={2} />
        <span style={eyebrow}>{t('admin.store.productsInStore', 'Products in store')}</span>
      </div>

      {products.length === 0 ? (
        <FadeIn>
          <Card style={{ textAlign: 'center', padding: '48px 24px' }}>
            <Ico ch={ICON.box} size={40} color={TK.textMute} stroke={1.6} style={{ margin: '0 auto 12px' }} />
            <p style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, color: TK.text, margin: 0 }}>{t('admin.store.emptyTitle', 'No products yet')}</p>
            <p style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textMute, margin: '4px 0 18px' }}>{t('admin.store.emptyDesc', 'Add your first product to start selling.')}</p>
            <div style={{ display: 'inline-flex' }}>
              <PrimaryBtn icon={ICON.plus} onClick={() => { setEditProduct(null); setShowModal(true); }}>{t('admin.store.addProduct', 'Add Product')}</PrimaryBtn>
            </div>
          </Card>
        </FadeIn>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[18px]">
          {products.map((p, idx) => {
            const active = p.is_active !== false;
            const tone = CAT_TONE[p.category] || 'accent';
            return (
              <FadeIn key={p.id} delay={idx * 40}>
                <Card style={{ overflow: 'hidden', opacity: active ? 1 : 0.6 }}>
                  {/* chip + status */}
                  <div style={{ padding: '18px 18px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    {p.cover_preset
                      ? <ProductCoverBadge preset={p.cover_preset} size={48} iconSize={24} />
                      : <IconChip ch={ICON.box} tone={tone} size={48} r={15} strokeW={1.9} />}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, background: active ? 'var(--color-success-soft)' : TK.surface3, border: `1px solid ${active ? 'color-mix(in srgb, var(--color-success) 32%, transparent)' : TK.borderSolid}` }}>
                      <span style={{ width: 6, height: 6, borderRadius: 99, background: active ? 'var(--color-success)' : TK.textFaint }} />
                      <span style={{ fontFamily: FK.body, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: active ? 'var(--color-success-ink, var(--color-success))' : TK.textMute }}>
                        {active ? t('admin.store.activeLabel', 'Active') : t('admin.store.inactive', 'Inactive')}
                      </span>
                    </span>
                  </div>

                  {/* name + price + pts */}
                  <div style={{ padding: '15px 18px 0' }}>
                    <div style={{ fontFamily: FK.display, fontSize: 19, fontWeight: 800, color: TK.text, letterSpacing: -0.4 }}>{p.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginTop: 9, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: FK.display, fontSize: 22, fontWeight: 800, color: TK.text, letterSpacing: -0.5 }}>${parseFloat(p.price).toFixed(2)}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 999, background: TK.accentSoft, border: `1px solid ${TK.accentLine}` }}>
                        <Ico ch={ICON.star} size={13} color={TK.accent} stroke={2} />
                        <span style={{ fontFamily: FK.mono, fontSize: 12, fontWeight: 700, color: TK.accentInk }}>+{p.points_per_purchase ?? 0} pts</span>
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
                      <Pill tone={tone}>{categoryLabel(p.category, t)}</Pill>
                      {p.punch_card_enabled && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FK.body, fontSize: 11.5, fontWeight: 600, color: TK.textMute }}>
                          <Ico ch={ICON.ticket} size={13} color={TK.textMute} stroke={1.9} />
                          {t('admin.store.freeEvery', '1 free / {{count}}', { count: p.punch_card_target })}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* footer */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '16px 18px 18px', marginTop: 4 }}>
                    {confirmDeleteId === p.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', width: '100%' }}>
                        <span style={{ fontFamily: FK.body, fontSize: 12.5, color: 'var(--color-danger)' }}>{t('admin.store.deleteConfirm', 'Delete?')}</span>
                        <button type="button" onClick={() => deleteMutation.mutate(p.id)}
                          style={{ padding: '8px 14px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: FK.body, fontSize: 12.5, fontWeight: 800, color: '#fff', background: 'var(--color-danger)' }}>
                          {t('admin.store.confirm', 'Confirm')}
                        </button>
                        <button type="button" onClick={() => setConfirmDeleteId(null)}
                          style={{ padding: '8px 14px', borderRadius: 999, cursor: 'pointer', fontFamily: FK.body, fontSize: 12.5, fontWeight: 700, color: TK.textSub, background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
                          {t('admin.store.cancel', 'Cancel')}
                        </button>
                      </div>
                    ) : (
                      <>
                        <button type="button" onClick={() => openEdit(p)}
                          style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 0', borderRadius: 11, cursor: 'pointer', background: TK.accentWash, border: `1px solid ${TK.accentLine}`, fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.accent }}>
                          <Ico ch={ICON.edit} size={15} color={TK.accent} stroke={2.1} />{t('admin.store.edit', 'Edit')}
                        </button>
                        <ProductToggle active={active}
                          title={active ? t('admin.store.deactivate', 'Deactivate') : t('admin.store.activate', 'Activate')}
                          onClick={() => toggleMutation.mutate({ id: p.id, is_active: active })} />
                        <button type="button" onClick={() => setConfirmDeleteId(p.id)} aria-label={t('admin.store.deleteProduct', 'Delete product')}
                          style={{ width: 42, height: 42, borderRadius: 11, display: 'grid', placeItems: 'center', cursor: 'pointer', background: TK.surface, border: `1px solid ${TK.borderSolid}`, flexShrink: 0 }}>
                          <Ico ch={ICON.trash} size={16} color="var(--color-danger)" stroke={2} />
                        </button>
                      </>
                    )}
                  </div>
                </Card>
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
