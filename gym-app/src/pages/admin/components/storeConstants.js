import { CupSoda, Ticket, ShoppingBag, Dumbbell, Crown, Percent, Droplets, Wind } from 'lucide-react';
import { adminKeys } from '../../../lib/adminQueryKeys';

/**
 * Display + query-key constants shared across the AdminStore surfaces
 * (ProductsTab, RedemptionsTab, MemberPurchasesTab, ProductModal,
 * ProductCoverBadge).
 *
 * `CATEGORY_OPTS` is the chip-color palette + i18n key map for the
 * product-category enum. `PRODUCT_COVERS` is the gradient + icon catalog
 * for the cover-preset picker — used by the ProductCoverBadge renderer
 * and the picker grid inside ProductModal.
 */

export const CATEGORY_OPTS = [
  { value: 'supplement', labelKey: 'admin.store.catSupplement', color: 'text-blue-400 bg-blue-500/10' },
  { value: 'drink', labelKey: 'admin.store.catDrink', color: 'text-cyan-400 bg-cyan-500/10' },
  { value: 'snack', labelKey: 'admin.store.catSnack', color: 'text-amber-400 bg-amber-500/10' },
  { value: 'merchandise', labelKey: 'admin.store.catMerch', color: 'text-purple-400 bg-purple-500/10' },
  { value: 'service', labelKey: 'admin.store.catService', color: 'text-emerald-400 bg-emerald-500/10' },
  { value: 'other', labelKey: 'admin.store.catOther', color: 'text-[#9CA3AF] bg-white/6' },
];

export const PRODUCT_COVERS = [
  { key: 'smoothie',   labelKey: 'smoothie',  defaultLabel: 'Smoothie',   icon: CupSoda,     gradient: 'linear-gradient(135deg, #10B981 0%, #047857 100%)' },
  { key: 'guest_pass', labelKey: 'guestPass', defaultLabel: 'Guest Pass', icon: Ticket,      gradient: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)' },
  { key: 'merch',      labelKey: 'merch',     defaultLabel: 'Merch',      icon: ShoppingBag, gradient: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)' },
  { key: 'pt_session', labelKey: 'ptSession', defaultLabel: 'PT Session', icon: Dumbbell,    gradient: 'linear-gradient(135deg, #D4AF37 0%, #92751E 100%)' },
  { key: 'free_month', labelKey: 'freeMonth', defaultLabel: 'Free Month', icon: Crown,       gradient: 'linear-gradient(135deg, #EC4899 0%, #BE185D 100%)' },
  { key: 'discount',   labelKey: 'discount',  defaultLabel: 'Discount',   icon: Percent,     gradient: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' },
  { key: 'water',      labelKey: 'drink',     defaultLabel: 'Drink',      icon: Droplets,    gradient: 'linear-gradient(135deg, #06B6D4 0%, #0E7490 100%)' },
  { key: 'towel',      labelKey: 'towel',     defaultLabel: 'Towel',      icon: Wind,        gradient: 'linear-gradient(135deg, #6366F1 0%, #4338CA 100%)' },
];

export const storeKeys = adminKeys.store;

export const categoryStyle = (cat) =>
  CATEGORY_OPTS.find(c => c.value === cat)?.color ?? 'text-[#9CA3AF] bg-white/6';

export const categoryLabel = (cat, t) => {
  const opt = CATEGORY_OPTS.find(c => c.value === cat);
  return opt ? t(opt.labelKey) : cat;
};
