import { useState, useEffect } from 'react';
import { Package, ToggleLeft, ToggleRight } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import posthog from 'posthog-js';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { logAdminAction } from '../../../lib/adminAudit';
import { AdminModal } from '../../../components/admin';
import { CATEGORY_OPTS, PRODUCT_COVERS, storeKeys } from './storeConstants';

/**
 * Create/edit modal for a `gym_products` row. Two-mode: when `product`
 * is null it inserts; when populated it updates by id.
 *
 * Validates client-side: non-empty name, positive price, punch-card
 * target in 2–50 if punch-card mode is enabled. Backend has the same
 * checks; the local copy gives instant feedback in the toast.
 */
export default function ProductModal({ isOpen, onClose, gymId, product, t }) {
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
      if (!form.price || parseFloat(form.price) <= 0) throw new Error(t('admin.store.priceRequired', 'Valid price is required.'));
      if (form.punch_card_enabled) {
        const pt = parseInt(form.punch_card_target);
        if (!Number.isFinite(pt) || pt < 2 || pt > 50) throw new Error(t('admin.store.invalidPunchTarget', 'Punch target must be 2–50.'));
      }

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
        posthog?.capture('admin_product_created', { category: form.category });
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
                  <span className="text-[8px] font-bold text-white/80 uppercase tracking-wide">{t(`admin.store.covers.${c.labelKey}`, c.defaultLabel)}</span>
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
}
