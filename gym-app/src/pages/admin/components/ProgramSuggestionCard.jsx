import { useQuery } from '@tanstack/react-query';
import { Dumbbell, Lightbulb, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

/**
 * Shows a data-driven monthly program suggestion for the gym, derived from the
 * most common primary_goal in member_onboarding. Clicking the CTA calls
 * `onCreateProgram` so the parent (AdminPrograms) can seed its program builder
 * flow. Self-contained query (cached 24h) keyed by gymId.
 */
export default function ProgramSuggestionCard({ gymId, t, isEs, onCreateProgram }) {
  const { data: suggestion } = useQuery({
    queryKey: ['program-suggestion', gymId],
    queryFn: async () => {
      // fitness_level + primary_goal live on member_onboarding (not profiles).
      const { data: onboardings } = await supabase
        .from('member_onboarding')
        .select('fitness_level, primary_goal')
        .eq('gym_id', gymId);

      if (!onboardings?.length) return null;

      const goalCounts = {};
      const levelCounts = {};
      onboardings.forEach(p => {
        if (p.primary_goal) goalCounts[p.primary_goal] = (goalCounts[p.primary_goal] || 0) + 1;
        if (p.fitness_level) levelCounts[p.fitness_level] = (levelCounts[p.fitness_level] || 0) + 1;
      });

      const topGoal = Object.entries(goalCounts).sort((a, b) => b[1] - a[1])[0];
      const topLevel = Object.entries(levelCounts).sort((a, b) => b[1] - a[1])[0];

      if (!topGoal) return null;

      const SUGGESTIONS = {
        muscle_gain: { nameKey: 'hypertrophy', descKey: 'hypertrophy', nameDefault: 'Hypertrophy Focus Program', descDefault: 'Build muscle mass with high-volume training', template: 'ppl' },
        strength: { nameKey: 'strength', descKey: 'strength', nameDefault: 'Strength Builder Program', descDefault: 'Maximize raw strength on key compound lifts', template: 'upper_lower' },
        fat_loss: { nameKey: 'fatLoss', descKey: 'fatLoss', nameDefault: 'Fat Loss Circuit Program', descDefault: 'Burn fat with circuit-style training', template: 'full_body' },
        endurance: { nameKey: 'endurance', descKey: 'endurance', nameDefault: 'Endurance Training Program', descDefault: 'Build cardiovascular and muscular endurance', template: 'full_body' },
        general_fitness: { nameKey: 'general', descKey: 'general', nameDefault: 'General Fitness Program', descDefault: 'Well-rounded program for overall fitness', template: 'full_body' },
      };

      const s = SUGGESTIONS[topGoal[0]] || SUGGESTIONS.general_fitness;

      // Has this period's pick already been created? We store the program's
      // English name (s.nameDefault) on create, so match on that within ~60 days.
      let createdAt = null;
      try {
        const since = new Date();
        since.setDate(since.getDate() - 60);
        const { data: recent } = await supabase
          .from('gym_programs')
          .select('name, created_at')
          .eq('gym_id', gymId)
          .gte('created_at', since.toISOString())
          .order('created_at', { ascending: false });
        createdAt = (recent || []).find(p => p.name === s.nameDefault)?.created_at || null;
      } catch { /* non-fatal: treat as not created */ }

      return {
        ...s,
        topGoal: topGoal[0],
        goalCount: topGoal[1],
        totalMembers: onboardings.length,
        topLevel: topLevel?.[0],
        pct: Math.round((topGoal[1] / onboardings.length) * 100),
        createdAt,
      };
    },
    staleTime: 24 * 60 * 60 * 1000,
    enabled: !!gymId,
  });

  if (!suggestion) return null;

  const name = t(`admin.programs.suggestion.${suggestion.nameKey}.name`, suggestion.nameDefault);
  const desc = t(`admin.programs.suggestion.${suggestion.descKey}.desc`, suggestion.descDefault);

  const lang = isEs ? 'es' : 'en';
  const periodLabel = new Date().toLocaleDateString(lang, { month: 'long', year: 'numeric' });
  const created = !!suggestion.createdAt;
  const createdDate = created ? new Date(suggestion.createdAt).toLocaleDateString(lang, { day: 'numeric', month: 'short' }) : '';

  return (
    <div
      className="mb-5 rounded-[16px] p-5"
      style={{
        background: 'linear-gradient(110deg, var(--color-coach-soft), color-mix(in srgb, var(--color-accent) 18%, transparent))',
        border: '1px solid var(--color-coach-soft)',
      }}
    >
      <div className="flex items-start gap-3.5">
        <div
          className="w-11 h-11 rounded-[12px] flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-bg-card)' }}
        >
          <Lightbulb size={20} style={{ color: 'var(--color-coach)' }} strokeWidth={2} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="admin-eyebrow" style={{ color: 'var(--color-accent)' }}>
              {t('admin.programs.suggestion.title', 'Monthly Suggestion')} · {periodLabel}
            </span>
          </div>

          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <Dumbbell size={16} style={{ color: 'var(--color-admin-text)' }} />
            <p className="admin-page-title text-[20px] truncate" style={{ letterSpacing: '-0.02em' }}>{name}</p>
          </div>

          <p className="text-[13px] leading-relaxed mb-2" style={{ color: 'var(--color-admin-text-sub)' }}>{desc}</p>

          <p className="text-[11px] mb-3.5" style={{ color: 'var(--color-admin-text-muted)' }}>
            {t('admin.programs.suggestion.basedOn', 'Based on {{pct}}% of your members ({{count}}/{{total}})', {
              pct: suggestion.pct,
              count: suggestion.goalCount,
              total: suggestion.totalMembers,
            })}
          </p>

          {created ? (
            <div>
              <div className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12.5px] font-bold"
                style={{ background: 'var(--color-success-soft)', color: 'var(--color-success)' }}>
                <CheckCircle2 size={15} /> {t('admin.programs.suggestion.created', 'Created')}{createdDate ? ` · ${createdDate}` : ''}
              </div>
              <p className="text-[10.5px] mt-1.5" style={{ color: 'var(--color-admin-text-muted)' }}>
                {t('admin.programs.suggestion.alreadyHint', "You've already created this month's pick — a fresh one comes next month.")}
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onCreateProgram(suggestion)}
              className="px-5 py-2.5 rounded-xl text-[13px] font-bold transition-all active:scale-[0.97]"
              style={{ background: 'var(--color-admin-text)', color: '#fff' }}
            >
              {t('admin.programs.suggestion.createButton', 'Create This Program')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
