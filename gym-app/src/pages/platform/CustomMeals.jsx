import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  UtensilsCrossed, Search, AlertTriangle, Loader2, Building2, User as UserIcon, Clock, Trash2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import logger from '../../lib/logger';
import PlatformSpinner from '../../components/platform/PlatformSpinner';

const PAGE_SIZE = 50;

// Role → translated badge. Falls back to the raw role for anything unmapped.
const ROLE_LABEL = {
  super_admin: { key: 'platform.customMeals.roleSuperAdmin', fallback: 'Super Admin' },
  admin:       { key: 'platform.customMeals.roleAdmin',      fallback: 'Admin' },
  trainer:     { key: 'platform.customMeals.roleTrainer',    fallback: 'Trainer' },
  member:      { key: 'platform.customMeals.roleMember',     fallback: 'Member' },
};

const ROLE_COLOR = {
  super_admin: 'bg-[#D4AF37]/15 text-[#D4AF37]',
  admin:       'bg-purple-500/15 text-purple-400',
  trainer:     'bg-blue-500/15 text-blue-400',
  member:      'bg-gray-500/15 text-gray-400',
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function MealRow({ meal, t, onDelete }) {
  const profile = meal.profiles || null;
  const creatorName = profile?.full_name || profile?.username || t('platform.customMeals.unknownCreator', 'Unknown');
  const role = profile?.role || null;
  const roleCfg = role ? ROLE_LABEL[role] : null;
  const roleLabel = roleCfg ? t(roleCfg.key, roleCfg.fallback) : role;
  const roleColor = (role && ROLE_COLOR[role]) || 'bg-gray-500/15 text-gray-400';
  const gymName = meal.gyms?.name || t('platform.customMeals.noGym', 'No gym');
  const createdAt = meal.created_at ? new Date(meal.created_at) : null;
  const hasEs = meal.name_es && meal.name_es !== meal.name;
  // image_url (migration 0580) may be a full public URL or a bare storage path.
  const imageUrl = meal.image_url
    ? (/^https?:\/\//.test(meal.image_url)
        ? meal.image_url
        : supabase.storage.from('meal-photos').getPublicUrl(meal.image_url).data?.publicUrl)
    : null;

  return (
    <div className="py-3 px-1">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_140px_120px_90px] gap-2 md:gap-3 items-start">
        {/* Meal name + photo (the key moderation signal for user-submitted dishes) */}
        <div className="min-w-0 flex items-start gap-2">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              className="w-10 h-10 rounded-md object-cover flex-shrink-0 bg-white/5"
              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
            />
          ) : (
            <div className="w-10 h-10 rounded-md flex-shrink-0 bg-white/[0.04] flex items-center justify-center">
              <UtensilsCrossed size={14} className="text-[#4B5563]" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[13px] text-[#E5E7EB] font-medium truncate">{meal.name}</p>
            {hasEs && (
              <p className="text-[11px] text-[#6B7280] truncate">{meal.name_es}</p>
            )}
          </div>
        </div>

        {/* Macros */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-white/[0.05] text-[#E5E7EB] tabular-nums">
            {num(meal.calories)} {t('platform.customMeals.cal', 'cal')}
          </span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-emerald-500/12 text-emerald-400 tabular-nums">
            P {num(meal.protein_g)}
          </span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-amber-500/12 text-amber-400 tabular-nums">
            C {num(meal.carbs_g)}
          </span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-blue-500/12 text-blue-400 tabular-nums">
            F {num(meal.fat_g)}
          </span>
        </div>

        {/* Creator */}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[12px] text-[#9CA3AF] truncate flex items-center gap-1">
            <UserIcon size={11} className="text-[#6B7280] flex-shrink-0 hidden md:block" />
            {creatorName}
          </span>
          {role && (
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium w-fit ${roleColor}`}>
              {roleLabel}
            </span>
          )}
        </div>

        {/* Gym */}
        <span className="text-[12px] text-[#9CA3AF] truncate flex items-center gap-1">
          <Building2 size={11} className="text-[#6B7280] flex-shrink-0 hidden md:block" />
          {gymName}
        </span>

        {/* Date + moderation */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-[#6B7280] truncate flex items-center gap-1">
            <Clock size={11} className="text-[#6B7280] flex-shrink-0 hidden md:block" />
            {createdAt ? formatDistanceToNow(createdAt, { addSuffix: true }) : '—'}
          </span>
          {onDelete && (
            <button
              onClick={() => onDelete(meal)}
              title={t('platform.customMeals.deleteMeal', 'Delete meal')}
              aria-label={t('platform.customMeals.deleteMeal', 'Delete meal')}
              className="p-1 rounded-md text-[#4B5563] hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CustomMeals() {
  const { t } = useTranslation('pages');

  useEffect(() => {
    document.title = `${t('platform.customMeals.title', 'Custom Meals')} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [t]);

  const [meals, setMeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [fetchError, setFetchError] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchMeals = useCallback(async (offset = 0, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);

    const { data, error, count } = await supabase
      .from('custom_meals')
      .select(
        '*, profiles!custom_meals_created_by_fkey(full_name, username, role), gyms(name)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      logger.error('Error fetching custom meals:', error);
      if (!append) {
        setFetchError(true);
        setMeals([]);
        setTotalCount(0);
        setLoading(false);
      } else {
        setLoadingMore(false);
      }
      return;
    }

    setFetchError(false);
    const results = data || [];
    if (append) setMeals((prev) => [...prev, ...results]);
    else setMeals(results);

    if (count !== null && !append) setTotalCount(count);
    setHasMore(results.length === PAGE_SIZE);
    if (!append) setLoading(false);
    else setLoadingMore(false);
  }, []);

  useEffect(() => {
    fetchMeals(0, false);
  }, [fetchMeals]);

  const handleLoadMore = () => fetchMeals(meals.length, true);

  // Moderation: super_admin DELETE policy on custom_meals added in 0585.
  const handleDelete = useCallback(async (meal) => {
    const label = meal.name || 'this meal';
    if (!window.confirm(t('platform.customMeals.deleteConfirm', { name: label, defaultValue: `Delete "${label}"? This permanently removes the user-submitted meal.` }))) return;
    const { error } = await supabase.from('custom_meals').delete().eq('id', meal.id);
    if (error) { window.alert(t('platform.customMeals.deleteFailed', 'Delete failed: {{msg}}', { msg: error.message })); return; }
    setMeals((prev) => prev.filter((m) => m.id !== meal.id));
    setTotalCount((c) => Math.max(0, c - 1));
  }, [t]);

  // Client-side search over the loaded rows (meal name, name_es, or creator).
  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return meals;
    return meals.filter((m) => {
      const creator = m.profiles?.full_name || m.profiles?.username || '';
      return (
        (m.name || '').toLowerCase().includes(q)
        || (m.name_es || '').toLowerCase().includes(q)
        || creator.toLowerCase().includes(q)
      );
    });
  }, [meals, searchTerm]);

  const uniqueCreators = useMemo(
    () => new Set(meals.map((m) => m.created_by).filter(Boolean)).size,
    [meals],
  );
  const uniqueGyms = useMemo(
    () => new Set(meals.map((m) => m.gym_id).filter(Boolean)).size,
    [meals],
  );

  const searching = searchTerm.trim().length > 0;

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-[22px] font-bold text-[#E5E7EB]">{t('platform.customMeals.title', 'Custom Meals')}</h1>
        <p className="text-[12px] text-[#6B7280] mt-0.5">
          {t('platform.customMeals.subtitle', 'User-submitted dishes from trainers and members')}
        </p>
      </div>

      {/* Summary stats — Total Meals is a server count; creators/gyms reflect
          the loaded page(s), so qualify them when the list is partial. */}
      {!loading && !fetchError && (() => {
        const loadedOnly = meals.length < totalCount;
        const qualifier = loadedOnly ? ` (${t('platform.errors.fromLoaded', 'of loaded')})` : '';
        return (
          <div className="grid grid-cols-3 gap-2.5 mb-6">
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
              <p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums">{totalCount.toLocaleString()}</p>
              <p className="text-[10px] text-[#6B7280] mt-0.5">{t('platform.customMeals.totalMeals', 'Total Meals')}</p>
            </div>
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
              <p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums">{uniqueCreators}</p>
              <p className="text-[10px] text-[#6B7280] mt-0.5">{t('platform.customMeals.uniqueCreators', 'Creators')}{qualifier}</p>
            </div>
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3.5">
              <p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums">{uniqueGyms}</p>
              <p className="text-[10px] text-[#6B7280] mt-0.5">{t('platform.customMeals.gymsRepresented', 'Gyms')}{qualifier}</p>
            </div>
          </div>
        );
      })()}

      {/* Search */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4 mb-6 overflow-hidden">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
          <input
            type="text"
            placeholder={t('platform.customMeals.searchPlaceholder', 'Search by meal or creator name...')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#111827] border border-white/6 rounded-lg pl-9 pr-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 transition-colors"
          />
        </div>
      </div>

      {/* Table header (desktop) */}
      <div className="hidden md:block bg-[#0F172A] border border-white/6 rounded-t-xl px-5 py-2.5 border-b-0">
        <div className="grid grid-cols-[1fr_180px_140px_120px_90px] gap-3 items-center">
          <span className="text-[10px] text-[#6B7280] uppercase tracking-wider font-medium">{t('platform.customMeals.headerMeal', 'Meal')}</span>
          <span className="text-[10px] text-[#6B7280] uppercase tracking-wider font-medium">{t('platform.customMeals.headerMacros', 'Macros')}</span>
          <span className="text-[10px] text-[#6B7280] uppercase tracking-wider font-medium">{t('platform.customMeals.headerCreator', 'Creator')}</span>
          <span className="text-[10px] text-[#6B7280] uppercase tracking-wider font-medium">{t('platform.customMeals.headerGym', 'Gym')}</span>
          <span className="text-[10px] text-[#6B7280] uppercase tracking-wider font-medium">{t('platform.customMeals.headerDate', 'Added')}</span>
        </div>
      </div>

      {/* List */}
      <div className="bg-[#0F172A] border border-white/6 rounded-b-xl rounded-xl md:rounded-xl p-4 md:border-t-0 md:rounded-t-none overflow-hidden">
        {loading ? (
          <PlatformSpinner />
        ) : fetchError ? (
          <div className="text-center py-16">
            <AlertTriangle size={32} className="mx-auto text-red-400 mb-3" />
            <p className="text-[14px] text-red-400">{t('platform.customMeals.fetchFailed', 'Could not load custom meals')}</p>
            <p className="text-[12px] text-[#6B7280]/60 mt-1">
              {t('platform.customMeals.fetchFailedHint', 'The query failed — this is not an empty library.')}
            </p>
            <button
              onClick={() => fetchMeals(0, false)}
              className="mt-4 px-4 py-2 rounded-lg text-[12px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
            >
              {t('platform.customMeals.retry', 'Retry')}
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <UtensilsCrossed size={32} className="mx-auto text-[#6B7280] mb-3" />
            <p className="text-[14px] text-[#6B7280]">
              {searching
                ? t('platform.customMeals.noResults', 'No meals match your search')
                : t('platform.customMeals.noMeals', 'No custom meals yet')}
            </p>
            <p className="text-[12px] text-[#6B7280]/60 mt-1">
              {searching
                ? t('platform.customMeals.noResultsHint', 'Try a different meal or creator name')
                : t('platform.customMeals.noMealsHint', 'Dishes added by trainers and members will appear here')}
            </p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-white/4">
              {filtered.map((meal) => (
                <MealRow key={meal.id} meal={meal} t={t} onDelete={handleDelete} />
              ))}
            </div>

            {/* Load more — paginates the underlying query (search filters the
                loaded set, so hide it while a search is active). */}
            {hasMore && !searching && (
              <div className="flex justify-center pt-4 mt-2">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="px-5 py-2 rounded-lg text-[13px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/10 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      {t('platform.customMeals.loading', 'Loading...')}
                    </>
                  ) : (
                    t('platform.customMeals.loadMore', 'Load more')
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
