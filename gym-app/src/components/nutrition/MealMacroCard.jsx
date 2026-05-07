import React from 'react';
import { useTranslation } from 'react-i18next';

const TU = {
  macroP: 'var(--tu-macro-p, #2EC4C4)',
  macroC: 'var(--tu-macro-c, #FF7A3D)',
  macroF: 'var(--tu-macro-f, #FFC24A)',
  display: '"Familjen Grotesk", "Archivo", system-ui, sans-serif',
};

// One layout for every "this meal looks like X" surface (recipe detail,
// menu-scan confirm sheet, daily-suggestion log sheet, today's-meals detail).
// Big calorie number top-left, three colored-line macro tiles below.
// Pass `editing`/`editValues`/`onEditChange` for the edit mode used by
// FoodLogDetailModal.
export default function MealMacroCard({
  calories,
  protein,
  carbs,
  fat,
  editing = false,
  editValues = {},
  onEditChange,
  background = 'var(--color-bg-card)',
  compact = false,
}) {
  const { t } = useTranslation('pages');
  const cal = Math.round(Number(calories) || 0);
  const p = Number(protein) || 0;
  const c = Number(carbs) || 0;
  const f = Number(fat) || 0;
  const calSize = compact ? 30 : 34;
  const macroSize = compact ? 18 : 20;
  const macros = [
    { key: 'protein_g', l: t('nutrition.protein'), v: p, c: TU.macroP },
    { key: 'carbs_g',   l: t('nutrition.carbs'),   v: c, c: TU.macroC },
    { key: 'fat_g',     l: t('nutrition.fat'),     v: f, c: TU.macroF },
  ];
  return (
    <div className="rounded-[22px] p-4" style={{ background, boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
      <div className="flex items-baseline gap-1 mb-3.5">
        {editing ? (
          <input
            type="number" inputMode="numeric" min="0"
            value={editValues.calories ?? ''}
            onFocus={e => e.target.select()}
            onChange={e => onEditChange?.('calories', e.target.value)}
            className="bg-transparent outline-none tabular-nums [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
            style={{ fontFamily: TU.display, fontSize: calSize, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -1.5, lineHeight: 1, width: '4ch' }}
            aria-label={t('nutrition.dailyCalories', 'Calories')}
          />
        ) : (
          <span style={{ fontFamily: TU.display, fontSize: calSize, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -1.5, lineHeight: 1 }}>{cal}</span>
        )}
        <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>kcal</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {macros.map(m => (
          <div key={m.key}>
            <div className="rounded-full mb-2" style={{ height: 3, background: m.c }} />
            <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>{m.l}</div>
            {editing ? (
              <input
                type="number" inputMode="decimal" min="0"
                value={editValues[m.key] ?? ''}
                onFocus={e => e.target.select()}
                onChange={e => onEditChange?.(m.key, e.target.value)}
                className="bg-transparent outline-none tabular-nums mt-0.5 [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                style={{ fontFamily: TU.display, fontSize: macroSize, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5, width: '3ch' }}
                aria-label={m.l}
              />
            ) : (
              <div className="mt-0.5" style={{ fontFamily: TU.display, fontSize: macroSize, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>
                {Math.round(m.v * 10) / 10}<span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>g</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
