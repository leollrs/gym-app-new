import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { getMeals, mealImageById } from '../lib/mealStore';
import SwipeableTabView from '../components/SwipeableTabView';
const MEALS = getMeals();
import {
  Plus, Search, X, Clock, ChevronRight, Flame, Trash2, Home,
  Heart, Check, Bookmark, ShoppingCart, ChevronLeft,
  Dumbbell, Zap, TrendingDown, TrendingUp, DollarSign,
  Star, Edit2, Circle, CheckCircle, UtensilsCrossed,
  Sunrise, Sun, Moon, Apple, Camera, CheckCircle2, AlertCircle,
  SlidersHorizontal, Sparkles, RefreshCw, BarChart2, ChevronDown, ChevronUp,
  Calendar, ScanLine, ScanBarcode, Loader, ArrowUp, ArrowDown,
  BookOpen, Utensils, ArrowRight, ThumbsUp, ThumbsDown, Bell, Minus,
} from 'lucide-react';
import { usePostHog } from '@posthog/react';
import { List as VirtualList } from 'react-window';
import { Capacitor } from '@capacitor/core';
import { supabase, ensureFreshSession, isSessionError } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { calculateMacros } from '../lib/macroCalculator';
import { format, subDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useTranslation } from 'react-i18next';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { getFoodImage } from '../lib/foodImages';
import { foodImageUrl, handleMealImgError, MEAL_IMG_FALLBACK } from '../lib/imageUrl';
import { ingredientImageSlug } from '../lib/ingredientImages';
import { plannerSlotKeys, slotTypeOf, slotLabelFor, loadMealSchedule, saveMealSchedule, syncMealReminders, ensureMealNotifPermission, MEAL_SLOT_MIN, MEAL_SLOT_MAX } from '../lib/mealNotifications';

// Realistic bound on how many weeks "Generate" fills ahead in one tap.
const PLAN_WEEKS_MAX = 8;
import { validateImageFile } from '../lib/validateImage';
// Note: the old takePhoto helper opened an HTML file input which on iOS
// presented the photo-library picker. The nutrition scan overlay now captures
// frames directly from the live html5-qrcode <video> stream (see
// captureFrameForAI), so takePhoto is no longer imported or invoked here.
// scanOverlay removed — camera no longer causes page reloads after Uri fix
import Skeleton from '../components/Skeleton';
import FadeIn from '../components/FadeIn';
import { useCachedState, hasCachedState } from '../hooks/useCachedState';
import { useMeals } from '../hooks/useContentStores';
import { suggestMeals, generateDayPlan, generateWeekPlan, suggestPostWorkoutMeal } from '../lib/mealPlanner';
import { loadAffinities, rateMeal, rebuildAffinities } from '../lib/mealPreferences';
import FoodScanResultModal, { cleanFoodName } from '../components/nutrition/FoodScanResultModal';
import MenuScanResultModal from '../components/nutrition/MenuScanResultModal';
import MealMacroCard from '../components/nutrition/MealMacroCard';
import { rankMenuItems } from '../lib/menuRanker';
import { useToast } from '../contexts/ToastContext';
import { hasConsentedToAI, recordAIConsent } from '../lib/aiConsent';
import AIConsentDialog from '../components/AIConsentDialog';
import TrainerMealPlanSection from '../components/TrainerMealPlanSection';
import FeatureDisabledScreen from '../components/FeatureDisabledScreen';
import { useFeatureEnabled } from '../hooks/usePlatformFlags';
import { useScrollLock } from '../hooks/useScrollLock';

// Wrap a promise with a timeout so a hung edge-function call surfaces an error
// instead of leaving the spinner stuck forever (cold-start, network drop, etc).
const withTimeout = (promise, ms, message = 'Request timed out') =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);

// ── DESIGN TOKENS (from TuGymPR Nutrition reference) ────────
const TU = {
  macroP: 'var(--tu-macro-p, #2EC4C4)',   // protein — teal
  macroC: 'var(--tu-macro-c, #FF7A3D)',   // carbs — orange
  macroF: 'var(--tu-macro-f, #FFC24A)',   // fat — gold
  accent: 'var(--color-accent, #2EC4C4)',
  hot:    '#FF5A2E',
  coach:  '#6D5FDB',
  display: '"Familjen Grotesk", "Archivo", system-ui, sans-serif',
};

// ── MACRO SEGMENT BAR (tri-color P/C/F) ─────────────────────
const MacroSegBar = ({ p = 0, c = 0, f = 0, height = 4 }) => {
  const total = p + c + f || 1;
  return (
    <div className="flex overflow-hidden rounded-full" style={{ height, gap: 1.5, background: 'var(--color-border-subtle)' }}>
      <div style={{ flex: p / total, background: TU.macroP, borderRadius: 999 }} />
      <div style={{ flex: c / total, background: TU.macroC, borderRadius: 999 }} />
      <div style={{ flex: f / total, background: TU.macroF, borderRadius: 999 }} />
    </div>
  );
};

// How well a recipe fits the member's macro GOALS, as a 0–100%. Compares the
// recipe against a single meal's share of the daily targets (targets/3), the
// same per-meal basis "Fits your macros" uses. Protein + calories are weighted
// highest (that's what a member's goal hinges on). Returns null when there are
// no meaningful targets, so the card just omits the badge.
function goalMatchPct(recipe, targets) {
  if (!recipe || !targets) return null;
  const cal = Number(targets.daily_calories) || 0;
  const pro = Number(targets.daily_protein_g) || 0;
  if (!cal || !pro) return null;
  const mealCal = cal / 3, mealPro = pro / 3;
  const mealCarb = (Number(targets.daily_carbs_g) || 0) / 3;
  const mealFat = (Number(targets.daily_fat_g) || 0) / 3;
  const gap = (v, t) => (t > 0 ? Math.min(1, Math.abs((Number(v) || 0) - t) / t) : 0);
  const score = 1
    - 0.35 * gap(recipe.calories, mealCal)
    - 0.35 * gap(recipe.protein, mealPro)
    - 0.15 * gap(recipe.carbs, mealCarb)
    - 0.15 * gap(recipe.fat, mealFat);
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

// ── FOOD TILE (gradient initial) ────────────────────────────
const TILE_PALETTES = [
  ['#FFB86B', '#FF7A3D'], ['#7FE3C4', '#2EC4C4'], ['#FFD166', '#F2A23A'],
  ['#D0C6FF', '#8B7DFF'], ['#B8E8A8', '#5EAA5E'], ['#FFB8B8', '#E87171'],
  ['#C8D8FF', '#6B8FE8'],
];
const FoodTile = ({ name, size = 48, seed = 0 }) => {
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

// Food thumbnail with graceful fallback: when the image is missing or 404s
// (e.g. branded foods whose photo was never uploaded), drop to the generated
// FoodTile instead of rendering a broken <img>.
const FoodThumb = ({ src, name, size = 44, seed = 0, className = '' }) => {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <FoodTile name={name} size={size} seed={seed} />;
  return (
    <img src={src} alt={name} loading="lazy" onError={() => setBroken(true)}
      className={className} style={{ background: 'var(--color-border-subtle)' }} />
  );
};

// Recipes are logged BY NAME (no food_item row), so a recipe log/scan carries no
// image and falls back to a letter tile. Resolve one by matching the logged name
// to the recipe library (which has the images). Memoized; rebuilds only when the
// library size changes (e.g. after DB hydration). Returns a ready public URL.
let _recipeImgMap = null, _recipeImgMapN = -1;
const recipeImageByName = (name) => {
  if (!name) return null;
  const lib = getMeals();
  if (_recipeImgMapN !== lib.length) {
    _recipeImgMap = new Map();
    for (const m of lib) {
      if (!m?.image) continue;
      if (m.title) _recipeImgMap.set(String(m.title).trim().toLowerCase(), m.image);
      if (m.title_es) _recipeImgMap.set(String(m.title_es).trim().toLowerCase(), m.image);
    }
    _recipeImgMapN = lib.length;
  }
  const path = _recipeImgMap.get(String(name).trim().toLowerCase());
  return path ? foodImageUrl(path) : null;
};

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

// Time-of-day default for the meal-type picker. ALWAYS returns a valid MEAL_TYPES
// key (never 'late') so a logged item is never left uncategorized.
const defaultMealSlot = () => {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 17 && h < 22) return 'dinner';
  return 'snack';
};

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

// Weekly collections are theme-based (a predicate), NOT hardcoded recipe ids —
// so they (a) survive the recipe library growing/changing and (b) rotate their
// picks every week for variety. See collectionRecipes() below.
const WEEKLY_COLLECTIONS = [
  {
    id: 'wc1', title: '5 High-Protein Dinners',
    subtitle: 'Build muscle with every meal', accent: 'var(--color-success)',
    pick: (r) => (r.protein || 0) >= 30,
  },
  {
    id: 'wc2', title: 'Easy Meal Prep Sunday',
    subtitle: 'Cook once, eat all week', accent: 'var(--color-accent)',
    pick: (r) => (r.prepTime || r.prep_time || 99) <= 20 || r.category === 'quick_budget',
  },
  {
    id: 'wc3', title: 'Cutting Week Meals',
    subtitle: 'Stay in deficit without starving', accent: '#F472B6',
    pick: (r) => (r.calories || 0) <= 420 && (r.protein || 0) >= 25,
  },
  {
    id: 'wc4', title: 'Bulk Up This Week',
    subtitle: 'Serious calories for serious gains', accent: '#F97316',
    pick: (r) => (r.calories || 0) >= 600,
  },
];

// Whole weeks since the epoch — a stable index that ticks once per week. Powers
// the weekly rotation of collections + "fits your macros" so both vary each week
// but stay put within a week.
const weekIndex = () => Math.floor(Date.now() / 604800000);

// Recipes for a collection THIS week: filter by the theme, order deterministically,
// then slide a `count`-sized window by the week index so the picks rotate weekly.
const collectionRecipes = (col, recipes, count = 5) => {
  const pool = (recipes || []).filter((r) => r?.ingredients && col.pick?.(r));
  if (pool.length <= count) return pool;
  const sorted = [...pool].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const start = (weekIndex() * count) % sorted.length;
  return Array.from({ length: count }, (_, i) => sorted[(start + i) % sorted.length]);
};

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
  return (
    <div style={{ flex: 1 }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.04em' }}>{label}</span>
        <span className="text-[11px] tabular-nums" style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ color: 'var(--color-text-primary)', fontWeight: 700, fontSize: 13 }}>{Math.round(value)}</span>
          <span> / {max}g</span>
        </span>
      </div>
      <div className="rounded-full overflow-hidden" style={{ height: 6, background: 'var(--color-border-subtle)' }}>
        <div className="h-full rounded-full" style={{
          width: `${pct}%`, backgroundColor: color,
          transition: 'width 500ms cubic-bezier(0.2,0.9,0.3,1)',
        }} />
      </div>
    </div>
  );
};

// ── MACRO RING ───────────────────────────────────────────────
const MacroRing = ({ value, max, color, trackColor, size = 72, strokeWidth = 5, label, unit, hero = false, sub }) => {
  const { t: tRing } = useTranslation('pages');
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const remaining = Math.max(0, max - value);
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size/2} cy={size/2} r={radius} fill="none"
            stroke={trackColor || 'var(--color-border-subtle)'} strokeWidth={strokeWidth}
          />
          <circle cx={size/2} cy={size/2} r={radius} fill="none"
            stroke={color} strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${circumference * pct} ${circumference}`}
            style={{ transition: 'stroke-dasharray 500ms cubic-bezier(0.2,0.9,0.3,1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-black tabular-nums leading-none" style={{
            fontFamily: TU.display, color: 'var(--color-text-primary)',
            fontSize: hero ? size * 0.2 : size * 0.22, letterSpacing: -1,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {Math.round(value)}
          </span>
          {(sub || unit) && (
            <span className="uppercase tracking-wider font-semibold mt-0.5" style={{
              fontSize: hero ? 10 : 7, color: 'var(--color-text-muted)',
            }}>
              {sub || unit}
            </span>
          )}
        </div>
      </div>
      {label && <p className={`font-semibold mt-2 ${hero ? 'text-[11px]' : 'text-[10px]'}`} style={{ color: 'var(--color-text-muted)' }}>{label}</p>}
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
  const { t } = useTranslation('pages');
  const isLg = size === 'lg';
  const mealTag = (lang === 'es' && recipe.tag_es) ? recipe.tag_es : recipe.tag;
  const tagColor = TAG_COLORS[recipe.tag] || 'var(--color-text-muted)';
  const title = (lang === 'es' && recipe.title_es) ? recipe.title_es : recipe.title;
  return (
    <button
      onClick={() => onOpen(recipe)}
      className={`relative flex-shrink-0 rounded-[20px] overflow-hidden text-left ${isLg ? 'w-[200px]' : 'w-[168px]'}`}
      style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}
    >
      <div className={`relative overflow-hidden ${isLg ? 'h-[120px]' : 'h-[100px]'}`}>
        <img
          src={(foodImageUrl(recipe.image) || MEAL_IMG_FALLBACK)} onError={handleMealImgError} alt={title}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {/* Save button */}
        <button
          onClick={e => { e.stopPropagation(); onSave(recipe.id); }}
          className="absolute top-2.5 right-2.5 min-w-[44px] min-h-[44px] w-7 h-7 rounded-full flex items-center justify-center focus:outline-none"
          style={{ background: 'rgba(255,255,255,0.92)' }}
          aria-label={saved ? t('nutrition.removeBookmark', 'Remove bookmark') : t('nutrition.bookmarkRecipe', 'Bookmark recipe')}
        >
          <Bookmark size={13} className={saved ? 'fill-[#D4AF37] text-[#D4AF37]' : 'text-[#999]'} />
        </button>
        {/* Match badge */}
        <div className="absolute top-2.5 left-2.5">
          {/* Chip bg is always white — text must be FIXED dark, not the theme
              var (in dark mode --color-text-primary is white → white-on-white). */}
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
            style={{ backgroundColor: 'rgba(255,255,255,0.92)', color: '#1f2937' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-[#2ECC71]" />
            {mealTag}
          </span>
        </div>
      </div>
      <div className="px-3.5 py-3">
        <p className="text-[13px] font-bold leading-snug mb-2 line-clamp-2" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>{title}</p>
        <div style={{ fontFamily: TU.display, fontSize: 16, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5, marginBottom: 6 }}>
          {recipe.calories}<span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}> kcal</span>
        </div>
        <MacroSegBar p={recipe.protein} c={recipe.carbs} f={recipe.fat} height={4} />
        <div className="flex justify-between mt-1.5 text-[10px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
          <span style={{ color: TU.macroP }}>{recipe.protein}P</span>
          <span style={{ color: TU.macroC }}>{recipe.carbs}C</span>
          <span style={{ color: TU.macroF }}>{recipe.fat}F</span>
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
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3 px-5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ backgroundColor: `${category.color}15` }}>
            <category.Icon size={11} style={{ color: category.color }} />
          </div>
          <span className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t(`nutrition.categories.${category.id}`, category.label)}</span>
        </div>
        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{items.length} {t('nutrition.recipesPlural', 'recipes')}</span>
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
const RecipeDetailModal = ({ recipe, onClose, saved, onSave, onAddToGrocery, onLogMeal, groceryAdded, lang = 'en', rating = 0, onRate }) => {
  const { t } = useTranslation('pages');
  // Ingredients / Instructions are swipeable tabs (not a long scroll).
  const [detailTab, setDetailTab] = useState('ingredients');
  useEffect(() => { setDetailTab('ingredients'); }, [recipe?.id]);
  if (!recipe) return null;
  const mealTitle = (lang === 'es' && recipe.title_es) ? recipe.title_es : recipe.title;
  const mealTag = (lang === 'es' && recipe.tag_es) ? recipe.tag_es : recipe.tag;
  const mealDifficulty = (lang === 'es' && recipe.difficulty_es) ? recipe.difficulty_es : recipe.difficulty;
  const mealSteps = (lang === 'es' && recipe.steps_es) ? recipe.steps_es : recipe.steps;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} role="presentation" />
      <div
        className="relative w-full max-w-md flex flex-col overflow-hidden"
        style={{
          maxHeight: '90vh',
          background: 'var(--color-bg-primary)',
          borderRadius: 28,
          boxShadow: '0 32px 64px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.3)',
        }}
      >
        {/* ── Hero image ── */}
        <div className="relative flex-shrink-0 overflow-hidden w-full" style={{ height: 260 }}>
          <img src={(foodImageUrl(recipe.image) || MEAL_IMG_FALLBACK)} onError={handleMealImgError} alt={mealTitle} className="w-full h-full object-cover" loading="lazy" />
          {/* close */}
          <button onClick={onClose}
            className="absolute top-4 left-4 min-w-[44px] min-h-[44px] w-10 h-10 rounded-full flex items-center justify-center focus:outline-none"
            style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(16px)' }}
            aria-label={t('common.close', 'Close')}>
            <ChevronLeft size={18} style={{ color: '#1f2937' }} />
          </button>
          {/* bookmark */}
          <button onClick={() => onSave(recipe.id)}
            className="absolute top-4 right-4 min-w-[44px] min-h-[44px] w-10 h-10 rounded-full flex items-center justify-center focus:outline-none"
            style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(16px)' }}
            aria-label={saved ? t('nutrition.removeBookmark', 'Remove bookmark') : t('nutrition.bookmarkRecipe', 'Bookmark recipe')}>
            <Star size={18} className={saved ? 'fill-[#FFC24A] text-[#FFC24A]' : ''} style={{ color: saved ? '#FFC24A' : '#6b7280' }} />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
          {/* Title + tag */}
          <div className="px-5 pt-5 pb-0">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide"
              style={{ background: `${TU.accent}15`, color: TU.accent }}>
              <span className="w-1.5 h-1.5 rounded-full bg-[#2ECC71]" />
              {mealTag}
            </span>
            <h2 className="mt-3 leading-tight" style={{
              fontFamily: TU.display, fontSize: 28, fontWeight: 800,
              color: 'var(--color-text-primary)', letterSpacing: -1, lineHeight: 1.1,
            }}>{mealTitle}</h2>
            <p className="text-[13px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {recipe.serves && `${t('nutrition.serves', 'Serves')} ${recipe.serves}`}
              {recipe.prepTime && ` · ${recipe.prepTime} min`}
              {mealDifficulty && ` · ${mealDifficulty}`}
            </p>
            {/* Like / dislike — teaches the planner what to recommend or avoid. */}
            {onRate && (
              <div className="flex items-center gap-2 mt-3">
                <button type="button" onClick={() => onRate(recipe.id, rating === 1 ? 0 : 1)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full text-[12px] font-bold active:scale-95 transition-all"
                  style={rating === 1
                    ? { background: '#10b981', color: '#fff', border: 'none' }
                    : { background: 'var(--color-bg-card)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
                  aria-label={t('nutrition.like', 'Like')}>
                  <ThumbsUp size={14} />{t('nutrition.like', 'Like')}
                </button>
                <button type="button" onClick={() => onRate(recipe.id, rating === -1 ? 0 : -1)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full text-[12px] font-bold active:scale-95 transition-all"
                  style={rating === -1
                    ? { background: 'var(--color-danger)', color: '#fff', border: 'none' }
                    : { background: 'var(--color-bg-card)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
                  aria-label={t('nutrition.dislike', 'Dislike')}>
                  <ThumbsDown size={14} />{t('nutrition.dislike', 'Dislike')}
                </button>
              </div>
            )}
          </div>

          {/* ── Macro Card ── */}
          <div className="px-4 pt-4">
            <MealMacroCard
              calories={recipe.calories}
              protein={recipe.protein}
              carbs={recipe.carbs}
              fat={recipe.fat}
            />
          </div>

          {/* ── Ingredients / Instructions — swipeable tabs (no long scroll) ── */}
          {(() => {
            const hasSteps = mealSteps && mealSteps.length > 0;
            const tabList = hasSteps
              ? [{ id: 'ingredients', label: t('nutrition.ingredients') }, { id: 'instructions', label: t('nutrition.instructions') }]
              : [{ id: 'ingredients', label: t('nutrition.ingredients') }];
            const activeIdx = Math.max(0, tabList.findIndex(tb => tb.id === detailTab));
            // Hold both tab panels to the same height (sized to the taller of the
            // two) so switching between Ingredients / Instructions never resizes
            // the modal. The trade-off is some empty space under short ingredient
            // lists — an accepted call: a stable height beats a tight fit.
            const panelMin = Math.max(
              240,
              (recipe.ingredients?.length || 0) * 46 + 44,
              hasSteps ? (mealSteps.length * 88 + 76) : 0,
            );

            const ingredientsPanel = (
              <div className="px-4 pt-4 pb-2" style={{ minHeight: panelMin }}>
                <div className="rounded-[22px] overflow-hidden" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
                  {recipe.ingredients.map((ing, i) => {
                    const allIngredients = Object.values(INGREDIENT_CATEGORIES || {}).flat();
                    const match = allIngredients.find(item => item.id === ing);
                    const ingLabel = t(`nutrition_ingredients.items.${ing}`, match?.label || ing.replace(/_/g, ' '));
                    return (
                      <div key={ing} className="flex items-center px-4 py-3" style={{
                        borderBottom: i < recipe.ingredients.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                      }}>
                        <span className="flex-1 text-[15px] font-medium" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{ingLabel}</span>
                        {recipe.ingredientAmounts?.[i] && (
                          <span className="text-[13px] font-semibold ml-3 flex-shrink-0 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                            {recipe.ingredientAmounts[i]}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );

            const instructionsPanel = hasSteps ? (
              <div className="px-4 pt-4 pb-2" style={{ minHeight: panelMin }}>
                {/* Original numbered list, wrapped in one card so it reads as a panel */}
                <div className="rounded-[22px] px-4 py-4" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
                  <div className="flex flex-col gap-4">
                    {mealSteps.map((step, i) => (
                      <div key={i} className="flex gap-3 items-start">
                        <div className="flex-shrink-0 w-[24px] h-[24px] rounded-[8px] flex items-center justify-center mt-[1px]"
                          style={{ background: `${TU.accent}15` }}>
                          <span className="text-[11px] font-bold" style={{ color: TU.accent }}>{i + 1}</span>
                        </div>
                        <p className="text-[13px] flex-1" style={{ color: 'var(--color-text-primary)', lineHeight: 1.65 }}>{step}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null;

            return (
              <div className="pt-4">
                {/* Tab bar (underline) */}
                <div className="flex px-5" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                  {tabList.map((tb, i) => {
                    const active = i === activeIdx;
                    return (
                      <button key={tb.id} type="button" onClick={() => setDetailTab(tb.id)}
                        className="flex-1 text-center pt-1 pb-2.5 relative focus:outline-none"
                        style={{ fontFamily: TU.display, fontSize: 14, fontWeight: active ? 800 : 600, color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                        {tb.label}
                        {active && <div style={{ position: 'absolute', bottom: -1, left: 12, right: 12, height: 2, borderRadius: 2, background: TU.accent }} />}
                      </button>
                    );
                  })}
                </div>
                {/* Swipeable panels */}
                {hasSteps ? (
                  <SwipeableTabView activeIndex={activeIdx} onChangeIndex={(idx) => setDetailTab(tabList[idx]?.id || 'ingredients')} tabKeys={tabList.map(tb => tb.id)}>
                    {ingredientsPanel}
                    {instructionsPanel}
                  </SwipeableTabView>
                ) : ingredientsPanel}
              </div>
            );
          })()}
        </div>

        {/* ── Sticky CTAs ── */}
        <div className="flex-shrink-0 px-4 py-4 flex gap-2.5" style={{ background: 'var(--color-bg-primary)' }}>
          <button
            onClick={() => onAddToGrocery(recipe)}
            className="flex-1 flex items-center justify-center gap-2 text-[14px] transition-colors active:scale-[0.97]"
            style={{
              height: 52,
              borderRadius: 18,
              fontFamily: TU.display,
              fontWeight: 800,
              letterSpacing: 0.2,
              background: groceryAdded ? 'rgba(16,185,129,0.12)' : 'var(--color-bg-card)',
              color: groceryAdded ? 'var(--color-success)' : 'var(--color-text-primary)',
              border: groceryAdded ? '1px solid rgba(16,185,129,0.25)' : '1px solid var(--color-border-subtle)',
            }}
          >
            {groceryAdded
              ? <><Check size={15} /> {t('nutrition.addedToGroceryList')}</>
              : <><ShoppingCart size={15} /> {t('nutrition.addToGroceryList')}</>}
          </button>
          {onLogMeal && (
            <button
              onClick={() => onLogMeal(recipe)}
              className="flex-1 flex items-center justify-center gap-2 text-[14px] transition-colors active:scale-[0.97]"
              style={{
                height: 52,
                borderRadius: 18,
                fontFamily: TU.display,
                fontWeight: 800,
                letterSpacing: 0.2,
                background: 'var(--color-text-primary)',
                color: 'var(--color-bg-primary)',
                border: 'none',
              }}
            >
              <Plus size={15} /> {t('nutrition.logFood', 'Log food')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── MEAL LOG SHEET ───────────────────────────────────────────
// Portion-adjust sheet for logging a suggested/recipe meal directly to food_logs.
// Mirrors MenuScanResultModal's confirm sheet so menu and meal logging feel identical.
const MealLogSheet = ({ meal, onClose, onLog, lang = 'en' }) => {
  const { t } = useTranslation('pages');
  const [portion, setPortion] = useState(1);
  const [mealType, setMealType] = useState(defaultMealSlot);
  const [saving, setSaving] = useState(false);

  if (!meal) return null;

  const baseCal = Number(meal.calories) || 0;
  const baseP = Number(meal.protein ?? meal.protein_g) || 0;
  const baseC = Number(meal.carbs ?? meal.carbs_g) || 0;
  const baseF = Number(meal.fat ?? meal.fat_g) || 0;

  const scaled = {
    calories: Math.round(baseCal * portion),
    protein_g: Math.round(baseP * portion * 10) / 10,
    carbs_g: Math.round(baseC * portion * 10) / 10,
    fat_g: Math.round(baseF * portion * 10) / 10,
  };

  const title = (lang === 'es' && meal.title_es) ? meal.title_es : (meal.title || meal.name);

  const handleConfirm = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onLog({
        name: title,
        calories: scaled.calories,
        protein_g: scaled.protein_g,
        carbs_g: scaled.carbs_g,
        fat_g: scaled.fat_g,
        servings: portion,
        mealType,
        image: meal.image || null,
        image_url: meal.image_url || null,
      });
    } finally {
      setSaving(false);
    }
  };

  const node = (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center px-4"
      style={{ background: 'rgba(20,14,8,0.55)', backdropFilter: 'blur(8px)' }}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-[28px] flex flex-col overflow-hidden"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border-subtle)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <button
            onClick={onClose}
            aria-label={t('common.close', 'Close')}
            className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
            style={{
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border-subtle)',
              cursor: 'pointer',
            }}
          >
            <X size={16} style={{ color: 'var(--color-text-primary)' }} />
          </button>
          <h2
            className="text-[15px] font-extrabold truncate px-3"
            style={{ color: 'var(--color-text-primary)', fontFamily: TU.display, letterSpacing: -0.2 }}
          >
            {t('nutrition.menuScan.logThisQ', 'Log this item?')}
          </h2>
          <div className="w-10" />
        </div>

        {/* Meal preview row */}
        <div className="px-4 mb-3 flex items-center gap-3">
          {meal.image ? (
            <img
              src={(foodImageUrl(meal.image) || MEAL_IMG_FALLBACK)} onError={handleMealImgError}
              alt={title}
              className="w-[64px] h-[64px] rounded-[18px] object-cover flex-shrink-0"
              style={{ background: 'var(--color-border-subtle)' }}
              loading="lazy"
            />
          ) : (
            <div
              className="w-[64px] h-[64px] rounded-[18px] flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--color-bg-surface)' }}
            >
              <Utensils size={24} style={{ color: 'var(--color-text-muted)' }} />
            </div>
          )}
          <h3
            className="flex-1 min-w-0 truncate"
            style={{ fontFamily: '"Archivo", system-ui, sans-serif', fontSize: 26, fontWeight: 900, color: 'var(--color-text-primary)', letterSpacing: -0.6, lineHeight: 1.05 }}
          >
            {title}
          </h3>
        </div>

        {/* Macro card — shared component */}
        <div className="px-4 mb-4">
          <MealMacroCard
            calories={scaled.calories}
            protein={scaled.protein_g}
            carbs={scaled.carbs_g}
            fat={scaled.fat_g}
            background="var(--color-bg-surface)"
            compact
          />
        </div>

        {/* Portion stepper */}
        <div className="px-4 mb-4">
          <div className="text-[11px] font-bold uppercase mb-2" style={{ color: 'var(--color-text-muted)', letterSpacing: 0.5 }}>
            {t('nutrition.menuScan.portion', 'Portion')}
          </div>
          <div className="flex items-center gap-2">
            {[0.5, 1, 1.5, 2].map(p => (
              <button
                key={p}
                onClick={() => setPortion(p)}
                className="flex-1 py-2.5 rounded-[12px] text-[13px] font-bold transition-all active:scale-95"
                style={{
                  background: portion === p ? TU.accent : 'var(--color-bg-surface)',
                  color: portion === p ? 'var(--color-text-on-accent, #fff)' : 'var(--color-text-primary)',
                  border: '1px solid var(--color-border-subtle)',
                  fontFamily: TU.display,
                }}
              >
                {p}×
              </button>
            ))}
          </div>
        </div>

        {/* Meal type — so the log lands in the right slot (breakfast/lunch/dinner/snack)
            instead of everything defaulting to one bucket. Defaults to the current
            time of day. */}
        <div className="px-4 mb-4">
          <div className="text-[11px] font-bold uppercase mb-2" style={{ color: 'var(--color-text-muted)', letterSpacing: 0.5 }}>
            {t('nutrition.mealTypeLabel', 'Meal')}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {MEAL_TYPES.map((m) => {
              const active = mealType === m.key;
              return (
                <button
                  key={m.key}
                  onClick={() => setMealType(m.key)}
                  className="flex flex-col items-center gap-1 py-2.5 rounded-[12px] transition-all active:scale-95"
                  style={{
                    background: active ? `color-mix(in srgb, ${m.color} 15%, transparent)` : 'var(--color-bg-surface)',
                    border: `1.5px solid ${active ? m.color : 'var(--color-border-subtle)'}`,
                  }}
                >
                  <m.icon size={16} style={{ color: active ? m.color : 'var(--color-text-faint)' }} />
                  <span className="text-[10.5px] font-bold" style={{ color: active ? m.color : 'var(--color-text-muted)', fontFamily: TU.display }}>
                    {t(m.labelKey, m.key)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* CTA */}
        <div className="px-4 pb-4" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
            style={{
              height: 52,
              borderRadius: 18,
              background: TU.accent,
              color: 'var(--color-text-on-accent, #fff)',
              fontFamily: TU.display,
              fontWeight: 800,
              fontSize: 15,
              letterSpacing: 0.2,
              border: 'none',
              cursor: saving ? 'wait' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            <Check size={16} />
            {saving ? t('nutrition.menuScan.logging', 'Logging…') : t('nutrition.menuScan.logThis', 'Log this')}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
};

// ── BARCODE LOOKUP HELPER ────────────────────────────────────
const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

const lookupBarcode = async (barcode, lang = 'en') => {
  // Use locale-specific API endpoint for translated product names
  const host = lang === 'es' ? 'es.openfoodfacts.org' : 'world.openfoodfacts.org';
  let res;
  try {
    res = await fetch(`https://${host}/api/v2/product/${encodeURIComponent(barcode)}.json`);
  } catch {
    // fetch itself threw (offline, DNS, CORS) — an actual network failure.
    // Previously this fell through as a generic "could not read barcode".
    throw new Error('network');
  }
  // Open Food Facts API v2 answers HTTP 404 for barcodes that simply aren't
  // in its database. That's "product not found", NOT a network problem —
  // treating every !ok as 'network' made unknown products (common for PR
  // local brands) show "Network error. Check your connection."
  if (res.status === 404) return null;
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
            <button onClick={onClose} className="min-w-[44px] min-h-[44px] w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center" aria-label={t('common.close', 'Close')}>
              <X size={15} className="text-[#6B7280]" />
            </button>
          </div>
          {product.image_url && <img src={product.image_url} alt={t('nutrition.scannedProduct', 'Scanned product')} className="w-16 h-16 rounded-xl object-cover mb-3 bg-[#1E293B]" loading="lazy" />}
          <p className="text-[18px] font-black text-[#E5E7EB] mb-1">{product.name}</p>
          <p className="text-[11px] text-[#9CA3AF] mb-4">{product.serving_size} {t('nutrition.perServing')}</p>
        </div>
        {/* Macro chips */}
        <div className="px-5 pb-3">
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: t('nutrition.cal', 'Cal'), value: cal, color: '#D4AF37' },
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
            <button onClick={() => adjust(-0.5)} className="w-9 h-9 rounded-full bg-white/[0.06] flex items-center justify-center text-[#E5E7EB] font-bold text-lg active:scale-90" aria-label={t('nutrition.decreaseServings', 'Decrease servings')}>−</button>
            <span className="text-[20px] font-bold text-[#E5E7EB] tabular-nums w-12 text-center">{servings}</span>
            <button onClick={() => adjust(0.5)} className="w-9 h-9 rounded-full bg-white/[0.06] flex items-center justify-center text-[#E5E7EB] font-bold text-lg active:scale-90" aria-label={t('nutrition.increaseServings', 'Increase servings')}>+</button>
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
            className="w-full py-3.5 rounded-xl font-bold text-[15px] active:scale-[0.97] transition-all disabled:opacity-50"
            style={{ background: '#D4AF37', color: '#000' }}>
            {saving ? t('nutrition.logging') : t('nutrition.logScannedFood')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── FOOD SEARCH MODAL ───────────────────────────────────────
const FoodSearchModal = ({ open, onClose, onSelect, onLogMeal, onPhotoCapture, onBarcodeResult, favorites = [], recentFoods = [], onToggleFavorite, lang = 'en' }) => {
  const { t } = useTranslation('pages');
  const isEs = lang === 'es';
  const foodName = (food) => (isEs && food.name_es) ? food.name_es : food.name;
  const recipeTitle = (m) => (isEs && m.title_es) ? m.title_es : (m.title || m.name || '');
  const [query, setQuery] = useState('');
  const [mealResults, setMealResults] = useState([]);
  const [tab, setTab] = useState('ingredients');       // ingredients | recent | favorites
  const [ingredients, setIngredients] = useState([]);  // curated is_ingredient rows (the palette)
  const [ingCat, setIngCat] = useState('protein');
  const [ingQuery, setIngQuery] = useState(''); // filter the ingredient palette by name
  const [ingLoading, setIngLoading] = useState(false);

  useEffect(() => { if (!open) { setQuery(''); setMealResults([]); setTab('ingredients'); setIngCat('protein'); } }, [open]);

  // The SEARCH box searches MEALS (recipes), which live in-memory (getMeals), so
  // the match is instant — no DB round-trip. Ingredients are NOT typed here; they
  // are picked from the palette below. That way "search a database" only ever
  // means one thing (meals) and never competes with the ingredient list.
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) { setMealResults([]); return; }
    const hits = [];
    for (const m of getMeals()) {
      if (!m) continue;
      if (String(m.title || '').toLowerCase().includes(q) || String(m.title_es || '').toLowerCase().includes(q)) hits.push(m);
      if (hits.length >= 30) break;
    }
    setMealResults(hits);
  }, [query]);

  // Load the ingredient palette once per open (small, ~120 curated rows).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setIngLoading(true);
      const { data } = await supabase.from('food_items')
        .select('id, name, name_es, brand, image_url, serving_size, serving_unit, calories, protein_g, carbs_g, fat_g, ingredient_category')
        .eq('is_ingredient', true).order('name', { ascending: true }).limit(300);
      if (!cancelled) { setIngredients(data || []); setIngLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;
  const favIds = new Set(favorites.map(f => f.food_item_id));
  const searchingMeals = query.trim().length >= 2;
  const ING_CATS = [
    { id: 'protein', label: t('nutrition.ingCat.protein', 'Protein') },
    { id: 'carb',    label: t('nutrition.ingCat.carb', 'Carbs') },
    { id: 'veg',     label: t('nutrition.ingCat.veg', 'Veggies') },
    { id: 'fruit',   label: t('nutrition.ingCat.fruit', 'Fruit') },
    { id: 'dairy',   label: t('nutrition.ingCat.dairy', 'Dairy') },
    { id: 'fat',     label: t('nutrition.ingCat.fat', 'Fats & Nuts') },
  ];
  // Ingredient palette: while typing, filter by name across ALL categories (so
  // search works even if category data is missing); otherwise by the selected
  // category. Cap the rendered count so a large library (100s → 1000s) never
  // renders every row at once.
  const ingQ = ingQuery.trim().toLowerCase();
  const ingMatches = ingQ
    ? ingredients.filter(i => `${i.name || ''} ${i.name_es || ''}`.toLowerCase().includes(ingQ))
    : ingredients.filter(i => (i.ingredient_category || 'protein') === ingCat);
  const foodRows = tab === 'recent' ? recentFoods
    : tab === 'favorites' ? favorites.map(f => f.food_item)
    : ingMatches.slice(0, 40);

  // A single food/ingredient row (palette, Recent, Favorites). Logs via onSelect.
  const renderFoodRow = (food) => {
    if (!food) return null;
    // Curated ingredient rows carry image_url = /ingredients/<slug>.jpg. Route the
    // slug through the resolver so we never request a non-uploaded image (no 400s)
    // and can borrow a close photo via alias. Regular food photos pass through.
    const isIng = food.image_url && /\/ingredients\//.test(food.image_url);
    const ingSlug = isIng ? ingredientImageSlug(food.image_url.split('/').pop().replace(/\.[a-z]+$/i, '')) : null;
    const rowImg = isIng
      ? (ingSlug ? foodImageUrl(`/ingredients/${ingSlug}.jpg`) : getFoodImage(food.name, food.brand))
      : (foodImageUrl(food.image_url) || getFoodImage(food.name, food.brand));
    return (
    <div key={food.id} role="button" tabIndex={0} onClick={() => onSelect(food)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(food); } }}
      className="w-full flex items-center gap-3 p-3 rounded-[14px] text-left active:scale-[0.975] transition-all cursor-pointer"
      style={{ background: 'var(--color-bg-card)' }}>
      <FoodThumb src={rowImg} name={foodName(food)} size={44} seed={food.id?.charCodeAt?.(0) || 0} className="w-11 h-11 rounded-[12px] object-cover flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-bold truncate" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{foodName(food)}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] font-bold tabular-nums">
          <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>{food.serving_size}{food.serving_unit}</span>
          <span style={{ color: 'var(--color-text-primary)' }}>{Math.round(food.calories)} kcal</span>
          <span style={{ color: TU.macroP }}>{Math.round(food.protein_g)}g P</span>
          <span style={{ color: TU.macroC }}>{Math.round(food.carbs_g || 0)}g C</span>
          <span style={{ color: TU.macroF }}>{Math.round(food.fat_g || 0)}g F</span>
        </div>
      </div>
      <NutriScoreBadge score={nutriScore(food.calories, food.protein_g, food.carbs_g, food.fat_g, food.serving_size || 100)} />
      <button onClick={e => { e.stopPropagation(); onToggleFavorite(food.id); }}
        className="min-w-[44px] min-h-[44px] w-7 h-7 flex items-center justify-center flex-shrink-0 focus:outline-none"
        aria-label={favIds.has(food.id) ? t('nutrition.removeFromFavorites', 'Remove from favorites') : t('nutrition.addToFavorites', 'Add to favorites')}>
        <Heart size={14} style={{ color: favIds.has(food.id) ? '#FFC24A' : 'var(--color-border-subtle)' }} fill={favIds.has(food.id) ? '#FFC24A' : 'none'} />
      </button>
    </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} role="presentation" />
      <div className="relative w-full max-w-md flex flex-col rounded-[24px] overflow-hidden"
        style={{ background: 'var(--color-bg-primary)', maxHeight: '85vh', boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }}>

        {/* Header */}
        <div className="px-5 pt-3 pb-3 shrink-0" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div className="flex items-center justify-between mb-4">
            <div style={{ fontFamily: TU.display, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>
              {t('nutrition.logFood')}
            </div>
            <button onClick={onClose} className="w-[34px] h-[34px] rounded-full flex items-center justify-center focus:outline-none"
              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }} aria-label={t('common.close', 'Close')}>
              <X size={16} style={{ color: 'var(--color-text-primary)' }} />
            </button>
          </div>

          {/* Search bar — searches your MEALS (recipes). Ingredients are picked
              from the palette below, never typed here, so the two never blur. */}
          <div className="flex items-center gap-2.5 rounded-[14px] px-3.5 py-3 mb-3"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
            <Search size={18} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <input type="text" value={query} onChange={e => setQuery(e.target.value)}
              placeholder={t('nutrition.searchMeals', 'Search meals…')}
              aria-label={t('nutrition.searchMeals', 'Search meals…')}
              className="w-full bg-transparent text-[15px] outline-none placeholder:text-[var(--color-text-muted)]"
              style={{ color: 'var(--color-text-primary)' }} />
            {query && (
              <button onClick={() => setQuery('')} className="flex-shrink-0 focus:outline-none" aria-label={t('common.clear', 'Clear')}>
                <X size={15} style={{ color: 'var(--color-text-muted)' }} />
              </button>
            )}
          </div>

          {/* Scan button — single unified button that opens camera view */}
          {(onPhotoCapture || onBarcodeResult) && (
            <button
              onClick={() => { if (onBarcodeResult) onBarcodeResult('__open_scanner__'); }}
              className="w-full flex items-center justify-center gap-2.5 py-3.5 mb-3 rounded-[14px] active:scale-[0.97] transition-all"
              style={{ background: TU.accent, color: 'var(--color-text-on-accent, #001512)' }}>
              <ScanLine size={18} strokeWidth={2.2} />
              <span className="text-[14px] font-bold" style={{ fontFamily: TU.display, letterSpacing: -0.2 }}>{t('nutrition.scanFood', 'Scan food')}</span>
            </button>
          )}

          {/* Browse tabs — hidden while a meal search is active (results take over). */}
          {!searchingMeals && (
            <div className="grid grid-cols-3 gap-1.5">
              {[{ key: 'ingredients', label: t('nutrition.ingredientsTab', 'Ingredients'), Icon: Utensils }, { key: 'recent', label: t('nutrition.recentTab', 'Recent'), Icon: Clock }, { key: 'favorites', label: t('nutrition.favoritesTab', 'Favorites'), Icon: Heart }]
                .map(tb => (
                  <button key={tb.key} onClick={() => setTab(tb.key)}
                    className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-full text-[12px] font-bold transition-colors whitespace-nowrap"
                    style={{
                      background: tab === tb.key ? 'var(--color-text-primary)' : 'var(--color-bg-card)',
                      color: tab === tb.key ? 'var(--color-bg-primary)' : 'var(--color-text-primary)',
                      border: tab === tb.key ? 'none' : '1px solid var(--color-border-subtle)',
                      letterSpacing: -0.1,
                    }}>
                    <tb.Icon size={13} strokeWidth={2.2} />{tb.label}
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 pb-5 pt-3">
          {searchingMeals ? (
            /* Meal (recipe) search results -> log via onLogMeal */
            mealResults.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.noMealsMatch', 'No meals match')} &ldquo;{query.trim()}&rdquo;</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {mealResults.map(m => (
                  <button key={m.id} onClick={() => onLogMeal?.(m)}
                    className="w-full flex items-center gap-3 p-3 rounded-[14px] text-left active:scale-[0.975] transition-all"
                    style={{ background: 'var(--color-bg-card)' }}>
                    <FoodThumb src={foodImageUrl(m.image || mealImageById(m.id))} name={recipeTitle(m)} size={44} seed={m.id?.charCodeAt?.(1) || 0} className="w-11 h-11 rounded-[12px] object-cover flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-bold truncate" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{recipeTitle(m)}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{Math.round(m.calories || 0)} cal {'\u00B7'} {Math.round(m.protein || 0)}g P{m.prepTime ? `${' \u00B7 '}${m.prepTime}` : ''}</p>
                    </div>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${TU.accent}18` }}>
                      <Plus size={15} style={{ color: TU.accent }} strokeWidth={2.4} />
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : (
            /* Browse: ingredient palette / Recent / Favorites -> log via onSelect */
            <>
              {tab === 'ingredients' && (
                <>
                  <div className="flex items-center gap-2 rounded-[12px] px-3 py-2 mb-2.5" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                    <Search size={15} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                    <input value={ingQuery} onChange={e => setIngQuery(e.target.value)}
                      placeholder={t('nutrition.searchIngredients', 'Search ingredients…')}
                      aria-label={t('nutrition.searchIngredients', 'Search ingredients…')}
                      className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--color-text-muted)]"
                      style={{ color: 'var(--color-text-primary)' }} />
                    {ingQuery && (
                      <button onClick={() => setIngQuery('')} className="flex-shrink-0 focus:outline-none" aria-label={t('common.clear', 'Clear')}>
                        <X size={14} style={{ color: 'var(--color-text-muted)' }} />
                      </button>
                    )}
                  </div>
                  {!ingQuery && (
                    <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-2.5 -mx-1 px-1">
                      {ING_CATS.map(c => {
                        const active = ingCat === c.id;
                        return (
                          <button key={c.id} onClick={() => setIngCat(c.id)}
                            className="px-3 py-1.5 rounded-full text-[12px] font-bold flex-shrink-0 transition-colors"
                            style={{
                              background: active ? TU.accent : 'var(--color-bg-card)',
                              color: active ? 'var(--color-text-on-accent, #001512)' : 'var(--color-text-muted)',
                              border: active ? 'none' : '1px solid var(--color-border-subtle)',
                            }}>
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {ingLoading && tab === 'ingredients' ? (
                <div className="py-8 text-center" aria-busy={true}>
                  <div className="w-6 h-6 rounded-full animate-spin mx-auto" style={{ border: `2px solid var(--color-border-subtle)`, borderTopColor: TU.accent }} role="status"><span className="sr-only">{t('common.loading', 'Loading')}</span></div>
                </div>
              ) : foodRows.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
                    {tab === 'recent' ? t('nutrition.noRecentFoods', 'No recent foods') : tab === 'favorites' ? t('nutrition.noFavoritesYet', 'No favorites yet') : t('nutrition.noResultsFound', 'No results found')}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {foodRows.map(renderFoodRow)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ── CUSTOM MEAL BUILDER ──────────────────────────────────────
// Member builds a reusable meal from real foods: name + optional photo + a list
// of foods (from food_items), each with a portion. Macros auto-total from the
// picked foods (no manual math). Saved to custom_meals — by-value totals so it
// drops straight into plans/logs, plus items[] (migration 0632) so the food
// list is kept and stays editable.
const CustomMealBuilder = ({ open, onClose, onSaved, userId, gymId, lang = 'en' }) => {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const isEs = lang === 'es';
  const foodName = (f) => (isEs && f.name_es) ? f.name_es : f.name;
  const [name, setName] = useState('');
  const [rows, setRows] = useState([]);        // [{ food, servings }]
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { if (!open) { setName(''); setRows([]); setQuery(''); setResults([]); setPhotoUrl(''); } }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      const safe = query.replace(/[%_\\,()."']/g, '');
      if (!safe) { setResults([]); setSearching(false); return; }
      // Meal builder = INGREDIENTS only (migrations 0633/0634). You build a meal
      // from single foods, so search the curated `is_ingredient` partition — the
      // same clean list Log Food uses — never the old branded/meal junk.
      const { data } = await supabase.from('food_items')
        .select('id, name, name_es, brand, image_url, serving_size, serving_unit, calories, protein_g, carbs_g, fat_g')
        .eq('is_ingredient', true)
        .or(`name.ilike.%${safe}%,name_es.ilike.%${safe}%`).limit(20);
      setResults(data || []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  if (!open) return null;

  // Keep the search + results after adding, so you can add several from one query
  // (e.g. multiple cheeses) without re-typing. Tapping an already-added food is a
  // no-op (deduped); the results mark it with a check.
  const addFood = (food) => { setRows(prev => prev.some(r => r.food.id === food.id) ? prev : [...prev, { food, servings: 1 }]); };
  const bump = (id, d) => setRows(prev => prev.map(r => r.food.id === id ? { ...r, servings: Math.max(0.5, Math.round((r.servings + d) * 2) / 2) } : r));
  const drop = (id) => setRows(prev => prev.filter(r => r.food.id !== id));

  const totals = rows.reduce((a, { food, servings }) => ({
    cal: a.cal + (food.calories || 0) * servings, p: a.p + (food.protein_g || 0) * servings,
    c: a.c + (food.carbs_g || 0) * servings, f: a.f + (food.fat_g || 0) * servings,
  }), { cal: 0, p: 0, c: 0, f: 0 });
  const r1 = (n) => Math.round(n * 10) / 10;

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0]; if (e.target) e.target.value = '';
    if (!file || !userId) return;
    const check = await validateImageFile(file);
    if (!check?.valid) { showToast(check?.error || t('nutrition.photoUploadFailed', 'Could not upload photo'), 'error'); return; }
    setUploading(true);
    try {
      const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('meal-photos').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('meal-photos').getPublicUrl(path);
      setPhotoUrl(data?.publicUrl || '');
    } catch { showToast(t('nutrition.photoUploadFailed', 'Could not upload photo'), 'error'); }
    finally { setUploading(false); }
  };

  const save = async () => {
    if (!name.trim() || rows.length === 0 || saving || !userId) return;
    setSaving(true);
    const items = rows.map(({ food, servings }) => ({ food_item_id: food.id, name: food.name, servings, calories: r1((food.calories || 0) * servings), protein_g: r1((food.protein_g || 0) * servings), carbs_g: r1((food.carbs_g || 0) * servings), fat_g: r1((food.fat_g || 0) * servings) }));
    const { data, error } = await supabase.from('custom_meals').insert({
      created_by: userId, gym_id: gymId || null, name: name.trim(),
      calories: Math.round(totals.cal), protein_g: r1(totals.p), carbs_g: r1(totals.c), fat_g: r1(totals.f),
      category: 'custom', image_url: photoUrl || null, items,
    }).select('*').single();
    setSaving(false);
    if (error) { showToast(t('nutrition.addMealFailed', 'Could not save meal'), 'error'); return; }
    showToast(t('nutrition.mealSaved', 'Meal saved'), 'success');
    onSaved?.(data); onClose?.();
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} role="presentation" />
      <div className="relative w-full max-w-md flex flex-col rounded-[24px] overflow-hidden" style={{ background: 'var(--color-bg-primary)', maxHeight: '88vh', boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }}>
        <div className="px-5 pt-3 pb-3 shrink-0 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div style={{ fontFamily: TU.display, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>{t('nutrition.createMeal', 'Create meal')}</div>
          <button onClick={onClose} className="w-[34px] h-[34px] rounded-full flex items-center justify-center" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }} aria-label={t('common.close', 'Close')}><X size={16} style={{ color: 'var(--color-text-primary)' }} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* Name + photo */}
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              className="w-[56px] h-[56px] rounded-[16px] flex items-center justify-center flex-shrink-0 overflow-hidden"
              style={{ background: 'var(--color-bg-card)', border: '1px dashed var(--color-border-subtle)' }} aria-label={t('nutrition.addPhoto', 'Add photo')}>
              {photoUrl ? <img src={photoUrl} alt="" className="w-full h-full object-cover" /> : uploading ? <Loader size={18} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} /> : <Camera size={20} style={{ color: 'var(--color-text-muted)' }} />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
            <input value={name} onChange={e => setName(e.target.value)} placeholder={t('nutrition.mealNamePlaceholder', 'Meal name')}
              className="flex-1 text-[16px] font-bold outline-none rounded-[12px] px-3 py-3"
              style={{ color: 'var(--color-text-primary)', background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', fontFamily: TU.display }} />
          </div>

          {/* Live totals */}
          <div className="grid grid-cols-4 gap-2">
            {[['CAL', Math.round(totals.cal), ''], ['P', r1(totals.p), 'g'], ['C', r1(totals.c), 'g'], ['F', r1(totals.f), 'g']].map(([lab, val, u]) => (
              <div key={lab} className="rounded-[14px] py-2.5 text-center" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                <div style={{ fontFamily: TU.display, fontSize: 18, fontWeight: 800, color: 'var(--color-text-primary)' }}>{val}{u}</div>
                <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>{lab}</div>
              </div>
            ))}
          </div>

          {/* Add-food search — pinned ABOVE the picked foods, always visible.
              Adding does not clear it, so you can add several from one query. */}
          <div>
            <div className="flex items-center gap-2.5 rounded-[14px] px-3.5 py-3" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
              <Search size={18} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('nutrition.addFoodPlaceholder', 'Add a food…')}
                className="w-full bg-transparent text-[15px] outline-none placeholder:text-[var(--color-text-muted)]" style={{ color: 'var(--color-text-primary)' }} />
              {searching && <Loader size={15} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />}
              {query && !searching && (
                <button onClick={() => { setQuery(''); setResults([]); }} className="flex-shrink-0 focus:outline-none" aria-label={t('common.clear', 'Clear')}>
                  <X size={15} style={{ color: 'var(--color-text-muted)' }} />
                </button>
              )}
            </div>
            {results.length > 0 && (
              <div className="mt-1.5 space-y-1">
                {results.map(food => {
                  const added = rows.some(r => r.food.id === food.id);
                  return (
                    <button key={food.id} onClick={() => addFood(food)} className="w-full flex items-center gap-2.5 p-2.5 rounded-[12px] text-left" style={{ background: 'var(--color-bg-card)' }}>
                      <FoodThumb src={foodImageUrl(food.image_url) || getFoodImage(food.name, food.brand)} name={foodName(food)} size={34} seed={food.id?.charCodeAt?.(0) || 0} className="w-[34px] h-[34px] rounded-[9px] object-cover flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{foodName(food)}</p>
                        <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{food.serving_size}{food.serving_unit} {'·'} {food.calories} cal</p>
                      </div>
                      {added
                        ? <Check size={16} strokeWidth={2.6} style={{ color: TU.accent, flexShrink: 0 }} />
                        : <Plus size={16} style={{ color: TU.accent, flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Picked foods */}
          {rows.length > 0 && (
            <div className="space-y-1.5">
              {rows.map(({ food, servings }) => (
                <div key={food.id} className="flex items-center gap-2.5 p-2.5 rounded-[14px]" style={{ background: 'var(--color-bg-card)' }}>
                  <FoodThumb src={foodImageUrl(food.image_url) || getFoodImage(food.name, food.brand)} name={foodName(food)} size={38} seed={food.id?.charCodeAt?.(0) || 0} className="w-[38px] h-[38px] rounded-[10px] object-cover flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold truncate" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)' }}>{foodName(food)}</p>
                    <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{Math.round((food.calories || 0) * servings)} cal {'·'} {r1((food.protein_g || 0) * servings)}g P</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => bump(food.id, -0.5)} className="w-6 h-6 rounded-full flex items-center justify-center text-[14px] font-bold" style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)' }}>{'−'}</button>
                    <span className="min-w-[28px] text-center text-[12px] font-bold" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)' }}>{servings}{'×'}</span>
                    <button onClick={() => bump(food.id, 0.5)} className="w-6 h-6 rounded-full flex items-center justify-center text-[14px] font-bold" style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)' }}>+</button>
                  </div>
                  <button onClick={() => drop(food.id)} className="w-7 h-7 flex items-center justify-center flex-shrink-0" aria-label={t('common.remove', 'Remove')}><Trash2 size={14} style={{ color: 'var(--color-text-muted)' }} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 shrink-0" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
          <button onClick={save} disabled={!name.trim() || rows.length === 0 || saving || uploading}
            className="w-full py-3.5 rounded-[14px] font-bold text-[15px] flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98] transition-all"
            style={{ background: TU.accent, color: 'var(--color-text-on-accent, #001512)', fontFamily: TU.display }}>
            {saving ? <Loader size={16} className="animate-spin" /> : <Check size={16} />}
            {t('nutrition.saveMeal', 'Save meal')}
          </button>
        </div>
      </div>
    </div>,
    document.body
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
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-[24px] flex flex-col overflow-hidden"
        style={{ background: 'var(--color-bg-primary)', maxHeight: '90vh', boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }} onClick={e => e.stopPropagation()}>

        {/* Header: food tile + name */}
        <div className="flex items-center gap-3.5 px-5 pt-3 pb-4" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <FoodThumb src={foodImageUrl(food.image_url) || getFoodImage(food.name, food.brand)} name={displayName} size={64} seed={food.id?.charCodeAt?.(0) || 0} className="w-[64px] h-[64px] rounded-[18px] object-cover flex-shrink-0" />

          <div className="flex-1 min-w-0">
            <div className="truncate" style={{ fontFamily: '"Archivo", system-ui, sans-serif', fontSize: 26, fontWeight: 900, color: 'var(--color-text-primary)', letterSpacing: -0.6, lineHeight: 1.05 }}>
              {displayName}
            </div>
            <div className="text-[12px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {food.serving_size}{food.serving_unit}
            </div>
          </div>
          <button onClick={onClose} className="w-[34px] h-[34px] rounded-full flex items-center justify-center flex-shrink-0 focus:outline-none"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }} aria-label={t('common.close', 'Close')}>
            <X size={16} style={{ color: 'var(--color-text-primary)' }} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2">
          {/* Macro card with inline servings stepper */}
          <div className="rounded-[18px] p-4 mb-4" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
            <div className="flex items-baseline justify-between mb-3.5">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>{t('nutrition.total', 'Total')}</div>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span style={{ fontFamily: TU.display, fontSize: 34, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -1.3, lineHeight: 1 }}>{cal}</span>
                  <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>kcal</span>
                </div>
              </div>
              {/* Servings stepper */}
              <div className="flex items-center gap-2 p-1 rounded-full" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.03))' }}>
                <button onClick={() => adjust(-0.5)} disabled={s <= 0.5}
                  className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[16px] font-bold active:scale-90 disabled:opacity-25"
                  style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}>−</button>
                <span className="min-w-[34px] text-center" style={{ fontFamily: TU.display, fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)' }}>{s}×</span>
                <button onClick={() => adjust(0.5)}
                  className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[16px] font-bold active:scale-90"
                  style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}>+</button>
              </div>
            </div>
            {/* Macro proportion line + inline numbers — matches the app card style */}
            <div className="mb-2.5"><MacroSegBar p={pro} c={carb} f={fat} height={8} /></div>
            <div className="flex items-center justify-between">
              {[
                { l: t('nutrition.protein'), v: pro, c: TU.macroP },
                { l: t('nutrition.carbs'), v: carb, c: TU.macroC },
                { l: t('nutrition.fat'), v: fat, c: TU.macroF },
              ].map(m => (
                <div key={m.l} className="flex items-center gap-1.5 min-w-0">
                  <div className="w-1.5 h-1.5 rounded-sm flex-shrink-0" style={{ background: m.c }} />
                  <span style={{ fontFamily: TU.display, fontSize: 15, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>{m.v}<span className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>g</span></span>
                  <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.04em' }}>{m.l}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Meal slot picker */}
          <div className="mb-2">
            <div className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
              {t('nutrition.logTo', 'Log to')}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {MEAL_TYPES.map(m => (
                <button key={m.key} onClick={() => setMealType(m.key)}
                  className="py-2.5 rounded-[10px] text-[11px] font-bold transition-all active:scale-95"
                  style={{
                    background: mealType === m.key ? `${TU.accent}15` : 'var(--color-bg-card)',
                    border: `1.5px solid ${mealType === m.key ? TU.accent : 'var(--color-border-subtle)'}`,
                    color: mealType === m.key ? TU.accent : 'var(--color-text-primary)',
                  }}>
                  {t(m.labelKey)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer CTA */}
        <div className="px-4 pt-3 pb-4" style={{ borderTop: '1px solid var(--color-border-subtle)', paddingBottom: 'max(16px, var(--safe-area-bottom, env(safe-area-inset-bottom)))' }}>
          <button onClick={handleLog} disabled={saving || s <= 0}
            className="w-full py-[14px] rounded-[14px] font-bold text-[15px] flex items-center justify-center gap-2 active:scale-[0.97] transition-all disabled:opacity-40"
            style={{ background: TU.accent, color: 'var(--color-text-on-accent, #001512)', fontFamily: TU.display, letterSpacing: -0.2 }}>
            <Check size={16} strokeWidth={2.6} />
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
      <div className="absolute inset-0" style={{ background: 'rgba(20,14,8,0.55)', backdropFilter: 'blur(6px)' }} />
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto"
        style={{
          background: 'var(--color-bg-card)',
          borderRadius: 22,
          border: '1px solid var(--color-border-subtle)',
          boxShadow: '0 18px 50px rgba(60, 40, 10, 0.22), 0 2px 8px rgba(0,0,0,0.1)',
        }}
        onClick={e => e.stopPropagation()}>
        <button onClick={onClose}
          className="absolute top-3.5 right-3.5 w-[34px] h-[34px] rounded-full flex items-center justify-center z-10 focus:outline-none"
          style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-subtle)' }}
          aria-label={t('common.close', 'Close')}>
          <X size={15} style={{ color: 'var(--color-text-primary)' }} />
        </button>

        {/* Loading state — warm-paper */}
        {analyzing && (
          <div className="px-6 py-14 text-center" aria-busy={true}>
            {photoPreview && (
              <div className="w-28 h-28 mx-auto mb-5 rounded-[22px] overflow-hidden"
                style={{ border: '1px solid var(--color-border-subtle)', boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
                <img src={photoPreview} alt={t('nutrition.foodPhotoPreview', 'Food photo preview')} className="w-full h-full object-cover" width={112} height={112} loading="lazy" />
              </div>
            )}
            <div className="relative w-12 h-12 mx-auto mb-4">
              <div className="absolute inset-0 rounded-full" style={{ border: `3px solid color-mix(in srgb, ${TU.coach} 18%, transparent)`, borderTopColor: TU.coach, borderRightColor: TU.coach, animation: 'spin 1s linear infinite' }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles size={16} style={{ color: TU.coach }} />
              </div>
            </div>
            <p style={{ fontFamily: '"Archivo", system-ui, sans-serif', fontSize: 18, fontWeight: 900, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>
              {t('nutrition.analyzingFood', 'Analyzing your food…')}
            </p>
            <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-muted)', fontFamily: TU.display }}>
              {t('nutrition.identifyingItems', 'Identifying items & looking up nutrition')}
            </p>
          </div>
        )}

        {/* Error state — warm-paper */}
        {error && !analyzing && (
          <div className="px-6 py-12 text-center">
            <div className="w-14 h-14 mx-auto mb-3 rounded-[18px] flex items-center justify-center"
              style={{ background: 'color-mix(in srgb, var(--color-danger, #EF4444) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--color-danger, #EF4444) 25%, transparent)' }}>
              <AlertCircle size={26} style={{ color: 'var(--color-danger, #EF4444)' }} />
            </div>
            <p style={{ fontFamily: '"Archivo", system-ui, sans-serif', fontSize: 18, fontWeight: 900, color: 'var(--color-text-primary)', letterSpacing: -0.3, marginBottom: 4 }}>
              {t('nutrition.analysisFailed', 'Analysis failed')}
            </p>
            <p className="text-[12px] mb-5" style={{ color: 'var(--color-text-muted)', fontFamily: TU.display }}>{error}</p>
            <button onClick={onClose}
              className="px-6 py-2.5 rounded-[14px] text-[13px] font-bold active:scale-95 transition-transform"
              style={{ background: TU.accent, color: 'var(--color-text-on-accent, #001512)', fontFamily: TU.display, letterSpacing: -0.1 }}>
              {t('nutrition.tryAgain', 'Try again')}
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
                  <img src={photoPreview} alt={t('nutrition.foodPhotoPreview', 'Food photo preview')} className="w-full h-full object-cover" loading="lazy" />
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
                      aria-label={t('nutrition.decreasePortion', 'Decrease portion size')}>
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
                        aria-label={t('nutrition.portionSizeGrams', 'Portion size in grams')}
                      />
                      <p className="text-[9px] text-[#6B7280] mt-1">{t('nutrition.gramsAdjust', 'grams (adjust to match actual portion)')}</p>
                    </div>
                    <button onClick={() => handleGramsChange(totalGrams + 10)}
                      className="w-9 h-9 rounded-xl bg-[#0A0F1A] border border-white/[0.06] flex items-center justify-center text-[#9CA3AF] active:scale-90 transition-all"
                      aria-label={t('nutrition.increasePortion', 'Increase portion size')}>
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
                    aria-label={t('nutrition.decreaseServings', 'Decrease servings')}>
                    <span className="text-[18px] font-light leading-none">−</span>
                  </button>
                  <p className="text-[24px] font-black tabular-nums w-16 text-center truncate" style={{ color: 'var(--color-text-primary)' }}>{s}</p>
                  <button onClick={() => adjust(0.5)}
                    className="w-10 h-10 rounded-xl bg-[#111827] border border-[#1E293B] flex items-center justify-center text-[#9CA3AF] active:scale-90 transition-all"
                    aria-label={t('nutrition.increaseServings', 'Increase servings')}>
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
                className="w-full py-[18px] rounded-2xl font-bold text-[15px] active:scale-[0.97] transition-all disabled:opacity-40"
                style={{ background: '#D4AF37', color: '#000' }}>
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
const FoodLogDetailModal = ({ log, onClose, onUpdate, onDelete, onToggleFavorite, isFavorite = false, lang = 'en' }) => {
  const { t } = useTranslation('pages');
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState({});
  const [editServings, setEditServings] = useState(1);
  const [editMealType, setEditMealType] = useState('snack');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (log) {
      setEditValues({
        calories: log.calories,
        protein_g: log.protein_g,
        carbs_g: log.carbs_g,
        fat_g: log.fat_g,
      });
      setEditServings(Number(log.servings) || 1);
      setEditMealType(log.meal_type || 'snack');
      setEditing(false);
    }
  }, [log]);

  if (!log) return null;

  const displayName = log.food_item
    ? ((lang === 'es' && log.food_item.name_es) ? log.food_item.name_es : log.food_item.name)
    : (log.custom_name || t('nutrition.foodFallback', 'Food'));
  // Only a genuine AI-photo estimate gets the "estimated, edit it" note — NOT a
  // recipe logged from our library (which also has no food_item_id). Legacy rows
  // (source null) are treated as non-AI.
  const isAiLogged = log.source === 'ai';
  const photoSrc = log.photo_url || getFoodImage(log.food_item?.name, log.food_item?.brand) || foodImageUrl(log.food_item?.image_url) || recipeImageByName(log.custom_name || log.food_item?.name);
  const loggedAt = new Date(log.created_at);
  const timeStr = loggedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const handleSave = async () => {
    setSaving(true);
    await onUpdate(log.id, {
      calories: parseFloat(editValues.calories) || 0,
      protein_g: parseFloat(editValues.protein_g) || 0,
      carbs_g: parseFloat(editValues.carbs_g) || 0,
      fat_g: parseFloat(editValues.fat_g) || 0,
      servings: Math.max(0.5, parseFloat(editServings) || 1),
      meal_type: editMealType,
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

        {/* Back button */}
        <button onClick={onClose} className="absolute top-4 left-4 min-w-[44px] min-h-[44px] w-10 h-10 rounded-full flex items-center justify-center z-10 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)', border: '1px solid var(--color-border-default)' }}
          aria-label={t('common.back', 'Back')}>
          <ChevronLeft size={18} className="text-white/85" />
        </button>

        {/* Star (favorite) button */}
        {onToggleFavorite && (
          <button onClick={() => onToggleFavorite(log)} className="absolute top-4 right-4 min-w-[44px] min-h-[44px] w-10 h-10 rounded-full flex items-center justify-center z-10 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)', border: '1px solid var(--color-border-default)' }}
            aria-label={isFavorite ? t('nutrition.removeBookmark', 'Remove bookmark') : t('nutrition.bookmarkRecipe', 'Bookmark recipe')}>
            <Star size={16} className={isFavorite ? 'fill-[#FFC24A] text-[#FFC24A]' : 'text-white/85'} />
          </button>
        )}

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
                {t('nutrition.estimateDisclaimer', 'Estimated values —')} <button onClick={() => setEditing(true)} className="text-[#D4AF37] font-semibold">{t('nutrition.tapToEdit', 'tap to edit')}</button>.
              </p>
            </div>
          )}

          {/* Macros — shared component for visual consistency with recipes & menu items */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3.5">
              <p className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-[0.15em]">{t('nutrition.nutritionLabel', 'Nutrition')}</p>
              <button onClick={() => setEditing(!editing)}
                className="text-[10px] font-bold tracking-wide transition-colors"
                style={{ color: editing ? 'var(--color-text-muted)' : 'var(--color-accent)' }}>
                {editing ? t('nutrition.cancel', 'Cancel') : t('nutrition.edit', 'Edit')}
              </button>
            </div>
            <MealMacroCard
              calories={log.calories}
              protein={log.protein_g}
              carbs={log.carbs_g}
              fat={log.fat_g}
              editing={editing}
              editValues={editValues}
              onEditChange={(key, val) => {
                if (parseFloat(val) < 0) return;
                setEditValues(prev => ({ ...prev, [key]: val }));
              }}
              background="var(--color-bg-deep)"
            />
          </div>

          {/* Servings — editable stepper in edit mode */}
          <div className="flex items-center justify-between px-1 mb-5">
            <span className="text-[11px] font-medium text-[#9CA3AF]">{t('nutrition.servings', 'Servings')}</span>
            {editing ? (
              <div className="flex items-center gap-2 p-1 rounded-full" style={{ background: 'var(--color-surface-hover, rgba(255,255,255,0.05))' }}>
                <button onClick={() => setEditServings(v => Math.max(0.5, Math.round((v - 0.5) * 2) / 2))}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[15px] font-bold active:scale-90"
                  style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }} aria-label={t('nutrition.decreaseServings', 'Decrease servings')}>−</button>
                <span className="min-w-[32px] text-center text-[13px] font-black tabular-nums" style={{ color: 'var(--color-text-primary)' }}>{editServings}×</span>
                <button onClick={() => setEditServings(v => Math.round((v + 0.5) * 2) / 2)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[15px] font-bold active:scale-90"
                  style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }} aria-label={t('nutrition.increaseServings', 'Increase servings')}>+</button>
              </div>
            ) : (
              <span className="text-[14px] font-black text-[#E5E7EB] tabular-nums">{log.servings}</span>
            )}
          </div>

          {/* Meal slot — editable in edit mode (breakfast / lunch / dinner / snack) */}
          {editing && (
            <div className="mb-6">
              <span className="block text-[11px] font-medium text-[#9CA3AF] mb-2 px-1">{t('nutrition.mealTypeLabel', 'Meal')}</span>
              <div className="grid grid-cols-4 gap-2">
                {MEAL_TYPES.map(m => {
                  const active = editMealType === m.key;
                  return (
                    <button key={m.key} onClick={() => setEditMealType(m.key)}
                      className="flex flex-col items-center gap-1 py-2.5 rounded-[12px] transition-all active:scale-95"
                      style={{ background: active ? `color-mix(in srgb, ${m.color} 15%, transparent)` : 'var(--color-bg-deep)', border: `1.5px solid ${active ? m.color : 'var(--color-border-subtle)'}` }}>
                      <m.icon size={15} style={{ color: active ? m.color : 'var(--color-text-faint)' }} />
                      <span className="text-[10px] font-bold" style={{ color: active ? m.color : 'var(--color-text-muted)' }}>{t(m.labelKey, m.key)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions */}
          {editing && (
            <button onClick={handleSave} disabled={saving}
              className="w-full py-[16px] rounded-[16px] font-bold text-[14px] active:scale-[0.97] transition-all disabled:opacity-40 mb-3"
              style={{ background: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-dark) 100%)', color: 'var(--color-text-on-accent, #000)', boxShadow: '0 4px 16px color-mix(in srgb, var(--color-accent) 20%, transparent), inset 0 1px 0 rgba(255,255,255,0.2)' }}>
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

// ── TARGET EDIT MODAL (Goals — matches reference) ───────────
const TargetEditModal = ({ open, onClose, draft, setDraft, onSave, saving, onAutoCalculate }) => {
  const { t } = useTranslation('pages');
  const [goalType, setGoalType] = useState('cut');
  const [pace, setPace] = useState(1.0);
  const [activity, setActivity] = useState('moderate');

  const kcal = parseInt(draft.daily_calories) || 2000;
  const protein = parseInt(draft.daily_protein_g) || 150;
  const carbs = parseInt(draft.daily_carbs_g) || 200;
  const fat = parseInt(draft.daily_fat_g) || 65;

  // Apply auto on goal/pace/activity change — delegate to parent which uses
  // calculateMacros with the user's real Mifflin-St Jeor metrics.
  useEffect(() => {
    if (open) onAutoCalculate?.();
  }, [goalType, pace, activity, open]);

  if (!open) return null;

  const GOAL_TYPES = [
    { v: 'cut', l: t('nutrition.goalCut', 'Cut'), d: t('nutrition.goalCutDesc', 'Lose fat') },
    { v: 'maintain', l: t('nutrition.goalMaintain', 'Maintain'), d: t('nutrition.goalMaintainDesc', 'Body recomp') },
    { v: 'bulk', l: t('nutrition.goalBulk', 'Bulk'), d: t('nutrition.goalBulkDesc', 'Gain muscle') },
  ];

  const ACTIVITY_LEVELS = [
    { v: 'sedentary', l: t('nutrition.actSedentary', 'Sedentary'), d: t('nutrition.actSedentaryDesc', 'Desk job, no exercise') },
    { v: 'light', l: t('nutrition.actLight', 'Light'), d: t('nutrition.actLightDesc', '1\u20132 workouts/week') },
    { v: 'moderate', l: t('nutrition.actModerate', 'Moderate'), d: t('nutrition.actModerateDesc', '3\u20134 workouts/week') },
    { v: 'high', l: t('nutrition.actHigh', 'High'), d: t('nutrition.actHighDesc', '5+ workouts/week') },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} role="presentation" />
      <div className="relative w-full max-w-md rounded-[24px] flex flex-col overflow-hidden"
        style={{ background: 'var(--color-bg-primary)', maxHeight: '94vh', boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3 pb-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div style={{ fontFamily: TU.display, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>
            {t('nutrition.goals', 'Goals')}
          </div>
          <button onClick={onClose} className="w-[34px] h-[34px] rounded-full flex items-center justify-center focus:outline-none"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }} aria-label={t('common.close', 'Close')}>
            <X size={16} style={{ color: 'var(--color-text-primary)' }} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-2">

          {/* Goal type */}
          <div className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
            {t('nutrition.goalType', 'Goal type')}
          </div>
          <div className="grid grid-cols-3 gap-2 mb-5">
            {GOAL_TYPES.map(o => (
              <button key={o.v} onClick={() => setGoalType(o.v)}
                className="py-3.5 px-2.5 rounded-[14px] text-center active:scale-95 transition-all"
                style={{
                  background: goalType === o.v ? `${TU.accent}12` : 'var(--color-bg-card)',
                  border: `1.5px solid ${goalType === o.v ? TU.accent : 'var(--color-border-subtle)'}`,
                }}>
                <div style={{ fontFamily: TU.display, fontSize: 15, fontWeight: 800, color: goalType === o.v ? TU.accent : 'var(--color-text-primary)', letterSpacing: -0.2 }}>{o.l}</div>
                <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{o.d}</div>
              </button>
            ))}
          </div>

          {/* Pace slider (only for cut/bulk) */}
          {goalType !== 'maintain' && (
            <div className="mb-5">
              <div className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
                {t('nutrition.pace', 'Pace')} {'\u00B7'} {pace.toFixed(2)} lb/week
              </div>
              <input type="range" min="0.25" max="1.5" step="0.25" value={pace}
                onChange={e => setPace(parseFloat(e.target.value))}
                className="w-full" style={{ accentColor: TU.accent }} />
              <div className="flex justify-between text-[10px] font-semibold mt-1" style={{ color: 'var(--color-text-muted)' }}>
                <span>{t('nutrition.paceSlow', 'Slow \u00B7 sustainable')}</span>
                <span>{t('nutrition.paceAggressive', 'Aggressive')}</span>
              </div>
            </div>
          )}

          {/* Activity level */}
          <div className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
            {t('nutrition.activityLevel', 'Activity level')}
          </div>
          <div className="grid grid-cols-2 gap-2 mb-5">
            {ACTIVITY_LEVELS.map(o => (
              <button key={o.v} onClick={() => setActivity(o.v)}
                className="p-3 rounded-[12px] text-left active:scale-95 transition-all"
                style={{
                  background: activity === o.v ? `${TU.accent}12` : 'var(--color-bg-card)',
                  border: `1.5px solid ${activity === o.v ? TU.accent : 'var(--color-border-subtle)'}`,
                }}>
                <div className="text-[13px] font-bold" style={{ color: activity === o.v ? TU.accent : 'var(--color-text-primary)', letterSpacing: -0.2 }}>{o.l}</div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{o.d}</div>
              </button>
            ))}
          </div>

          {/* Your targets — auto-calculated preview */}
          <div className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
            {t('nutrition.yourTargets', 'Your targets')}
          </div>
          <div className="rounded-[18px] p-4 mb-3" style={{ background: `color-mix(in srgb, ${TU.accent} 3%, transparent)`, border: `1px solid color-mix(in srgb, ${TU.accent} 9%, transparent)` }}>
            <div className="flex items-baseline justify-between mb-3.5">
              <div className="flex items-baseline gap-2">
                <span style={{ fontFamily: TU.display, fontSize: 40, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -2, lineHeight: 1 }}>{kcal}</span>
                <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>kcal/day</span>
              </div>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold uppercase"
                style={{ background: `${TU.coach}15`, color: TU.coach, letterSpacing: 0.5 }}>
                <Sparkles size={11} style={{ color: TU.coach }} /> Auto
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { l: t('nutrition.protein'), v: protein, c: TU.macroP },
                { l: t('nutrition.carbs'), v: carbs, c: TU.macroC },
                { l: t('nutrition.fat'), v: fat, c: TU.macroF },
              ].map(m => (
                <div key={m.l} className="rounded-[12px] p-2.5" style={{ background: 'rgba(255,255,255,0.5)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-1.5 h-1.5 rounded-sm" style={{ background: m.c }} />
                    <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>{m.l}</span>
                  </div>
                  <div style={{ fontFamily: TU.display, fontSize: 22, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.8, lineHeight: 1 }}>
                    {m.v}<span className="text-[12px] font-medium ml-0.5" style={{ color: 'var(--color-text-muted)' }}>g</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-center mb-2" style={{ color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
            {t('nutrition.macrosAutoCalc', 'Macros auto-calculate from your goal, pace & activity.')}
          </p>
        </div>

        {/* Footer CTA */}
        <div className="px-5 pt-3" style={{ borderTop: '1px solid var(--color-border-subtle)', paddingBottom: 'max(28px, calc(var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)) + 12px))' }}>
          <button onClick={onSave} disabled={saving}
            className="w-full py-[16px] rounded-[14px] font-bold text-[15px] active:scale-[0.97] transition-all disabled:opacity-40"
            style={{ background: TU.accent, color: 'var(--color-text-on-accent, #001512)', fontFamily: TU.display, letterSpacing: -0.2 }}>
            {saving ? t('nutrition.saving') : t('nutrition.saveGoals', 'Save goals')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── DAILY SUGGESTION ("Sugerencia del Día") ─────────────────
const DailySuggestion = ({ targets, todayTotals, onOpenRecipe, onLogMeal, lang, t, userId, gymId, workoutBurn = 0 }) => {
  const { showToast } = useToast();
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

  // The member's own private custom meals (custom_meals table) — visible only to
  // them (RLS) and offered first when swapping a suggestion. Mirrors the trainer
  // pattern: map a DB row to the local meal shape so it slots in everywhere.
  const customMealToMeal = (r) => ({
    id: `custom_${r.id}`,
    title: r.name, title_es: r.name_es || r.name,
    calories: Number(r.calories) || 0, protein: Number(r.protein_g) || 0,
    carbs: Number(r.carbs_g) || 0, fat: Number(r.fat_g) || 0,
    category: r.category || 'custom', custom: true, image: null,
  });
  const [customMeals, setCustomMeals] = useState([]);
  const [showAddMeal, setShowAddMeal] = useState(false);
  const [newMeal, setNewMeal] = useState({ name: '', calories: '', protein: '', carbs: '', fat: '' });
  const [savingNewMeal, setSavingNewMeal] = useState(false);
  // Load custom meals once the swap list is open (removedIdx set) and we know who.
  useEffect(() => {
    if (removedIdx == null || !userId) return;
    let alive = true;
    supabase.from('custom_meals').select('*').eq('created_by', userId)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (alive) setCustomMeals((data || []).map(customMealToMeal)); });
    return () => { alive = false; };
  }, [removedIdx, userId]);

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
      // Replacements must fit the slot being replaced — swapping out the
      // breakfast suggests breakfasts, not salmon.
      mealType: meals[idx]?.slot || ['breakfast', 'lunch', 'dinner'][idx] || null,
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

  // Save a member-authored meal to custom_meals (created_by = their profile id),
  // prepend it to the picker list, and drop it straight into the open slot.
  const addCustomMeal = async () => {
    if (!newMeal.name.trim() || savingNewMeal || !userId) return;
    setSavingNewMeal(true);
    const { data, error } = await supabase.from('custom_meals').insert({
      created_by: userId, gym_id: gymId || null,
      name: newMeal.name.trim(),
      calories: Number(newMeal.calories) || 0, protein_g: Number(newMeal.protein) || 0,
      carbs_g: Number(newMeal.carbs) || 0, fat_g: Number(newMeal.fat) || 0,
      category: 'custom',
    }).select('*').single();
    setSavingNewMeal(false);
    if (error) { showToast(t('nutrition.addMealFailed', 'Could not add meal'), 'error'); return; }
    const meal = customMealToMeal(data);
    setCustomMeals(prev => [meal, ...prev]);
    setNewMeal({ name: '', calories: '', protein: '', carbs: '', fat: '' });
    setShowAddMeal(false);
    if (removedIdx != null) handleReplace(removedIdx, meal); // use it now in the open slot
  };

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
        <div style={{ fontFamily: TU.display, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>
          {t('nutrition.dailySuggestion')}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRegenerate}
            aria-label={t('nutrition.refreshSuggestion', 'Refresh suggestion')}
            className="w-7 h-7 flex items-center justify-center rounded-full active:scale-90 transition-transform"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}
          >
            <RefreshCw size={13} style={{ color: 'var(--color-text-muted)' }} />
          </button>
        </div>
      </div>

      {/* Single suggestion card (show 1 at a time) */}
      {(() => {
        // Pick the first non-null meal
        const idx = meals.findIndex(m => m != null);
        if (idx < 0) return null;
        const meal = meals[idx];
        // Recover the image from the live library by id when the meal object
        // itself carries none (DB pointer still null pre-0631) — same reason as
        // the planner rows.
        const suggImg = meal.image || mealImageById(meal.id);
        const isRemoved = removedIdx === idx;

        if (isRemoved) {
          return (
            <div className="rounded-[22px] overflow-hidden"
              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
              <div className="px-4 py-3 flex items-center justify-between"
                style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                <span className="text-[11px] font-bold" style={{ color: TU.coach }}>
                  {t('nutrition.replaceMeal', 'Pick a replacement')}
                </span>
                <button onClick={() => { setRemovedIdx(null); setReplacements([]); setShowAddMeal(false); }}
                  className="text-[10px] font-bold" style={{ color: 'var(--color-text-muted)' }}>
                  {t('nutrition.cancel', 'Cancel')}
                </button>
              </div>
              {/* Add your own meal → saved to the member's private custom-meal library */}
              <div className="px-3 pt-3">
                <button type="button" onClick={() => setShowAddMeal(s => !s)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-[12px] text-[12px] font-bold active:scale-[0.98] transition-transform"
                  style={{ background: `${TU.coach}12`, color: TU.coach, border: `1px dashed ${TU.coach}55` }}>
                  <Plus size={14} /> {t('nutrition.addCustomMeal', 'Add your own meal')}
                </button>
                <CustomMealBuilder open={showAddMeal} onClose={() => setShowAddMeal(false)}
                  onSaved={(m) => { const mm = customMealToMeal(m); setCustomMeals(prev => [mm, ...prev]); if (removedIdx != null) handleReplace(removedIdx, mm); }}
                  userId={userId} gymId={gymId} lang={lang} />
              </div>
              <div className="px-3 py-3 space-y-2 max-h-[280px] overflow-y-auto">
                {/* The member's custom meals first (Custom tag), then the AI suggestions. */}
                {[...customMeals.map(m => ({ meal: m })), ...replacements].map(({ meal: rMeal }) => (
                  <button key={rMeal.id} onClick={() => handleReplace(idx, rMeal)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-[14px] text-left transition-all active:scale-[0.975]"
                    style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                    {rMeal.image ? (
                      <img src={foodImageUrl(rMeal.image)} onError={handleMealImgError} alt={mealTitle(rMeal)} className="w-[44px] h-[44px] rounded-[12px] object-cover flex-shrink-0" style={{ background: 'var(--color-border-subtle)' }} loading="lazy" />
                    ) : (
                      <FoodTile name={mealTitle(rMeal)} size={44} seed={rMeal.id?.charCodeAt?.(1) || 0} />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold truncate flex items-center gap-1.5" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>
                        <span className="truncate">{mealTitle(rMeal)}</span>
                        {rMeal.custom && (
                          <span className="shrink-0 text-[8.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: `${TU.coach}1f`, color: TU.coach }}>
                            {t('nutrition.customTag', 'Custom')}
                          </span>
                        )}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                        <span><strong style={{ color: 'var(--color-text-primary)' }}>{rMeal.calories}</strong> kcal</span>
                        <span><strong style={{ color: TU.macroP }}>{rMeal.protein}P</strong></span>
                        <span><strong style={{ color: TU.macroC }}>{rMeal.carbs}C</strong></span>
                        <span><strong style={{ color: TU.macroF }}>{rMeal.fat}F</strong></span>
                      </div>
                    </div>
                  </button>
                ))}
                {replacements.length === 0 && customMeals.length === 0 && (
                  <p className="text-[11px] text-center py-4" style={{ color: 'var(--color-text-muted)' }}>
                    {t('nutrition.noResultsFound', 'No results found')}
                  </p>
                )}
              </div>
            </div>
          );
        }

        return (
          <div className="rounded-[22px] overflow-hidden"
            style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)', border: `1px solid ${TU.coach}22` }}>
            <button onClick={() => onOpenRecipe(meal)}
              className="w-full flex items-center gap-3.5 p-4 text-left">
              {suggImg ? (
                <img src={(foodImageUrl(suggImg) || MEAL_IMG_FALLBACK)} onError={handleMealImgError} alt={mealTitle(meal)} className="w-[52px] h-[52px] rounded-[14px] object-cover flex-shrink-0"
                  style={{ background: 'var(--color-border-subtle)' }} loading="lazy" />
              ) : (
                <FoodTile name={mealTitle(meal)} size={52} seed={idx} />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold uppercase mb-0.5" style={{ color: TU.coach, letterSpacing: '0.06em' }}>
                  {t('nutrition.fitsRemainingMacros', 'Fits your remaining macros')}
                </div>
                <div className="truncate mb-1" style={{ fontFamily: TU.display, fontSize: 17, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>
                  {mealTitle(meal)}
                </div>
                <div className="flex items-center gap-2.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  <span><strong style={{ color: 'var(--color-text-primary)' }}>{meal.calories}</strong> kcal</span>
                  <span><strong style={{ color: TU.macroP }}>{meal.protein}P</strong></span>
                  <span><strong style={{ color: TU.macroC }}>{meal.carbs}C</strong></span>
                  <span><strong style={{ color: TU.macroF }}>{meal.fat}F</strong></span>
                </div>
              </div>
            </button>
            {/* Swap / Log split buttons */}
            <div className="flex" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
              <button onClick={(e) => { e.stopPropagation(); handleRemoveMeal(idx); }}
                className="flex-1 py-3 text-[13px] font-semibold text-center active:scale-95 transition-all"
                style={{ color: 'var(--color-text-muted)', background: 'transparent', border: 'none', borderRight: '1px solid var(--color-border-subtle)' }}>
                {t('nutrition.swap', 'Swap')}
              </button>
              <button onClick={() => (onLogMeal ? onLogMeal(meal) : onOpenRecipe(meal))}
                className="flex-1 py-3 text-[13px] font-bold text-center active:scale-95 transition-all"
                style={{ color: TU.coach, background: 'transparent', border: 'none' }}>
                {t('nutrition.logMeal', 'Log meal')}
              </button>
            </div>
          </div>
        );
      })()}

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
                        {(lang === 'es' && log.food_item?.name_es) ? log.food_item.name_es : (log.food_item?.name || log.custom_name || t('nutrition.foodFallback', 'Food'))}
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
  const sun = new Date(d);
  sun.setDate(d.getDate() - day); // Sunday = start
  return toLocalDateStr(sun);
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

// Display a stored 24h "HH:MM" as 12h (en) or 24h (es).
const fmtMealTime = (hhmm, lang) => {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const mm = String(m || 0).padStart(2, '0');
  if (lang === 'es') return `${String(h).padStart(2, '0')}:${mm}`;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${ampm}`;
};

// −/+ stepper for a bounded integer (plan length, meals per day).
const Stepper = ({ value, min, max, onChange, label }) => (
  <div className="flex items-center justify-between rounded-[12px] p-1.5" style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}>
    <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}
      className="w-12 h-10 rounded-[10px] flex items-center justify-center active:scale-90 transition-transform disabled:opacity-30"
      style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }} aria-label="decrease">
      <Minus size={16} strokeWidth={2.6} />
    </button>
    <div className="flex items-baseline gap-1.5">
      <span style={{ fontFamily: TU.display, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>{value}</span>
      <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
    </div>
    <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}
      className="w-12 h-10 rounded-[10px] flex items-center justify-center active:scale-90 transition-transform disabled:opacity-30"
      style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }} aria-label="increase">
      <Plus size={16} strokeWidth={2.6} />
    </button>
  </div>
);

const WeeklyMealPlanner = ({ onClose, targets, onOpenRecipe, onOpenSearch, userId, embedded = false, onAddRecipeToGrocery, onRemoveRecipeFromGrocery, onMarkMealEaten, groceryList = [] }) => {
  // Full-screen planner only mounts when showPlanner is true, so lock unconditionally.
  useScrollLock(true);
  const { t, i18n } = useTranslation('pages');
  const posthogPlanner = usePostHog();
  const lang = i18n.language || 'en';
  const [plan, setPlan] = useState({});
  const [toast, setToast] = useState('');
  const [removingSlot, setRemovingSlot] = useState(null);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = current, -1 = past, +1 = next
  const [planWeeks, setPlanWeeks] = useState(1); // how many weeks "Generate" fills at once
  const { profile } = useAuth();
  const [showPrefs, setShowPrefs] = useState(false);
  const [showPlanConfig, setShowPlanConfig] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  // Meal-schedule config: how many meals/day (3–5) + optional per-slot times.
  // Drives the planner's slots AND meal-time reminders. Persisted per user.
  const [mealSchedule, setMealSchedule] = useState(() => loadMealSchedule(userId));
  const slotKeys = useMemo(() => plannerSlotKeys(mealSchedule.count), [mealSchedule.count]);
  useEffect(() => { saveMealSchedule(userId, mealSchedule); }, [userId, mealSchedule]);
  const setSlotTime = useCallback((slotKey, time) => {
    setMealSchedule(prev => {
      const times = { ...prev.times };
      if (time) times[slotKey] = time; else delete times[slotKey];
      return { ...prev, times };
    });
    if (time) ensureMealNotifPermission(); // user gesture → OK to prompt
  }, []);
  // Food prefs (allergies / dietary restrictions / foods-to-avoid + learned
  // affinities) — loaded once and fed into generation so the planner
  // hard-excludes unsafe/avoided meals and leans toward learned likes.
  const [prefs, setPrefs] = useState({ allergies: [], restrictions: [], avoid: [], affinities: {} });
  const loadPrefs = useCallback(async () => {
    if (!userId) return;
    const [ob, dis, aff] = await Promise.all([
      supabase.from('member_onboarding').select('food_allergies, dietary_restrictions').eq('profile_id', userId).maybeSingle(),
      supabase.from('disliked_foods').select('food_name').eq('profile_id', userId),
      loadAffinities(userId),
    ]);
    if (ob.error || dis.error) console.warn('[loadPrefs]', ob.error || dis.error);
    setPrefs({
      allergies: ob.data?.food_allergies || [],
      restrictions: ob.data?.dietary_restrictions || [],
      avoid: (dis.data || []).map(d => d.food_name).filter(Boolean),
      affinities: aff || {},
    });
  }, [userId]);
  useEffect(() => { loadPrefs(); }, [loadPrefs]);

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

  // Keep meal-time reminders in sync with the plan + schedule. No-op on web and
  // when no times are set; never prompts (permission is asked on time-set).
  useEffect(() => {
    syncMealReminders({ userId, schedule: mealSchedule, t });
  }, [userId, mealSchedule, plan, t]);

  const storageKey = `meal_plan_${userId || 'anon'}_${weekStart}`;
  const legacyStorageKey = `meal_plan_${userId || 'anon'}`;

  // Load the week's plan SYNCHRONOUSLY when the week changes (localStorage is
  // sync). Doing this in an effect made `plan` lag one frame behind weekStart,
  // so weekHasMeals/filledSlots were briefly wrong and the clear buttons flashed
  // in after "Regenerate week" rendered full-width. Adjusting state during
  // render (guarded by loadedKey) keeps everything consistent on the first frame.
  const [loadedKey, setLoadedKey] = useState(null);
  if (loadedKey !== storageKey) {
    setLoadedKey(storageKey);
    let days = {};
    try {
      let raw = localStorage.getItem(storageKey);
      if (raw) {
        days = JSON.parse(raw).days || {};
      } else if (weekOffset === 0) {
        raw = localStorage.getItem(legacyStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.weekStart === weekStart) days = parsed.days || {};
        }
      }
    } catch { /* ignore */ }
    setPlan(days);
  }

  // Re-read when another surface (e.g. a collection's "Add to week") mutates the
  // same localStorage key while this planner is already mounted.
  useEffect(() => {
    const reload = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        setPlan(raw ? (JSON.parse(raw).days || {}) : {});
      } catch { /* ignore */ }
    };
    window.addEventListener('tugympr:meal-plan-changed', reload);
    return () => window.removeEventListener('tugympr:meal-plan-changed', reload);
  }, [storageKey]);

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
      // localStorage save failed — continue silently
    }
    // Attempt Supabase save
    if (userId) {
      supabase.from('meal_plans').upsert({
        profile_id: userId,
        week_start: weekStart,
        plan_data: newPlan,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'profile_id,week_start' }).then(() => {}, () => {});
    }
  }, [storageKey, legacyStorageKey, weekStart, userId, weekOffset]);

  // Build one week's day→slot meal map from a fresh generation, merged onto a
  // base (so we never overwrite meals the user already placed).
  const buildWeekDays = useCallback((dates, isCurrentActual, base = {}) => {
    const macroTargets = {
      calories: targets?.daily_calories || 2000,
      protein: targets?.daily_protein_g || 150,
      carbs: targets?.daily_carbs_g || 200,
      fat: targets?.daily_fat_g || 65,
    };
    // Generate with as many slots as the member's schedule (snacks between
    // lunch and dinner). Snack keys (snack1/snack2) map to the 'snack' type and
    // resolve positionally below since the generator labels them all 'snack'.
    const weekPlan = generateWeekPlan({ targets: macroTargets, slots: slotKeys.length, favorites: [], lang, allergies: prefs.allergies, restrictions: prefs.restrictions, avoidIngredients: prefs.avoid, affinities: prefs.affinities });
    const ts = todayStr();
    const out = { ...base };
    dates.forEach((date, i) => {
      if (isCurrentActual && date < ts) return; // never plan into the past
      if (!out[date]) out[date] = {};
      const dayMeals = weekPlan[i]?.meals || [];
      slotKeys.forEach((slot, si) => {
        const match = dayMeals.find(m => m?.slot === slot) || dayMeals[si];
        if (!out[date][slot] && match) out[date][slot] = match;
      });
    });
    return out;
  }, [targets, prefs, lang, slotKeys]);

  // Compute the 7 date strings for an arbitrary week-start (YYYY-MM-DD).
  const weekDatesFrom = useCallback((ws) => {
    const start = new Date(ws + 'T12:00:00');
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return toLocalDateStr(d);
    });
  }, []);

  // Read/write a plan for a week OTHER than the one in React state (used when
  // "Generate" fills several weeks ahead — future weeks are persisted directly
  // so they're waiting when the user navigates to them).
  const readWeekDays = useCallback((ws) => {
    try {
      const raw = localStorage.getItem(`meal_plan_${userId || 'anon'}_${ws}`);
      if (!raw) return {};
      return JSON.parse(raw).days || {};
    } catch { return {}; }
  }, [userId]);

  const writeWeekDays = useCallback((ws, days) => {
    const planJson = JSON.stringify({ weekStart: ws, days });
    if (planJson.length <= 500000) {
      try { localStorage.setItem(`meal_plan_${userId || 'anon'}_${ws}`, planJson); } catch { /* quota */ }
    }
    if (userId) {
      supabase.from('meal_plans').upsert({
        profile_id: userId, week_start: ws, plan_data: days, updated_at: new Date().toISOString(),
      }, { onConflict: 'profile_id,week_start' }).then(() => {}, () => {});
    }
  }, [userId]);

  // Generate the plan for the viewed week AND the next (numWeeks-1) weeks in one
  // tap. Longer commitments are the retention play — a member with a month of
  // meals mapped out doesn't quit after seven days.
  const handleAutoplan = useCallback((numWeeks = 1) => {
    if (isPastWeek) return;
    const n = Math.max(1, numWeeks | 0);
    posthogPlanner?.capture('meal_plan_generated', { plan_type: n > 1 ? 'multi_week' : 'week', weeks: n });
    for (let w = 0; w < n; w++) {
      let dates;
      if (w === 0) {
        dates = weekDates;
      } else {
        const s = new Date(weekStart + 'T12:00:00');
        s.setDate(s.getDate() + w * 7);
        dates = weekDatesFrom(toLocalDateStr(s));
      }
      const isCurrentActual = (weekOffset + w) === 0;
      if (w === 0) {
        savePlan(buildWeekDays(dates, isCurrentActual, plan));
      } else {
        const ws = dates[0];
        writeWeekDays(ws, buildWeekDays(dates, isCurrentActual, readWeekDays(ws)));
      }
    }
    setToast(n > 1
      ? t('nutrition.planGeneratedWeeks', { count: n, defaultValue: '{{count}}-week plan generated!' })
      : t('nutrition.planGenerated', 'Plan generated!'));
    setTimeout(() => setToast(''), 2200);
  }, [isPastWeek, weekDates, weekStart, weekOffset, plan, savePlan, buildWeekDays, weekDatesFrom, readWeekDays, writeWeekDays, posthogPlanner, t]);

  const handleRemoveMeal = useCallback((date, slot) => {
    if (isPastWeek) return;
    const removed = plan[date]?.[slot];
    const newPlan = { ...plan };
    if (newPlan[date]) {
      delete newPlan[date][slot];
    }
    savePlan(newPlan);
    setRemovingSlot(null);
    // Pull this meal's items back off the grocery list.
    if (removed?.id) onRemoveRecipeFromGrocery?.(removed.id, date);
  }, [plan, savePlan, isPastWeek, onRemoveRecipeFromGrocery]);

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
    const usedIds = slotKeys.map(k => dayData[k]?.id).filter(Boolean);
    const emptySlots = slotKeys.filter(k => !dayData[k]);
    if (emptySlots.length === 0) return;
    // Calculate already planned macros
    const planned = slotKeys.reduce((acc, k) => ({
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
    // slotTypes: the NAMED empty slots mapped to generator types — an empty
    // breakfast gets a breakfast dish, an empty dinner a dinner one, a snack a
    // light quick pick (snack1/snack2 → 'snack').
    const fillPlan = generateDayPlan({ targets: remainingTargets, slots: emptySlots.length, slotTypes: emptySlots.map(slotTypeOf), excludeIds: usedIds, allergies: prefs.allergies, restrictions: prefs.restrictions, avoidIngredients: prefs.avoid, affinities: prefs.affinities });
    const newPlan = { ...plan };
    if (!newPlan[date]) newPlan[date] = {};
    emptySlots.forEach((slot, i) => {
      if (fillPlan.meals[i]) newPlan[date][slot] = fillPlan.meals[i];
    });
    savePlan(newPlan);
  }, [plan, savePlan, targets, prefs, isPastWeek, slotKeys]);

  // Clear every meal in the displayed week.
  const handleClearWeek = useCallback(() => {
    const newPlan = { ...plan };
    weekDates.forEach(d => { delete newPlan[d]; });
    savePlan(newPlan);
    setConfirmClear(false);
    setToast(t('nutrition.weekCleared', 'Week cleared'));
    setTimeout(() => setToast(''), 2000);
  }, [plan, weekDates, savePlan, t]);

  // Clear just the active day (and pull its meals off the grocery list).
  const [clearDayArmed, setClearDayArmed] = useState(false);
  const handleClearDay = useCallback((date) => {
    if (isPastWeek) return;
    const newPlan = { ...plan };
    Object.values(newPlan[date] || {}).forEach(m => { if (m?.id) onRemoveRecipeFromGrocery?.(m.id, date); });
    delete newPlan[date];
    savePlan(newPlan);
    setClearDayArmed(false);
    setToast(t('nutrition.dayCleared', 'Day cleared'));
    setTimeout(() => setToast(''), 2000);
  }, [plan, savePlan, isPastWeek, onRemoveRecipeFromGrocery, t]);

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

  // Active day state for the day strip
  const [activeDay, setActiveDay] = useState(() => {
    const todayIdx = weekDates.findIndex(d => d === todayStr());
    return todayIdx >= 0 ? todayIdx : 0;
  });

  const activeDateStr = weekDates[activeDay] || weekDates[0];
  const activeDayData = plan[activeDateStr] || {};
  // Disarm the day-clear confirm whenever the viewed day/week changes.
  useEffect(() => { setClearDayArmed(false); }, [activeDay, weekOffset]);

  // Resolve a planned meal to its full RECIPES record (which carries the
  // ingredient list the grocery handler needs). Match by id first, then by
  // name; fall back to the meal itself if it already carries ingredients.
  const resolvePlannerRecipe = useCallback((meal) => {
    if (!meal) return null;
    return (
      RECIPES.find(r => r.id === meal.id) ||
      RECIPES.find(r => (r.title || r.name) === (meal.name || meal.title) && (meal.name || meal.title)) ||
      ((meal.ingredients || []).length ? meal : null)
    );
  }, []);

  // "Add to list" for the whole active day — push every planned meal's recipe
  // through the parent grocery handler (which dedupes + categorises). Per-meal
  // version below shares the same resolver.
  // `day` defaults to the day currently shown in the planner — both callers add
  // the active day's meals — so the ingredients land in that day's grocery
  // section instead of "Anytime".
  const addMealsToGrocery = useCallback((meals, day = activeDateStr) => {
    if (!onAddRecipeToGrocery) {
      setToast(t('nutrition.fillFromMealsError', 'Could not add to list'));
      setTimeout(() => setToast(''), 2000);
      return;
    }
    let added = 0;
    const seen = new Set();
    meals.forEach(meal => {
      const recipe = resolvePlannerRecipe(meal);
      if (!recipe || seen.has(recipe.id)) return;
      seen.add(recipe.id);
      onAddRecipeToGrocery(recipe, { day });
      added++;
    });
    setToast(added > 0
      ? t('nutrition.addedToGroceryList', 'Added to Grocery List')
      : t('nutrition.fillFromMealsEmpty', 'No active meal plan to pull from'));
    setTimeout(() => setToast(''), 2000);
  }, [onAddRecipeToGrocery, resolvePlannerRecipe, activeDateStr, t]);
  // Is this meal's shopping already on the grocery list (for its day, or undated)?
  const mealInList = useCallback((meal, day) => !!meal?.id && groceryList.some(i => i.recipeId === meal.id && (i.day === day || i.day == null)), [groceryList]);
  const activeDayPlannedKeys = slotKeys.filter(k => activeDayData[k]);
  const dayAllListed = activeDayPlannedKeys.length > 0 && activeDayPlannedKeys.every(k => mealInList(activeDayData[k], activeDateStr));
  const activeDayCal = slotKeys.reduce((s, k) => s + (activeDayData[k]?.calories || 0), 0);
  const activeDayP = slotKeys.reduce((s, k) => s + (activeDayData[k]?.protein || 0), 0);
  const activeDayC = slotKeys.reduce((s, k) => s + (activeDayData[k]?.carbs || 0), 0);
  const activeDayF = slotKeys.reduce((s, k) => s + (activeDayData[k]?.fat || 0), 0);
  const activePct = calTarget > 0 ? activeDayCal / calTarget : 0;
  const filledSlots = slotKeys.filter(k => activeDayData[k]).length;
  // Any meals anywhere this week ⇒ the week button reads "Regenerate"; none ⇒ "Generate".
  const weekHasMeals = weekDates.some(d => slotKeys.some(k => plan[d]?.[k]));

  const dayShorts = lang === 'es'
    ? ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB']
    : ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  const SLOT_LABELS = {
    breakfast: t('nutrition.meals.breakfast'),
    lunch: t('nutrition.meals.lunch'),
    dinner: t('nutrition.meals.dinner'),
  };

  const content = (
    <div className="h-screen flex flex-col" style={{ background: 'var(--color-bg-primary)', paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="shrink-0 px-5 pt-4 pb-3 flex items-center justify-between z-10"
        style={{ background: 'var(--color-bg-primary)', borderBottom: '1px solid var(--color-border-subtle)' }}>
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 focus:outline-none"
            style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <X size={18} style={{ color: 'var(--color-text-muted)' }} />
          </button>
          <div style={{ fontFamily: TU.display, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>
            {t('nutrition.myPlan', 'My Plan')}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => setShowPlanConfig(true)} className="w-10 h-10 rounded-full flex items-center justify-center focus:outline-none"
            style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }} aria-label={t('nutrition.planConfig', 'Plan setup')}>
            <Calendar size={18} style={{ color: 'var(--color-text-muted)' }} />
          </button>
          <button onClick={() => setShowPrefs(true)} className="w-10 h-10 rounded-full flex items-center justify-center focus:outline-none"
            style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }} aria-label={t('nutrition.prefsTitle', 'Preferences')}>
            <SlidersHorizontal size={18} style={{ color: 'var(--color-text-muted)' }} />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">

        {/* Week jumper */}
        <div className="mx-4 mt-3 mb-3 py-2.5 px-3.5 rounded-[14px] flex items-center justify-between"
          style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
          <button onClick={() => setWeekOffset(o => o - 1)} className="w-[30px] h-[30px] flex items-center justify-center">
            <ChevronLeft size={18} style={{ color: 'var(--color-text-primary)' }} />
          </button>
          <div className="text-center">
            <div style={{ fontFamily: TU.display, fontSize: 15, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>
              {weekOffset === 0 ? t('nutrition.thisWeek', 'This week') : weekOffset === -1 ? t('nutrition.lastWeek', 'Last week') : weekOffset === 1 ? t('nutrition.nextWeek', 'Next week') : t('nutrition.weekOffset', { offset: weekOffset, defaultValue: 'Week {{offset}}' })}
            </div>
            <div className="text-[11px] mt-0.5 font-medium" style={{ color: 'var(--color-text-muted)' }}>
              {(() => {
                const s = new Date(weekDates[0] + 'T12:00:00');
                const e = new Date(weekDates[6] + 'T12:00:00');
                const fmt = (d) => d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric' });
                return `${fmt(s)} \u2013 ${fmt(e)}, ${e.getFullYear()}`;
              })()}
            </div>
          </div>
          <button onClick={() => setWeekOffset(o => o + 1)} className="w-[30px] h-[30px] flex items-center justify-center">
            <ChevronRight size={18} style={{ color: 'var(--color-text-primary)' }} />
          </button>
        </div>

        {/* Regenerate / fill this week — the week-level actions live with the week */}
        {!isPastWeek && (
          <div className="px-4 mb-4">
            {confirmClear ? (
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmClear(false)}
                  className="flex-1 py-3 rounded-[14px] text-[12.5px] font-bold active:scale-95"
                  style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}>
                  {t('nutrition.keepPlan', 'Keep')}
                </button>
                <button type="button" onClick={handleClearWeek}
                  className="flex-1 py-3 rounded-[14px] text-[12.5px] font-bold flex items-center justify-center gap-1.5 active:scale-95"
                  style={{ background: 'var(--color-danger)', color: '#fff', border: 'none' }}>
                  <Trash2 size={13} />{t('nutrition.clearWeek', 'Clear week')}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => handleAutoplan(planWeeks)}
                  className="flex-1 min-w-0 py-3 rounded-[14px] text-[13.5px] font-bold flex items-center justify-center gap-2 active:scale-[0.97] transition-all"
                  style={{ background: TU.coach, color: '#fff', letterSpacing: -0.2 }}>
                  <Sparkles size={15} style={{ flexShrink: 0 }} />
                  <span className="truncate">{planWeeks > 1
                    ? t('nutrition.generateNWeeks', { count: planWeeks, defaultValue: 'Generate {{count}} weeks' })
                    : (weekHasMeals ? t('nutrition.regenerateWeek', 'Regenerate week') : t('nutrition.generateWeek', 'Generate week'))}</span>
                </button>
                {weekHasMeals && (
                  <button type="button" onClick={() => setConfirmClear(true)} aria-label={t('nutrition.clearWeek', 'Clear week')}
                    className="flex-shrink-0 w-12 py-3 rounded-[14px] flex items-center justify-center active:scale-95"
                    style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Day strip */}
        <div className="flex gap-1.5 px-3 pb-4">
          {weekDates.map((date, i) => {
            const active = i === activeDay;
            const dateNum = new Date(date + 'T12:00:00').getDate();
            return (
              <button key={date} onClick={() => setActiveDay(i)}
                className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-[14px] active:scale-95 transition-all"
                style={{
                  background: active ? 'var(--color-text-primary)' : 'var(--color-bg-card)',
                  border: active ? 'none' : '1px solid var(--color-border-subtle)',
                }}>
                <span className="text-[10px] font-bold uppercase" style={{ color: active ? 'var(--color-bg-primary)' : 'var(--color-text-muted)', letterSpacing: 0.8 }}>{dayShorts[i]}</span>
                <span style={{ fontFamily: TU.display, fontSize: 19, fontWeight: 800, color: active ? 'var(--color-bg-primary)' : 'var(--color-text-primary)', letterSpacing: -0.5, lineHeight: 1 }}>{dateNum}</span>
              </button>
            );
          })}
        </div>

        {/* Toast */}
        {toast && (
          <div className="mx-4 mb-3 px-4 py-2.5 rounded-xl text-center text-[12px] font-semibold"
            style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--color-success)' }}>
            {toast}
          </div>
        )}

        {/* Day summary card */}
        <div className="px-4 mb-4">
          <div className="rounded-[18px] p-4" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
            <div className="flex items-baseline justify-between mb-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>{t('nutrition.planned', 'Planned')}</div>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span style={{ fontFamily: TU.display, fontSize: 32, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -1.2, lineHeight: 1 }}>{activeDayCal.toLocaleString()}</span>
                  <span className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>/ {calTarget}</span>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold"
                style={{ background: `${TU.accent}12`, color: TU.accent }}>
                <Check size={11} strokeWidth={2.8} />
                {filledSlots}/{slotKeys.length}
              </span>
            </div>
            <div className="rounded-full overflow-hidden mb-3.5" style={{ height: 6, background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}>
              <div style={{ width: `${Math.min(100, activePct * 100)}%`, height: '100%', background: `linear-gradient(to right, ${TU.macroP}, ${TU.accent})`, borderRadius: 999 }} />
            </div>
            <div className="flex gap-2.5">
              {[
                { l: 'P', v: activeDayP, tg: proteinTarget, c: TU.macroP },
                { l: 'C', v: activeDayC, tg: carbsTarget, c: TU.macroC },
                { l: 'F', v: activeDayF, tg: fatTarget, c: TU.macroF },
              ].map(m => {
                const pct = m.tg > 0 ? Math.min(100, (m.v / m.tg) * 100) : 0;
                return (
                <div key={m.l} className="flex-1 px-2.5 py-2 rounded-[10px]" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.03))' }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-sm" style={{ background: m.c }} />
                      <span className="text-[11px] font-bold" style={{ color: 'var(--color-text-muted)' }}>{m.l}</span>
                    </div>
                    <span style={{ fontFamily: TU.display, fontSize: 13, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>{Math.round(m.v)}<span className="text-[9px] font-medium" style={{ color: 'var(--color-text-muted)' }}>/{Math.round(m.tg)}g</span></span>
                  </div>
                  <div className="rounded-full overflow-hidden" style={{ height: 3, background: 'var(--color-border-subtle)' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: m.c, borderRadius: 999 }} />
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Meals heading */}
        <div className="px-5 mb-3 flex items-baseline justify-between">
          <div style={{ fontFamily: TU.display, fontSize: 18, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.4 }}>
            {dayShorts[activeDay]} {new Date(activeDateStr + 'T12:00:00').getDate()} {'\u2014'} {t('nutrition.mealsLabel', 'meals')}
          </div>
          <button
            type="button"
            onClick={() => { if (!dayAllListed) addMealsToGrocery(activeDayPlannedKeys.map(k => activeDayData[k])); }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold focus:outline-none active:scale-95"
            style={dayAllListed
              ? { background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', color: 'var(--color-success)' }
              : { background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
            {dayAllListed ? <><Check size={12} strokeWidth={2.8} />{t('nutrition.added', 'Added')}</> : <><ShoppingCart size={12} />{t('nutrition.addToList', 'Add to list')}</>}
          </button>
        </div>

        {/* Day-level actions — regenerate / clear THIS day, beside its meals */}
        {!isPastWeek && (
          <div className="px-4 mb-3">
            {clearDayArmed ? (
              <div className="flex gap-2">
                <button type="button" onClick={() => setClearDayArmed(false)}
                  className="flex-1 py-2.5 rounded-[12px] text-[12px] font-bold active:scale-95"
                  style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}>
                  {t('nutrition.keepPlan', 'Keep')}
                </button>
                <button type="button" onClick={() => handleClearDay(activeDateStr)}
                  className="flex-1 py-2.5 rounded-[12px] text-[12px] font-bold flex items-center justify-center gap-1.5 active:scale-95"
                  style={{ background: 'var(--color-danger)', color: '#fff', border: 'none' }}>
                  <Trash2 size={12} />{t('nutrition.clearDay', 'Clear day')}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => handleCompleteDay(activeDateStr)}
                  className="flex-1 min-w-0 py-2.5 rounded-[12px] text-[12px] font-bold flex items-center justify-center gap-1.5 active:scale-95"
                  style={{ background: `${TU.coach}12`, border: `1px solid ${TU.coach}33`, color: TU.coach }}>
                  <Sparkles size={13} style={{ flexShrink: 0 }} />
                  <span className="truncate">{filledSlots > 0 ? t('nutrition.regenerateDay', 'Regenerate this day') : t('nutrition.generateDay', 'Generate this day')}</span>
                </button>
                {filledSlots > 0 && (
                  <button type="button" onClick={() => setClearDayArmed(true)} aria-label={t('nutrition.clearDay', 'Clear day')}
                    className="flex-shrink-0 w-11 py-2.5 rounded-[12px] flex items-center justify-center active:scale-95"
                    style={{ background: 'transparent', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Meal rows for active day */}
        <div className="px-4 flex flex-col gap-2.5 pb-4">
          {slotKeys.map((slot, si) => {
            const meal = activeDayData[slot];
            const slotLabel = slotLabelFor(slot, mealSchedule.count, t);
            const slotTime = mealSchedule.times[slot];
            // Re-resolve the image from the live library by id. Plans are stored
            // in localStorage as a snapshot, so a plan generated before a recipe
            // had an image would keep showing a letter tile forever otherwise.
            const mealImg = meal && (meal.image || mealImageById(meal.id));
            const listed = mealInList(meal, activeDateStr);

            if (!meal) {
              return (
                <button key={slot} onClick={() => { if (!isPastWeek) onOpenSearch(); }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-[18px] text-left active:scale-[0.97] transition-all"
                  style={{ background: 'transparent', border: '1.5px dashed var(--color-border-subtle)' }}>
                  <div className="w-[52px] h-[52px] rounded-[14px] flex items-center justify-center" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.03))' }}>
                    <Plus size={18} style={{ color: 'var(--color-text-muted)' }} />
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>{slotLabel}</span>
                      {slotTime && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold" style={{ color: TU.coach }}><Clock size={10} />{fmtMealTime(slotTime, lang)}</span>}
                    </span>
                    <p className="text-[13px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.tapToAdd', 'Tap to add')}</p>
                  </div>
                </button>
              );
            }

            return (
              <div key={slot} className="rounded-[18px] p-3" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                <button type="button" onClick={() => onOpenRecipe(meal)} className="w-full flex gap-3 items-center mb-2.5 text-left active:scale-[0.985] transition-transform">
                  {mealImg ? (
                    <img src={(foodImageUrl(mealImg) || MEAL_IMG_FALLBACK)} onError={handleMealImgError} alt="" className="w-[52px] h-[52px] rounded-[14px] object-cover flex-shrink-0" style={{ background: 'var(--color-border-subtle)' }} loading="lazy" />
                  ) : (
                    <FoodTile name={mealTitle(meal)} size={52} seed={si} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>{slotLabel}</span>
                      {slotTime && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold" style={{ color: TU.coach }}><Clock size={10} />{fmtMealTime(slotTime, lang)}</span>}
                    </div>
                    <div className="truncate mb-1" style={{ fontFamily: TU.display, fontSize: 15, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{mealTitle(meal)}</div>
                    <div className="flex gap-2 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      <span><strong style={{ color: 'var(--color-text-primary)' }}>{meal.calories}</strong> kcal</span>
                      <span><strong style={{ color: TU.macroP }}>{meal.protein}P</strong></span>
                      <span><strong style={{ color: TU.macroC }}>{meal.carbs ?? 0}C</strong></span>
                      <span><strong style={{ color: TU.macroF }}>{meal.fat ?? 0}F</strong></span>
                    </div>
                  </div>
                </button>
                {/* Action row */}
                <div className="flex gap-1.5 pt-2.5" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                  <button onClick={() => handleRemoveMeal(activeDateStr, slot)}
                    className="flex-1 py-2 rounded-[10px] text-[11px] font-bold flex items-center justify-center gap-1.5 active:scale-95"
                    style={{ color: 'var(--color-danger)', background: 'transparent', border: 'none' }}>
                    <Trash2 size={12} />{t('nutrition.removeMeal', 'Remove')}
                  </button>
                  <button type="button" onClick={() => { if (!listed) addMealsToGrocery([meal]); }}
                    className="flex-1 py-2 rounded-[10px] text-[11px] font-bold flex items-center justify-center gap-1.5 active:scale-95"
                    style={listed
                      ? { color: 'var(--color-success)', background: 'rgba(16,185,129,0.12)', border: 'none' }
                      : { color: 'var(--color-text-muted)', background: 'transparent', border: 'none' }}>
                    {listed ? <><Check size={12} strokeWidth={2.8} />{t('nutrition.added', 'Added')}</> : <><ShoppingCart size={12} />{t('nutrition.list', 'List')}</>}
                  </button>
                  <button onClick={() => { onMarkMealEaten?.(meal.id, activeDateStr); onOpenRecipe(meal); }}
                    className="flex-1 py-2 rounded-[10px] text-[11px] font-bold flex items-center justify-center gap-1.5 active:scale-95"
                    style={{ color: TU.accent, background: `${TU.accent}12`, border: 'none' }}>
                    <Check size={12} strokeWidth={2.8} />{t('nutrition.eaten', 'Eaten')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pb-6" />
      </div>{/* end scrollable */}

      <MealPrefsSheet
        open={showPrefs}
        onClose={() => setShowPrefs(false)}
        userId={userId}
        gymId={profile?.gym_id}
        initialAllergies={prefs.allergies}
        initialRestrictions={prefs.restrictions}
        initialAvoid={prefs.avoid}
        onSaved={({ allergies, restrictions, avoid }) => {
          setPrefs(p => ({ ...p, allergies, restrictions, avoid }));
          setShowPrefs(false);
          setToast(t('nutrition.prefsSaved', 'Preferences saved'));
          setTimeout(() => setToast(''), 2000);
          loadPrefs();
        }}
      />

      {/* Plan setup — length, meals/day, and optional per-meal times + reminders */}
      {showPlanConfig && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowPlanConfig(false)} role="presentation" />
          <div className="relative w-full max-w-[460px] max-h-[88dvh] flex flex-col overflow-hidden rounded-[24px]"
            style={{ background: 'var(--color-bg-primary)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
              <div style={{ fontFamily: TU.display, fontSize: 22, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>{t('nutrition.planConfig', 'Plan setup')}</div>
              <button onClick={() => setShowPlanConfig(false)} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--color-bg-card)' }} aria-label={t('common.close', 'Close')}>
                <X size={17} style={{ color: 'var(--color-text-muted)' }} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-4 pt-1 space-y-6" style={{ overscrollBehavior: 'contain' }}>
              {/* Plan length — how many weeks Generate fills in one tap */}
              <div>
                <div className="text-[11px] font-bold uppercase mb-2.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>{t('nutrition.planLength', 'Plan length')}</div>
                <Stepper value={planWeeks} min={1} max={PLAN_WEEKS_MAX}
                  onChange={(v) => setPlanWeeks(v)}
                  label={planWeeks === 1 ? t('nutrition.weekUnit', 'week') : t('nutrition.weeksUnit', 'weeks')} />
              </div>
              {/* Meals per day */}
              <div>
                <div className="text-[11px] font-bold uppercase mb-2.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>{t('nutrition.mealsPerDay', 'Meals per day')}</div>
                <Stepper value={mealSchedule.count} min={MEAL_SLOT_MIN} max={MEAL_SLOT_MAX}
                  onChange={(v) => setMealSchedule(prev => ({ ...prev, count: v }))}
                  label={t('nutrition.mealsUnit', 'meals')} />
                <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.mealsPerDayHint', 'Extra meals are added as snacks between lunch and dinner.')}</p>
              </div>
              {/* Meal times */}
              <div>
                <div className="text-[11px] font-bold uppercase mb-1" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>{t('nutrition.mealTimes', 'Meal times')}</div>
                <p className="mb-2.5 text-[11.5px]" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.mealTimesHint', 'Optional — set a time to see it on your meals and get a reminder.')}</p>
                <div className="space-y-2">
                  {slotKeys.map((k) => (
                    <div key={k} className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-[14px]" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                      <span className="text-[13.5px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{slotLabelFor(k, mealSchedule.count, t)}</span>
                      <div className="flex items-center gap-2">
                        <input type="time" value={mealSchedule.times[k] || ''} onChange={(e) => setSlotTime(k, e.target.value)}
                          className="text-[13.5px] font-semibold px-2 py-1 rounded-[9px] focus:outline-none"
                          style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)', colorScheme: 'light dark' }} />
                        {mealSchedule.times[k] && (
                          <button onClick={() => setSlotTime(k, '')} className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90" style={{ background: 'var(--color-surface-hover)' }} aria-label={t('nutrition.clearTime', 'Clear time')}>
                            <X size={13} style={{ color: 'var(--color-text-muted)' }} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2.5 flex items-start gap-1.5">
                  <Bell size={12} style={{ color: TU.coach, marginTop: 2, flexShrink: 0 }} />
                  <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.mealNotifyNote', 'We remind you on your phone near each meal time — only for meals you’ve planned.')}</p>
                </div>
              </div>
            </div>
            <div className="px-5 pt-2.5 pb-5 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
              <button onClick={() => setShowPlanConfig(false)} className="w-full py-3 rounded-[14px] text-[14px] font-bold active:scale-[0.97]" style={{ background: TU.coach, color: '#fff' }}>
                {t('nutrition.done', 'Done')}
              </button>
            </div>
          </div>
        </div>
      )}
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
// ── SUMMARY SHEET MODAL (matches reference) ────────────────
// Helper to fetch summary week data (reusable for prefetch)
const fetchSummaryWeekData = async (userId, weeksBack = 0) => {
  // Week starts on Sunday; weeksBack=1 → last week, 2 → two weeks ago…
  const now = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay() - weeksBack * 7);
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
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
    if (d) { d.calories += log.calories || 0; d.protein += log.protein_g || 0; d.carbs += log.carbs_g || 0; d.fat += log.fat_g || 0; d.meals++; d.logs.push(log); }
  }
  return { dates, byDate };
};

const SummarySheetModal = ({ userId, targets, onClose, t, lang, prefetchedData }) => {
  // Only mounts when showSummary is true, so lock unconditionally.
  useScrollLock(true);
  // weeksBack: 0 = this week, 1 = last week… Past weeks are fetched on
  // demand and cached for the life of the modal so ‹ › flips are instant.
  const [weeksBack, setWeeksBack] = useState(0);
  const [expandedDay, setExpandedDay] = useState(null); // which day's logged meals are shown
  useEffect(() => { setExpandedDay(null); }, [weeksBack]);
  const weekCache = useRef(new Map(prefetchedData ? [[0, prefetchedData]] : []));
  const [weekData, setWeekData] = useState(prefetchedData || null);
  const calTarget = targets?.daily_calories || 2000;
  const proteinTarget = targets?.daily_protein_g || 150;
  const carbsTarget = targets?.daily_carbs_g || 200;
  const fatTarget = targets?.daily_fat_g || 65;

  const dayKeys = lang === 'es' ? ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'] : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  useEffect(() => {
    if (!userId) return;
    const cached = weekCache.current.get(weeksBack);
    if (cached) { setWeekData(cached); return; }
    let cancelled = false;
    setWeekData(null); // show the spinner for uncached weeks
    (async () => {
      const data = await fetchSummaryWeekData(userId, weeksBack);
      if (cancelled) return;
      weekCache.current.set(weeksBack, data);
      setWeekData(data);
    })();
    return () => { cancelled = true; };
  }, [userId, weeksBack]);

  // "Jun 1 – Jun 7" range label for past weeks; "This week" for the current.
  const weekLabel = useMemo(() => {
    if (weeksBack === 0) return t('nutrition.thisWeek', 'This week');
    const data = weekCache.current.get(weeksBack);
    const dates = data?.dates;
    if (!dates?.length) return '';
    const loc = lang === 'es' ? 'es' : 'en';
    const fmt = (s) => new Date(`${s}T00:00:00`).toLocaleDateString(loc, { month: 'short', day: 'numeric' });
    return `${fmt(dates[0])} – ${fmt(dates[6])}`;
  }, [weeksBack, weekData, lang, t]);

  // Compute stats
  const days = weekData ? weekData.dates.map((date, i) => {
    const d = weekData.byDate[date];
    return { d: dayKeys[i], date, kcal: d.calories, goal: calTarget, today: date === todayStr(), protein: d.protein, carbs: d.carbs, fat: d.fat, meals: d.meals, logs: d.logs || [] };
  }) : [];
  const expanded = expandedDay ? days.find(d => d.date === expandedDay) : null;

  const trackedDays = days.filter(d => d.meals > 0);
  const avg = trackedDays.length > 0 ? Math.round(trackedDays.reduce((s, d) => s + d.kcal, 0) / trackedDays.length) : 0;
  const avgP = trackedDays.length > 0 ? Math.round(trackedDays.reduce((s, d) => s + d.protein, 0) / trackedDays.length) : 0;
  const avgC = trackedDays.length > 0 ? Math.round(trackedDays.reduce((s, d) => s + d.carbs, 0) / trackedDays.length) : 0;
  const avgF = trackedDays.length > 0 ? Math.round(trackedDays.reduce((s, d) => s + d.fat, 0) / trackedDays.length) : 0;
  const adherence = trackedDays.length > 0 ? Math.round(trackedDays.filter(d => Math.abs(d.kcal - calTarget) / calTarget <= 0.1).length / trackedDays.length * 100) : 0;
  const streak = trackedDays.length;
  const maxBar = Math.max(calTarget, ...days.map(d => d.kcal)) * 1.05 || 1;
  const totalMeals = days.reduce((s, d) => s + (d.meals || 0), 0); // meals logged this week

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center px-4" style={{ paddingTop: 'env(safe-area-inset-top)' }} onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-[24px] flex flex-col overflow-hidden"
        style={{ background: 'var(--color-bg-primary)', maxHeight: '94vh', boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3 pb-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div style={{ fontFamily: TU.display, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>
            {t('nutrition.weeklySummaryTitle', 'Weekly Summary')}
          </div>
          <button onClick={onClose} className="w-[34px] h-[34px] rounded-full flex items-center justify-center focus:outline-none"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }} aria-label={t('common.close', 'Close')}>
            <X size={16} style={{ color: 'var(--color-text-primary)' }} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-8">
          {/* Week navigation — browse past weeks for overall progress */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setWeeksBack(w => w + 1)}
              className="w-9 h-9 rounded-full flex items-center justify-center active:scale-95 focus:outline-none"
              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}
              aria-label={t('nutrition.prevWeek', 'Previous week')}>
              <ChevronLeft size={16} style={{ color: 'var(--color-text-primary)' }} />
            </button>
            <span className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{weekLabel}</span>
            <button
              onClick={() => setWeeksBack(w => Math.max(0, w - 1))}
              disabled={weeksBack === 0}
              className="w-9 h-9 rounded-full flex items-center justify-center active:scale-95 focus:outline-none"
              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', opacity: weeksBack === 0 ? 0.35 : 1 }}
              aria-label={t('nutrition.nextWeek', 'Next week')}>
              <ChevronRight size={16} style={{ color: 'var(--color-text-primary)' }} />
            </button>
          </div>
          {!weekData ? (
            <div className="py-12 text-center"><div className="w-6 h-6 rounded-full animate-spin mx-auto" style={{ border: '2px solid var(--color-border-subtle)', borderTopColor: TU.accent }} /></div>
          ) : (
            <>
              {/* Stat pills */}
              <div className="grid grid-cols-3 gap-2.5 mb-5">
                {[
                  { label: t('nutrition.avgCalories', 'Avg kcal'), value: avg, sub: `/ ${calTarget}` },
                  { label: t('nutrition.compliance', 'Adherence'), value: `${adherence}%`, sub: t('nutrition.onTarget', 'on target'), accent: adherence >= 70 ? TU.accent : TU.hot },
                  // Honest label: this counts days TRACKED within the shown
                  // week (0–7) — it is not a consecutive-day streak and never
                  // was. Was previously labeled "Streak".
                  { label: t('nutrition.daysTracked', 'Days tracked'), value: String(streak), sub: t('nutrition.ofSevenDays', 'of 7 days'), accent: TU.hot },
                ].map(s => (
                  <div key={s.label} className="rounded-[14px] p-3.5" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>{s.label}</div>
                    <div style={{ fontFamily: TU.display, fontSize: 22, fontWeight: 800, color: s.accent || 'var(--color-text-primary)', letterSpacing: -0.7, lineHeight: 1 }}>{s.value}</div>
                    <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* Bar chart */}
              <div className="rounded-[18px] p-5 mb-5" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                <div className="text-[11px] font-bold uppercase tracking-wider mb-4 flex items-center justify-between gap-2" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
                  <span>{t('nutrition.dailyCalories', 'Daily calories')}</span>
                  <span style={{ textTransform: 'none', letterSpacing: 0, color: TU.accent }}>{t('nutrition.mealsLogged', { count: totalMeals, defaultValue: `${totalMeals} meals logged` })}</span>
                </div>
                <div className="relative" style={{ height: 160 }}>
                  {/* Goal line (px, matched to the bar scale below) */}
                  <div className="absolute left-0 right-0" style={{ bottom: (calTarget / maxBar) * 142, borderTop: '1.5px dashed var(--color-text-muted)', opacity: 0.4 }} />
                  <div className="absolute right-0 text-[9px] font-bold uppercase" style={{ bottom: (calTarget / maxBar) * 142 + 3, color: 'var(--color-text-muted)', letterSpacing: 0.5 }}>
                    {t('nutrition.goal', 'Goal')} {calTarget}
                  </div>
                  {/* Bars */}
                  <div className="absolute inset-0 flex items-end gap-1.5">
                    {days.map((day, i) => {
                      const h = day.kcal > 0 ? Math.max(4, (day.kcal / maxBar) * 142) : 2; // px within the 160-tall chart
                      const over = day.kcal > calTarget * 1.1;
                      const under = day.kcal < calTarget * 0.9;
                      const barColor = day.meals === 0 ? 'var(--color-border-subtle)' : over ? TU.hot : under ? TU.macroC : TU.accent;
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-[9px] font-bold tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{day.kcal || ''}</span>
                          <div style={{
                            width: '100%', height: h, background: barColor,
                            borderRadius: 6, opacity: day.meals === 0 ? 0.3 : (day.today ? 1 : 0.75),
                            border: day.today ? '2px solid var(--color-text-primary)' : 'none',
                          }} />
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* Day labels + per-day meal count — tap a day to see what was logged */}
                <div className="flex gap-1.5 mt-2">
                  {days.map((day, i) => {
                    const isExp = day.date === expandedDay;
                    const has = day.meals > 0;
                    return (
                      <button key={i} type="button" disabled={!has}
                        onClick={() => setExpandedDay(isExp ? null : day.date)}
                        className="flex-1 text-center rounded-[8px] py-1 active:scale-95 transition-transform focus:outline-none"
                        style={{ background: isExp ? `${TU.accent}16` : 'transparent', cursor: has ? 'pointer' : 'default' }}>
                        <div className="text-[10px] font-bold" style={{ color: day.today ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>{day.d}</div>
                        <div className="text-[9px] font-bold mt-0.5 tabular-nums" style={{ color: has ? TU.accent : 'var(--color-text-muted)', opacity: has ? 1 : 0.35 }}>
                          {has ? day.meals : '·'}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {!expanded && totalMeals > 0 && (
                  <div className="text-[10px] text-center mt-2.5" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.tapDayForMeals', 'Tap a day to see what you logged')}</div>
                )}
              </div>

              {/* Expanded day — the actual meals logged that day, by name */}
              {expanded && expanded.meals > 0 && (
                <div className="rounded-[18px] overflow-hidden mb-5" style={{ background: 'var(--color-bg-card)', border: `1px solid ${TU.accent}40` }}>
                  <div className="px-4 py-3.5">
                    <div className="flex items-baseline justify-between gap-2 mb-2.5">
                      <span className="text-[12.5px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                        {expanded.d} · {t('nutrition.mealsLogged', { count: expanded.meals, defaultValue: `${expanded.meals} meals logged` })}
                      </span>
                      <span className="text-[11px] font-bold flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{expanded.kcal} kcal</span>
                    </div>
                    <div>
                      {expanded.logs.map((log, i) => {
                        const name = (lang === 'es' && log.food_item?.name_es) ? log.food_item.name_es : (log.food_item?.name || log.custom_name || t('nutrition.foodFallback', 'Food'));
                        return (
                          <div key={i} className="flex items-center justify-between gap-2 py-2" style={{ borderTop: i > 0 ? '1px solid var(--color-border-subtle)' : 'none' }}>
                            <span className="text-[12.5px] truncate flex-1" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.1 }}>{name}</span>
                            <span className="text-[11px] font-semibold tabular-nums flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{log.calories} kcal</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Macro averages */}
              <div className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
                {t('nutrition.macroAverages', 'Macro averages')}
              </div>
              <div className="rounded-[18px] p-4 mb-5" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                {[
                  { label: t('nutrition.protein'), value: avgP, goal: proteinTarget, color: TU.macroP },
                  { label: t('nutrition.carbs'), value: avgC, goal: carbsTarget, color: TU.macroC },
                  { label: t('nutrition.fat'), value: avgF, goal: fatTarget, color: TU.macroF },
                ].map((m, i, arr) => (
                  <div key={m.label}>
                    <div className="flex items-baseline justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0 flex-shrink">
                        <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: m.color }} />
                        <span className="text-[13px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{m.label}</span>
                      </div>
                      <span className="flex-shrink-0 whitespace-nowrap" style={{ fontFamily: TU.display, fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                        {m.value}<span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}> / {t('nutrition.gAvg', { n: m.goal, defaultValue: '{{n}}g avg' })}</span>
                      </span>
                    </div>
                    <div className="rounded-full overflow-hidden" style={{ height: 5, background: 'var(--color-border-subtle)' }}>
                      <div style={{ width: `${Math.min(100, (m.value / m.goal) * 100)}%`, height: '100%', background: m.color, borderRadius: 999 }} />
                    </div>
                    {i < arr.length - 1 && <div className="my-3" style={{ height: 1, background: 'var(--color-border-subtle)' }} />}
                  </div>
                ))}
              </div>

              {/* Insight */}
              <div className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
                {t('nutrition.insight', 'Insight')}
              </div>
              <div className="flex items-start gap-3 p-3.5 rounded-[14px]" style={{ background: `${TU.coach}12`, border: `1px solid ${TU.coach}22` }}>
                <div className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.5)' }}>
                  <Sparkles size={15} style={{ color: TU.coach }} />
                </div>
                <div className="flex-1 text-[12px] leading-relaxed" style={{ color: 'var(--color-text-primary)' }}>
                  {avg > 0 ? (
                    <>{t('nutrition.youAveraged', 'You averaged')} <strong>{avg} kcal</strong> {Math.abs(avg - calTarget) / calTarget <= 0.1 ? t('nutrition.rightOnTarget', '\u2014 right on target.') : avg > calTarget ? t('nutrition.overTargetBy', { amount: avg - calTarget, defaultValue: '\u2014 {{amount}} over target.' }) : t('nutrition.underTargetBy', { amount: calTarget - avg, defaultValue: '\u2014 {{amount}} under target.' })} {adherence >= 70 ? t('nutrition.greatConsistency', 'Great consistency this week!') : t('nutrition.tryStayWithinGoal', 'Try to stay within 10% of your goal more days.')}</>
                  ) : (
                    <>{t('nutrition.noTrendData', 'Log more meals to see weekly insights.')}</>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const HomeView = ({ targets, todayTotals, todayLogs, savedIds, onSave, onOpenRecipe, onLogMeal, onOpenSearch, onDeleteLog, onOpenLog, setView, openEdit, embedded = false, userId, gymId, recentScans = [], onRepeatScan, scannedFavorites = [], onOpenFavorite, groceryList = [], onAddGroceryItems, onAddRecipeToGrocery }) => {
  const { t, i18n } = useTranslation('pages');
  const lang = i18n.language || 'en';

  const [showPlanner, setShowPlanner] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryData, setSummaryData] = useState(null);
  const [plannedDays, setPlannedDays] = useState(() => countPlannedDays(userId));
  const [compliancePct, setCompliancePct] = useState(0);
  const [workoutBurn, setWorkoutBurn] = useState(0);
  const [cardioBurn, setCardioBurn] = useState(0);
  const [logViewMode, setLogViewMode] = useState('list'); // 'list' | 'timeline'

  // Prefetch summary data on mount so modal opens instantly
  useEffect(() => {
    if (!userId) return;
    fetchSummaryWeekData(userId).then(setSummaryData);
  }, [userId, todayLogs]); // refetch when logs change

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
      onAddRecipeToGrocery={onAddRecipeToGrocery}
      groceryList={groceryList}
    />
  );

  return (
    <div className={embedded ? 'pb-4' : 'pb-28 md:pb-12'}>
      {/* Weekly Planner Overlay */}
      {showPlanner && embedded && createPortal(
        <div className="fixed inset-0 z-[60] overflow-y-auto" style={{ background: 'var(--color-bg-primary)' }}>
          {plannerOverlay}
        </div>,
        document.body
      )}
      {showPlanner && !embedded && plannerOverlay}

      {/* Header — only show on standalone page */}
      {!embedded && (
        <div className="px-5 pt-4 pb-3">
          <div style={{ fontFamily: TU.display, fontSize: 28, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -1, lineHeight: 1 }}>{t('nutrition.title')}</div>
          <div className="text-[13px] mt-1.5 font-medium" style={{ color: 'var(--color-text-muted)' }}>
            {format(new Date(), 'EEEE, MMM d', { locale: lang === 'es' ? esLocale : undefined })}
          </div>
        </div>
      )}

      {/* ── Action Buttons Row (3-col) ── */}
      <div className="grid grid-cols-3 gap-2 px-4 pt-1 pb-4">
        <button onClick={() => setShowPlanner(true)}
          className="flex items-center justify-center gap-1.5 py-3 rounded-[14px] text-[13px] font-bold active:scale-95 transition-all"
          style={{ background: TU.accent, color: 'var(--color-text-on-accent, #001512)', letterSpacing: -0.1 }}>
          <Calendar size={15} />
          {t('nutrition.myPlan', 'My Plan')}
        </button>
        <button onClick={openEdit}
          className="flex items-center justify-center gap-1.5 py-3 rounded-[14px] text-[13px] font-bold active:scale-95 transition-all"
          style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-subtle)', letterSpacing: -0.1 }}>
          <SlidersHorizontal size={15} style={{ color: 'var(--color-text-primary)' }} />
          {t('nutrition.goals', 'Goals')}
        </button>
        <button onClick={() => setShowSummary(s => !s)}
          className="flex items-center justify-center gap-1.5 py-3 rounded-[14px] text-[13px] font-bold active:scale-95 transition-all"
          style={{ background: showSummary ? `${TU.accent}12` : 'var(--color-bg-card)', color: showSummary ? TU.accent : 'var(--color-text-primary)', border: showSummary ? `1px solid ${TU.accent}30` : '1px solid var(--color-border-subtle)', letterSpacing: -0.1 }}>
          <BarChart2 size={15} style={{ color: showSummary ? TU.accent : 'var(--color-text-primary)' }} />
          {t('nutrition.summaryBtn', 'Summary')}
        </button>
      </div>

      {/* ── Sub-nav pills (Recipes / Saved / Grocery list) ── */}
      <div className="grid grid-cols-3 gap-2 px-4 pb-4">
        {[
          { view: 'discover', icon: UtensilsCrossed, label: t('nutrition.recipes', 'Recipes') },
          { view: 'saved',    icon: Heart,           label: t('nutrition.savedRecipes', 'Saved') },
          { view: 'grocery',  icon: ShoppingCart,     label: t('nutrition.groceryList', 'Grocery list') },
        ].map(c => (
          <button key={c.view} onClick={() => setView(c.view)}
            className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-full text-[12px] font-bold whitespace-nowrap active:scale-95 transition-all"
            style={{
              background: 'var(--color-bg-card)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border-subtle)',
              letterSpacing: -0.1,
            }}>
            <c.icon size={13} style={{ color: 'var(--color-text-muted)' }} strokeWidth={2.2} />
            {c.label}
          </button>
        ))}
      </div>

      {/* ── Trainer-assigned meal plan (renders nothing without one) ── */}
      <TrainerMealPlanSection userId={userId} groceryList={groceryList} onAddGroceryItems={onAddGroceryItems} />

      {/* ── Weekly Summary Modal ── */}
      {showSummary && createPortal(
        <SummarySheetModal
          userId={userId}
          targets={targets}
          onClose={() => setShowSummary(false)}
          t={t}
          lang={lang}
          prefetchedData={summaryData}
        />,
        document.body
      )}

      {/* ── Hero Card — Ring + Remaining + Macro Bars ── */}
      <div className="mx-4 mb-5 rounded-[22px] overflow-hidden"
        style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)' }}>
        <div className="p-5">
          {/* Top: ring + remaining/protein bar */}
          <div className="flex items-center gap-5">
            <MacroRing
              value={todayTotals.calories}
              max={calTarget}
              color={caloriesOver ? 'var(--color-danger)' : TU.accent}
              size={140}
              strokeWidth={11}
              hero
              sub={`${t('nutrition.of', 'of')} ${calTarget}`}
            />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
                {t('nutrition.remaining', 'Remaining')}
              </div>
              <div style={{ fontFamily: TU.display, fontSize: 36, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -1.5, lineHeight: 1, marginTop: 2 }}>
                {caloriesOver
                  ? <span style={{ color: 'var(--color-danger)' }}>+{Math.round(todayTotals.calories - calTarget)}</span>
                  : Math.round(caloriesLeft)
                }
              </div>
              <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {caloriesOver ? t('nutrition.overTarget', 'over target') : t('nutrition.kcalToGo', 'kcal to go')}
              </div>
              <div className="mt-3.5">
                <MacroBar label={t('nutrition.protein')} value={todayTotals.protein} max={adjustedProteinTarget} color={TU.macroP} t={t} />
              </div>
            </div>
          </div>
          {/* Bottom: carbs + fat bars */}
          <div className="flex gap-4 mt-4">
            <MacroBar label={t('nutrition.carbs')} value={todayTotals.carbs} max={adjustedCarbsTarget} color={TU.macroC} t={t} />
            <MacroBar label={t('nutrition.fat')} value={todayTotals.fat} max={adjustedFatTarget} color={TU.macroF} t={t} />
          </div>
        </div>

        {/* Log food CTA */}
        <div className="px-5 pb-5">
          <button onClick={onOpenSearch}
            className="w-full py-[14px] rounded-[16px] font-bold text-[14px] flex items-center justify-center gap-2 active:scale-[0.97] transition-all"
            style={{ background: 'var(--color-text-primary)', color: 'var(--color-bg-primary)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <Plus size={16} strokeWidth={2.5} />{t('nutrition.addFood')}
          </button>
        </div>
      </div>

      {/* ── Coach Suggestion ── */}
      {(() => {
        const calLeft = Math.max(0, calTarget - todayTotals.calories);
        const proteinLeft = Math.max(0, Math.round(adjustedProteinTarget - todayTotals.protein));
        const pct = todayTotals.calories / Math.max(calTarget, 1);
        // Pick a contextual suggestion
        let title, hint;
        if (pct >= 1) {
          title = t('nutrition.coachOverTarget', "You've hit your calorie target");
          hint = t('nutrition.coachOverHint', 'Consider a lighter dinner or skip the snack.');
        } else if (pct >= 0.75) {
          title = t('nutrition.coachAlmostThere', 'Almost there — stay on track');
          hint = t('nutrition.coachAlmostHint', { cal: Math.round(calLeft), defaultValue: `${Math.round(calLeft)} kcal left. A light meal will close the gap.` });
        } else if (todayLogs.length === 0) {
          title = t('nutrition.coachStartDay', 'Start logging meals');
          hint = t('nutrition.coachStartHint', 'Scan a photo or search to log breakfast.');
        } else {
          title = t('nutrition.coachKeepGoing', 'Keep going — you\'re on pace');
          hint = t('nutrition.coachKeepHint', { protein: proteinLeft, cal: Math.round(calLeft), defaultValue: `${proteinLeft}g protein and ${Math.round(calLeft)} kcal remaining.` });
        }
        return (
          <div className="mx-4 mb-4">
            <div className="flex items-center gap-3 p-3.5 rounded-[18px]"
              style={{ background: 'var(--color-bg-card)', border: `1px solid ${TU.coach}22` }}>
              <div className="w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0"
                style={{ background: `${TU.coach}15` }}>
                <Sparkles size={18} style={{ color: TU.coach }} />
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontFamily: TU.display, fontSize: 15, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.2, marginBottom: 2 }}>
                  {title}
                </div>
                <div className="text-[12px]" style={{ color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                  {hint}
                </div>
              </div>
              <button onClick={onOpenSearch} className="px-3 py-2 rounded-full text-[12px] font-bold text-white flex-shrink-0"
                style={{ background: TU.coach }}>
                {t('nutrition.view', 'View')}
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Quick Stats: Water + Burned ── */}
      {(workoutBurn > 0 || cardioBurn > 0) && (
        <div className="mx-4 mb-5 grid grid-cols-2 gap-3">
          {/* Burned card */}
          <div className="rounded-[18px] p-3.5" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
            <div className="flex items-center gap-2 mb-2.5">
              <Flame size={15} style={{ color: TU.hot }} fill={TU.hot} />
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
                {t('nutrition.caloriesBurned', 'Calories burned')}
              </span>
            </div>
            <div className="flex items-baseline gap-1">
              <span style={{ fontFamily: TU.display, fontSize: 26, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -1 }}>
                {workoutBurn + cardioBurn}
              </span>
              <span className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>kcal</span>
            </div>
            <div className="text-[12px] mt-2.5" style={{ color: 'var(--color-text-muted)' }}>
              {workoutBurn > 0 && <span>{t('nutrition.fromWorkout', 'Workout')}: <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>{workoutBurn}</span></span>}
              {workoutBurn > 0 && cardioBurn > 0 && ' · '}
              {cardioBurn > 0 && <span>{t('nutrition.fromCardio', 'Cardio')}: <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>{cardioBurn}</span></span>}
            </div>
          </div>
          {/* Macro split card */}
          <div className="rounded-[18px] p-3.5" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
            <div className="flex items-center gap-2 mb-2.5">
              <Zap size={15} style={{ color: TU.accent }} />
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
                {t('nutrition.macroSplit', 'Macro Split')}
              </span>
            </div>
            <MacroSegBar p={todayTotals.protein} c={todayTotals.carbs} f={todayTotals.fat} height={8} />
            <div className="flex justify-between mt-2.5 text-[10px] font-semibold">
              <span style={{ color: TU.macroP }}>{Math.round(todayTotals.protein)}P</span>
              <span style={{ color: TU.macroC }}>{Math.round(todayTotals.carbs)}C</span>
              <span style={{ color: TU.macroF }}>{Math.round(todayTotals.fat)}F</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Sugerencia del Día — always visible ── */}
      <DailySuggestion
        targets={targets}
        todayTotals={todayTotals}
        onOpenRecipe={onOpenRecipe}
        onLogMeal={onLogMeal}
        lang={lang}
        t={t}
        userId={userId}
        gymId={gymId}
        workoutBurn={totalBurn}
      />

      {/* ── Recently scanned (horizontal scroll) ── */}
      {recentScans.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center justify-between px-4 mb-2.5">
            <div style={{ fontFamily: TU.display, fontSize: 15, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>
              {t('nutrition.recentlyScanned', 'Recently scanned')}
            </div>
            <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
              {recentScans.length}
            </span>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-1 px-4 no-scrollbar" style={{ scrollSnapType: 'x proximity' }}>
            {recentScans.map((r, i) => {
              // Prefer the actual stored image (AI photo / barcode product image)
              // BEFORE the name-based fallback — getFoodImage can match a generic
              // image of a similarly named food and show the wrong picture.
              const recentImg = foodImageUrl(r.image_url) || r.image_url || getFoodImage(r.name, r.brand) || recipeImageByName(r.name);
              return (
              <button
                key={`${r.name}_${i}`}
                onClick={() => onRepeatScan?.(r)}
                className="flex-shrink-0 flex flex-col items-start gap-2 rounded-[16px] p-2.5 active:scale-[0.97] transition-transform"
                style={{
                  width: 150,
                  background: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border-subtle)',
                  boxShadow: '0 2px 6px rgba(60,40,10,0.06)',
                  scrollSnapAlign: 'start',
                  textAlign: 'left',
                }}>
                {recentImg ? (
                  <img src={recentImg} alt={r.name}
                    className="w-full h-[70px] rounded-[10px] object-cover"
                    style={{ background: 'var(--color-border-subtle)' }} loading="lazy" />
                ) : (
                  <div className="w-full h-[70px] rounded-[10px] flex items-center justify-center"
                    style={{
                      background: `linear-gradient(135deg, ${TILE_PALETTES[i % TILE_PALETTES.length][0]} 0%, ${TILE_PALETTES[i % TILE_PALETTES.length][1]} 100%)`,
                      color: 'rgba(255,255,255,0.95)',
                      fontFamily: TU.display, fontSize: 28, fontWeight: 700,
                    }}>
                    {(r.name || '?').trim()[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <div className="w-full min-w-0">
                  <div className="text-[12px] font-bold truncate" style={{ color: 'var(--color-text-primary)', fontFamily: TU.display, letterSpacing: -0.2 }}>{r.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-bold tabular-nums">
                    <span style={{ color: 'var(--color-text-primary)' }}>{Math.round(r.calories)} cal</span>
                    <span style={{ color: TU.macroP }}>{Math.round(r.protein_g || 0)}P</span>
                    <span style={{ color: TU.macroC }}>{Math.round(r.carbs_g || 0)}C</span>
                    <span style={{ color: TU.macroF }}>{Math.round(r.fat_g || 0)}F</span>
                  </div>
                </div>
              </button>
              );
            })}
          </div>
        </div>
      )}

      {/* The "Saved foods" carousel was removed from the Home view to avoid
          duplication with the dedicated Saved page (single source of truth).
          Saved foods are still accessible via the Saved nav tab. */}

      {/* ── Today's Meals ── */}
      <div className="mb-8 px-4">
        <div className="flex items-center justify-between mb-4">
          <div style={{ fontFamily: TU.display, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>{t('nutrition.todaysMeals')}</div>
        </div>

        {/* ── Timeline View ── */}
        {logViewMode === 'timeline' && todayLogs.length > 0 ? (
          <div className="space-y-0">
            {[...todayLogs].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map((log, i, arr) => {
              const time = new Date(log.created_at);
              const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const mt = MEAL_TYPES.find(m => m.key === log.meal_type) || MEAL_TYPES[3];
              const Icon = mt.icon;
              const logImg = log.photo_url || getFoodImage(log.food_item?.name, log.food_item?.brand) || foodImageUrl(log.food_item?.image_url) || recipeImageByName(log.custom_name || log.food_item?.name);
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
                      className="w-full flex items-center gap-3 p-3 rounded-[18px] text-left transition-all active:scale-[0.975]"
                      style={{
                        background: 'var(--color-bg-card)',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
                      }}>
                      {logImg ? (
                        <img src={logImg} alt="" className="w-[48px] h-[48px] rounded-[14px] object-cover flex-shrink-0" style={{ background: 'var(--color-border-subtle)' }} loading="lazy" />
                      ) : (
                        <FoodTile name={(lang === 'es' && log.food_item?.name_es) ? log.food_item.name_es : (log.food_item?.name || log.custom_name || 'F')} size={48} seed={i} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[10px] font-bold uppercase" style={{ color: mt.color }}>{t(mt.labelKey)}</span>
                        </div>
                        <p className="text-[14px] font-bold truncate mb-1" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>
                          {(lang === 'es' && log.food_item?.name_es) ? log.food_item.name_es : (log.food_item?.name || log.custom_name || t('nutrition.foodFallback', 'Food'))}
                        </p>
                        <MacroSegBar p={log.protein_g || 0} c={log.carbs_g || 0} f={log.fat_g || 0} height={4} />
                        <div className="flex items-center gap-2.5 mt-1.5 text-[11px] font-bold" style={{ fontFamily: TU.display }}>
                          <span style={{ color: TU.macroP }}>{Math.round(log.protein_g || 0)}P</span>
                          <span style={{ color: TU.macroC }}>{Math.round(log.carbs_g || 0)}C</span>
                          <span style={{ color: TU.macroF }}>{Math.round(log.fat_g || 0)}F</span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-1">
                        <div style={{ fontFamily: TU.display, fontSize: 17, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5, lineHeight: 1 }}>{log.calories ?? 0}</div>
                        <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>kcal</div>
                      </div>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
        /* ── Default List View (flat, no meal-type grouping) ── */
        <div className="space-y-2.5">
          {todayLogs.length === 0 ? (
            <button onClick={onOpenSearch}
              className="w-full py-3.5 rounded-[16px] text-[14px] font-bold transition-all active:scale-[0.97] flex items-center justify-center gap-2"
              style={{ background: TU.accent, color: 'var(--color-text-on-accent, #fff)', boxShadow: '0 2px 12px rgba(0,0,0,0.14)' }}>
              <Plus size={17} strokeWidth={2.6} style={{ color: 'var(--color-text-on-accent, #fff)' }} />
              {t('nutrition.startLogging', 'Start logging meals')}
            </button>
          ) : todayLogs.slice(0, 10).map((log, li) => {
            const mt = MEAL_TYPES.find(m => m.key === log.meal_type) || MEAL_TYPES[3];
            const logImg = log.photo_url || getFoodImage(log.food_item?.name, log.food_item?.brand) || foodImageUrl(log.food_item?.image_url) || recipeImageByName(log.custom_name || log.food_item?.name);
            const logName = (lang === 'es' && log.food_item?.name_es) ? log.food_item.name_es : (log.food_item?.name || log.custom_name || t('nutrition.foodFallback', 'Food'));
            const logTime = new Date(log.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            return (
              <button key={log.id} onClick={() => onOpenLog(log)}
                className="w-full flex items-center gap-3 p-3 rounded-[18px] text-left transition-all active:scale-[0.975]"
                style={{
                  background: 'var(--color-bg-card)',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
                }}>
                {logImg ? (
                  <img src={logImg} alt="" className="w-[48px] h-[48px] rounded-[14px] object-cover flex-shrink-0" style={{ background: 'var(--color-border-subtle)' }} loading="lazy" />
                ) : (
                  <FoodTile name={logName} size={48} seed={log.id?.charCodeAt?.(0) || li} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: mt.color, letterSpacing: '0.05em' }}>{t(mt.labelKey)}</span>
                    <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{'\u00B7'} {logTime}</span>
                  </div>
                  <p className="text-[14px] font-bold truncate leading-snug mb-1" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>{logName}</p>
                  <MacroSegBar p={log.protein_g || 0} c={log.carbs_g || 0} f={log.fat_g || 0} height={4} />
                  <div className="flex items-center gap-2.5 mt-1.5 text-[11px] font-bold" style={{ fontFamily: TU.display }}>
                    <span style={{ color: TU.macroP }}>{Math.round(log.protein_g || 0)}P</span>
                    <span style={{ color: TU.macroC }}>{Math.round(log.carbs_g || 0)}C</span>
                    <span style={{ color: TU.macroF }}>{Math.round(log.fat_g || 0)}F</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-1">
                  <div style={{ fontFamily: TU.display, fontSize: 17, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5, lineHeight: 1 }}>{log.calories ?? 0}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>kcal</div>
                </div>
              </button>
            );
          })}
        </div>
        )}
      </div>

      {/* Quick actions moved to sub-nav pills at top */}
    </div>
  );
};

// Relative "last opened" label for the Recent list. Bare ES/EN strings (no
// t()) — matches how mealTitle picks language inline. Returns null when there's
// no timestamp (legacy entries / brand-new-member suggestions).
function relOpenedLabel(ts, lang) {
  if (!ts) return null;
  const day = 86400000;
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const d1 = new Date(ts); d1.setHours(0, 0, 0, 0);
  const diff = Math.round((d0.getTime() - d1.getTime()) / day);
  const es = lang === 'es';
  if (diff <= 0) return es ? 'Hoy' : 'Today';
  if (diff === 1) return es ? 'Ayer' : 'Yesterday';
  if (diff < 7) return es ? `hace ${diff} d` : `${diff}d ago`;
  try { return new Date(ts).toLocaleDateString(es ? 'es' : 'en', { month: 'short', day: 'numeric' }); }
  catch { return null; }
}

// ── DISCOVER VIEW ───────────────────────────────────────────
const DiscoverView = ({ setView, savedIds, onSave, onOpenRecipe, onOpenCollection, targets }) => {
  // Live recipe library — category counts + grids follow DB hydration (no rebuild).
  const RECIPES = useMeals();
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
  const [macrosSeed, setMacrosSeed] = useState(0); // manual "regenerate" offset for Fits-your-macros
  const [showAllRecent, setShowAllRecent] = useState(false); // Recent "See all" toggle
  const [visibleCount, setVisibleCount] = useState(30); // results grid: how many cards shown (Load more raises it)
  const [recentTick, setRecentTick] = useState(0); // bump to re-read the recents cache

  // Track the recipes the member actually opens (persisted, deduped, newest-first)
  // so "Recent" reflects real activity instead of a frozen slice — and "See all"
  // has something to expand.
  const RECENT_KEY = 'nutrition.recentRecipes';
  const openRecipe = (r) => {
    if (r?.id) {
      try {
        // Back-compat: older entries were bare ids; normalize to {id, ts} so we
        // can show *when* each recipe was last opened.
        const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
        const prev = raw
          .map(x => (typeof x === 'string' ? { id: x, ts: 0 } : x))
          .filter(x => x && x.id !== r.id);
        prev.unshift({ id: r.id, ts: Date.now() });
        localStorage.setItem(RECENT_KEY, JSON.stringify(prev.slice(0, 30)));
      } catch { /* quota/parse — ignore */ }
      setRecentTick(t => t + 1);
    }
    onOpenRecipe(r);
  };

  // Close the results sub-view first — makes a category feel like a PAGE you back
  // out of, not a filter that leaves you stuck (device back used to exit Meals).
  const closeResults = () => { setShowResults(false); setActiveFilter('all'); setSelectedIngredients([]); };
  useEffect(() => {
    if (!showResults) return;
    const onBack = (e) => { e.preventDefault(); closeResults(); };
    window.addEventListener('app:hardwareback', onBack);
    return () => window.removeEventListener('app:hardwareback', onBack);
  }, [showResults]);

  // Lock body scroll when recipe filter modal is open
  useEffect(() => {
    if (showRecipeFilters) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showRecipeFilters]);

  // A new search (different ingredients / filter) starts the grid back at 30.
  useEffect(() => { setVisibleCount(30); }, [selectedIngredients, activeFilter]);

  const toggleIngredient = (id) => {
    // Results show the moment you pick an ingredient — no separate "Find Recipes"
    // button. Deselecting the last one drops back to browse.
    setSelectedIngredients(prev => {
      const next = prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id];
      setShowResults(next.length > 0);
      return next;
    });
  };

  const allIngredients = Object.values(INGREDIENT_CATEGORIES || {}).flat();
  const filteredForQuery = ingredientQuery.length > 0
    ? allIngredients.filter(i => {
        const translatedLabel = t(`nutrition_ingredients.items.${i.id}`, i.label);
        return i.label.toLowerCase().includes(ingredientQuery.toLowerCase()) || translatedLabel.toLowerCase().includes(ingredientQuery.toLowerCase());
      })
    : (INGREDIENT_CATEGORIES[activeCategory] || []);

  const matchedRecipes = useMemo(() => {
    // No ingredients picked → category-only browse (every recipe in that category, no missing-ingredient state)
    if (selectedIngredients.length === 0) {
      if (activeFilter === 'all') return [];
      return (RECIPES || [])
        .filter(recipe => recipe?.ingredients && recipe.category === activeFilter)
        .map(recipe => ({ ...recipe, matchCount: 0, missing: 0 }));
    }
    // The chips are generic (`salmon`, `lean_beef`) but recipes store specific
    // tokens (`salmon_fillet`, `lean_beef_strips`), so exact-equality matched
    // almost nothing — picking Salmon surfaced random recipes that merely shared
    // one other chip. Match on whole-word token SUBSET instead (singular/plural
    // tolerant): a chip matches an ingredient when all of the chip's tokens appear
    // in that ingredient's tokens.
    const norm = (tok) => String(tok).toLowerCase().replace(/s$/, '');
    const ingMatches = (chipId, recipeIng) => {
      const rt = String(recipeIng).split('_').map(norm);
      return String(chipId).split('_').map(norm).every(tok => rt.includes(tok));
    };
    return (RECIPES || [])
      .filter(recipe => {
        if (!recipe?.ingredients) return false;
        if (activeFilter !== 'all' && recipe.category !== activeFilter) return false;
        return true;
      })
      .map(recipe => {
        // matchCount = how many of the user's picks this recipe actually uses;
        // missing = how many of the recipe's ingredients the user still needs.
        const matchCount = selectedIngredients.filter(sel =>
          recipe.ingredients.some(ing => ingMatches(sel, ing))
        ).length;
        const missing = recipe.ingredients.filter(ing =>
          !selectedIngredients.some(sel => ingMatches(sel, ing))
        ).length;
        return { ...recipe, matchCount, missing };
      })
      .filter(recipe => recipe.matchCount > 0)
      // Most of the user's ingredients first, then fewest still-needed.
      .sort((a, b) => (b.matchCount - a.matchCount) || (a.missing - b.missing));
  }, [selectedIngredients, activeFilter, RECIPES]);

  // "Fits your macros" — scored against the user's ACTUAL per-meal targets
  // (not just raw protein density), then a 6-item window rotated by the week so
  // it's varied instead of showing the same six every single day.
  const fitsYourMacros = useMemo(() => {
    const mealCal = (targets?.daily_calories || 2000) / 3;
    const mealPro = (targets?.daily_protein_g || 150) / 3;
    const pool = (RECIPES || [])
      .filter(r => r?.ingredients && (r.protein || 0) >= 20)
      .map(r => {
        const calGap = Math.abs((r.calories || 0) - mealCal) / Math.max(mealCal, 1);
        const proGap = Math.abs((r.protein || 0) - mealPro) / Math.max(mealPro, 1);
        const density = (r.protein || 0) / Math.max(r.calories || 1, 1);
        return { r, score: density - 0.4 * calGap - 0.3 * proGap };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map(x => x.r);
    if (pool.length <= 6) return pool;
    // weekly rotation + a manual "regenerate" offset so tapping the button reshuffles.
    const start = ((weekIndex() + macrosSeed) * 6) % pool.length;
    return Array.from({ length: 6 }, (_, i) => pool[(start + i) % pool.length]);
  }, [RECIPES, targets, macrosSeed]);

  // Recently-opened recipes (persisted, newest-first). Falls back to a few
  // suggestions for a brand-new member who hasn't opened anything yet.
  const recentRecipes = useMemo(() => {
    let raw = [];
    try { raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { raw = []; }
    const entries = raw.map(x => (typeof x === 'string' ? { id: x, ts: 0 } : x)).filter(x => x && x.id);
    const byId = new Map((RECIPES || []).map(r => [r.id, r]));
    const list = entries.map(e => { const r = byId.get(e.id); return r ? { ...r, _openedAt: e.ts } : null; }).filter(Boolean);
    return list.length ? list : (RECIPES || []).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [RECIPES, recentTick]);

  return (
    <div className="pb-28 md:pb-12" >
      {/* Header — "Meals" */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button onClick={() => { if (showResults) closeResults(); else setView('home'); }} className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 focus:outline-none"
            style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }} aria-label={t('common.back', 'Go back')}>
            <ChevronLeft size={18} style={{ color: 'var(--color-text-muted)' }} />
          </button>
          <div>
            <div style={{ fontFamily: TU.display, fontSize: 28, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -1, lineHeight: 1 }}>
              {showResults && activeFilter !== 'all'
                ? t(`nutrition.categories.${activeFilter}`, DISCOVER_FILTERS.find(f => f.id === activeFilter)?.label || 'Meals')
                : t('nutrition.meals.title', 'Meals')}
            </div>
            <div className="text-[13px] mt-1.5 font-medium" style={{ color: 'var(--color-text-muted)' }}>
              {showResults && activeFilter !== 'all'
                ? `${matchedRecipes.length} ${t('nutrition.recipesPlural', 'recipes')}`
                : format(new Date(), 'EEEE, MMM d', { locale: lang === 'es' ? esLocale : undefined })}
            </div>
          </div>
        </div>
        {!showResults && (
          <button onClick={() => setView('saved')}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-bold active:scale-95 transition-transform flex-shrink-0"
            style={{ background: TU.accent, color: 'var(--color-text-on-accent)', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
            <UtensilsCrossed size={15} style={{ color: 'var(--color-text-on-accent)' }} />
            {t('nutrition.myMeals', 'My meals')}
          </button>
        )}
      </div>

      {/* Search bar */}
      <div className="px-5 mb-4">
        <div className="flex items-center gap-2.5 rounded-[14px] px-3.5 py-3"
          style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
          <Search size={18} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          <input type="text" value={ingredientQuery}
            onChange={e => { setIngredientQuery(e.target.value); }}
            placeholder={t('nutrition.searchFoodsRecipes', 'Search foods, recipes\u2026')}
            aria-label={t('nutrition.searchFoodsRecipes', 'Search foods, recipes')}
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-[var(--color-text-muted)]"
            style={{ color: 'var(--color-text-primary)' }} />
          <button onClick={() => setShowRecipeFilters(true)} className="flex-shrink-0" aria-label={t('nutrition.filterRecipes', 'Filter recipes')}>
            <SlidersHorizontal size={18} style={{ color: TU.accent }} />
          </button>
        </div>
      </div>

      {/* Ingredient chips — ONE row, tap to toggle (activate / deactivate).
          Selected show filled + check; matches while typing show as outlined
          pills. Each ingredient appears once — no separate X-list. */}
      {(selectedIngredients.length > 0 || ingredientQuery.length > 0) && (
        <div className="px-5 mb-5">
          <div className="flex flex-wrap gap-2">
            {selectedIngredients.map(id => {
              const item = allIngredients.find(i => i.id === id);
              if (!item) return null;
              return (
                <button key={id} onClick={() => toggleIngredient(id)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full text-[14px] font-bold active:scale-95 transition-all"
                  style={{ background: `color-mix(in srgb, ${TU.accent} 14%, transparent)`, color: TU.accent, border: `1px solid ${TU.accent}` }}>
                  <Check size={13} strokeWidth={3} style={{ color: TU.accent }} />
                  {t(`nutrition_ingredients.items.${item.id}`, item.label)}
                </button>
              );
            })}
            {ingredientQuery.length > 0 && filteredForQuery
              .filter(item => !selectedIngredients.includes(item.id))
              .map(item => (
                <button key={item.id} onClick={() => toggleIngredient(item.id)}
                  className="px-3.5 py-2 rounded-full text-[14px] font-semibold active:scale-95 transition-all"
                  style={{ border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                  {t(`nutrition_ingredients.items.${item.id}`, item.label)}
                </button>
              ))}
            {ingredientQuery.length > 0 && selectedIngredients.length === 0 && filteredForQuery.length === 0 && (
              <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.noIngredientsMatch', 'No ingredients match')} &ldquo;{ingredientQuery}&rdquo;</p>
            )}
          </div>
        </div>
      )}

      {/* Recipe Filter Bottom Sheet (portaled) */}
      {showRecipeFilters && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
          onClick={e => e.target === e.currentTarget && setShowRecipeFilters(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-[520px] rounded-[24px] pb-6 pt-5 animate-fade-in max-h-[85vh] flex flex-col"
            style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-default)', boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }}
          >
            <div className="px-6 overflow-y-auto flex-1 scrollbar-none">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-[17px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.filtersAndIngredients', 'Filters & Ingredients')}</h3>
                <button onClick={() => { setActiveFilter('all'); setSelectedIngredients([]); setActiveCategory('Proteins'); }}
                  className="text-[13px] font-medium active:opacity-70" style={{ color: TU.accent }}>
                  {t('nutrition.resetAll', 'Reset all')}
                </button>
              </div>
              <div className="mb-6">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] mb-3" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.recipeType', 'Recipe Type')}</p>
                <div className="flex flex-wrap gap-2">
                  {DISCOVER_FILTERS.map(f => {
                    const active = activeFilter === f.id;
                    return (
                      <button key={f.id} onClick={() => setActiveFilter(f.id)}
                        className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-[10px] transition-all active:scale-95"
                        style={{
                          background: active ? 'var(--color-accent)' : 'var(--color-surface-hover)',
                          color: active ? 'var(--color-text-on-accent, #000)' : 'var(--color-text-muted)',
                          border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                          fontWeight: active ? 700 : 500,
                        }}>
                        {t(`nutrition_ingredients.discoverFilters.${f.id}`, f.label)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mb-4">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] mb-3" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.ingredients')}</p>
                <div className="flex gap-2 overflow-x-auto scrollbar-none mb-4">
                  {Object.keys(INGREDIENT_CATEGORIES || {}).map(cat => (
                    <button key={cat} onClick={() => setActiveCategory(cat)}
                      className="px-3.5 py-[7px] rounded-[10px] text-[12.5px] font-medium flex-shrink-0 transition-all active:scale-95"
                      style={{
                        background: activeCategory === cat ? 'var(--color-accent)' : 'var(--color-surface-hover)',
                        color: activeCategory === cat ? 'var(--color-text-on-accent, #000)' : 'var(--color-text-muted)',
                        border: `1px solid ${activeCategory === cat ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                        fontWeight: activeCategory === cat ? 700 : 500,
                      }}>
                      {t(`nutrition_ingredients.categoryNames.${cat.toLowerCase()}`, cat)}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(INGREDIENT_CATEGORIES[activeCategory] || []).map(item => {
                    const selected = selectedIngredients.includes(item.id);
                    return (
                      <button key={item.id} onClick={() => toggleIngredient(item.id)}
                        className="flex items-center gap-2 px-3 py-2 rounded-[10px] border transition-all text-[12px] font-medium active:scale-95"
                        style={{
                          background: selected ? `${TU.accent}15` : 'var(--color-surface-hover)',
                          border: `1px solid ${selected ? `${TU.accent}40` : 'var(--color-border-subtle)'}`,
                          color: selected ? TU.accent : 'var(--color-text-muted)',
                          fontWeight: selected ? 600 : 500,
                        }}>
                        {t(`nutrition_ingredients.items.${item.id}`, item.label)}
                        {selected && <Check size={10} />}
                      </button>
                    );
                  })}
                </div>
              </div>
              {selectedIngredients.length > 0 && (
                <p className="text-[11px] font-medium mb-2" style={{ color: TU.accent }}>
                  {selectedIngredients.length} {selectedIngredients.length !== 1 ? t('nutrition.ingredientsPlural', 'ingredients') : t('nutrition.ingredientSingular', 'ingredient')} {t('nutrition.selected', 'selected')}
                </p>
              )}
            </div>
            <div className="px-6 pt-4 flex-shrink-0">
              <button onClick={() => { setShowRecipeFilters(false); if (selectedIngredients.length > 0) setShowResults(true); }}
                className="w-full py-3.5 rounded-xl font-bold text-[14px] active:scale-[0.98] transition-all"
                style={{ background: 'var(--color-text-primary)', color: 'var(--color-bg-primary)' }}>
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
        <div className="px-5 mb-6">
          <div className="flex items-center justify-between gap-2 mb-4">
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
              {matchedRecipes.length} {matchedRecipes.length !== 1 ? t('nutrition.recipesPlural', 'recipes') : t('nutrition.recipeSingular', 'recipe')} {t('nutrition.found', 'found')}
            </p>
          </div>
          {matchedRecipes.length === 0 ? (
            <div className="rounded-[22px] p-6 text-center" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
              <p className="text-[14px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.noMatchesYet', 'No matches yet')}</p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.tryAddingMore', 'Try adding more ingredients or changing the filter.')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {matchedRecipes.slice(0, visibleCount).map(recipe => {
                const ingredientMatchActive = selectedIngredients.length > 0;
                const canMake = ingredientMatchActive && recipe.missing === 0;
                const recipeImg = recipe.image || mealImageById(recipe.id);
                const gMatch = goalMatchPct(recipe, targets);
                return (
                  <button key={recipe.id} onClick={() => openRecipe(recipe)}
                    className="text-left rounded-[22px] overflow-hidden active:scale-[0.98] transition-all"
                    style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
                    {/* Square image: goal-match % (left) + ingredient status (right) */}
                    <div className="relative w-full" style={{ aspectRatio: '1 / 1', background: 'var(--color-border-subtle)' }}>
                      <img src={(foodImageUrl(recipeImg) || MEAL_IMG_FALLBACK)} onError={handleMealImgError} alt={mealTitle(recipe)} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                      {gMatch != null && (
                        <div className="absolute top-2 left-2">
                          <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{
                            background: gMatch >= 80 ? TU.accent : gMatch >= 60 ? '#F59E0B' : 'rgba(0,0,0,0.6)', color: '#fff', backdropFilter: 'blur(6px)', letterSpacing: 0.1,
                          }}>
                            {gMatch}% {t('nutrition.goalMatch', 'match')}
                          </span>
                        </div>
                      )}
                      {ingredientMatchActive && (
                        <div className="absolute top-2 right-2">
                          <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{
                            background: canMake ? TU.accent : '#F59E0B', color: '#fff', backdropFilter: 'blur(6px)', letterSpacing: 0.1,
                          }}>
                            {canMake ? t('nutrition.ready', 'Ready') : t('nutrition.needsMore', 'Needs {{n}} more', { n: recipe.missing })}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <div className="text-[14px] font-bold truncate" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{mealTitle(recipe)}</div>
                      <div className="mt-2"><MacroSegBar p={recipe.protein} c={recipe.carbs} f={recipe.fat} height={6} /></div>
                      <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] font-bold tabular-nums" style={{ letterSpacing: -0.2 }}>
                        <span style={{ color: 'var(--color-text-primary)' }}>{Math.round(recipe.calories)} cal</span>
                        <span style={{ color: 'var(--color-text-muted)' }}>·</span>
                        <span style={{ color: TU.macroP }}>{Math.round(recipe.protein)}P</span>
                        <span style={{ color: TU.macroC }}>{Math.round(recipe.carbs)}C</span>
                        <span style={{ color: TU.macroF }}>{Math.round(recipe.fat)}F</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {matchedRecipes.length > visibleCount && (
            <button onClick={() => setVisibleCount(c => c + 30)}
              className="w-full mt-4 py-3 rounded-2xl font-bold text-[13px] active:scale-[0.98] transition-all"
              style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-subtle)' }}>
              {t('nutrition.loadMore', 'Load more')} ({matchedRecipes.length - visibleCount})
            </button>
          )}
        </div>
      )}

      {/* ── Fits your macros ── */}
      {!showResults && (
        <>
          <div className="px-5 pt-2 pb-2 flex items-start justify-between gap-3">
            <div>
              <div style={{ fontFamily: TU.display, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>
                {t('nutrition.fitsYourMacros', 'Fits your macros')}
              </div>
              <div className="text-[12px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {t('nutrition.basedOnRemaining', 'Based on your remaining macros')}
              </div>
            </div>
            <button onClick={() => setMacrosSeed(s => s + 1)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-bold active:scale-95 transition-transform flex-shrink-0 mt-0.5"
              style={{ background: TU.accent, color: 'var(--color-text-on-accent)', letterSpacing: 0.2, boxShadow: '0 2px 8px rgba(0,0,0,0.14)' }}
              aria-label={t('nutrition.regenerate', 'Regenerate')}>
              <RefreshCw size={13} style={{ color: 'var(--color-text-on-accent)' }} />
              {t('nutrition.regenerate', 'Regenerate')}
            </button>
          </div>

          <div className="flex gap-3 overflow-x-auto scroll-smooth px-5 pb-2 scrollbar-none">
            {fitsYourMacros.map((s, si) => {
              const gradients = [['#FFB86B','#FF7A3D'],['#7FE3C4','#2EC4C4'],['#D0C6FF','#8B7DFF'],['#FFD166','#F2A23A'],['#B8E8A8','#5EAA5E'],['#C8D8FF','#6B8FE8']];
              const [ga, gb] = gradients[si % gradients.length];
              const matchPct = Math.min(99, Math.round(70 + (s.protein / Math.max(s.calories, 1)) * 200));
              return (
                <button key={s.id} onClick={() => openRecipe(s)}
                  className="flex-shrink-0 rounded-[20px] overflow-hidden text-left"
                  style={{ width: 200, background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
                  <div className="relative" style={{ height: 110, background: `linear-gradient(135deg, ${ga} 0%, ${gb} 100%)` }}>
                    {s.image && <img src={foodImageUrl(s.image)} onError={handleMealImgError} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />}
                    {/* White chips → fixed dark content (theme text var is
                        white in dark mode → was white-on-white). */}
                    <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1"
                      style={{ background: 'rgba(255,255,255,0.92)', color: '#1f2937' }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#2ECC71]" />
                      {t('nutrition.macroMatch', { defaultValue: '{{pct}}% match', pct: matchPct })}
                    </div>
                    <div className="absolute bottom-2.5 right-2.5 w-[30px] h-[30px] rounded-full flex items-center justify-center"
                      style={{ background: 'rgba(255,255,255,0.95)' }}>
                      <Plus size={16} style={{ color: '#1f2937' }} strokeWidth={2.4} />
                    </div>
                  </div>
                  <div className="p-3.5">
                    <div className="text-[13px] font-bold mb-1.5 truncate" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>
                      {mealTitle(s)}
                    </div>
                    <div className="mb-2" style={{ fontFamily: TU.display, fontSize: 16, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>
                      {s.calories}<span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}> kcal</span>
                    </div>
                    <MacroSegBar p={s.protein} c={s.carbs} f={s.fat} height={4} />
                    <div className="flex justify-between mt-1.5 text-[10px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                      <span style={{ color: TU.macroP }}>{s.protein}P</span>
                      <span style={{ color: TU.macroC }}>{s.carbs}C</span>
                      <span style={{ color: TU.macroF }}>{s.fat}F</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ── Browse ── */}
      {!showResults && (
        <div className="mt-5 mb-2">
          <div className="px-5 mb-3" style={{ fontFamily: TU.display, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>
            {t('nutrition.browse', 'Browse')}
          </div>
          {/* Category grid (2x2 with food tiles) — all 8 categories */}
          <div className="px-4 mb-6 grid grid-cols-2 gap-2.5">
            {CATEGORIES.map((cat, ci) => {
              const count = (RECIPES || []).filter(r => r?.category === cat.id).length;
              return (
                <button key={cat.id} onClick={() => { setActiveFilter(cat.id); setShowRecipeFilters(false); setShowResults(true); }}
                  className="flex items-center gap-3 p-3.5 rounded-[18px] text-left active:scale-[0.97] transition-all"
                  style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
                  {/* Dedicated per-section image at /categories/<id>.jpg (upload to
                      food-images/categories/). Branded placeholder until it exists. */}
                  <img src={(foodImageUrl(`/categories/${cat.id}.jpg`) || MEAL_IMG_FALLBACK)} onError={handleMealImgError} alt={cat.label} className="w-11 h-11 rounded-[12px] object-cover flex-shrink-0" style={{ background: 'var(--color-border-subtle)' }} loading="lazy" />
                  <div className="min-w-0">
                    <div style={{ fontFamily: TU.display, fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>
                      {t(`nutrition.categories.${cat.id}`, cat.label)}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{count} {t('nutrition.recipesPlural', 'recipes')}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Weekly Collections ── */}
      {!showResults && (
        <div className="mb-6">
          <div className="px-5 mb-3" style={{ fontFamily: TU.display, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>
            {t('nutrition.weeklyCollections', 'Weekly Collections')}
          </div>
          <div className="px-4 space-y-3">
            {WEEKLY_COLLECTIONS.map(col => {
              const colRecipes = collectionRecipes(col, RECIPES);
              return (
                <button key={col.id} onClick={() => onOpenCollection(col)}
                  className="w-full text-left rounded-[22px] overflow-hidden"
                  style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 pr-3">
                        <h4 className="text-[14px] font-bold leading-snug" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>
                          {t(`nutrition_ingredients.weeklyCollections.${col.id}_title`, col.title)}
                        </h4>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                          {t(`nutrition_ingredients.weeklyCollections.${col.id}_subtitle`, col.subtitle)}
                        </p>
                      </div>
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${col.accent}18` }}>
                        <span className="text-[11px] font-black" style={{ color: col.accent }}>{colRecipes.length}</span>
                      </div>
                    </div>
                    <div className="flex gap-2 overflow-x-auto scroll-smooth scrollbar-none">
                      {colRecipes.map(r => (
                        <div key={r.id} className="relative w-[64px] h-[52px] rounded-xl overflow-hidden flex-shrink-0"
                          style={{ background: 'var(--color-border-subtle)' }}>
                          <img src={(foodImageUrl(r.image) || MEAL_IMG_FALLBACK)} onError={handleMealImgError} alt={mealTitle(r)} className="w-full h-full object-cover" loading="lazy" />
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
      )}

      {/* ── Recent ── */}
      {!showResults && (
        <div className="mb-6">
          <div className="px-5 mb-3 flex items-baseline justify-between">
            <div style={{ fontFamily: TU.display, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>
              {t('nutrition.recentTab', 'Recent')}
            </div>
            {recentRecipes.length > 3 && (
              <button onClick={() => setShowAllRecent(v => !v)} className="text-[13px] font-bold active:opacity-70" style={{ color: TU.accent }}>
                {showAllRecent ? t('nutrition.showLess', 'Show less') : t('nutrition.seeAll', 'See all')}
              </button>
            )}
          </div>
          <div className="px-4 flex flex-col gap-2.5">
            {(showAllRecent ? recentRecipes.slice(0, 20) : recentRecipes.slice(0, 3)).map((r, ri) => (
              <button key={r.id} onClick={() => openRecipe(r)}
                className="w-full flex items-center gap-3 p-3 rounded-[18px] text-left active:scale-[0.975] transition-all"
                style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
                {r.image ? (
                  <img src={(foodImageUrl(r.image) || MEAL_IMG_FALLBACK)} onError={handleMealImgError} alt="" className="w-[48px] h-[48px] rounded-[14px] object-cover flex-shrink-0" style={{ background: 'var(--color-border-subtle)' }} loading="lazy" />
                ) : (
                  <FoodTile name={mealTitle(r)} size={48} seed={ri} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                      {relOpenedLabel(r._openedAt, lang) || t('nutrition.recentTab', 'Recent')}
                    </span>
                  </div>
                  <p className="text-[14px] font-bold truncate mb-1" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>
                    {mealTitle(r)}
                  </p>
                  <MacroSegBar p={r.protein} c={r.carbs} f={r.fat} height={4} />
                  <div className="flex items-center gap-2.5 mt-1.5 text-[11px] font-bold" style={{ fontFamily: TU.display }}>
                    <span style={{ color: TU.macroP }}>{Math.round(r.protein || 0)}P</span>
                    <span style={{ color: TU.macroC }}>{Math.round(r.carbs || 0)}C</span>
                    <span style={{ color: TU.macroF }}>{Math.round(r.fat || 0)}F</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-1">
                  <div style={{ fontFamily: TU.display, fontSize: 17, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5, lineHeight: 1 }}>{r.calories}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>kcal</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Saved / My-meals card in the "Fits your macros" look — full-width image
// header with a corner action (star to unsave, trash to delete) and macros
// below. A div (not button) so the corner can hold its own tappable control.
const MacroGridCard = ({ image, title, kcal, p, c, f, onClick, corner, ariaLabel }) => (
  <div role="button" tabIndex={0} onClick={onClick} aria-label={ariaLabel}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
    className="rounded-[20px] overflow-hidden text-left active:scale-[0.97] transition-all cursor-pointer focus:outline-none"
    style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
    <div className="relative" style={{ height: 96 }}>
      <img src={image || MEAL_IMG_FALLBACK} onError={handleMealImgError} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ background: 'var(--color-border-subtle)' }} loading="lazy" />
      {corner && <div className="absolute top-2 right-2">{corner}</div>}
    </div>
    <div className="p-3">
      <div className="truncate text-[13.5px] font-bold mb-1" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)', letterSpacing: -0.3, lineHeight: 1.2 }}>{title}</div>
      <div className="mb-2" style={{ fontFamily: TU.display, fontSize: 15, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>
        {Math.round(kcal || 0)}<span className="text-[10.5px] font-semibold" style={{ color: 'var(--color-text-muted)' }}> kcal</span>
      </div>
      <MacroSegBar p={p} c={c} f={f} height={4} />
      <div className="flex justify-between mt-1.5 text-[10px] font-semibold">
        <span style={{ color: TU.macroP }}>{Math.round(p || 0)}P</span>
        <span style={{ color: TU.macroC }}>{Math.round(c || 0)}C</span>
        <span style={{ color: TU.macroF }}>{Math.round(f || 0)}F</span>
      </div>
    </div>
  </div>
);

// Circular white corner button used on MacroGridCard image headers.
const CardCornerBtn = ({ onClick, ariaLabel, children }) => (
  <button onClick={(e) => { e.stopPropagation(); onClick?.(); }} aria-label={ariaLabel}
    className="w-[28px] h-[28px] rounded-full flex items-center justify-center active:scale-90 transition-transform"
    style={{ background: 'rgba(255,255,255,0.95)', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>
    {children}
  </button>
);

// ── SAVED VIEW ──────────────────────────────────────────────
const SavedView = ({ setView, savedIds, onSave, onOpenRecipe, scannedFavorites = [], onOpenFavorite, userId, gymId, onLogMeal }) => {
  // Live recipe library — the saved list follows DB hydration (no rebuild).
  const RECIPES = useMeals();
  const { t, i18n } = useTranslation('pages');
  const lang = i18n.language || 'en';
  const mealTitle = (r) => (lang === 'es' && r.title_es) ? r.title_es : r.title;
  const savedRecipes = RECIPES.filter(r => savedIds.has(r.id));
  // Two top-level tabs: bookmarked recipes vs scanned/favorited foods.
  const [savedTab, setSavedTab] = useState('recipes');
  const [sortMode, setSortMode] = useState('name'); // saved recipes sort
  const SAVED_SORTS = [
    { id: 'name', label: t('nutrition.sortAZ', 'A–Z') },
    { id: 'protein', label: t('nutrition.sortProtein', 'Protein') },
    { id: 'calories', label: t('nutrition.sortCalories', 'Calories') },
  ];
  const cycleSaved = () => setSortMode(m => { const i = SAVED_SORTS.findIndex(s => s.id === m); return SAVED_SORTS[(i + 1) % SAVED_SORTS.length].id; });
  const sortedSaved = [...savedRecipes].sort((a, b) =>
    sortMode === 'protein' ? (b.protein || 0) - (a.protein || 0)
      : sortMode === 'calories' ? (a.calories || 0) - (b.calories || 0)
        : String(a.title || '').localeCompare(String(b.title || '')));
  const totalCount = savedRecipes.length + scannedFavorites.length;

  // Member's own custom meals (custom_meals, owner-only via RLS).
  const [myMeals, setMyMeals] = useState([]);
  const [showBuilder, setShowBuilder] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    supabase.from('custom_meals').select('*').eq('created_by', userId).order('created_at', { ascending: false })
      .then(({ data }) => { if (alive) setMyMeals(data || []); });
    return () => { alive = false; };
  }, [userId]);
  const deleteMyMeal = async (id) => {
    setMyMeals(prev => prev.filter(m => m.id !== id));
    await supabase.from('custom_meals').delete().eq('id', id);
  };
  // custom_meals row → the meal shape the log sheet expects.
  const myMealToMeal = (r) => ({ id: `custom_${r.id}`, title: r.name, title_es: r.name_es || r.name, calories: Number(r.calories) || 0, protein: Number(r.protein_g) || 0, carbs: Number(r.carbs_g) || 0, fat: Number(r.fat_g) || 0, category: r.category || 'custom', custom: true, image: null });

  return (
    <div className="pb-28 md:pb-12">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <button onClick={() => setView('home')} className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 focus:outline-none"
          style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }} aria-label={t('common.back', 'Go back')}>
          <ChevronLeft size={18} style={{ color: 'var(--color-text-muted)' }} />
        </button>
        <div className="flex-1 flex items-end justify-between">
          <div style={{ fontFamily: TU.display, fontSize: 28, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -1, lineHeight: 1 }}>
            {t('nutrition.savedRecipes', 'Saved')}
          </div>
          <button onClick={cycleSaved} className="flex items-center gap-1.5 text-[13px] font-semibold active:scale-95 transition-transform focus:outline-none" style={{ color: 'var(--color-text-muted)' }} aria-label={t('nutrition.sort', 'Sort')}>
            <SlidersHorizontal size={15} style={{ color: 'var(--color-text-muted)' }} />
            {SAVED_SORTS.find(s => s.id === sortMode)?.label || t('nutrition.sort', 'Sort')}
          </button>
        </div>
      </div>

      {/* My Meals — member-built custom meals (foods + portions + photo) */}
      <div className="px-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: 'var(--color-text-subtle)' }}>
            {t('nutrition.myMeals', 'My meals')}
          </div>
          <button onClick={() => setShowBuilder(true)}
            className="flex items-center gap-1.5 text-[12px] font-bold px-3 py-1.5 rounded-full active:scale-[0.97] transition-transform"
            style={{ background: TU.accent, color: 'var(--color-text-on-accent, #001512)' }}>
            <Plus size={14} strokeWidth={2.4} /> {t('nutrition.createMeal', 'Create meal')}
          </button>
        </div>
        {myMeals.length === 0 ? (
          <button onClick={() => setShowBuilder(true)}
            className="w-full rounded-[18px] p-5 text-center active:scale-[0.99] transition-transform"
            style={{ background: 'var(--color-bg-card)', border: '1px dashed var(--color-border-subtle)' }}>
            <UtensilsCrossed size={22} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.noCustomMeals', 'Build your own meal')}</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.noCustomMealsHint', 'Pick foods, set portions, add a photo')}</p>
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {myMeals.map((m) => {
              const img = m.image_url ? (/^https?:\/\//.test(m.image_url) ? m.image_url : foodImageUrl(m.image_url)) : null;
              const nm = (lang === 'es' && m.name_es) ? m.name_es : m.name;
              return (
                <MacroGridCard key={m.id} image={img} title={nm}
                  kcal={Number(m.calories) || 0} p={Number(m.protein_g) || 0} c={Number(m.carbs_g) || 0} f={Number(m.fat_g) || 0}
                  onClick={() => onLogMeal?.(myMealToMeal(m))} ariaLabel={t('nutrition.logMeal', 'Log meal')}
                  corner={<CardCornerBtn onClick={() => deleteMyMeal(m.id)} ariaLabel={t('common.delete', 'Delete')}><Trash2 size={13} style={{ color: '#DC2626' }} /></CardCornerBtn>} />
              );
            })}
          </div>
        )}
      </div>
      <CustomMealBuilder open={showBuilder} onClose={() => setShowBuilder(false)}
        onSaved={(m) => setMyMeals(prev => [m, ...prev])} userId={userId} gymId={gymId} lang={lang} />

      {/* Saved Foods (scanned/starred via the scan modal) */}
      {scannedFavorites.length > 0 && (
        <div className="px-4 mb-6">
          <div className="text-[11px] font-bold uppercase tracking-[0.6px] mb-2" style={{ color: 'var(--color-text-subtle)' }}>
            {t('nutrition.savedFoods', 'Saved foods')}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {scannedFavorites.map((f, fi) => {
              const img = f.food_image_url ? foodImageUrl(f.food_image_url) : null;
              return (
                <button key={f.id} onClick={() => onOpenFavorite?.(f)}
                  className="rounded-[18px] p-3 text-left active:scale-[0.97] transition-all"
                  style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
                  <div className="relative mb-2.5">
                    {img ? (
                      <img src={img} alt="" className="w-16 h-16 rounded-[14px] object-cover" style={{ background: 'var(--color-border-subtle)' }} loading="lazy" />
                    ) : (
                      <FoodTile name={f.food_name} size={64} seed={fi} />
                    )}
                    <div className="absolute -top-1 -right-1 w-[26px] h-[26px] rounded-full flex items-center justify-center"
                      style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                      <Heart size={12} fill={TU.accent} style={{ color: TU.accent }} />
                    </div>
                  </div>
                  <div className="truncate text-[14px] font-bold" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)', letterSpacing: -0.2, lineHeight: 1.2 }}>
                    {f.food_name}
                  </div>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                      <span style={{ color: 'var(--color-text-primary)', fontWeight: 800 }}>{Math.round(Number(f.calories) || 0)}</span> kcal
                    </span>
                  </div>
                  <div className="mt-2">
                    <MacroSegBar p={Number(f.protein_g) || 0} c={Number(f.carbs_g) || 0} f={Number(f.fat_g) || 0} height={3} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {savedRecipes.length === 0 && scannedFavorites.length === 0 ? (
        <div className="mx-5 rounded-[22px] p-8 text-center" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
          <Bookmark size={28} className="mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
          <p className="text-[15px] font-bold mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.noSavedRecipes', 'No saved recipes yet')}</p>
          <p className="text-[12px] mb-4" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.tapBookmark', 'Tap the bookmark icon on any recipe to save it here.')}</p>
          <button onClick={() => setView('discover')}
            className="px-5 py-2.5 rounded-full text-[13px] font-semibold"
            style={{ background: `${TU.accent}15`, color: TU.accent }}>
            {t('nutrition.browseRecipes', 'Browse Recipes')}
          </button>
        </div>
      ) : savedRecipes.length === 0 ? null : (
        <>
          {/* Always labelled so it reads as its own section below "My meals". */}
          <div className="px-4 mb-2">
            <div className="text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: 'var(--color-text-subtle)' }}>
              {t('nutrition.savedRecipes', 'Saved recipes')}
            </div>
          </div>
          {/* 2-column grid — Fits-macros card look, tap the star to unsave */}
          <div className="px-4 grid grid-cols-2 gap-2.5">
            {sortedSaved.map((recipe) => (
              <MacroGridCard key={recipe.id} image={recipe.image ? foodImageUrl(recipe.image) : null} title={mealTitle(recipe)}
                kcal={recipe.calories} p={recipe.protein} c={recipe.carbs} f={recipe.fat}
                onClick={() => onOpenRecipe(recipe)} ariaLabel={mealTitle(recipe)}
                corner={<CardCornerBtn onClick={() => onSave(recipe.id)} ariaLabel={t('nutrition.unsave', 'Remove from saved')}><Star size={14} fill="#FFC24A" style={{ color: '#FFC24A' }} /></CardCornerBtn>} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ── GROCERY VIEW ────────────────────────────────────────────
// Aisle order within a day — how a store is walked, not alphabetical.
const GROCERY_CAT_ORDER = { vegetables: 1, proteins: 2, carbs: 3, dairy: 4, fats: 5, extras: 6, other: 99 };
const GROCERY_CAT_FALLBACK = { proteins: 'Proteins', carbs: 'Carbs', vegetables: 'Vegetables', dairy: 'Dairy', fats: 'Fats', extras: 'Extras', other: 'Other' };
const groceryCatLabel = (t, key) => t(`nutrition_ingredients.categoryNames.${key}`, GROCERY_CAT_FALLBACK[key] || 'Extras');

// Best-effort food-group classifier for ANY ingredient key — recipes use far
// more ingredients than the 116-item palette, so a palette lookup alone leaves
// most items uncategorised. Fruits fold into carbs and spices/condiments into
// "extras", matching the app's existing 6-group taxonomy. Order matters:
// specific/ambiguous buckets are tested before broad ones, and short risky words
// (egg, oil, ham, cod, beet, corn…) use word boundaries so "boiled"≠oil,
// "eggplant"≠egg.
function classifyIngredientKey(ing) {
  const s = String(ing || '').toLowerCase().replace(/_/g, ' ');
  const has = (...w) => w.some(x => s.includes(x));
  const word = (...w) => w.some(x => new RegExp(`\\b${x}\\b`).test(s));
  if (has('eggplant', 'aubergine')) return 'vegetables';
  if (has('black pepper', 'peppercorn')) return 'extras';
  if (word('egg', 'eggs') || has('egg white')) return 'proteins';
  if (word('oil') || has('olive', 'butter', 'ghee', 'avocado', 'tahini', 'mayo', 'coconut', 'flax', 'chia', 'sesame', 'lard', 'almond', 'walnut', 'cashew', 'peanut', 'pecan', 'pistachio', 'hazelnut', 'macadamia') || word('nut', 'nuts', 'seed', 'seeds')) return 'fats';
  if (has('milk', 'cheese', 'yogurt', 'yoghurt', 'kefir', 'cottage', 'sour cream', 'custard')) return 'dairy';
  if (has('chicken', 'beef', 'pork', 'lamb', 'turkey', 'veal', 'duck', 'bacon', 'sausage', 'steak', 'mince', 'salmon', 'tuna', 'tilapia', 'haddock', 'trout', 'sardine', 'mackerel', 'anchov', 'shrimp', 'prawn', 'scallop', 'crab', 'lobster', 'tofu', 'tempeh', 'seitan', 'whey', 'casein', 'protein', 'jerky') || word('ham', 'cod', 'fish')) return 'proteins';
  if (has('broccoli', 'spinach', 'kale', 'lettuce', 'arugula', 'rocket', 'pepper', 'onion', 'garlic', 'shallot', 'scallion', 'leek', 'carrot', 'cucumber', 'zucchini', 'courgette', 'mushroom', 'cauliflower', 'celery', 'asparagus', 'cabbage', 'sprout', 'tomato', 'squash', 'pumpkin', 'radish', 'turnip', 'chard', 'collard', 'okra', 'artichoke', 'green bean', 'bok choy', 'fennel', 'beet')) return 'vegetables';
  if (has('rice', 'pasta', 'noodle', 'spaghetti', 'macaroni', 'bread', 'loaf', 'bagel', 'tortilla', 'wrap', 'oat', 'granola', 'cereal', 'quinoa', 'couscous', 'barley', 'bulgur', 'potato', 'flour', 'cracker', 'bean', 'lentil', 'chickpea', 'polenta', 'pancake', 'waffle', 'honey', 'maple', 'sugar', 'syrup', 'banana', 'apple', 'berry', 'berr', 'mango', 'orange', 'grape', 'melon', 'peach', 'pear', 'pineapple', 'kiwi', 'cherry', 'plum', 'apricot', 'raisin') || word('bun', 'yam', 'corn', 'fig', 'date', 'lemon', 'lime', 'pea', 'peas', 'oats')) return 'carbs';
  return 'extras'; // spices, herbs, condiments, stocks, and anything unrecognised
}

// "Mon · Jul 14" for a YYYY-MM-DD day key; un-dated items fall under "Other items".
function groceryDayLabel(dayKey, lang, t) {
  if (dayKey === '__any__') return t('nutrition.otherItems', 'Other items');
  try {
    const d = new Date(dayKey + 'T12:00:00');
    const loc = lang === 'es' ? 'es' : 'en';
    const wd = d.toLocaleDateString(loc, { weekday: 'short' });
    const md = d.toLocaleDateString(loc, { month: 'short', day: 'numeric' });
    return `${wd} · ${md}`;
  } catch { return dayKey; }
}

// Aisle accent per food group — how a store is colour-coded, not the app accent.
const GROCERY_AISLE_COLOR = { vegetables: '#3E9B54', proteins: '#D9534F', carbs: '#C67D22', dairy: '#3E86C4', fats: '#C79A2B', extras: '#6B5FD0', other: '#96A0AA' };

// ── amount summing ────────────────────────────────────────────
// The aggregated Shop view sums each ingredient's per-meal amounts into one buy
// quantity. Amounts are free-text ("1½ cups", "6 oz", "2 stalks", "500 g"), so
// parse number+unit, sum matching units, and join the rest.
const _FRAC = { '½': .5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': .25, '¾': .75, '⅛': .125, '⅜': .375, '⅝': .625, '⅞': .875, '⅕': .2, '⅖': .4, '⅗': .6, '⅘': .8, '⅙': 1 / 6 };
function _parseQty(str) {
  const s = String(str || '').trim();
  const m = s.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+\s*[½⅓⅔¼¾⅛⅜⅝⅞⅕⅖⅗⅘⅙]?|[½⅓⅔¼¾⅛⅜⅝⅞⅕⅖⅗⅘⅙])\s*(.*)$/);
  if (!m) return null;
  let numStr = m[1].trim(); const unit = (m[2] || '').trim().toLowerCase(); let n = 0;
  const uf = numStr.match(/[½⅓⅔¼¾⅛⅜⅝⅞⅕⅖⅗⅘⅙]/);
  if (uf) { n += _FRAC[uf[0]] || 0; numStr = numStr.replace(uf[0], '').trim(); }
  if (numStr.includes('/')) {
    const parts = numStr.split(/\s+/);
    if (parts.length === 2) { const [a, b] = parts[1].split('/'); n += (parseFloat(parts[0]) || 0) + parseFloat(a) / parseFloat(b); }
    else { const [a, b] = numStr.split('/'); n += parseFloat(a) / parseFloat(b); }
  } else if (numStr) { n += parseFloat(numStr) || 0; }
  return { n, unit };
}
function _fmtQty(n) {
  const whole = Math.floor(n + 1e-9), frac = n - whole;
  const fmap = [[.5, '½'], [1 / 3, '⅓'], [2 / 3, '⅔'], [.25, '¼'], [.75, '¾'], [.125, '⅛'], [.2, '⅕'], [.4, '⅖'], [.6, '⅗'], [.8, '⅘']];
  for (const [v, g] of fmap) if (Math.abs(frac - v) < .02) return whole > 0 ? `${whole}${g}` : g;
  const r = Math.round(n * 10) / 10;
  return String(r);
}
function sumAmounts(list) {
  const amts = (list || []).filter(Boolean).map(a => String(a).trim());
  if (!amts.length) return null;
  const byUnit = new Map(); const rest = [];
  for (const a of amts) {
    const p = _parseQty(a);
    if (!p) { rest.push(a); continue; }
    const norm = p.unit.replace(/s$/, '');
    const e = byUnit.get(norm);
    if (e) e.n += p.n; else byUnit.set(norm, { n: p.n, display: p.unit });
  }
  const parts = [];
  for (const { n, display } of byUnit.values()) parts.push(display ? `${_fmtQty(n)} ${display}` : _fmtQty(n));
  const seen = new Set(parts);
  for (const u of rest) if (!seen.has(u)) { parts.push(u); seen.add(u); }
  return parts.join(' + ') || null;
}

const GroceryView = ({ setView, groceryList, onToggleItem, onClearChecked, onRemoveItem, onFillFromMeals, onClearList, onAddGroceryItems }) => {
  const { t, i18n } = useTranslation('pages');
  const lang = i18n.language || 'en';

  const [expanded, setExpanded] = useState(() => new Set());
  const toggleExpand = (key) => setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  // One tap on an aggregated row gathers every backing line (the row is one
  // ingredient summed across meals). setRowChecked flips only the ones that need it.
  const setRowChecked = (row, target) => row.ids.forEach(id => {
    const it = groceryList.find(i => i.id === id);
    if (it && !!it.checked !== target) onToggleItem(id);
  });

  // Segmented view + period. The period both scopes "Fill from plan" AND filters
  // the visible list to that window (undated custom items always show).
  const [groceryView, setGroceryView] = useState('shop');
  const [fillWeeks, setFillWeeks] = useState(1);
  const FILL_PERIODS = [[1, t('nutrition.periodWeek', 'This week')], [2, t('nutrition.period2wk', '2 weeks')], [4, t('nutrition.periodMonth', 'Month')]];
  const periodList = useMemo(() => {
    const baseWs = getWeekStartDate();
    const end = new Date(baseWs + 'T12:00:00'); end.setDate(end.getDate() + fillWeeks * 7);
    const endStr = toLocalDateStr(end);
    return groceryList.filter(i => !i.day || (i.day >= baseWs && i.day < endStr));
  }, [groceryList, fillWeeks]);

  // VIEW A · Shop by aisle, AGGREGATED across the period: one line per ingredient,
  // quantities from every meal summed into the buy amount, with a tap-to-expand
  // per-meal split. Days live inside the breakdown, not the layout.
  const aisles = useMemo(() => {
    const byIng = new Map(); // key = label lower
    periodList.forEach(item => {
      const key = (item.label || '').trim().toLowerCase();
      if (!key) return;
      if (!byIng.has(key)) byIng.set(key, {
        key, label: item.label, ing: item.ing,
        categoryKey: item.categoryKey || classifyIngredientKey(item.ing || key),
        ids: [], amounts: [], mealAmts: new Map(), allChecked: true, allEaten: true, n: 0,
      });
      const e = byIng.get(key);
      e.ids.push(item.id); e.n++;
      if (item.amount) e.amounts.push(item.amount);
      if (item.fromRecipe) {
        const cur = e.mealAmts.get(item.fromRecipe) || [];
        if (item.amount) cur.push(item.amount);
        e.mealAmts.set(item.fromRecipe, cur);
      }
      if (!item.checked) e.allChecked = false;
      if (!item.eaten) e.allEaten = false;
    });
    const rows = Array.from(byIng.values()).map(e => ({
      key: e.key, label: e.label, ing: e.ing, categoryKey: e.categoryKey,
      imgSlug: ingredientImageSlug(e.ing || e.label.toLowerCase().replace(/\s+/g, '_')),
      ids: e.ids, checked: e.n > 0 && e.allChecked, eaten: e.n > 0 && e.allEaten,
      total: sumAmounts(e.amounts),
      mealCount: e.mealAmts.size,
      sources: Array.from(e.mealAmts.entries()).map(([meal, amts]) => ({ meal, amount: sumAmounts(amts) })),
    }));
    const byCat = new Map();
    rows.forEach(r => { const c = r.categoryKey || 'extras'; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(r); });
    return Array.from(byCat.entries())
      .map(([catKey, items]) => ({ catKey, label: groceryCatLabel(t, catKey), color: GROCERY_AISLE_COLOR[catKey] || GROCERY_AISLE_COLOR.other, items: items.sort((a, b) => a.label.localeCompare(b.label)) }))
      .sort((a, b) => (GROCERY_CAT_ORDER[a.catKey] ?? 50) - (GROCERY_CAT_ORDER[b.catKey] ?? 50));
  }, [periodList, t]);

  // "In your kitchen" — staples you already own, hidden from Shop/List (persisted).
  const [have, setHave] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem('grocery_have') || '[]')); } catch { return new Set(); } });
  useEffect(() => { try { localStorage.setItem('grocery_have', JSON.stringify([...have])); } catch { /* quota */ } }, [have]);
  const toggleHave = (key) => setHave(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const allRows = aisles.flatMap(a => a.items);
  const shopRows = allRows.filter(x => !have.has(x.key));       // what's actually left to buy
  const checkedGroupCount = shopRows.filter(x => x.checked).length;
  const totalGroups = shopRows.length;
  const pct = totalGroups > 0 ? (checkedGroupCount / totalGroups) * 100 : 0;
  const mealCount = useMemo(() => { const s = new Set(); periodList.forEach(i => i.fromRecipe && s.add(i.fromRecipe)); return s.size; }, [periodList]);

  const [addingItem, setAddingItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const handleAddCustom = () => {
    const name = newItemName.trim();
    if (!name) { setAddingItem(false); return; }
    const ing = name.toLowerCase().replace(/\s+/g, '_');
    const catKey = classifyIngredientKey(ing);
    onAddGroceryItems?.([{ id: `custom_${ing}_${Date.now()}`, ing, label: name, category: groceryCatLabel(t, catKey), categoryKey: catKey, imgSlug: ingredientImageSlug(ing), amount: null, fromRecipe: null, day: null, addedDate: toLocalDateStr(new Date()), checked: false }]);
    setNewItemName(''); setAddingItem(false);
  };
  const [confirmState, setConfirmState] = useState(null); // { title, body, confirmLabel, danger, onConfirm }
  const flatRows = useMemo(() => aisles.flatMap(a => a.items.map(x => ({ ...x, color: a.color }))), [aisles]);
  const [expandedMeals, setExpandedMeals] = useState(() => new Set()); // collapsed by default; opt-in to open
  const toggleMealExpand = (key) => setExpandedMeals(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  // Meals view: DAY → meal (premium card w/ photo + collapsible ingredient list).
  const mealDayGroups = useMemo(() => {
    const dayMap = new Map(); // day → Map(meal → Map(label → row))
    periodList.forEach(item => {
      const day = item.day || item.addedDate || '__any__';
      const meal = item.fromRecipe || t('nutrition.customItem', 'Custom item');
      if (!dayMap.has(day)) dayMap.set(day, new Map());
      const mealMap = dayMap.get(day);
      if (!mealMap.has(meal)) mealMap.set(meal, new Map());
      const rowMap = mealMap.get(meal);
      const key = (item.label || '').trim().toLowerCase();
      if (!rowMap.has(key)) rowMap.set(key, { key, label: item.label, ing: item.ing, categoryKey: item.categoryKey || classifyIngredientKey(item.ing || key), ids: [item.id], amounts: [item.amount], allChecked: !!item.checked, allEaten: !!item.eaten });
      else { const e = rowMap.get(key); e.ids.push(item.id); e.amounts.push(item.amount); if (!item.checked) e.allChecked = false; if (!item.eaten) e.allEaten = false; }
    });
    const days = Array.from(dayMap.entries()).map(([day, mealMap]) => ({
      day,
      meals: Array.from(mealMap.entries()).map(([meal, rowMap]) => {
        const rows = Array.from(rowMap.values()).map(r => ({ ...r, checked: r.allChecked, eaten: r.allEaten, mealCount: 1, sources: [], imgSlug: ingredientImageSlug(r.ing || r.label.toLowerCase().replace(/\s+/g, '_')), total: sumAmounts(r.amounts), color: GROCERY_AISLE_COLOR[r.categoryKey] || GROCERY_AISLE_COLOR.other }));
        return { meal, ckey: `${day}|${meal}`, image: recipeImageByName(meal), rows, done: rows.filter(r => r.checked).length };
      }),
    }));
    days.sort((a, b) => { if (a.day === '__any__') return 1; if (b.day === '__any__') return -1; return a.day.localeCompare(b.day); });
    return days;
  }, [periodList, t]);
  const askRemove = (x) => setConfirmState({ title: t('nutrition.removeItemQ', 'Remove item?'), body: t('nutrition.removeItemBody', { name: x.label, defaultValue: `Remove ${x.label} from your list?` }), confirmLabel: t('nutrition.remove', 'Remove'), danger: true, onConfirm: () => x.ids.forEach(id => onRemoveItem(id)) });
  // "Clear checks" resets progress WITHOUT deleting the list — just unchecks.
  const askClearChecks = () => setConfirmState({ title: t('nutrition.uncheckAllQ', 'Clear all checks?'), body: t('nutrition.uncheckAllBody', 'Keeps your whole list — just clears the checkmarks so you can shop it again.'), confirmLabel: t('nutrition.clearChecks', 'Clear checks'), danger: false, onConfirm: () => groceryList.filter(i => i.checked).forEach(i => onToggleItem(i.id)) });

  const SEG = [['shop', t('nutrition.segShop', 'Shop')], ['meals', t('nutrition.segMeals', 'Meals')]];

  const progressStrip = (
    <div className="px-4 pb-3">
      {/* Period — how far ahead "Fill from plan" shops (week → month) */}
      <div className="flex gap-1 p-0.5 rounded-[11px] mb-2.5" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}>
        {FILL_PERIODS.map(([wk, label]) => {
          const on = wk === fillWeeks;
          return (
            <button key={wk} onClick={() => setFillWeeks(wk)} className="flex-1 py-1.5 rounded-[9px] text-[12px] font-bold transition-all active:scale-95" style={{ background: on ? 'var(--color-bg-card)' : 'transparent', color: on ? 'var(--color-text-primary)' : 'var(--color-text-muted)', boxShadow: on ? '0 1px 2px rgba(0,0,0,0.1)' : 'none' }}>{label}</button>
          );
        })}
      </div>
      <div className="flex items-center justify-between mb-2 gap-3">
        <div className="text-[13px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
          <span style={{ fontFamily: TU.display, fontSize: 17, fontWeight: 800, color: 'var(--color-text-primary)' }}>{checkedGroupCount}</span>{' '}
          {t('nutrition.ofNInCart', { total: totalGroups, defaultValue: `of ${totalGroups} in cart` })}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {checkedGroupCount > 0 && (
            <button onClick={askClearChecks} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold active:scale-95 transition-transform" style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-subtle)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
              <RefreshCw size={12} />{t('nutrition.clearChecks', 'Clear checks')}
            </button>
          )}
          <button onClick={() => onFillFromMeals(fillWeeks)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold active:scale-95 transition-transform" style={{ border: `1px solid ${TU.accent}`, background: `${TU.accent}14`, color: TU.accent }}>
            <Sparkles size={13} />{t('nutrition.fillFromPlan', 'Fill from plan')}
          </button>
        </div>
      </div>
      <div className="rounded-full overflow-hidden" style={{ height: 6, background: 'var(--color-surface-hover, rgba(0,0,0,0.05))' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(to right, ${TU.accent}, #5AD6A0)`, borderRadius: 999, transition: 'width 500ms cubic-bezier(0.2,0.9,0.3,1)' }} />
      </div>
    </div>
  );

  // Shared aggregated ingredient row — Shop / List / Have reuse it. Remove now
  // opens a confirm (askRemove) instead of deleting straight away.
  const renderRow = (x, color, opts = {}) => {
    const isOpen = expanded.has(x.key);
    const showAttr = opts.showAttr !== false;
    const multi = x.mealCount > 1 && showAttr;
    return (
      <div key={x.key} style={{ borderTop: opts.first ? 'none' : '1px solid var(--color-border-subtle)' }}>
        <div className="flex items-center gap-3 px-3.5 py-2.5">
          <button onClick={() => setRowChecked(x, !x.checked)}
            className="flex-shrink-0 w-[24px] h-[24px] rounded-[8px] flex items-center justify-center focus:outline-none active:scale-90 transition-transform"
            style={{ background: x.checked ? 'var(--color-success, #3E9B54)' : 'transparent', border: x.checked ? 'none' : '1.6px solid var(--color-border-subtle)' }}
            aria-label={x.checked ? t('nutrition.uncheckItem', 'Uncheck item') : t('nutrition.checkItem', 'Check item')}>
            {x.checked && <Check size={15} className="text-white" strokeWidth={3} />}
          </button>
          <FoodThumb src={x.imgSlug ? foodImageUrl(`/ingredients/${x.imgSlug}.jpg`) : null} name={x.label} size={40} seed={(x.label || '?').charCodeAt(0) || 0} className="w-10 h-10 rounded-[12px] object-cover flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[15px] truncate" style={{ fontWeight: 650, color: x.checked ? 'var(--color-text-muted)' : 'var(--color-text-primary)', textDecoration: x.checked ? 'line-through' : 'none', letterSpacing: -0.2 }}>{x.label}</span>
              {x.eaten && (
                <span className="flex-shrink-0 text-[9.5px] font-extrabold uppercase px-1.5 py-0.5 rounded" style={{ color: 'var(--color-success, #3E9B54)', background: 'rgba(62,155,84,0.14)', letterSpacing: 0.4 }}>{t('nutrition.eatenTag', 'eaten')}</span>
              )}
            </div>
            {showAttr && (
              <div className="mt-0.5">
                {multi ? (
                  <button onClick={() => toggleExpand(x.key)} className="inline-flex items-center gap-1 focus:outline-none active:opacity-70"
                    style={{ padding: '2px 4px 2px 8px', borderRadius: 999, border: '1px solid var(--color-border-subtle)', background: 'var(--color-surface-hover, rgba(0,0,0,0.03))' }}>
                    <span style={{ width: 5, height: 5, borderRadius: 3, background: TU.accent }} />
                    <span className="text-[11.5px] font-bold" style={{ color: 'var(--color-text-secondary, var(--color-text-primary))' }}>{t('nutrition.nMeals', { count: x.mealCount, defaultValue: `${x.mealCount} meals` })}</span>
                    <ChevronDown size={13} style={{ color: 'var(--color-text-muted)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold truncate" style={{ color: 'var(--color-text-muted)', maxWidth: '100%' }}>
                    <span style={{ width: 5, height: 5, borderRadius: 3, background: color, opacity: .7, flexShrink: 0 }} />
                    <span className="truncate">{x.sources && x.sources[0] ? x.sources[0].meal : t('nutrition.customItem', 'Custom item')}</span>
                  </span>
                )}
              </div>
            )}
          </div>
          {x.total && (
            <span className="flex-shrink-0" style={{ fontFamily: TU.display, fontSize: multi ? 15 : 13.5, fontWeight: 700, letterSpacing: -0.2, color: 'var(--color-text-primary)', padding: multi ? '4px 10px' : '3px 9px', borderRadius: 8, background: multi ? `${TU.accent}1f` : 'var(--color-surface-hover, rgba(0,0,0,0.04))', whiteSpace: 'nowrap' }}>{x.total}</span>
          )}
          {opts.onHaveIt && (
            <button onClick={(e) => { e.stopPropagation(); opts.onHaveIt(); }} className="text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 active:scale-95 transition-transform" style={{ color: TU.accent, background: `${TU.accent}12` }}>
              {t('nutrition.haveIt', 'Have it')}
            </button>
          )}
          <button onClick={() => askRemove(x)}
            className="min-w-[34px] min-h-[34px] w-6 h-6 flex items-center justify-center flex-shrink-0 opacity-45 hover:opacity-100 active:scale-90 transition-all focus:outline-none"
            aria-label={t('nutrition.removeItem', 'Remove item')}>
            <Trash2 size={15} style={{ color: 'var(--color-danger, #DC2626)' }} />
          </button>
        </div>
        {isOpen && multi && (
          <div style={{ marginLeft: 58, marginBottom: 8, borderLeft: `2px solid ${TU.accent}33`, paddingLeft: 12 }}>
            {x.sources.map((s, si) => (
              <div key={si} className="flex items-center gap-2 py-1">
                <span className="flex-1 text-[12.5px] font-semibold truncate" style={{ color: 'var(--color-text-secondary, var(--color-text-muted))' }}>{s.meal}</span>
                {s.amount && <span className="text-[12.5px] font-bold flex-shrink-0" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)' }}>{s.amount}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="pb-28 md:pb-12">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <button onClick={() => setView('home')} className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 focus:outline-none"
          style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }} aria-label={t('common.back', 'Go back')}>
          <ChevronLeft size={18} style={{ color: 'var(--color-text-muted)' }} />
        </button>
        <div className="flex-1 flex items-start justify-between">
          <div>
            <div style={{ fontFamily: TU.display, fontSize: 28, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -1, lineHeight: 1 }}>
              {t('nutrition.groceryList', 'Groceries')}
            </div>
            {mealCount > 0 && (
              <div className="text-[12.5px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                {(FILL_PERIODS.find(p => p[0] === fillWeeks)?.[1] || t('nutrition.periodWeek', 'This week'))}{' · '}{t('nutrition.nMeals', { count: mealCount, defaultValue: `${mealCount} meals` })}
              </div>
            )}
          </div>
          {/* "Lista nueva" / "New list" — clears the list with confirm. */}
          <button
            type="button"
            onClick={onClearList}
            className="flex items-center gap-1 text-[12px] font-bold px-3 py-1.5 rounded-full focus:outline-none active:scale-95 transition-transform"
            style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-subtle)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            <Plus size={13} strokeWidth={2.6} />
            {t('nutrition.newList', 'New list')}
          </button>
        </div>
      </div>

      {groceryList.length === 0 ? (
        <div className="mx-5 rounded-[22px] p-8 text-center" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
          <ShoppingCart size={28} className="mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
          <p className="text-[15px] font-bold mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.groceryListEmpty', 'Your grocery list is empty')}</p>
          <p className="text-[12px] mb-4" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.groceryListEmptyHint', 'Open a recipe and tap "Add to Grocery List" to get started.')}</p>
          <div className="flex gap-2 justify-center">
            <button onClick={() => setView('discover')}
              className="px-5 py-2.5 rounded-full text-[13px] font-semibold"
              style={{ background: `${TU.accent}15`, color: TU.accent }}>
              {t('nutrition.browseRecipes', 'Browse Recipes')}
            </button>
            {onFillFromMeals && (
              <button onClick={() => onFillFromMeals(1)}
                className="px-5 py-2.5 rounded-full text-[13px] font-semibold flex items-center gap-1.5"
                style={{ background: 'var(--color-text-primary)', color: 'var(--color-bg-primary)' }}>
                <Sparkles size={13} />
                {t('nutrition.fillFromPlan', 'Fill from plan')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Filters — Shop / Meals. The kitchen (Have) is reached via the note. */}
          {groceryView === 'have' ? (
            <button onClick={() => setGroceryView('shop')} className="mx-4 mb-3 flex items-center gap-1 text-[13px] font-bold active:opacity-70" style={{ color: TU.accent }}>
              <ChevronLeft size={16} />{t('nutrition.backToShop', 'Back to shop')}
            </button>
          ) : (
            <div className="mx-4 mb-3 flex gap-1 p-1 rounded-[14px]" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}>
              {SEG.map(([k, label]) => {
                const on = k === groceryView;
                return (
                  <button key={k} onClick={() => setGroceryView(k)}
                    className="flex-1 text-center py-2 rounded-[10px] text-[13px] font-bold transition-all active:scale-95"
                    style={{ background: on ? 'var(--color-text-primary)' : 'transparent', color: on ? 'var(--color-bg-primary)' : 'var(--color-text-muted)', boxShadow: on ? '0 1px 3px rgba(0,0,0,0.18)' : 'none' }}>
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Shop - aisle-aggregated (owned staples hidden) */}
          {groceryView === 'shop' && (
            <>
              {progressStrip}
              <div className="px-4 space-y-4">
                {aisles.map((a) => {
                  const items = a.items.filter(x => !have.has(x.key));
                  if (!items.length) return null;
                  return (
                  <div key={a.catKey}>
                    <div className="flex items-center gap-2 px-1.5 mb-2">
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: a.color }} />
                      <span className="text-[14px]" style={{ fontFamily: TU.display, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{a.label}</span>
                      <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{items.filter(x => x.checked).length}/{items.length}</span>
                    </div>
                    <div className="rounded-[18px] overflow-hidden" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
                      {items.map((x, i) => renderRow(x, a.color, { first: i === 0 }))}
                    </div>
                  </div>
                  );
                })}
                {allRows.some(x => have.has(x.key)) && (
                  <button onClick={() => setGroceryView('have')} className="w-full flex items-center gap-2.5 px-4 py-3 rounded-[14px] text-left active:scale-[0.99] transition-transform" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.03))' }}>
                    <Home size={16} style={{ color: 'var(--color-text-muted)' }} className="flex-shrink-0" />
                    <span className="flex-1 text-[12.5px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                      {t('nutrition.inKitchenHidden', { count: allRows.filter(x => have.has(x.key)).length, defaultValue: `${allRows.filter(x => have.has(x.key)).length} already in your kitchen — hidden` })}
                    </span>
                    <span className="text-[12px] font-bold flex-shrink-0" style={{ color: TU.accent }}>{t('nutrition.showKitchen', 'Show')}</span>
                  </button>
                )}
              </div>
            </>
          )}

          {/* Meals - grouped by day, premium collapsible cards w/ meal photo */}
          {groceryView === 'meals' && (
            <>
            {progressStrip}
            <div className="px-4 space-y-4">
              {mealDayGroups.map((dg) => (
                <div key={dg.day}>
                  {dg.day !== '__any__' && (
                    <div className="flex items-center gap-2 px-1.5 mb-2">
                      <Calendar size={13} style={{ color: TU.accent }} className="flex-shrink-0" />
                      <p className="text-[13px] font-bold uppercase" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)', letterSpacing: 0.4 }}>{groceryDayLabel(dg.day, lang, t)}</p>
                    </div>
                  )}
                  <div className="space-y-3">
                    {dg.meals.map((m) => {
                      const open = expandedMeals.has(m.ckey);
                      return (
                        <div key={m.ckey} className="rounded-[18px] overflow-hidden" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
                          {/* Premium meal header — photo + name + count + collapse chevron */}
                          <button onClick={() => toggleMealExpand(m.ckey)} className="w-full flex items-center gap-3 p-3 text-left active:opacity-90 focus:outline-none">
                            {m.image
                              ? <img src={m.image} onError={handleMealImgError} alt="" className="w-[52px] h-[52px] rounded-[14px] object-cover flex-shrink-0" style={{ background: 'var(--color-border-subtle)' }} loading="lazy" />
                              : <FoodTile name={m.meal} size={52} seed={(m.meal || '?').charCodeAt(0) || 0} />}
                            <div className="flex-1 min-w-0">
                              <div className="text-[15.5px] truncate" style={{ fontFamily: TU.display, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>{m.meal}</div>
                              <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{m.rows.length} {t('nutrition.itemsLabel', 'items')} · {m.done} {t('nutrition.inCartTitle', 'in cart')}</div>
                            </div>
                            <ChevronDown size={18} style={{ color: 'var(--color-text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} className="flex-shrink-0" />
                          </button>
                          {open && (
                            <div style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                              {m.rows.map((r, i) => renderRow(r, r.color, { first: i === 0, showAttr: false }))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            </>
          )}

          {/* Have - to buy / in cart / in your kitchen */}
          {groceryView === 'have' && (
            <div className="px-4 space-y-4">
              {[['toBuy', t('nutrition.toBuy', 'To buy'), flatRows.filter(x => !have.has(x.key) && !x.checked)], ['inCart', t('nutrition.inCartTitle', 'In cart'), flatRows.filter(x => !have.has(x.key) && x.checked)]].map(([k, label, rows]) => rows.length > 0 && (
                <div key={k}>
                  <div className="flex items-center gap-2 px-1.5 mb-2">
                    <span className="text-[14px]" style={{ fontFamily: TU.display, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{label}</span>
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{rows.length}</span>
                  </div>
                  <div className="rounded-[18px] overflow-hidden" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
                    {rows.map((x, i) => renderRow(x, x.color, { first: i === 0, onHaveIt: () => toggleHave(x.key) }))}
                  </div>
                </div>
              ))}
              {(() => {
                const krows = flatRows.filter(x => have.has(x.key));
                if (!krows.length) return null;
                return (
                  <div>
                    <div className="flex items-center gap-2 px-1.5 mb-2">
                      <Home size={13} style={{ color: 'var(--color-text-muted)' }} className="flex-shrink-0" />
                      <span className="text-[14px]" style={{ fontFamily: TU.display, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{t('nutrition.inYourKitchen', 'In your kitchen')}</span>
                      <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{krows.length}</span>
                    </div>
                    <div className="rounded-[18px] overflow-hidden" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
                      {krows.map((x, i) => (
                        <div key={x.key} className="flex items-center gap-3 px-3.5 py-2.5" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)', opacity: 0.72 }}>
                          <span className="w-[24px] h-[24px] rounded-[8px] flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.05))' }}><Home size={13} style={{ color: 'var(--color-text-muted)' }} /></span>
                          <FoodThumb src={x.imgSlug ? foodImageUrl(`/ingredients/${x.imgSlug}.jpg`) : null} name={x.label} size={34} seed={(x.label || '?').charCodeAt(0) || 0} className="w-[34px] h-[34px] rounded-[10px] object-cover flex-shrink-0" />
                          <span className="flex-1 min-w-0 text-[15px] font-medium truncate" style={{ color: 'var(--color-text-secondary, var(--color-text-muted))' }}>{x.label}</span>
                          <button onClick={() => toggleHave(x.key)} className="text-[12px] font-bold flex-shrink-0 active:opacity-60" style={{ color: TU.accent }}>{t('nutrition.moveToList', 'Move to list')}</button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Add a custom (non-recipe) item */}
          <div className="px-4 pt-1">
            {addingItem ? (
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-[14px]" style={{ background: 'var(--color-bg-card)', border: `1px solid ${TU.accent}` }}>
                <Plus size={18} style={{ color: TU.accent }} className="flex-shrink-0" />
                <input autoFocus value={newItemName} onChange={(e) => setNewItemName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustom(); if (e.key === 'Escape') { setAddingItem(false); setNewItemName(''); } }}
                  placeholder={t('nutrition.addItemPlaceholder', 'Add an item…')}
                  className="flex-1 bg-transparent outline-none text-[15px]" style={{ color: 'var(--color-text-primary)' }} />
                <button onClick={handleAddCustom} className="text-[13px] font-bold px-3 py-1.5 rounded-full flex-shrink-0 active:scale-95" style={{ background: TU.accent, color: 'var(--color-text-on-accent, #fff)' }}>{t('nutrition.addBtn', 'Add')}</button>
              </div>
            ) : (
              <button onClick={() => setAddingItem(true)} className="w-full flex items-center gap-2 px-3.5 py-3 rounded-[14px] text-[14px] font-semibold active:scale-[0.99] transition-transform" style={{ border: '1.5px dashed var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                <Plus size={18} style={{ color: 'var(--color-text-muted)' }} />{t('nutrition.addItem', 'Add item…')}
              </button>
            )}
          </div>

          {/* Confirm dialog — shared by row-delete and clear-checks */}
          {confirmState && createPortal((
            <div className="fixed inset-0 z-[100] flex items-center justify-center px-8" onClick={() => setConfirmState(null)}>
              <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.45)' }} />
              <div className="relative w-full max-w-[300px] rounded-[20px] p-5 text-center" style={{ background: 'var(--color-bg-card)', boxShadow: '0 24px 80px rgba(0,0,0,0.4)' }} onClick={(e) => e.stopPropagation()}>
                <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: confirmState.danger ? 'rgba(220,38,38,0.12)' : `${TU.accent}1f` }}>
                  {confirmState.danger ? <Trash2 size={22} style={{ color: 'var(--color-danger, #DC2626)' }} /> : <RefreshCw size={20} style={{ color: TU.accent }} />}
                </div>
                <div className="text-[16px] font-bold mb-1" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)' }}>{confirmState.title}</div>
                <div className="text-[13px] mb-4" style={{ color: 'var(--color-text-muted)' }}>{confirmState.body}</div>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmState(null)} className="flex-1 py-2.5 rounded-[12px] text-[13px] font-bold active:scale-95" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.05))', color: 'var(--color-text-primary)' }}>{t('common.cancel', 'Cancel')}</button>
                  <button onClick={() => { confirmState.onConfirm?.(); setConfirmState(null); }} className="flex-1 py-2.5 rounded-[12px] text-[13px] font-bold text-white active:scale-95" style={{ background: confirmState.danger ? 'var(--color-danger, #DC2626)' : TU.accent }}>{confirmState.confirmLabel}</button>
                </div>
              </div>
            </div>
          ), document.body)}
        </>
      )}
    </div>
  );
};

// ── Food preferences (edit allergies / diet / foods-to-avoid post-onboarding) ──
// Mirrors the onboarding meal-plan step so the sheet edits the exact same data
// (member_onboarding.food_allergies/dietary_restrictions + disliked_foods).
const PREF_DIETARY = ['vegan', 'vegetarian', 'pescatarian', 'keto', 'gluten_free', 'dairy_free', 'halal'];
const PREF_ALLERGIES = [
  { value: 'nuts', key: 'allergyNuts' }, { value: 'shellfish', key: 'allergyShellfish' },
  { value: 'dairy', key: 'allergyDairy' }, { value: 'eggs', key: 'allergyEggs' },
  { value: 'soy', key: 'allergySoy' }, { value: 'wheat', key: 'allergyWheat' },
  { value: 'fish', key: 'allergyFish' },
];
const PREF_COMMON_INGREDIENTS = [
  'chicken_breast', 'salmon_fillet', 'ground_turkey', 'lean_ground_beef', 'tofu', 'shrimp',
  'eggs', 'greek_yogurt', 'oats', 'brown_rice', 'quinoa', 'sweet_potato', 'broccoli', 'spinach',
  'avocado', 'peanut_butter', 'cottage_cheese', 'tuna', 'mushrooms', 'bell_pepper', 'black_beans',
  'chickpeas', 'lentils', 'kale', 'cauliflower', 'zucchini', 'asparagus', 'brussels_sprouts',
  'coconut_milk', 'soy_sauce', 'olive_oil',
];
const formatIngredientLabel = (ing) => ing.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const MealPrefsSheet = ({ open, onClose, userId, gymId, initialAllergies = [], initialRestrictions = [], initialAvoid = [], onSaved }) => {
  const { t } = useTranslation(['pages', 'onboarding']);
  const [allergies, setAllergies] = useState(initialAllergies);
  const [restrictions, setRestrictions] = useState(initialRestrictions);
  const [avoid, setAvoid] = useState(initialAvoid);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const RECIPES = useMeals();
  const ingLabel = useCallback((key) => t(`nutrition_ingredients.items.${key}`, formatIngredientLabel(key)), [t]);
  // Every avoidable ingredient = the palette + every ingredient used across our
  // recipes. The generator hard-excludes any recipe containing an avoided key,
  // so the pool must cover the full recipe vocabulary, not a curated shortlist.
  const ingredientVocab = useMemo(() => {
    const set = new Set();
    Object.values(INGREDIENT_CATEGORIES).flat().forEach(it => { if (it?.id) set.add(it.id); });
    (RECIPES || []).forEach(r => (r.ingredients || []).forEach(i => { if (i) set.add(i); }));
    return Array.from(set);
  }, [RECIPES]);
  // Re-sync local edits from the parent's loaded prefs whenever the sheet
  // opens OR the loaded values change (covers opening the gear before
  // loadPrefs has resolved — otherwise it'd capture empty arrays and stick).
  const initKey = `${initialAllergies.join()}|${initialRestrictions.join()}|${initialAvoid.join()}`;
  useScrollLock(open);
  useEffect(() => {
    if (open) { setAllergies(initialAllergies); setRestrictions(initialRestrictions); setAvoid(initialAvoid); setSearch(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initKey]);
  if (!open) return null;
  const toggleIn = (arr, setter, v) => setter(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  const q = search.trim().toLowerCase();
  // No query → common quick-picks plus anything already avoided. Query → search
  // the WHOLE catalog by label or key (capped so a broad match doesn't render
  // hundreds of chips at once).
  const shown = q
    ? ingredientVocab
        .filter(i => ingLabel(i).toLowerCase().includes(q) || i.replace(/_/g, ' ').includes(q))
        .sort((a, b) => ingLabel(a).localeCompare(ingLabel(b)))
        .slice(0, 60)
    : Array.from(new Set([...avoid, ...PREF_COMMON_INGREDIENTS]));
  const Chip = ({ active, onClick, children }) => (
    <button type="button" onClick={onClick}
      className="px-3 py-2 rounded-full text-[12.5px] font-semibold active:scale-95 transition-all"
      style={active
        ? { background: TU.accent, color: '#fff', border: 'none' }
        : { background: 'var(--color-bg-card)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-subtle)' }}>
      {children}
    </button>
  );
  const handleSave = async () => {
    setSaving(true);
    try {
      // Upsert (not update) — a member who skipped the onboarding diet step may
      // have no member_onboarding row yet; .update() would silently match zero
      // rows and the save would vanish. gym_id is NOT NULL, so include it.
      const obPayload = { profile_id: userId, food_allergies: allergies, dietary_restrictions: restrictions };
      if (gymId) obPayload.gym_id = gymId;
      const obSave = await supabase.from('member_onboarding').upsert(obPayload, { onConflict: 'profile_id' });
      if (obSave.error) throw obSave.error;
      const { data: existing } = await supabase.from('disliked_foods').select('food_name').eq('profile_id', userId);
      const existingSet = new Set((existing || []).map(d => d.food_name));
      const toAdd = avoid.filter(a => !existingSet.has(a));
      const toRemove = [...existingSet].filter(a => !avoid.includes(a));
      if (toAdd.length) {
        await supabase.from('disliked_foods').upsert(
          toAdd.map(food_name => ({ profile_id: userId, gym_id: gymId, food_name })),
          { onConflict: 'profile_id,food_name', ignoreDuplicates: true });
      }
      if (toRemove.length) {
        await supabase.from('disliked_foods').delete().eq('profile_id', userId).in('food_name', toRemove);
      }
      // Avoided ingredients also feed affinity learning — refresh in background.
      rebuildAffinities(userId, gymId).catch(() => {});
      onSaved?.({ allergies, restrictions, avoid });
    } catch (e) { console.error('[savePrefs]', e); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} role="presentation" />
      <div className="relative w-full max-w-[460px] max-h-[88dvh] flex flex-col overflow-hidden rounded-[24px]"
        style={{ background: 'var(--color-bg-primary)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-2 flex-shrink-0">
          <div style={{ fontFamily: TU.display, fontSize: 22, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>{t('nutrition.prefsTitle', 'Preferences')}</div>
          <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--color-bg-card)' }} aria-label={t('common.close', 'Close')}>
            <X size={17} style={{ color: 'var(--color-text-muted)' }} />
          </button>
        </div>
        <p className="px-5 pb-3 text-[12.5px] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.prefsHint', 'Generated plans skip anything you flag here.')}</p>
        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-5" style={{ overscrollBehavior: 'contain' }}>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>{t('nutrition.prefsAllergies', 'Allergies')}</div>
            <div className="flex flex-wrap gap-2">
              {PREF_ALLERGIES.map(o => <Chip key={o.value} active={allergies.includes(o.value)} onClick={() => toggleIn(allergies, setAllergies, o.value)}>{t(`onboarding:mealPlan.${o.key}`)}</Chip>)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>{t('nutrition.prefsDiet', 'Diet')}</div>
            <div className="flex flex-wrap gap-2">
              {PREF_DIETARY.map(v => <Chip key={v} active={restrictions.includes(v)} onClick={() => toggleIn(restrictions, setRestrictions, v)}>{t(`onboarding:mealPlan.${v}`)}</Chip>)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>{t('nutrition.prefsAvoid', 'Foods to avoid')}</div>
            <div className="relative mb-2.5">
              <Search size={15} style={{ color: 'var(--color-text-muted)', position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('nutrition.prefsAvoidSearch', 'Search ingredients…')}
                className="w-full pl-9 pr-3 py-2.5 rounded-[12px] text-[14px] focus:outline-none"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
            </div>
            <div className="flex flex-wrap gap-2">
              {shown.map(i => <Chip key={i} active={avoid.includes(i)} onClick={() => toggleIn(avoid, setAvoid, i)}>{ingLabel(i)}</Chip>)}
            </div>
            {q && shown.length === 0 && (
              <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.prefsAvoidNone', 'No ingredient matches')}</p>
            )}
            {!q && (
              <p className="text-[11px] mt-2.5" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.prefsAvoidSearchHint', 'Search to avoid any of our ingredients')}</p>
            )}
          </div>
        </div>
        <div className="px-5 py-4 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
          <button onClick={handleSave} disabled={saving}
            className="w-full py-3.5 rounded-[14px] font-bold text-[14px] active:scale-[0.98] transition-all disabled:opacity-60"
            style={{ background: TU.accent, color: '#fff' }}>
            {saving ? '…' : t('nutrition.prefsSave', 'Save preferences')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── MY PLAN VIEW ───────────────────────────────────────────
const MyPlanView = ({ setView, onAddRecipeToGrocery, onOpenRecipe }) => {
  const { user, profile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const { showToast } = useToast();
  const lang = i18n.language || 'en';
  const planCacheKey = `nutrition-myplan-${user?.id || 'anon'}`;
  const [plan, setPlan] = useCachedState(`${planCacheKey}-plan`, null);
  const [macros, setMacros] = useCachedState(`${planCacheKey}-macros`, null);
  // Only show the skeleton on the first-ever visit — subsequent mounts paint cached data.
  const [loading, setLoading] = useState(!hasCachedState(`${planCacheKey}-plan`));
  const [weekOffset, setWeekOffset] = useState(0);
  const [activeDay, setActiveDay] = useState(() => {
    const d = new Date().getDay();
    return d; // Sun=0 ... Sat=6
  });
  // Logged foods for the displayed week, keyed by day-of-week (Sun=0..Sat=6).
  const [loggedByDay, setLoggedByDay] = useState({});
  // Regenerating-day spinner state — null when idle, day index when running.
  const [regenerating, setRegenerating] = useState(null);
  // Two-tap confirm for the destructive "Clear week" action (iOS-safe; window.confirm is dropped in the Capacitor WebView).
  const [confirmClear, setConfirmClear] = useState(false);

  // Recompute a day's macro totals from its meals (after a remove/clear).
  const sumTotals = (meals) => (meals || []).reduce((tot, m) => ({
    calories: (tot.calories || 0) + (m.calories || 0),
    protein: (tot.protein || 0) + (m.protein || 0),
    carbs: (tot.carbs || 0) + (m.carbs || 0),
    fat: (tot.fat || 0) + (m.fat || 0),
  }), {});

  // Persist a 7-day plan array to the active generated_meal_plans row (current
  // week) and update local state. Shared by generate / remove / clear so the
  // week_start + upsert shape stays in one place.
  const persistPlan = useCallback(async (nextPlan, targets) => {
    setPlan(nextPlan);
    if (!user?.id) return;
    // Target the DISPLAYED week (matches the reader). Only the current week is
    // the "active" one so the latest-active lookups (grocery fill) stay correct.
    const now = new Date();
    now.setDate(now.getDate() + weekOffset * 7);
    const sow = new Date(now);
    sow.setDate(sow.getDate() - sow.getDay());
    const weekStartStr = sow.toISOString().split('T')[0];
    try {
      await supabase.from('generated_meal_plans').upsert({
        profile_id: user.id, week_start: weekStartStr,
        plan_data: nextPlan, macro_targets: targets || macros || {}, is_active: weekOffset === 0,
      }, { onConflict: 'profile_id,week_start' });
    } catch (e) { console.error('[persistPlan]', e); }
  }, [user?.id, setPlan, macros, weekOffset]);

  // Food prefs (allergies / dietary restrictions / foods-to-avoid + learned
  // affinities) — loaded once and fed into every plan generation so the planner
  // hard-excludes unsafe/avoided meals and leans toward learned likes.
  const [prefs, setPrefs] = useState({ allergies: [], restrictions: [], avoid: [], affinities: {} });
  const [showPrefs, setShowPrefs] = useState(false);
  const loadPrefs = useCallback(async () => {
    if (!user?.id) return;
    const [ob, dis, aff] = await Promise.all([
      supabase.from('member_onboarding').select('food_allergies, dietary_restrictions').eq('profile_id', user.id).maybeSingle(),
      supabase.from('disliked_foods').select('food_name').eq('profile_id', user.id),
      loadAffinities(user.id),
    ]);
    if (ob.error || dis.error) console.warn('[loadPrefs]', ob.error || dis.error);
    setPrefs({
      allergies: ob.data?.food_allergies || [],
      restrictions: ob.data?.dietary_restrictions || [],
      avoid: (dis.data || []).map(d => d.food_name).filter(Boolean),
      affinities: aff || {},
    });
  }, [user?.id]);
  useEffect(() => { loadPrefs(); }, [loadPrefs]);

  const dayShorts = useMemo(() => lang === 'es'
    ? ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  [lang]);

  const dayLabels = useMemo(() => lang === 'es'
    ? ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  [lang]);

  // Compute week dates for the day strip
  const weekDates = useMemo(() => {
    const now = new Date();
    now.setDate(now.getDate() + weekOffset * 7);
    const monday = new Date(now);
    monday.setDate(monday.getDate() - monday.getDay()); // Sunday start
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d.getDate();
    });
  }, [weekOffset]);

  const weekLabel = useMemo(() => {
    if (weekOffset === 0) return t('nutrition.thisWeek', 'This week');
    if (weekOffset === -1) return t('nutrition.lastWeek', 'Last week');
    if (weekOffset === 1) return t('nutrition.nextWeek', 'Next week');
    return `${weekOffset > 0 ? '+' : ''}${weekOffset} ${t('nutrition.weeks', 'weeks')}`;
  }, [weekOffset, t]);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      // Only flip loading on when there's no cached data — avoids flashing the
      // skeleton on revisit; the stale plan stays visible while we refetch.
      if (!hasCachedState(`${planCacheKey}-plan`)) setLoading(true);
      // Load the plan for the DISPLAYED week (onboarding seeds ~4 weeks ahead, so
      // navigating forward shows real plans, not a repeat of week 1). Same UTC
      // Sunday calc as persistPlan so the week_start keys line up.
      const now = new Date();
      now.setDate(now.getDate() + weekOffset * 7);
      const sow = new Date(now);
      sow.setDate(sow.getDate() - sow.getDay());
      const weekStartStr = sow.toISOString().split('T')[0];
      let { data } = await supabase
        .from('generated_meal_plans')
        .select('plan_data, macro_targets, week_start')
        .eq('profile_id', user.id)
        .eq('week_start', weekStartStr)
        .maybeSingle();
      // Legacy fallback (current week only): older accounts have a single active
      // row whose week_start may not match today's Sunday exactly — keep showing it.
      if (!data && weekOffset === 0) {
        const res = await supabase
          .from('generated_meal_plans')
          .select('plan_data, macro_targets, week_start')
          .eq('profile_id', user.id)
          .eq('is_active', true)
          .order('week_start', { ascending: false })
          .limit(1)
          .maybeSingle();
        data = res.data;
      }
      if (data) { setPlan(data.plan_data); setMacros(data.macro_targets); }
      else { setPlan(Array.from({ length: 7 }, () => ({ meals: [], totals: {} }))); }
      setLoading(false);
    })();
  }, [user?.id, weekOffset, planCacheKey, setPlan, setMacros]);

  // Pull the user's actually-logged foods for the displayed week so we can
  // show "Logged" rows alongside the planned meals. The week starts Sunday.
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const now = new Date();
      now.setDate(now.getDate() + weekOffset * 7);
      const sunday = new Date(now);
      sunday.setDate(sunday.getDate() - sunday.getDay());
      sunday.setHours(0, 0, 0, 0);
      const saturday = new Date(sunday);
      saturday.setDate(sunday.getDate() + 6);
      const fmt = (d) => d.toISOString().slice(0, 10);
      const { data } = await supabase
        .from('food_logs')
        .select('id, calories, protein_g, carbs_g, fat_g, meal_type, log_date, custom_name, food_item:food_items(name, name_es)')
        .eq('profile_id', user.id)
        .gte('log_date', fmt(sunday))
        .lte('log_date', fmt(saturday));
      const grouped = {};
      (data || []).forEach(row => {
        const d = new Date(row.log_date + 'T00:00:00');
        const dow = d.getDay();
        if (!grouped[dow]) grouped[dow] = [];
        grouped[dow].push(row);
      });
      setLoggedByDay(grouped);
    })();
  }, [user?.id, weekOffset]);

  // Header shared across states
  const header = (
    <div className="flex items-center gap-3 px-5 pt-4 pb-3">
      <button onClick={() => setView('home')} className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 focus:outline-none"
        style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }} aria-label={t('common.back', 'Go back')}>
        <ChevronLeft size={18} style={{ color: 'var(--color-text-muted)' }} />
      </button>
      <div className="flex-1 truncate" style={{ fontFamily: TU.display, fontSize: 28, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -1, lineHeight: 1 }}>
        {t('nutrition.myPlan', 'My Plan')}
      </div>
      <button onClick={() => setShowPrefs(true)} className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 focus:outline-none"
        style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }} aria-label={t('nutrition.prefsTitle', 'Preferences')}>
        <SlidersHorizontal size={17} style={{ color: 'var(--color-text-muted)' }} />
      </button>
    </div>
  );

  if (loading) {
    return <div className="pb-28">{header}<div className="px-4 space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 rounded-[22px] animate-pulse" style={{ background: 'var(--color-bg-card)' }} />)}</div></div>;
  }

  if (!plan || !Array.isArray(plan) || plan.length === 0) {
    return (
      <div className="pb-28">
        {header}
        <div className="text-center py-12 px-5">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: `${TU.accent}12` }}>
            <UtensilsCrossed size={24} style={{ color: TU.accent }} />
          </div>
          <p className="text-[15px] font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>{t('nutrition.noPlanYet', 'No meal plan yet')}</p>
          <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.noPlanDesc', 'Generate a plan from your profile settings')}</p>
        </div>
      </div>
    );
  }

  const dayPlan = plan[activeDay] || plan[0] || { meals: [], totals: {} };
  const totals = dayPlan.totals || {};
  const dayMeals = dayPlan.meals || [];
  // Empty plan ⇒ the week button reads "Generate"; any meals present ⇒ "Regenerate".
  const planHasMeals = Array.isArray(plan) && plan.some(d => (d?.meals?.length || 0) > 0);
  const goalKcal = macros?.calories || 2400;
  const dayCal = totals.calories || dayMeals.reduce((s, m) => s + (m.calories || 0), 0);
  const dayP = totals.protein || dayMeals.reduce((s, m) => s + (m.protein || 0), 0);
  const dayC = totals.carbs || dayMeals.reduce((s, m) => s + (m.carbs || 0), 0);
  const dayF = totals.fat || dayMeals.reduce((s, m) => s + (m.fat || 0), 0);
  const pct = goalKcal > 0 ? dayCal / goalKcal : 0;

  const SLOT_LABELS = [t('nutrition.meals.breakfast'), t('nutrition.meals.lunch'), t('nutrition.meals.snack'), t('nutrition.meals.dinner')];

  return (
    <div className="pb-28">
      {header}

      {/* Week jumper card */}
      <div className="mx-4 mb-3 py-2.5 px-3.5 rounded-[14px] flex items-center justify-between"
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
        <button onClick={() => setWeekOffset(w => w - 1)} className="w-[30px] h-[30px] rounded-full flex items-center justify-center" style={{ background: 'transparent', border: 'none' }}>
          <ChevronLeft size={18} style={{ color: 'var(--color-text-primary)' }} />
        </button>
        <div className="text-center">
          <div style={{ fontFamily: TU.display, fontSize: 15, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{weekLabel}</div>
          <div className="text-[11px] mt-0.5 font-medium" style={{ color: 'var(--color-text-muted)' }}>
            {(() => {
              const mon = new Date();
              mon.setDate(mon.getDate() + weekOffset * 7 - ((mon.getDay() + 6) % 7));
              const sun = new Date(mon);
              sun.setDate(mon.getDate() + 6);
              const fmt = (d) => d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric' });
              return `${fmt(mon)} \u2013 ${fmt(sun)}, ${sun.getFullYear()}`;
            })()}
          </div>
        </div>
        <button onClick={() => setWeekOffset(w => w + 1)} className="w-[30px] h-[30px] rounded-full flex items-center justify-center" style={{ background: 'transparent', border: 'none' }}>
          <ChevronRight size={18} style={{ color: 'var(--color-text-primary)' }} />
        </button>
      </div>

      {/* Day strip — shows a small dot under days where the user actually
          logged at least one food, so the planned-vs-logged distinction is
          legible at a glance. */}
      <div className="flex gap-1.5 px-3 pb-4">
        {dayShorts.map((d, i) => {
          const active = i === activeDay;
          const hasLogs = (loggedByDay[i]?.length || 0) > 0;
          return (
            <button key={i} onClick={() => setActiveDay(i)}
              className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-[14px] active:scale-95 transition-all"
              style={{
                background: active ? 'var(--color-text-primary)' : 'var(--color-bg-card)',
                border: active ? 'none' : '1px solid var(--color-border-subtle)',
              }}>
              <span className="text-[10px] font-bold uppercase" style={{ color: active ? 'var(--color-bg-primary)' : 'var(--color-text-muted)', letterSpacing: 0.8 }}>{d}</span>
              <span style={{ fontFamily: TU.display, fontSize: 19, fontWeight: 800, color: active ? 'var(--color-bg-primary)' : 'var(--color-text-primary)', letterSpacing: -0.5, lineHeight: 1 }}>{weekDates[i]}</span>
              <span style={{
                width: 4, height: 4, borderRadius: 999,
                background: hasLogs ? (active ? 'var(--color-bg-primary)' : TU.accent) : 'transparent',
                marginTop: 2,
              }} />
            </button>
          );
        })}
      </div>

      {/* Day summary card */}
      <div className="px-4 mb-4">
        <div className="rounded-[18px] p-4" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>{t('nutrition.planned', 'Planned')}</div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span style={{ fontFamily: TU.display, fontSize: 32, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -1.2, lineHeight: 1 }}>{dayCal.toLocaleString()}</span>
                <span className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>/ {goalKcal}</span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold"
              style={{ background: `${TU.accent}12`, color: TU.accent }}>
              <Check size={11} strokeWidth={2.8} />
              {dayMeals.filter(m => m.eaten).length}/{dayMeals.length} {t('nutrition.eaten', 'eaten')}
            </span>
          </div>
          <div className="rounded-full overflow-hidden mb-3.5" style={{ height: 6, background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }}>
            <div style={{ width: `${Math.min(100, pct * 100)}%`, height: '100%', background: `linear-gradient(to right, ${TU.macroP}, ${TU.accent})`, borderRadius: 999, transition: 'width 500ms' }} />
          </div>
          <div className="flex gap-2.5">
            {[
              { l: 'P', v: dayP, c: TU.macroP },
              { l: 'C', v: dayC, c: TU.macroC },
              { l: 'F', v: dayF, c: TU.macroF },
            ].map(m => (
              <div key={m.l} className="flex-1 flex items-baseline justify-between px-3 py-2 rounded-[10px]" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.03))' }}>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-sm" style={{ background: m.c }} />
                  <span className="text-[11px] font-bold" style={{ color: 'var(--color-text-muted)' }}>{m.l}</span>
                </div>
                <span style={{ fontFamily: TU.display, fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>{m.v}<span className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>g</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Meals heading */}
      <div className="px-5 mb-3 flex items-baseline justify-between">
        <div style={{ fontFamily: TU.display, fontSize: 18, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.4 }}>
          {dayLabels[activeDay]} {weekDates[activeDay]} {'\u2014'} {t('nutrition.mealsLabel', 'meals')}
        </div>
        <button
          type="button"
          onClick={() => {
            // Pull every recipe referenced by this day's planned meals, hand
            // each to the parent's grocery handler so the existing dedupe +
            // category mapping kicks in.
            if (!onAddRecipeToGrocery) {
              showToast?.(t('nutrition.fillFromMealsError', 'Could not add to list'));
              return;
            }
            let added = 0;
            const seen = new Set();
            dayMeals.forEach(m => {
              const recipe = RECIPES.find(r => r.id === m.id);
              if (!recipe || seen.has(recipe.id)) return;
              seen.add(recipe.id);
              onAddRecipeToGrocery(recipe);
              added++;
            });
            showToast?.(added > 0
              ? t('nutrition.addedToGroceryList', 'Added to Grocery List')
              : t('nutrition.fillFromMealsEmpty', 'No active meal plan to pull from'));
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold focus:outline-none active:scale-95"
          style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
          <ShoppingCart size={12} />{t('nutrition.addToList', 'Add to list')}
        </button>
      </div>

      {/* Meal rows */}
      <div className="px-4 flex flex-col gap-2.5">
        {dayMeals.map((meal, mi) => {
          const mealData = MEALS.find(m => m.id === meal.id) || meal;
          const mealName = (lang === 'es' && (mealData.name_es || mealData.title_es)) || mealData.name || mealData.title || `Meal ${mi + 1}`;
          const mealCal = meal.calories || mealData.calories || 0;
          const mealP = meal.protein || mealData.protein || 0;
          const mealC = meal.carbs || mealData.carbs || 0;
          const mealF = meal.fat || mealData.fat || 0;
          // Label from the meal's own slot tag (set by the generator). Legacy
          // plans without tags fall back by position — 3-meal days are
          // breakfast/lunch/DINNER (the old 4-label array called a 3-meal
          // day's dinner a "snack").
          const slotKey = meal.slot
            || (dayMeals.length <= 3
              ? ['breakfast', 'lunch', 'dinner'][mi]
              : ['breakfast', 'lunch', 'snack', 'dinner'][mi]);
          const slot = slotKey ? t(`nutrition.meals.${slotKey}`) : SLOT_LABELS[3];
          const isEaten = !!meal.eaten;

          // Resolve to the full recipe (ingredients/steps/image) so tapping the
          // card always opens a populated detail modal. Match by id, then by
          // name for older plans whose ids drifted from the current MEALS data.
          const recipeForMeal = RECIPES.find(r => r.id === meal.id)
            || RECIPES.find(r => (r.title || r.name) === (meal.name || meal.title) && (meal.name || meal.title))
            || mealData;
          return (
            <div key={mi} className="rounded-[18px] p-3" style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle)',
              opacity: isEaten ? 0.72 : 1,
            }}>
              <button
                type="button"
                onClick={() => { if (onOpenRecipe && recipeForMeal) onOpenRecipe(recipeForMeal); }}
                className="w-full flex gap-3 items-center mb-2.5 text-left active:scale-[0.985] transition-transform">
                <FoodTile name={mealName} size={52} seed={mi} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>{slot}</span>
                    {isEaten && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                        style={{ background: `${TU.accent}15`, color: TU.accent, letterSpacing: 0.5 }}>
                        <Check size={9} strokeWidth={3} />{t('nutrition.eaten', 'Eaten')}
                      </span>
                    )}
                  </div>
                  <div className="truncate mb-1" style={{
                    fontFamily: TU.display, fontSize: 15, fontWeight: 800,
                    color: 'var(--color-text-primary)', letterSpacing: -0.2,
                    textDecoration: isEaten ? 'line-through' : 'none',
                  }}>{mealName}</div>
                  <div className="flex gap-2 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    <span><strong style={{ color: 'var(--color-text-primary)' }}>{mealCal}</strong> kcal</span>
                    <span><strong style={{ color: TU.macroP }}>{mealP}P</strong></span>
                    <span><strong style={{ color: TU.macroC }}>{mealC}C</strong></span>
                    <span><strong style={{ color: TU.macroF }}>{mealF}F</strong></span>
                  </div>
                </div>
              </button>
              {/* Action row */}
              <div className="flex gap-1.5 pt-2.5" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                <button
                  type="button"
                  onClick={() => {
                    const next = Array.isArray(plan) ? plan.map(d => ({ ...d })) : [];
                    const kept = (next[activeDay]?.meals || []).filter((_, idx) => idx !== mi);
                    next[activeDay] = { ...(next[activeDay] || {}), meals: kept, totals: sumTotals(kept) };
                    persistPlan(next, macros);
                    showToast?.(t('nutrition.mealRemoved', 'Removed from plan'));
                  }}
                  className="flex-1 py-2 rounded-[10px] text-[11px] font-bold flex items-center justify-center gap-1.5 active:scale-95"
                  style={{ color: 'var(--color-danger)', background: 'transparent', border: 'none' }}>
                  <Trash2 size={12} />{t('nutrition.removeMeal', 'Remove')}
                </button>
                {/* Per-meal "Add to grocery list" — pulls this recipe's
                    ingredients via the parent's handler, which dedupes and
                    categorises. Shows a toast if the meal isn't a known recipe. */}
                <button
                  type="button"
                  onClick={() => {
                    const recipe = RECIPES.find(r => r.id === meal.id);
                    if (!recipe || !onAddRecipeToGrocery) {
                      showToast?.(t('nutrition.fillFromMealsError', 'Could not add to list'));
                      return;
                    }
                    onAddRecipeToGrocery(recipe);
                    showToast?.(t('nutrition.addedToGroceryList', 'Added to Grocery List'));
                  }}
                  className="flex-1 py-2 rounded-[10px] text-[11px] font-bold flex items-center justify-center gap-1.5 active:scale-95"
                  style={{ color: 'var(--color-text-muted)', background: 'transparent', border: 'none' }}>
                  <ShoppingCart size={12} />{t('nutrition.list', 'List')}
                </button>
                <button className="flex-1 py-2 rounded-[10px] text-[11px] font-bold flex items-center justify-center gap-1.5 active:scale-95"
                  style={{ color: isEaten ? 'var(--color-text-muted)' : TU.accent, background: isEaten ? 'transparent' : `${TU.accent}12`, border: 'none' }}>
                  <Check size={12} strokeWidth={2.8} />{isEaten ? t('nutrition.unlog', 'Unlog') : t('nutrition.eaten', 'Eaten')}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Logged foods — actually-eaten items the user logged today, shown
          alongside planned meals so the My Plan view reflects reality, not
          just the prescription. Each row carries a "Logged" badge so the
          distinction is unmistakable. */}
      {(loggedByDay[activeDay]?.length || 0) > 0 && (
        <div className="px-4 pt-4">
          <div style={{ fontFamily: TU.display, fontSize: 13, fontWeight: 800, color: 'var(--color-text-muted)', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 }}>
            {t('nutrition.loggedToday', 'Logged')}
          </div>
          <div className="flex flex-col gap-2">
            {(loggedByDay[activeDay] || []).map((row) => {
              const fi = row.food_item || {};
              const dispName = (lang === 'es' && fi.name_es) ? fi.name_es : (fi.name || row.custom_name || t('nutrition.foodDetail', 'Food detail'));
              return (
                <div key={row.id} className="rounded-[14px] p-3 flex items-center gap-3"
                  style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                        style={{ background: `${TU.accent}15`, color: TU.accent, letterSpacing: 0.5 }}>
                        <Check size={9} strokeWidth={3} />{t('nutrition.loggedBadge', 'Logged')}
                      </span>
                      <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>
                        {t(`nutrition.mealTypes.${row.meal_type || 'snack'}`, row.meal_type || '')}
                      </span>
                    </div>
                    <div className="truncate" style={{ fontFamily: TU.display, fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>
                      {dispName}
                    </div>
                    <div className="flex gap-2 text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      <span><strong style={{ color: 'var(--color-text-primary)' }}>{Math.round(row.calories || 0)}</strong> kcal</span>
                      <span><strong style={{ color: TU.macroP }}>{Math.round(row.protein_g || 0)}P</strong></span>
                      <span><strong style={{ color: TU.macroC }}>{Math.round(row.carbs_g || 0)}C</strong></span>
                      <span><strong style={{ color: TU.macroF }}>{Math.round(row.fat_g || 0)}F</strong></span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Regenerate day button — scopes regeneration to ONLY the active day's
          meals. Previously this had no onClick, so taps fell through to the
          page itself; field testers reported it "regenerated the whole week"
          which was actually the regenerate-week button getting hit through
          taps near the bottom. */}
      <div className="px-4 pt-4 pb-2">
        <button
          type="button"
          disabled={regenerating !== null}
          onClick={async () => {
            if (!user?.id) return;
            try {
              setRegenerating(activeDay);
              const macroTargets = macros || { calories: 2400, protein: 150, carbs: 250, fat: 80 };
              // Exclude current day's meals so regeneration produces variation,
              // and treat all other days' meals as "recent" so the planner pushes
              // them down for cross-day variety.
              const currentDayIds = (plan?.[activeDay]?.meals || []).map(m => m.id).filter(Boolean);
              const otherDayIds = Array.isArray(plan)
                ? plan.flatMap((d, i) => i === activeDay ? [] : (d?.meals || []).map(m => m.id).filter(Boolean))
                : [];
              const fresh = generateDayPlan({
                targets: {
                  calories: macroTargets.calories || 2400,
                  protein: macroTargets.protein || macroTargets.daily_protein_g || 150,
                  carbs: macroTargets.carbs || macroTargets.daily_carbs_g || 250,
                  fat: macroTargets.fat || macroTargets.daily_fat_g || 80,
                },
                slots: 4,
                excludeIds: currentDayIds,
                recentMealIds: otherDayIds,
                allergies: prefs.allergies,
                restrictions: prefs.restrictions,
                avoidIngredients: prefs.avoid,
                affinities: prefs.affinities,
              });
              const nextPlan = Array.isArray(plan) ? [...plan] : [];
              while (nextPlan.length < 7) nextPlan.push({ meals: [], totals: {} });
              const newMeals = (fresh.meals || []).map(m => ({
                id: m.id, name: m.title, name_es: m.title_es,
                calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat,
                eaten: false,
              }));
              nextPlan[activeDay] = {
                ...nextPlan[activeDay],
                meals: newMeals,
                totals: fresh.totals || {},
              };
              await persistPlan(nextPlan, macroTargets);
              showToast?.(t('nutrition.regenerateDayDone', 'Day regenerated'));
            } catch (err) {
              console.error('[regenerateDay]', err);
              showToast?.(t('nutrition.regenerateDayFailed', 'Could not regenerate day'));
            } finally {
              setRegenerating(null);
            }
          }}
          className="w-full py-3.5 rounded-[14px] text-[13px] font-bold flex items-center justify-center gap-2 active:scale-[0.97] transition-all"
          style={{ background: 'transparent', border: '1.5px dashed var(--color-border-subtle)', color: 'var(--color-text-muted)', opacity: regenerating === activeDay ? 0.6 : 1 }}>
          <Sparkles size={14} style={{ color: TU.coach }} />
          {regenerating === activeDay
            ? t('nutrition.regeneratingDay', 'Regenerating…')
            : (dayMeals.length > 0
              ? t('nutrition.regenerateDay', 'Regenerate this day')
              : t('nutrition.generateDay', 'Generate this day'))}
        </button>
      </div>

      {/* Regenerate week CTA */}
      <div className="px-4 pb-6">
        <button
          type="button"
          disabled={regenerating === 'week'}
          onClick={async () => {
            if (!user?.id) return;
            if (weekOffset < 0) { showToast?.(t('nutrition.cantGeneratePast', "Can't change a past week")); return; }
            try {
              setRegenerating('week');
              const macroTargets = macros || { calories: 2400, protein: 150, carbs: 250, fat: 80 };
              const targetsArg = {
                calories: macroTargets.calories || macroTargets.daily_calories || 2400,
                protein: macroTargets.protein || macroTargets.daily_protein_g || 150,
                carbs: macroTargets.carbs || macroTargets.daily_carbs_g || 250,
                fat: macroTargets.fat || macroTargets.daily_fat_g || 80,
              };
              // Fill only the days REMAINING in the displayed week: current week ⇒
              // today→Saturday (earlier days keep whatever was already planned);
              // a future week fills all 7. Past weeks are blocked above.
              const fillFrom = weekOffset === 0 ? new Date().getDay() : 0;
              const existing = Array.isArray(plan) ? plan : [];
              const wasFresh = !existing.slice(fillFrom).some(d => (d?.meals?.length || 0) > 0);
              const week = generateWeekPlan({ targets: targetsArg, favorites: [], lang, allergies: prefs.allergies, restrictions: prefs.restrictions, avoidIngredients: prefs.avoid, affinities: prefs.affinities });
              const nextPlan = Array.from({ length: 7 }, (_, i) => {
                if (i < fillFrom) return existing[i] || { meals: [], totals: {} };
                const day = week[i] || { meals: [], totals: {} };
                const newMeals = (day.meals || []).map(m => ({
                  id: m.id, name: m.title, name_es: m.title_es,
                  calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat,
                  eaten: false,
                }));
                return { meals: newMeals, totals: day.totals || {} };
              });
              await persistPlan(nextPlan, targetsArg);
              showToast?.(wasFresh
                ? t('nutrition.generateWeekDone', 'Week generated')
                : t('nutrition.regenerateWeekDone', 'Week regenerated'));
            } catch (err) {
              console.error('[regenerateWeek]', err);
              showToast?.(t('nutrition.regenerateWeekFailed', 'Could not regenerate week'));
            } finally {
              setRegenerating(null);
            }
          }}
          className="w-full py-3.5 rounded-[14px] text-[14px] font-bold flex items-center justify-center gap-2 active:scale-[0.97] transition-all disabled:opacity-60"
          style={{ background: TU.coach, color: '#fff', letterSpacing: -0.2 }}>
          <Sparkles size={15} className="text-white" />
          {regenerating === 'week'
            ? t('nutrition.regeneratingWeek', 'Regenerating week…')
            : (planHasMeals
              ? t('nutrition.regenerateWeek', 'Regenerate week')
              : t('nutrition.generateWeek', 'Generate week'))}
        </button>
      </div>

      {/* Clear week — destructive, so a two-tap confirm (iOS-safe; window.confirm
          is dropped in the Capacitor WebView). Only shown when there's a plan. */}
      {planHasMeals && (
        <div className="px-4 pb-8 -mt-3">
          {confirmClear ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="flex-1 py-2.5 rounded-[12px] text-[12px] font-bold active:scale-95"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}>
                {t('nutrition.keepPlan', 'Keep')}
              </button>
              <button
                type="button"
                onClick={() => {
                  const empty = Array.from({ length: 7 }, () => ({ meals: [], totals: {} }));
                  persistPlan(empty, macros);
                  setConfirmClear(false);
                  showToast?.(t('nutrition.weekCleared', 'Week cleared'));
                }}
                className="flex-1 py-2.5 rounded-[12px] text-[12px] font-bold flex items-center justify-center gap-1.5 active:scale-95"
                style={{ background: 'var(--color-danger)', color: '#fff', border: 'none' }}>
                <Trash2 size={12} />{t('nutrition.clearWeek', 'Clear week')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="w-full py-2.5 text-[12px] font-bold flex items-center justify-center gap-1.5 active:scale-95"
              style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)' }}>
              <Trash2 size={12} />{t('nutrition.clearWeek', 'Clear week')}
            </button>
          )}
        </div>
      )}

      <MealPrefsSheet
        open={showPrefs}
        onClose={() => setShowPrefs(false)}
        userId={user?.id}
        gymId={profile?.gym_id}
        initialAllergies={prefs.allergies}
        initialRestrictions={prefs.restrictions}
        initialAvoid={prefs.avoid}
        onSaved={({ allergies, restrictions, avoid }) => {
          setPrefs(p => ({ ...p, allergies, restrictions, avoid }));
          setShowPrefs(false);
          showToast?.(t('nutrition.prefsSaved', 'Preferences saved'));
          loadPrefs();
        }}
      />
    </div>
  );
};

// NOTE: The in-page bottom nav (NutritionNav) was removed. Nutrition is not a
// separate "app" — its sub-pages (Recipes / Saved / Grocery) are reached from
// the Home view and keep the app's real header + bottom nav. My Plan is the
// Home "My Plan" button (→ WeeklyMealPlanner); there is no second plan surface.

// ── MAIN ─────────────────────────────────────────────────────
export default function Nutrition({ embedded = false }) {
  const { user, profile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const posthog = usePostHog();
  const { showToast } = useToast();
  const nutritionEnabled = useFeatureEnabled('nutrition');
  // Platform kill switch for the OpenAI photo surfaces (Operations →
  // feature_ai, migration 0551). Hides the AI/Menu scan pills entirely —
  // barcode + search stay. A layer ABOVE the per-user aiConsent gate.
  const aiEnabled = useFeatureEnabled('ai');
  const lang = i18n.language || 'en';
  // Whether this page is the actual route + tab the user is on right now.
  // Used to gate document.body portals (the floating scan FAB, fullscreen
  // sub-view overlays) so they don't bleed onto other pages while
  // Nutrition is kept alive in the background via display:none in
  // MemberRoutes — and, when embedded inside Progress, while Progress
  // keeps the nutrition tab mounted via loadedTabs even when the user
  // swipes to another tab.
  //
  // Two entry routes:
  //   /nutrition           — standalone, always active when this is the path
  //   /progress?tab=nutrition — embedded inside Progress, ONLY active when
  //                          the URL's tab query is 'nutrition' (Progress
  //                          uses SwipeableTabView with visibility:hidden,
  //                          which doesn't hide portaled elements)
  const nutritionLocation = useLocation();
  const [nutritionSearchParams] = useSearchParams();
  const isPageActive = embedded
    ? (nutritionLocation.pathname === '/progress'
       && (nutritionSearchParams.get('tab') || '').toLowerCase() === 'nutrition')
    : nutritionLocation.pathname === '/nutrition';

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
  // Fullscreen "Logging…" overlay while a food_logs insert is in flight.
  const [loggingFood, setLoggingFood] = useState(false);
  const [barcodeProduct, setBarcodeProduct] = useState(null);
  const [barcodeError, setBarcodeError] = useState('');
  // True only when the barcode was read fine but the product isn't in the
  // Open Food Facts DB (common for PR-local brands). Drives the "Scan with
  // AI instead" shortcut on the error dialog — we DON'T offer AI for a real
  // network failure, where it would fail the same way.
  const [barcodeNotFound, setBarcodeNotFound] = useState(false);
  // 'barcode' = auto-decode via html5-qrcode, 'ai' = pause decoder, use shutter to grab frame.
  // Single camera stream (html5-qrcode) is shared between both modes — switching only toggles
  // whether decode callbacks run and what the shutter does. No second camera is ever opened.
  const [scanMode, setScanMode] = useState('barcode');
  // ── Menu scan state ──
  const [menuAnalyzing, setMenuAnalyzing] = useState(false);
  const [menuResult, setMenuResult] = useState(null);
  const [menuError, setMenuError] = useState('');
  // ── AI third-party consent (Apple 5.1.2) ──
  // `aiConsentRequest` holds the pending action to run after the user agrees.
  // { feature: 'food-analysis'|'menu-analysis', run: () => void }
  const [aiConsentRequest, setAiConsentRequest] = useState(null);

  // Run `fn` only after the user has consented to AI processing for `feature`.
  // If consent is already on file, fn() runs immediately; otherwise the consent
  // dialog is shown and fn() runs after they tap "I Agree".
  const requireAIConsent = useCallback((feature, fn) => {
    if (hasConsentedToAI(feature)) {
      fn();
      return;
    }
    setAiConsentRequest({ feature, run: fn });
  }, []);
  // Unified scan-result modal state
  const [scanResult, setScanResult] = useState(null); // { food, source: 'barcode'|'ai' }
  // Scanned food favorites (food_favorites table — name-keyed, separate from favorite_foods)
  const [scannedFavorites, setScannedFavorites] = useState([]);
  // Recently scanned foods (localStorage-backed, max 20)
  const [recentScans, setRecentScans] = useState(() => {
    try {
      // We don't have user.id yet at init, so leave empty — loaded in effect.
      return [];
    } catch { return []; }
  });

  useEffect(() => { document.title = `${t('nutrition.title')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

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
      // Apple 5.1.2 / GDPR Art. 7: a background resume MUST NOT silently
      // re-fire the analyze-food-photo edge function if the user has since
      // revoked consent. Discard rather than re-prompt — the resume path is
      // a safety net, not a feature entry point.
      if (!hasConsentedToAI('food-analysis')) {
        try {
          localStorage.removeItem('_pendingFoodBase64');
          localStorage.removeItem('_pendingFoodThumb');
          localStorage.removeItem('_pendingFoodTimestamp');
        } catch {}
        return;
      }
      // TTL guard: ignore stale pending scans (>24h). The user has clearly
      // moved on and we shouldn't re-process old photos automatically.
      const tsRaw = localStorage.getItem('_pendingFoodTimestamp');
      const tsNum = tsRaw ? Number(tsRaw) : NaN;
      if (Number.isFinite(tsNum) && (Date.now() - tsNum) > 24 * 60 * 60 * 1000) {
        try {
          localStorage.removeItem('_pendingFoodBase64');
          localStorage.removeItem('_pendingFoodThumb');
          localStorage.removeItem('_pendingFoodTimestamp');
        } catch {}
        return;
      }
      localStorage.removeItem('_pendingFoodBase64');
      localStorage.removeItem('_pendingFoodThumb');
      localStorage.removeItem('_pendingFoodTimestamp');
      setPhotoAnalyzing(true);
      setPhotoPreview(pendingThumb || null);
      (async () => {
        try {
          await ensureFreshSession();
          const { data, error: fnError } = await withTimeout(
            supabase.functions.invoke('analyze-food-photo', {
              body: { image: pendingB64, language: i18n.language },
            }),
            40000,
            t('nutrition.errorAnalysisTimeout', 'Analysis timed out. Please try again.'),
          );
          const result = data || {};
          if (fnError) {
            let msg = fnError.message || t('nutrition.errorAnalysisService', 'Analysis service error');
            try { const b = await fnError.context?.json(); if (b?.error) msg = b.error; } catch {}
            throw new Error(msg);
          }
          if (result.error === 'no_food_detected') throw new Error(t('nutrition.errorNoFoodDetected', 'No food detected in the image. Try a clearer photo.'));
          if (result.error) throw new Error(result.error);
          if (!result.items?.length) throw new Error(t('nutrition.errorCouldNotIdentify', 'Could not identify food items'));
          setPhotoResult(result);
        } catch (err) {
          setPhotoError(isSessionError(err) ? t('nutrition.sessionExpired', 'Please sign in again to continue.') : (err.message || t('nutrition.errorAnalyzeFailed', 'Failed to analyze food photo. Please try again.')));
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

  // Per-meal thumbs (likes/dislikes) → meal_ratings → affinity learning.
  const [mealRatings, setMealRatings] = useState({});
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    supabase.from('meal_ratings').select('meal_id, rating').eq('profile_id', user.id)
      .then(({ data }) => {
        if (cancelled) return;
        const map = {};
        (data || []).forEach(r => { map[r.meal_id] = r.rating; });
        setMealRatings(map);
      });
    return () => { cancelled = true; };
  }, [user?.id]);
  const handleRateMeal = useCallback(async (mealId, rating) => {
    setMealRatings(prev => { const n = { ...prev }; if (!rating) delete n[mealId]; else n[mealId] = rating; return n; });
    if (!rating) {
      await supabase.from('meal_ratings').delete().eq('profile_id', user.id).eq('meal_id', mealId);
      rebuildAffinities(user.id, profile?.gym_id).catch(() => {});
    } else {
      rateMeal(user.id, profile?.gym_id, mealId, rating);
    }
  }, [user?.id, profile?.gym_id]);
  // Portion-adjust sheet for logging a suggested meal
  const [logMealSheet, setLogMealSheet] = useState(null);
  const [savedRecipeIds, setSavedRecipeIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('saved_recipes') || '[]')); } catch { return new Set(); }
  });
  const [groceryList, setGroceryList] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('grocery_list') || '[]');
      const seen = new Set();
      return raw.filter(i => {
        if (!i?.id || seen.has(i.id)) return false;
        seen.add(i.id);
        return true;
      });
    } catch { return []; }
  });
  const [groceryAdded, setGroceryAdded] = useState(new Set());

  // Lock body scroll when any modal is open
  const anyModalOpen = !!openRecipe || !!openCollection || searchOpen || !!logFood || photoAnalyzing || !!photoResult || !!photoError || !!detailLog || editing || !!logMealSheet;
  useEffect(() => {
    if (anyModalOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [anyModalOpen]);

  // The scan / barcode / menu / logging overlays above aren't part of
  // anyModalOpen — lock the background for those too (ref-counted hook).
  useScrollLock(
    barcodeScanning || barcodeLoading || !!barcodeError || !!barcodeProduct ||
    loggingFood || menuAnalyzing || !!menuError || !!menuResult || !!scanResult
  );

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
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        posthog?.capture('recipe_saved');
      }
      return next;
    });
  };

  // `opts.day` (YYYY-MM-DD) tags the ingredient with the plan day it's needed —
  // so the grocery list can section by day → then food. Omitted for one-off
  // "Add to grocery" from a recipe (those collect under "Anytime").
  const handleAddToGrocery = (recipe, opts = {}) => {
    const day = opts.day || null;
    const allIngredients = Object.values(INGREDIENT_CATEGORIES || {}).flat();
    const recipeTitle = (lang === 'es' && recipe.title_es) ? recipe.title_es : recipe.title;
    setGroceryList(prev => {
      const existingIds = new Set(prev.map(i => i.id));
      const additions = recipe.ingredients
        .map((ing, i) => {
          const id = `${ing}_${recipe.id}${day ? '_' + day : ''}`;
          if (existingIds.has(id)) return null;
          const match = allIngredients.find(i => i.id === ing);
          const catEntry = Object.entries(INGREDIENT_CATEGORIES || {}).find(([, items]) => items.some(i => i.id === ing));
          // Palette category when known (curated), else classify by keyword so
          // exotic recipe ingredients still land in a real food group.
          const categoryKey = catEntry ? catEntry[0].toLowerCase() : classifyIngredientKey(ing);
          return {
            id,
            ing,                                                     // raw key (grouping)
            label: t(`nutrition_ingredients.items.${ing}`, match?.label || ing.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())),
            category: groceryCatLabel(t, categoryKey),
            categoryKey,
            imgSlug: ingredientImageSlug(ing),                       // uploaded slug (exact or alias), or null → letter tile
            amount: (recipe.ingredientAmounts?.[i] || '').toString().trim() || null, // how much this recipe needs
            fromRecipe: recipeTitle,
            recipeId: recipe.id,                                     // for "already added" checks in the planner
            day,
            addedDate: toLocalDateStr(new Date()),                   // when it hit the list (fallback grouping for undated items)
            checked: false,
          };
        })
        .filter(Boolean);
      return [...prev, ...additions];
    });
    setGroceryAdded(prev => new Set([...prev, recipe.id]));
  };

  // Pre-shaped grocery items (e.g. the coach meal-plan section builds its own
  // {id,label,category,fromRecipe,checked} rows) — merge with id-dedup so
  // re-adding never duplicates.
  const handleAddGroceryItemsRaw = (items) => {
    if (!Array.isArray(items) || items.length === 0) return;
    setGroceryList(prev => {
      const existingIds = new Set(prev.map(i => i.id));
      const additions = items.filter(i => i?.id && !existingIds.has(i.id));
      return additions.length ? [...prev, ...additions] : prev;
    });
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

  // Plan ↔ grocery sync. When a planned meal is REMOVED from My Plan, pull its
  // grocery items back off the list (match the same recipe + day set that
  // `mealInList` uses to show the green "Added" state). Undated items from the
  // same recipe (added via recipe-detail, not the planner) are pulled too.
  const handleRemoveRecipeFromGrocery = useCallback((recipeId, day) => {
    if (recipeId == null) return;
    setGroceryList(prev => prev.filter(i =>
      !(i.recipeId === recipeId && (i.day === day || i.day == null))));
  }, []);

  // When a planned meal is marked EATEN, flag its grocery items as acquired +
  // eaten so the list reflects "already bought and used" instead of still-to-buy.
  const handleMarkMealEaten = useCallback((recipeId, day) => {
    if (recipeId == null) return;
    setGroceryList(prev => prev.map(i =>
      (i.recipeId === recipeId && (i.day === day || i.day == null))
        ? { ...i, checked: true, eaten: true }
        : i));
  }, []);

  // "Lista nueva" / "New list" — clears the grocery list (with confirm).
  const handleClearGroceryList = useCallback(() => {
    if (groceryList.length === 0) {
      // Already empty — nothing to do, but acknowledge so the click isn't silent.
      showToast?.(t('nutrition.groceryListEmpty', 'Your grocery list is empty'));
      return;
    }
    const ok = window.confirm(
      lang === 'es'
        ? '¿Vaciar tu lista de compras y empezar una nueva?'
        : 'Clear your grocery list and start a new one?'
    );
    if (!ok) return;
    setGroceryList([]);
    setGroceryAdded(new Set());
  }, [groceryList.length, lang, showToast, t]);

  // "Rellenar desde comidas" / "Fill from meals" — pulls ingredients from the
  // SAME weekly plan the "My Plan" tab shows: localStorage `meal_plan_<uid>_<ws>`
  // (format { weekStart, days:{[date]:{breakfast,lunch,dinner}} }), with the DB
  // `meal_plans` mirror as fallback. Previously it read `generated_meal_plans`,
  // a disconnected store — that's why it once pulled 122 items while My Plan was
  // empty. Re-uses handleAddToGrocery's dedupe + category mapping.
  const handleFillFromMeals = useCallback(async (weeks = 1) => {
    if (!user?.id) {
      showToast?.(t('nutrition.fillFromMealsEmpty', 'No active meal plan to pull from'));
      return;
    }
    try {
      // Shop the plan for N consecutive weeks (1 = this week, 4 ≈ a month), so
      // the list isn't locked to week-to-week.
      const n = Math.max(1, Math.min(6, (weeks | 0) || 1));
      const baseWs = getWeekStartDate();
      const days = {};
      for (let w = 0; w < n; w++) {
        const d = new Date(baseWs + 'T12:00:00');
        d.setDate(d.getDate() + w * 7);
        const ws = toLocalDateStr(d);
        let wkDays = null;
        try { const raw = localStorage.getItem(`meal_plan_${user.id}_${ws}`); if (raw) wkDays = JSON.parse(raw).days || {}; } catch { /* parse — ignore */ }
        if (!wkDays || !Object.keys(wkDays).length) {
          const { data } = await supabase.from('meal_plans').select('plan_data').eq('profile_id', user.id).eq('week_start', ws).maybeSingle();
          wkDays = (data?.plan_data && typeof data.plan_data === 'object' && !Array.isArray(data.plan_data)) ? data.plan_data : {};
        }
        Object.assign(days, wkDays);
      }
      // Only shop for days that haven't happened yet — no reason to buy for the past.
      const todayS = toLocalDateStr(new Date());
      const seen = new Set(); // dedup per (recipe, day) — same dish on two days shops both
      let added = 0;
      Object.entries(days).forEach(([date, slots]) => {
        if (date < todayS) return;
        // Iterate the day's ACTUAL slots (breakfast/lunch/dinner + any snacks)
        // so snack meals get shopped too.
        Object.keys(slots || {}).forEach(slot => {
          const m = slots?.[slot];
          if (!m?.id) return;
          // Prefer the full library recipe (carries the ingredient list); fall
          // back to the stored slot object for custom entries.
          const recipe = RECIPES.find(r => r.id === m.id) || m;
          const dedup = `${recipe.id}_${date}`;
          if (!recipe.ingredients?.length || seen.has(dedup)) return;
          seen.add(dedup);
          handleAddToGrocery(recipe, { day: date });
          added++;
        });
      });
      if (added === 0) {
        showToast?.(t('nutrition.fillFromMealsEmpty', 'No active meal plan to pull from'));
      } else {
        showToast?.(t('nutrition.fillFromMealsDone', 'Added ingredients from your plan'));
      }
    } catch (err) {
      console.warn('[fill-from-meals]', err);
      showToast?.(t('nutrition.fillFromMealsError', 'Could not fill from meals'));
    }
  }, [user?.id, showToast, t]);

  // Load data
  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);

    try {
    const [{ data: tgt }, { data: ob }, { data: bw }, { data: foodLogs }, { data: favs }] = await Promise.all([
      supabase.from('nutrition_targets').select('*').eq('profile_id', user.id).maybeSingle(),
      supabase.from('member_onboarding').select('primary_goal,training_days_per_week,initial_weight_lbs,height_inches,age,sex').eq('profile_id', user.id).maybeSingle(),
      supabase.from('body_weight_logs').select('weight_lbs').eq('profile_id', user.id).order('logged_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('food_logs').select('id, food_item_id, source, calories, protein_g, carbs_g, fat_g, meal_type, servings, custom_name, photo_url, created_at, log_date, food_item:food_items(name, name_es, brand, serving_size, serving_unit, image_url)').eq('profile_id', user.id).eq('log_date', todayStr()).order('created_at', { ascending: false }).limit(100),
      supabase.from('favorite_foods').select('food_item_id, food_item:food_items(id, name, name_es, brand, image_url, serving_size, serving_unit, calories, protein_g, carbs_g, fat_g)').eq('profile_id', user.id).limit(200),
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
    } catch {
      // A rejected query must not strand the full-page skeleton (no cache paint
      // on this page); the offline banner covers the hard-offline case.
    } finally {
      setLoading(false);
    }
  }, [user, profile]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!user) return;
    // "Recent foods" only needs a recent window — bound by log_date (indexed:
    // idx_food_logs_profile_date) so the planner doesn't top-N sort the user's
    // ENTIRE food_logs history by the unindexed created_at to satisfy LIMIT 50.
    const recentSince = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    supabase.from('food_logs').select('food_item_id, food_item:food_items(id, name, name_es, brand, image_url, serving_size, serving_unit, calories, protein_g, carbs_g, fat_g)')
      .eq('profile_id', user.id).gte('log_date', recentSince).order('created_at', { ascending: false }).limit(50)
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

  // ── Recently-scanned foods (localStorage, per-user, max 20) ──
  useEffect(() => {
    if (!user?.id) return;
    try {
      const raw = localStorage.getItem(`recent_scans-${user.id}`);
      setRecentScans(raw ? JSON.parse(raw) : []);
    } catch { setRecentScans([]); }
  }, [user?.id]);

  const pushRecentScan = useCallback((food) => {
    if (!user?.id || !food?.name) return;
    setRecentScans(prev => {
      const name = cleanFoodName(food.name) || food.name;
      const entry = {
        name,
        brand: food.brand || null,
        image_url: food.image_url || null,
        calories: food.calories || 0,
        protein_g: food.protein_g || 0,
        carbs_g: food.carbs_g || 0,
        fat_g: food.fat_g || 0,
        serving_size: food.serving_size ?? null,
        serving_unit: food.serving_unit ?? 'g',
        source: food.source || 'scan',
        nutri_score: food.nutri_score ?? null,
        scanned_at: new Date().toISOString(),
      };
      const deduped = prev.filter(r => (r.name || '').toLowerCase() !== name.toLowerCase());
      const next = [entry, ...deduped].slice(0, 20);
      try { localStorage.setItem(`recent_scans-${user.id}`, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [user?.id]);

  // ── Scanned-food favorites (name-keyed food_favorites table) ──
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('food_favorites')
      .select('id, food_name, food_image_url, brand_name, calories, protein_g, carbs_g, fat_g, serving_size, nutri_score, created_at')
      .eq('profile_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setScannedFavorites(data || []));
  }, [user?.id]);

  const isScannedFavorite = useCallback((food) => {
    if (!food?.name) return false;
    const name = (food.name || '').toLowerCase();
    return scannedFavorites.some(f => (f.food_name || '').toLowerCase() === name);
  }, [scannedFavorites]);

  const handleToggleScannedFavorite = useCallback(async (food) => {
    if (!user?.id || !food?.name) return;
    const existing = scannedFavorites.find(f => (f.food_name || '').toLowerCase() === food.name.toLowerCase());
    if (existing) {
      await supabase.from('food_favorites').delete().eq('id', existing.id).eq('profile_id', user.id);
      setScannedFavorites(prev => prev.filter(f => f.id !== existing.id));
    } else {
      const payload = {
        profile_id: user.id,
        food_name: food.name,
        food_image_url: food.image_url || null,
        brand_name: food.brand || null,
        calories: food.calories ?? null,
        protein_g: food.protein_g ?? null,
        carbs_g: food.carbs_g ?? null,
        fat_g: food.fat_g ?? null,
        serving_size: food.serving_size != null ? String(food.serving_size) : null,
        nutri_score: food.nutri_score ?? null,
      };
      const { data } = await supabase.from('food_favorites').insert(payload).select().single();
      if (data) setScannedFavorites(prev => [data, ...prev]);
    }
  }, [user?.id, scannedFavorites]);

  const openScannedFavorite = useCallback((f) => {
    setScanResult({
      source: 'search',
      food: {
        name: f.food_name,
        brand: f.brand_name,
        image_url: f.food_image_url,
        calories: Number(f.calories) || 0,
        protein_g: Number(f.protein_g) || 0,
        carbs_g: Number(f.carbs_g) || 0,
        fat_g: Number(f.fat_g) || 0,
        serving_size: f.serving_size ? parseFloat(f.serving_size) : 100,
        serving_unit: 'g',
        nutri_score: f.nutri_score,
      },
    });
  }, []);

  // ── Barcode scanning ──
  // Ref-like flag so the decode callback can check the current mode without
  // being re-created on every mode change (the Html5Qrcode.start() callback is
  // captured once at start time).
  const scanModeRef = useRef('barcode');
  useEffect(() => { scanModeRef.current = scanMode; }, [scanMode]);

  // If the platform AI kill switch flips while the user is mid AI/menu mode,
  // fall back to barcode (mirrors how the consent decline path keeps the user
  // in barcode mode). The AI/Menu pills are hidden while the flag is off, so
  // this only fires on a live flip.
  useEffect(() => {
    if (!aiEnabled && (scanMode === 'ai' || scanMode === 'menu')) {
      setScanMode('barcode');
      scanModeRef.current = 'barcode';
    }
  }, [aiEnabled, scanMode]);

  const handleBarcodeRequest = useCallback(async (signal) => {
    if (signal === '__open_scanner__') {
      setSearchOpen(false);
      setBarcodeError('');
      setBarcodeNotFound(false);
      setBarcodeProduct(null);
      setScanMode('barcode');
      scanModeRef.current = 'barcode';

      const processBarcode = async (rawValue) => {
        setBarcodeScanning(false);
        setBarcodeLoading(true);
        setBarcodeNotFound(false);
        try {
          const product = await lookupBarcode(rawValue, lang);
          if (!product) {
            setBarcodeNotFound(true);
            setBarcodeError(t('nutrition.productNotFound'));
          } else {
            posthog?.capture('food_scanned', { method: 'barcode' });
            setBarcodeProduct(product);
          }
        } catch (err) {
          setBarcodeError(err.message === 'network' ? t('nutrition.networkError') : t('nutrition.barcodeError'));
        } finally {
          setBarcodeLoading(false);
        }
      };

      // Unified WebView camera path for ALL platforms (web + native).
      // html5-qrcode is the ONLY camera source while this overlay is open —
      // no @capacitor-mlkit/barcode-scanning.scan() (it would hide the WebView)
      // and no Capacitor Camera.getPhoto() / file-input picker (they open a
      // second native camera / the iOS photo picker). The AI photo mode re-uses
      // this same stream and captures frames off the <video> element below.
      // On native we ask mlkit for camera permission first so the OS prompt
      // fires before getUserMedia runs.
      setBarcodeScanning(true);
      try {
        if (Capacitor.isNativePlatform()) {
          try {
            const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
            const { camera } = await BarcodeScanner.requestPermissions();
            if (camera !== 'granted') {
              setBarcodeError(t('nutrition.barcodeError'));
              setBarcodeScanning(false);
              return;
            }
          } catch {
            // If permission request fails, still try getUserMedia — it will
            // surface its own permission prompt on most WebViews.
          }
        }

        const { Html5Qrcode } = await import('html5-qrcode');
        // Wait for the overlay + target div to mount
        await new Promise(r => setTimeout(r, 150));
        const el = document.getElementById('barcode-web-reader');
        if (!el) { setBarcodeScanning(false); return; }
        const html5Qr = new Html5Qrcode('barcode-web-reader', { verbose: false });
        // Use a function qrbox so html5-qrcode derives the scan region from the
        // actual container size (which we pin to fullscreen via CSS). Passing
        // a fixed pixel qrbox causes html5-qrcode to inline width/height on
        // our reader div and push the overlay UI out of place.
        await html5Qr.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: (vw, vh) => {
              const minEdge = Math.min(vw, vh);
              const w = Math.max(160, Math.min(320, Math.round(minEdge * 0.7)));
              return { width: w, height: Math.round(w * 0.55) };
            },
            aspectRatio: undefined,
            disableFlip: false,
          },
          async (decoded) => {
            // Only auto-process decoded barcodes while in barcode mode. In AI
            // photo mode the user drives the capture via the shutter.
            if (scanModeRef.current !== 'barcode') return;
            // Sync-throw guard: see closeBarcodeScanner. Rapid double-decode
            // events can race the stop.
            try { html5Qr.stop()?.catch?.(() => {}); } catch { /* already stopped */ }
            await processBarcode(decoded);
          },
          () => {}
        );
        // Store ref for cleanup + shutter frame capture
        window.__barcodeScannerRef = html5Qr;
      } catch (err) {
        setBarcodeScanning(false);
        if (!err?.message?.includes('cancel')) setBarcodeError(t('nutrition.barcodeError'));
      }
    }
  }, [t, lang]);

  const closeBarcodeScanner = useCallback(() => {
    setBarcodeScanning(false);
    setBarcodeLoading(false);
    setBarcodeError('');
    setBarcodeNotFound(false);
    setBarcodeProduct(null);
    setScanMode('barcode');
    scanModeRef.current = 'barcode';
    if (window.__barcodeScannerRef) {
      // html5-qrcode's stop() THROWS SYNCHRONOUSLY (not a rejected promise)
      // when the scanner isn't running — e.g. right after a successful decode,
      // whose callback already stopped it. A bare .catch() can't intercept
      // that, so every successful scan used to surface "Cannot stop, scanner
      // is not running or paused." into the console + error tracking.
      try {
        window.__barcodeScannerRef.stop()?.catch?.(() => {});
      } catch { /* already stopped */ }
      window.__barcodeScannerRef = null;
    }
  }, []);

  // Grab a JPEG frame off the live html5-qrcode <video> element. Shared by
  // both the AI-food and Menu scan paths — they differ only in what they do
  // with the resulting File.
  const grabVideoFrame = useCallback(async (quality = 0.85) => {
    const reader = document.getElementById('barcode-web-reader');
    if (!reader) return null;
    let video = reader.querySelector('video');
    // Retry up to ~1.2s — the camera may still be initialising on first tap.
    if (!video || !video.videoWidth || !video.videoHeight) {
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 100));
        video = reader.querySelector('video');
        if (video?.videoWidth && video?.videoHeight) break;
      }
    }
    if (!video || !video.videoWidth || !video.videoHeight) return null;
    const w = video.videoWidth;
    const h = video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return null;
    return new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' });
  }, []);

  // Menu-scan capture — reads the whole menu, pushes through analyze-menu-photo.
  // Menus are text-heavy so we use a higher JPEG quality (0.95) than the food
  // path (0.85). Width is bumped to 1600 in the compression step below for
  // legibility of small print.
  const captureFrameForMenu = useCallback(async () => {
    console.log('[captureFrameForMenu] shutter pressed');
    try {
      const file = await grabVideoFrame(0.95);
      if (!file) {
        console.error('[captureFrameForMenu] grabVideoFrame returned null');
        showToast?.(t('nutrition.errorNoPhoto', 'No photo captured. Please try again.'));
        return;
      }

      // Close the camera overlay before we hand off; the MenuScanResultModal
      // renders on top of the page.
      closeBarcodeScanner();

      setMenuAnalyzing(true);
      setMenuResult(null);
      setMenuError('');

      // Load + compress for edge function (max 1200px — menus have lots of text)
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        const url = URL.createObjectURL(file);
        i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
        i.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image_load_failed')); };
        i.src = url;
      });

      const aiCanvas = document.createElement('canvas');
      // Menus need legible text — keep the long edge at 1600px so small print
      // survives compression. The food scan path stays at 1200px elsewhere.
      const scale = Math.min(1, 1600 / Math.max(img.width, 1));
      aiCanvas.width = Math.round(img.width * scale) || 1600;
      aiCanvas.height = Math.round(img.height * scale) || 1600;
      aiCanvas.getContext('2d').drawImage(img, 0, 0, aiCanvas.width, aiCanvas.height);
      const compressed = await new Promise((resolve) => aiCanvas.toBlob(resolve, 'image/jpeg', 0.85));
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = () => reject(new Error('read_failed'));
        r.readAsDataURL(compressed);
      });

      await ensureFreshSession();
      const { data, error: fnError } = await withTimeout(
        supabase.functions.invoke('analyze-menu-photo', {
          body: { imageBase64: base64, language: i18n.language },
        }),
        40000,
        t('nutrition.menuScan.errorTimeout', 'Menu analysis timed out. Please try again.'),
      );
      const result = data || {};
      if (fnError) {
        let msg = fnError.message || t('nutrition.menuScan.errorService', 'Menu analysis failed');
        try { const b = await fnError.context?.json(); if (b?.error) msg = b.error; } catch {}
        throw new Error(msg);
      }
      if (result.error === 'no_menu_detected') {
        // Empty-state still opens the modal so the user sees the empty hint.
        setMenuResult({ items: [], restaurant_name: null });
        posthog?.capture('menu_scanned', { items: 0 });
        return;
      }
      if (result.error) throw new Error(result.error);

      posthog?.capture('menu_scanned', { items: result.items?.length || 0 });
      setMenuResult({
        items: result.items || [],
        restaurant_name: result.restaurant_name || null,
      });
    } catch (err) {
      console.error('[captureFrameForMenu] failed:', err);
      setMenuError(isSessionError(err) ? t('nutrition.sessionExpired', 'Please sign in again to continue.') : (err.message || t('nutrition.menuScan.errorGeneric', 'Failed to analyze menu.')));
    } finally {
      setMenuAnalyzing(false);
    }
  }, [closeBarcodeScanner, grabVideoFrame, i18n.language, t, posthog, showToast]);

  // AI-food shutter handler. Previously this would silently no-op if the live
  // <video> element wasn't ready yet — meaning users tapping the shutter early
  // saw nothing happen at all. We now: (a) wait briefly for the video to be
  // ready, (b) surface a toast if capture fails, (c) make sure the approval
  // modal is shown by routing through handlePhotoCapture which sets photoResult.
  const captureFrameForAI = useCallback(async () => {
    // Logged at every step so we can diagnose "shutter does nothing" reports.
    // Field tests showed the most common failure was video element not yet
    // ready (camera still initialising) and the toast getting clipped behind
    // the camera overlay.
    console.log('[captureFrameForAI] shutter pressed');
    try {
      const reader = document.getElementById('barcode-web-reader');
      if (!reader) {
        console.error('[captureFrameForAI] reader element missing');
        showToast?.(t('nutrition.errorNoPhoto', 'No photo captured. Please try again.'));
        return;
      }
      let video = reader.querySelector('video');

      // Camera may still be initialising on first tap — give it up to ~1.2s.
      // Bumped from 600ms after field reports of "shutter does nothing" on
      // slower Android devices where the video element takes longer to mount.
      if (!video || !video.videoWidth || !video.videoHeight) {
        for (let i = 0; i < 12; i++) {
          await new Promise(r => setTimeout(r, 100));
          video = reader.querySelector('video');
          if (video?.videoWidth && video?.videoHeight) break;
        }
      }
      if (!video || !video.videoWidth || !video.videoHeight) {
        console.error('[captureFrameForAI] video not ready after wait', {
          hasVideo: !!video,
          w: video?.videoWidth,
          h: video?.videoHeight,
        });
        showToast?.(t('nutrition.errorNoPhoto', 'No photo captured. Please try again.'));
        return;
      }

      const w = video.videoWidth;
      const h = video.videoHeight;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob) {
        console.error('[captureFrameForAI] toBlob returned null');
        showToast?.(t('nutrition.errorNoPhoto', 'No photo captured. Please try again.'));
        return;
      }
      console.log('[captureFrameForAI] frame captured', { w, h, bytes: blob.size });
      const file = new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' });

      // Stop the camera + unmount overlay BEFORE handing off — handlePhotoCapture
      // renders the analysis spinner itself, then on success sets photoResult
      // which renders the FoodScanResultModal approval sheet.
      closeBarcodeScanner();
      handlePhotoCapture(file);
    } catch (err) {
      console.error('[captureFrameForAI] failed:', err);
      showToast?.(t('nutrition.errorAnalyzeFailed', 'Failed to analyze food photo. Please try again.'));
    }
  }, [closeBarcodeScanner, showToast, t]);

  const handlePhotoCapture = async (file) => {
    // Apple 5.1.2: defense-in-depth — most callers go through the shutter
    // button (which already gates), but if any other path reaches this
    // function without consent, defer until the user accepts.
    if (!hasConsentedToAI('food-analysis')) {
      setAiConsentRequest({
        feature: 'food-analysis',
        run: () => handlePhotoCapture(file),
      });
      return;
    }

    setSearchOpen(false);
    setPhotoAnalyzing(true);
    setPhotoResult(null);
    setPhotoError('');
    setPhotoPreview(null);

    try {
      // Validate file exists and has content
      if (!file || file.size === 0) {
        throw new Error(t('nutrition.errorNoPhoto', 'No photo captured. Please try again.'));
      }

      // Size guard — takePhoto already compresses, but double-check
      if (file.size > 10 * 1024 * 1024) {
        throw new Error(t('nutrition.errorPhotoTooLarge', 'Photo is too large. Please try a lower resolution.'));
      }

      // Load image with timeout to avoid hanging on corrupt files
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        const objectUrl = URL.createObjectURL(file);
        const timeout = setTimeout(() => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error(t('nutrition.errorImageTimeout', 'Image took too long to load. The file may be corrupted.')));
        }, 15000);
        i.onload = () => { clearTimeout(timeout); URL.revokeObjectURL(objectUrl); resolve(i); };
        i.onerror = () => { clearTimeout(timeout); URL.revokeObjectURL(objectUrl); reject(new Error(t('nutrition.errorImageLoad', 'Could not load the photo. The file may be corrupted or in an unsupported format.'))); };
        i.src = objectUrl;
      });

      // Guard against degenerate dimensions
      if (img.width < 10 || img.height < 10) {
        throw new Error(t('nutrition.errorPhotoTooSmall', 'Photo is too small to analyze.'));
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
            (blob) => blob ? resolve(blob) : reject(new Error(t('nutrition.errorCompressFailed', 'Failed to compress photo for analysis.'))),
            'image/jpeg',
            0.6
          );
        } catch (e) {
          reject(new Error(t('nutrition.errorCompressFailed', 'Failed to compress photo for analysis.')));
        }
      });

      // Bail if the compressed blob is still too big for the edge function (~4MB base64 ≈ 3MB binary)
      if (compressed.size > 3 * 1024 * 1024) {
        throw new Error(t('nutrition.errorStillTooLarge', 'Photo is still too large after compression. Please try a smaller photo.'));
      }

      // Convert to base64
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const result = r.result;
          if (!result || typeof result !== 'string') {
            reject(new Error(t('nutrition.errorReadFailed', 'Failed to read photo data.')));
            return;
          }
          resolve(result.split(',')[1]);
        };
        r.onerror = () => reject(new Error(t('nutrition.errorReadFailed', 'Failed to read photo data.')));
        r.readAsDataURL(compressed);
      });

      if (!base64 || base64.length < 100) {
        throw new Error(t('nutrition.errorPhotoEmpty', 'Photo data is empty or corrupted.'));
      }

      // Save base64 + thumbnail to localStorage BEFORE the API call.
      // If Android kills the WebView while the request is in flight,
      // the useEffect on mount will pick these up and re-send.
      // Timestamp lets the resume path discard stale (>24h) work.
      try {
        localStorage.setItem('_pendingFoodBase64', base64);
        localStorage.setItem('_pendingFoodThumb', thumbnail);
        localStorage.setItem('_pendingFoodTimestamp', String(Date.now()));
      } catch {}

      // Call edge function (40s client-side cap so a hung request doesn't strand the spinner)
      await ensureFreshSession();
      const { data, error: fnError } = await withTimeout(
        supabase.functions.invoke('analyze-food-photo', {
          body: { image: base64, language: i18n.language },
        }),
        40000,
        t('nutrition.errorAnalysisTimeout', 'Analysis timed out. Please try again.'),
      );
      // supabase-js puts non-2xx response body in data, error is a FunctionsHttpError
      const result = data || {};
      if (fnError) {
        let msg = fnError.message || t('nutrition.errorAnalysisService', 'Analysis service error');
        try { const b = await fnError.context?.json(); if (b?.error) msg = b.error; } catch {}
        throw new Error(msg);
      }
      if (result.error === 'no_food_detected') throw new Error(t('nutrition.errorNoFoodDetected', 'No food detected in the image. Try a clearer photo.'));
      if (result.error) throw new Error(result.error);
      if (!result.items?.length) throw new Error(t('nutrition.errorCouldNotIdentify', 'Could not identify food items'));

      posthog?.capture('food_scanned', { method: 'photo' });
      setPhotoResult(result);
      // Clear pending data so the recovery useEffect doesn't re-trigger
      try {
        localStorage.removeItem('_pendingFoodBase64');
        localStorage.removeItem('_pendingFoodThumb');
        localStorage.removeItem('_pendingFoodTimestamp');
      } catch {}
    } catch (err) {
      setPhotoError(isSessionError(err) ? t('nutrition.sessionExpired', 'Please sign in again to continue.') : (err.message || t('nutrition.errorAnalyzeFailed', 'Failed to analyze food photo. Please try again.')));
      try {
        localStorage.removeItem('_pendingFoodBase64');
        localStorage.removeItem('_pendingFoodThumb');
        localStorage.removeItem('_pendingFoodTimestamp');
      } catch {}
    } finally {
      setPhotoAnalyzing(false);
    }
  };

  const handleLogFood = async ({ food, servings, mealType, cal, pro, carb, fat }) => {
    // Fullscreen "Logging…" overlay while the insert is in flight — without
    // it the tap felt dead on slow networks and read as the app freezing.
    setLoggingFood(true);
    try {
      await doLogFood({ food, servings, mealType, cal, pro, carb, fat });
    } finally {
      setLoggingFood(false);
    }
  };

  const doLogFood = async ({ food, servings, mealType, cal, pro, carb, fat }) => {
    // Clean AI-generated labels ("Redbull of dark desk" -> "Redbull") before save.
    const cleanedName = (!food.id && food.name) ? (cleanFoodName(food.name) || food.name) : food.name;

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
          food_name: cleanedName,
          ai_calories: aiCal, ai_protein_g: aiPro, ai_carbs_g: aiCarb, ai_fat_g: aiFat, ai_grams: aiGrams,
          user_calories: cal, user_protein_g: pro, user_carbs_g: carb, user_fat_g: fat, user_grams: aiGrams,
        }); // fire and forget
      }
    }

    const insertPayload = {
      profile_id: user.id, gym_id: profile.gym_id,
      food_item_id: food.id || null,
      custom_name: food.id ? null : cleanedName,
      // Persist image source for the row so today's meals + log detail can render it.
      // Priority: AI-photo data URL → barcode/search remote URL → null
      photo_url: food.id ? null : (photoPreview || food.image_url || null),
      meal_type: mealType, log_date: todayStr(), servings,
      calories: cal, protein_g: pro, carbs_g: carb, fat_g: fat,
      // How this entry was created — lets the detail modal show the right (or no)
      // disclaimer. AI photo → 'ai'; barcode → 'barcode'; a food-DB pick → 'food_db';
      // otherwise a hand-typed entry.
      source: food.isBarcode ? 'barcode' : (photoResult ? 'ai' : (food.id ? 'food_db' : 'manual')),
    };
    const { data, error } = await supabase.from('food_logs')
      .insert(insertPayload)
      .select('*, food_item:food_items(name, name_es, brand, serving_size, serving_unit, image_url)')
      .single();
    if (!error && data) {
      // Track manual food logging (photo/barcode tracked at scan time)
      if (food.id) posthog?.capture('food_scanned', { method: 'manual' });
      // Push scanned foods (no food_item id) into recents list
      if (!food.id) {
        pushRecentScan({
          name: cleanedName,
          brand: food.brand || null,
          image_url: food.image_url || photoPreview || null,
          calories: food.calories || 0,
          protein_g: food.protein_g || 0,
          carbs_g: food.carbs_g || 0,
          fat_g: food.fat_g || 0,
          serving_size: food.serving_size ?? null,
          serving_unit: food.serving_unit ?? 'g',
          nutri_score: food.nutri_score ?? null,
          source: food.isBarcode ? 'barcode' : (photoResult ? 'ai' : 'scan'),
        });
      }
      setTodayLogs(prev => [data, ...prev]);
      setLogFood(null);
      setSearchOpen(false);
      setPhotoResult(null);
      setPhotoPreview(null);
      setScanResult(null);
    } else if (error) {
      // Keep the modal open so the member can retry instead of assuming it logged.
      showToast(t('nutrition.logFailed', "Couldn't log that food. Try again."), 'error');
    }
  };

  const handleDeleteLog = async (logId) => {
    // Optimistic remove with snapshot rollback — a swallowed failure here makes
    // the entry reappear on next refresh with no explanation.
    const snapshot = todayLogs;
    setTodayLogs(prev => prev.filter(l => l.id !== logId));
    const { error } = await supabase.from('food_logs').delete().eq('id', logId).eq('profile_id', user.id);
    if (error) {
      setTodayLogs(snapshot);
      showToast(t('nutrition.deleteFailed', "Couldn't remove that entry. Try again."), 'error');
    }
  };

  // ── Menu scan: log a ranked menu item straight into food_logs ──
  const mealTypeFromClock = useCallback(() => {
    const h = new Date().getHours();
    if (h >= 6 && h < 11) return 'breakfast';
    if (h >= 11 && h < 14) return 'lunch';
    if (h >= 14 && h < 17) return 'snack';
    if (h >= 17 && h < 21) return 'dinner';
    return 'snack'; // late night / early morning → snack (a valid category, not 'late')
  }, []);

  const handleLogMenuItem = useCallback(async (item) => {
    if (!user?.id || !profile?.gym_id) return;
    setLoggingFood(true);
    try {
      await doLogMenuItem(item);
    } finally {
      setLoggingFood(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, profile?.gym_id, mealTypeFromClock]);

  const doLogMenuItem = async (item) => {
    const cleanedName = cleanFoodName(item.name) || item.name;
    // Recipe-shaped items pass `image` (filename); menu-scanned items have no image.
    const resolvedImage = item.image_url || (item.image ? foodImageUrl(item.image) : null);
    const payload = {
      profile_id: user.id,
      gym_id: profile.gym_id,
      food_item_id: null,
      custom_name: cleanedName,
      photo_url: resolvedImage,
      meal_type: item.mealType || mealTypeFromClock(),
      log_date: todayStr(),
      servings: item.servings ?? 1,
      calories: Math.round(item.calories || 0),
      protein_g: Math.round((item.protein_g || 0) * 10) / 10,
      carbs_g: Math.round((item.carbs_g || 0) * 10) / 10,
      fat_g: Math.round((item.fat_g || 0) * 10) / 10,
      // A recipe from our library (`image` present) vs a photographed restaurant
      // menu. Neither is an AI-photo estimate of the member's own plate.
      source: item.source || (item.image ? 'recipe' : 'menu_scan'),
    };
    const { data, error } = await supabase.from('food_logs')
      .insert(payload)
      .select('*, food_item:food_items(name, name_es, brand, serving_size, serving_unit, image_url)')
      .single();
    if (!error && data) {
      setTodayLogs(prev => [data, ...prev]);
      pushRecentScan({
        name: cleanedName,
        brand: null,
        image_url: resolvedImage,
        calories: payload.calories,
        protein_g: payload.protein_g,
        carbs_g: payload.carbs_g,
        fat_g: payload.fat_g,
        serving_size: null,
        serving_unit: 'g',
        source: item.image ? 'recipe' : 'menu_scan',
        nutri_score: null,
      });
      posthog?.capture('food_logged', { method: 'menu_scan' });
      showToast(t('nutrition.menuScan.logged', { name: cleanedName, defaultValue: `Logged: ${cleanedName}` }), 'success');
      setMenuResult(null);
    } else if (error) {
      showToast(t('nutrition.menuScan.logFailed', 'Failed to log item'), 'error');
    }
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
    } else if (error) {
      showToast(t('nutrition.updateFailed', "Couldn't update that entry. Try again."), 'error');
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
    if (!error) {
      setTargets(data);
      setEditing(false);
    } else {
      // Keep the editor open so the member knows the targets didn't save.
      showToast(t('nutrition.targetsFailed', "Couldn't save your targets. Try again."), 'error');
    }
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

  // Platform kill switch (Operations → feature_nutrition). After all hooks so
  // a mid-session flip can't change the hook order. Also covers the Progress
  // tab embed (members are the kill-switch audience).
  if (!nutritionEnabled) return <FeatureDisabledScreen embedded={embedded} />;

  if (loading) {
    return (
      <>
        <div className="min-h-screen bg-[#05070B] px-4 pt-6 pb-28 md:pb-12" aria-busy={true} aria-label={t('nutrition.loadingNutritionData', 'Loading nutrition data')}>
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

  const sharedProps = {
    savedIds: savedRecipeIds,
    onSave: toggleSaveRecipe,
    onOpenRecipe: setOpenRecipe,
    onOpenCollection: setOpenCollection,
    scannedFavorites,
    onOpenFavorite: openScannedFavorite,
  };

  return (
    <FadeIn>
    <div className={embedded ? '' : 'min-h-screen bg-[#05070B]'}>
      <div className={embedded ? '' : 'mx-auto w-full max-w-[480px] md:max-w-4xl lg:max-w-6xl'}>
        {/* Home view always renders inline */}
        {view === 'home' && (
          <>
            <HomeView
              {...sharedProps}
              targets={targets}
              todayTotals={todayTotals}
              todayLogs={todayLogs}
              onLogMeal={(meal) => setLogMealSheet(meal)}
              onOpenSearch={() => setSearchOpen(true)}
              onDeleteLog={handleDeleteLog}
              onOpenLog={setDetailLog}
              setView={setView}
              openEdit={openEdit}
              embedded={embedded}
              userId={user?.id}
              gymId={profile?.gym_id}
              groceryList={groceryList}
              onAddGroceryItems={handleAddGroceryItemsRaw}
              onAddRecipeToGrocery={handleAddToGrocery}
              onRemoveRecipeFromGrocery={handleRemoveRecipeFromGrocery}
              onMarkMealEaten={handleMarkMealEaten}
              recentScans={recentScans}
              scannedFavorites={scannedFavorites}
              onRepeatScan={(r) => {
                // Re-open the scan-result modal prefilled with this food. Preserve
                // the REAL source — collapsing everything to 'ai' was why recipes
                // from our own list re-opened labeled "AI identified". Only a true
                // barcode or ai stays special; recipes/menu/search show neutral.
                setScanResult({
                  source: r.source === 'barcode' ? 'barcode' : (r.source === 'ai' ? 'ai' : 'search'),
                  food: {
                    name: r.name,
                    brand: r.brand,
                    // Resolve the image the SAME way the card does so the modal shows
                    // the same photo (logged recipes have no image_url — resolve by name).
                    image_url: foodImageUrl(r.image_url) || r.image_url || getFoodImage(r.name, r.brand) || recipeImageByName(r.name),
                    calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g,
                    serving_size: r.serving_size, serving_unit: r.serving_unit,
                    nutri_score: r.nutri_score,
                  },
                });
              }}
              onOpenFavorite={(f) => {
                setScanResult({
                  source: 'search',
                  food: {
                    name: f.food_name,
                    brand: f.brand_name,
                    image_url: f.food_image_url,
                    calories: Number(f.calories) || 0,
                    protein_g: Number(f.protein_g) || 0,
                    carbs_g: Number(f.carbs_g) || 0,
                    fat_g: Number(f.fat_g) || 0,
                    serving_size: f.serving_size ? parseFloat(f.serving_size) : 100,
                    serving_unit: 'g',
                    nutri_score: f.nutri_score,
                  },
                });
              }}
            />
          </>
        )}

        {/* Floating Scan FAB — portaled so it's never clipped.
            Gated on isPageActive so the portal doesn't leak onto other
            pages while Nutrition is kept alive via display:none. */}
        {view === 'home' && isPageActive && createPortal(
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center justify-center active:scale-90 transition-all"
            style={{
              position: 'fixed', zIndex: 50,
              right: 18,
              bottom: `calc(${embedded ? '80px' : '140px'} + var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)))`,
              width: 58, height: 58, borderRadius: 999, border: 'none',
              background: 'var(--color-accent, #2EC4C4)',
              boxShadow: '0 8px 24px rgba(46,196,196,0.35), 0 2px 6px rgba(0,0,0,0.15)',
              cursor: 'pointer',
            }}
            aria-label={t('nutrition.scanFood', 'Scan food')}
            data-tour="tour-nutrition-scan"
          >
            <ScanLine size={24} style={{ color: 'var(--color-text-on-accent, #001512)' }} strokeWidth={2.2} />
          </button>,
          document.body
        )}

        {/* Sub-views render INLINE inside the Nutrition tab — they keep the
            app's normal header + bottom nav, they are NOT a separate full-screen
            "app" with their own footer. Reached from the Home view's pills /
            buttons; each sub-view has its own back arrow → home. (My Plan lives
            on the Home "My Plan" button → WeeklyMealPlanner, so there is no
            longer a second, divergent 'plan' surface with its own nav.) */}
        {view !== 'home' && (
          <div className="mx-auto w-full max-w-[480px] md:max-w-4xl lg:max-w-6xl">
            {view === 'discover' && <DiscoverView {...sharedProps} setView={setView} targets={targets} />}
            {view === 'saved'    && <SavedView    {...sharedProps} setView={setView} userId={user?.id} gymId={profile?.gym_id} onLogMeal={(meal) => setLogMealSheet(meal)} />}
            {view === 'grocery'  && (
              <GroceryView
                setView={setView}
                groceryList={groceryList}
                onToggleItem={handleToggleGroceryItem}
                onClearChecked={handleClearChecked}
                onRemoveItem={handleRemoveGroceryItem}
                onFillFromMeals={handleFillFromMeals}
                onClearList={handleClearGroceryList}
                onAddGroceryItems={handleAddGroceryItemsRaw}
              />
            )}
          </div>
        )}
      </div>

      {/* Modals — portal when embedded to escape SwipeableTabView */}
      {embedded ? createPortal(<>
      <RecipeDetailModal
        recipe={openRecipe}
        onClose={() => { setOpenRecipe(null); if (collectionContext) { setOpenCollection(collectionContext); setCollectionContext(null); } }}
        saved={openRecipe ? savedRecipeIds.has(openRecipe.id) : false}
        onSave={toggleSaveRecipe}
        onAddToGrocery={handleAddToGrocery}
        onLogMeal={(recipe) => { setOpenRecipe(null); setLogMealSheet(recipe); }}
        groceryAdded={openRecipe ? groceryAdded.has(openRecipe.id) : false}
        lang={lang}
        rating={openRecipe ? (mealRatings[openRecipe.id] || 0) : 0}
        onRate={handleRateMeal}
      />

      {/* Collection Detail Modal */}
      {openCollection && (() => {
        const colRecipes = collectionRecipes(openCollection, RECIPES);
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
                <button onClick={() => setOpenCollection(null)} className="w-8 h-8 rounded-full bg-white/[0.08] flex items-center justify-center flex-shrink-0 mt-0.5" aria-label={t('common.close', 'Close')}>
                  <X size={16} style={{ color: 'var(--color-text-muted)' }} />
                </button>
              </div>

              {/* Per-meal averages — a bundle TOTAL is meaningless since macros
                  are tracked per day, so show the typical meal instead. */}
              {(() => { const n = Math.max(colRecipes.length, 1); return (
              <div className="mx-5 mb-3 p-3 rounded-2xl border border-white/[0.04]" style={{ background: 'color-mix(in srgb, var(--color-bg-inset) 50%, transparent)' }}>
                <p className="text-[10px] font-bold uppercase text-center mb-2" style={{ color: 'var(--color-text-subtle)', letterSpacing: '0.08em' }}>{t('nutrition.perMeal', 'Avg per meal')}</p>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <p className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{Math.round(totalCal / n)}</p>
                    <p className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>{t('nutrition.kcalUnit', 'kcal')}</p>
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-[#10B981]">{Math.round(totalP / n)}g</p>
                    <p className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>{t('nutrition.protein')}</p>
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-[#FBBF24]">{Math.round(totalC / n)}g</p>
                    <p className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>{t('nutrition.carbs')}</p>
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-[#F97316]">{Math.round(totalF / n)}g</p>
                    <p className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>{t('nutrition.fat')}</p>
                  </div>
                </div>
              </div>
              ); })()}

              {/* Meal list — table style: one card, rows divided by lines, names as headings */}
              <div className="overflow-y-auto flex-1 px-5 pb-4">
                <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                  {colRecipes.map((r, ri) => {
                    const title = (lang === 'es' && r.title_es) ? r.title_es : r.title;
                    const tag = (lang === 'es' && r.tag_es) ? r.tag_es : r.tag;
                    const gm = goalMatchPct(r, targets);
                    return (
                      <button key={r.id} onClick={() => { setCollectionContext(openCollection); setOpenCollection(null); setOpenRecipe(r); }}
                        className="w-full flex items-center gap-3 p-3 text-left active:opacity-70 transition-opacity"
                        style={{ borderBottom: ri < colRecipes.length - 1 ? '1px solid var(--color-border-subtle)' : 'none' }}>
                        <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0" style={{ background: 'var(--color-bg-inset)' }}>
                          <img src={(foodImageUrl(r.image) || MEAL_IMG_FALLBACK)} onError={handleMealImgError} alt={title} className="w-full h-full object-cover" loading="lazy" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="text-[14px] font-bold truncate flex-1 min-w-0" style={{ fontFamily: TU.display, color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{title}</p>
                            {gm != null && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{
                                background: gm >= 80 ? `${TU.accent}22` : gm >= 60 ? 'rgba(245,158,11,0.18)' : 'var(--color-bg-inset)',
                                color: gm >= 80 ? TU.accent : gm >= 60 ? '#F59E0B' : 'var(--color-text-muted)',
                              }}>{gm}% {t('nutrition.goalMatch', 'match')}</span>
                            )}
                          </div>
                          {tag && <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{tag}</p>}
                          <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 tabular-nums">
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
              </div>

              {/* Actions — add the whole bundle to this week's plan, or bookmark it */}
              <div className="px-5 pb-5 pt-2 border-t border-white/[0.04] flex gap-2.5" style={{ background: 'var(--color-bg-secondary)' }}>
                <button
                  onClick={() => { colRecipes.forEach(r => { if (!savedRecipeIds.has(r.id)) toggleSaveRecipe(r.id); }); setOpenCollection(null); }}
                  className="flex-1 py-3 rounded-2xl font-semibold text-[13px] flex items-center justify-center gap-1.5 transition-colors active:scale-[0.97]"
                  style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-subtle)' }}
                >
                  <Bookmark size={15} />{t('nutrition.saveAll', 'Save all')}
                </button>
                <button
                  onClick={() => {
                    try {
                      const ws = getWeekStartDate();
                      const key = `meal_plan_${user?.id || 'anon'}_${ws}`;
                      let days = {};
                      try { const raw = localStorage.getItem(key); if (raw) days = JSON.parse(raw).days || {}; } catch { /* ignore */ }
                      const start = new Date(ws + 'T12:00:00');
                      const weekDates = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return toLocalDateStr(d); });
                      // Fill the member's configured slots (incl. snacks), not just the core 3.
                      const scheduleKeys = plannerSlotKeys(loadMealSchedule(user?.id).count);
                      let qi = 0;
                      for (const date of weekDates) {
                        if (qi >= colRecipes.length) break;
                        days[date] = days[date] || {};
                        for (const slot of scheduleKeys) {
                          if (qi >= colRecipes.length) break;
                          if (!days[date][slot]) { days[date][slot] = colRecipes[qi]; qi++; }
                        }
                      }
                      localStorage.setItem(key, JSON.stringify({ weekStart: ws, days }));
                      // Mirror to the DB (same lane as WeeklyMealPlanner.savePlan) so
                      // it's durable + cross-device, and ping My Plan to re-read if
                      // it's already mounted — otherwise the add only shows on remount.
                      if (user?.id) {
                        supabase.from('meal_plans').upsert({
                          profile_id: user.id, week_start: ws, plan_data: days, updated_at: new Date().toISOString(),
                        }, { onConflict: 'profile_id,week_start' }).then(() => {}, () => {});
                      }
                      window.dispatchEvent(new CustomEvent('tugympr:meal-plan-changed', { detail: { weekStart: ws } }));
                      showToast?.(t('nutrition.addedToWeek', "Added to this week's plan"), 'success');
                      setOpenCollection(null);
                    } catch { showToast?.(t('common.error', 'Something went wrong'), 'error'); }
                  }}
                  className="flex-1 py-3 rounded-2xl font-bold text-[13px] flex items-center justify-center gap-1.5 transition-colors active:scale-[0.97]"
                  style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #001512)' }}
                >
                  <Plus size={15} strokeWidth={2.6} />{t('nutrition.addToWeek', 'Add to week')}
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
        onLogMeal={recipe => { setSearchOpen(false); setLogMealSheet(recipe); }}
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

      {/* Barcode scanner overlay — fullscreen WebView camera with React UI on top */}
      {barcodeScanning && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: '#000', overflow: 'hidden' }}>
          {/* Fullscreen camera feed (html5-qrcode injects a <video> here).
              Pinned absolutely so nothing html5-qrcode injects can push layout around. */}
          <div
            id="barcode-web-reader"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              background: '#000',
              overflow: 'hidden',
              zIndex: 1,
            }}
          />

          {/* Fallback gradient that shows briefly while camera is initializing */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
            background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%)',
          }} />

          {/* Top bar — absolutely pinned, independent of any flex parent.
              pointerEvents: 'auto' makes sure any sibling with inset:0 + pointer-events:none
              can't accidentally eat clicks before they reach the close button. */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: 'max(50px, env(safe-area-inset-top, 50px)) 14px 0',
            pointerEvents: 'auto',
          }}>
            <button type="button" onClick={closeBarcodeScanner}
              className="w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition-transform"
              style={{
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border-subtle)',
                boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
                cursor: 'pointer',
              }}
              aria-label={t('common.close', 'Close')}>
              <X size={17} style={{ color: 'var(--color-text-primary)' }} />
            </button>
            <div className="px-4 py-2 rounded-full text-[12px] font-bold flex items-center gap-1.5"
              style={{
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
                boxShadow: '0 6px 18px rgba(0,0,0,0.2)',
                fontFamily: TU.display,
                letterSpacing: -0.1,
              }}>
              {scanMode === 'ai' && <Sparkles size={12} style={{ color: TU.coach }} />}
              {scanMode === 'menu' && <BookOpen size={12} style={{ color: TU.coach }} />}
              {scanMode === 'barcode' && <ScanLine size={12} style={{ color: TU.accent }} />}
              {scanMode === 'ai' && t('nutrition.scanFood', 'Scan food')}
              {scanMode === 'menu' && t('nutrition.menuScan.pillTitle', 'Scan menu')}
              {scanMode === 'barcode' && t('nutrition.scanBarcode', 'Scan barcode')}
            </div>
            <div className="w-11 h-11" />
          </div>

          {/* Mode tabs — absolutely positioned below top bar.
              Both pills are <button>s that only toggle scanMode. The camera
              stream (html5-qrcode) keeps running; what changes is whether the
              decode callback auto-processes barcodes and what the shutter does. */}
          <div style={{
            position: 'absolute', top: 'calc(max(50px, env(safe-area-inset-top, 50px)) + 52px)',
            left: 0, right: 0, zIndex: 3, display: 'flex', justifyContent: 'center',
            pointerEvents: 'auto',
          }}>
            <div className="inline-flex gap-1 p-1 rounded-full"
              style={{
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border-subtle)',
                boxShadow: '0 6px 18px rgba(0,0,0,0.2)',
              }}>
              <button
                type="button"
                onClick={() => setScanMode('barcode')}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95"
                style={{
                  background: scanMode === 'barcode' ? TU.accent : 'transparent',
                  color: scanMode === 'barcode' ? 'var(--color-text-on-accent, #001512)' : 'var(--color-text-muted)',
                  border: 'none', cursor: 'pointer',
                  fontFamily: TU.display, letterSpacing: -0.1,
                }}
              >
                <ScanLine size={13} />{t('nutrition.scanBarcode', 'Barcode')}
              </button>
              {/* AI + Menu pills only exist while the platform feature_ai
                  kill switch is on (the only direct per-call OpenAI spend).
                  aiConsent still gates each tap underneath. */}
              {aiEnabled && (
                <>
                  <button
                    type="button"
                    onClick={() => requireAIConsent('food-analysis', () => setScanMode('ai'))}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95"
                    style={{
                      background: scanMode === 'ai' ? TU.coach : 'transparent',
                      color: scanMode === 'ai' ? '#fff' : 'var(--color-text-muted)',
                      border: 'none', cursor: 'pointer',
                      fontFamily: TU.display, letterSpacing: -0.1,
                    }}
                  >
                    <Sparkles size={13} />{t('nutrition.aiPhoto', 'AI photo')}
                  </button>
                  <button
                    type="button"
                    onClick={() => requireAIConsent('menu-analysis', () => setScanMode('menu'))}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95"
                    style={{
                      background: scanMode === 'menu' ? TU.coach : 'transparent',
                      color: scanMode === 'menu' ? '#fff' : 'var(--color-text-muted)',
                      border: 'none', cursor: 'pointer',
                      fontFamily: TU.display, letterSpacing: -0.1,
                    }}
                  >
                    <BookOpen size={13} />{t('nutrition.menuScan.modeLabel', 'Menu')}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Scan frame — size + color change based on mode so the user can
              differentiate visually. Barcode mode: narrow rectangle (accent teal).
              AI food mode: large square (coach purple). Transitions smoothly. */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 3,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            {(() => {
              const isAI = scanMode === 'ai';
              const isMenu = scanMode === 'menu';
              const frameColor = (isAI || isMenu) ? TU.coach : TU.accent;
              const frameWidth = isMenu ? 340 : (isAI ? 280 : 260);
              const frameHeight = isMenu ? 440 : (isAI ? 280 : 170);
              const cornerSize = isMenu ? 40 : (isAI ? 36 : 26);
              const cornerRadius = isMenu ? 20 : (isAI ? 18 : 12);
              return (
                <div style={{
                  position: 'relative',
                  width: frameWidth,
                  height: frameHeight,
                  transition: 'width 240ms ease-out, height 240ms ease-out',
                }}>
                  {/* Corner brackets */}
                  {[[false,false],[true,false],[false,true],[true,true]].map(([r, b], i) => (
                    <div key={i} className="absolute" style={{
                      width: cornerSize, height: cornerSize,
                      [b ? 'bottom' : 'top']: -2, [r ? 'right' : 'left']: -2,
                      borderTop: b ? 'none' : `3px solid ${frameColor}`,
                      borderBottom: b ? `3px solid ${frameColor}` : 'none',
                      borderLeft: r ? 'none' : `3px solid ${frameColor}`,
                      borderRight: r ? `3px solid ${frameColor}` : 'none',
                      borderTopLeftRadius: !r && !b ? cornerRadius : 0,
                      borderTopRightRadius: r && !b ? cornerRadius : 0,
                      borderBottomLeftRadius: !r && b ? cornerRadius : 0,
                      borderBottomRightRadius: r && b ? cornerRadius : 0,
                      transition: 'width 240ms ease-out, height 240ms ease-out, border-color 240ms ease-out',
                    }} />
                  ))}
                  {/* Laser line — only for barcode mode */}
                  {!isAI && !isMenu && (
                    <div className="absolute left-2.5 right-2.5 h-[2px] animate-pulse" style={{
                      top: '50%', background: frameColor,
                      boxShadow: `0 0 18px ${frameColor}, 0 0 6px ${frameColor}`,
                    }} />
                  )}
                </div>
              );
            })()}
          </div>

          {/* Hint pill + shutter — absolutely pinned to bottom.
              In barcode mode the shutter is cosmetic (decode auto-fires); in AI
              mode it captures the current video frame for analyze-food-photo.
              The click ALWAYS fires captureFrameForAI in AI mode — never the
              iOS photo picker. */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 3,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            paddingBottom: 'max(30px, env(safe-area-inset-bottom, 30px))',
            pointerEvents: 'auto',
          }}>
            <div className="px-4 py-2 rounded-full text-[11px] font-bold"
              style={{
                background: 'var(--color-bg-card)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border-subtle)',
                marginBottom: 14,
                boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
                fontFamily: TU.display, letterSpacing: -0.1,
              }}>
              {scanMode === 'ai' && t('nutrition.pointAtFood', 'Point at your food, then tap the shutter')}
              {scanMode === 'menu' && t('nutrition.menuScan.hint', 'Frame the whole menu, landscape works too')}
              {scanMode === 'barcode' && t('nutrition.pointCamera', 'Point at a barcode — it scans automatically')}
            </div>
            {/* The shutter only exists in AI/Menu modes. In barcode mode
                html5-qrcode decodes continuously at 10fps — a visible (even
                dimmed) shutter reads as "tap to scan" and got tapped to no
                effect, so it's hidden entirely; the hint above says scanning
                is automatic. */}
            {scanMode !== 'barcode' && (
              <button
                type="button"
                onClick={() => {
                  // Platform feature_ai kill switch — belt-and-suspenders over
                  // the hidden pills + barcode fallback effect, so the shutter
                  // can never fire an OpenAI call while the switch is off.
                  if (!aiEnabled) return;
                  if (scanMode === 'ai') {
                    // Gate on third-party AI consent (Apple 5.1.2) before sending
                    // the captured frame to OpenAI Vision.
                    requireAIConsent('food-analysis', () => captureFrameForAI());
                  } else if (scanMode === 'menu') {
                    requireAIConsent('menu-analysis', () => captureFrameForMenu());
                  }
                }}
                aria-label={
                  scanMode === 'ai'
                    ? t('nutrition.takePhoto', 'Take photo')
                    : t('nutrition.menuScan.takePhoto', 'Capture menu')
                }
                className="w-[78px] h-[78px] rounded-full flex items-center justify-center active:scale-95 transition-transform"
                style={{
                  border: `3px solid ${TU.coach}`,
                  background: 'var(--color-bg-card)',
                  padding: 5,
                  cursor: 'pointer',
                  boxShadow: `0 8px 24px color-mix(in srgb, ${TU.coach} 35%, transparent)`,
                }}
              >
                <div className="w-full h-full rounded-full" style={{ background: TU.coach }} />
              </button>
            )}
          </div>

          {/* Scoped CSS — forces html5-qrcode's injected <video> + <canvas> to
              fill the reader container. The selectors are narrowly scoped so
              they do NOT bubble past #barcode-web-reader and accidentally
              restyle our overlay siblings (top bar, mode pills, shutter).

              html5-qrcode 2.x injects as direct children of #barcode-web-reader:
                - <video>                       (the live preview)
                - <canvas id="qr-canvas">       (decode buffer)
                - <div id="qr-shaded-region">   (scan region shader — we hide it
                                                 because we render our own React
                                                 corner brackets + laser line)
              The reader itself sits at z-index:1 inside a z-index:90 overlay,
              so our buttons at z-index:3 are guaranteed to be above both the
              reader and anything html5-qrcode injects into it. */}
          <style>{`
            #barcode-web-reader {
              position: absolute !important;
              inset: 0 !important;
              width: 100% !important;
              height: 100% !important;
              min-height: 100% !important;
              padding: 0 !important;
              border: 0 !important;
              overflow: hidden !important;
              background: #000 !important;
            }
            #barcode-web-reader > video {
              position: absolute !important;
              inset: 0 !important;
              width: 100% !important;
              height: 100% !important;
              max-width: none !important;
              max-height: none !important;
              object-fit: cover !important;
              display: block !important;
              background: #000 !important;
            }
            #barcode-web-reader > canvas,
            #barcode-web-reader > #qr-canvas {
              position: absolute !important;
              inset: 0 !important;
              width: 100% !important;
              height: 100% !important;
              display: none !important;
            }
            /* Hide html5-qrcode's built-in shaded-region overlay + paused UI —
               we render our own React corner brackets / laser / status pills.
               Using descendant selectors that are scoped strictly under
               #barcode-web-reader so nothing bleeds out to sibling overlays. */
            #barcode-web-reader > #qr-shaded-region,
            #barcode-web-reader #qr-shaded-region,
            #barcode-web-reader img[alt="Info icon"] {
              display: none !important;
            }
          `}</style>
        </div>
      )}

      {/* Barcode loading overlay — warm-paper card */}
      {barcodeLoading && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center px-4" style={{ background: 'rgba(20,14,8,0.55)', backdropFilter: 'blur(6px)' }} aria-busy={true}>
          <div className="rounded-[22px] p-6 flex flex-col items-center gap-4"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle)',
              boxShadow: '0 18px 50px rgba(60, 40, 10, 0.22), 0 2px 8px rgba(0,0,0,0.1)',
            }}>
            <div className="relative w-16 h-16 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full" style={{ border: `3px solid ${TU.accent}`, borderTopColor: 'transparent', borderRightColor: 'transparent', animation: 'spin 1s linear infinite' }} />
              <ScanLine size={22} style={{ color: TU.accent }} />
            </div>
            <div className="text-center">
              <p className="text-[16px] font-bold mb-1" style={{ color: 'var(--color-text-primary)', fontFamily: TU.display }}>{t('nutrition.scanning', 'Scanning…')}</p>
              <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('nutrition.lookingUpProduct', 'Looking up product…')}</p>
            </div>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Barcode error */}
      {barcodeError && !barcodeProduct && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center px-4" onClick={closeBarcodeScanner} role="presentation">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative w-full max-w-sm rounded-[22px] p-6 text-center" style={{ background: 'var(--color-bg-primary)' }} onClick={e => e.stopPropagation()}>
            <AlertCircle size={36} className="mx-auto mb-3" style={{ color: 'var(--color-danger, #EF4444)' }} />
            <p className="text-[14px] mb-4" style={{ color: 'var(--color-text-primary)' }}>{barcodeError}</p>
            <div className="flex flex-col gap-2.5">
              {/* Product not in the barcode DB → offer AI photo as the fallback
                  (only when the platform AI switch is on). A real network error
                  doesn't get this — AI would fail the same way. Reopens the
                  camera straight into AI mode, gated by the same consent flow. */}
              {barcodeNotFound && aiEnabled && (
                <button
                  onClick={() => {
                    setBarcodeError('');
                    setBarcodeNotFound(false);
                    requireAIConsent('food-analysis', () => {
                      handleBarcodeRequest('__open_scanner__');
                      setScanMode('ai');
                    });
                  }}
                  className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-[14px] font-bold text-[14px] active:scale-95"
                  style={{ background: TU.coach, color: '#fff' }}
                >
                  <Sparkles size={15} />{t('nutrition.scanWithAi', 'Scan with AI instead')}
                </button>
              )}
              <button onClick={closeBarcodeScanner} className="px-6 py-2.5 rounded-[14px] font-bold text-[14px] active:scale-95"
                style={barcodeNotFound && aiEnabled
                  ? { background: 'var(--color-bg-card)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-subtle)' }
                  : { background: TU.accent, color: 'var(--color-text-on-accent, #001512)' }}>
                {barcodeNotFound && aiEnabled ? t('nutrition.cancel', 'Cancel') : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Logging overlay — food_logs insert in flight ── */}
      {loggingFood && (
        <div className="fixed inset-0 z-[96] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}
          aria-busy={true}>
          <div className="rounded-[20px] px-7 py-6 flex flex-col items-center gap-3"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', boxShadow: '0 18px 50px rgba(0,0,0,0.25)' }}>
            <div className="w-9 h-9 rounded-full animate-spin"
              style={{ border: `3px solid var(--color-border-subtle)`, borderTopColor: TU.accent }} />
            <p className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: TU.display }}>
              {t('nutrition.logging', 'Logging…')}
            </p>
          </div>
        </div>
      )}

      {/* ── Menu scan: analyzing overlay ── */}
      {menuAnalyzing && (
        <div className="fixed inset-0 z-[94] flex items-center justify-center px-4"
          style={{ background: 'rgba(20,14,8,0.6)', backdropFilter: 'blur(8px)' }}
          aria-busy={true}>
          <div className="rounded-[22px] p-6 flex flex-col items-center gap-4 max-w-[320px] text-center"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle)',
              boxShadow: '0 18px 50px rgba(60, 40, 10, 0.22), 0 2px 8px rgba(0,0,0,0.1)',
            }}>
            <div className="relative w-16 h-16 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full"
                style={{ border: `3px solid ${TU.coach}`, borderTopColor: 'transparent', borderRightColor: 'transparent', animation: 'spin 1s linear infinite' }} />
              <BookOpen size={22} style={{ color: TU.coach }} />
            </div>
            <div>
              <p className="text-[16px] font-bold mb-1" style={{ color: 'var(--color-text-primary)', fontFamily: TU.display }}>
                {t('nutrition.menuScan.analyzing', 'Analyzing menu…')}
              </p>
              <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                {t('nutrition.menuScan.analyzingHint', 'Reading items and estimating macros')}
              </p>
            </div>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* ── Menu scan: error overlay ── */}
      {menuError && !menuAnalyzing && (
        <div className="fixed inset-0 z-[94] flex items-center justify-center px-4"
          style={{ background: 'rgba(20,14,8,0.55)', backdropFilter: 'blur(8px)' }}>
          <div className="rounded-[22px] p-5 max-w-[340px] w-full text-center flex flex-col gap-3"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
            <p className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: TU.display }}>
              {t('nutrition.menuScan.errorTitle', 'Could not read menu')}
            </p>
            <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{menuError}</p>
            <button onClick={() => setMenuError('')}
              className="mt-1 px-5 py-2.5 rounded-[12px] font-bold text-[14px] active:scale-95"
              style={{ background: TU.accent, color: 'var(--color-text-on-accent, #001512)', border: 'none', cursor: 'pointer' }}>
              {t('nutrition.ok', 'OK')}
            </button>
          </div>
        </div>
      )}

      {/* ── Menu scan: ranked results modal ── */}
      {menuResult && !menuAnalyzing && (() => {
        const calTarget = targets?.daily_calories || 2000;
        const proTarget = targets?.daily_protein_g || 150;
        const carbTarget = targets?.daily_carbs_g || 200;
        const fatTarget = targets?.daily_fat_g || 65;
        const remaining = {
          calories: Math.max(0, calTarget - (todayTotals?.calories || 0)),
          protein_g: Math.max(0, proTarget - (todayTotals?.protein || 0)),
          carbs_g: Math.max(0, carbTarget - (todayTotals?.carbs || 0)),
          fat_g: Math.max(0, fatTarget - (todayTotals?.fat || 0)),
        };
        const goal = onboarding?.primary_goal || 'general';
        const ranked = rankMenuItems(menuResult.items || [], remaining, goal);
        return (
          <MenuScanResultModal
            items={ranked}
            restaurantName={menuResult.restaurant_name}
            remaining={remaining}
            onClose={() => setMenuResult(null)}
            onLogItem={handleLogMenuItem}
          />
        );
      })()}

      {/* Portion-adjust sheet for daily-suggestion / recipe meals */}
      {logMealSheet && (
        <MealLogSheet
          meal={logMealSheet}
          lang={lang}
          onClose={() => setLogMealSheet(null)}
          onLog={async (item) => {
            await handleLogMenuItem(item);
            setLogMealSheet(null);
          }}
        />
      )}

      {/* Re-open from Recently scanned / Saved favorites */}
      {scanResult && (
        <FoodScanResultModal
          source={scanResult.source || 'search'}
          food={scanResult.food}
          onClose={() => setScanResult(null)}
          onSave={handleLogFood}
          onToggleFavorite={handleToggleScannedFavorite}
          isFavorite={isScannedFavorite(scanResult.food)}
          lang={lang}
        />
      )}

      {/* Unified scan-result modal — barcode + AI use the same layout. */}
      {barcodeProduct && (
        <FoodScanResultModal
          source="barcode"
          food={{
            name: barcodeProduct.name,
            brand: barcodeProduct.brand || null,
            image_url: barcodeProduct.image_url || null,
            calories: barcodeProduct.calories,
            protein_g: barcodeProduct.protein_g,
            carbs_g: barcodeProduct.carbs_g,
            fat_g: barcodeProduct.fat_g,
            serving_size: parseFloat(barcodeProduct.serving_g) || 100,
            serving_unit: 'g',
          }}
          onClose={closeBarcodeScanner}
          onRetry={() => { setBarcodeProduct(null); setBarcodeError(''); handleBarcodeRequest('__open_scanner__'); }}
          onSave={async (entry) => { await handleLogFood({ ...entry, food: { ...entry.food, isBarcode: true } }); closeBarcodeScanner(); }}
          onToggleFavorite={handleToggleScannedFavorite}
          isFavorite={isScannedFavorite({ name: barcodeProduct.name })}
          lang={lang}
        />
      )}

      {/* AI analysis: analyzing spinner + error keep using old modal for those states;
          the success state renders the unified FoodScanResultModal. */}
      {(photoAnalyzing || photoError) && !photoResult && (
        <FoodPhotoResultModal
          result={null}
          analyzing={photoAnalyzing}
          error={photoError}
          photoPreview={photoPreview}
          onClose={() => { setPhotoResult(null); setPhotoError(''); setPhotoAnalyzing(false); setPhotoPreview(null); try { localStorage.removeItem('_pendingFoodResult'); } catch {} }}
          onLog={handleLogFood}
          lang={lang}
        />
      )}
      {photoResult && !photoAnalyzing && (() => {
        const cleaned = cleanFoodName(photoResult.food_name) || photoResult.food_name;
        const grams = photoResult.items?.reduce((s, i) => s + (i.grams || 0), 0) || 0;
        return (
          <FoodScanResultModal
            source="ai"
            food={{
              name: cleaned,
              image_url: photoPreview || null,
              calories: photoResult.total_calories,
              protein_g: photoResult.total_protein_g,
              carbs_g: photoResult.total_carbs_g,
              fat_g: photoResult.total_fat_g,
              serving_size: grams || 100,
              serving_unit: 'g',
              grams,
              items: photoResult.items,
            }}
            onClose={() => { setPhotoResult(null); setPhotoError(''); setPhotoAnalyzing(false); setPhotoPreview(null); try { localStorage.removeItem('_pendingFoodResult'); } catch {} }}
            onRetry={() => { setPhotoResult(null); setPhotoError(''); setPhotoPreview(null); handleBarcodeRequest('__open_scanner__'); setScanMode('ai'); }}
            onSave={handleLogFood}
            onToggleFavorite={handleToggleScannedFavorite}
            isFavorite={isScannedFavorite({ name: cleaned })}
            lang={lang}
          />
        );
      })()}

      <FoodLogDetailModal
        log={detailLog}
        onClose={() => setDetailLog(null)}
        onUpdate={handleUpdateLog}
        onDelete={handleDeleteLog}
        onToggleFavorite={(log) => handleToggleScannedFavorite({
          name: log.food_item?.name || log.custom_name,
          image_url: log.food_item?.image_url || log.photo_url,
          brand: log.food_item?.brand,
          calories: log.calories,
          protein_g: log.protein_g,
          carbs_g: log.carbs_g,
          fat_g: log.fat_g,
        })}
        isFavorite={isScannedFavorite({ name: detailLog?.food_item?.name || detailLog?.custom_name })}
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

      <AIConsentDialog
        open={!!aiConsentRequest}
        featureName={aiConsentRequest?.feature || 'food-analysis'}
        onAgree={async () => {
          const pending = aiConsentRequest;
          setAiConsentRequest(null);
          if (!pending) return;
          try { await recordAIConsent(pending.feature); } catch { /* non-blocking */ }
          pending.run?.();
        }}
        onCancel={() => setAiConsentRequest(null)}
      />
      </>, document.body) : <>
      {/* Non-embedded modals render inline */}
      <RecipeDetailModal
        recipe={openRecipe}
        onClose={() => { setOpenRecipe(null); if (collectionContext) { setOpenCollection(collectionContext); setCollectionContext(null); } }}
        saved={openRecipe ? savedRecipeIds.has(openRecipe.id) : false}
        onSave={toggleSaveRecipe}
        onAddToGrocery={handleAddToGrocery}
        onLogMeal={(recipe) => { setOpenRecipe(null); setLogMealSheet(recipe); }}
        groceryAdded={openRecipe ? groceryAdded.has(openRecipe.id) : false}
        lang={lang}
        rating={openRecipe ? (mealRatings[openRecipe.id] || 0) : 0}
        onRate={handleRateMeal}
      />
      <FoodSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={food => { setSearchOpen(false); setLogFood(food); }}
        onLogMeal={recipe => { setSearchOpen(false); setLogMealSheet(recipe); }}
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
      {scanResult && (
        <FoodScanResultModal
          source={scanResult.source || 'search'}
          food={scanResult.food}
          onClose={() => setScanResult(null)}
          onSave={handleLogFood}
          onToggleFavorite={handleToggleScannedFavorite}
          isFavorite={isScannedFavorite(scanResult.food)}
          lang={lang}
        />
      )}
      {barcodeProduct && (
        <FoodScanResultModal
          source="barcode"
          food={{
            name: barcodeProduct.name,
            brand: barcodeProduct.brand || null,
            image_url: barcodeProduct.image_url || null,
            calories: barcodeProduct.calories,
            protein_g: barcodeProduct.protein_g,
            carbs_g: barcodeProduct.carbs_g,
            fat_g: barcodeProduct.fat_g,
            serving_size: parseFloat(barcodeProduct.serving_g) || 100,
            serving_unit: 'g',
          }}
          onClose={closeBarcodeScanner}
          onRetry={() => { setBarcodeProduct(null); setBarcodeError(''); handleBarcodeRequest('__open_scanner__'); }}
          onSave={async (entry) => { await handleLogFood({ ...entry, food: { ...entry.food, isBarcode: true } }); closeBarcodeScanner(); }}
          onToggleFavorite={handleToggleScannedFavorite}
          isFavorite={isScannedFavorite({ name: barcodeProduct.name })}
          lang={lang}
        />
      )}
      {(photoAnalyzing || photoError) && !photoResult && (
        <FoodPhotoResultModal
          result={null}
          analyzing={photoAnalyzing}
          error={photoError}
          photoPreview={photoPreview}
          onClose={() => { setPhotoResult(null); setPhotoError(''); setPhotoAnalyzing(false); setPhotoPreview(null); try { localStorage.removeItem('_pendingFoodResult'); } catch {} }}
          onLog={handleLogFood}
          lang={lang}
        />
      )}
      {photoResult && !photoAnalyzing && (() => {
        const cleaned = cleanFoodName(photoResult.food_name) || photoResult.food_name;
        const grams = photoResult.items?.reduce((s, i) => s + (i.grams || 0), 0) || 0;
        return (
          <FoodScanResultModal
            source="ai"
            food={{
              name: cleaned,
              image_url: photoPreview || null,
              calories: photoResult.total_calories,
              protein_g: photoResult.total_protein_g,
              carbs_g: photoResult.total_carbs_g,
              fat_g: photoResult.total_fat_g,
              serving_size: grams || 100,
              serving_unit: 'g',
              grams,
              items: photoResult.items,
            }}
            onClose={() => { setPhotoResult(null); setPhotoError(''); setPhotoAnalyzing(false); setPhotoPreview(null); try { localStorage.removeItem('_pendingFoodResult'); } catch {} }}
            onRetry={() => { setPhotoResult(null); setPhotoError(''); setPhotoPreview(null); handleBarcodeRequest('__open_scanner__'); setScanMode('ai'); }}
            onSave={handleLogFood}
            onToggleFavorite={handleToggleScannedFavorite}
            isFavorite={isScannedFavorite({ name: cleaned })}
            lang={lang}
          />
        );
      })()}
      <FoodLogDetailModal
        log={detailLog}
        onClose={() => setDetailLog(null)}
        onUpdate={handleUpdateLog}
        onDelete={handleDeleteLog}
        onToggleFavorite={(log) => handleToggleScannedFavorite({
          name: log.food_item?.name || log.custom_name,
          image_url: log.food_item?.image_url || log.photo_url,
          brand: log.food_item?.brand,
          calories: log.calories,
          protein_g: log.protein_g,
          carbs_g: log.carbs_g,
          fat_g: log.fat_g,
        })}
        isFavorite={isScannedFavorite({ name: detailLog?.food_item?.name || detailLog?.custom_name })}
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

      {/* AI third-party consent gate (Apple 5.1.2). The pending action runs
          only after the user accepts. Center-aligned modal — no bottom sheet. */}
      <AIConsentDialog
        open={!!aiConsentRequest}
        featureName={aiConsentRequest?.feature || 'food-analysis'}
        onAgree={async () => {
          const pending = aiConsentRequest;
          setAiConsentRequest(null);
          if (!pending) return;
          try { await recordAIConsent(pending.feature); } catch { /* non-blocking */ }
          pending.run?.();
        }}
        onCancel={() => setAiConsentRequest(null)}
      />
      </>}
    </div>
    </FadeIn>
  );
}
