import { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { MEALS } from '../data/meals';
import {
  Plus, Search, X, Clock, ChevronRight, Flame, Trash2,
  Heart, Check, Bookmark, ShoppingCart, ChevronLeft,
  Dumbbell, Zap, TrendingDown, TrendingUp, DollarSign,
  Star, Edit2, Circle, CheckCircle, UtensilsCrossed,
  Sunrise, Sun, Moon, Apple, Camera, CheckCircle2, AlertCircle,
  SlidersHorizontal,
} from 'lucide-react';
import { List as VirtualList } from 'react-window';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { calculateMacros } from '../lib/macroCalculator';
import { format, subDays } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { getFoodImage } from '../lib/foodImages';
import { foodImageUrl } from '../lib/imageUrl';
import { takePhoto } from '../lib/takePhoto';
// scanOverlay removed — camera no longer causes page reloads after Uri fix
import Skeleton from '../components/Skeleton';
import FadeIn from '../components/FadeIn';

const todayStr = () => new Date().toISOString().slice(0, 10);

const MEAL_TYPES = [
  { key: 'breakfast', labelKey: 'nutrition.meals.breakfast', icon: Sunrise, color: '#F97316' },
  { key: 'lunch',     labelKey: 'nutrition.meals.lunch',     icon: Sun,     color: '#F59E0B' },
  { key: 'dinner',    labelKey: 'nutrition.meals.dinner',    icon: Moon,    color: '#8B5CF6' },
  { key: 'snack',     labelKey: 'nutrition.meals.snack',     icon: Apple,   color: '#10B981' },
];

// ── RECIPE DATA (300 meals — imported from src/data/meals.js) ──
const RECIPES = MEALS;
const CATEGORIES = [
  { id: 'high_protein', label: 'High Protein', Icon: Dumbbell,     color: '#10B981' },
  { id: 'fat_loss',     label: 'Fat Loss',     Icon: TrendingDown, color: '#F472B6' },
  { id: 'lean_bulk',    label: 'Lean Bulk',    Icon: TrendingUp,   color: '#D4AF37' },
  { id: 'mass_gain',    label: 'Mass Gain',    Icon: TrendingUp,   color: '#F97316' },
  { id: 'quick_meals',  label: 'Quick Meals',  Icon: Zap,          color: '#F59E0B' },
  { id: 'budget',       label: 'Budget',       Icon: Star,         color: '#60A5FA' },
  { id: 'breakfast',    label: 'Breakfast',    Icon: Flame,        color: '#FBBF24' },
  { id: 'post_workout', label: 'Post-Workout', Icon: Flame,        color: '#EF4444' },
];

const WEEKLY_COLLECTIONS = [
  {
    id: 'wc1', title: '5 High-Protein Dinners',
    subtitle: 'Build muscle with every meal',
    recipeIds: ['r1', 'r2', 'r3', 'r10', 'r25'], accent: '#10B981',
  },
  {
    id: 'wc2', title: 'Easy Meal Prep Sunday',
    subtitle: 'Cook once, eat all week',
    recipeIds: ['r1', 'r9', 'r101', 'r108'], accent: '#D4AF37',
  },
  {
    id: 'wc3', title: 'Cutting Week Meals',
    subtitle: 'Stay in deficit without starving',
    recipeIds: ['r51', 'r62', 'r68', 'r75', 'r80'], accent: '#F472B6',
  },
  {
    id: 'wc4', title: 'Bulk Up This Week',
    subtitle: 'Serious calories for serious gains',
    recipeIds: ['r151', 'r155', 'r161', 'r170', 'r180'], accent: '#F97316',
  },
];

const INGREDIENT_CATEGORIES = {
  Proteins: [
    { id: 'chicken_breast', label: 'Chicken Breast', emoji: '🍗' },
    { id: 'salmon',         label: 'Salmon',         emoji: '🐟' },
    { id: 'lean_beef',      label: 'Lean Beef',      emoji: '🥩' },
    { id: 'eggs',           label: 'Eggs',           emoji: '🥚' },
    { id: 'egg_whites',     label: 'Egg Whites',     emoji: '🥚' },
    { id: 'canned_tuna',    label: 'Canned Tuna',    emoji: '🥫' },
    { id: 'turkey_breast',  label: 'Turkey',         emoji: '🦃' },
    { id: 'ground_turkey',  label: 'Ground Turkey',  emoji: '🥩' },
    { id: 'shrimp',         label: 'Shrimp',         emoji: '🍤' },
    { id: 'chicken_thigh',  label: 'Chicken Thigh',  emoji: '🍗' },
    { id: 'cottage_cheese', label: 'Cottage Cheese', emoji: '🫙' },
    { id: 'protein_powder', label: 'Protein Powder', emoji: '💪' },
  ],
  Carbs: [
    { id: 'rice',             label: 'Rice',             emoji: '🍚' },
    { id: 'pasta',            label: 'Pasta',            emoji: '🍝' },
    { id: 'potato',           label: 'Potato',           emoji: '🥔' },
    { id: 'sweet_potato',     label: 'Sweet Potato',     emoji: '🍠' },
    { id: 'oats',             label: 'Oats',             emoji: '🌾' },
    { id: 'quinoa',           label: 'Quinoa',           emoji: '🌾' },
    { id: 'whole_grain_bread',label: 'Whole Grain Bread',emoji: '🍞' },
    { id: 'tortilla',         label: 'Tortilla',         emoji: '🫓' },
    { id: 'lentils',          label: 'Lentils',          emoji: '🫘' },
    { id: 'black_beans',      label: 'Black Beans',      emoji: '🫘' },
    { id: 'banana',           label: 'Banana',           emoji: '🍌' },
  ],
  Vegetables: [
    { id: 'broccoli',    label: 'Broccoli',    emoji: '🥦' },
    { id: 'spinach',     label: 'Spinach',     emoji: '🥬' },
    { id: 'zucchini',    label: 'Zucchini',    emoji: '🥒' },
    { id: 'cauliflower', label: 'Cauliflower', emoji: '🥦' },
    { id: 'asparagus',   label: 'Asparagus',   emoji: '🌿' },
    { id: 'bell_pepper', label: 'Bell Pepper', emoji: '🫑' },
    { id: 'mushroom',    label: 'Mushrooms',   emoji: '🍄' },
    { id: 'tomato',      label: 'Tomato',      emoji: '🍅' },
    { id: 'lettuce',     label: 'Lettuce',     emoji: '🥬' },
    { id: 'cucumber',    label: 'Cucumber',    emoji: '🥒' },
    { id: 'onion',       label: 'Onion',       emoji: '🧅' },
    { id: 'carrot',      label: 'Carrot',      emoji: '🥕' },
  ],
  Fats: [
    { id: 'avocado',      label: 'Avocado',      emoji: '🥑' },
    { id: 'olive_oil',    label: 'Olive Oil',    emoji: '🫙' },
    { id: 'peanut_butter',label: 'Peanut Butter',emoji: '🥜' },
    { id: 'chia_seeds',   label: 'Chia Seeds',   emoji: '🌱' },
  ],
  Dairy: [
    { id: 'greek_yogurt', label: 'Greek Yogurt', emoji: '🥛' },
    { id: 'cheese',       label: 'Cheese',       emoji: '🧀' },
    { id: 'almond_milk',  label: 'Almond Milk',  emoji: '🥛' },
  ],
  Extras: [
    { id: 'garlic',     label: 'Garlic',     emoji: '🧄' },
    { id: 'soy_sauce',  label: 'Soy Sauce',  emoji: '🍶' },
    { id: 'lemon',      label: 'Lemon',      emoji: '🍋' },
    { id: 'honey',      label: 'Honey',      emoji: '🍯' },
    { id: 'berries',    label: 'Berries',    emoji: '🫐' },
    { id: 'granola',    label: 'Granola',    emoji: '🥣' },
    { id: 'salsa',      label: 'Salsa',      emoji: '🥫' },
    { id: 'sesame_oil', label: 'Sesame Oil', emoji: '🫙' },
  ],
};

const DISCOVER_FILTERS = [
  { id: 'all',          label: 'All' },
  { id: 'high_protein', label: 'High Protein' },
  { id: 'fat_loss',     label: 'Fat Loss' },
  { id: 'lean_bulk',    label: 'Lean Bulk' },
  { id: 'mass_gain',    label: 'Mass Gain' },
  { id: 'quick_meals',  label: 'Under 15 min' },
  { id: 'budget',       label: 'Budget' },
  { id: 'breakfast',    label: 'Breakfast' },
  { id: 'post_workout', label: 'Post-Workout' },
];

const TAG_COLORS = {
  'High Protein': '#10B981', 'Lean': '#10B981', 'Lean Bulk': '#D4AF37',
  'Mass Gain': '#F97316', 'Quick': '#F59E0B', 'Budget': '#60A5FA',
  'Post-Workout': '#EF4444', 'Breakfast': '#FBBF24', 'Fat Loss': '#F472B6',
};

// ── MACRO BAR ───────────────────────────────────────────────
const MacroBar = ({ label, value, max, color, t }) => {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const remaining = Math.max(0, max - Math.round(value));
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-[12px] font-bold text-[#E5E7EB] uppercase tracking-wider">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-black tabular-nums" style={{ color, fontVariantNumeric: 'tabular-nums' }}>{Math.round(value)}</span>
          <span className="text-[11px] text-[#4B5563]">/ {max}g</span>
        </div>
      </div>
      <div className="h-[10px] rounded-full overflow-hidden" style={{ background: 'var(--color-border-subtle)' }}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <p className="text-[10px] mt-1 text-[#4B5563]">
        {remaining > 0 ? `${remaining}g ${t?.('nutrition.left') ?? 'left'}` : (t?.('nutrition.targetHit') ?? 'Target hit!')}
        <span className="ml-2 font-semibold" style={{ color: `${color}90` }}>{Math.round(pct)}%</span>
      </p>
    </div>
  );
};

// ── MACRO RING ───────────────────────────────────────────────
const MacroRing = ({ value, max, color, trackColor, size = 72, strokeWidth = 5, label, unit, hero = false }) => {
  const { t: tRing } = useTranslation('pages');
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const offset = circumference - pct * circumference;
  const remaining = Math.max(0, max - value);
  const gradId = `ring-${label || 'cal'}-${size}`;
  const glowId = `glow-${label || 'cal'}-${size}`;
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={color} stopOpacity="1" />
              <stop offset="100%" stopColor={color} stopOpacity="0.6" />
            </linearGradient>
            <filter id={glowId}>
              <feGaussianBlur stdDeviation={hero ? 4 : 2.5} result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {/* Track ring */}
          <circle cx={size/2} cy={size/2} r={radius} fill="none"
            stroke={trackColor || 'var(--color-border-subtle)'} strokeWidth={strokeWidth}
          />
          {/* Inner shadow track */}
          <circle cx={size/2} cy={size/2} r={radius - strokeWidth * 0.4} fill="none"
            stroke="rgba(0,0,0,0.15)" strokeWidth={strokeWidth * 0.3}
          />
          {/* Active progress */}
          {pct > 0 && (
            <circle cx={size/2} cy={size/2} r={radius} fill="none"
              stroke={`url(#${gradId})`} strokeWidth={strokeWidth}
              strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
              filter={pct > 0.05 ? `url(#${glowId})` : undefined}
              className="transition-all duration-700 ease-out"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-black text-[var(--color-text-primary)] tabular-nums leading-none ${hero ? 'text-[28px]' : 'text-[15px]'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(value)}
          </span>
          <span className={`uppercase tracking-wider font-semibold ${hero ? 'text-[9px] text-[var(--color-text-muted)] mt-1' : 'text-[7px] text-[var(--color-text-muted)] mt-0.5'}`}>
            {unit}
          </span>
        </div>
      </div>
      {label && <p className={`font-semibold mt-2 ${hero ? 'text-[11px] text-[#9CA3AF]' : 'text-[10px] text-[#6B7280]'}`}>{label}</p>}
      {label && (
        <p className="text-[9px] mt-0.5 tabular-nums" style={{ color: remaining > 0 ? 'var(--color-text-subtle)' : color }}>
          {remaining > 0 ? `${Math.round(remaining)} ${tRing('nutrition.left', 'left')}` : tRing('nutrition.targetHit', 'Target hit!')}
        </p>
      )}
    </div>
  );
};

// ── RECIPE CARD ─────────────────────────────────────────────
const RecipeCard = ({ recipe, saved, onSave, onOpen, size = 'md', lang = 'en' }) => {
  const isLg = size === 'lg';
  const mealTag = (lang === 'es' && recipe.tag_es) ? recipe.tag_es : recipe.tag;
  const tagColor = TAG_COLORS[recipe.tag] || '#9CA3AF';
  return (
    <button
      onClick={() => onOpen(recipe)}
      className={`relative flex-shrink-0 rounded-[18px] overflow-hidden bg-[#0F172A] border border-white/[0.06] text-left
        ${isLg ? 'w-[220px]' : 'w-[168px]'}`}
    >
      <div className={`relative overflow-hidden ${isLg ? 'h-[140px]' : 'h-[110px]'}`}>
        <img
          src={foodImageUrl(recipe.image)} alt={(lang === 'es' && recipe.title_es) ? recipe.title_es : recipe.title}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0D14]/80 via-transparent to-transparent" />
        {/* Save button */}
        <button
          onClick={e => { e.stopPropagation(); onSave(recipe.id); }}
          className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center"
        >
          <Bookmark size={13} className={saved ? 'fill-[#D4AF37] text-[#D4AF37]' : 'text-white/70'} />
        </button>
        {/* Tag */}
        <div className="absolute bottom-2 left-2.5">
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${tagColor}22`, color: tagColor }}>
            {mealTag}
          </span>
        </div>
      </div>
      <div className="px-3 py-3">
        <p className="text-[12px] font-bold text-[#E5E7EB] leading-snug mb-2 line-clamp-2">{(lang === 'es' && recipe.title_es) ? recipe.title_es : recipe.title}</p>
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-semibold text-[#F59E0B] tabular-nums">{recipe.calories} cal</span>
          <span className="text-[10px] font-bold text-[#10B981]">{recipe.protein}g P</span>
          <span className="flex items-center gap-0.5 text-[10px] text-[#4B5563]">
            <Clock size={9} />{recipe.prepTime}m
          </span>
        </div>
      </div>
    </button>
  );
};

// ── CATEGORY ROW ────────────────────────────────────────────
const CategoryRow = ({ category, recipes, savedIds, onSave, onOpen, lang = 'en' }) => {
  const { t } = useTranslation('pages');
  const items = (recipes || []).filter(r => r?.category === category.id);
  if (!items.length) return null;
  return (
    <div className="mb-7">
      <div className="flex items-center justify-between mb-3 px-5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ backgroundColor: `${category.color}22` }}>
            <category.Icon size={11} style={{ color: category.color }} />
          </div>
          <span className="text-[13px] font-bold text-[#E5E7EB]">{t(`nutrition.categories.${category.id}`, category.label)}</span>
        </div>
        <span className="text-[11px] text-[#4B5563]">{items.length} {t('nutrition.recipesPlural', 'recipes')}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto scroll-smooth px-5 pb-1 scrollbar-none">
        {items.map(r => (
          <RecipeCard key={r.id} recipe={r} saved={savedIds.has(r.id)} onSave={onSave} onOpen={onOpen} lang={lang} />
        ))}
      </div>
    </div>
  );
};

// ── RECIPE DETAIL MODAL ─────────────────────────────────────
const RecipeDetailModal = ({ recipe, onClose, saved, onSave, onAddToGrocery, groceryAdded, lang = 'en' }) => {
  const { t } = useTranslation('pages');
  if (!recipe) return null;
  const mealTitle = (lang === 'es' && recipe.title_es) ? recipe.title_es : recipe.title;
  const mealTag = (lang === 'es' && recipe.tag_es) ? recipe.tag_es : recipe.tag;
  const mealDifficulty = (lang === 'es' && recipe.difficulty_es) ? recipe.difficulty_es : recipe.difficulty;
  const mealSteps = (lang === 'es' && recipe.steps_es) ? recipe.steps_es : recipe.steps;
  const macros = [
    { label: t('nutrition.dailyCalories', 'Calories'), val: recipe.calories,        unit: 'kcal' },
    { label: t('nutrition.protein'),  val: `${recipe.protein}g`,   unit: '' },
    { label: t('nutrition.carbs'),    val: `${recipe.carbs}g`,     unit: '' },
    { label: t('nutrition.fat'),      val: `${recipe.fat}g`,       unit: '' },
  ];
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md flex flex-col overflow-hidden"
        style={{
          maxHeight: '88vh',
          background: 'var(--color-bg-card)',
          borderRadius: 24,
          border: '1px solid var(--color-border-subtle)',
          boxShadow: '0 32px 64px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.4)',
        }}
      >
        {/* ── Hero image ── */}
        <div className="relative flex-shrink-0 overflow-hidden w-full" style={{ aspectRatio: '10 / 5', borderRadius: '20px 20px 0 0' }}>
          <img src={foodImageUrl(recipe.image)} alt={mealTitle} className="w-full h-full object-cover" />
          {/* gradient overlay */}
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(to top, color-mix(in srgb, var(--color-bg-card) 95%, transparent) 0%, color-mix(in srgb, var(--color-bg-card) 30%, transparent) 50%, transparent 100%)',
          }} />
          {/* close */}
          <button onClick={onClose}
            className="absolute top-3.5 left-3.5 w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-100 opacity-70"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}>
            <X size={15} className="text-white" />
          </button>
          {/* bookmark */}
          <button onClick={() => onSave(recipe.id)}
            className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-100 opacity-70"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}>
            <Bookmark size={15} className={saved ? 'fill-[#D4AF37] text-[#D4AF37]' : 'text-white'} />
          </button>
          {/* title overlay */}
          <div className="absolute bottom-4 left-5 right-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-text-subtle)' }}>
              {mealTag}
            </p>
            <h2 className="text-[21px] font-bold text-white leading-tight">{mealTitle}</h2>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
          <div className="px-5 pt-5 pb-4">

            {/* ── Macros ── */}
            <div className="grid grid-cols-4 gap-2 mb-5">
              {macros.map(m => (
                <div key={m.label} className="flex flex-col items-center py-3 px-1 rounded-2xl"
                  style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}>
                  <span className="text-[17px] font-bold tabular-nums text-[var(--color-text-primary)] leading-none mb-1" style={{ fontVariantNumeric: 'tabular-nums' }}>{m.val}</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{m.label}</span>
                </div>
              ))}
            </div>

            {/* ── Meta row ── */}
            <div className="flex items-center gap-5 mb-6" style={{ color: 'var(--color-text-subtle)' }}>
              <span className="flex items-center gap-1.5 text-[12px]">
                <Clock size={12} />{recipe.prepTime} min
              </span>
              <span className="flex items-center gap-1.5 text-[12px]">
                <UtensilsCrossed size={12} />{mealDifficulty}
              </span>
              <span className="text-[12px]">{t('nutrition.serves', 'Serves')} {recipe.serves}</span>
            </div>

            {/* ── Ingredients ── */}
            <div className="mb-6">
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-3"
                style={{ color: 'var(--color-text-subtle)' }}>{t('nutrition.ingredients')}</p>
              <div className="flex flex-wrap gap-2">
                {recipe.ingredients.map(ing => {
                  const allIngredients = Object.values(INGREDIENT_CATEGORIES || {}).flat();
                  const match = allIngredients.find(i => i.id === ing);
                  return (
                    <span key={ing}
                      className="flex items-center gap-1.5 text-[11px]"
                      style={{
                        padding: '5px 12px',
                        borderRadius: 20,
                        background: 'var(--color-surface-hover)',
                        border: '1px solid var(--color-border-default)',
                        color: 'var(--color-text-muted)',
                      }}>
                      {match?.emoji && <span className="text-[12px]">{match.emoji}</span>}
                      {match ? t(`nutrition_ingredients.items.${match.id}`, match.label) : ing.replace(/_/g, ' ')}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* ── Instructions ── */}
            <div className="mb-6">
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-4"
                style={{ color: 'var(--color-text-subtle)' }}>{t('nutrition.instructions')}</p>
              <div className="flex flex-col gap-4">
                {mealSteps.map((step, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="flex-shrink-0 w-[22px] h-[22px] rounded-full flex items-center justify-center mt-[1px]"
                      style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.2)' }}>
                      <span className="text-[10px] font-bold" style={{ color: '#10B981' }}>{i + 1}</span>
                    </div>
                    <p className="text-[13px] flex-1" style={{ color: 'var(--color-text-primary)', lineHeight: 1.65 }}>{step}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Sticky CTA ── */}
        <div className="flex-shrink-0 px-5 py-4"
          style={{ borderTop: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-card)' }}>
          <button
            onClick={() => onAddToGrocery(recipe)}
            className="w-full flex items-center justify-center gap-2 font-semibold text-[14px] transition-colors"
            style={{
              height: 50,
              borderRadius: 14,
              background: groceryAdded ? 'rgba(16,185,129,0.12)' : '#16A34A',
              color: groceryAdded ? '#10B981' : '#fff',
              border: groceryAdded ? '1px solid rgba(16,185,129,0.25)' : 'none',
            }}
            onMouseEnter={e => { if (!groceryAdded) e.currentTarget.style.background = '#15803D'; }}
            onMouseLeave={e => { if (!groceryAdded) e.currentTarget.style.background = '#16A34A'; }}
          >
            {groceryAdded
              ? <><Check size={16} /> {t('nutrition.addedToGroceryList')}</>
              : <><ShoppingCart size={16} /> {t('nutrition.addToGroceryList')}</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── FOOD SEARCH MODAL ───────────────────────────────────────
const FoodSearchModal = ({ open, onClose, onSelect, onPhotoCapture, favorites = [], recentFoods = [], onToggleFavorite, lang = 'en' }) => {
  const { t } = useTranslation('pages');
  const isEs = lang === 'es';
  const foodName = (food) => (isEs && food.name_es) ? food.name_es : food.name;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState('search');

  useEffect(() => { if (!open) { setQuery(''); setResults([]); setTab('search'); } }, [open]);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      // Sanitize query to prevent PostgREST filter injection
      const safeQuery = query.replace(/[%_\\,()."']/g, '');
      if (!safeQuery) { setResults([]); setSearching(false); return; }
      const { data } = await supabase.from('food_items').select('*')
        .or(`name.ilike.%${safeQuery}%,name_es.ilike.%${safeQuery}%`).limit(20);
      setResults(data || []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  if (!open) return null;
  const favIds = new Set(favorites.map(f => f.food_item_id));
  const displayList = tab === 'recent' ? recentFoods : tab === 'favorites' ? favorites.map(f => f.food_item) : results;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-md flex flex-col rounded-t-[28px] overflow-hidden"
        style={{ background: 'var(--color-bg-secondary)', paddingBottom: 'var(--safe-area-bottom, env(safe-area-inset-bottom))', height: '85vh' }}>
        <div className="px-5 pt-5 pb-3 shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[18px] font-bold text-[#E5E7EB]">{t('nutrition.logFood')}</h3>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/[0.04] flex items-center justify-center">
              <X size={16} className="text-[#6B7280]" />
            </button>
          </div>
          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#4B5563]" />
              <input type="text" value={query} onChange={e => { setQuery(e.target.value); setTab('search'); }}
                placeholder={t('nutrition.searchFoods')} autoFocus
                className="w-full bg-white/[0.04] rounded-xl pl-10 pr-4 py-3 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:bg-white/[0.06] transition-colors" />
            </div>
            {onPhotoCapture && (
              <button
                onClick={async () => {
                  try {
                    const file = await takePhoto();
                    if (file) onPhotoCapture(file);
                  } catch (err) {
                    console.error('[Nutrition] takePhoto failed:', err);
                  }
                }}
                className="w-[46px] h-[46px] rounded-xl bg-[#D4AF37]/10 border border-[#D4AF37]/20 flex items-center justify-center flex-shrink-0 active:scale-90 transition-all"
              >
                <Camera size={18} className="text-[#D4AF37]" />
              </button>
            )}
          </div>
          <div className="flex gap-1">
            {[{ key: 'search', label: t('nutrition.searchTab', 'Search'), Icon: Search }, { key: 'recent', label: t('nutrition.recentTab', 'Recent'), Icon: Clock }, { key: 'favorites', label: t('nutrition.favoritesTab', 'Favorites'), Icon: Heart }]
              .map(tb => (
                <button key={tb.key} onClick={() => setTab(tb.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${tab === tb.key ? 'bg-white/[0.08] text-[#E5E7EB]' : 'text-[#4B5563]'}`}>
                  <tb.Icon size={12} />{tb.label}
                </button>
              ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {searching && <div className="py-8 text-center"><div className="w-6 h-6 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin mx-auto" /></div>}
          {!searching && displayList.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-[13px] text-[#4B5563]">
                {tab === 'search' && query.length < 2 ? t('nutrition.typeToSearch', 'Type to search foods') : tab === 'recent' ? t('nutrition.noRecentFoods', 'No recent foods') : tab === 'favorites' ? t('nutrition.noFavoritesYet', 'No favorites yet') : t('nutrition.noResultsFound', 'No results found')}
              </p>
            </div>
          )}
          <div className="space-y-1">
            {displayList.map(food => food && (
              <button key={food.id} onClick={() => onSelect(food)}
                className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left hover:bg-white/[0.04] transition-colors">
                {(getFoodImage(food.name, food.brand) || foodImageUrl(food.image_url)) && <img src={getFoodImage(food.name, food.brand) || foodImageUrl(food.image_url)} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-[#1E293B]" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{foodName(food)}</p>
                  <p className="text-[10px] text-[#4B5563] mt-0.5">{food.serving_size}{food.serving_unit} · {food.calories} cal · {food.protein_g}p</p>
                </div>
                <button onClick={e => { e.stopPropagation(); onToggleFavorite(food.id); }}
                  className="w-7 h-7 flex items-center justify-center flex-shrink-0">
                  <Heart size={14} className={favIds.has(food.id) ? 'text-[#D4AF37] fill-[#D4AF37]' : 'text-[#2A2F3A]'} />
                </button>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── LOG FOOD MODAL ──────────────────────────────────────────
const LogFoodModal = ({ food, onClose, onLog, lang = 'en' }) => {
  const { t } = useTranslation('pages');
  const [servings, setServings] = useState(1);
  const [mealType, setMealType] = useState('snack');
  const [saving, setSaving] = useState(false);

  if (!food) return null;
  const displayName = (lang === 'es' && food.name_es) ? food.name_es : food.name;
  const s = parseFloat(servings) || 0;
  const cal = Math.round(food.calories * s);
  const pro = Math.round(food.protein_g * s * 10) / 10;
  const carb = Math.round(food.carbs_g * s * 10) / 10;
  const fat = Math.round(food.fat_g * s * 10) / 10;
  const adjust = (d) => setServings(prev => Math.max(0.5, Math.round((prev + d) * 2) / 2));

  const handleLog = async () => {
    setSaving(true);
    await onLog({ food, servings: s, mealType, cal, pro, carb, fat });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
      <div className="relative w-full max-w-md rounded-[24px] overflow-hidden" style={{ background: 'var(--color-bg-secondary)' }} onClick={e => e.stopPropagation()}>
        <div className="relative">
          {(getFoodImage(food.name, food.brand) || foodImageUrl(food.image_url)) ? (
            <div className="relative aspect-square overflow-hidden rounded-t-[24px]">
              <img src={getFoodImage(food.name, food.brand) || foodImageUrl(food.image_url)} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, var(--color-bg-secondary), color-mix(in srgb, var(--color-bg-secondary) 40%, transparent), color-mix(in srgb, black 10%, transparent))' }} />
            </div>
          ) : <div className="h-16" />}
          <button onClick={onClose} className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center z-10">
            <X size={15} className="text-white/60" />
          </button>
          <div className="absolute bottom-0 left-0 right-0 px-5 pb-5">
            <h3 className="text-[22px] font-black text-white leading-tight">{displayName}</h3>
          </div>
        </div>
        <div className="px-5 pt-5 pb-5">
          <div className="mb-6">
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.12em] mb-3">{t('nutrition.servings', 'Servings')}</p>
            <div className="flex items-center justify-center gap-5">
              <button onClick={() => adjust(-0.5)} disabled={s <= 0.5}
                className="w-12 h-12 rounded-2xl bg-[#111827] border border-[#1E293B] flex items-center justify-center text-[#9CA3AF] active:scale-90 transition-all disabled:opacity-25">
                <span className="text-[22px] font-light leading-none">−</span>
              </button>
              <div className="w-24 text-center">
                <p className="text-[32px] font-black leading-none tabular-nums" style={{ color: 'var(--color-text-primary)' }}>{s}</p>
                <p className="text-[10px] text-[#6B7280] mt-1.5">{food.serving_unit}</p>
              </div>
              <button onClick={() => adjust(0.5)}
                className="w-12 h-12 rounded-2xl bg-[#111827] border border-[#1E293B] flex items-center justify-center text-[#9CA3AF] active:scale-90 transition-all">
                <span className="text-[22px] font-light leading-none">+</span>
              </button>
            </div>
          </div>
          <div className="mb-6">
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.12em] mb-3">{t('nutrition.meal', 'Meal')}</p>
            <div className="flex gap-2">
              {MEAL_TYPES.map(m => (
                <button key={m.key} onClick={() => setMealType(m.key)}
                  className={`flex-1 py-3 rounded-xl text-[11px] font-semibold transition-all ${mealType === m.key ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/25' : 'bg-[#111827] text-[#4B5563] border border-[#111827]'}`}>
                  <m.icon size={17} className={`mb-1 transition-all ${mealType === m.key ? '' : 'opacity-50'}`} style={{ color: mealType === m.key ? m.color : '#4B5563' }} />
                  {t(m.labelKey)}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-[#111827] border border-[#1E293B] px-4 py-5 mb-6">
            <div className="grid grid-cols-4 gap-2">
              {[{ v: cal, l: t('nutrition.cal', 'Cal'), c: '#F59E0B' }, { v: `${pro}g`, l: t('nutrition.protein'), c: '#10B981' }, { v: `${carb}g`, l: t('nutrition.carbs'), c: '#60A5FA' }, { v: `${fat}g`, l: t('nutrition.fat'), c: '#A78BFA' }].map(m => (
                <div key={m.l} className="text-center">
                  <p className="text-[20px] font-black leading-none tabular-nums" style={{ color: m.c }}>{m.v}</p>
                  <p className="text-[8px] font-bold text-[#4B5563] uppercase tracking-[0.1em] mt-2">{m.l}</p>
                </div>
              ))}
            </div>
          </div>
          <button onClick={handleLog} disabled={saving || s <= 0}
            className="w-full py-[18px] rounded-2xl font-bold text-[15px] text-black bg-[#D4AF37] hover:bg-[#E6C766] active:scale-[0.97] transition-all disabled:opacity-40">
            {saving ? t('nutrition.logging', 'Logging...') : t('nutrition.logFood')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── FOOD PHOTO RESULT MODAL ─────────────────────────────────
const FoodPhotoResultModal = ({ result, analyzing, error, photoPreview, onClose, onLog, lang = 'en' }) => {
  const { t } = useTranslation('pages');
  const [servings, setServings] = useState(1);
  const [mealType, setMealType] = useState('snack');
  const [saving, setSaving] = useState(false);
  const [editedMacros, setEditedMacros] = useState(null);
  const [totalGrams, setTotalGrams] = useState(0);
  const [originalGrams, setOriginalGrams] = useState(0);

  useEffect(() => {
    if (result) {
      const grams = result.items?.reduce((s, i) => s + (i.grams || 0), 0) || 0;
      setOriginalGrams(grams);
      setTotalGrams(grams);
      setEditedMacros({
        calories: result.total_calories,
        protein_g: result.total_protein_g,
        carbs_g: result.total_carbs_g,
        fat_g: result.total_fat_g,
      });
      setServings(1);
    }
  }, [result]);

  if (!analyzing && !result && !error) return null;

  // When grams change, scale macros proportionally
  const handleGramsChange = (newGrams) => {
    const g = Math.max(1, parseFloat(newGrams) || 0);
    setTotalGrams(g);
    if (originalGrams > 0 && result) {
      const scale = g / originalGrams;
      setEditedMacros({
        calories: Math.round(result.total_calories * scale),
        protein_g: Math.round(result.total_protein_g * scale * 10) / 10,
        carbs_g: Math.round(result.total_carbs_g * scale * 10) / 10,
        fat_g: Math.round(result.total_fat_g * scale * 10) / 10,
      });
    }
  };

  const adjust = (d) => setServings(prev => Math.max(0.5, Math.round((prev + d) * 2) / 2));
  const s = parseFloat(servings) || 0;
  const macros = editedMacros || { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  const cal = Math.round(macros.calories * s);
  const pro = Math.round(macros.protein_g * s * 10) / 10;
  const carb = Math.round(macros.carbs_g * s * 10) / 10;
  const fat = Math.round(macros.fat_g * s * 10) / 10;

  const confidenceColors = { high: '#10B981', medium: '#F59E0B', low: '#EF4444' };

  const handleLog = async () => {
    setSaving(true);
    await onLog({
      food: { id: null, name: result.food_name },
      servings: s, mealType, cal, pro, carb, fat,
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
      <div className="relative w-full max-w-md max-h-[90vh] rounded-[24px] overflow-y-auto" style={{ background: 'var(--color-bg-secondary)' }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center z-10">
          <X size={15} className="text-white/60" />
        </button>

        {/* Loading state */}
        {analyzing && (
          <div className="px-5 py-16 text-center">
            {photoPreview && (
              <div className="w-24 h-24 mx-auto mb-5 rounded-2xl overflow-hidden">
                <img src={photoPreview} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin mx-auto mb-4" />
            <p className="text-[14px] text-[#9CA3AF]">{t('nutrition.analyzingFood', 'Analyzing your food...')}</p>
            <p className="text-[11px] text-[#4B5563] mt-1">{t('nutrition.identifyingItems', 'Identifying items & looking up nutrition')}</p>
          </div>
        )}

        {/* Error state */}
        {error && !analyzing && (
          <div className="px-5 py-12 text-center">
            <AlertCircle size={32} className="text-[#EF4444] mx-auto mb-3" />
            <p className="text-[14px] text-[#E5E7EB] mb-1">{t('nutrition.analysisFailed', 'Analysis Failed')}</p>
            <p className="text-[12px] text-[#6B7280] mb-5">{error}</p>
            <button onClick={onClose} className="px-6 py-2.5 rounded-xl text-[13px] font-semibold text-[#D4AF37] bg-[#D4AF37]/10 border border-[#D4AF37]/20">
              {t('nutrition.tryAgain', 'Try Again')}
            </button>
          </div>
        )}

        {/* Result state */}
        {result && !analyzing && (
          <>
            {/* Photo + food name */}
            <div className="relative">
              {photoPreview ? (
                <div className="relative aspect-[16/9] overflow-hidden rounded-t-[24px]">
                  <img src={photoPreview} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, var(--color-bg-secondary), color-mix(in srgb, var(--color-bg-secondary) 40%, transparent), color-mix(in srgb, black 10%, transparent))' }} />
                </div>
              ) : <div className="h-16" />}
              <div className="absolute bottom-0 left-0 right-0 px-5 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                    style={{ color: confidenceColors[result.confidence], backgroundColor: `${confidenceColors[result.confidence]}15` }}>
                    {result.confidence} {t('nutrition.confidence', 'confidence')}
                  </span>
                </div>
                <h3 className="text-[20px] font-black text-white leading-tight">{result.food_name}</h3>
              </div>
            </div>

            <div className="px-5 pt-4 pb-5">
              {/* Item breakdown */}
              {result.items?.length > 0 && (
                <div className="mb-5">
                  <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.12em] mb-2">{t('nutrition.identifiedItems', 'Identified Items')}</p>
                  <div className="space-y-1.5">
                    {result.items.map((item, i) => (
                      <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[#111827] border border-white/[0.04]">
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-[#E5E7EB] truncate capitalize">{item.name}</p>
                          <p className="text-[10px] text-[#4B5563]">{item.grams}g · {item.calories} cal · {item.protein_g}g P</p>
                        </div>
                        {item.usda_match ? (
                          <CheckCircle2 size={14} className="text-[#10B981] flex-shrink-0" />
                        ) : (
                          <AlertCircle size={14} className="text-[#F59E0B] flex-shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-[9px] text-[#374151] mt-1.5 flex items-center gap-1">
                    <CheckCircle2 size={9} className="text-[#10B981]" /> {t('nutrition.usdaVerified', 'USDA verified')}
                    <span className="mx-1">·</span>
                    <AlertCircle size={9} className="text-[#F59E0B]" /> {t('nutrition.aiEstimate', 'AI estimate')}
                  </p>
                </div>
              )}

              {/* AI disclaimer */}
              <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-[#F59E0B]/8 border border-[#F59E0B]/15 mb-4">
                <AlertCircle size={14} className="text-[#F59E0B] flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-[#F59E0B]/80 leading-relaxed">
                  {t('nutrition.aiDisclaimer', 'AI-estimated values may not be fully accurate. Adjust the portion size or macros below before logging.')}
                </p>
              </div>

              {/* Portion size adjuster */}
              {totalGrams > 0 && (
                <div className="mb-5">
                  <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.12em] mb-3">{t('nutrition.portionSize', 'Portion Size')}</p>
                  <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-[#111827] border border-[#1E293B]">
                    <button onClick={() => handleGramsChange(totalGrams - 10)}
                      className="w-9 h-9 rounded-xl bg-[#0A0F1A] border border-white/[0.06] flex items-center justify-center text-[#9CA3AF] active:scale-90 transition-all">
                      <span className="text-[16px] font-light leading-none">−</span>
                    </button>
                    <div className="flex-1 text-center">
                      <input
                        type="number"
                        inputMode="numeric"
                        value={Math.round(totalGrams) || ''}
                        onFocus={e => e.target.select()}
                        onChange={e => handleGramsChange(e.target.value)}
                        className="w-full text-center text-[24px] font-black text-[var(--color-text-primary)] leading-none tabular-nums bg-transparent outline-none [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                      />
                      <p className="text-[9px] text-[#6B7280] mt-1">{t('nutrition.gramsAdjust', 'grams (adjust to match actual portion)')}</p>
                    </div>
                    <button onClick={() => handleGramsChange(totalGrams + 10)}
                      className="w-9 h-9 rounded-xl bg-[#0A0F1A] border border-white/[0.06] flex items-center justify-center text-[#9CA3AF] active:scale-90 transition-all">
                      <span className="text-[16px] font-light leading-none">+</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Editable macros */}
              <div className="mb-5">
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.12em] mb-3">{t('nutrition.nutritionPerServing', 'Nutrition (per serving)')}</p>
                <div className="rounded-2xl bg-[#111827] border border-[#1E293B] px-4 py-4">
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { key: 'calories', l: t('nutrition.cal', 'Cal'), c: '#F59E0B', unit: '' },
                      { key: 'protein_g', l: t('nutrition.protein'), c: '#10B981', unit: 'g' },
                      { key: 'carbs_g', l: t('nutrition.carbs'), c: '#60A5FA', unit: 'g' },
                      { key: 'fat_g', l: t('nutrition.fat'), c: '#A78BFA', unit: 'g' },
                    ].map(m => (
                      <div key={m.key} className="text-center">
                        <input
                          type="number"
                          inputMode="decimal"
                          value={macros[m.key] || ''}
                          onFocus={e => e.target.select()}
                          onChange={e => setEditedMacros(prev => ({ ...prev, [m.key]: parseFloat(e.target.value) || 0 }))}
                          className="w-full text-center text-[18px] font-black leading-none tabular-nums bg-transparent outline-none [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                          style={{ color: m.c }}
                        />
                        <p className="text-[8px] font-bold text-[#4B5563] uppercase tracking-[0.1em] mt-2">{m.l}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Servings */}
              <div className="mb-5">
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.12em] mb-3">{t('nutrition.servings', 'Servings')}</p>
                <div className="flex items-center justify-center gap-5">
                  <button onClick={() => adjust(-0.5)} disabled={s <= 0.5}
                    className="w-10 h-10 rounded-xl bg-[#111827] border border-[#1E293B] flex items-center justify-center text-[#9CA3AF] active:scale-90 transition-all disabled:opacity-25">
                    <span className="text-[18px] font-light leading-none">−</span>
                  </button>
                  <p className="text-[28px] font-black tabular-nums w-16 text-center" style={{ color: 'var(--color-text-primary)' }}>{s}</p>
                  <button onClick={() => adjust(0.5)}
                    className="w-10 h-10 rounded-xl bg-[#111827] border border-[#1E293B] flex items-center justify-center text-[#9CA3AF] active:scale-90 transition-all">
                    <span className="text-[18px] font-light leading-none">+</span>
                  </button>
                </div>
              </div>

              {/* Meal type */}
              <div className="mb-5">
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.12em] mb-3">{t('nutrition.meal', 'Meal')}</p>
                <div className="flex gap-2">
                  {MEAL_TYPES.map(m => (
                    <button key={m.key} onClick={() => setMealType(m.key)}
                      className={`flex-1 py-3 rounded-xl text-[11px] font-semibold transition-all ${mealType === m.key ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/25' : 'bg-[#111827] text-[#4B5563] border border-[#111827]'}`}>
                      <m.icon size={17} className={`mb-1 transition-all ${mealType === m.key ? '' : 'opacity-50'}`} style={{ color: mealType === m.key ? m.color : '#4B5563' }} />
                      {t(m.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Total + Log button */}
              <div className="rounded-2xl bg-[#111827] border border-[#1E293B] px-4 py-4 mb-5">
                <p className="text-[9px] font-semibold text-[#4B5563] uppercase tracking-[0.12em] mb-2">{t('nutrition.total', 'Total')} ({s} {s !== 1 ? t('nutrition.servingsPlural', 'servings') : t('nutrition.servingSingular', 'serving')})</p>
                <div className="grid grid-cols-4 gap-2">
                  {[{ v: cal, l: t('nutrition.cal', 'Cal'), c: '#F59E0B' }, { v: `${pro}g`, l: t('nutrition.protein'), c: '#10B981' }, { v: `${carb}g`, l: t('nutrition.carbs'), c: '#60A5FA' }, { v: `${fat}g`, l: t('nutrition.fat'), c: '#A78BFA' }].map(m => (
                    <div key={m.l} className="text-center">
                      <p className="text-[18px] font-black leading-none tabular-nums" style={{ color: m.c }}>{m.v}</p>
                      <p className="text-[8px] font-bold text-[#4B5563] uppercase tracking-[0.1em] mt-2">{m.l}</p>
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={handleLog} disabled={saving || s <= 0}
                className="w-full py-[18px] rounded-2xl font-bold text-[15px] text-black bg-[#D4AF37] hover:bg-[#E6C766] active:scale-[0.97] transition-all disabled:opacity-40">
                {saving ? t('nutrition.logging', 'Logging...') : t('nutrition.logFood')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── FOOD LOG DETAIL MODAL ───────────────────────────────────
const FoodLogDetailModal = ({ log, onClose, onUpdate, onDelete, lang = 'en' }) => {
  const { t } = useTranslation('pages');
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (log) {
      setEditValues({
        calories: log.calories,
        protein_g: log.protein_g,
        carbs_g: log.carbs_g,
        fat_g: log.fat_g,
      });
      setEditing(false);
    }
  }, [log]);

  if (!log) return null;

  const displayName = log.food_item
    ? ((lang === 'es' && log.food_item.name_es) ? log.food_item.name_es : log.food_item.name)
    : (log.custom_name || 'Food');
  const isAiLogged = !log.food_item_id;
  const photoSrc = log.photo_url || getFoodImage(log.food_item?.name, log.food_item?.brand) || foodImageUrl(log.food_item?.image_url);
  const loggedAt = new Date(log.created_at);
  const timeStr = loggedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const handleSave = async () => {
    setSaving(true);
    await onUpdate(log.id, {
      calories: parseFloat(editValues.calories) || 0,
      protein_g: parseFloat(editValues.protein_g) || 0,
      carbs_g: parseFloat(editValues.carbs_g) || 0,
      fat_g: parseFloat(editValues.fat_g) || 0,
    });
    setSaving(false);
    setEditing(false);
  };

  const handleDelete = () => {
    onDelete(log.id);
    onClose();
  };

  const mealColor = MEAL_TYPES.find(m => m.key === log.meal_type)?.color || '#6B7280';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" />
      <div className="relative w-full max-w-md max-h-[85vh] rounded-[28px] overflow-y-auto"
        style={{ background: 'var(--color-bg-card)', boxShadow: '0 24px 80px rgba(0,0,0,0.3)', border: '1px solid var(--color-border-subtle)' }}
        onClick={e => e.stopPropagation()}>

        {/* Close button */}
        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center z-10"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)', border: '1px solid var(--color-border-default)' }}>
          <X size={14} className="text-white/70" />
        </button>

        {/* Photo */}
        <div className="relative">
          {photoSrc ? (
            <div className="relative aspect-[4/3] overflow-hidden rounded-t-[28px]">
              <img src={photoSrc} alt="" className="w-full h-full object-cover scale-[1.02]" />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, var(--color-bg-card) 0%, color-mix(in srgb, var(--color-bg-card) 70%, transparent) 35%, color-mix(in srgb, var(--color-bg-card) 15%, transparent) 65%, rgba(0,0,0,0.2) 100%)' }} />
            </div>
          ) : (
            <div className="h-24 rounded-t-[28px]" style={{ background: 'var(--color-bg-deep)' }} />
          )}
          <div className="absolute bottom-0 left-0 right-0 px-6 pb-5">
            <div className="flex items-center gap-2 mb-2">
              {MEAL_TYPES.map(m => m.key).includes(log.meal_type) && (
                <span className="text-[9px] font-bold uppercase tracking-[0.1em] px-2.5 py-[3px] rounded-full"
                  style={{ background: `${mealColor}18`, color: `${mealColor}CC`, border: `1px solid ${mealColor}15` }}>
                  {t(`nutrition.meals.${log.meal_type}`, log.meal_type)}
                </span>
              )}
              <span className="text-[9px] text-[#4B5563] font-medium">{timeStr}</span>
            </div>
            <h3 className="text-[22px] font-black text-white leading-tight tracking-tight">{displayName}</h3>
          </div>
        </div>

        <div className="px-6 pt-5 pb-6">
          {/* AI disclaimer */}
          {isAiLogged && (
            <div className="flex items-start gap-3 px-4 py-3.5 rounded-[14px] mb-5"
              style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.08)' }}>
              <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: 'rgba(245,158,11,0.1)' }}>
                <AlertCircle size={11} className="text-[#F59E0B]/70" />
              </div>
              <p className="text-[10px] text-[#9CA3AF] leading-[1.6]">
                {t('nutrition.aiLoggedDisclaimer', 'Logged via AI photo analysis. Values are estimates —')} <button onClick={() => setEditing(true)} className="text-[#D4AF37] font-semibold">{t('nutrition.tapToEdit', 'tap to edit')}</button>.
              </p>
            </div>
          )}

          {/* Macros */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3.5">
              <p className="text-[10px] font-bold text-[#4B5563] uppercase tracking-[0.15em]">{t('nutrition.nutritionLabel', 'Nutrition')}</p>
              <button onClick={() => setEditing(!editing)}
                className="text-[10px] font-bold tracking-wide transition-colors"
                style={{ color: editing ? '#9CA3AF' : 'var(--color-accent)' }}>
                {editing ? t('nutrition.cancel', 'Cancel') : t('nutrition.edit', 'Edit')}
              </button>
            </div>
            <div className="rounded-[18px] px-4 py-5"
              style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
              {/* Calories hero row */}
              <div className="text-center mb-5">
                {editing ? (
                  <input
                    type="number" inputMode="numeric"
                    value={editValues.calories || ''}
                    onFocus={e => e.target.select()}
                    onChange={e => setEditValues(prev => ({ ...prev, calories: e.target.value }))}
                    className="w-full text-center text-[36px] font-black leading-none tabular-nums bg-transparent outline-none text-[#F59E0B] [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                  />
                ) : (
                  <p className="text-[36px] font-black leading-none tabular-nums text-[#F59E0B]"
                    style={{ textShadow: '0 0 20px rgba(245,158,11,0.15)' }}>
                    {Math.round(log.calories)}
                  </p>
                )}
                <p className="text-[9px] font-bold text-[#4B5563] uppercase tracking-[0.15em] mt-2">{t('nutrition.dailyCalories', 'Calories')}</p>
              </div>
              {/* Macro row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: 'protein_g', l: t('nutrition.protein'), c: '#10B981' },
                  { key: 'carbs_g', l: t('nutrition.carbs'), c: '#60A5FA' },
                  { key: 'fat_g', l: t('nutrition.fat'), c: '#A78BFA' },
                ].map(m => (
                  <div key={m.key} className="text-center py-3 rounded-[12px]"
                    style={{ background: `${m.c}06` }}>
                    {editing ? (
                      <input
                        type="number" inputMode="decimal"
                        value={editValues[m.key] || ''}
                        onFocus={e => e.target.select()}
                        onChange={e => setEditValues(prev => ({ ...prev, [m.key]: e.target.value }))}
                        className="w-full text-center text-[18px] font-black leading-none tabular-nums bg-transparent outline-none [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                        style={{ color: m.c }}
                      />
                    ) : (
                      <p className="text-[20px] font-black leading-none tabular-nums" style={{ color: m.c, textShadow: `0 0 16px ${m.c}15` }}>
                        {Math.round(log[m.key])}<span className="text-[13px] font-bold opacity-60">g</span>
                      </p>
                    )}
                    <p className="text-[8px] font-bold text-[#4B5563] uppercase tracking-[0.12em] mt-2">{m.l}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Servings */}
          <div className="flex items-center justify-between px-1 mb-6">
            <span className="text-[11px] font-medium text-[#4B5563]">{t('nutrition.servings', 'Servings')}</span>
            <span className="text-[14px] font-black text-[#E5E7EB] tabular-nums">{log.servings}</span>
          </div>

          {/* Actions */}
          {editing && (
            <button onClick={handleSave} disabled={saving}
              className="w-full py-[16px] rounded-[16px] font-bold text-[14px] active:scale-[0.97] transition-all disabled:opacity-40 mb-3"
              style={{ background: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-dark) 100%)', color: '#000', boxShadow: '0 4px 16px color-mix(in srgb, var(--color-accent) 20%, transparent), inset 0 1px 0 rgba(255,255,255,0.2)' }}>
              {saving ? t('nutrition.saving') : t('nutrition.saveChanges', 'Save Changes')}
            </button>
          )}

          <button onClick={handleDelete}
            className="w-full py-[13px] rounded-[14px] font-semibold text-[12px] active:scale-[0.97] transition-all"
            style={{ color: '#EF4444AA', background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.08)' }}>
            {t('nutrition.deleteEntry', 'Delete Entry')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── TARGET EDIT MODAL ───────────────────────────────────────
const TargetEditModal = ({ open, onClose, draft, setDraft, onSave, saving, onAutoCalculate }) => {
  const { t } = useTranslation('pages');
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-t-[28px] px-5 pt-6 pb-10"
        style={{ background: 'var(--color-bg-secondary)', paddingBottom: 'max(40px, var(--safe-area-bottom, env(safe-area-inset-bottom)))' }}>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-[18px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.nutritionTargets')}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/[0.04] flex items-center justify-center"><X size={16} className="text-[#6B7280]" /></button>
        </div>
        <button onClick={onAutoCalculate} className="w-full mb-5 py-3 rounded-xl text-[13px] font-semibold text-[#D4AF37] bg-[#D4AF37]/8 border border-[#D4AF37]/15">
          {t('nutrition.autoCalculate')}
        </button>
        <div className="space-y-4">
          {[{ label: t('nutrition.dailyCalories'), key: 'daily_calories', unit: 'kcal' }, { label: t('nutrition.protein'), key: 'daily_protein_g', unit: 'g' }, { label: t('nutrition.carbs'), key: 'daily_carbs_g', unit: 'g' }, { label: t('nutrition.fat'), key: 'daily_fat_g', unit: 'g' }]
            .map(f => (
              <div key={f.key}>
                <label className="block text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-1.5">{f.label}</label>
                <div className="relative">
                  <input type="number" value={draft[f.key] || ''} onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                    className="w-full rounded-xl px-4 py-3 text-[15px] outline-none focus:border-[#D4AF37]/40 transition-colors pr-14"
                    style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-[#4B5563]">{f.unit}</span>
                </div>
              </div>
            ))}
        </div>
        <button onClick={onSave} disabled={saving}
          className="w-full mt-6 py-[18px] rounded-2xl font-bold text-[15px] text-black bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-40 transition-all">
          {saving ? t('nutrition.saving') : t('nutrition.saveTargets')}
        </button>
      </div>
    </div>
  );
};

// ── HOME VIEW ───────────────────────────────────────────────
const HomeView = ({ targets, todayTotals, todayLogs, savedIds, onSave, onOpenRecipe, onOpenSearch, onDeleteLog, onOpenLog, setView, openEdit }) => {
  const { t, i18n } = useTranslation('pages');
  const lang = i18n.language || 'en';
  const calTarget = targets?.daily_calories || 2000;
  const caloriesLeft = Math.max(0, calTarget - todayTotals.calories);
  const caloriesOver = todayTotals.calories > calTarget;

  const mealGroups = MEAL_TYPES.reduce((acc, mt) => {
    acc[mt.key] = todayLogs.filter(l => l.meal_type === mt.key);
    return acc;
  }, {});

  return (
    <div className="pb-36">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-6">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight leading-none" style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.title')}</h1>
          <p className="text-[12px] text-[#4B5563] mt-1 font-medium">{format(new Date(), 'EEEE, MMM d')}</p>
        </div>
        <button onClick={openEdit} className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center active:scale-90 transition-all">
          <Edit2 size={15} className="text-[#6B7280]" />
        </button>
      </div>

      {/* ── Calorie Ring + Macro Rings ── */}
      <div className="mx-5 mb-7 rounded-[20px] overflow-hidden"
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
        {/* Calorie ring hero */}
        <div className="flex flex-col items-center pt-8 pb-5">
          <MacroRing
            value={todayTotals.calories}
            max={calTarget}
            color={caloriesOver ? '#EF4444' : '#F59E0B'}
            size={148}
            strokeWidth={10}
            label=""
            unit="kcal"
            hero
          />
          <p className="text-[11px] text-[#4B5563] mt-3 font-medium tracking-wide">
            {caloriesOver
              ? <span className="text-[#EF4444] font-semibold">{Math.round(todayTotals.calories - calTarget)} {t('nutrition.overTarget', 'over target')}</span>
              : <><span className="text-[#9CA3AF] font-semibold">{Math.round(caloriesLeft)}</span> {t('nutrition.remainingOf', 'remaining of')} <span className="text-[#6B7280]">{calTarget}</span></>
            }
          </p>
        </div>

        {/* Macro mini-rings row */}
        <div className="flex justify-around px-5 pb-6 pt-5 mx-4 border-t border-white/[0.04]">
          <MacroRing value={todayTotals.protein} max={targets?.daily_protein_g || 150} color="#10B981" size={66} strokeWidth={4.5} label={t('nutrition.protein')} unit="g" />
          <MacroRing value={todayTotals.carbs}   max={targets?.daily_carbs_g   || 200} color="#60A5FA" size={66} strokeWidth={4.5} label={t('nutrition.carbs')}   unit="g" />
          <MacroRing value={todayTotals.fat}     max={targets?.daily_fat_g     || 65}  color="#A78BFA" size={66} strokeWidth={4.5} label={t('nutrition.fat')}     unit="g" />
        </div>

        {/* Log food CTA */}
        <div className="px-5 pb-5">
          <button onClick={onOpenSearch}
            className="w-full py-[14px] rounded-[16px] font-bold text-[14px] flex items-center justify-center gap-2 active:scale-[0.97] transition-all"
            style={{ background: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-dark) 100%)', color: '#000', boxShadow: '0 4px 16px color-mix(in srgb, var(--color-accent) 25%, transparent), inset 0 1px 0 rgba(255,255,255,0.2)' }}>
            <Plus size={16} strokeWidth={2.5} />{t('nutrition.addFood')}
          </button>
        </div>
      </div>

      {/* ── Today's Meals ── */}
      <div className="mb-8 px-5">
        <p className="text-[10px] font-extrabold text-[#525C6B] uppercase tracking-[0.18em] mb-5">{t('nutrition.todaysMeals')}</p>
        {MEAL_TYPES.map((mt, idx) => {
          const logs = mealGroups[mt.key];
          const Icon = mt.icon;
          const mealCals = logs.reduce((s, l) => s + (l.calories || 0), 0);
          return (
            <div key={mt.key} className={idx < MEAL_TYPES.length - 1 ? 'mb-5' : ''}>
              {/* Section header */}
              <div className="flex items-center gap-2.5 mb-2.5">
                <div className="w-[22px] h-[22px] rounded-[7px] flex items-center justify-center"
                  style={{ backgroundColor: `${mt.color}12`, boxShadow: `0 0 8px ${mt.color}08` }}>
                  <Icon size={11} style={{ color: mt.color }} />
                </div>
                <span className="text-[12px] font-bold text-[#D1D5DB] capitalize tracking-wide">{t(mt.labelKey)}</span>
                {logs.length > 0 && (
                  <span className="text-[10px] font-semibold ml-auto tabular-nums" style={{ color: `${mt.color}99` }}>{mealCals} cal</span>
                )}
              </div>
              {/* Empty state */}
              {logs.length === 0 ? (
                <button onClick={onOpenSearch}
                  className="w-full py-3.5 rounded-[14px] text-[11px] font-semibold transition-all active:scale-[0.97]"
                  style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-subtle)' }}>
                  <span className="opacity-60">+</span> {t('nutrition.addMealType', 'Add')} {t(mt.labelKey)}
                </button>
              ) : (
                <div className="space-y-2">
                  {logs.slice(0, 3).map(log => {
                    const logImg = log.photo_url || getFoodImage(log.food_item?.name, log.food_item?.brand) || foodImageUrl(log.food_item?.image_url);
                    return (
                      <button key={log.id} onClick={() => onOpenLog(log)}
                        className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-[16px] text-left transition-all active:scale-[0.975]"
                        style={{
                          background: 'var(--color-bg-card)',
                          border: '1px solid var(--color-border-subtle)',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                        }}>
                        {/* Color accent edge */}
                        <div className="absolute left-0 top-[30%] bottom-[30%] w-[2px] rounded-r-full" style={{ backgroundColor: `${mt.color}40` }} />
                        {logImg ? (
                          <div className="relative flex-shrink-0">
                            <img src={logImg} alt="" className="w-10 h-10 rounded-[11px] object-cover bg-[#1E293B]"
                              style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }} />
                          </div>
                        ) : (
                          <div className="w-10 h-10 rounded-[11px] flex-shrink-0 flex items-center justify-center"
                            style={{ backgroundColor: `${mt.color}10` }}>
                            <Icon size={16} style={{ color: `${mt.color}60` }} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-[#F1F3F5] truncate leading-snug">{(lang === 'es' && log.food_item?.name_es) ? log.food_item.name_es : (log.food_item?.name || log.custom_name || 'Food')}</p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[10px] font-semibold tabular-nums" style={{ color: '#F59E0B99' }}>{log.calories} cal</span>
                            <span className="text-[8px] text-[#2A3040]">·</span>
                            <span className="text-[10px] font-medium text-[#4B5563] tabular-nums">{log.protein_g}g P</span>
                            {log.carbs_g > 0 && <>
                              <span className="text-[8px] text-[#2A3040]">·</span>
                              <span className="text-[10px] font-medium text-[#3B4252] tabular-nums">{log.carbs_g}g C</span>
                            </>}
                          </div>
                        </div>
                        <ChevronRight size={14} className="text-[#2A3040] flex-shrink-0 ml-1" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Quick Actions ── */}
      <div className="px-5 grid grid-cols-3 gap-3 mb-4">
        {[
          { view: 'discover', icon: UtensilsCrossed, color: '#D4AF37', label: t('nutrition.recipes') },
          { view: 'saved',    icon: Bookmark,         color: '#F59E0B', label: t('nutrition.savedRecipes') },
          { view: 'grocery',  icon: ShoppingCart,      color: '#60A5FA', label: t('nutrition.groceryList') },
        ].map(a => (
          <button key={a.view} onClick={() => setView(a.view)}
            className="rounded-[16px] p-4 flex flex-col items-center gap-2.5 active:scale-[0.94] transition-all"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}>
            <div className="w-10 h-10 rounded-[12px] flex items-center justify-center"
              style={{ backgroundColor: `${a.color}10`, boxShadow: `0 0 12px ${a.color}08` }}>
              <a.icon size={17} style={{ color: a.color }} />
            </div>
            <p className="text-[10px] font-bold text-[#6B7280] text-center leading-tight tracking-wide">{a.label}</p>
          </button>
        ))}
      </div>
    </div>
  );
};

// ── DISCOVER VIEW ───────────────────────────────────────────
const DiscoverView = ({ setView, savedIds, onSave, onOpenRecipe, onOpenCollection }) => {
  const { t, i18n } = useTranslation('pages');
  const lang = i18n.language || 'en';
  const mealTitle = (r) => (lang === 'es' && r.title_es) ? r.title_es : r.title;
  const mealTag = (r) => (lang === 'es' && r.tag_es) ? r.tag_es : r.tag;
  const [selectedIngredients, setSelectedIngredients] = useState([]);
  const [activeCategory, setActiveCategory] = useState('Proteins');
  const [activeFilter, setActiveFilter] = useState('all');
  const [showResults, setShowResults] = useState(false);
  const [ingredientQuery, setIngredientQuery] = useState('');
  const [showRecipeFilters, setShowRecipeFilters] = useState(false);

  // Lock body scroll when recipe filter modal is open
  useEffect(() => {
    if (showRecipeFilters) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showRecipeFilters]);

  const toggleIngredient = (id) => {
    setSelectedIngredients(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
    setShowResults(false);
  };

  const allIngredients = Object.values(INGREDIENT_CATEGORIES || {}).flat();
  const filteredForQuery = ingredientQuery.length > 0
    ? allIngredients.filter(i => {
        const translatedLabel = t(`nutrition_ingredients.items.${i.id}`, i.label);
        return i.label.toLowerCase().includes(ingredientQuery.toLowerCase()) || translatedLabel.toLowerCase().includes(ingredientQuery.toLowerCase());
      })
    : (INGREDIENT_CATEGORIES[activeCategory] || []);

  const matchedRecipes = useMemo(() => {
    if (selectedIngredients.length === 0) return [];
    return (RECIPES || []).filter(recipe => {
      if (!recipe?.ingredients) return false;
      if (activeFilter !== 'all' && recipe.category !== activeFilter) return false;
      const matchCount = recipe.ingredients.filter(ing => selectedIngredients.includes(ing)).length;
      return matchCount > 0;
    }).map(recipe => {
      const matchCount = recipe.ingredients.filter(ing => selectedIngredients.includes(ing)).length;
      return { ...recipe, matchCount, missing: recipe.ingredients.length - matchCount };
    }).sort((a, b) => a.missing - b.missing);
  }, [selectedIngredients, activeFilter]);

  return (
    <div className="pb-36" >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-5">
        <button onClick={() => setView('home')} className="w-11 h-11 rounded-xl bg-white/[0.04] flex items-center justify-center">
          <ChevronLeft size={18} className="text-[#9CA3AF]" />
        </button>
        <div>
          <h1 className="text-[20px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.cookWithWhatYouHave')}</h1>
          <p className="text-[11px] text-[#4B5563] mt-0.5">{t('nutrition.selectIngredients')}</p>
        </div>
      </div>

      {/* Selected ingredients pills */}
      {selectedIngredients.length > 0 && (
        <div className="px-5 mb-4">
          <div className="flex gap-2 overflow-x-auto scroll-smooth scrollbar-none pb-1">
            {selectedIngredients.map(id => {
              const item = allIngredients.find(i => i.id === id);
              return item ? (
                <button key={id} onClick={() => toggleIngredient(id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#D4AF37]/15 border border-[#D4AF37]/30 text-[11px] font-semibold text-[#D4AF37] flex-shrink-0">
                  {item.emoji} {t(`nutrition_ingredients.items.${item.id}`, item.label)} <X size={10} />
                </button>
              ) : null;
            })}
          </div>
        </div>
      )}

      {/* Ingredient search + filter button */}
      <div className="px-5 mb-4">
        <div className="relative flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#4B5563]" />
            <input type="text" value={ingredientQuery}
              onChange={e => { setIngredientQuery(e.target.value); }}
              placeholder={t('nutrition.searchIngredients', 'Search ingredients...')}
              className="w-full bg-[#0F172A] border border-white/[0.06] rounded-xl pl-10 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/30 transition-colors" />
          </div>
          <button
            onClick={() => setShowRecipeFilters(true)}
            className="relative flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center transition-all active:scale-95"
            style={{
              background: activeFilter !== 'all' ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'var(--color-surface-hover)',
              border: `1px solid ${activeFilter !== 'all' ? 'color-mix(in srgb, var(--color-accent) 30%, transparent)' : 'var(--color-border-subtle)'}`,
              color: activeFilter !== 'all' ? 'var(--color-accent)' : '#6B7280',
            }}
          >
            <SlidersHorizontal size={16} />
            {activeFilter !== 'all' && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#D4AF37] text-black text-[9px] font-bold flex items-center justify-center">1</span>
            )}
          </button>
        </div>
      </div>

      {/* Search results (inline, when typing) */}
      {ingredientQuery.length > 0 && (
        <div className="px-5 mb-4">
          <div className="flex flex-wrap gap-2">
            {filteredForQuery.length === 0 ? (
              <p className="text-[12px] text-[#4B5563]">{t('nutrition.noIngredientsMatch', 'No ingredients match')} "{ingredientQuery}"</p>
            ) : filteredForQuery.map(item => {
              const selected = selectedIngredients.includes(item.id);
              return (
                <button key={item.id} onClick={() => toggleIngredient(item.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-[10px] border transition-all text-[12px] font-medium active:scale-95 ${
                    selected
                      ? 'bg-[#D4AF37]/15 border-[#D4AF37]/40 text-[#D4AF37] font-semibold'
                      : 'bg-white/[0.04] border-white/[0.06] text-[#7B8494]'
                  }`}>
                  <span className="text-[14px] leading-none">{item.emoji}</span>
                  {t(`nutrition_ingredients.items.${item.id}`, item.label)}
                  {selected && <Check size={10} />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected ingredients summary + CTA */}
      {selectedIngredients.length > 0 && (
        <div className="px-5 mb-5">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {selectedIngredients.map(id => {
              const allItems = Object.values(INGREDIENT_CATEGORIES || {}).flat();
              const item = allItems.find(i => i.id === id);
              if (!item) return null;
              return (
                <button key={id} onClick={() => toggleIngredient(id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D4AF37]/15 border border-[#D4AF37]/30 text-[#D4AF37] text-[11px] font-semibold">
                  <span className="text-[13px] leading-none">{item.emoji}</span>
                  {t(`nutrition_ingredients.items.${item.id}`, item.label)}
                  <X size={10} />
                </button>
              );
            })}
          </div>
          <button onClick={() => setShowResults(true)}
            className="w-full py-4 rounded-2xl bg-[#D4AF37] text-black font-bold text-[15px] flex items-center justify-center gap-2 active:scale-[0.97] transition-all">
            <Search size={16} />{t('nutrition.findRecipes', 'Find Recipes')} ({selectedIngredients.length} {selectedIngredients.length !== 1 ? t('nutrition.ingredientsPlural', 'ingredients') : t('nutrition.ingredientSingular', 'ingredient')})
          </button>
        </div>
      )}

      {/* Recipe Filter Bottom Sheet (portaled) */}
      {showRecipeFilters && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
          onClick={e => e.target === e.currentTarget && setShowRecipeFilters(false)}
        >
          <div
            className="w-full max-w-[520px] rounded-t-[24px] pb-8 pt-3 animate-slide-up max-h-[85vh] flex flex-col"
            style={{ background: 'var(--color-bg-deep)', borderTop: '1px solid var(--color-border-default)' }}
          >
            {/* Handle */}
            <div className="w-10 h-1 rounded-full bg-white/10 mx-auto mb-5 flex-shrink-0" />

            <div className="px-6 overflow-y-auto flex-1 scrollbar-none">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-[17px] font-bold text-[#F1F3F5]">{t('nutrition.filtersAndIngredients', 'Filters & Ingredients')}</h3>
                <button
                  onClick={() => { setActiveFilter('all'); setSelectedIngredients([]); setActiveCategory('Proteins'); }}
                  className="text-[13px] font-medium text-[#D4AF37] active:opacity-70"
                >
                  {t('nutrition.resetAll', 'Reset all')}
                </button>
              </div>

              {/* Recipe Category */}
              <div className="mb-6">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] mb-3 text-[#5B6276]">{t('nutrition.recipeType', 'Recipe Type')}</p>
                <div className="flex flex-wrap gap-2">
                  {DISCOVER_FILTERS.map(f => {
                    const active = activeFilter === f.id;
                    return (
                      <button
                        key={f.id}
                        onClick={() => setActiveFilter(f.id)}
                        className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-[10px] transition-all active:scale-95"
                        style={{
                          background: active ? 'var(--color-accent)' : 'var(--color-surface-hover)',
                          color: active ? '#0A0D14' : 'var(--color-text-muted)',
                          border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        {t(`nutrition_ingredients.discoverFilters.${f.id}`, f.label)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Ingredient Category tabs */}
              <div className="mb-4">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] mb-3 text-[#5B6276]">{t('nutrition.ingredients')}</p>
                <div className="flex gap-2 overflow-x-auto scrollbar-none mb-4">
                  {Object.keys(INGREDIENT_CATEGORIES || {}).map(cat => (
                    <button key={cat} onClick={() => setActiveCategory(cat)}
                      className={`px-3.5 py-[7px] rounded-[10px] text-[12.5px] font-medium flex-shrink-0 transition-all active:scale-95 ${
                        activeCategory === cat
                          ? 'bg-[#D4AF37] text-[#0A0D14] font-bold'
                          : 'bg-white/[0.04] text-[#7B8494] border border-white/[0.06]'
                      }`} style={{ border: activeCategory === cat ? '1px solid var(--color-accent)' : undefined }}>
                      {t(`nutrition_ingredients.categoryNames.${cat.toLowerCase()}`, cat)}
                    </button>
                  ))}
                </div>

                {/* Ingredient grid */}
                <div className="flex flex-wrap gap-2">
                  {(INGREDIENT_CATEGORIES[activeCategory] || []).map(item => {
                    const selected = selectedIngredients.includes(item.id);
                    return (
                      <button key={item.id} onClick={() => toggleIngredient(item.id)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-[10px] border transition-all text-[12px] font-medium active:scale-95 ${
                          selected
                            ? 'bg-[#D4AF37]/15 border-[#D4AF37]/40 text-[#D4AF37] font-semibold'
                            : 'bg-white/[0.04] border-white/[0.06] text-[#7B8494]'
                        }`}>
                        <span className="text-[14px] leading-none">{item.emoji}</span>
                        {t(`nutrition_ingredients.items.${item.id}`, item.label)}
                        {selected && <Check size={10} />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selected count */}
              {selectedIngredients.length > 0 && (
                <p className="text-[11px] text-[#D4AF37] font-medium mb-2">
                  {selectedIngredients.length} {selectedIngredients.length !== 1 ? t('nutrition.ingredientsPlural', 'ingredients') : t('nutrition.ingredientSingular', 'ingredient')} {t('nutrition.selected', 'selected')}
                </p>
              )}
            </div>

            <div className="px-6 pt-4 flex-shrink-0">
              <button
                onClick={() => { setShowRecipeFilters(false); if (selectedIngredients.length > 0) setShowResults(true); }}
                className="w-full py-3.5 rounded-xl font-bold text-[14px] active:scale-[0.98] transition-all bg-[#D4AF37] text-[#0A0D14]"
              >
                {selectedIngredients.length > 0
                  ? `${t('nutrition.find', 'Find')} ${matchedRecipes.length} ${matchedRecipes.length !== 1 ? t('nutrition.recipesPlural', 'recipes') : t('nutrition.recipeSingular', 'recipe')}`
                  : t('nutrition.selectIngredientsFirst', 'Select ingredients first')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Recipe Results */}
      {showResults && (
        <div className="px-5">
          <p className="text-[11px] font-bold text-[#4B5563] uppercase tracking-widest mb-4">
            {matchedRecipes.length} {matchedRecipes.length !== 1 ? t('nutrition.recipesPlural', 'recipes') : t('nutrition.recipeSingular', 'recipe')} {t('nutrition.found', 'found')}
          </p>
          {matchedRecipes.length === 0 ? (
            <div className="rounded-[18px] bg-[#0F172A] border border-white/[0.06] p-6 text-center">
              <p className="text-[14px] font-semibold text-[#6B7280] mb-1">{t('nutrition.noMatchesYet', 'No matches yet')}</p>
              <p className="text-[12px] text-[#4B5563]">{t('nutrition.tryAddingMore', 'Try adding more ingredients or changing the filter.')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {matchedRecipes.slice(0, 20).map(recipe => {
                const canMake = recipe.missing === 0;
                const almostThere = recipe.missing <= 2;
                return (
                  <button key={recipe.id} onClick={() => onOpenRecipe(recipe)}
                    className="w-full flex items-center gap-4 rounded-[18px] bg-[#0F172A] border border-white/[0.06] overflow-hidden p-3 text-left active:scale-[0.98] transition-all">
                    <div className="relative w-[72px] h-[72px] rounded-[12px] overflow-hidden flex-shrink-0 bg-[#1E293B]">
                      <img src={foodImageUrl(recipe.image)} alt={mealTitle(recipe)} className="w-full h-full object-cover" loading="lazy" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                          canMake ? 'bg-[#10B981]/15 text-[#10B981]' : almostThere ? 'bg-[#F59E0B]/15 text-[#F59E0B]' : 'bg-white/[0.06] text-[#6B7280]'
                        }`}>
                          {canMake ? `✓ ${t('nutrition.canMakeNow', 'Can make now')}` : `${t('nutrition.needs', 'Needs')} ${recipe.missing} ${t('nutrition.more', 'more')}`}
                        </span>
                      </div>
                      <p className="text-[13px] font-bold text-[#E5E7EB] leading-snug mb-1.5 line-clamp-1">{mealTitle(recipe)}</p>
                      <div className="flex items-center gap-2.5">
                        <span className="text-[11px] font-semibold text-[#F59E0B]">{recipe.calories} cal</span>
                        <span className="text-[11px] font-bold text-[#10B981]">{recipe.protein}g P</span>
                        <span className="flex items-center gap-0.5 text-[10px] text-[#4B5563]"><Clock size={9} />{recipe.prepTime}m</span>
                      </div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); onSave(recipe.id); }}
                      className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/[0.04] flex-shrink-0">
                      <Bookmark size={13} className={savedIds.has(recipe.id) ? 'fill-[#D4AF37] text-[#D4AF37]' : 'text-[#4B5563]'} />
                    </button>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selectedIngredients.length === 0 && (
        <div className="px-5 mt-2">
          <div className="rounded-[18px] bg-[#0F172A] border border-white/[0.06] p-5 text-center">
            <p className="text-[30px] mb-2">🥘</p>
            <p className="text-[14px] font-semibold text-[#6B7280]">{t('nutrition.pickIngredients', 'Pick your ingredients above')}</p>
            <p className="text-[12px] text-[#4B5563] mt-1">{t('nutrition.wellShowRecipes', "We'll show you recipes you can make right now.")}</p>
          </div>
        </div>
      )}

      {/* ── Browse by Category ── */}
      <div className="mt-8 mb-2">
        <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest px-5 mb-5">{t('nutrition.browseRecipes', 'Browse Recipes')}</p>
        {CATEGORIES.map(cat => (
          <CategoryRow key={cat.id} category={cat} recipes={RECIPES} savedIds={savedIds} onSave={onSave} onOpen={onOpenRecipe} lang={lang} />
        ))}
      </div>

      {/* ── Weekly Collections ── */}
      <div className="mb-7">
        <p className="text-[11px] font-bold text-[#4B5563] uppercase tracking-widest px-5 mb-4">{t('nutrition.weeklyCollections', 'Weekly Collections')}</p>
        <div className="px-5 space-y-3">
          {WEEKLY_COLLECTIONS.map(col => {
            const colRecipes = RECIPES.filter(r => col.recipeIds.includes(r.id));
            return (
              <button key={col.id} onClick={() => onOpenCollection(col)}
                className="w-full text-left rounded-[18px] bg-[#0F172A] border border-white/[0.06] overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 pr-3">
                      <h4 className="text-[14px] font-bold text-[#E5E7EB] leading-snug">{t(`nutrition_ingredients.weeklyCollections.${col.id}_title`, col.title)}</h4>
                      <p className="text-[11px] text-[#4B5563] mt-0.5">{t(`nutrition_ingredients.weeklyCollections.${col.id}_subtitle`, col.subtitle)}</p>
                    </div>
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${col.accent}18` }}>
                      <span className="text-[11px] font-black" style={{ color: col.accent }}>{colRecipes.length}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 overflow-x-auto scroll-smooth scrollbar-none">
                    {colRecipes.map(r => (
                      <div key={r.id}
                        className="relative w-[64px] h-[52px] rounded-xl overflow-hidden flex-shrink-0 bg-[#1E293B]">
                        <img src={foodImageUrl(r.image)} alt={mealTitle(r)} className="w-full h-full object-cover" loading="lazy" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                      </div>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── SAVED VIEW ──────────────────────────────────────────────
const SavedView = ({ setView, savedIds, onSave, onOpenRecipe }) => {
  const { t, i18n } = useTranslation('pages');
  const lang = i18n.language || 'en';
  const mealTitle = (r) => (lang === 'es' && r.title_es) ? r.title_es : r.title;
  const mealTag = (r) => (lang === 'es' && r.tag_es) ? r.tag_es : r.tag;
  const savedRecipes = RECIPES.filter(r => savedIds.has(r.id));

  return (
    <div className="pb-36" >
      <div className="flex items-center gap-3 px-5 pt-4 pb-5">
        <button onClick={() => setView('home')} className="w-11 h-11 rounded-xl bg-white/[0.04] flex items-center justify-center">
          <ChevronLeft size={18} className="text-[#9CA3AF]" />
        </button>
        <div>
          <h1 className="text-[20px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.savedRecipes')}</h1>
          <p className="text-[11px] text-[#4B5563] mt-0.5">{savedRecipes.length} {t('nutrition.saved', 'saved')}</p>
        </div>
      </div>

      {savedRecipes.length === 0 ? (
        <div className="mx-5 rounded-[18px] bg-[#0F172A] border border-white/[0.06] p-8 text-center">
          <Bookmark size={28} className="text-[#374151] mx-auto mb-3" />
          <p className="text-[15px] font-bold text-[#6B7280] mb-1">{t('nutrition.noSavedRecipes', 'No saved recipes yet')}</p>
          <p className="text-[12px] text-[#4B5563] mb-4">{t('nutrition.tapBookmark', 'Tap the bookmark icon on any recipe to save it here.')}</p>
          <button onClick={() => setView('home')}
            className="px-5 py-2.5 rounded-xl bg-[#D4AF37]/15 border border-[#D4AF37]/25 text-[13px] font-semibold text-[#D4AF37]">
            {t('nutrition.browseRecipes', 'Browse Recipes')}
          </button>
        </div>
      ) : (
        <div className="px-5">
          <VirtualList
            height={Math.min(savedRecipes.length * 100, 600)}
            itemCount={savedRecipes.length}
            itemSize={100}
            width="100%"
            className="scrollbar-hide"
          >
            {({ index, style }) => {
              const recipe = savedRecipes[index];
              const tagColor = TAG_COLORS[recipe.tag] || '#9CA3AF';
              return (
                <div style={style} className="pb-3">
                  <button key={recipe.id} onClick={() => onOpenRecipe(recipe)}
                    className="w-full flex items-center gap-4 rounded-[18px] bg-[#0F172A] border border-white/[0.06] overflow-hidden p-3 text-left active:scale-[0.98] transition-all">
                    <div className="relative w-[72px] h-[72px] rounded-[12px] overflow-hidden flex-shrink-0 bg-[#1E293B]">
                      <img src={foodImageUrl(recipe.image)} alt={mealTitle(recipe)} className="w-full h-full object-cover" loading="lazy" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="mb-1">
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${tagColor}20`, color: tagColor }}>{mealTag(recipe)}</span>
                      </div>
                      <p className="text-[13px] font-bold text-[#E5E7EB] line-clamp-1 mb-1.5">{mealTitle(recipe)}</p>
                      <div className="flex items-center gap-2.5">
                        <span className="text-[11px] font-semibold text-[#F59E0B]">{recipe.calories} cal</span>
                        <span className="text-[11px] font-bold text-[#10B981]">{recipe.protein}g P</span>
                        <span className="flex items-center gap-0.5 text-[10px] text-[#4B5563]"><Clock size={9} />{recipe.prepTime}m</span>
                      </div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); onSave(recipe.id); }}
                      className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#D4AF37]/10 flex-shrink-0">
                      <Bookmark size={13} className="fill-[#D4AF37] text-[#D4AF37]" />
                    </button>
                  </button>
                </div>
              );
            }}
          </VirtualList>
        </div>
      )}
    </div>
  );
};

// ── GROCERY VIEW ────────────────────────────────────────────
const GroceryView = ({ setView, groceryList, onToggleItem, onClearChecked, onRemoveItem }) => {
  const { t } = useTranslation('pages');
  const grouped = useMemo(() => {
    const groups = {};
    groceryList.forEach(item => {
      const cat = item.category || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    return groups;
  }, [groceryList]);

  const checkedCount = groceryList.filter(i => i.checked).length;

  return (
    <div className="pb-36" >
      <div className="flex items-center justify-between px-5 pt-4 pb-5">
        <div className="flex items-center gap-3">
          <button onClick={() => setView('home')} className="w-11 h-11 rounded-xl bg-white/[0.04] flex items-center justify-center">
            <ChevronLeft size={18} className="text-[#9CA3AF]" />
          </button>
          <div>
            <h1 className="text-[20px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.groceryList')}</h1>
            <p className="text-[11px] text-[#4B5563] mt-0.5">{checkedCount}/{groceryList.length} {t('nutrition.checked', 'checked')}</p>
          </div>
        </div>
        {checkedCount > 0 && (
          <button onClick={onClearChecked}
            className="text-[11px] font-semibold text-[#4B5563] hover:text-[#6B7280] transition-colors px-3 py-1.5 rounded-lg bg-white/[0.04]">
            {t('nutrition.clearChecked', 'Clear checked')}
          </button>
        )}
      </div>

      {groceryList.length === 0 ? (
        <div className="mx-5 rounded-[18px] bg-[#0F172A] border border-white/[0.06] p-8 text-center">
          <ShoppingCart size={28} className="text-[#374151] mx-auto mb-3" />
          <p className="text-[15px] font-bold text-[#6B7280] mb-1">{t('nutrition.groceryListEmpty', 'Your grocery list is empty')}</p>
          <p className="text-[12px] text-[#4B5563] mb-4">{t('nutrition.groceryListEmptyHint', 'Open a recipe and tap "Add to Grocery List" to get started.')}</p>
          <button onClick={() => setView('home')}
            className="px-5 py-2.5 rounded-xl bg-[#D4AF37]/15 border border-[#D4AF37]/25 text-[13px] font-semibold text-[#D4AF37]">
            {t('nutrition.browseRecipes', 'Browse Recipes')}
          </button>
        </div>
      ) : (
        <div className="px-5 space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <p className="text-[10px] font-bold text-[#4B5563] uppercase tracking-widest mb-3">{category}</p>
              <div className="space-y-2">
                {items.map(item => (
                  <div key={item.id}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-[#0F172A] border transition-all ${item.checked ? 'border-white/[0.03] opacity-50' : 'border-white/[0.06]'}`}>
                    <button onClick={() => onToggleItem(item.id)}
                      className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                      {item.checked
                        ? <CheckCircle size={20} className="text-[#10B981]" />
                        : <Circle size={20} className="text-[#374151]" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] font-semibold transition-all ${item.checked ? 'line-through text-[#4B5563]' : 'text-[#E5E7EB]'}`}>
                        {item.label}
                      </p>
                      {item.fromRecipe && (
                        <p className="text-[10px] text-[#4B5563] mt-0.5">{t('nutrition.forRecipe', 'For')}: {item.fromRecipe}</p>
                      )}
                    </div>
                    <button onClick={() => onRemoveItem(item.id)}
                      className="w-6 h-6 flex items-center justify-center flex-shrink-0 opacity-40 hover:opacity-100 transition-opacity">
                      <X size={12} className="text-[#6B7280]" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── BOTTOM NAV ──────────────────────────────────────────────
const NutritionNav = ({ view, setView }) => {
  const { t } = useTranslation('pages');
  const tabs = [
    { id: 'home',     Icon: Flame,      label: t('nutrition.navTrack', 'Track')    },
    { id: 'discover', Icon: Search,     label: t('nutrition.navDiscover', 'Discover') },
    { id: 'saved',    Icon: Bookmark,   label: t('nutrition.navSaved', 'Saved')    },
    { id: 'grocery',  Icon: ShoppingCart, label: t('nutrition.navGrocery', 'Grocery') },
  ];
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-2xl" style={{ background: 'var(--color-nav-bg)', borderTop: '1px solid var(--color-border-subtle)' }}
      style={{ paddingBottom: 'var(--safe-area-bottom, env(safe-area-inset-bottom))' }}>
      <div className="flex mx-auto max-w-[480px]">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setView(tab.id)}
            className={`flex-1 flex flex-col items-center py-3 gap-1 transition-all ${view === tab.id ? 'text-[#D4AF37]' : 'text-[#374151]'}`}>
            <tab.Icon size={20} className={view === tab.id ? 'stroke-[2.5]' : 'stroke-[1.5]'} />
            <span className={`text-[10px] font-semibold ${view === tab.id ? 'text-[#D4AF37]' : 'text-[#4B5563]'}`}>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// ── MAIN ─────────────────────────────────────────────────────
export default function Nutrition() {
  const { user, profile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const lang = i18n.language || 'en';

  const [view, setViewRaw] = useState('home');
  const setView = useCallback((v) => {
    setViewRaw(v);
    // Scroll to top — try multiple methods for Capacitor webview compatibility
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    // Also scroll the nearest scrollable parent
    document.querySelector('.min-h-screen')?.scrollTo(0, 0);
  }, []);
  const [targets, setTargets] = useState(null);
  const [todayLogs, setTodayLogs] = useState([]);
  const [onboarding, setOnboarding] = useState(null);
  const [bodyweight, setBodyweight] = useState(null);
  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState([]);
  const [recentFoods, setRecentFoods] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [logFood, setLogFood] = useState(null);
  const [editing, setEditing] = useState(false);
  const [photoAnalyzing, setPhotoAnalyzing] = useState(false);
  const [photoResult, setPhotoResult] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const [photoPreview, setPhotoPreview] = useState(null);

  // Android-only: resume pending photo analysis after WebView restart.
  // On Samsung Android, the OS destroys the WebView when the camera opens.
  // iOS no longer needs this — the Uri fix prevents the OOM page reload.
  useEffect(() => {
    try {
      const done = localStorage.getItem('_pendingFoodResult');
      if (done) {
        localStorage.removeItem('_pendingFoodResult');
        localStorage.removeItem('_pendingFoodBase64');
        localStorage.removeItem('_pendingFoodThumb');
        localStorage.removeItem('_foodPhotoAnalyzing');
        const { result, preview } = JSON.parse(done);
        if (result?.items?.length) {
          setPhotoResult(result);
          setPhotoPreview(preview || null);
        }
        return;
      }
    } catch {}

    const pendingB64 = localStorage.getItem('_pendingFoodBase64');
    const pendingThumb = localStorage.getItem('_pendingFoodThumb');
    if (pendingB64) {
      localStorage.removeItem('_pendingFoodBase64');
      localStorage.removeItem('_pendingFoodThumb');
      setPhotoAnalyzing(true);
      setPhotoPreview(pendingThumb || null);
      (async () => {
        try {
          const { data, error: fnError } = await supabase.functions.invoke('analyze-food-photo', {
            body: { image: pendingB64, language: i18n.language },
          });
          const result = data || {};
          if (fnError) {
            let msg = fnError.message || 'Analysis service error';
            try { const b = await fnError.context?.json(); if (b?.error) msg = b.error; } catch {}
            throw new Error(msg);
          }
          if (result.error === 'no_food_detected') throw new Error('No food detected in the image. Try a clearer photo.');
          if (result.error) throw new Error(result.error);
          if (!result.items?.length) throw new Error('Could not identify food items');
          setPhotoResult(result);
        } catch (err) {
          setPhotoError(err.message || 'Failed to analyze food photo.');
        } finally {
          setPhotoAnalyzing(false);
        }
      })();
    }
  }, []);

  const [detailLog, setDetailLog] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  // Recipe-level state
  const [openRecipe, setOpenRecipe] = useState(null);
  const [openCollection, setOpenCollection] = useState(null);
  const [savedRecipeIds, setSavedRecipeIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('saved_recipes') || '[]')); } catch { return new Set(); }
  });
  const [groceryList, setGroceryList] = useState(() => {
    try { return JSON.parse(localStorage.getItem('grocery_list') || '[]'); } catch { return []; }
  });
  const [groceryAdded, setGroceryAdded] = useState(new Set());

  // Lock body scroll when any modal is open
  const anyModalOpen = !!openRecipe || !!openCollection || searchOpen || !!logFood || photoAnalyzing || !!photoResult || !!photoError || !!detailLog || editing;
  useEffect(() => {
    if (anyModalOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [anyModalOpen]);

  // Persist saved recipes
  useEffect(() => {
    localStorage.setItem('saved_recipes', JSON.stringify([...savedRecipeIds]));
  }, [savedRecipeIds]);

  // Persist grocery list
  useEffect(() => {
    localStorage.setItem('grocery_list', JSON.stringify(groceryList));
  }, [groceryList]);

  const toggleSaveRecipe = (id) => {
    setSavedRecipeIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleAddToGrocery = (recipe) => {
    const allIngredients = Object.values(INGREDIENT_CATEGORIES || {}).flat();
    const recipeTitle = (lang === 'es' && recipe.title_es) ? recipe.title_es : recipe.title;
    const newItems = recipe.ingredients
      .filter(ing => !groceryList.some(i => i.id === ing && i.fromRecipe === recipeTitle))
      .map(ing => {
        const match = allIngredients.find(i => i.id === ing);
        const catEntry = Object.entries(INGREDIENT_CATEGORIES || {}).find(([, items]) => items.some(i => i.id === ing));
        return {
          id: `${ing}_${recipe.id}`,
          label: match ? t(`nutrition_ingredients.items.${match.id}`, match.label) : ing.replace(/_/g, ' '),
          category: catEntry ? t(`nutrition_ingredients.categoryNames.${catEntry[0].toLowerCase()}`, catEntry[0]) : t('nutrition.other', 'Other'),
          fromRecipe: recipeTitle,
          checked: false,
        };
      });
    setGroceryList(prev => [...prev, ...newItems]);
    setGroceryAdded(prev => new Set([...prev, recipe.id]));
  };

  const handleToggleGroceryItem = (id) => {
    setGroceryList(prev => prev.map(i => i.id === id ? { ...i, checked: !i.checked } : i));
  };

  const handleClearChecked = () => {
    setGroceryList(prev => prev.filter(i => !i.checked));
  };

  const handleRemoveGroceryItem = (id) => {
    setGroceryList(prev => prev.filter(i => i.id !== id));
  };

  // Load data
  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [{ data: tgt }, { data: ob }, { data: bw }, { data: foodLogs }, { data: favs }] = await Promise.all([
      supabase.from('nutrition_targets').select('*').eq('profile_id', user.id).maybeSingle(),
      supabase.from('member_onboarding').select('primary_goal,training_days_per_week,initial_weight_lbs,height_inches,age,sex').eq('profile_id', user.id).maybeSingle(),
      supabase.from('body_weight_logs').select('weight_lbs').eq('profile_id', user.id).order('logged_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('food_logs').select('*, food_item:food_items(name, name_es, brand, serving_size, serving_unit, image_url)').eq('profile_id', user.id).eq('log_date', todayStr()).order('created_at', { ascending: false }),
      supabase.from('favorite_foods').select('food_item_id, food_item:food_items(*)').eq('profile_id', user.id),
    ]);

    setOnboarding(ob ?? null);
    const weight = bw?.weight_lbs ?? ob?.initial_weight_lbs ?? null;
    setBodyweight(weight);
    setTodayLogs(foodLogs ?? []);
    setFavorites(favs ?? []);

    let activeTargets = tgt;
    if (!tgt && weight && ob) {
      const result = calculateMacros({
        weightLbs: parseFloat(weight),
        heightInches: parseFloat(ob.height_inches || 70),
        age: parseInt(ob.age || 25),
        sex: ob.sex || 'male',
        trainingDays: ob.training_days_per_week || 4,
        goal: ob.primary_goal || 'general_fitness',
      });
      const autoTargets = {
        profile_id: user.id, gym_id: profile?.gym_id,
        daily_calories: result.calories, daily_protein_g: result.protein,
        daily_carbs_g: result.carbs, daily_fat_g: result.fat,
        updated_at: new Date().toISOString(),
      };
      const { data: saved } = await supabase.from('nutrition_targets')
        .upsert(autoTargets, { onConflict: 'profile_id' }).select().single();
      activeTargets = saved ?? autoTargets;
    }
    setTargets(activeTargets ?? null);
    setLoading(false);
  }, [user, profile]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!user) return;
    supabase.from('food_logs').select('food_item_id, food_item:food_items(*)')
      .eq('profile_id', user.id).order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => {
        if (!data) return;
        const seen = new Set(); const unique = [];
        for (const row of data) {
          if (row.food_item && !seen.has(row.food_item_id)) {
            seen.add(row.food_item_id); unique.push(row.food_item);
            if (unique.length >= 20) break;
          }
        }
        setRecentFoods(unique);
      });
  }, [user, todayLogs]);

  const todayTotals = useMemo(() => {
    const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    for (const log of todayLogs) {
      t.calories += Number(log.calories) || 0;
      t.protein  += Number(log.protein_g) || 0;
      t.carbs    += Number(log.carbs_g) || 0;
      t.fat      += Number(log.fat_g) || 0;
    }
    return t;
  }, [todayLogs]);

  const handlePhotoCapture = async (file) => {
    setSearchOpen(false);
    setPhotoAnalyzing(true);
    setPhotoResult(null);
    setPhotoError('');
    setPhotoPreview(null);

    try {
      // Validate file exists and has content
      if (!file || file.size === 0) {
        throw new Error('No photo captured. Please try again.');
      }

      // Size guard — takePhoto already compresses, but double-check
      if (file.size > 10 * 1024 * 1024) {
        throw new Error('Photo is too large. Please try a lower resolution.');
      }

      // Load image with timeout to avoid hanging on corrupt files
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        const objectUrl = URL.createObjectURL(file);
        const timeout = setTimeout(() => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Image took too long to load. The file may be corrupted.'));
        }, 15000);
        i.onload = () => { clearTimeout(timeout); URL.revokeObjectURL(objectUrl); resolve(i); };
        i.onerror = () => { clearTimeout(timeout); URL.revokeObjectURL(objectUrl); reject(new Error('Could not load the photo. The file may be corrupted or in an unsupported format.')); };
        i.src = objectUrl;
      });

      // Guard against degenerate dimensions
      if (img.width < 10 || img.height < 10) {
        throw new Error('Photo is too small to analyze.');
      }

      // Thumbnail for preview + DB storage (~10-15KB)
      const thumbCanvas = document.createElement('canvas');
      const thumbScale = Math.min(1, 200 / Math.max(img.width, 1));
      thumbCanvas.width = Math.round(img.width * thumbScale) || 200;
      thumbCanvas.height = Math.round(img.height * thumbScale) || 200;
      thumbCanvas.getContext('2d').drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);
      const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.5);
      setPhotoPreview(thumbnail);

      // AI version (800px, better quality for analysis)
      const aiCanvas = document.createElement('canvas');
      const aiScale = Math.min(1, 800 / Math.max(img.width, 1));
      aiCanvas.width = Math.round(img.width * aiScale) || 800;
      aiCanvas.height = Math.round(img.height * aiScale) || 800;
      aiCanvas.getContext('2d').drawImage(img, 0, 0, aiCanvas.width, aiCanvas.height);
      const compressed = await new Promise((resolve, reject) => {
        try {
          aiCanvas.toBlob(
            (blob) => blob ? resolve(blob) : reject(new Error('Failed to compress photo for analysis.')),
            'image/jpeg',
            0.6
          );
        } catch (e) {
          reject(new Error('Failed to compress photo for analysis.'));
        }
      });

      // Bail if the compressed blob is still too big for the edge function (~4MB base64 ≈ 3MB binary)
      if (compressed.size > 3 * 1024 * 1024) {
        throw new Error('Photo is still too large after compression. Please try a smaller photo.');
      }

      // Convert to base64
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const result = r.result;
          if (!result || typeof result !== 'string') {
            reject(new Error('Failed to read photo data.'));
            return;
          }
          resolve(result.split(',')[1]);
        };
        r.onerror = () => reject(new Error('Failed to read photo data.'));
        r.readAsDataURL(compressed);
      });

      if (!base64 || base64.length < 100) {
        throw new Error('Photo data is empty or corrupted.');
      }

      // Save base64 + thumbnail to localStorage BEFORE the API call.
      // If Android kills the WebView while the request is in flight,
      // the useEffect on mount will pick these up and re-send.
      try {
        localStorage.setItem('_pendingFoodBase64', base64);
        localStorage.setItem('_pendingFoodThumb', thumbnail);
      } catch {}

      // Call edge function
      console.log('[FoodAnalysis] Sending image, base64 length:', base64.length);
      const { data, error: fnError } = await supabase.functions.invoke('analyze-food-photo', {
        body: { image: base64, language: i18n.language },
      });
      console.log('[FoodAnalysis] Response:', { data, fnError: fnError?.message });

      // supabase-js puts non-2xx response body in data, error is a FunctionsHttpError
      const result = data || {};
      if (fnError) {
        let msg = fnError.message || 'Analysis service error';
        try { const b = await fnError.context?.json(); if (b?.error) msg = b.error; } catch {}
        console.error('[FoodAnalysis] Error details:', msg);
        throw new Error(msg);
      }
      if (result.error === 'no_food_detected') throw new Error('No food detected in the image. Try a clearer photo.');
      if (result.error) throw new Error(result.error);
      if (!result.items?.length) throw new Error('Could not identify food items');

      setPhotoResult(result);
    } catch (err) {
      console.error('[FoodAnalysis] handlePhotoCapture error:', err);
      setPhotoError(err.message || 'Failed to analyze food photo. Please try again.');
    } finally {
      setPhotoAnalyzing(false);
    }
  };

  const handleLogFood = async ({ food, servings, mealType, cal, pro, carb, fat }) => {
    // Save AI correction if user modified macros from an AI scan
    if (!food.id && photoResult) {
      const aiCal = photoResult.total_calories;
      const aiPro = photoResult.total_protein_g;
      const aiCarb = photoResult.total_carbs_g;
      const aiFat = photoResult.total_fat_g;
      const aiGrams = photoResult.items?.reduce((s, i) => s + (i.grams || 0), 0) || 0;
      // Only save if user actually changed something
      if (cal !== aiCal || pro !== aiPro || carb !== aiCarb || fat !== aiFat) {
        supabase.from('ai_food_corrections').insert({
          profile_id: user.id,
          food_name: food.name,
          ai_calories: aiCal, ai_protein_g: aiPro, ai_carbs_g: aiCarb, ai_fat_g: aiFat, ai_grams: aiGrams,
          user_calories: cal, user_protein_g: pro, user_carbs_g: carb, user_fat_g: fat, user_grams: aiGrams,
        }); // fire and forget
      }
    }

    const insertPayload = {
      profile_id: user.id, gym_id: profile.gym_id,
      food_item_id: food.id || null,
      custom_name: food.id ? null : food.name,
      photo_url: !food.id && photoPreview ? photoPreview : null,
      meal_type: mealType, log_date: todayStr(), servings,
      calories: cal, protein_g: pro, carbs_g: carb, fat_g: fat,
    };
    const { data, error } = await supabase.from('food_logs')
      .insert(insertPayload)
      .select('*, food_item:food_items(name, name_es, brand, serving_size, serving_unit, image_url)')
      .single();
    if (!error && data) {
      setTodayLogs(prev => [data, ...prev]);
      setLogFood(null);
      setSearchOpen(false);
      setPhotoResult(null);
      setPhotoPreview(null);
    }
  };

  const handleDeleteLog = async (logId) => {
    await supabase.from('food_logs').delete().eq('id', logId);
    setTodayLogs(prev => prev.filter(l => l.id !== logId));
  };

  const handleUpdateLog = async (logId, updates) => {
    const { data, error } = await supabase.from('food_logs')
      .update(updates)
      .eq('id', logId)
      .select('*, food_item:food_items(name, name_es, brand, serving_size, serving_unit, image_url)')
      .single();
    if (!error && data) {
      setTodayLogs(prev => prev.map(l => l.id === logId ? data : l));
      setDetailLog(data);
    }
  };

  const handleToggleFavorite = async (foodItemId) => {
    const exists = favorites.find(f => f.food_item_id === foodItemId);
    if (exists) {
      await supabase.from('favorite_foods').delete().eq('profile_id', user.id).eq('food_item_id', foodItemId);
      setFavorites(prev => prev.filter(f => f.food_item_id !== foodItemId));
    } else {
      const { data } = await supabase.from('favorite_foods')
        .insert({ profile_id: user.id, food_item_id: foodItemId })
        .select('food_item_id, food_item:food_items(*)').single();
      if (data) setFavorites(prev => [...prev, data]);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const payload = {
      profile_id: user.id, gym_id: profile.gym_id,
      daily_calories: draft.daily_calories ? parseInt(draft.daily_calories) : null,
      daily_protein_g: draft.daily_protein_g ? parseInt(draft.daily_protein_g) : null,
      daily_carbs_g: draft.daily_carbs_g ? parseInt(draft.daily_carbs_g) : null,
      daily_fat_g: draft.daily_fat_g ? parseInt(draft.daily_fat_g) : null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('nutrition_targets')
      .upsert(payload, { onConflict: 'profile_id' }).select().single();
    if (!error) { setTargets(data); setEditing(false); }
    setSaving(false);
  };

  const openEdit = () => {
    setDraft({
      daily_calories:  targets?.daily_calories  ?? '',
      daily_protein_g: targets?.daily_protein_g ?? '',
      daily_carbs_g:   targets?.daily_carbs_g   ?? '',
      daily_fat_g:     targets?.daily_fat_g     ?? '',
    });
    setEditing(true);
  };

  const handleAutoCalculate = () => {
    const weight = bodyweight || onboarding?.initial_weight_lbs;
    if (!weight) return;
    const result = calculateMacros({
      weightLbs: parseFloat(weight),
      heightInches: parseFloat(onboarding?.height_inches || 70),
      age: parseInt(onboarding?.age || 25),
      sex: onboarding?.sex || 'male',
      trainingDays: onboarding?.training_days_per_week || 4,
      goal: onboarding?.primary_goal || 'general_fitness',
    });
    setDraft({ daily_calories: result.calories, daily_protein_g: result.protein, daily_carbs_g: result.carbs, daily_fat_g: result.fat });
  };

  if (loading) {
    return (
      <>
        <div className="min-h-screen bg-[#05070B] px-5 pt-6 pb-36">
          <div className="mx-auto max-w-[480px] space-y-4">
            {/* Calorie card skeleton */}
            <div className="rounded-2xl bg-white/[0.04] p-5 space-y-3">
              <div className="h-5 w-24 rounded bg-white/[0.06] animate-pulse" />
              <div className="h-10 w-40 rounded bg-white/[0.06] animate-pulse" />
              <div className="h-2 rounded-full bg-white/[0.06] animate-pulse" />
            </div>
            {/* Macro bars skeleton */}
            <div className="rounded-2xl bg-white/[0.04] p-5 space-y-4">
              {[1,2,3].map(i => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-between">
                    <div className="h-3 w-16 rounded bg-white/[0.06] animate-pulse" />
                    <div className="h-3 w-20 rounded bg-white/[0.06] animate-pulse" />
                  </div>
                  <div className="h-[10px] rounded-full bg-white/[0.06] animate-pulse" />
                </div>
              ))}
            </div>
            {/* Meals skeleton */}
            <div className="rounded-2xl bg-white/[0.04] p-5 space-y-3">
              <div className="h-4 w-28 rounded bg-white/[0.06] animate-pulse" />
              {[1,2].map(i => (
                <div key={i} className="h-14 rounded-xl bg-white/[0.06] animate-pulse" />
              ))}
            </div>
          </div>
        </div>
        {/* Photo analysis modal must render even during loading — on Android,
            the camera return triggers an auth token refresh which re-runs load(),
            setting loading=true. Without this, the modal is never in the DOM. */}
        <FoodPhotoResultModal
          result={photoResult}
          analyzing={photoAnalyzing}
          error={photoError}
          photoPreview={photoPreview}
          onClose={() => { setPhotoResult(null); setPhotoError(''); setPhotoAnalyzing(false); setPhotoPreview(null); try { localStorage.removeItem('_pendingFoodResult'); } catch {} }}
          onLog={handleLogFood}
          lang={lang}
        />
      </>
    );
  }

  const sharedProps = { savedIds: savedRecipeIds, onSave: toggleSaveRecipe, onOpenRecipe: setOpenRecipe, onOpenCollection: setOpenCollection };

  return (
    <FadeIn>
    <div className="min-h-screen bg-[#05070B]">
      <div className="mx-auto w-full max-w-[480px]">
        {view === 'home' && (
          <HomeView
            {...sharedProps}
            targets={targets}
            todayTotals={todayTotals}
            todayLogs={todayLogs}
            onOpenSearch={() => setSearchOpen(true)}
            onDeleteLog={handleDeleteLog}
            onOpenLog={setDetailLog}
            setView={setView}
            openEdit={openEdit}
          />
        )}
        {view === 'discover' && <DiscoverView {...sharedProps} setView={setView} />}
        {view === 'saved'    && <SavedView    {...sharedProps} setView={setView} />}
        {view === 'grocery'  && (
          <GroceryView
            setView={setView}
            groceryList={groceryList}
            onToggleItem={handleToggleGroceryItem}
            onClearChecked={handleClearChecked}
            onRemoveItem={handleRemoveGroceryItem}
          />
        )}
      </div>

      <NutritionNav view={view} setView={setView} />

      {/* Modals */}
      <RecipeDetailModal
        recipe={openRecipe}
        onClose={() => setOpenRecipe(null)}
        saved={openRecipe ? savedRecipeIds.has(openRecipe.id) : false}
        onSave={toggleSaveRecipe}
        onAddToGrocery={handleAddToGrocery}
        groceryAdded={openRecipe ? groceryAdded.has(openRecipe.id) : false}
        lang={lang}
      />

      {/* Collection Detail Modal */}
      {openCollection && (() => {
        const colRecipes = RECIPES.filter(r => openCollection.recipeIds.includes(r.id));
        return (
          <div className="fixed inset-0 z-[70] flex items-end justify-center">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpenCollection(null)} />
            <div className="relative w-full max-w-md overflow-hidden" style={{ maxHeight: '85vh', background: '#0F172A', borderRadius: '24px 24px 0 0', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="sticky top-0 z-10 flex items-center justify-between px-5 pt-5 pb-3 bg-[#0F172A]">
                <div>
                  <h3 className="text-[17px] font-bold text-[#E5E7EB]">{openCollection.title}</h3>
                  <p className="text-[12px] text-[#6B7280] mt-0.5">{openCollection.subtitle}</p>
                </div>
                <button onClick={() => setOpenCollection(null)} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                  <X size={16} className="text-[#9CA3AF]" />
                </button>
              </div>
              <div className="overflow-y-auto px-5 pb-8 space-y-3" style={{ maxHeight: 'calc(85vh - 80px)' }}>
                {colRecipes.map(r => {
                  const title = (lang === 'es' && r.title_es) ? r.title_es : r.title;
                  const tag = (lang === 'es' && r.tag_es) ? r.tag_es : r.tag;
                  return (
                    <button key={r.id} onClick={() => { setOpenCollection(null); setOpenRecipe(r); }}
                      className="w-full flex items-center gap-3 p-3 rounded-2xl bg-[#1E293B]/60 border border-white/[0.04] text-left">
                      <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-[#1E293B]">
                        <img src={foodImageUrl(r.image)} alt={title} className="w-full h-full object-cover" loading="lazy" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{title}</p>
                        <p className="text-[11px] text-[#6B7280] mt-0.5">{tag}</p>
                        <div className="flex gap-3 mt-1">
                          <span className="text-[11px] text-[#9CA3AF]">{r.calories} kcal</span>
                          <span className="text-[11px] text-[#9CA3AF]">{r.protein}g protein</span>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-[#4B5563] flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      <FoodSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={food => { setSearchOpen(false); setLogFood(food); }}
        onPhotoCapture={handlePhotoCapture}
        favorites={favorites}
        recentFoods={recentFoods}
        onToggleFavorite={handleToggleFavorite}
        lang={lang}
      />

      <LogFoodModal
        food={logFood}
        onClose={() => setLogFood(null)}
        onLog={handleLogFood}
        lang={lang}
      />

      <FoodPhotoResultModal
        result={photoResult}
        analyzing={photoAnalyzing}
        error={photoError}
        photoPreview={photoPreview}
        onClose={() => { setPhotoResult(null); setPhotoError(''); setPhotoAnalyzing(false); setPhotoPreview(null); try { localStorage.removeItem('_pendingFoodResult'); } catch {} }}
        onLog={handleLogFood}
        lang={lang}
      />

      <FoodLogDetailModal
        log={detailLog}
        onClose={() => setDetailLog(null)}
        onUpdate={handleUpdateLog}
        onDelete={handleDeleteLog}
        lang={lang}
      />

      <TargetEditModal
        open={editing}
        onClose={() => setEditing(false)}
        draft={draft}
        setDraft={setDraft}
        onSave={handleSave}
        saving={saving}
        onAutoCalculate={handleAutoCalculate}
      />
    </div>
    </FadeIn>
  );
}
