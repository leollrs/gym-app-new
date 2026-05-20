import { PRODUCT_COVERS } from './storeConstants';

/** Render a product cover-preset as a gradient block with its icon. */
export default function ProductCoverBadge({ preset, size = 40, iconSize = 18 }) {
  const cover = PRODUCT_COVERS.find(c => c.key === preset);
  if (!cover) return null;
  const Icon = cover.icon;
  return (
    <div className="rounded-xl flex items-center justify-center flex-shrink-0" style={{ width: size, height: size, background: cover.gradient }}>
      <Icon size={iconSize} className="text-white/90" />
    </div>
  );
}
