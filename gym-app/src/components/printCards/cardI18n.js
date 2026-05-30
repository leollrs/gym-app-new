/**
 * Render-time localization for print cards.
 *
 * The daily cron (generate_print_cards_daily) writes headline/subline onto
 * print_cards as hardcoded ENGLISH strings — it has no member/gym language.
 * So we localize at render time against the app's current UI language: for
 * every known occasion we override the stored English with a translated
 * template (admin.printCards.card.headline/subline.<occasion>), falling back
 * to the stored value via defaultValue. `custom` and any unknown occasion are
 * owner-authored free text, so we keep the database value verbatim.
 */

// Occasions whose headline/subline are cron-generated boilerplate we can
// safely replace with a localized template. `custom` is intentionally absent.
const TEMPLATED_OCCASIONS = new Set([
  'welcome', 'habit_9in6', 'tenure_30', 'tenure_90', 'tenure_365',
  'milestone_100', 'milestone_250', 'milestone_500', 'returning', 'birthday',
]);

/**
 * Returns { headline, subline } localized to the active language.
 * @param {object} card  print_cards row (occasion, occasion_data, headline, subline)
 * @param {function} t   i18next t bound to the 'pages' namespace
 */
export function localizeHeadlineSubline(card, t) {
  const dbHeadline = card.headline || '';
  const dbSubline = card.subline || '';
  const occ = card.occasion;
  if (!TEMPLATED_OCCASIONS.has(occ)) {
    return { headline: dbHeadline, subline: dbSubline };
  }
  // Only `returning` interpolates a value; pass it explicitly rather than
  // spreading occasion_data, since keys like `count` would trigger i18next
  // pluralization on unrelated cards.
  const opts = occ === 'returning'
    ? { absence_days: card.occasion_data?.absence_days ?? 0 }
    : {};
  return {
    headline: t(`admin.printCards.card.headline.${occ}`, { ...opts, defaultValue: dbHeadline }),
    subline: t(`admin.printCards.card.subline.${occ}`, { ...opts, defaultValue: dbSubline }),
  };
}
