import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Check, Heart, RefreshCw, Sparkles, ScanLine, Search, Sunrise, Sun, Moon, Apple } from 'lucide-react';
import { getFoodImage } from '../../lib/foodImages';
import { foodImageUrl } from '../../lib/imageUrl';

// Design tokens — match the warm-paper app aesthetic used in LogFoodModal
const TU = {
  macroP: 'var(--tu-macro-p, #2EC4C4)',
  macroC: 'var(--tu-macro-c, #FF7A3D)',
  macroF: 'var(--tu-macro-f, #FFC24A)',
  accent: 'var(--color-accent, #2EC4C4)',
  coach:  '#6D5FDB',
  display: '"Familjen Grotesk", "Archivo", system-ui, sans-serif',
};

const MEAL_TYPES = [
  { key: 'breakfast', labelKey: 'nutrition.meals.breakfast', icon: Sunrise },
  { key: 'lunch',     labelKey: 'nutrition.meals.lunch',     icon: Sun },
  { key: 'dinner',    labelKey: 'nutrition.meals.dinner',    icon: Moon },
  { key: 'snack',     labelKey: 'nutrition.meals.snack',     icon: Apple },
];

const TILE_PALETTES = [
  ['#FFB86B', '#FF7A3D'], ['#7FE3C4', '#2EC4C4'], ['#FFD166', '#F2A23A'],
  ['#D0C6FF', '#8B7DFF'], ['#B8E8A8', '#5EAA5E'], ['#FFB8B8', '#E87171'],
  ['#C8D8FF', '#6B8FE8'],
];
const FoodTile = ({ name, size = 64, seed = 0 }) => {
  const [a, b] = TILE_PALETTES[Math.abs(seed) % TILE_PALETTES.length];
  const initial = (name || '?').trim()[0]?.toUpperCase() || '?';
  return (
    <div className="flex items-center justify-center flex-shrink-0" style={{
      width: size, height: size, borderRadius: size * 0.27,
      background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)`,
      color: 'rgba(255,255,255,0.95)',
      fontFamily: TU.display, fontSize: size * 0.4, fontWeight: 700,
      letterSpacing: -0.5,
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)',
    }}>{initial}</div>
  );
};

function nutriScoreCalc(calories, protein_g, carbs_g, fat_g, grams) {
  if (!grams || grams <= 0) return null;
  const scale = 100 / grams;
  const cal100 = calories * scale;
  const pro100 = protein_g * scale;
  let score = 50;
  const proteinRatio = (protein_g * 4) / Math.max(calories, 1);
  score += Math.min(proteinRatio * 60, 25);
  if (cal100 < 100) score += 15;
  else if (cal100 < 200) score += 8;
  else if (cal100 > 400) score -= 15;
  else if (cal100 > 300) score -= 8;
  const fatRatio = (fat_g * 9) / Math.max(calories, 1);
  if (fatRatio > 0.5) score -= 12;
  else if (fatRatio > 0.35) score -= 5;
  else if (fatRatio < 0.2) score += 5;
  if (pro100 > 20) score += 10;
  else if (pro100 > 10) score += 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

const NutriScoreBadge = ({ score }) => {
  if (score == null) return null;
  const color = score >= 80 ? '#22C55E' : score >= 60 ? '#84CC16' : score >= 40 ? '#EAB308' : score >= 20 ? '#F97316' : '#EF4444';
  return (
    <span className="inline-flex items-center justify-center px-2 h-[22px] rounded-md text-[11px] font-black text-white"
      style={{ backgroundColor: color, fontFamily: TU.display }}>
      {score}
    </span>
  );
};

/**
 * Clean AI-generated food labels — strips trailing "of/in/with X", commas,
 * trims to 40 chars, title-cases.
 *   "Redbull of dark desk" -> "Redbull"
 *   "Grilled chicken with sauce, rice" -> "Grilled Chicken"
 */
export function cleanFoodName(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let name = String(raw).trim();
  // Cut at first comma
  name = name.split(',')[0].trim();
  // Strip trailing "of X", "in X", "with X", "on X", "near X", "by X", "and X"
  name = name.replace(/\s+(of|in|with|on|near|by|and|de|en|con|sobre|y)\s+.+$/i, '').trim();
  // Trim to 40 chars
  if (name.length > 40) name = name.slice(0, 40).trim();
  // Title case
  name = name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  return name;
}

/**
 * Unified food scan / detail result modal.
 * source: 'barcode' | 'ai' | 'search'
 *   food: {
 *     name, brand, image_url, calories, protein_g, carbs_g, fat_g,
 *     serving_size, serving_unit, grams?, id?, nutri_score?, items?
 *   }
 */
export default function FoodScanResultModal({
  food,
  source = 'search',
  onSave,      // ({ food, servings, mealType, cal, pro, carb, fat })
  onClose,
  onRetry,
  onToggleFavorite,   // (food) => Promise
  isFavorite = false,
  lang = 'en',
}) {
  const { t } = useTranslation('pages');
  const [servings, setServings] = useState(1);
  const [mealType, setMealType] = useState('snack');
  const [saving, setSaving] = useState(false);
  const [favLocal, setFavLocal] = useState(isFavorite);

  useEffect(() => { setFavLocal(isFavorite); }, [isFavorite]);
  useEffect(() => { setServings(1); setMealType('snack'); }, [food?.name]);

  // Body scroll lock
  useEffect(() => {
    if (!food) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [food]);

  if (!food) return null;

  const displayName = useMemo(() => {
    if (lang === 'es' && food.name_es) return food.name_es;
    return food.name || '';
  }, [food, lang]);

  // Prefer the food's own image (e.g. AI-captured photo or barcode product image)
  // BEFORE falling back to a name-based lookup — otherwise getFoodImage may
  // match a generic image of a similarly-named food and show the wrong picture.
  const imgUrl = foodImageUrl(food.image_url) || getFoodImage(food.name, food.brand) || null;
  const seed = (food.id?.charCodeAt?.(0) || food.name?.charCodeAt?.(0) || 0);

  const s = parseFloat(servings) || 0;
  const cal  = Math.round((food.calories  || 0) * s);
  const pro  = Math.round((food.protein_g || 0) * s * 10) / 10;
  const carb = Math.round((food.carbs_g   || 0) * s * 10) / 10;
  const fat  = Math.round((food.fat_g     || 0) * s * 10) / 10;
  const adjust = (d) => setServings(prev => Math.max(0.5, Math.round((prev + d) * 2) / 2));

  const nutri = food.nutri_score ?? nutriScoreCalc(food.calories, food.protein_g, food.carbs_g, food.fat_g, food.grams || parseFloat(food.serving_size) || 100);

  const servingLabel = food.serving_size
    ? `${food.serving_size}${food.serving_unit || 'g'}`
    : food.grams ? `${food.grams}g` : '';

  const handleLog = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave({
        food: {
          ...food,
          id: food.id || null,
          name: food.name,
        },
        servings: s,
        mealType,
        cal, pro, carb, fat,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleFav = async () => {
    if (!onToggleFavorite) return;
    const next = !favLocal;
    setFavLocal(next);
    try { await onToggleFavorite(food); } catch { setFavLocal(!next); }
  };

  const SourceIcon = source === 'barcode' ? ScanLine : source === 'ai' ? Sparkles : Search;
  const sourceColor = source === 'ai' ? TU.coach : TU.accent;
  const sourceLabel = source === 'barcode'
    ? t('nutrition.scannedProduct', 'Scanned product')
    : source === 'ai'
      ? t('nutrition.aiIdentified', 'AI identified')
      : t('nutrition.foodDetail', 'Food detail');

  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-center justify-center px-4"
         onClick={onClose} role="presentation"
         style={{ fontFamily: TU.display }}>
      <div className="absolute inset-0" style={{ background: 'rgba(20, 14, 8, 0.55)', backdropFilter: 'blur(6px)' }} />
      <div
        className="relative w-full max-w-md flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--color-bg-card)',
          borderRadius: 22,
          border: '1px solid var(--color-border-subtle)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.08)',
          maxHeight: '92vh',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3.5 px-5 pt-3 pb-4" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          {imgUrl ? (
            <img src={imgUrl} alt={displayName} className="w-[64px] h-[64px] rounded-[18px] object-cover flex-shrink-0"
                 style={{ background: 'var(--color-border-subtle)' }} loading="lazy" />
          ) : (
            <FoodTile name={displayName} size={64} seed={seed} />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1 px-2 py-[3px] rounded-full text-[10px] font-bold uppercase"
                style={{ background: `color-mix(in srgb, ${sourceColor} 12%, transparent)`, color: sourceColor, letterSpacing: '0.06em' }}>
                <SourceIcon size={10} />{sourceLabel}
              </span>
              {nutri != null && <NutriScoreBadge score={nutri} />}
            </div>
            <div className="truncate" style={{ fontFamily: '"Archivo", system-ui, sans-serif', fontSize: 26, fontWeight: 900, color: 'var(--color-text-primary)', letterSpacing: -0.6, lineHeight: 1.05 }}>
              {displayName}
            </div>
            {(food.brand || servingLabel) && (
              <div className="text-[12px] mt-1 truncate" style={{ color: 'var(--color-text-muted)' }}>
                {food.brand ? <span>{food.brand}{servingLabel ? ' · ' : ''}</span> : null}
                {servingLabel}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <button onClick={onClose}
              className="w-[34px] h-[34px] rounded-full flex items-center justify-center focus:outline-none"
              style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-subtle)' }}
              aria-label={t('common.close', 'Close')}>
              <X size={15} style={{ color: 'var(--color-text-primary)' }} />
            </button>
            {onToggleFavorite && (
              <button onClick={handleToggleFav}
                className="w-[34px] h-[34px] rounded-full flex items-center justify-center focus:outline-none active:scale-90 transition-transform"
                style={{
                  background: favLocal ? `color-mix(in srgb, ${TU.accent} 15%, transparent)` : 'var(--color-bg-primary)',
                  border: `1px solid ${favLocal ? TU.accent : 'var(--color-border-subtle)'}`,
                }}
                aria-label={favLocal ? t('nutrition.removeFavorite', 'Remove favorite') : t('nutrition.saveFavorite', 'Save favorite')}>
                <Heart size={14} fill={favLocal ? TU.accent : 'none'} style={{ color: favLocal ? TU.accent : 'var(--color-text-muted)' }} />
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2">
          {/* Macro ring / total card */}
          <div className="rounded-[18px] p-4 mb-4" style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-subtle)' }}>
            <div className="flex items-baseline justify-between mb-3.5">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
                  {t('nutrition.total', 'Total')}
                </div>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span style={{ fontFamily: TU.display, fontSize: 34, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -1.3, lineHeight: 1 }}>{cal}</span>
                  <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>kcal</span>
                </div>
              </div>
              <div className="flex items-center gap-2 p-1 rounded-full" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.03))' }}>
                <button onClick={() => adjust(-0.5)} disabled={s <= 0.5}
                  className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[16px] font-bold active:scale-90 disabled:opacity-25"
                  style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }} aria-label={t('nutrition.decreaseServings', 'Decrease servings')}>−</button>
                <span className="min-w-[34px] text-center" style={{ fontFamily: TU.display, fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)' }}>{s}×</span>
                <button onClick={() => adjust(0.5)}
                  className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[16px] font-bold active:scale-90"
                  style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }} aria-label={t('nutrition.increaseServings', 'Increase servings')}>+</button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { l: t('nutrition.protein'), v: pro, c: TU.macroP },
                // Short "Carbs" label avoids overflow when Spanish locale would
                // otherwise expand to "Carbohidratos" and clip the chip.
                { l: t('nutrition.carbsChip', 'Carbs'),   v: carb, c: TU.macroC },
                { l: t('nutrition.fat'),     v: fat, c: TU.macroF },
              ].map(m => (
                <div key={m.l} className="rounded-[12px] p-2.5 min-w-0" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.03))' }}>
                  <div className="flex items-center gap-1.5 mb-1 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-sm flex-shrink-0" style={{ background: m.c }} />
                    <span className="text-[10px] font-bold uppercase truncate" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>{m.l}</span>
                  </div>
                  <div style={{ fontFamily: TU.display, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.6, lineHeight: 1 }}>
                    {m.v}<span className="text-[11px] font-medium ml-0.5" style={{ color: 'var(--color-text-muted)' }}>g</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Identified items list (AI source only) */}
          {source === 'ai' && Array.isArray(food.items) && food.items.length > 0 && (
            <div className="mb-4">
              <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
                {t('nutrition.identifiedItems', 'Identified items')}
              </div>
              <div className="space-y-1.5">
                {food.items.map((item, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-[12px]"
                    style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-subtle)' }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold truncate capitalize" style={{ color: 'var(--color-text-primary)' }}>{cleanFoodName(item.name)}</div>
                      <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                        {item.grams}g · {item.calories} cal · {item.protein_g}g P · {item.fat_g}g F
                      </div>
                    </div>
                    <NutriScoreBadge score={nutriScoreCalc(item.calories, item.protein_g, item.carbs_g, item.fat_g, item.grams)} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Meal slot picker */}
          <div className="mb-3">
            <div className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
              {t('nutrition.logTo', 'Log to')}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {MEAL_TYPES.map(m => (
                <button key={m.key} onClick={() => setMealType(m.key)}
                  className="py-2.5 rounded-[10px] text-[11px] font-bold transition-all active:scale-95 flex flex-col items-center gap-1"
                  style={{
                    background: mealType === m.key ? `color-mix(in srgb, ${TU.accent} 12%, transparent)` : 'var(--color-bg-primary)',
                    border: `1.5px solid ${mealType === m.key ? TU.accent : 'var(--color-border-subtle)'}`,
                    color: mealType === m.key ? TU.accent : 'var(--color-text-primary)',
                  }}>
                  <m.icon size={13} />
                  {t(m.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Retry link (only on scan sources) */}
          {source !== 'search' && onRetry && (
            <button onClick={onRetry}
              className="w-full flex items-center justify-center gap-1.5 py-2 mb-2 text-[12px] font-semibold active:scale-95 transition-transform"
              style={{ color: 'var(--color-text-muted)', background: 'transparent', border: 'none' }}>
              <RefreshCw size={12} />
              {t('nutrition.retryScan', 'Retry scan')}
            </button>
          )}
        </div>

        {/* Footer CTA */}
        <div className="px-4 pt-3 pb-4" style={{
          borderTop: '1px solid var(--color-border-subtle)',
          paddingBottom: 'max(16px, var(--safe-area-bottom, env(safe-area-inset-bottom)))',
        }}>
          <button onClick={handleLog} disabled={saving || s <= 0}
            className="w-full py-[14px] rounded-[14px] font-bold text-[15px] flex items-center justify-center gap-2 active:scale-[0.97] transition-all disabled:opacity-40"
            style={{ background: TU.accent, color: '#001512', fontFamily: TU.display, letterSpacing: -0.2 }}>
            <Check size={16} strokeWidth={2.6} />
            {saving ? t('nutrition.logging', 'Logging…') : t('nutrition.addToLog', 'Add to log')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
