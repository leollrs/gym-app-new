/**
 * PrintCardsView — v2 print layout for the new card system.
 *
 * Two paper formats sharing one print job:
 *
 *   POSTCARDS (welcome / habit / tenure_30 / tenure_90 / milestone_100 /
 *              milestone_250 / returning / birthday / custom)
 *     • Card size: 4" × 6" portrait
 *     • Sheet:     US Letter portrait, 2-up side by side, centered
 *     • Owner cuts 1 horizontal slice + 1 vertical slice per sheet
 *
 *   FOLDED CARDS (tenure_365 / milestone_500)
 *     • Spread size: 11" × 4.25" (5.5" × 4.25" closed)
 *     • Sheet:       US Letter landscape, outside spread on top half,
 *                    inside spread on bottom half — one card per sheet
 *     • Owner cuts 1 horizontal slice at the 4.25" mark, then folds
 *       each spread at its own center crease
 *
 * Workflow:
 *   1. CardsToPrintPanel → "Print preview" with selected card IDs
 *   2. This page opens in a new window
 *   3. Cmd/Ctrl+P → set "More settings → Margins: None" → Print
 *   4. Owner cuts + folds + signs, then comes back and clicks
 *      "Mark printed" + later "Mark delivered"
 */
import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { PostcardRenderer, FoldedSpreadRenderer } from '../../components/printCards/CardDispatcher.jsx';
import { getCardPaperType } from '../../components/printCards/cardPaperType.js';

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;600&family=Caveat:wght@400&display=swap';

// Sort key for grouping postcards by format. Order matches the printer
// workflow: 4×6 cardstock first, swap to Letter, swap to Letter (flyer).
const FORMAT_ORDER = { postcard: 0, 'letter-2up': 1, 'letter-1up': 2 };

