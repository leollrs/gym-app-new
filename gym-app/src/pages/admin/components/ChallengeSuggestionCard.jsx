import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Lightbulb, Sparkles, Dumbbell, Zap, Star, Users, Target } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { AdminCard } from '../../../components/admin';
import { useState } from 'react';
import { getISOWeek } from 'date-fns';

const TYPE_ICONS = {
  consistency: Dumbbell,
  volume: Zap,
  pr_count: Star,
  specific_lift: Dumbbell,
  team: Users,
  milestone: Target,
};

export default function ChallengeSuggestionCard({ gymId, onCreateFromSuggestion }) {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');

  const { data: suggestion, isLoading } = useQuery({
    queryKey: adminKeys.challengeSuggestion(gymId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_challenge_suggestion', { p_gym_id: gymId });
      if (error) throw error;
      return data?.[0] || null;
    },
    enabled: !!gymId,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  });

  // "New" badge logic — shows until admin sees it this week
  const currentWeek = getISOWeek(new Date());
  const storageKey = `suggestion_seen_${gymId}`;
  const [seen, setSeen] = useState(() => {
    try { return parseInt(localStorage.getItem(storageKey) || '0') === currentWeek; } catch { return false; }
  });

  if (isLoading || !suggestion) return null;

  const name = isEs ? suggestion.suggested_name_es : suggestion.suggested_name_en;
  const reasoning = isEs ? suggestion.reasoning_es : suggestion.reasoning_en;
  const description = isEs ? suggestion.description_es : suggestion.description_en;
  const TypeIcon = TYPE_ICONS[suggestion.challenge_type] || Dumbbell;
  const confidencePct = Math.round((suggestion.confidence || 0.5) * 100);

  const handleCreate = () => {
    // Mark as seen
    setSeen(true);
    try { localStorage.setItem(storageKey, String(currentWeek)); } catch {}
    onCreateFromSuggestion(suggestion);
  };

  return (
    <AdminCard className="mb-5 border-[#D4AF37]/20 bg-gradient-to-r from-[#D4AF37]/[0.04] to-transparent">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
          <Lightbulb size={20} className="text-[#D4AF37]" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <p className="text-[12px] font-semibold text-[#D4AF37] uppercase tracking-wider">
              {t('admin.challenges.suggestion.title', 'Suggested This Week')}
            </p>
            {!seen && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#D4AF37] text-black text-[9px] font-bold uppercase">
                <Sparkles size={10} />
                {t('admin.challenges.suggestion.new', 'NEW')}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mb-2">
            <TypeIcon size={15} className="text-[#E5E7EB] flex-shrink-0" />
            <p className="text-[16px] font-bold text-[#E5E7EB] truncate">{name}</p>
            <span className="text-[10px] font-semibold text-[#9CA3AF] bg-white/5 px-2 py-0.5 rounded-full flex-shrink-0">
              {t(`admin.challengeTypes.${suggestion.challenge_type}`, suggestion.challenge_type)}
            </span>
          </div>

          <p className="text-[13px] text-[#9CA3AF] leading-relaxed mb-3">{reasoning}</p>

          {/* Confidence bar */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[10px] font-medium text-[#6B7280] uppercase tracking-wider">
              {t('admin.challenges.suggestion.confidence', 'Confidence')}
            </span>
            <div className="flex-1 h-1.5 bg-white/5 rounded-full max-w-[120px]">
              <div
                className="h-full rounded-full bg-[#D4AF37] transition-all"
                style={{ width: `${confidencePct}%` }}
              />
            </div>
            <span className="text-[10px] font-bold text-[#D4AF37] tabular-nums">{confidencePct}%</span>
          </div>

          <button
            type="button"
            onClick={handleCreate}
            className="px-5 py-2.5 rounded-xl text-[13px] font-bold text-black bg-[#D4AF37] hover:bg-[#E6C766] active:scale-[0.97] transition-all"
          >
            {t('admin.challenges.suggestion.createButton', 'Create This Challenge')}
          </button>
        </div>
      </div>
    </AdminCard>
  );
}
