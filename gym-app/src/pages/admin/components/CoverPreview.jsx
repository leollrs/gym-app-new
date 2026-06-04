import { Flame, Zap, Wind, Bike, Swords, Heart, Dumbbell, Music, Footprints, Mountain, Waves, Brain } from 'lucide-react';

/**
 * Default class cover presets — gradient + icon combos that gyms can pick
 * for classes without uploading a custom image. Order is roughly the
 * popularity of class types we see in production.
 *
 * Exported so the ClassFormModal picker grid can iterate over them.
 */
export const CLASS_COVERS = [
  { key: 'hiit',      labelKey: 'admin.classes.cover.hiit',       icon: Flame,      gradient: 'linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)' },
  { key: 'crossfit',  labelKey: 'admin.classes.cover.crossfit',   icon: Zap,        gradient: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' },
  { key: 'yoga',      labelKey: 'admin.classes.cover.yoga',       icon: Wind,       gradient: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)' },
  { key: 'spinning',  labelKey: 'admin.classes.cover.spinning',   icon: Bike,       gradient: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)' },
  { key: 'boxing',    labelKey: 'admin.classes.cover.boxing',     icon: Swords,     gradient: 'linear-gradient(135deg, #EF4444 0%, #991B1B 100%)' },
  { key: 'pilates',   labelKey: 'admin.classes.cover.pilates',    icon: Heart,      gradient: 'linear-gradient(135deg, #EC4899 0%, #BE185D 100%)' },
  { key: 'strength',  labelKey: 'admin.classes.cover.strength',   icon: Dumbbell,   gradient: 'linear-gradient(135deg, #D4AF37 0%, #92751E 100%)' },
  { key: 'dance',     labelKey: 'admin.classes.cover.dance',      icon: Music,      gradient: 'linear-gradient(135deg, #06B6D4 0%, #0E7490 100%)' },
  { key: 'cardio',    labelKey: 'admin.classes.cover.cardio',     icon: Footprints, gradient: 'linear-gradient(135deg, #10B981 0%, #047857 100%)' },
  { key: 'functional',labelKey: 'admin.classes.cover.functional', icon: Mountain,   gradient: 'linear-gradient(135deg, #6366F1 0%, #4338CA 100%)' },
  { key: 'aqua',      labelKey: 'admin.classes.cover.aqua',       icon: Waves,      gradient: 'linear-gradient(135deg, #0EA5E9 0%, #0369A1 100%)' },
  { key: 'mindBody',  labelKey: 'admin.classes.cover.mindBody',   icon: Brain,      gradient: 'linear-gradient(135deg, #A78BFA 0%, #7C3AED 100%)' },
];

/** Render a cover preset as a visual element */
export default function CoverPreview({ preset, size = 'sm', className = '' }) {
  if (!preset) return null;
  const cover = CLASS_COVERS.find(c => c.key === preset);
  if (!cover) return null;
  const Icon = cover.icon;
  const sz = size === 'square' ? 'w-full h-full' : size === 'lg' ? 'w-full h-32' : size === 'md' ? 'w-14 h-14' : 'w-10 h-10';
  const iconSz = size === 'square' ? 56 : size === 'lg' ? 36 : size === 'md' ? 20 : 14;
  return (
    <div className={`${sz} rounded-xl flex items-center justify-center ${className}`} style={{ background: cover.gradient }}>
      <Icon size={iconSz} className="text-white/90" />
    </div>
  );
}
