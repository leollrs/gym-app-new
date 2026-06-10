import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Check, ArrowRight, Sparkles, BookOpen, Utensils } from 'lucide-react';
import MealMacroCard from './MealMacroCard';

const TU = {
  macroP: 'var(--tu-macro-p, #2EC4C4)',
  macroC: 'var(--tu-macro-c, #FF7A3D)',
  macroF: 'var(--tu-macro-f, #FFC24A)',
  accent: 'var(--color-accent, #2EC4C4)',
  coach:  '#6D5FDB',
  gold:   '#F2B544',
  display: '"Familjen Grotesk", "Archivo", system-ui, sans-serif',
};

// Match-label color + background
function labelStyle(label) {
  switch (label) {
    case 'Great fit': return { bg: 'rgba(34,197,94,0.14)',  fg: '#1A7F3F', border: 'rgba(34,197,94,0.35)' };
    case 'Good fit':  return { bg: 'rgba(46,196,196,0.15)', fg: '#0F7B7B', border: 'rgba(46,196,196,0.35)' };
    case 'Okay':      return { bg: 'rgba(120,113,108,0.14)', fg: '#524A3F', border: 'rgba(120,113,108,0.30)' };
    case 'Heavy':
    default:          return { bg: 'rgba(255,122,61,0.14)', fg: '#B14A1E', border: 'rgba(255,122,61,0.35)' };
  }
}

function translatedLabel(t, label) {
  const key = {
    'Great fit': 'nutrition.menuScan.matchGreat',
    'Good fit':  'nutrition.menuScan.matchGood',
    'Okay':      'nutrition.menuScan.matchOkay',
    'Heavy':     'nutrition.menuScan.matchHeavy',
  }[label];
  return key ? t(key, label) : label;
}

const MacroPill = ({ value, suffix, color, label }) => {
  const safe = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
  return (
    <div
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold"
      style={{
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
        fontFamily: TU.display,
        letterSpacing: -0.1,
      }}
    >
      <span className="tabular-nums">{safe}{suffix}</span>
      <span style={{ opacity: 0.7 }}>{label}</span>
    </div>
  );
};

/**
 * MenuScanResultModal
 *
 * Props:
 *   items: ranked array from rankMenuItems() — each has matchScore, matchLabel, isTopPick
 *   restaurantName: string | null
 *   remaining: { calories, protein_g, carbs_g, fat_g }
 *   onClose: () => void
 *   onLogItem: (item) => Promise<void>
 */
