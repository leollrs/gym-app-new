/**
 * CardPreview — visual mini of a v2 print card, rendered to screen.
 *
 * The actual card components render at their physical pixel dimensions
 * (postcard 384×576, folded spread 1056×408 at 96 dpi). For a list
 * preview that's huge — so we wrap the renderer in a fixed-size frame
 * and scale it down with CSS transform, preserving the design's exact
 * proportions and typography weight at any preview size.
 *
 * Two call patterns supported:
 *   <CardPreview card={fullPrintCardRow} size="sm" />
 *   <CardPreview occasion="..." headline="..." subline="..." memberName="..." size="sm" />
 *     (synthetic — used by UpcomingCardsPanel where the row hasn't been
 *      inserted into print_cards yet, so we have raw RPC fields instead)
 */
import { useMemo } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  PostcardRenderer,
  FoldedSpreadRenderer,
} from '../../../components/printCards/CardDispatcher.jsx';
import { getCardPaperType } from '../../../components/printCards/cardPaperType.js';

const TARGET_WIDTH = {
  xs: 120,
  sm: 200,
  md: 320,
};

function readAccentFromCss() {
  if (typeof window === 'undefined') return '#111';
  try {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-accent')
      .trim();
    return v || '#111';
  } catch {
    return '#111';
  }
}

export default function CardPreview({
  card,
  occasion,
  headline,
  subline,
  memberName,
  printedNote,
  occasionData,
  rewardQrCode,
  rewardLabel,
  size = 'sm',
  gym: gymOverride,
}) {
  const { gymName, gymLogoUrl } = useAuth();

  // Build a synthetic card row when callers pass individual props.
  const cardRow = useMemo(() => {
    if (card) return card;
    return {
      occasion,
      occasion_data: occasionData || {},
      headline,
      subline,
      printed_note: printedNote,
      reward_qr_code: rewardQrCode || null,
      reward_label: rewardLabel || null,
      profiles: { full_name: memberName },
    };
  }, [card, occasion, occasionData, headline, subline, printedNote, rewardQrCode, rewardLabel, memberName]);

  const gym = useMemo(() => {
    if (gymOverride) return gymOverride;
    return {
      name: gymName || 'TuGymPR',
      logo: gymLogoUrl || null,
      primary: readAccentFromCss(),
    };
  }, [gymOverride, gymName, gymLogoUrl]);

  const paperType = getCardPaperType(cardRow.occasion);
  const natural = paperType === 'folded' ? { w: 1056, h: 408 } : { w: 384, h: 576 };
  const targetW = TARGET_WIDTH[size] ?? TARGET_WIDTH.sm;
  const scale = targetW / natural.w;
  const targetH = natural.h * scale;

  return (
    <div
      style={{
        width: targetW,
        height: targetH,
        overflow: 'hidden',
        borderRadius: 4,
        border: '1px dashed rgba(212,175,55,0.5)',
        background: '#fff',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          width: natural.w,
          height: natural.h,
        }}
      >
        {paperType === 'folded' ? (
          <FoldedSpreadRenderer card={cardRow} gym={gym} side="outside" />
        ) : (
          <PostcardRenderer card={cardRow} gym={gym} />
        )}
      </div>
    </div>
  );
}