export default function PrintCardsView() {
  const [searchParams] = useSearchParams();
  const { gymName, gymLogoUrl, profile } = useAuth();
  const { t } = useTranslation('pages');
  // Optional ?gymId= override — used by the platform (super-admin) print
  // queue, which previews a *target* gym's cards, not the viewer's own gym.
  // The super_admin RLS policy on print_cards (migration 0430) lets the
  // cross-gym read through; branding is fetched from that gym below. When
  // the param is absent we fall back to the admin's own gym, so the existing
  // /admin print flow is byte-for-byte unchanged.
  const overrideGymId = searchParams.get('gymId') || null;
  const gymId = overrideGymId || profile?.gym_id;

  const ids = useMemo(() => {
    const raw = searchParams.get('ids') || '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }, [searchParams]);

  // When rendered inside the PrintPreviewModal iframe, the modal supplies
  // its own header with Print/Close buttons — hide ours to avoid duplication.
  // Falls back gracefully if the param isn't passed (standalone tab use).
  const isEmbedded = searchParams.get('embed') === '1';

  // Print format is now PER CARD (print_cards.print_format, migration 0419).
  // The query pulls it; we sort+group postcards by format below so the print
  // output minimizes paper swaps (all 4x6 first, then 2-up Letter, then flyer).
  // The legacy `?format=` URL param still works as a per-job override for
  // standalone tab use / external links.
  const formatOverride = searchParams.get('format');

  // Cards joined to member profile. We pull occasion_data so card-specific
  // bits (HabitCard count, BirthdayCard month/day, etc.) reach the renderer.
  // print_format drives the per-card layout (postcard 4x6 / letter 2-up / flyer).
  const { data: cards = [], isLoading } = useQuery({
    queryKey: ['print-cards-preview', gymId, ids.join(',')],
    queryFn: async () => {
      if (!gymId || ids.length === 0) return [];
      const { data, error } = await supabase
        .from('print_cards')
        .select(
          'id, headline, subline, printed_note, occasion, occasion_data, reward_qr_code, reward_label, print_format, profiles:profile_id(full_name)'
        )
        .eq('gym_id', gymId)
        .in('id', ids);
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId && ids.length > 0,
    staleTime: 60_000,
  });

  // Gym branding (primary color) + the two v2 fields (cup_noun, founded_year)
  // used by HabitCard and Tenure365 respectively. Kept as a separate query
  // because PrintCardsView is the only consumer of cup_noun / founded_year.
  const { data: gymExtras } = useQuery({
    queryKey: ['print-cards-gym-extras', gymId],
    queryFn: async () => {
      if (!gymId) return null;
      const [brandingRes, gymRes] = await Promise.all([
        supabase
          .from('gym_branding')
          .select('primary_color, accent_color, logo_url, custom_app_name')
          .eq('gym_id', gymId)
          .maybeSingle(),
        supabase
          .from('gyms')
          .select('name, cup_noun, founded_year')
          .eq('id', gymId)
          .maybeSingle(),
      ]);
      return {
        primary: brandingRes.data?.primary_color || brandingRes.data?.accent_color || '#111111',
        cupNoun: gymRes.data?.cup_noun || null,
        est: gymRes.data?.founded_year || null,
        // Only consumed when previewing another gym from the platform
        // console — for the admin's own gym, AuthContext values win below.
        name: brandingRes.data?.custom_app_name || gymRes.data?.name || null,
        logo: brandingRes.data?.logo_url || null,
      };
    },
    enabled: !!gymId,
    staleTime: 5 * 60_000,
  });

  const gym = useMemo(
    () => ({
      // Platform preview (overrideGymId) uses the target gym's fetched
      // branding; the admin's own preview keeps the AuthContext values.
      name: (overrideGymId ? gymExtras?.name : gymName) || gymExtras?.name || 'TuGymPR',
      logo: (overrideGymId ? gymExtras?.logo : gymLogoUrl) || null,
      primary: gymExtras?.primary || '#111111',
      cupNoun: gymExtras?.cupNoun,
      est: gymExtras?.est,
    }),
    [overrideGymId, gymName, gymLogoUrl, gymExtras]
  );

  // Set the document title + inject the font stylesheet into the new window's
  // head. Inline @import would block rendering; a separate <link> is async.
  useEffect(() => {
    const title = t('admin.printCards.previewDocTitle', { defaultValue: 'Print cards' });
    document.title = `${title} | ${gymName || 'TuGymPR'}`;

    const existing = document.querySelector(`link[href="${FONT_HREF}"]`);
    if (existing) return undefined;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    document.head.appendChild(link);
    return () => {
      try { document.head.removeChild(link); } catch { /* already removed */ }
    };
  }, [gymName, t]);

  // Partition cards by paper type, then sort postcards by format so the
  // printed batch groups all 4×6 together, then all 2-up Letter, then all
  // flyers — paper changes are minimized. letter-2up cards get paired into
  // sheets of 2; the other formats are 1-per-sheet.
  const { postcardSheets, foldedCards } = useMemo(() => {
    const post = [];
    const folded = [];
    for (const c of cards) {
      if (getCardPaperType(c.occasion) === 'folded') folded.push(c);
      else post.push(c);
    }

    // Resolve format per card — URL override (?format=) wins for the whole
    // job; otherwise use the card's stored print_format.
    const fmtOf = (c) => formatOverride || c.print_format || 'postcard';

    // Sort by format key so same-format cards cluster together.
    post.sort((a, b) => (FORMAT_ORDER[fmtOf(a)] ?? 99) - (FORMAT_ORDER[fmtOf(b)] ?? 99));

    // Walk the sorted list, pairing only consecutive letter-2up cards
    // (an unpaired tail prints alone on its sheet — second slot blank).
    const sheets = [];
    let i = 0;
    while (i < post.length) {
      const f = fmtOf(post[i]);
      if (f === 'letter-2up' && i + 1 < post.length && fmtOf(post[i + 1]) === 'letter-2up') {
        sheets.push({ cards: [post[i], post[i + 1]], format: f });
        i += 2;
      } else {
        sheets.push({ cards: [post[i]], format: f });
        i += 1;
      }
    }
    return { postcardSheets: sheets, foldedCards: folded };
  }, [cards, formatOverride]);

  const totalCards = postcardSheets.reduce((n, s) => n + s.cards.length, 0) + foldedCards.length;

  return (
    <div className="print-cards-root">
      {/* Toolbar (hidden in print, AND hidden when embedded in PrintPreviewModal —
          the modal supplies its own header with Print/Close). */}
      {!isEmbedded && (
        <div className="no-print sticky top-0 z-10 bg-[#0F172A] border-b border-white/8 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Printer size={16} className="text-[#D4AF37]" />
            <p className="text-[13px] font-bold text-[#E5E7EB]">
              {t('admin.printCards.previewToolbarTitleV2', {
                defaultValue:
                  'Print preview — postcards 2-up portrait, folded cards 1-up landscape',
              })}
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 rounded-lg text-[12px] font-bold bg-[#D4AF37] text-black hover:brightness-95 transition"
          >
            {t('admin.printCards.printBtn', { defaultValue: 'Print' })}
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="no-print p-8 text-center text-[#9CA3AF]">
          {t('admin.printCards.previewLoading', { defaultValue: 'Loading…' })}
        </p>
      ) : totalCards === 0 ? (
        <p className="no-print p-8 text-center text-[#9CA3AF]">
          {t('admin.printCards.previewBatchEmpty', {
            defaultValue: 'No cards to preview. Go back and select cards to print.',
          })}
        </p>
      ) : (
        <>
          {/* Postcard sheets — each sheet picks its layout from its own
              format (set per-card in the admin UI, persisted on print_cards). */}
          {postcardSheets.map((sheet, idx) => (
            <section
              className={`sheet sheet--postcard sheet--postcard-${sheet.format}`}
              key={`pc-${sheet.cards[0]?.id || idx}`}
            >
              {sheet.format === 'letter-2up' ? (
                <>
                  <div className="postcard-pair">
                    <div className="postcard-slot">
                      <PostcardRenderer card={sheet.cards[0]} gym={gym} />
                    </div>
                    {sheet.cards[1] ? (
                      <div className="postcard-slot">
                        <PostcardRenderer card={sheet.cards[1]} gym={gym} />
                      </div>
                    ) : (
                      <div className="postcard-slot postcard-slot--blank" />
                    )}
                  </div>
                  <div className="postcard-cut-guide postcard-cut-guide--horizontal" aria-hidden />
                  <div className="postcard-cut-guide postcard-cut-guide--vertical" aria-hidden />
                </>
              ) : sheet.format === 'letter-1up' ? (
                <div className="postcard-slot postcard-slot--flyer">
                  <PostcardRenderer card={sheet.cards[0]} gym={gym} />
                </div>
              ) : (
                <div className="postcard-slot">
                  <PostcardRenderer card={sheet.cards[0]} gym={gym} />
                </div>
              )}
            </section>
          ))}

          {/* Folded card sheets — US Letter landscape, outside on top, inside on bottom */}
          {foldedCards.map((c) => (
            <section className="sheet sheet--folded" key={`fc-${c.id}`}>
              <div className="folded-stack">
                <div className="folded-slot">
                  <FoldedSpreadRenderer card={c} gym={gym} side="outside" />
                </div>
                <div className="folded-slot">
                  <FoldedSpreadRenderer card={c} gym={gym} side="inside" />
                </div>
              </div>
              <div className="folded-cut-guide" aria-hidden />
            </section>
          ))}
        </>
      )}

      {/* Print stylesheet — inline because the route opens in a new window
          and doesn't share the app's global print CSS. Three named @page
          rules let a mixed-format job (some 4×6, some Letter, some flyer)
          all print correctly in one PDF — each sheet picks its named page
          via its CSS class. */}
      <style>{`
        /* Fallback @page for browsers that ignore named pages (Firefox). */
        @page                  { size: 4in 6in;         margin: 0; }
        /* Named pages — one per format. */
        @page postcard-4x6     { size: 4in 6in;         margin: 0; }
        @page postcard-letter  { size: letter portrait; margin: 0; }
        @page folded-page      { size: letter landscape; margin: 0; }

        .print-cards-root {
          background: #f3f4f6;
          color: #000;
          font-family: 'DM Sans', system-ui, sans-serif;
          min-height: 100vh;
        }

        /* ── Postcard sheet (base) ────────────────────────────────────────── */
        .sheet--postcard {
          margin: 12px auto;
          background: #fff;
          position: relative;
          box-sizing: border-box;
        }
        .postcard-slot {
          width: 4in;
          height: 6in;
          overflow: hidden;
          page-break-inside: avoid;
        }
        .postcard-slot--blank { background: transparent; }
        /* Shells render at 384×576 px = 4×6 in @ 96 dpi → slot 1:1, no
           transform needed for non-flyer formats. */

        /* ── Format: postcard (native 4×6) ────────────────────────────────── */
        /* One card per 4×6 sheet. Owner loads 4×6 postcard cardstock and
           prints with zero cutting. ~$10/100 sheets at office stores. */
        .sheet--postcard-postcard {
          page: postcard-4x6;
          width: 4in;
          height: 6in;
          padding: 0;
        }

        /* ── Format: letter-2up (2 per Letter portrait) ───────────────────── */
        /* 2 cards side-by-side, 8" wide block centered with 2.5" vertical
           padding so the pair sits in the middle of an 8.5×11 sheet. Owner
           cuts horizontally at the 8.5" mark and vertically down the middle
           — 2 cuts per pair, 1 cut per card. */
        .sheet--postcard-letter-2up {
          page: postcard-letter;
          width: 8.5in;
          height: 11in;
          padding: 2.5in 0.25in;
        }
        .sheet--postcard-letter-2up .postcard-pair {
          display: grid;
          grid-template-columns: 4in 4in;
          gap: 0;
          width: 8in;
          margin: 0 auto;
        }
        .postcard-cut-guide {
          position: absolute;
          background: transparent;
          border: 0;
        }
        .postcard-cut-guide--horizontal {
          left: 0.25in; right: 0.25in;
          top: calc(2.5in + 6in);
          height: 0;
          border-top: 0.25pt dashed rgba(0,0,0,0.25);
        }
        .postcard-cut-guide--vertical {
          top: 2.5in; bottom: 2.5in;
          left: 50%;
          width: 0;
          border-left: 0.25pt dashed rgba(0,0,0,0.25);
        }

        /* ── Format: letter-1up / flyer (scale to fill Letter) ────────────── */
        /* Card is 4×6 (0.667 aspect). Letter portrait is 8.5×11 (0.773).
           Card is narrower than Letter, so fit-height: scale = 11/6 = 1.833,
           giving 7.33×11 — fills the page vertically, leaves 0.585in margin
           on each side. Visually a flyer-scale piece, not a card. */
        .sheet--postcard-letter-1up {
          page: postcard-letter;
          width: 8.5in;
          height: 11in;
          padding: 0;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          overflow: hidden;
        }
        .postcard-slot--flyer {
          width: 4in;
          height: 6in;
          transform: scale(1.833);
          transform-origin: top center;
        }

        /* ── Folded sheet (11w × 8.5h landscape, 1-up) ────────────────────── */
        .sheet--folded {
          page: folded-page;
          width: 11in;
          height: 8.5in;
          margin: 12px auto;
          background: #fff;
          position: relative;
          box-sizing: border-box;
          padding: 0;
        }
        .folded-stack {
          display: grid;
          grid-template-rows: 4.25in 4.25in;
          width: 11in;
          height: 8.5in;
        }
        .folded-slot {
          width: 11in;
          height: 4.25in;
          overflow: hidden;
          page-break-inside: avoid;
        }
        /* Folded shells are 1056×408 px = 11×4.25 in @ 96 dpi → 1:1 again. */

        .folded-cut-guide {
          position: absolute;
          left: 0; right: 0;
          top: 4.25in;
          height: 0;
          border-top: 0.25pt dashed rgba(0,0,0,0.25);
        }

        /* ── Screen preview affordances ───────────────────────────────────── */
        @media screen {
          .sheet {
            box-shadow: 0 6px 18px rgba(0,0,0,0.18);
          }
          .postcard-slot, .folded-slot {
            outline: 1px dashed rgba(212,175,55,0.45);
            outline-offset: -1px;
          }
        }

        /* ── Print: drop all screen-only chrome ───────────────────────────── */
        @media print {
          .no-print { display: none !important; }
          .print-cards-root { background: #fff; }
          .sheet { box-shadow: none; margin: 0; }
          .postcard-slot, .folded-slot { outline: none; }
        }
      `}</style>
    </div>
  );
}