export default function MenuScanResultModal({
  items = [],
  restaurantName = null,
  remaining = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  onClose,
  onLogItem,
}) {
  const { t } = useTranslation('pages');
  const [confirmItem, setConfirmItem] = useState(null);
  const [portion, setPortion] = useState(1);
  const [saving, setSaving] = useState(false);

  // Body scroll lock while modal is open
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  // Reset portion each time a new item opens
  useEffect(() => { setPortion(1); }, [confirmItem]);

  const totalItems = items.length;
  const remainingCal = Math.max(0, Math.round(remaining.calories || 0));
  const remainingPro = Math.max(0, Math.round(remaining.protein_g || 0));

  const scaled = useMemo(() => {
    if (!confirmItem) return null;
    const p = Math.max(0.25, Math.min(portion, 4));
    return {
      calories: Math.round((confirmItem.calories || 0) * p),
      protein_g: Math.round(((confirmItem.protein_g || 0) * p) * 10) / 10,
      carbs_g: Math.round(((confirmItem.carbs_g || 0) * p) * 10) / 10,
      fat_g: Math.round(((confirmItem.fat_g || 0) * p) * 10) / 10,
    };
  }, [confirmItem, portion]);

  const handleLog = async () => {
    if (!confirmItem || saving) return;
    setSaving(true);
    try {
      await onLogItem({
        ...confirmItem,
        calories: scaled.calories,
        protein_g: scaled.protein_g,
        carbs_g: scaled.carbs_g,
        fat_g: scaled.fat_g,
        servings: portion,
      });
      // parent closes the modal after success
    } finally {
      setSaving(false);
    }
  };

  const headerTitle = restaurantName
    ? t('nutrition.menuScan.titleFromRestaurant', { name: restaurantName, defaultValue: `Menu from ${restaurantName}` })
    : t('nutrition.menuScan.title', 'Menu');

  const node = (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center px-4"
      style={{ background: 'rgba(20,14,8,0.55)', backdropFilter: 'blur(8px)' }}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] max-h-[92vh] rounded-[28px] flex flex-col overflow-hidden"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border-subtle)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
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
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen size={16} style={{ color: TU.coach }} />
            <h2
              className="text-[16px] font-extrabold truncate"
              style={{ color: 'var(--color-text-primary)', fontFamily: TU.display, letterSpacing: -0.2 }}
            >
              {headerTitle}
            </h2>
          </div>
          <div
            className="px-2.5 h-8 rounded-full inline-flex items-center justify-center text-[12px] font-bold tabular-nums"
            style={{
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-primary)',
              fontFamily: TU.display,
              minWidth: 40,
            }}
          >
            {totalItems}
          </div>
        </div>

        {/* ── Remaining macros banner ── */}
        <div
          className="mx-4 mb-3 px-3.5 py-2.5 rounded-[14px] flex items-center gap-2 text-[12px] font-semibold"
          style={{
            background: 'color-mix(in srgb, var(--color-accent, #2EC4C4) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-accent, #2EC4C4) 22%, transparent)',
            color: 'var(--color-text-primary)',
            fontFamily: TU.display,
          }}
        >
          <Sparkles size={14} style={{ color: TU.accent, flexShrink: 0 }} />
          <span>
            {t('nutrition.menuScan.remaining', {
              cal: remainingCal,
              pro: remainingPro,
              defaultValue: `You have ${remainingCal} kcal · ${remainingPro}g P remaining today`,
            })}
          </span>
        </div>

        {/* ── Item list ── */}
        <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          {items.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center text-center py-10 rounded-[18px]"
              style={{
                background: 'var(--color-bg-surface)',
                border: '1px dashed var(--color-border-subtle)',
              }}
            >
              <Utensils size={28} style={{ color: 'var(--color-text-muted)', marginBottom: 10 }} />
              <p className="text-[14px] font-bold mb-1" style={{ color: 'var(--color-text-primary)', fontFamily: TU.display }}>
                {t('nutrition.menuScan.emptyTitle', 'No items detected')}
              </p>
              <p className="text-[12px] px-6" style={{ color: 'var(--color-text-muted)' }}>
                {t('nutrition.menuScan.emptyHint', 'Try again with better lighting')}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {items.map((item, idx) => {
                const style = labelStyle(item.matchLabel);
                return (
                  <li key={`${item.name}-${idx}`}>
                    <button
                      type="button"
                      onClick={() => setConfirmItem(item)}
                      className="w-full text-left rounded-[18px] p-3.5 relative active:scale-[0.99] transition-transform"
                      style={{
                        background: 'var(--color-bg-surface)',
                        border: item.isTopPick
                          ? `1.5px solid ${TU.gold}`
                          : '1px solid var(--color-border-subtle)',
                        boxShadow: item.isTopPick
                          ? '0 10px 22px rgba(242, 181, 68, 0.18)'
                          : '0 2px 8px rgba(0,0,0,0.04)',
                        cursor: 'pointer',
                      }}
                    >
                      {item.isTopPick && (
                        <div
                          className="absolute -top-2 left-3 px-2 py-0.5 rounded-full text-[10px] font-black tracking-wider"
                          style={{
                            background: TU.gold,
                            color: '#2A1C00',
                            fontFamily: TU.display,
                            letterSpacing: 0.8,
                            boxShadow: '0 4px 10px rgba(242, 181, 68, 0.35)',
                          }}
                        >
                          {t('nutrition.menuScan.topPick', 'TOP PICK')}
                        </div>
                      )}

                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          {item.section && (
                            <p
                              className="text-[10px] font-bold uppercase tracking-wide mb-0.5"
                              style={{ color: 'var(--color-text-muted)', letterSpacing: 0.5 }}
                            >
                              {item.section}
                            </p>
                          )}
                          <h3
                            className="text-[16px] font-extrabold leading-tight"
                            style={{
                              color: 'var(--color-text-primary)',
                              fontFamily: TU.display,
                              letterSpacing: -0.3,
                            }}
                          >
                            {item.name}
                          </h3>
                          {item.description && (
                            <p
                              className="text-[12px] mt-1 leading-snug"
                              style={{ color: 'var(--color-text-muted)' }}
                            >
                              {item.description}
                            </p>
                          )}
                        </div>
                        {item.price && (
                          <div
                            className="text-[13px] font-bold tabular-nums whitespace-nowrap"
                            style={{ color: 'var(--color-text-primary)', fontFamily: TU.display }}
                          >
                            {item.price}
                          </div>
                        )}
                      </div>

                      {/* Macro pills */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                        <MacroPill value={item.calories} suffix="" color="var(--color-text-primary)" label={t('nutrition.kcal', 'kcal')} />
                        <MacroPill value={item.protein_g} suffix="g" color={TU.macroP} label="P" />
                        <MacroPill value={item.carbs_g} suffix="g" color={TU.macroC} label="C" />
                        <MacroPill value={item.fat_g} suffix="g" color={TU.macroF} label="F" />
                      </div>

                      {/* Match label + arrow */}
                      <div className="flex items-center justify-between mt-2.5">
                        <span
                          className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold"
                          style={{
                            background: style.bg,
                            color: style.fg,
                            border: `1px solid ${style.border}`,
                            fontFamily: TU.display,
                          }}
                        >
                          {translatedLabel(t, item.matchLabel)}
                        </span>
                        <ArrowRight size={14} style={{ color: 'var(--color-text-muted)' }} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── Confirm sheet ── */}
      {confirmItem && (
        <div
          className="fixed inset-0 z-[96] flex items-center justify-center px-4"
          style={{ background: 'rgba(20,14,8,0.6)', backdropFilter: 'blur(10px)' }}
          onClick={() => (saving ? null : setConfirmItem(null))}
        >
          <div
            className="w-full max-w-[420px] rounded-[26px] p-5"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3
                  className="text-[17px] font-extrabold leading-tight"
                  style={{ color: 'var(--color-text-primary)', fontFamily: TU.display, letterSpacing: -0.3 }}
                >
                  {confirmItem.name}
                </h3>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  {t('nutrition.menuScan.logThisQ', 'Log this item?')}
                </p>
              </div>
              <button
                onClick={() => !saving && setConfirmItem(null)}
                aria-label={t('common.close', 'Close')}
                className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                style={{
                  background: 'var(--color-bg-surface)',
                  border: '1px solid var(--color-border-subtle)',
                  cursor: 'pointer',
                }}
              >
                <X size={15} style={{ color: 'var(--color-text-primary)' }} />
              </button>
            </div>

            {/* Portion stepper */}
            <div
              className="flex items-center justify-between rounded-[14px] px-3.5 py-2.5 mb-3"
              style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}
            >
              <span className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: TU.display }}>
                {t('nutrition.menuScan.portion', 'Portion')}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPortion((p) => Math.max(0.25, +(p - 0.25).toFixed(2)))}
                  className="w-8 h-8 rounded-full font-bold text-[16px] active:scale-90"
                  style={{
                    background: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border-subtle)',
                    color: 'var(--color-text-primary)',
                    cursor: 'pointer',
                  }}
                  aria-label="-"
                >−</button>
                <span className="text-[15px] font-extrabold tabular-nums" style={{ color: 'var(--color-text-primary)', fontFamily: TU.display, minWidth: 36, textAlign: 'center' }}>
                  {portion}×
                </span>
                <button
                  type="button"
                  onClick={() => setPortion((p) => Math.min(4, +(p + 0.25).toFixed(2)))}
                  className="w-8 h-8 rounded-full font-bold text-[16px] active:scale-90"
                  style={{
                    background: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border-subtle)',
                    color: 'var(--color-text-primary)',
                    cursor: 'pointer',
                  }}
                  aria-label="+"
                >+</button>
              </div>
            </div>

            {/* Scaled macros preview — shared card for visual parity with recipes / today's meals */}
            <div className="mb-4">
              <MealMacroCard
                calories={scaled?.calories ?? 0}
                protein={scaled?.protein_g ?? 0}
                carbs={scaled?.carbs_g ?? 0}
                fat={scaled?.fat_g ?? 0}
                background="var(--color-bg-surface)"
                compact
              />
            </div>

            <button
              type="button"
              onClick={handleLog}
              disabled={saving}
              className="w-full py-3 rounded-[14px] flex items-center justify-center gap-2 text-[14px] font-extrabold active:scale-[0.98] transition-transform"
              style={{
                background: TU.accent,
                color: 'var(--color-text-on-accent, #001512)',
                fontFamily: TU.display,
                letterSpacing: -0.1,
                opacity: saving ? 0.7 : 1,
                cursor: saving ? 'default' : 'pointer',
                border: 'none',
                boxShadow: '0 10px 22px color-mix(in srgb, var(--color-accent, #2EC4C4) 30%, transparent)',
              }}
            >
              <Check size={16} />
              {saving ? t('nutrition.menuScan.logging', 'Logging…') : t('nutrition.menuScan.logThis', 'Log this')}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(node, document.body);
}
