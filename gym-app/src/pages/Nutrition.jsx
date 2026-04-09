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
  SlidersHorizontal, Sparkles, RefreshCw, BarChart2, ChevronDown, ChevronUp,
  Calendar, ScanLine, ScanBarcode, Loader, ArrowUp, ArrowDown,
} from 'lucide-react';
import { List as VirtualList } from 'react-window';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { calculateMacros } from '../lib/macroCalculator';
import { format, subDays } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { getFoodImage } from '../lib/foodImages';
import { foodImageUrl } from '../lib/imageUrl';
import { takePhoto } from '../lib/takePhoto';
// scanOverlay removed — camera no longer causes page reloads after Uri fix
import Skeleton from '../components/Skeleton';
import FadeIn from '../components/FadeIn';
import { suggestMeals, generateDayPlan, generateWeekPlan, suggestPostWorkoutMeal } from '../lib/mealPlanner';

// ── NUTRI-SCORE (0-100) ──────────────────────────────────────
function nutriScore(calories, protein_g, carbs_g, fat_g, grams) {
  if (!grams || grams <= 0) return null;

  // Normalize to per 100g
  const scale = 100 / grams;
  const cal100 = calories * scale;
  const pro100 = protein_g * scale;
  const fat100 = fat_g * scale;

  // Start at 50 (neutral)
  let score = 50;

  // Protein ratio bonus (high protein = healthier) — up to +25
  const proteinRatio = (protein_g * 4) / Math.max(calories, 1);
  score += Math.min(proteinRatio * 60, 25);

  // Calorie density penalty — very calorie-dense foods score lower
  if (cal100 < 100) score += 15;
  else if (cal100 < 200) score += 8;
  else if (cal100 > 400) score -= 15;
  else if (cal100 > 300) score -= 8;

  // Fat ratio penalty — high fat % of total calories
  const fatRatio = (fat_g * 9) / Math.max(calories, 1);
  if (fatRatio > 0.5) score -= 12;
  else if (fatRatio > 0.35) score -= 5;
  else if (fatRatio < 0.2) score += 5;

  // Protein absolute bonus — high protein foods are good
  if (pro100 > 20) score += 10;
  else if (pro100 > 10) score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

const NutriScoreBadge = ({ score }) => {
  if (score == null) return null;
  const color = score >= 80 ? '#22C55E' : score >= 60 ? '#84CC16' : score >= 40 ? '#EAB308' : score >= 20 ? '#F97316' : '#EF4444';
  return (
    <span className="inline-flex items-center justify-center w-8 h-5 rounded-md text-[10px] font-bold text-white flex-shrink-0"
      style={{ backgroundColor: color }}>
      {score}
    </span>
  );
};

const toLocalDateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const todayStr = () => toLocalDateStr(new Date());

const MEAL_TYPES = [
  { key: 'breakfast', labelKey: 'nutrition.meals.breakfast', icon: Sunrise, color: '#F97316' },
  { key: 'lunch',     labelKey: 'nutrition.meals.lunch',     icon: Sun,     color: 'var(--color-warning)' },
  { key: 'dinner',    labelKey: 'nutrition.meals.dinner',    icon: Moon,    color: '#8B5CF6' },
  { key: 'snack',     labelKey: 'nutrition.meals.snack',     icon: Apple,   color: 'var(--color-success)' },
];

// ── RECIPE DATA (300 meals — imported from src/data/meals.js) ──
const RECIPES = MEALS;
const CATEGORIES = [
  { id: 'high_protein', label: 'High Protein', Icon: Dumbbell,     color: 'var(--color-success)' },
  { id: 'fat_loss',     label: 'Fat Loss',     Icon: TrendingDown, color: '#F472B6' },
  { id: 'lean_bulk',    label: 'Lean Bulk',    Icon: TrendingUp,   color: 'var(--color-accent)' },
  { id: 'mass_gain',    label: 'Mass Gain',    Icon: TrendingUp,   color: '#F97316' },
  { id: 'quick_meals',  label: 'Quick Meals',  Icon: Zap,          color: 'var(--color-warning)' },
  { id: 'budget',       label: 'Budget',       Icon: Star,         color: 'var(--color-blue-soft)' },
  { id: 'breakfast',    label: 'Breakfast',    Icon: Flame,        color: '#FBBF24' },
  { id: 'post_workout', label: 'Post-Workout', Icon: Flame,        color: 'var(--color-danger)' },
];

const WEEKLY_COLLECTIONS = [
  {
    id: 'wc1', title: '5 High-Protein Dinners',
    subtitle: 'Build muscle with every meal',
    recipeIds: ['r1', 'r2', 'r3', 'r10', 'r25'], accent: 'var(--color-success)',
  },
  {
    id: 'wc2', title: 'Easy Meal Prep Sunday',
    subtitle: 'Cook once, eat all week',
    recipeIds: ['r1', 'r9', 'r101', 'r108'], accent: 'var(--color-accent)',
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
  'High Protein': 'var(--color-success)', 'Lean': 'var(--color-success)', 'Lean Bulk': 'var(--color-accent)',
  'Mass Gain': '#F97316', 'Quick': 'var(--color-warning)', 'Budget': 'var(--color-blue-soft)',
  'Post-Workout': 'var(--color-danger)', 'Breakfast': '#FBBF24', 'Fat Loss': '#F472B6',
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
          <span className="text-[11px] text-[#9CA3AF]">/ {max}g</span>
        </div>
      </div>
      <div className="h-[10px] rounded-full overflow-hidden" style={{ background: 'var(--color-border-subtle)' }}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <p className="text-[10px] mt-1 text-[#9CA3AF]">
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
          <span className={`font-black text-[var(--color-text-primary)] tabular-nums leading-none ${hero ? 'text-[24px]' : 'text-[15px]'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
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
  const tagColor = TAG_COLORS[recipe.tag] || 'var(--color-text-muted)';
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
          className="absolute top-2.5 right-2.5 min-w-[44px] min-h-[44px] w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          aria-label={saved ? 'Remove bookmark' : 'Bookmark recipe'}
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
          <span className="flex items-center gap-0.5 text-[10px] text-[#9CA3AF]">
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
  const items = useMemo(
    () => (recipes || []).filter(r => r?.category === category.id),
    [recipes, category.id]
  );
  if (!items.length) return null;
  return (
    <div className="mb-7">
      <div className="flex items-center justify-between mb-3 px-4">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ backgroundColor: `${category.color}22` }}>
            <category.Icon size={11} style={{ color: category.color }} />
          </div>
          <span className="text-[13px] font-bold text-[#E5E7EB]">{t(`nutrition.categories.${category.id}`, category.label)}</span>
        </div>
        <span className="text-[11px] text-[#9CA3AF]">{items.length} {t('nutrition.recipesPlural', 'recipes')}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto scroll-smooth px-4 pb-1 scrollbar-none">
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
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} role="presentation" />
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
          <img src={foodImageUrl(recipe.image)} alt={mealTitle} className="w-full h-full object-cover" loading="lazy" />
          {/* gradient overlay */}
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(to top, color-mix(in srgb, var(--color-bg-card) 95%, transparent) 0%, color-mix(in srgb, var(--color-bg-card) 30%, transparent) 50%, transparent 100%)',
          }} />
          {/* close */}
          <button onClick={onClose}
            className="absolute top-3.5 left-3.5 min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-100 opacity-70 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}
            aria-label="Close">
            <X size={15} className="text-white" />
          </button>
          {/* bookmark */}
          <button onClick={() => onSave(recipe.id)}
            className="absolute top-3.5 right-3.5 min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-100 opacity-70 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}
            aria-label={saved ? 'Remove bookmark' : 'Bookmark recipe'}>
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
                <div key={m.label} className="flex flex-col items-center justify-center text-center py-3 px-1 rounded-2xl"
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
                      {t(`nutrition_ingredients.items.${ing}`, match?.label || ing.replace(/_/g, ' '))}
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
                      <span className="text-[10px] font-bold" style={{ color: 'var(--color-success)' }}>{i + 1}</span>
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
              color: groceryAdded ? 'var(--color-success)' : '#fff',
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

// ── BARCODE LOOKUP HELPER ────────────────────────────────────
const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

const lookupBarcode = async (barcode, lang = 'en') => {
  // Use locale-specific API endpoint for translated product names
  const host = lang === 'es' ? 'es.openfoodfacts.org' : 'world.openfoodfacts.org';
  const res = await fetch(`https://${host}/api/v2/product/${encodeURIComponent(barcode)}.json`);
  if (!res.ok) throw new Error('network');
  const json = await res.json();
  if (json.status !== 1 || !json.product) return null;
  const p = json.product;
  const n = p.nutriments || {};
  const servingG = parseFloat(p.serving_quantity) || 100;
  const factor = servingG / 100;
  // Prefer localized name, fall back to generic
  const rawName = (lang === 'es' && p[`product_name_${lang}`]) || p.product_name || barcode;
  return {
    name: capitalize(rawName),
    serving_size: p.serving_size || `${servingG}g`,
    serving_g: servingG,
    calories: Math.round((n['energy-kcal_100g'] || 0) * factor),
    protein_g: Math.round(((n.proteins_100g || 0) * factor) * 10) / 10,
    carbs_g: Math.round(((n.carbohydrates_100g || 0) * factor) * 10) / 10,
    fat_g: Math.round(((n.fat_100g || 0) * factor) * 10) / 10,
    image_url: p.image_front_small_url || null,
    barcode,
  };
};

// ── BARCODE RESULT MODAL ────────────────────────────────────
const BarcodeResultModal = ({ product, onClose, onLog }) => {
  const { t } = useTranslation('pages');
  const [servings, setServings] = useState(1);
  const [mealType, setMealType] = useState('snack');
  const [saving, setSaving] = useState(false);
  if (!product) return null;

  const s = parseFloat(servings) || 0;
  const cal = Math.round(product.calories * s);
  const pro = Math.round(product.protein_g * s * 10) / 10;
  const carb = Math.round(product.carbs_g * s * 10) / 10;
  const fat = Math.round(product.fat_g * s * 10) / 10;
  const adjust = (d) => setServings(prev => Math.max(0.5, Math.round((prev + d) * 2) / 2));

  const handleLog = async () => {
    setSaving(true);
    await onLog({
      food: {
        id: null,
        name: product.name,
        calories: product.calories,
        protein_g: product.protein_g,
        carbs_g: product.carbs_g,
        fat_g: product.fat_g,
        serving_size: parseFloat(product.serving_g) || 100,
        serving_unit: 'g',
      },
      servings: s, mealType, cal, pro, carb, fat, isBarcode: true,
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center px-4" onClick={onClose} role="presentation">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
      <div className="relative w-full max-w-md rounded-[24px] overflow-hidden bg-[#0F172A]" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ScanLine size={16} className="text-[#D4AF37]" />
              <h3 className="text-[16px] font-bold text-[#E5E7EB]">{t('nutrition.scannedProduct')}</h3>
            </div>
            <button onClick={onClose} className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center" aria-label="Close">
              <X size={15} className="text-[#6B7280]" />
            </button>
          </div>
          {product.image_url && <img src={product.image_url} alt="Scanned product" className="w-16 h-16 rounded-xl object-cover mb-3 bg-[#1E293B]" loading="lazy" />}
          <p className="text-[18px] font-black text-[#E5E7EB] mb-1">{product.name}</p>
          <p className="text-[11px] text-[#9CA3AF] mb-4">{product.serving_size} {t('nutrition.perServing')}</p>
        </div>
        {/* Macro chips */}
        <div className="px-5 pb-3">
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Cal', value: cal, color: '#D4AF37' },
              { label: t('nutrition.protein'), value: `${pro}g`, color: '#10B981' },
              { label: t('nutrition.carbs'), value: `${carb}g`, color: '#60A5FA' },
              { label: t('nutrition.fat'), value: `${fat}g`, color: '#A78BFA' },
            ].map(m => (
              <div key={m.label} className="rounded-[10px] p-2 text-center" style={{ background: `${m.color}10`, border: `1px solid ${m.color}20` }}>
                <p className="text-[10px] font-bold" style={{ color: `${m.color}99` }}>{m.label}</p>
                <p className="text-[14px] font-bold" style={{ color: m.color }}>{m.value}</p>
              </div>
            ))}
          </div>
        </div>
        {/* Serving adjust */}
        <div className="px-5 pb-3">
          <p className="text-[11px] font-bold text-[#525C6B] uppercase tracking-wider mb-2">{t('nutrition.servingCount')}</p>
          <div className="flex items-center gap-3">
            <button onClick={() => adjust(-0.5)} className="w-9 h-9 rounded-full bg-white/[0.06] flex items-center justify-center text-[#E5E7EB] font-bold text-lg active:scale-90" aria-label="Decrease servings">−</button>
            <span className="text-[20px] font-bold text-[#E5E7EB] tabular-nums w-12 text-center">{servings}</span>
            <button onClick={() => adjust(0.5)} className="w-9 h-9 rounded-full bg-white/[0.06] flex items-center justify-center text-[#E5E7EB] font-bold text-lg active:scale-90" aria-label="Increase servings">+</button>
          </div>
        </div>
        {/* Meal type */}
        <div className="px-5 pb-3">
          <p className="text-[11px] font-bold text-[#525C6B] uppercase tracking-wider mb-2">{t('nutrition.meal')}</p>
          <div className="flex gap-1.5">
            {MEAL_TYPES.map(mt => (
              <button key={mt.key} onClick={() => setMealType(mt.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all ${mealType === mt.key ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'bg-white/[0.04] text-[#9CA3AF]'}`}>
                <mt.icon size={11} />{t(`nutrition.meals.${mt.key}`)}
              </button>
            ))}
          </div>
        </div>
        {/* Log button */}
        <div className="px-5 pb-5 pt-2">
          <button onClick={handleLog} disabled={saving}
            className="w-full py-3.5 rounded-xl font-bold text-[15px] text-black bg-[#D4AF37] hover:bg-[#C4A030] active:scale-[0.97] transition-all disabled:opacity-50">
            {saving ? t('nutrition.logging') : t('nutrition.logScannedFood')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── FOOD SEARCH MODAL ───────────────────────────────────────
const FoodSearchModal = ({ open, onClose, onSelect, onPhotoCapture, onBarcodeResult, favorites = [], recentFoods = [], onToggleFavorite, lang = 'en' }) => {
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
      const { data } = await supabase.from('food_items').select('id, name, name_es, brand, image_url, serving_size, serving_unit, calories, protein_g, carbs_g, fat_g')
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
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} role="presentation" />
      <div className="relative w-full max-w-md flex flex-col rounded-t-[28px] overflow-hidden"
        style={{ background: 'var(--color-bg-secondary)', paddingBottom: 'var(--safe-area-bottom, env(safe-area-inset-bottom))', height: '85vh' }}>
        <div className="px-5 pt-5 pb-3 shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[18px] font-bold text-[#E5E7EB]">{t('nutrition.logFood')}</h3>
            <button onClick={onClose} className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full bg-white/[0.04] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" aria-label="Close">
              <X size={16} className="text-[#6B7280]" />
            </button>
          </div>
          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
              <input type="text" value={query} onChange={e => { setQuery(e.target.value); setTab('search'); }}
                placeholder={t('nutrition.searchFoods')}
                aria-label={t('nutrition.searchFoods')}
                className="w-full bg-white/[0.04] rounded-xl pl-10 pr-4 py-3 text-[14px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:ring-2 focus:ring-[#D4AF37] transition-colors" />
            </div>
          </div>
          {/* ── Scan buttons row ── */}
          {(onPhotoCapture || onBarcodeResult) && (
            <div className="flex gap-3 mb-3">
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
                  className="flex-1 flex flex-col items-center gap-2 p-4 rounded-2xl active:scale-[0.97] transition-all"
                  style={{ background: 'var(--color-surface-hover, rgba(255,255,255,0.06))', border: '1px solid var(--color-border-subtle)' }}
                >
                  <Camera size={22} style={{ color: 'var(--color-accent, #D4AF37)' }} />
                  <span className="text-[13px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.scanFood')}</span>
                </button>
              )}
              {onBarcodeResult && (
                <button
                  onClick={() => onBarcodeResult('__open_scanner__')}
                  className="flex-1 flex flex-col items-center gap-2 p-4 rounded-2xl active:scale-[0.97] transition-all"
                  style={{ background: 'var(--color-surface-hover, rgba(255,255,255,0.06))', border: '1px solid var(--color-border-subtle)' }}
                >
                  <ScanBarcode size={22} className="text-emerald-400" />
                  <span className="text-[13px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.barcodeLabel')}</span>
                </button>
              )}
            </div>
          )}
          <div className="flex gap-1">
            {[{ key: 'search', label: t('nutrition.searchTab', 'Search'), Icon: Search }, { key: 'recent', label: t('nutrition.recentTab', 'Recent'), Icon: Clock }, { key: 'favorites', label: t('nutrition.favoritesTab', 'Favorites'), Icon: Heart }]
              .map(tb => (
                <button key={tb.key} onClick={() => setTab(tb.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${tab === tb.key ? 'bg-white/[0.08] text-[#E5E7EB]' : 'text-[#9CA3AF]'}`}>
                  <tb.Icon size={12} />{tb.label}
                </button>
              ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {searching && <div className="py-8 text-center" aria-busy={true} aria-label="Searching foods"><div className="w-6 h-6 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin mx-auto" role="status"><span className="sr-only">Loading</span></div></div>}
          {!searching && displayList.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-[13px] text-[#9CA3AF]">
                {tab === 'search' && query.length < 2 ? t('nutrition.typeToSearch', 'Type to search foods') : tab === 'recent' ? t('nutrition.noRecentFoods', 'No recent foods') : tab === 'favorites' ? t('nutrition.noFavoritesYet', 'No favorites yet') : t('nutrition.noResultsFound', 'No results found')}
              </p>
            </div>
          )}
          <div className="space-y-1">
            {displayList.map(food => food && (
              <button key={food.id} onClick={() => onSelect(food)}
                className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left hover:bg-white/[0.04] transition-colors">
                {(getFoodImage(food.name, food.brand) || foodImageUrl(food.image_url)) && <img src={getFoodImage(food.name, food.brand) || foodImageUrl(food.image_url)} alt={foodName(food)} className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-[#1E293B]" loading="lazy" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{foodName(food)}</p>
                  <p className="text-[10px] text-[#9CA3AF] mt-0.5">{food.serving_size}{food.serving_unit} · {food.calories} cal · {food.protein_g}p</p>
                </div>
                <NutriScoreBadge score={nutriScore(food.calories, food.protein_g, food.carbs_g, food.fat_g, food.serving_size || 100)} />
                <button onClick={e => { e.stopPropagation(); onToggleFavorite(food.id); }}
                  className="min-w-[44px] min-h-[44px] w-7 h-7 flex items-center justify-center flex-shrink-0 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                  aria-label={favIds.has(food.id) ? 'Remove from favorites' : 'Add to favorites'}>
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
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4" onClick={onClose} role="presentation">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
      <div className="relative w-full max-w-md rounded-[24px] overflow-hidden" style={{ background: 'var(--color-bg-secondary)' }} onClick={e => e.stopPropagation()}>
        <div className="relative">
          {(getFoodImage(food.name, food.brand) || foodImageUrl(food.image_url)) ? (
            <div className="relative aspect-square overflow-hidden rounded-t-[24px]">
              <img src={getFoodImage(food.name, food.brand) || foodImageUrl(food.image_url)} alt={displayName} className="w-full h-full object-cover" loading="lazy" />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, var(--color-bg-secondary), color-mix(in srgb, var(--color-bg-secondary) 40%, transparent), color-mix(in srgb, black 10%, transparent))' }} />
            </div>
          ) : <div className="h-16" />}
          <button onClick={onClose} className="absolute top-3.5 right-3.5 min-w-[44px] min-h-[44px] w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center z-10 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" aria-label="Close">
            <X size={15} className="text-white/60" />
          </button>
          <div className="absolute bottom-0 left-0 right-0 px-5 pb-5">
            <h3 className="text-[22px] font-black text-white leading-tight">{displayName}</h3>
          </div>
        </div>
        <div className="px-5 pt-5 pb-5">
          <div className="mb-6">
            <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-[0.12em] mb-3">{t('nutrition.servings', 'Servings')}</p>
            <div className="flex items-center justify-center gap-5">
              <button onClick={() => adjust(-0.5)} disabled={s <= 0.5}
                className="w-12 h-12 rounded-2xl bg-[#111827] border border-[#1E293B] flex items-center justify-center text-[#9CA3AF] active:scale-90 transition-all disabled:opacity-25"
                aria-label="Decrease servings">
                <span className="text-[22px] font-light leading-none">−</span>
              </button>
              <div className="w-24 text-center">
                <p className="text-[24px] font-black leading-none tabular-nums truncate" style={{ color: 'var(--color-text-primary)' }}>{s}</p>
                <p className="text-[10px] text-[#6B7280] mt-1.5">{food.serving_unit}</p>
              </div>
              <button onClick={() => adjust(0.5)}
                className="w-12 h-12 rounded-2xl bg-[#111827] border border-[#1E293B] flex items-center justify-center text-[#9CA3AF] active:scale-90 transition-all"
                aria-label="Increase servings">
                <span className="text-[22px] font-light leading-none">+</span>
              </button>
            </div>
          </div>
          <div className="mb-6">
            <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-[0.12em] mb-3">{t('nutrition.meal', 'Meal')}</p>
            <div className="flex gap-2">
              {MEAL_TYPES.map(m => (
                <button key={m.key} onClick={() => setMealType(m.key)}
                  className={`flex-1 flex flex-col items-center py-3 rounded-xl text-[11px] font-semibold transition-all ${mealType === m.key ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/25' : 'bg-[#111827] text-[#9CA3AF] border border-[#111827]'}`}>
                  <m.icon size={17} className={`mb-1 transition-all ${mealType === m.key ? '' : 'opacity-50'}`} style={{ color: mealType === m.key ? m.color : 'var(--color-text-faint)' }} />
                  {t(m.labelKey)}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-[#111827] border border-[#1E293B] px-4 py-5 mb-6">
            {(() => {
              const ns = nutriScore(cal, pro, carb, fat, (food.serving_size || 100) * s);
              if (ns == null) return null;
              const nsColor = ns >= 80 ? '#22C55E' : ns >= 60 ? '#84CC16' : ns >= 40 ? '#EAB308' : ns >= 20 ? '#F97316' : '#EF4444';
              return (
                <div className="flex items-center justify-center gap-2 mb-4 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-[0.12em]">Nutri-Score</span>
                  <span className="inline-flex items-center justify-center w-10 h-6 rounded-lg text-[12px] font-black text-white" style={{ backgroundColor: nsColor }}>{ns}</span>
                </div>
              );
            })()}
            <div className="grid grid-cols-4 gap-2">
              {[{ v: cal, l: t('nutrition.cal', 'Cal'), c: 'var(--color-warning)' }, { v: `${pro}g`, l: t('nutrition.protein'), c: 'var(--color-success)' }, { v: `${carb}g`, l: t('nutrition.carbs'), c: 'var(--color-blue-soft)' }, { v: `${fat}g`, l: t('nutrition.fat'), c: '#A78BFA' }].map(m => (
                <div key={m.l} className="text-center">
                  <p className="text-[20px] font-black leading-none tabular-nums" style={{ color: m.c }}>{m.v}</p>
                  <p className="text-[8px] font-bold text-[#9CA3AF] uppercase tracking-[0.1em] mt-2">{m.l}</p>
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

  const confidenceColors = { high: 'var(--color-success)', medium: 'var(--color-warning)', low: 'var(--color-danger)' };

  const handleLog = async () => {
    setSaving(true);
    await onLog({
      food: { id: null, name: result.food_name },
      servings: s, mealType, cal, pro, carb, fat,
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4" onClick={onClose} role="presentation">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
      <div className="relative w-full max-w-md max-h-[90vh] rounded-[24px] overflow-y-auto" style={{ background: 'var(--color-bg-secondary)' }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3.5 right-3.5 min-w-[44px] min-h-[44px] w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center z-10 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" aria-label="Close">
          <X size={15} className="text-white/60" />
        </button>

        {/* Loading state */}
        {analyzing && (
          <div className="px-5 py-16 text-center" aria-busy={true}>
            {photoPreview && (
              <div className="w-24 h-24 mx-auto mb-5 rounded-2xl overflow-hidden">
                <img src={photoPreview} alt="Food photo preview" className="w-full h-full object-cover" width={96} height={96} loading="lazy" />
              </div>
            )}
            <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin mx-auto mb-4" role="status" aria-busy={true}><span className="sr-only">Analyzing</span></div>
            <p className="text-[14px] text-[#9CA3AF]">{t('nutrition.analyzingFood', 'Analyzing your food...')}</p>
            <p className="text-[11px] text-[#9CA3AF] mt-1">{t('nutrition.identifyingItems', 'Identifying items & looking up nutrition')}</p>
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
                  <img src={photoPreview} alt="Food photo preview" className="w-full h-full object-cover" loading="lazy" />
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, var(--color-bg-secondary), color-mix(in srgb, var(--color-bg-secondary) 40%, transparent), color-mix(in srgb, black 10%, transparent))' }} />
                </div>
              ) : <div className="h-16" />}
              <div className="absolute bottom-0 left-0 right-0 px-5 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                    style={{ color: confidenceColors[result.confidence], backgroundColor: `${confidenceColors[result.confidence]}15` }}>
                    {t(`nutrition.confidence_${result.confidence}`, `${result.confidence} confidence`)}
                  </span>
                </div>
                <h3 className="text-[20px] font-black text-white leading-tight">{result.food_name}</h3>
              </div>
            </div>

            <div className="px-5 pt-4 pb-5">
              {/* Item breakdown */}
              {result.items?.length > 0 && (
                <div className="mb-5">
                  <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-[0.12em] mb-2">{t('nutrition.identifiedItems', 'Identified Items')}</p>
                  <div className="space-y-1.5">
                    {result.items.map((item, i) => (
                      <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[#111827] border border-white/[0.04]">
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-[#E5E7EB] truncate capitalize">{item.name}</p>
                          <p className="text-[10px] text-[#9CA3AF]">{item.grams}g · {item.calories} cal · {item.protein_g}g P · {item.fat_g}g F</p>
                        </div>
                        <NutriScoreBadge score={nutriScore(item.calories, item.protein_g, item.carbs_g, item.fat_g, item.grams)} />
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
              <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/20 mb-4">
                <AlertCircle size={14} className="text-[#D97706] flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-[#D97706] leading-relaxed">
                  {t('nutrition.aiDisclaimer', 'AI-estimated values may not be fully accurate. Adjust the portion size or macros below before logging.')}
                </p>
              </div>

              {/* Portion size adjuster */}
              {totalGrams > 0 && (
                <div className="mb-5">
                  <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-[0.12em] mb-3">{t('nutrition.portionSize', 'Portion Size')}</p>
                  <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-[#111827] border border-[#1E293B]">
                    <button onClick={() => handleGramsChange(totalGrams - 10)}
                      className="w-9 h-9 rounded-xl bg-[#0A0F1A] border border-white/[0.06] flex items-center justify-center text-[#9CA3AF] active:scale-90 transition-all"
                      aria-label="Decrease portion size">
                      <span className="text-[16px] font-light leading-none">−</span>
                    </button>
                    <div className="flex-1 text-center">
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={Math.round(totalGrams) || ''}
                        onFocus={e => e.target.select()}
                        onChange={e => { const val = parseFloat(e.target.value); if (val < 0) return; handleGramsChange(e.target.value); }}
                        className="w-full text-center text-[24px] font-black text-[var(--color-text-primary)] leading-none tabular-nums bg-transparent outline-none [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                        aria-label="Portion size in grams"
                      />
                      <p className="text-[9px] text-[#6B7280] mt-1">{t('nutrition.gramsAdjust', 'grams (adjust to match actual portion)')}</p>
                    </div>
                    <button onClick={() => handleGramsChange(totalGrams + 10)}
                      className="w-9 h-9 rounded-xl bg-[#0A0F1A] border border-white/[0.06] flex items-center justify-center text-[#9CA3AF] active:scale-90 transition-all"
                      aria-label="Increase portion size">
                      <span className="text-[16px] font-light leading-none">+</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Editable macros */}
              <div className="mb-5">
                <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-[0.12em] mb-3">{t('nutrition.nutritionPerServing', 'Nutrition (per serving)')}</p>
                <div className="rounded-2xl bg-[#111827] border border-[#1E293B] px-4 py-4">
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { key: 'calories', l: t('nutrition.cal', 'Cal'), c: 'var(--color-warning)', unit: '' },
                      { key: 'protein_g', l: t('nutrition.protein'), c: 'var(--color-success)', unit: 'g' },
                      { key: 'carbs_g', l: t('nutrition.carbs'), c: 'var(--color-blue-soft)', unit: 'g' },
                      { key: 'fat_g', l: t('nutrition.fat'), c: '#A78BFA', unit: 'g' },
                    ].map(m => (
                      <div key={m.key} className="text-center">
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          value={macros[m.key] ?? ''}
                          onFocus={e => e.target.select()}
                          onChange={e => { const val = parseFloat(e.target.value); if (val < 0) return; setEditedMacros(prev => ({ ...prev, [m.key]: val || 0 })); }}
                          className="w-full text-center text-[18px] font-black leading-none tabular-nums bg-transparent outline-none [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                          style={{ color: m.c }}
                          aria-label={m.l}
                        />
                        <p className="text-[8px] font-bold text-[#9CA3AF] uppercase tracking-[0.1em] mt-2">{m.l}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Servings */}
              <div className="mb-5">
                <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-[0.12em] mb-3">{t('nutrition.servings', 'Servings')}</p>
                <div className="flex items-center justify-center gap-5">
                  <button onClick={() => adjust(-0.5)} disabled={s <= 0.5}
                    className="w-10 h-10 rounded-xl bg-[#111827] border border-[#1E293B] flex items-center justify-center text-[#9CA3AF] active:scale-90 transition-all disabled:opacity-25"
                    aria-label="Decrease servings">
                    <span className="text-[18px] font-light leading-none">−</span>
                  </button>
                  <p className="text-[24px] font-black tabular-nums w-16 text-center truncate" style={{ color: 'var(--color-text-primary)' }}>{s}</p>
                  <button onClick={() => adjust(0.5)}
                    className="w-10 h-10 rounded-xl bg-[#111827] border border-[#1E293B] flex items-center justify-center text-[#9CA3AF] active:scale-90 transition-all"
                    aria-label="Increase servings">
                    <span className="text-[18px] font-light leading-none">+</span>
                  </button>
                </div>
              </div>

              {/* Meal type */}
              <div className="mb-5">
                <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-[0.12em] mb-3">{t('nutrition.meal', 'Meal')}</p>
                <div className="flex gap-2">
                  {MEAL_TYPES.map(m => (
                    <button key={m.key} onClick={() => setMealType(m.key)}
                      className={`flex-1 flex flex-col items-center py-3 rounded-xl text-[11px] font-semibold transition-all ${mealType === m.key ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/25' : 'bg-[#111827] text-[#9CA3AF] border border-[#111827]'}`}>
                      <m.icon size={17} className={`mb-1 transition-all ${mealType === m.key ? '' : 'opacity-50'}`} style={{ color: mealType === m.key ? m.color : 'var(--color-text-faint)' }} />
                      {t(m.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Total + Log button */}
              <div className="rounded-2xl bg-[#111827] border border-[#1E293B] px-4 py-4 mb-5">
                <p className="text-[9px] font-semibold text-[#9CA3AF] uppercase tracking-[0.12em] mb-2">{t('nutrition.total', 'Total')} ({s} {s !== 1 ? t('nutrition.servingsPlural', 'servings') : t('nutrition.servingSingular', 'serving')})</p>
                <div className="grid grid-cols-4 gap-2">
                  {[{ v: cal, l: t('nutrition.cal', 'Cal'), c: 'var(--color-warning)' }, { v: `${pro}g`, l: t('nutrition.protein'), c: 'var(--color-success)' }, { v: `${carb}g`, l: t('nutrition.carbs'), c: 'var(--color-blue-soft)' }, { v: `${fat}g`, l: t('nutrition.fat'), c: '#A78BFA' }].map(m => (
                    <div key={m.l} className="text-center">
                      <p className="text-[18px] font-black leading-none tabular-nums" style={{ color: m.c }}>{m.v}</p>
                      <p className="text-[8px] font-bold text-[#9CA3AF] uppercase tracking-[0.1em] mt-2">{m.l}</p>
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

  const mealColor = MEAL_TYPES.find(m => m.key === log.meal_type)?.color || 'var(--color-text-subtle)';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4" onClick={onClose} role="presentation">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" />
      <div className="relative w-full max-w-md max-h-[85vh] rounded-[28px] overflow-y-auto"
        style={{ background: 'var(--color-bg-card)', boxShadow: '0 24px 80px rgba(0,0,0,0.3)', border: '1px solid var(--color-border-subtle)' }}
        onClick={e => e.stopPropagation()}>

        {/* Close button */}
        <button onClick={onClose} className="absolute top-4 right-4 min-w-[44px] min-h-[44px] w-8 h-8 rounded-full flex items-center justify-center z-10 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)', border: '1px solid var(--color-border-default)' }}
          aria-label="Close">
          <X size={14} className="text-white/70" />
        </button>

        {/* Photo */}
        <div className="relative">
          {photoSrc ? (
            <div className="relative aspect-[4/3] overflow-hidden rounded-t-[28px]">
              <img src={photoSrc} alt={displayName} className="w-full h-full object-cover scale-[1.02]" loading="lazy" />
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
              <span className="text-[9px] text-[#9CA3AF] font-medium">{timeStr}</span>
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
              <p className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-[0.15em]">{t('nutrition.nutritionLabel', 'Nutrition')}</p>
              <button onClick={() => setEditing(!editing)}
                className="text-[10px] font-bold tracking-wide transition-colors"
                style={{ color: editing ? 'var(--color-text-muted)' : 'var(--color-accent)' }}>
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
                    min="0"
                    value={editValues.calories || ''}
                    onFocus={e => e.target.select()}
                    onChange={e => { const val = parseFloat(e.target.value); if (val < 0) return; setEditValues(prev => ({ ...prev, calories: e.target.value })); }}
                    className="w-full text-center text-[24px] font-black leading-none tabular-nums bg-transparent outline-none text-[#F59E0B] [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                    aria-label={t('nutrition.dailyCalories', 'Calories')}
                  />
                ) : (
                  <p className="text-[24px] font-black leading-none tabular-nums text-[#F59E0B] truncate"
                    style={{ textShadow: '0 0 20px rgba(245,158,11,0.15)' }}>
                    {Math.round(log.calories)}
                  </p>
                )}
                <p className="text-[9px] font-bold text-[#9CA3AF] uppercase tracking-[0.15em] mt-2">{t('nutrition.dailyCalories', 'Calories')}</p>
              </div>
              {/* Macro row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: 'protein_g', l: t('nutrition.protein'), c: 'var(--color-success)' },
                  { key: 'carbs_g', l: t('nutrition.carbs'), c: 'var(--color-blue-soft)' },
                  { key: 'fat_g', l: t('nutrition.fat'), c: '#A78BFA' },
                ].map(m => (
                  <div key={m.key} className="text-center py-3 rounded-[12px]"
                    style={{ background: `${m.c}06` }}>
                    {editing ? (
                      <input
                        type="number" inputMode="decimal"
                        min="0"
                        value={editValues[m.key] || ''}
                        onFocus={e => e.target.select()}
                        onChange={e => { const val = parseFloat(e.target.value); if (val < 0) return; setEditValues(prev => ({ ...prev, [m.key]: e.target.value })); }}
                        className="w-full text-center text-[18px] font-black leading-none tabular-nums bg-transparent outline-none [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                        style={{ color: m.c }}
                        aria-label={m.l}
                      />
                    ) : (
                      <p className="text-[20px] font-black leading-none tabular-nums" style={{ color: m.c, textShadow: `0 0 16px ${m.c}15` }}>
                        {Math.round(log[m.key])}<span className="text-[13px] font-bold opacity-60">g</span>
                      </p>
                    )}
                    <p className="text-[8px] font-bold text-[#9CA3AF] uppercase tracking-[0.12em] mt-2">{m.l}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Servings */}
          <div className="flex items-center justify-between px-1 mb-6">
            <span className="text-[11px] font-medium text-[#9CA3AF]">{t('nutrition.servings', 'Servings')}</span>
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
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} role="presentation" />
      <div className="relative w-full max-w-md rounded-t-[28px] px-5 pt-6 pb-10"
        style={{ background: 'var(--color-bg-secondary)', paddingBottom: 'max(40px, var(--safe-area-bottom, env(safe-area-inset-bottom)))' }}>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-[18px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.nutritionTargets')}</h3>
          <button onClick={onClose} className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full bg-white/[0.04] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" aria-label="Close"><X size={16} className="text-[#6B7280]" /></button>
        </div>
        <button onClick={onAutoCalculate} className="w-full mb-5 py-3 rounded-xl text-[13px] font-semibold text-[#D4AF37] bg-[#D4AF37]/8 border border-[#D4AF37]/15">
          {t('nutrition.autoCalculate')}
        </button>
        <div className="space-y-4">
          {[{ label: t('nutrition.dailyCalories'), key: 'daily_calories', unit: 'kcal' }, { label: t('nutrition.protein'), key: 'daily_protein_g', unit: 'g' }, { label: t('nutrition.carbs'), key: 'daily_carbs_g', unit: 'g' }, { label: t('nutrition.fat'), key: 'daily_fat_g', unit: 'g' }]
            .map(f => (
              <div key={f.key}>
                <label htmlFor={`target-${f.key}`} className="block text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-1.5">{f.label}</label>
                <div className="relative">
                  <input id={`target-${f.key}`} type="number" min="0" value={draft[f.key] || ''} onChange={e => { const val = parseFloat(e.target.value); if (val < 0) return; setDraft(d => ({ ...d, [f.key]: e.target.value })); }}
                    className="w-full rounded-xl px-4 py-3 text-[15px] outline-none focus:border-[#D4AF37]/40 transition-colors pr-14"
                    style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-[#9CA3AF]">{f.unit}</span>
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

// ── DAILY SUGGESTION ("Sugerencia del Día") ─────────────────
const DailySuggestion = ({ targets, todayTotals, onOpenRecipe, lang, t, userId, workoutBurn = 0 }) => {
  const SLOT_ICONS = ['\u{1F305}', '\u{2600}\u{FE0F}', '\u{1F319}']; // sunrise, sun, moon
  const SLOT_LABELS = [t('nutrition.meals.breakfast'), t('nutrition.meals.lunch'), t('nutrition.meals.dinner')];
  const SLOT_COLORS = ['#F97316', '#F59E0B', '#8B5CF6'];

  const macroTargets = useMemo(() => ({
    calories: (targets?.daily_calories || 2000) + workoutBurn,
    protein: (targets?.daily_protein_g || 150) + Math.round(workoutBurn * 0.4 / 4),
    carbs: (targets?.daily_carbs_g || 200) + Math.round(workoutBurn * 0.6 / 4),
    fat: targets?.daily_fat_g || 65,
  }), [targets, workoutBurn]);

  const today = todayStr();
  const storageKey = `daily_suggestion_${userId || 'anon'}_${today}`;

  const [meals, setMeals] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  });

  const [removedIdx, setRemovedIdx] = useState(null);
  const [replacements, setReplacements] = useState([]);

  // Auto-generate on first visit each day
  useEffect(() => {
    if (meals) return;
    const plan = generateDayPlan({ targets: macroTargets, slots: 3 });
    const m = plan.meals || [];
    setMeals(m);
    try { localStorage.setItem(storageKey, JSON.stringify(m)); } catch {}
  }, [meals, macroTargets, storageKey]);

  const handleRegenerate = useCallback(() => {
    const plan = generateDayPlan({ targets: macroTargets, slots: 3 });
    const m = plan.meals || [];
    setMeals(m);
    setRemovedIdx(null);
    setReplacements([]);
    try { localStorage.setItem(storageKey, JSON.stringify(m)); } catch {}
  }, [macroTargets, storageKey]);

  const handleRemoveMeal = useCallback((idx) => {
    setRemovedIdx(idx);
    // Calculate remaining macros after removing this meal
    const remaining = meals.reduce((acc, m, i) => {
      if (i === idx) return acc;
      return {
        calories: acc.calories - (m?.calories || 0),
        protein: acc.protein - (m?.protein || 0),
        carbs: acc.carbs - (m?.carbs || 0),
        fat: acc.fat - (m?.fat || 0),
      };
    }, {
      calories: macroTargets.calories - (todayTotals.calories || 0),
      protein: macroTargets.protein - (todayTotals.protein || 0),
      carbs: macroTargets.carbs - (todayTotals.carbs || 0),
      fat: macroTargets.fat - (todayTotals.fat || 0),
    });
    const otherIds = meals.filter((_, i) => i !== idx).map(m => m?.id).filter(Boolean);
    const suggestions = suggestMeals({
      targets: { calories: Math.max(remaining.calories, 100), protein: Math.max(remaining.protein, 10), carbs: Math.max(remaining.carbs, 10), fat: Math.max(remaining.fat, 5) },
      consumed: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      excludeIds: otherIds,
      lang,
    });
    setReplacements(suggestions.slice(0, 5));
  }, [meals, macroTargets, todayTotals, lang]);

  const handleReplace = useCallback((idx, newMeal) => {
    const updated = [...(meals || [])];
    updated[idx] = newMeal;
    setMeals(updated);
    setRemovedIdx(null);
    setReplacements([]);
    try { localStorage.setItem(storageKey, JSON.stringify(updated)); } catch {}
  }, [meals, storageKey]);

  const mealTitle = (r) => r ? ((lang === 'es' && r.title_es) ? r.title_es : r.title) : '';

  if (!meals || meals.length === 0) return null;

  // Calculate gap between suggestion totals and target
  const planTotals = meals.reduce((acc, m) => ({
    calories: acc.calories + (m?.calories || 0),
    protein: acc.protein + (m?.protein || 0),
    carbs: acc.carbs + (m?.carbs || 0),
    fat: acc.fat + (m?.fat || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  const calGap = macroTargets.calories - planTotals.calories - (todayTotals.calories || 0);
  const proteinGap = macroTargets.protein - planTotals.protein - (todayTotals.protein || 0);
  const carbGap = macroTargets.carbs - planTotals.carbs - (todayTotals.carbs || 0);
  const fatGap = macroTargets.fat - planTotals.fat - (todayTotals.fat || 0);
  const showGap = calGap > macroTargets.calories * 0.05 || proteinGap > macroTargets.protein * 0.05;

  return (
    <div className="mx-4 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-[26px] h-[26px] rounded-[8px] flex items-center justify-center" style={{ backgroundColor: '#D4AF3712' }}>
            <Sparkles size={13} style={{ color: 'var(--color-accent)' }} />
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-subtle)' }}>
            {t('nutrition.dailySuggestion')}
          </span>
        </div>
        <button onClick={handleRegenerate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold active:scale-90 transition-all"
          style={{ background: 'var(--color-surface-hover)', color: 'var(--color-accent)' }}
          aria-label={t('nutrition.regenerate')}>
          <RefreshCw size={12} />
          {t('nutrition.regenerate')}
        </button>
      </div>

      {/* Meal cards */}
      <div className="space-y-2.5">
        {meals.map((meal, idx) => {
          if (!meal) return null;
          const isRemoved = removedIdx === idx;

          if (isRemoved) {
            return (
              <div key={`removed-${idx}`} className="rounded-[16px] overflow-hidden"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                <div className="px-4 py-3 flex items-center justify-between"
                  style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                  <span className="text-[11px] font-bold" style={{ color: SLOT_COLORS[idx] }}>
                    {SLOT_ICONS[idx]} {SLOT_LABELS[idx]} — {t('nutrition.replaceMeal')}
                  </span>
                  <button onClick={() => { setRemovedIdx(null); setReplacements([]); }}
                    className="text-[10px] font-bold" style={{ color: 'var(--color-text-muted)' }}>
                    {t('nutrition.cancel', 'Cancel')}
                  </button>
                </div>
                <div className="px-4 py-3 space-y-2 max-h-[220px] overflow-y-auto">
                  {replacements.map(({ meal: rMeal }) => (
                    <button key={rMeal.id} onClick={() => handleReplace(idx, rMeal)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[12px] text-left transition-all active:scale-[0.975]"
                      style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}>
                      <img src={foodImageUrl(rMeal.image)} alt={mealTitle(rMeal)} className="w-9 h-9 rounded-[8px] object-cover bg-[#1E293B] flex-shrink-0" loading="lazy" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-[#E5E7EB] truncate">{mealTitle(rMeal)}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[9px] font-medium tabular-nums text-[#F59E0B99]">{rMeal.calories} cal</span>
                          <span className="text-[7px] text-[#2A3040]">&middot;</span>
                          <span className="text-[9px] font-medium text-[#10B98199] tabular-nums">{rMeal.protein}g P</span>
                        </div>
                      </div>
                    </button>
                  ))}
                  {replacements.length === 0 && (
                    <p className="text-[11px] text-center py-4" style={{ color: 'var(--color-text-muted)' }}>
                      {t('nutrition.noResultsFound', 'No results found')}
                    </p>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div key={meal.id || idx} className="relative">
              <button onClick={() => onOpenRecipe(meal)}
                className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-[16px] text-left transition-all active:scale-[0.975]"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <img src={foodImageUrl(meal.image)} alt={mealTitle(meal)} className="w-11 h-11 rounded-[12px] object-cover bg-[#1E293B] flex-shrink-0"
                  style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }} loading="lazy" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: SLOT_COLORS[idx] }}>
                      {SLOT_ICONS[idx]} {SLOT_LABELS[idx]}
                    </span>
                  </div>
                  <p className="text-[12px] font-semibold text-[#E5E7EB] truncate mt-0.5">{mealTitle(meal)}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] font-semibold tabular-nums" style={{ color: '#F59E0B99' }}>{meal.calories} cal</span>
                    <span className="text-[8px] text-[#2A3040]">&middot;</span>
                    <span className="text-[10px] font-medium text-[#10B98199] tabular-nums">{meal.protein}g P</span>
                  </div>
                </div>
              </button>
              {/* Remove button */}
              <button onClick={(e) => { e.stopPropagation(); handleRemoveMeal(idx); }}
                className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition-all"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.15)' }}
                aria-label={t('nutrition.remove', 'Remove')}>
                <X size={12} className="text-[#EF4444]" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Remaining macros gap */}
      {showGap && calGap > 0 && (
        <div className="mt-3 px-4 py-2.5 rounded-[12px]"
          style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.12)' }}>
          <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--color-warning)' }}>
            {t('nutrition.remaining', 'Remaining')}:
          </p>
          <div className="flex items-center gap-3 text-[10px] font-medium">
            <span style={{ color: 'var(--color-warning)' }}>{Math.round(Math.max(0, calGap))} kcal</span>
            <span style={{ color: 'var(--color-success)' }}>{Math.round(Math.max(0, proteinGap))}g {t('nutrition.protein', 'protein')}</span>
            <span style={{ color: '#FBBF24' }}>{Math.round(Math.max(0, carbGap))}g {t('nutrition.carbs', 'carbs')}</span>
            <span style={{ color: '#F97316' }}>{Math.round(Math.max(0, fatGap))}g {t('nutrition.fat', 'fat')}</span>
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <p className="mt-3 text-[9px] leading-relaxed px-1" style={{ color: 'var(--color-text-faint)' }}>
        {t('nutrition.disclaimer', 'Caloric and nutritional values are estimates and may vary based on ingredients, portions, and preparation. Consult a healthcare professional for allergies or dietary restrictions.')}
      </p>
    </div>
  );
};

// ── WEEKLY NUTRITION SUMMARY ─────────────────────────────────
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const WeeklyNutritionSummary = ({ userId, targets, startExpanded = false }) => {
  const { t, i18n } = useTranslation('pages');
  const lang = i18n.language || 'en';
  const [weekData, setWeekData] = useState(null);
  const [expandedDay, setExpandedDay] = useState(null);
  const [collapsed, setCollapsed] = useState(!startExpanded);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = current week, -1 = last week, etc.
  const [trendData, setTrendData] = useState(null);

  const calTarget = targets?.daily_calories || 2000;
  const proteinTarget = targets?.daily_protein_g || 150;
  const carbsTarget = targets?.daily_carbs_g || 200;
  const fatTarget = targets?.daily_fat_g || 65;

  useEffect(() => {
    if (!userId) return;
    const fetchWeek = async () => {
      const dates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i) + (weekOffset * 7));
        return toLocalDateStr(d);
      });

      const { data: logs } = await supabase
        .from('food_logs')
        .select('log_date, calories, protein_g, carbs_g, fat_g, meal_type, custom_name, food_item:food_items(name, name_es)')
        .eq('profile_id', userId)
        .gte('log_date', dates[0])
        .lte('log_date', dates[6]);

      const byDate = {};
      for (const date of dates) byDate[date] = { calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0, logs: [] };
      for (const log of (logs || [])) {
        const d = byDate[log.log_date];
        if (d) {
          d.calories += log.calories || 0;
          d.protein += log.protein_g || 0;
          d.carbs += log.carbs_g || 0;
          d.fat += log.fat_g || 0;
          d.meals++;
          d.logs.push(log);
        }
      }

      setWeekData({ dates, byDate });
    };
    fetchWeek();
  }, [userId, weekOffset]);

  // ── 4-week protein trend data ──
  useEffect(() => {
    if (!userId) return;
    const fetchTrend = async () => {
      const today = new Date();
      const fourWeeksAgo = new Date(today);
      fourWeeksAgo.setDate(today.getDate() - 27);
      const startStr = toLocalDateStr(fourWeeksAgo);
      const endStr = toLocalDateStr(today);

      const { data: logs } = await supabase
        .from('food_logs')
        .select('log_date, protein_g')
        .eq('profile_id', userId)
        .gte('log_date', startStr)
        .lte('log_date', endStr);

      if (!logs || logs.length === 0) { setTrendData(null); return; }

      // Group by week (Mon-Sun)
      const weeks = [];
      for (let w = 3; w >= 0; w--) {
        const wStart = new Date(today);
        wStart.setDate(today.getDate() - (w * 7 + 6));
        const wEnd = new Date(today);
        wEnd.setDate(today.getDate() - (w * 7));
        const wStartStr = toLocalDateStr(wStart);
        const wEndStr = toLocalDateStr(wEnd);

        const weekLogs = logs.filter(l => l.log_date >= wStartStr && l.log_date <= wEndStr);
        // Group by date
        const byDate = {};
        for (const l of weekLogs) {
          byDate[l.log_date] = (byDate[l.log_date] || 0) + (l.protein_g || 0);
        }
        const daysWithData = Object.keys(byDate).length;
        const totalProtein = Object.values(byDate).reduce((s, v) => s + v, 0);
        const avg = daysWithData > 0 ? Math.round(totalProtein / daysWithData) : 0;

        const label = wEnd.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric' });
        weeks.push({ label, avg, daysWithData, weekNum: 4 - w });
      }

      setTrendData(weeks.filter(w => w.daysWithData > 0));
    };
    fetchTrend();
  }, [userId, lang]);

  if (!weekData) return null;

  const { dates, byDate } = weekData;

  // Compute weekly stats
  const daysTracked = dates.filter(d => byDate[d].meals > 0).length;
  const trackedDays = dates.filter(d => byDate[d].meals > 0);
  const avgCal = trackedDays.length > 0 ? Math.round(trackedDays.reduce((s, d) => s + byDate[d].calories, 0) / trackedDays.length) : 0;
  const avgProtein = trackedDays.length > 0 ? Math.round(trackedDays.reduce((s, d) => s + byDate[d].protein, 0) / trackedDays.length) : 0;

  // Compliance: days where ALL macros within 15% of target
  const compliantDays = trackedDays.filter(d => {
    const day = byDate[d];
    const calOk = Math.abs(day.calories - calTarget) / calTarget <= 0.15;
    const proOk = Math.abs(day.protein - proteinTarget) / proteinTarget <= 0.15;
    const carbOk = Math.abs(day.carbs - carbsTarget) / carbsTarget <= 0.15;
    const fatOk = Math.abs(day.fat - fatTarget) / fatTarget <= 0.15;
    return calOk && proOk && carbOk && fatOk;
  }).length;
  const compliancePct = daysTracked > 0 ? Math.round((compliantDays / daysTracked) * 100) : 0;

  // Max cal in week for bar scaling
  const maxCal = Math.max(calTarget, ...dates.map(d => byDate[d].calories));

  const getBarColor = (cal) => {
    if (cal === 0) return 'var(--color-bg-input)';
    const diff = Math.abs(cal - calTarget) / calTarget;
    if (diff <= 0.10) return 'var(--color-success)';
    if (diff <= 0.25) return 'var(--color-warning)';
    return 'var(--color-danger)';
  };

  const getProteinOk = (protein) => {
    if (protein === 0) return false;
    return Math.abs(protein - proteinTarget) / proteinTarget <= 0.15;
  };

  // Get day-of-week index for each date (0=Sun..6=Sat) → map to i18n keys
  const getDayLabel = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00');
    const jsDay = d.getDay(); // 0=Sun
    const dayMap = [6, 0, 1, 2, 3, 4, 5]; // JS Sun=0 → our index 6 (sun), Mon=1 → 0 (mon)
    return t(`nutrition.days.${DAY_KEYS[dayMap[jsDay]]}`);
  };

  const isToday = (dateStr) => dateStr === todayStr();

  return (
    <div className="mx-4 mb-7">
      {/* Header - always visible, acts as toggle */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between mb-4 group"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-[26px] h-[26px] rounded-[8px] flex items-center justify-center"
            style={{ backgroundColor: '#D4AF3712' }}>
            <BarChart2 size={13} style={{ color: 'var(--color-accent)' }} />
          </div>
          <span className="text-[10px] font-extrabold text-[#525C6B] uppercase tracking-[0.18em]">{t('nutrition.weeklySummary')}</span>
        </div>
        {collapsed ? (
          <ChevronDown size={14} className="text-[#525C6B] group-active:text-[#9CA3AF] transition-colors" />
        ) : (
          <ChevronUp size={14} className="text-[#525C6B] group-active:text-[#9CA3AF] transition-colors" />
        )}
      </button>

      {!collapsed && (
        <div className="rounded-[20px] overflow-hidden"
          style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>

          {/* ── Week Navigation ── */}
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <button onClick={() => setWeekOffset(o => o - 1)}
              className="flex items-center gap-1 text-[11px] font-semibold active:scale-90 transition-all"
              style={{ color: 'var(--color-accent)' }}>
              <ChevronLeft size={14} />
              {t('nutrition.previousWeek')}
            </button>
            <span className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
              {weekData?.dates?.[0] ? (() => {
                const s = new Date(weekData.dates[0] + 'T12:00:00');
                const e = new Date(weekData.dates[6] + 'T12:00:00');
                const fmt = (d) => d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric' });
                return `${fmt(s)} - ${fmt(e)}`;
              })() : ''}
            </span>
            <button onClick={() => setWeekOffset(o => Math.min(0, o + 1))}
              disabled={weekOffset >= 0}
              className="flex items-center gap-1 text-[11px] font-semibold active:scale-90 transition-all disabled:opacity-30"
              style={{ color: 'var(--color-accent)' }}>
              {t('nutrition.nextWeek')}
              <ChevronRight size={14} />
            </button>
          </div>

          {/* ── 7-Day Bar Chart ── */}
          <div className="px-5 pt-6 pb-4">
            <div className="flex items-end justify-between gap-2" style={{ height: 120 }}>
              {dates.map((date) => {
                const day = byDate[date];
                const barH = day.calories > 0 ? Math.max(8, (day.calories / maxCal) * 100) : 4;
                const barColor = getBarColor(day.calories);
                const proteinOk = getProteinOk(day.protein);
                const isExp = expandedDay === date;
                const today = isToday(date);

                return (
                  <button
                    key={date}
                    onClick={() => setExpandedDay(isExp ? null : date)}
                    className="flex flex-col items-center flex-1 min-w-0 transition-all active:scale-95"
                    style={{ height: '100%' }}
                  >
                    <div className="flex-1 flex items-end w-full justify-center">
                      <div
                        className="rounded-t-[4px] transition-all duration-300"
                        style={{
                          width: 8,
                          height: `${barH}%`,
                          backgroundColor: barColor,
                          opacity: day.calories === 0 ? 0.3 : 1,
                          boxShadow: day.calories > 0 ? `0 0 8px ${barColor}30` : 'none',
                          outline: isExp ? `2px solid ${barColor}` : 'none',
                          outlineOffset: 2,
                        }}
                      />
                    </div>
                    {/* Protein indicator dot */}
                    <div
                      className="w-[5px] h-[5px] rounded-full mt-2 mb-1.5"
                      style={{
                        backgroundColor: day.meals === 0 ? 'var(--color-bg-input)' : (proteinOk ? 'var(--color-success)' : 'var(--color-danger)'),
                        opacity: day.meals === 0 ? 0.4 : 1,
                      }}
                    />
                    {/* Day label */}
                    <span
                      className="text-[9px] font-bold tracking-wide"
                      style={{
                        color: today ? 'var(--color-accent)' : (isExp ? 'var(--color-text-primary)' : '#525C6B'),
                      }}
                    >
                      {getDayLabel(date)}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Target line label */}
            <div className="flex items-center gap-2 mt-3 pt-2 border-t border-white/[0.04]">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-[2px] rounded-full" style={{ backgroundColor: 'var(--color-success)' }} />
                <span className="text-[9px] text-[#525C6B]">{`<10%`}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-[2px] rounded-full" style={{ backgroundColor: 'var(--color-warning)' }} />
                <span className="text-[9px] text-[#525C6B]">10-25%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-[2px] rounded-full" style={{ backgroundColor: 'var(--color-danger)' }} />
                <span className="text-[9px] text-[#525C6B]">{`>25%`}</span>
              </div>
              <div className="flex items-center gap-1.5 ml-auto">
                <div className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: 'var(--color-success)' }} />
                <span className="text-[9px] text-[#525C6B]">{t('nutrition.protein')}</span>
              </div>
            </div>
          </div>

          {/* ── Expanded Day Detail ── */}
          {expandedDay && byDate[expandedDay] && byDate[expandedDay].meals > 0 && (
            <div className="mx-4 mb-4 rounded-[14px] overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border-subtle)' }}>
              <div className="px-4 py-3">
                <p className="text-[11px] font-bold text-[#D1D5DB] mb-2">
                  {getDayLabel(expandedDay)} — {byDate[expandedDay].calories} kcal
                </p>
                <div className="flex gap-3 mb-3">
                  <span className="text-[10px] font-semibold" style={{ color: '#10B98199' }}>{byDate[expandedDay].protein}g P</span>
                  <span className="text-[10px] font-semibold" style={{ color: '#60A5FA99' }}>{byDate[expandedDay].carbs}g C</span>
                  <span className="text-[10px] font-semibold" style={{ color: '#A78BFA99' }}>{byDate[expandedDay].fat}g F</span>
                </div>
                <div className="space-y-1.5">
                  {byDate[expandedDay].logs.map((log, i) => (
                    <div key={i} className="flex items-center justify-between py-1">
                      <span className="text-[10px] text-[#9CA3AF] truncate flex-1 mr-2">
                        {(lang === 'es' && log.food_item?.name_es) ? log.food_item.name_es : (log.food_item?.name || log.custom_name || 'Food')}
                      </span>
                      <span className="text-[10px] font-semibold text-[#6B7280] tabular-nums flex-shrink-0">
                        {log.calories} cal
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Weekly Stats ── */}
          <div className="px-5 pb-5">
            <div className="grid grid-cols-2 gap-3">
              {/* Days tracked */}
              <div className="rounded-[12px] p-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border-subtle)' }}>
                <p className="text-[9px] font-bold text-[#525C6B] uppercase tracking-wider mb-1">{t('nutrition.daysTracked')}</p>
                <p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums leading-none">{daysTracked} <span className="text-[11px] font-semibold text-[#3B4252]">/ 7</span></p>
              </div>

              {/* Compliance */}
              <div className="rounded-[12px] p-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border-subtle)' }}>
                <p className="text-[9px] font-bold text-[#525C6B] uppercase tracking-wider mb-1">{t('nutrition.compliance')}</p>
                <div className="flex items-center gap-2">
                  {/* Mini ring */}
                  <svg width="28" height="28" viewBox="0 0 28 28">
                    <circle cx="14" cy="14" r="11" fill="none" stroke="var(--color-bg-input)" strokeWidth="3" />
                    <circle cx="14" cy="14" r="11" fill="none"
                      stroke={compliancePct >= 70 ? 'var(--color-success)' : compliancePct >= 40 ? 'var(--color-warning)' : 'var(--color-danger)'}
                      strokeWidth="3"
                      strokeDasharray={`${(compliancePct / 100) * 69.115} 69.115`}
                      strokeLinecap="round"
                      transform="rotate(-90 14 14)"
                    />
                  </svg>
                  <p className="text-[12px] font-bold tabular-nums leading-none"
                    style={{ color: compliancePct >= 70 ? 'var(--color-success)' : compliancePct >= 40 ? 'var(--color-warning)' : 'var(--color-danger)' }}>
                    {t('nutrition.weeklyCompliance', { pct: compliancePct })}
                  </p>
                </div>
              </div>

              {/* Avg Calories */}
              <div className="rounded-[12px] p-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border-subtle)' }}>
                <p className="text-[9px] font-bold text-[#525C6B] uppercase tracking-wider mb-1">{t('nutrition.avgCalories')}</p>
                <p className="text-[15px] font-bold text-[#E5E7EB] tabular-nums leading-none">
                  {avgCal} <span className="text-[10px] font-semibold text-[#3B4252]">/ {calTarget}</span>
                </p>
              </div>

              {/* Avg Protein */}
              <div className="rounded-[12px] p-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border-subtle)' }}>
                <p className="text-[9px] font-bold text-[#525C6B] uppercase tracking-wider mb-1">{t('nutrition.avgProtein')}</p>
                <p className="text-[15px] font-bold text-[#E5E7EB] tabular-nums leading-none">
                  {avgProtein}g <span className="text-[10px] font-semibold text-[#3B4252]">/ {proteinTarget}g</span>
                </p>
              </div>
            </div>
          </div>

          {/* ── 4-Week Protein Trend ── */}
          {trendData && trendData.length >= 2 ? (
            <div className="px-5 pb-5">
              <p className="text-[9px] font-bold text-[#525C6B] uppercase tracking-wider mb-3">{t('nutrition.proteinTrend')}</p>

              {/* Stat card */}
              {(() => {
                const latest = trendData[trendData.length - 1]?.avg || 0;
                const prev = trendData.length >= 2 ? trendData[trendData.length - 2]?.avg : latest;
                const hittingTarget = latest >= proteinTarget * 0.85;
                const trending = latest > prev ? 'up' : latest < prev ? 'down' : 'flat';
                return (
                  <div className="rounded-[12px] p-3 mb-3 flex items-center justify-between"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border-subtle)' }}>
                    <div>
                      <p className="text-[9px] font-bold text-[#525C6B] uppercase tracking-wider mb-1">{t('nutrition.avgDailyProtein')}</p>
                      <p className="text-[15px] font-bold tabular-nums leading-none" style={{ color: hittingTarget ? 'var(--color-success)' : 'var(--color-danger)' }}>
                        {latest}g <span className="text-[10px] font-semibold text-[#3B4252]">({t('nutrition.target')}: {proteinTarget}g)</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-1" style={{ color: trending === 'up' ? 'var(--color-success)' : trending === 'down' ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                      {trending === 'up' && <ArrowUp size={14} />}
                      {trending === 'down' && <ArrowDown size={14} />}
                      {trending !== 'flat' && (
                        <span className="text-[11px] font-bold tabular-nums">{Math.abs(latest - prev)}g</span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Chart */}
              <div className="rounded-[12px] overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border-subtle)' }}>
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={trendData} margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-bg-input)" />
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#525C6B' }} axisLine={false} tickLine={false} />
                    <YAxis hide domain={[0, (dataMax) => Math.max(dataMax, proteinTarget) * 1.15]} />
                    <Tooltip
                      contentStyle={{ background: 'var(--color-bg-card)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 11 }}
                      labelStyle={{ color: 'var(--color-text-muted)', fontSize: 10 }}
                      formatter={(value) => [`${value}g`, t('nutrition.protein')]}
                    />
                    <ReferenceLine y={proteinTarget} stroke="var(--color-accent)" strokeDasharray="6 3" strokeWidth={1.5} />
                    <Line
                      type="monotone"
                      dataKey="avg"
                      stroke="var(--color-success)"
                      strokeWidth={2.5}
                      dot={(props) => {
                        const { cx, cy, payload } = props;
                        const color = payload.avg >= proteinTarget * 0.85 ? 'var(--color-success)' : 'var(--color-danger)';
                        return <circle key={props.key} cx={cx} cy={cy} r={4} fill={color} stroke="var(--color-bg-card)" strokeWidth={2} />;
                      }}
                      activeDot={{ r: 6, stroke: 'var(--color-accent)', strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : trendData !== null && trendData.length < 2 ? (
            <div className="px-5 pb-5">
              <p className="text-[9px] font-bold text-[#525C6B] uppercase tracking-wider mb-2">{t('nutrition.proteinTrend')}</p>
              <p className="text-[11px] text-[#525C6B]">{t('nutrition.noTrendData')}</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

// ── WEEKLY MEAL PLANNER ──────────────────────────────────────
const getWeekStartDate = () => {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // Monday = start
  const mon = new Date(d);
  mon.setDate(d.getDate() - diff);
  return toLocalDateStr(mon);
};

const getWeekDates = () => {
  const start = getWeekStartDate();
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start + 'T12:00:00');
    d.setDate(d.getDate() + i);
    dates.push(toLocalDateStr(d));
  }
  return dates;
};

const PLANNER_SLOT_KEYS = ['breakfast', 'lunch', 'dinner'];

const WeeklyMealPlanner = ({ onClose, targets, onOpenRecipe, onOpenSearch, userId, embedded = false }) => {
  const { t, i18n } = useTranslation('pages');
  const lang = i18n.language || 'en';
  const [plan, setPlan] = useState({});
  const [toast, setToast] = useState('');
  const [removingSlot, setRemovingSlot] = useState(null);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = current, -1 = past, +1 = next

  const currentWeekStart = useMemo(() => getWeekStartDate(), []);

  const weekDates = useMemo(() => {
    const start = new Date(currentWeekStart + 'T12:00:00');
    start.setDate(start.getDate() + weekOffset * 7);
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dates.push(toLocalDateStr(d));
    }
    return dates;
  }, [currentWeekStart, weekOffset]);

  const weekStart = weekDates[0];
  const isPastWeek = weekOffset < 0;

  const storageKey = `meal_plan_${userId || 'anon'}_${weekStart}`;
  const legacyStorageKey = `meal_plan_${userId || 'anon'}`;

  // Load plan from localStorage
  useEffect(() => {
    try {
      // Try week-specific key first
      let raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        setPlan(parsed.days || {});
        return;
      }
      // Fallback: legacy key (only for current week)
      if (weekOffset === 0) {
        raw = localStorage.getItem(legacyStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.weekStart === weekStart) {
            setPlan(parsed.days || {});
            return;
          }
        }
      }
      setPlan({});
    } catch { setPlan({}); }
  }, [storageKey, legacyStorageKey, weekStart, weekOffset]);

  // Persist plan
  const savePlan = useCallback((newPlan) => {
    setPlan(newPlan);
    const planToSave = { weekStart, days: newPlan };
    const planJson = JSON.stringify(planToSave);
    if (planJson.length > 500000) { // 500KB limit
      console.warn('Meal plan too large to save');
      return;
    }
    try {
      localStorage.setItem(storageKey, planJson);
      // Also update legacy key for current week (backward compat)
      if (weekOffset === 0) {
        localStorage.setItem(legacyStorageKey, planJson);
      }
    } catch (err) {
      console.error('Failed to save meal plan to localStorage:', err?.message);
    }
    // Attempt Supabase save
    if (userId) {
      supabase.from('meal_plans').upsert({
        profile_id: userId,
        week_start: weekStart,
        plan_data: newPlan,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'profile_id,week_start' }).catch(err => console.error('Failed to save meal plan:', err?.message));
    }
  }, [storageKey, legacyStorageKey, weekStart, userId, weekOffset]);

  const handleAutoplan = useCallback(() => {
    if (isPastWeek) return;
    const macroTargets = {
      calories: targets?.daily_calories || 2000,
      protein: targets?.daily_protein_g || 150,
      carbs: targets?.daily_carbs_g || 200,
      fat: targets?.daily_fat_g || 65,
    };
    const weekPlan = generateWeekPlan({ targets: macroTargets, favorites: [], lang });
    const newPlan = { ...plan };
    weekDates.forEach((date, i) => {
      if (!newPlan[date]) newPlan[date] = {};
      const dayMeals = weekPlan[i]?.meals || [];
      PLANNER_SLOT_KEYS.forEach((slot, si) => {
        if (!newPlan[date][slot] && dayMeals[si]) {
          newPlan[date][slot] = dayMeals[si];
        }
      });
    });
    savePlan(newPlan);
    setToast(t('nutrition.planGenerated', 'Plan generated!'));
    setTimeout(() => setToast(''), 2000);
  }, [targets, plan, weekDates, savePlan, lang, t, isPastWeek]);

  const handleRemoveMeal = useCallback((date, slot) => {
    if (isPastWeek) return;
    const newPlan = { ...plan };
    if (newPlan[date]) {
      delete newPlan[date][slot];
    }
    savePlan(newPlan);
    setRemovingSlot(null);
  }, [plan, savePlan, isPastWeek]);

  const handleTapSlot = useCallback((date, slot, meal) => {
    if (meal) {
      onOpenRecipe(meal);
    } else if (!isPastWeek) {
      onOpenSearch();
    }
  }, [onOpenRecipe, onOpenSearch, isPastWeek]);

  // Complete a day: auto-fill empty slots to hit macro targets
  const handleCompleteDay = useCallback((date) => {
    if (isPastWeek) return;
    const macroTargets = {
      calories: targets?.daily_calories || 2000,
      protein: targets?.daily_protein_g || 150,
      carbs: targets?.daily_carbs_g || 200,
      fat: targets?.daily_fat_g || 65,
    };
    const dayData = plan[date] || {};
    const usedIds = PLANNER_SLOT_KEYS.map(k => dayData[k]?.id).filter(Boolean);
    const emptySlots = PLANNER_SLOT_KEYS.filter(k => !dayData[k]);
    if (emptySlots.length === 0) return;
    // Calculate already planned macros
    const planned = PLANNER_SLOT_KEYS.reduce((acc, k) => ({
      calories: acc.calories + (dayData[k]?.calories || 0),
      protein: acc.protein + (dayData[k]?.protein || 0),
      carbs: acc.carbs + (dayData[k]?.carbs || 0),
      fat: acc.fat + (dayData[k]?.fat || 0),
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
    const remainingTargets = {
      calories: Math.max(macroTargets.calories - planned.calories, 100),
      protein: Math.max(macroTargets.protein - planned.protein, 10),
      carbs: Math.max(macroTargets.carbs - planned.carbs, 10),
      fat: Math.max(macroTargets.fat - planned.fat, 5),
    };
    const fillPlan = generateDayPlan({ targets: remainingTargets, slots: emptySlots.length, excludeIds: usedIds });
    const newPlan = { ...plan };
    if (!newPlan[date]) newPlan[date] = {};
    emptySlots.forEach((slot, i) => {
      if (fillPlan.meals[i]) newPlan[date][slot] = fillPlan.meals[i];
    });
    savePlan(newPlan);
  }, [plan, savePlan, targets, isPastWeek]);

  const calTarget = targets?.daily_calories || 2000;
  const proteinTarget = targets?.daily_protein_g || 150;
  const carbsTarget = targets?.daily_carbs_g || 200;
  const fatTarget = targets?.daily_fat_g || 65;

  const mealTitle = (m) => (lang === 'es' && m.title_es) ? m.title_es : m.title;

  const getDayLabel = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00');
    const jsDay = d.getDay();
    const dayMap = [6, 0, 1, 2, 3, 4, 5];
    return t(`nutrition.days.${DAY_KEYS[dayMap[jsDay]]}`);
  };

  const getDateLabel = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00');
    return d.getDate();
  };

  const isToday = (dateStr) => dateStr === todayStr();

  const getMacroColor = (val, target) => {
    const diff = Math.abs(val - target) / target;
    if (diff <= 0.10) return 'var(--color-success)';
    if (diff <= 0.25) return 'var(--color-warning)';
    return 'var(--color-danger)';
  };

  const content = (
    <div className="h-screen flex flex-col" style={{ background: 'var(--color-bg-primary)' }}>
      {/* Header — fixed, opaque, content scrolls behind */}
      <div className="shrink-0 px-4 py-4 flex items-center gap-3 z-10"
        style={{ background: 'var(--color-bg-primary)', borderBottom: '1px solid var(--color-border-subtle))' }}>
        <button onClick={onClose}
          className="w-10 h-10 rounded-xl flex items-center justify-center active:scale-90 transition-all"
          style={{ background: 'var(--color-surface-hover))', border: '1px solid var(--color-border-subtle))' }}
          aria-label={t('nutrition.back', 'Back')}>
          <ChevronLeft size={18} style={{ color: 'var(--color-text-muted)' }} />
        </button>
        <h1 className="text-[18px] font-bold flex-1 truncate" style={{ color: 'var(--color-text-primary)' }}>
          {t('nutrition.weeklyPlan', 'Plan Semanal')}
        </h1>
        {!isPastWeek && (
          <button onClick={handleAutoplan}
            className="px-4 py-2 rounded-xl text-[12px] font-bold active:scale-95 transition-all"
            style={{ background: 'linear-gradient(135deg, #D4AF37 0%, #B8962E 100%)', color: '#000', boxShadow: '0 2px 8px rgba(212,175,55,0.25)' }}>
            <Sparkles size={12} className="inline mr-1.5" style={{ verticalAlign: '-1px' }} />
            {t('nutrition.autoPlan', 'Auto-plan')}
          </button>
        )}
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto">

      {/* Week Navigation */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <button onClick={() => setWeekOffset(o => o - 1)}
          className="flex items-center gap-1 text-[11px] font-semibold active:scale-90 transition-all"
          style={{ color: 'var(--color-accent)' }}>
          <ChevronLeft size={14} />
          {t('nutrition.previousWeek')}
        </button>
        <span className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
          {(() => {
            const s = new Date(weekDates[0] + 'T12:00:00');
            const e = new Date(weekDates[6] + 'T12:00:00');
            const fmt = (d) => d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric' });
            return `${fmt(s)} - ${fmt(e)}`;
          })()}
        </span>
        <button onClick={() => setWeekOffset(o => o + 1)}
          className="flex items-center gap-1 text-[11px] font-semibold active:scale-90 transition-all"
          style={{ color: 'var(--color-accent)' }}>
          {t('nutrition.nextWeek')}
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Past week read-only banner */}
      {isPastWeek && (
        <div className="mx-4 mt-2 px-4 py-2.5 rounded-xl text-center text-[11px] font-medium"
          style={{ background: 'rgba(245,158,11,0.06)', color: 'var(--color-warning)', border: '1px solid rgba(245,158,11,0.12)' }}>
          {t('nutrition.pastWeekReadOnly')}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="mx-4 mt-3 px-4 py-2.5 rounded-xl text-center text-[12px] font-semibold animate-pulse"
          style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--color-success)', border: '1px solid rgba(16,185,129,0.2)' }}>
          {toast}
        </div>
      )}

      {/* Day cards */}
      <div className="px-4 py-4 space-y-4 pb-20">
        {weekDates.map((date) => {
          const dayData = plan[date] || {};
          const dayCal = PLANNER_SLOT_KEYS.reduce((s, k) => s + (dayData[k]?.calories || 0), 0);
          const dayP = PLANNER_SLOT_KEYS.reduce((s, k) => s + (dayData[k]?.protein || 0), 0);
          const dayC = PLANNER_SLOT_KEYS.reduce((s, k) => s + (dayData[k]?.carbs || 0), 0);
          const dayF = PLANNER_SLOT_KEYS.reduce((s, k) => s + (dayData[k]?.fat || 0), 0);
          const hasMeals = PLANNER_SLOT_KEYS.some(k => dayData[k]);
          const today = isToday(date);

          return (
            <div key={date} className="rounded-[18px] overflow-hidden"
              style={{
                background: 'var(--color-bg-card)',
                border: today ? '1.5px solid rgba(212,175,55,0.3)' : '1px solid var(--color-border-subtle))',
                boxShadow: today ? '0 0 16px rgba(212,175,55,0.08)' : '0 2px 8px rgba(0,0,0,0.1)',
              }}>
              {/* Day header */}
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: today ? 'rgba(212,175,55,0.12)' : 'var(--color-surface-hover))' }}>
                    <span className="text-[13px] font-black tabular-nums" style={{ color: today ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                      {getDateLabel(date)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[13px] font-bold" style={{ color: today ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                      {getDayLabel(date)}
                    </span>
                    {today && (
                      <span className="ml-2 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(212,175,55,0.12)', color: 'var(--color-accent)' }}>
                        {t('nutrition.today', 'Today')}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Meal slots */}
              <div className="px-4 pb-3 space-y-2">
                {PLANNER_SLOT_KEYS.map((slot, si) => {
                  const meal = dayData[slot];
                  const slotColors = ['#F97316', '#F59E0B', '#8B5CF6'];
                  const slotColor = slotColors[si];
                  const isRemoving = removingSlot === `${date}-${slot}`;

                  return (
                    <div key={slot} className="relative">
                      <button
                        onClick={() => handleTapSlot(date, slot, meal)}
                        onContextMenu={(e) => { if (meal && !isPastWeek) { e.preventDefault(); setRemovingSlot(`${date}-${slot}`); } }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[12px] text-left transition-all active:scale-[0.98]"
                        style={{
                          background: meal ? 'var(--color-surface-hover))' : 'transparent',
                          border: meal ? '1px solid var(--color-border-subtle))' : '1.5px dashed var(--color-border-subtle))',
                        }}>
                        {meal ? (
                          <>
                            <img src={foodImageUrl(meal.image)} alt={mealTitle(meal)} className="w-9 h-9 rounded-[8px] object-cover flex-shrink-0" style={{ background: 'var(--color-bg-input)' }} loading="lazy" />
                            <div className="flex-1 min-w-0">
                              <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: slotColor }}>{t(`nutrition.meals.${slot}`)}</span>
                              <p className="text-[12px] font-semibold truncate mt-0.5" style={{ color: 'var(--color-text-primary)' }}>{mealTitle(meal)}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[9px] font-medium tabular-nums" style={{ color: '#F59E0B99' }}>{meal.calories} cal</span>
                                <span className="text-[7px]" style={{ color: 'var(--color-text-subtle)' }}>&middot;</span>
                                <span className="text-[9px] font-medium tabular-nums" style={{ color: '#10B98199' }}>{meal.protein}g P</span>
                                <span className="text-[7px]" style={{ color: 'var(--color-text-subtle)' }}>&middot;</span>
                                <span className="text-[9px] font-medium tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{meal.carbs ?? 0}g C</span>
                                <span className="text-[7px]" style={{ color: 'var(--color-text-subtle)' }}>&middot;</span>
                                <span className="text-[9px] font-medium tabular-nums" style={{ color: '#A78BFA99' }}>{meal.fat ?? 0}g F</span>
                              </div>
                            </div>
                            {!isPastWeek && (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleRemoveMeal(date, slot); }}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center active:scale-90 transition-all"
                                  style={{ background: 'rgba(239,68,68,0.08)' }}
                                  aria-label={t('nutrition.remove', 'Remove')}
                                >
                                  <X size={11} className="text-[#EF4444]" />
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="w-9 h-9 rounded-[8px] flex items-center justify-center" style={{ background: `${slotColor}10` }}>
                              <Plus size={14} style={{ color: `${slotColor}80` }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: slotColor }}>{t(`nutrition.meals.${slot}`)}</span>
                              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                                {t('nutrition.tapToAdd', 'Tap to add')}
                              </p>
                            </div>
                          </>
                        )}
                      </button>
                      {/* Remove overlay */}
                      {isRemoving && meal && (
                        <div className="absolute inset-0 flex items-center justify-end pr-3 rounded-[12px]"
                          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
                          <button onClick={() => handleRemoveMeal(date, slot)}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-bold active:scale-90 transition-all"
                            style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.25)' }}>
                            <X size={12} className="inline mr-1" />{t('nutrition.remove', 'Remove')}
                          </button>
                          <button onClick={() => setRemovingSlot(null)}
                            className="ml-2 px-3 py-1.5 rounded-lg text-[11px] font-bold"
                            style={{ color: 'var(--color-text-muted)' }}>
                            {t('nutrition.cancel', 'Cancel')}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Day macro totals */}
              {hasMeals && (
                <div className="px-4 pb-3.5 pt-1.5" style={{ borderTop: '1px solid var(--color-border-subtle))' }}>
                  {/* Total row */}
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>{t('nutrition.total', 'Total')}</span>
                    <div className="flex items-center gap-2.5 text-[9px] font-semibold tabular-nums">
                      <span style={{ color: getMacroColor(dayCal, calTarget) }}>{dayCal} cal</span>
                      <span style={{ color: getMacroColor(dayP, proteinTarget) }}>{dayP}g P</span>
                      <span style={{ color: getMacroColor(dayC, carbsTarget) }}>{dayC}g C</span>
                      <span style={{ color: getMacroColor(dayF, fatTarget) }}>{dayF}g F</span>
                    </div>
                  </div>
                  {/* Remaining row */}
                  {(() => {
                    const calRemaining = calTarget - dayCal;
                    const pRemaining = proteinTarget - dayP;
                    const cRemaining = carbsTarget - dayC;
                    const fRemaining = fatTarget - dayF;
                    const hasEmptySlots = PLANNER_SLOT_KEYS.some(k => !dayData[k]);
                    if (calRemaining <= 0 && pRemaining <= 0) return null;
                    return (
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-warning)' }}>{t('nutrition.remaining', 'Remaining')}</span>
                        <div className="flex items-center gap-2.5 text-[9px] font-medium tabular-nums">
                          <span style={{ color: 'var(--color-warning)' }}>{Math.round(Math.max(0, calRemaining))} cal</span>
                          <span style={{ color: 'var(--color-success)' }}>{Math.round(Math.max(0, pRemaining))}g P</span>
                          <span style={{ color: '#FBBF24' }}>{Math.round(Math.max(0, cRemaining))}g C</span>
                          <span style={{ color: '#F97316' }}>{Math.round(Math.max(0, fRemaining))}g F</span>
                        </div>
                      </div>
                    );
                  })()}
                  {/* Complete button */}
                  {(() => {
                    const hasEmptySlots = PLANNER_SLOT_KEYS.some(k => !dayData[k]);
                    if (!hasEmptySlots || isPastWeek) return null;
                    return (
                      <div className="flex justify-end mt-2">
                        <button onClick={() => handleCompleteDay(date)}
                          className="text-[10px] font-bold px-2.5 py-1 rounded-lg active:scale-90 transition-all"
                          style={{ background: 'rgba(212,175,55,0.1)', color: 'var(--color-accent)', border: '1px solid rgba(212,175,55,0.2)' }}>
                          {t('nutrition.complete')}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>{/* end scrollable content area */}
    </div>
  );

  return content;
};

// Helper: count planned days this week
const countPlannedDays = (userId) => {
  try {
    const ws = getWeekStartDate();
    // Try new week-specific key first
    let raw = localStorage.getItem(`meal_plan_${userId || 'anon'}_${ws}`);
    if (!raw) {
      // Fallback: legacy key
      raw = localStorage.getItem(`meal_plan_${userId || 'anon'}`);
    }
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    if (parsed.weekStart !== ws) return 0;
    const days = parsed.days || {};
    return Object.values(days).filter(d => PLANNER_SLOT_KEYS.some(k => d[k])).length;
  } catch { return 0; }
};

// ── HOME VIEW ───────────────────────────────────────────────
const HomeView = ({ targets, todayTotals, todayLogs, savedIds, onSave, onOpenRecipe, onOpenSearch, onDeleteLog, onOpenLog, setView, openEdit, embedded = false, userId }) => {
  const { t, i18n } = useTranslation('pages');
  const lang = i18n.language || 'en';

  const [showPlanner, setShowPlanner] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [plannedDays, setPlannedDays] = useState(() => countPlannedDays(userId));
  const [compliancePct, setCompliancePct] = useState(0);
  const [workoutBurn, setWorkoutBurn] = useState(0);
  const [cardioBurn, setCardioBurn] = useState(0);
  const [logViewMode, setLogViewMode] = useState('list'); // 'list' | 'timeline'

  // Fetch today's workout calorie burn + cardio calorie burn
  useEffect(() => {
    if (!userId) return;
    const fetchBurn = async () => {
      const todayStart = todayStr() + 'T00:00:00';
      const [workoutRes, cardioRes] = await Promise.all([
        supabase
          .from('workout_sessions')
          .select('duration_seconds')
          .eq('profile_id', userId)
          .eq('status', 'completed')
          .gte('completed_at', todayStart),
        supabase
          .from('cardio_sessions')
          .select('calories_burned')
          .eq('profile_id', userId)
          .gte('started_at', todayStart),
      ]);
      if (workoutRes.data && workoutRes.data.length > 0) {
        const totalSeconds = workoutRes.data.reduce((s, r) => s + (r.duration_seconds || 0), 0);
        setWorkoutBurn(Math.round((totalSeconds / 60) * 7)); // 7 cal/min average
      }
      if (cardioRes.data && cardioRes.data.length > 0) {
        const totalCardio = cardioRes.data.reduce((s, r) => s + (r.calories_burned || 0), 0);
        setCardioBurn(totalCardio);
      }
    };
    fetchBurn();
  }, [userId]);

  // Adjusted targets including workout burn + cardio burn
  const totalBurn = workoutBurn + cardioBurn;
  const adjustedCalTarget = (targets?.daily_calories || 2000) + totalBurn;
  const adjustedProteinTarget = (targets?.daily_protein_g || 150) + Math.round(totalBurn * 0.4 / 4);
  const adjustedCarbsTarget = (targets?.daily_carbs_g || 200) + Math.round(totalBurn * 0.6 / 4);
  const adjustedFatTarget = targets?.daily_fat_g || 65;

  const calTarget = adjustedCalTarget;
  const caloriesLeft = Math.max(0, calTarget - todayTotals.calories);
  const caloriesOver = todayTotals.calories > calTarget;

  // Recalculate planned days when planner closes
  useEffect(() => {
    if (!showPlanner) setPlannedDays(countPlannedDays(userId));
  }, [showPlanner, userId]);

  // Calculate compliance from weekly data
  useEffect(() => {
    if (!userId) return;
    const fetchCompliance = async () => {
      const dates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return toLocalDateStr(d);
      });
      const { data: logs } = await supabase
        .from('food_logs')
        .select('log_date, calories, protein_g, carbs_g, fat_g')
        .eq('profile_id', userId)
        .gte('log_date', dates[0])
        .lte('log_date', dates[6]);
      if (!logs) return;
      const byDate = {};
      for (const date of dates) byDate[date] = { calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0 };
      for (const log of logs) {
        const d = byDate[log.log_date];
        if (d) { d.calories += log.calories || 0; d.protein += log.protein_g || 0; d.carbs += log.carbs_g || 0; d.fat += log.fat_g || 0; d.meals++; }
      }
      const cTarget = targets?.daily_calories || 2000;
      const pTarget = targets?.daily_protein_g || 150;
      const cbTarget = targets?.daily_carbs_g || 200;
      const fTarget = targets?.daily_fat_g || 65;
      const tracked = dates.filter(d => byDate[d].meals > 0);
      const compliant = tracked.filter(d => {
        const day = byDate[d];
        return Math.abs(day.calories - cTarget) / cTarget <= 0.15
          && Math.abs(day.protein - pTarget) / pTarget <= 0.15
          && Math.abs(day.carbs - cbTarget) / cbTarget <= 0.15
          && Math.abs(day.fat - fTarget) / fTarget <= 0.15;
      }).length;
      setCompliancePct(tracked.length > 0 ? Math.round((compliant / tracked.length) * 100) : 0);
    };
    fetchCompliance();
  }, [userId, targets]);

  const mealGroups = MEAL_TYPES.reduce((acc, mt) => {
    acc[mt.key] = todayLogs.filter(l => l.meal_type === mt.key);
    return acc;
  }, {});

  // Weekly planner overlay
  const plannerOverlay = showPlanner && (
    <WeeklyMealPlanner
      onClose={() => setShowPlanner(false)}
      targets={targets}
      onOpenRecipe={onOpenRecipe}
      onOpenSearch={onOpenSearch}
      userId={userId}
      embedded={embedded}
    />
  );

  return (
    <div className={embedded ? 'pb-4' : 'pb-28 md:pb-12'}>
      {/* Weekly Planner Overlay */}
      {showPlanner && embedded && createPortal(
        <div className="fixed inset-0 z-[60] overflow-y-auto" style={{ background: 'var(--color-bg-primary)', paddingTop: 'env(safe-area-inset-top)' }}>
          {plannerOverlay}
        </div>,
        document.body
      )}
      {showPlanner && !embedded && plannerOverlay}

      {/* Header — only show on standalone page */}
      {!embedded && (
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight leading-none truncate" style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.title')}</h1>
            <p className="text-[12px] text-[#9CA3AF] mt-1 font-medium">{format(new Date(), 'EEEE, MMM d')}</p>
          </div>
        </div>
      )}

      {/* ── Top Row — 3 buttons ── */}
      <div className="flex items-center gap-2 px-4 pt-2 pb-4">
        {/* Plan Semanal */}
        <button onClick={() => setShowPlanner(true)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-bold active:scale-95 transition-all"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border-subtle))',
            color: 'var(--color-text-primary)',
          }}>
          <Calendar size={13} style={{ color: 'var(--color-accent)' }} />
          <span style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.weeklyPlanBtn', 'Plan')}</span>
          <span className="text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded-md ml-0.5"
            style={{ background: 'rgba(212,175,55,0.12)', color: 'var(--color-accent)' }}>
            {plannedDays}/7
          </span>
        </button>

        {/* Resumen Semanal */}
        <button onClick={() => setShowSummary(s => !s)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-bold active:scale-95 transition-all"
          style={{
            background: showSummary ? 'rgba(212,175,55,0.08)' : 'var(--color-bg-card)',
            border: showSummary ? '1px solid rgba(212,175,55,0.2)' : '1px solid var(--color-border-subtle))',
            color: 'var(--color-text-primary)',
          }}>
          <BarChart2 size={13} style={{ color: 'var(--color-success)' }} />
          <span style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.summaryBtn', 'Summary')}</span>
          <span className="text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded-md ml-0.5"
            style={{ background: compliancePct >= 70 ? 'rgba(16,185,129,0.12)' : compliancePct >= 40 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)', color: compliancePct >= 70 ? 'var(--color-success)' : compliancePct >= 40 ? 'var(--color-warning)' : 'var(--color-danger)' }}>
            {compliancePct}%
          </span>
        </button>

        {/* Edit targets */}
        <button onClick={openEdit}
          className="w-10 h-10 rounded-xl flex items-center justify-center active:scale-90 transition-all flex-shrink-0"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border-subtle))',
          }}
          aria-label={t('nutrition.edit', 'Edit')}>
          <Edit2 size={14} style={{ color: 'var(--color-text-muted)' }} />
        </button>
      </div>

      {/* ── Weekly Summary (collapsed by default, toggled by button) ── */}
      {showSummary && (
        <WeeklyNutritionSummary userId={userId} targets={targets} startExpanded />
      )}

      {/* ── Calorie Ring + Macro Rings ── */}
      <div className="mx-4 mb-7 rounded-[20px] overflow-hidden"
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
        {/* Calorie ring hero */}
        <div className="flex flex-col items-center pt-8 pb-5">
          <MacroRing
            value={todayTotals.calories}
            max={calTarget}
            color={caloriesOver ? 'var(--color-danger)' : 'var(--color-warning)'}
            size={148}
            strokeWidth={10}
            label=""
            unit="kcal"
            hero
          />
          <p className="text-[11px] text-[#9CA3AF] mt-3 font-medium tracking-wide">
            {caloriesOver
              ? <span className="text-[#EF4444] font-semibold">{Math.round(todayTotals.calories - calTarget)} {t('nutrition.overTarget', 'over target')}</span>
              : <><span className="text-[#9CA3AF] font-semibold">{Math.round(caloriesLeft)}</span> {t('nutrition.remainingOf', 'remaining of')} <span className="text-[#6B7280]">{calTarget}</span></>
            }
          </p>
        </div>

        {/* Macro mini-rings row */}
        <div className="flex justify-around px-5 pb-6 pt-5 mx-4 border-t border-white/[0.04]">
          <MacroRing value={todayTotals.protein} max={adjustedProteinTarget} color="var(--color-success)" size={66} strokeWidth={4.5} label={t('nutrition.protein')} unit="g" />
          <MacroRing value={todayTotals.carbs}   max={adjustedCarbsTarget}   color="var(--color-blue-soft)" size={66} strokeWidth={4.5} label={t('nutrition.carbs')}   unit="g" />
          <MacroRing value={todayTotals.fat}     max={adjustedFatTarget}     color="#A78BFA" size={66} strokeWidth={4.5} label={t('nutrition.fat')}     unit="g" />
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

      {/* ── Workout Calorie Burn ── */}
      {workoutBurn > 0 && (
        <div className="mx-4 mb-5 px-4 py-3 rounded-[14px] flex items-center gap-2.5"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)' }}>
          <span className="text-[16px]">{'\u{1F525}'}</span>
          <span className="text-[12px] font-semibold" style={{ color: 'var(--color-danger)' }}>
            {t('nutrition.burnFromWorkout', { cal: workoutBurn })}
          </span>
        </div>
      )}

      {/* ── Cardio Calorie Burn ── */}
      {cardioBurn > 0 && (
        <div className="mx-4 mb-5 px-4 py-3 rounded-[14px] flex items-center gap-2.5"
          style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.12)' }}>
          <span className="text-[16px]">{'\u{1F3C3}'}</span>
          <span className="text-[12px] font-semibold" style={{ color: 'var(--color-success)' }}>
            {t('nutrition.burnFromCardio', { cal: cardioBurn })}
          </span>
        </div>
      )}

      {/* ── Sugerencia del Día — always visible ── */}
      <DailySuggestion
        targets={targets}
        todayTotals={todayTotals}
        onOpenRecipe={onOpenRecipe}
        lang={lang}
        t={t}
        userId={userId}
        workoutBurn={totalBurn}
      />

      {/* ── Today's Meals ── */}
      <div className="mb-8 px-4">
        <div className="flex items-center justify-between mb-5">
          <p className="text-[10px] font-extrabold text-[#525C6B] uppercase tracking-[0.18em]">{t('nutrition.todaysMeals')}</p>
          {todayLogs.length > 0 && (
            <button onClick={() => setLogViewMode(v => v === 'list' ? 'timeline' : 'list')}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors"
              style={logViewMode === 'timeline'
                ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }
                : { color: 'var(--color-text-muted)' }
              }>
              <Clock size={12} />
              Timeline
            </button>
          )}
        </div>

        {/* ── Timeline View ── */}
        {logViewMode === 'timeline' && todayLogs.length > 0 ? (
          <div className="space-y-0">
            {[...todayLogs].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map((log, i, arr) => {
              const time = new Date(log.created_at);
              const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const mt = MEAL_TYPES.find(m => m.key === log.meal_type) || MEAL_TYPES[3];
              const Icon = mt.icon;
              const logImg = log.photo_url || getFoodImage(log.food_item?.name, log.food_item?.brand) || foodImageUrl(log.food_item?.image_url);
              const isLast = i === arr.length - 1;
              return (
                <div key={log.id} className="flex gap-3 pl-1">
                  {/* Timeline column */}
                  <div className="flex flex-col items-center w-12 shrink-0">
                    <span className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{timeStr}</span>
                    {!isLast && <div className="flex-1 w-px mt-1" style={{ backgroundColor: 'var(--color-border-subtle)' }} />}
                  </div>
                  {/* Food card */}
                  <div className="flex-1 pb-3">
                    <button onClick={() => onOpenLog(log)}
                      className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-[16px] text-left transition-all active:scale-[0.975]"
                      style={{
                        background: 'var(--color-bg-card)',
                        border: '1px solid var(--color-border-subtle)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                      }}>
                      {logImg ? (
                        <div className="relative flex-shrink-0">
                          <img src={logImg} alt="Food item photo" className="w-10 h-10 rounded-[11px] object-cover bg-[#1E293B]"
                            style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }} loading="lazy" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-[11px] flex-shrink-0 flex items-center justify-center"
                          style={{ backgroundColor: `${mt.color}10` }}>
                          <Icon size={16} style={{ color: `${mt.color}60` }} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[13px] font-semibold truncate leading-snug" style={{ color: 'var(--color-text-primary)' }}>{(lang === 'es' && log.food_item?.name_es) ? log.food_item.name_es : (log.food_item?.name || log.custom_name || 'Food')}</p>
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0"
                            style={{ backgroundColor: `${mt.color}12`, color: mt.color }}>{t(mt.labelKey)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[10px] font-semibold tabular-nums" style={{ color: '#F59E0B' }}>{log.calories ?? 0} cal</span>
                          <span className="text-[8px]" style={{ color: 'var(--color-text-subtle)' }}>·</span>
                          <span className="text-[10px] font-medium tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{log.protein_g ?? 0}g P</span>
                          <span className="text-[8px]" style={{ color: 'var(--color-text-subtle)' }}>·</span>
                          <span className="text-[10px] font-medium tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{log.carbs_g ?? 0}g C</span>
                          <span className="text-[8px]" style={{ color: 'var(--color-text-subtle)' }}>·</span>
                          <span className="text-[10px] font-medium tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{log.fat_g ?? 0}g F</span>
                        </div>
                      </div>
                      <NutriScoreBadge score={nutriScore(log.calories, log.protein_g, log.carbs_g, log.fat_g, log.serving_grams || 100)} />
                      <ChevronRight size={14} className="text-[#2A3040] flex-shrink-0 ml-1" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
        /* ── Default List View (grouped by meal type) ── */
        MEAL_TYPES.map((mt, idx) => {
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
                <span className="text-[12px] font-bold capitalize tracking-wide" style={{ color: 'var(--color-text-primary)' }}>{t(mt.labelKey)}</span>
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
                            <img src={logImg} alt="Food item photo" className="w-10 h-10 rounded-[11px] object-cover bg-[#1E293B]"
                              style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }} loading="lazy" />
                          </div>
                        ) : (
                          <div className="w-10 h-10 rounded-[11px] flex-shrink-0 flex items-center justify-center"
                            style={{ backgroundColor: `${mt.color}10` }}>
                            <Icon size={16} style={{ color: `${mt.color}60` }} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold truncate leading-snug" style={{ color: 'var(--color-text-primary)' }}>{(lang === 'es' && log.food_item?.name_es) ? log.food_item.name_es : (log.food_item?.name || log.custom_name || 'Food')}</p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[10px] font-semibold tabular-nums" style={{ color: '#F59E0B' }}>{log.calories ?? 0} cal</span>
                            <span className="text-[8px]" style={{ color: 'var(--color-text-subtle)' }}>·</span>
                            <span className="text-[10px] font-medium tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{log.protein_g ?? 0}g P</span>
                            <span className="text-[8px]" style={{ color: 'var(--color-text-subtle)' }}>·</span>
                            <span className="text-[10px] font-medium tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{log.carbs_g ?? 0}g C</span>
                            <span className="text-[8px]" style={{ color: 'var(--color-text-subtle)' }}>·</span>
                            <span className="text-[10px] font-medium tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{log.fat_g ?? 0}g F</span>
                          </div>
                        </div>
                        <NutriScoreBadge score={nutriScore(log.calories, log.protein_g, log.carbs_g, log.fat_g, log.serving_grams || 100)} />
                        <ChevronRight size={14} className="text-[#2A3040] flex-shrink-0 ml-1" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
        )}
      </div>

      {/* ── Quick Actions ── */}
      <div className="px-4 grid grid-cols-3 gap-3 mb-4">
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
    <div className="pb-28 md:pb-12" >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-5">
        <button onClick={() => setView('home')} className="w-11 h-11 rounded-xl bg-white/[0.04] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" aria-label="Go back">
          <ChevronLeft size={18} className="text-[#9CA3AF]" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.cookWithWhatYouHave')}</h1>
          <p className="text-[11px] text-[#9CA3AF] mt-0.5">{t('nutrition.selectIngredients')}</p>
        </div>
      </div>

      {/* Selected ingredients pills */}
      {selectedIngredients.length > 0 && (
        <div className="px-4 mb-4">
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
      <div className="px-4 mb-4">
        <div className="relative flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input type="text" value={ingredientQuery}
              onChange={e => { setIngredientQuery(e.target.value); }}
              placeholder={t('nutrition.searchIngredients', 'Search ingredients...')}
              aria-label={t('nutrition.searchIngredients', 'Search ingredients')}
              className="w-full bg-[#0F172A] border border-white/[0.06] rounded-xl pl-10 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/30 transition-colors" />
          </div>
          <button
            onClick={() => setShowRecipeFilters(true)}
            className="relative flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center transition-all active:scale-95 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            aria-label="Filter recipes"
            style={{
              background: activeFilter !== 'all' ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'var(--color-surface-hover)',
              border: `1px solid ${activeFilter !== 'all' ? 'color-mix(in srgb, var(--color-accent) 30%, transparent)' : 'var(--color-border-subtle)'}`,
              color: activeFilter !== 'all' ? 'var(--color-accent)' : 'var(--color-text-subtle)',
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
        <div className="px-4 mb-4">
          <div className="flex flex-wrap gap-2">
            {filteredForQuery.length === 0 ? (
              <p className="text-[12px] text-[#9CA3AF]">{t('nutrition.noIngredientsMatch', 'No ingredients match')} "{ingredientQuery}"</p>
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
        <div className="px-4 mb-5">
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
          role="presentation"
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
                          color: active ? 'var(--color-bg-secondary)' : 'var(--color-text-muted)',
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
        <div className="px-4">
          <p className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-4">
            {matchedRecipes.length} {matchedRecipes.length !== 1 ? t('nutrition.recipesPlural', 'recipes') : t('nutrition.recipeSingular', 'recipe')} {t('nutrition.found', 'found')}
          </p>
          {matchedRecipes.length === 0 ? (
            <div className="rounded-[18px] bg-[#0F172A] border border-white/[0.06] p-6 text-center">
              <p className="text-[14px] font-semibold text-[#6B7280] mb-1">{t('nutrition.noMatchesYet', 'No matches yet')}</p>
              <p className="text-[12px] text-[#9CA3AF]">{t('nutrition.tryAddingMore', 'Try adding more ingredients or changing the filter.')}</p>
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
                        <span className="flex items-center gap-0.5 text-[10px] text-[#9CA3AF]"><Clock size={9} />{recipe.prepTime}m</span>
                      </div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); onSave(recipe.id); }}
                      className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/[0.04] flex-shrink-0"
                      aria-label={savedIds.has(recipe.id) ? 'Remove bookmark' : 'Bookmark recipe'}>
                      <Bookmark size={13} className={savedIds.has(recipe.id) ? 'fill-[#D4AF37] text-[#D4AF37]' : 'text-[#9CA3AF]'} />
                    </button>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selectedIngredients.length === 0 && (
        <div className="px-4 mt-2">
          <div className="rounded-[18px] bg-[#0F172A] border border-white/[0.06] p-5 text-center">
            <p className="text-[30px] mb-2">🥘</p>
            <p className="text-[14px] font-semibold text-[#6B7280]">{t('nutrition.pickIngredients', 'Pick your ingredients above')}</p>
            <p className="text-[12px] text-[#9CA3AF] mt-1">{t('nutrition.wellShowRecipes', "We'll show you recipes you can make right now.")}</p>
          </div>
        </div>
      )}

      {/* ── Browse by Category ── */}
      <div className="mt-8 mb-2">
        <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest px-4 mb-5">{t('nutrition.browseRecipes', 'Browse Recipes')}</p>
        {CATEGORIES.map(cat => (
          <CategoryRow key={cat.id} category={cat} recipes={RECIPES} savedIds={savedIds} onSave={onSave} onOpen={onOpenRecipe} lang={lang} />
        ))}
      </div>

      {/* ── Weekly Collections ── */}
      <div className="mb-7">
        <p className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-widest px-4 mb-4">{t('nutrition.weeklyCollections', 'Weekly Collections')}</p>
        <div className="px-4 space-y-3">
          {WEEKLY_COLLECTIONS.map(col => {
            const colRecipes = RECIPES.filter(r => col.recipeIds.includes(r.id));
            return (
              <button key={col.id} onClick={() => onOpenCollection(col)}
                className="w-full text-left rounded-[18px] bg-[#0F172A] border border-white/[0.06] overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 pr-3">
                      <h4 className="text-[14px] font-bold text-[#E5E7EB] leading-snug">{t(`nutrition_ingredients.weeklyCollections.${col.id}_title`, col.title)}</h4>
                      <p className="text-[11px] text-[#9CA3AF] mt-0.5">{t(`nutrition_ingredients.weeklyCollections.${col.id}_subtitle`, col.subtitle)}</p>
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
    <div className="pb-28 md:pb-12" >
      <div className="flex items-center gap-3 px-4 pt-4 pb-5">
        <button onClick={() => setView('home')} className="w-11 h-11 rounded-xl bg-white/[0.04] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" aria-label="Go back">
          <ChevronLeft size={18} className="text-[#9CA3AF]" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.savedRecipes')}</h1>
          <p className="text-[11px] text-[#9CA3AF] mt-0.5">{savedRecipes.length} {t('nutrition.saved', 'saved')}</p>
        </div>
      </div>

      {savedRecipes.length === 0 ? (
        <div className="mx-4 rounded-[18px] bg-[#0F172A] border border-white/[0.06] p-8 text-center">
          <Bookmark size={28} className="text-[#374151] mx-auto mb-3" />
          <p className="text-[15px] font-bold text-[#6B7280] mb-1">{t('nutrition.noSavedRecipes', 'No saved recipes yet')}</p>
          <p className="text-[12px] text-[#9CA3AF] mb-4">{t('nutrition.tapBookmark', 'Tap the bookmark icon on any recipe to save it here.')}</p>
          <button onClick={() => setView('home')}
            className="px-5 py-2.5 rounded-xl bg-[#D4AF37]/15 border border-[#D4AF37]/25 text-[13px] font-semibold text-[#D4AF37]">
            {t('nutrition.browseRecipes', 'Browse Recipes')}
          </button>
        </div>
      ) : (
        <div className="px-4">
          <VirtualList
            height={Math.min(savedRecipes.length * 100, 600)}
            itemCount={savedRecipes.length}
            itemSize={100}
            width="100%"
            className="scrollbar-hide"
          >
            {({ index, style }) => {
              const recipe = savedRecipes[index];
              const tagColor = TAG_COLORS[recipe.tag] || 'var(--color-text-muted)';
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
                        <span className="flex items-center gap-0.5 text-[10px] text-[#9CA3AF]"><Clock size={9} />{recipe.prepTime}m</span>
                      </div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); onSave(recipe.id); }}
                      className="min-w-[44px] min-h-[44px] w-8 h-8 flex items-center justify-center rounded-xl bg-[#D4AF37]/10 flex-shrink-0 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                      aria-label="Remove bookmark">
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
    <div className="pb-28 md:pb-12" >
      <div className="flex items-center justify-between px-4 pt-4 pb-5">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button onClick={() => setView('home')} className="w-11 h-11 rounded-xl bg-white/[0.04] flex items-center justify-center flex-shrink-0 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" aria-label="Go back">
            <ChevronLeft size={18} className="text-[#9CA3AF]" />
          </button>
          <div className="min-w-0">
            <h1 className="text-[20px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.groceryList')}</h1>
            <p className="text-[11px] text-[#9CA3AF] mt-0.5">{checkedCount}/{groceryList.length} {t('nutrition.checked', 'checked')}</p>
          </div>
        </div>
        {checkedCount > 0 && (
          <button onClick={onClearChecked}
            className="text-[11px] font-semibold text-[#9CA3AF] hover:text-[#6B7280] transition-colors px-3 py-1.5 rounded-lg bg-white/[0.04]">
            {t('nutrition.clearChecked', 'Clear checked')}
          </button>
        )}
      </div>

      {groceryList.length === 0 ? (
        <div className="mx-4 rounded-[18px] bg-[#0F172A] border border-white/[0.06] p-8 text-center">
          <ShoppingCart size={28} className="text-[#374151] mx-auto mb-3" />
          <p className="text-[15px] font-bold text-[#6B7280] mb-1">{t('nutrition.groceryListEmpty', 'Your grocery list is empty')}</p>
          <p className="text-[12px] text-[#9CA3AF] mb-4">{t('nutrition.groceryListEmptyHint', 'Open a recipe and tap "Add to Grocery List" to get started.')}</p>
          <button onClick={() => setView('home')}
            className="px-5 py-2.5 rounded-xl bg-[#D4AF37]/15 border border-[#D4AF37]/25 text-[13px] font-semibold text-[#D4AF37]">
            {t('nutrition.browseRecipes', 'Browse Recipes')}
          </button>
        </div>
      ) : (
        <div className="px-4 space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <p className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-3">{category}</p>
              <div className="space-y-2">
                {items.map(item => (
                  <div key={item.id}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-[#0F172A] border transition-all ${item.checked ? 'border-white/[0.03] opacity-50' : 'border-white/[0.06]'}`}>
                    <button onClick={() => onToggleItem(item.id)}
                      className="flex-shrink-0 min-w-[44px] min-h-[44px] w-6 h-6 flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                      aria-label={item.checked ? 'Uncheck item' : 'Check item'}>
                      {item.checked
                        ? <CheckCircle size={20} className="text-[#10B981]" />
                        : <Circle size={20} className="text-[#374151]" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] font-semibold transition-all ${item.checked ? 'line-through text-[#9CA3AF]' : 'text-[#E5E7EB]'}`}>
                        {item.label}
                      </p>
                      {item.fromRecipe && (
                        <p className="text-[10px] text-[#9CA3AF] mt-0.5">{t('nutrition.forRecipe', 'For')}: {item.fromRecipe}</p>
                      )}
                    </div>
                    <button onClick={() => onRemoveItem(item.id)}
                      className="min-w-[44px] min-h-[44px] w-6 h-6 flex items-center justify-center flex-shrink-0 opacity-40 hover:opacity-100 transition-opacity focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                      aria-label="Remove item">
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
    <div className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-2xl" style={{ background: 'var(--color-nav-bg)', borderTop: '1px solid var(--color-border-subtle)', paddingBottom: 'var(--safe-area-bottom, env(safe-area-inset-bottom))' }}>
      <div className="flex mx-auto max-w-[480px] md:max-w-4xl lg:max-w-6xl">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setView(tab.id)}
            className={`flex-1 flex flex-col items-center py-3 gap-1 transition-all focus:ring-2 focus:ring-[#D4AF37] focus:outline-none ${view === tab.id ? 'text-[#D4AF37]' : 'text-[#374151]'}`}>
            <tab.Icon size={20} className={view === tab.id ? 'stroke-[2.5]' : 'stroke-[1.5]'} />
            <span className={`text-[10px] font-semibold ${view === tab.id ? 'text-[#D4AF37]' : 'text-[#9CA3AF]'}`}>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// ── MAIN ─────────────────────────────────────────────────────
export default function Nutrition({ embedded = false }) {
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
  const [barcodeScanning, setBarcodeScanning] = useState(false);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [barcodeProduct, setBarcodeProduct] = useState(null);
  const [barcodeError, setBarcodeError] = useState('');

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
  const [collectionContext, setCollectionContext] = useState(null);
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
          label: t(`nutrition_ingredients.items.${ing}`, match?.label || ing.replace(/_/g, ' ')),
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
      supabase.from('food_logs').select('id, food_item_id, calories, protein_g, carbs_g, fat_g, meal_type, servings, custom_name, photo_url, created_at, log_date, food_item:food_items(name, name_es, brand, serving_size, serving_unit, image_url)').eq('profile_id', user.id).eq('log_date', todayStr()).order('created_at', { ascending: false }),
      supabase.from('favorite_foods').select('food_item_id, food_item:food_items(id, name, name_es, brand, image_url, serving_size, serving_unit, calories, protein_g, carbs_g, fat_g)').eq('profile_id', user.id),
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
    supabase.from('food_logs').select('food_item_id, food_item:food_items(id, name, name_es, brand, image_url, serving_size, serving_unit, calories, protein_g, carbs_g, fat_g)')
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

  // ── Barcode scanning ──
  const handleBarcodeRequest = useCallback(async (signal) => {
    if (signal === '__open_scanner__') {
      setSearchOpen(false);
      setBarcodeError('');
      setBarcodeProduct(null);

      const processBarcode = async (rawValue) => {
        setBarcodeScanning(false);
        setBarcodeLoading(true);
        try {
          const product = await lookupBarcode(rawValue, lang);
          if (!product) {
            setBarcodeError(t('nutrition.productNotFound'));
          } else {
            setBarcodeProduct(product);
          }
        } catch (err) {
          setBarcodeError(err.message === 'network' ? t('nutrition.networkError') : t('nutrition.barcodeError'));
        } finally {
          setBarcodeLoading(false);
        }
      };

      if (Capacitor.isNativePlatform()) {
        try {
          setBarcodeScanning(true);
          const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');
          const { camera } = await BarcodeScanner.requestPermissions();
          if (camera !== 'granted') { setBarcodeError(t('nutrition.barcodeError')); setBarcodeScanning(false); return; }
          const { barcodes } = await BarcodeScanner.scan({
            formats: [BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA, BarcodeFormat.UpcE],
          });
          if (barcodes.length > 0 && barcodes[0].rawValue) {
            await processBarcode(barcodes[0].rawValue);
          } else {
            setBarcodeScanning(false);
          }
        } catch (err) {
          setBarcodeScanning(false);
          if (!err?.message?.includes('cancel')) setBarcodeError(t('nutrition.barcodeError'));
        }
      } else {
        // Web fallback with html5-qrcode
        setBarcodeScanning(true);
        try {
          const { Html5Qrcode } = await import('html5-qrcode');
          await new Promise(r => setTimeout(r, 150));
          const el = document.getElementById('barcode-web-reader');
          if (!el) { setBarcodeScanning(false); return; }
          const html5Qr = new Html5Qrcode('barcode-web-reader', { verbose: false });
          const qrboxW = Math.min(window.innerWidth * 0.7, 320);
          await html5Qr.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: Math.round(qrboxW), height: Math.round(qrboxW * 0.5) } },
            async (decoded) => {
              html5Qr.stop().catch(() => {});
              await processBarcode(decoded);
            },
            () => {}
          );
          // Store ref for cleanup
          window.__barcodeScannerRef = html5Qr;
        } catch (err) {
          setBarcodeScanning(false);
          setBarcodeError(t('nutrition.barcodeError'));
        }
      }
    }
  }, [t]);

  const closeBarcodeScanner = useCallback(() => {
    setBarcodeScanning(false);
    setBarcodeLoading(false);
    setBarcodeError('');
    setBarcodeProduct(null);
    if (window.__barcodeScannerRef) {
      window.__barcodeScannerRef.stop().catch(() => {});
      window.__barcodeScannerRef = null;
    }
  }, []);

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
      // Clear pending data so the recovery useEffect doesn't re-trigger
      try {
        localStorage.removeItem('_pendingFoodBase64');
        localStorage.removeItem('_pendingFoodThumb');
      } catch {}
    } catch (err) {
      console.error('[FoodAnalysis] handlePhotoCapture error:', err);
      setPhotoError(err.message || 'Failed to analyze food photo. Please try again.');
      try {
        localStorage.removeItem('_pendingFoodBase64');
        localStorage.removeItem('_pendingFoodThumb');
      } catch {}
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
    await supabase.from('food_logs').delete().eq('id', logId).eq('profile_id', user.id);
    setTodayLogs(prev => prev.filter(l => l.id !== logId));
  };

  const handleUpdateLog = async (logId, updates) => {
    const { data, error } = await supabase.from('food_logs')
      .update(updates)
      .eq('id', logId)
      .eq('profile_id', user.id)
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
    const clamp = (v, min, max) => Math.max(min, Math.min(max, parseInt(v) || 0));
    const payload = {
      profile_id: user.id, gym_id: profile.gym_id,
      daily_calories: draft.daily_calories ? clamp(draft.daily_calories, 800, 10000) : null,
      daily_protein_g: draft.daily_protein_g ? clamp(draft.daily_protein_g, 10, 500) : null,
      daily_carbs_g: draft.daily_carbs_g ? clamp(draft.daily_carbs_g, 10, 1000) : null,
      daily_fat_g: draft.daily_fat_g ? clamp(draft.daily_fat_g, 5, 500) : null,
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
        <div className="min-h-screen bg-[#05070B] px-4 pt-6 pb-28 md:pb-12" aria-busy={true} aria-label="Loading nutrition data">
          <div className="mx-auto max-w-[480px] md:max-w-4xl lg:max-w-6xl space-y-4">
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
    <div className={embedded ? '' : 'min-h-screen bg-[#05070B]'}>
      <div className={embedded ? '' : 'mx-auto w-full max-w-[480px] md:max-w-4xl lg:max-w-6xl'}>
        {/* Home view always renders inline */}
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
            embedded={embedded}
            userId={user?.id}
          />
        )}

        {/* Sub-views: when embedded, render as fullscreen overlay via portal to escape SwipeableTabView */}
        {view !== 'home' && embedded && createPortal(
          <div className="fixed inset-0 z-[60] bg-[var(--color-bg-primary)] overflow-y-auto" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            <div className="mx-auto w-full max-w-[480px] md:max-w-4xl lg:max-w-6xl">
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
          </div>,
          document.body
        )}

        {/* Sub-views: when standalone, render inline as before */}
        {view !== 'home' && !embedded && (
          <>
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
          </>
        )}
      </div>

      {!embedded && <NutritionNav view={view} setView={setView} />}

      {/* Modals — portal when embedded to escape SwipeableTabView */}
      {embedded ? createPortal(<>
      <RecipeDetailModal
        recipe={openRecipe}
        onClose={() => { setOpenRecipe(null); if (collectionContext) { setOpenCollection(collectionContext); setCollectionContext(null); } }}
        saved={openRecipe ? savedRecipeIds.has(openRecipe.id) : false}
        onSave={toggleSaveRecipe}
        onAddToGrocery={handleAddToGrocery}
        groceryAdded={openRecipe ? groceryAdded.has(openRecipe.id) : false}
        lang={lang}
      />

      {/* Collection Detail Modal */}
      {openCollection && (() => {
        const colRecipes = RECIPES.filter(r => openCollection.recipeIds.includes(r.id));
        const totalCal = colRecipes.reduce((s, r) => s + (r.calories || 0), 0);
        const totalP = colRecipes.reduce((s, r) => s + (r.protein || 0), 0);
        const totalC = colRecipes.reduce((s, r) => s + (r.carbs || 0), 0);
        const totalF = colRecipes.reduce((s, r) => s + (r.fat || 0), 0);
        const colTitle = t(`nutrition_ingredients.weeklyCollections.${openCollection.id}_title`, openCollection.title);
        const colSubtitle = t(`nutrition_ingredients.weeklyCollections.${openCollection.id}_subtitle`, openCollection.subtitle);
        return (
          <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpenCollection(null)} role="presentation" />
            <div
              className="relative w-full max-w-md flex flex-col overflow-hidden"
              style={{
                maxHeight: '90vh',
                background: 'var(--color-bg-secondary)',
                borderRadius: 24,
                border: '1px solid var(--color-border-subtle)',
                boxShadow: '0 32px 64px rgba(0,0,0,0.6)',
              }}
            >
              {/* Header */}
              <div className="flex items-start justify-between px-5 pt-5 pb-2">
                <div className="flex-1 pr-3">
                  <h3 className="text-[18px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{colTitle}</h3>
                  <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>{colSubtitle}</p>
                </div>
                <button onClick={() => setOpenCollection(null)} className="w-8 h-8 rounded-full bg-white/[0.08] flex items-center justify-center flex-shrink-0 mt-0.5" aria-label="Close">
                  <X size={16} style={{ color: 'var(--color-text-muted)' }} />
                </button>
              </div>

              {/* Macro summary bar */}
              <div className="mx-5 mb-3 p-3 rounded-2xl border border-white/[0.04]" style={{ background: 'color-mix(in srgb, var(--color-bg-inset) 50%, transparent)' }}>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <p className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{totalCal}</p>
                    <p className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>{t('nutrition.kcalUnit', 'kcal')}</p>
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-[#10B981]">{totalP}g</p>
                    <p className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>{t('nutrition.protein')}</p>
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-[#FBBF24]">{totalC}g</p>
                    <p className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>{t('nutrition.carbs')}</p>
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-[#F97316]">{totalF}g</p>
                    <p className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>{t('nutrition.fat')}</p>
                  </div>
                </div>
              </div>

              {/* Meal list */}
              <div className="overflow-y-auto flex-1 px-5 pb-6 space-y-2">
                {colRecipes.map(r => {
                  const title = (lang === 'es' && r.title_es) ? r.title_es : r.title;
                  const tag = (lang === 'es' && r.tag_es) ? r.tag_es : r.tag;
                  return (
                    <button key={r.id} onClick={() => { setCollectionContext(openCollection); setOpenCollection(null); setOpenRecipe(r); }}
                      className="w-full flex items-center gap-3 p-3 rounded-2xl text-left active:scale-[0.98] transition-transform"
                      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                      <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0" style={{ background: 'var(--color-bg-inset)' }}>
                        <img src={foodImageUrl(r.image)} alt={title} className="w-full h-full object-cover" loading="lazy" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{title}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{tag}</p>
                        <div className="flex gap-2 mt-1">
                          <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{r.calories} {t('nutrition.kcalUnit', 'kcal')}</span>
                          <span className="text-[10px] text-[#10B981]">{r.protein}g P</span>
                          <span className="text-[10px] text-[#FBBF24]">{r.carbs}g C</span>
                          <span className="text-[10px] text-[#F97316]">{r.fat}g F</span>
                        </div>
                      </div>
                      <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} className="flex-shrink-0" />
                    </button>
                  );
                })}
              </div>

              {/* Save collection button */}
              <div className="px-5 pb-5 pt-2 border-t border-white/[0.04]" style={{ background: 'var(--color-bg-secondary)' }}>
                <button
                  onClick={() => {
                    colRecipes.forEach(r => { if (!savedRecipeIds.has(r.id)) toggleSaveRecipe(r.id); });
                    setOpenCollection(null);
                  }}
                  className="w-full py-3 rounded-2xl font-semibold text-[14px] flex items-center justify-center gap-2 transition-colors"
                  style={{ background: openCollection.accent || 'var(--color-accent)', color: '#000' }}
                >
                  <Bookmark size={16} />
                  {t('nutrition.saveAllRecipes', 'Save All Recipes')}
                </button>
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
        onBarcodeResult={handleBarcodeRequest}
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

      {/* Barcode scanner overlay (web) */}
      {barcodeScanning && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-[#05070B]">
          {/* Header */}
          <div className="relative flex items-center justify-center py-4 px-4" style={{ background: 'linear-gradient(180deg, rgba(5,7,11,0.95) 0%, rgba(5,7,11,0.7) 100%)' }}>
            <button onClick={closeBarcodeScanner} className="absolute left-4 w-11 h-11 flex items-center justify-center rounded-full bg-white/[0.08] text-[#E5E7EB] active:scale-90 transition-transform" aria-label="Close">
              <X size={18} />
            </button>
            <div className="flex items-center gap-2">
              <ScanLine size={16} className="text-[#10B981]" />
              <span className="text-[15px] font-bold text-white">{t('nutrition.barcodeScanner')}</span>
            </div>
          </div>
          {/* Scanner area */}
          <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
            {/* Scan frame with animated corners */}
            <div className="relative w-full max-w-[280px] aspect-square">
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-[3px] border-l-[3px] border-[#10B981] rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-[3px] border-r-[3px] border-[#10B981] rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-[3px] border-l-[3px] border-[#10B981] rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-[3px] border-r-[3px] border-[#10B981] rounded-br-lg" />
              {/* Scanning line animation */}
              <div className="absolute inset-x-4 h-[2px] bg-gradient-to-r from-transparent via-[#10B981] to-transparent animate-pulse" style={{ top: '50%' }} />
              {/* Camera feed area */}
              <div id="barcode-web-reader" className="absolute inset-2 rounded-lg overflow-hidden" style={{ minHeight: 240 }} />
            </div>
            {/* Hint text */}
            <div className="text-center">
              <p className="text-[14px] text-[#E5E7EB] font-medium mb-1">{t('nutrition.scanBarcode')}</p>
              <p className="text-[12px] text-[#6B7280]">Point your camera at a product barcode</p>
            </div>
          </div>
        </div>
      )}

      {/* Barcode loading overlay */}
      {barcodeLoading && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#05070B]" aria-busy={true} aria-label="Looking up product">
          <div className="flex flex-col items-center gap-6">
            {/* Animated scan frame */}
            <div className="relative w-32 h-32">
              <div className="absolute top-0 left-0 w-6 h-6 border-t-[3px] border-l-[3px] border-[#10B981] rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-[3px] border-r-[3px] border-[#10B981] rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-[3px] border-l-[3px] border-[#10B981] rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-[3px] border-r-[3px] border-[#10B981] rounded-br-lg" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader size={28} className="text-[#10B981] animate-spin" role="status" aria-label="Loading" />
              </div>
              <div className="absolute inset-x-3 h-[2px] bg-gradient-to-r from-transparent via-[#10B981] to-transparent animate-pulse" style={{ top: '50%' }} />
            </div>
            <div className="text-center">
              <p className="text-[15px] font-bold text-[#E5E7EB] mb-1">{t('nutrition.scanning')}</p>
              <p className="text-[12px] text-[#6B7280]">{t('nutrition.lookingUpProduct', 'Looking up product...')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Barcode error */}
      {barcodeError && !barcodeProduct && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center px-4" onClick={closeBarcodeScanner} role="presentation">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
          <div className="relative w-full max-w-sm rounded-[20px] p-6 text-center bg-[#0F172A]" onClick={e => e.stopPropagation()}>
            <AlertCircle size={36} className="text-[#EF4444] mx-auto mb-3" />
            <p className="text-[14px] text-[#E5E7EB] mb-4">{barcodeError}</p>
            <button onClick={closeBarcodeScanner} className="px-6 py-2.5 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37]">OK</button>
          </div>
        </div>
      )}

      <BarcodeResultModal
        product={barcodeProduct}
        onClose={closeBarcodeScanner}
        onLog={async (entry) => { await handleLogFood(entry); closeBarcodeScanner(); }}
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
      </>, document.body) : <>
      {/* Non-embedded modals render inline */}
      <RecipeDetailModal
        recipe={openRecipe}
        onClose={() => { setOpenRecipe(null); if (collectionContext) { setOpenCollection(collectionContext); setCollectionContext(null); } }}
        saved={openRecipe ? savedRecipeIds.has(openRecipe.id) : false}
        onSave={toggleSaveRecipe}
        onAddToGrocery={handleAddToGrocery}
        groceryAdded={openRecipe ? groceryAdded.has(openRecipe.id) : false}
        lang={lang}
      />
      <FoodSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={food => { setSearchOpen(false); setLogFood(food); }}
        onPhotoCapture={handlePhotoCapture}
        onBarcodeResult={handleBarcodeRequest}
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
      <BarcodeResultModal
        product={barcodeProduct}
        onClose={closeBarcodeScanner}
        onLog={async (entry) => { await handleLogFood(entry); closeBarcodeScanner(); }}
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
      </>}
    </div>
    </FadeIn>
  );
}
