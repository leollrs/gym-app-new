/**
 * Card dispatcher — maps a print_cards row to the right v2 component.
 *
 * Two paper sizes:
 *   • postcard — single 4×6 sheet, single component
 *   • folded   — outside spread (1 sheet) + inside spread (1 sheet),
 *                two components per card
 *
 * PrintCardsView groups cards by paper type before laying them out,
 * because each paper type prints on a differently-oriented US Letter
 * sheet (postcards = portrait 2-up, folded = landscape 1-up).
 */
import {
  WelcomeCard, HabitCard, Tenure30Card, Tenure90Card,
  Milestone100Card, Milestone250Card, ReturningCard, BirthdayCard, CustomCard,
} from './Postcards.jsx';
import {
  Tenure365Outside, Tenure365Inside, Milestone500Outside, Milestone500Inside,
} from './FoldedCards.jsx';

const POSTCARD_MAP = {
  welcome:       WelcomeCard,
  habit_9in6:    HabitCard,
  tenure_30:     Tenure30Card,
  tenure_90:     Tenure90Card,
  milestone_100: Milestone100Card,
  milestone_250: Milestone250Card,
  returning:     ReturningCard,
  birthday:      BirthdayCard,
  custom:        CustomCard,
};

const FOLDED_MAP = {
  tenure_365:    { outside: Tenure365Outside, inside: Tenure365Inside },
  milestone_500: { outside: Milestone500Outside, inside: Milestone500Inside },
};

/**
 * Build the props object every card component expects from a print_cards row.
 */
function cardPropsFromRow(card, gym) {
  return {
    gym,
    member: card.profiles?.full_name || '',
    headline: card.headline || '',
    subline: card.subline || '',
    note: card.printed_note || '',
    qr: card.reward_qr_code ? `earned-reward:${card.reward_qr_code}` : null,
    rewardLabel: card.reward_label || '',
    occasionData: card.occasion_data || {},
  };
}

/**
 * Renders a postcard. Returns null for folded occasions — call
 * renderFoldedCard separately and lay it out on a landscape sheet.
 */
export function PostcardRenderer({ card, gym }) {
  const Component = POSTCARD_MAP[card.occasion] || CustomCard;
  return <Component {...cardPropsFromRow(card, gym)} />;
}

/**
 * Renders one spread of a folded card. `side` is 'outside' or 'inside'.
 * Returns null if the occasion isn't a folded type.
 */
export function FoldedSpreadRenderer({ card, gym, side }) {
  const pair = FOLDED_MAP[card.occasion];
  if (!pair) return null;
  const Component = side === 'inside' ? pair.inside : pair.outside;
  const props = cardPropsFromRow(card, gym);
  // The outside cover uses the current year for the "for <member> · 2026" line.
  // Pass it explicitly so the component stays time-aware without reading clocks.
  if (side === 'outside') {
    props.year = String(new Date().getFullYear());
    props.foundedYear = gym.est;
  }
  return <Component {...props} />;
}
