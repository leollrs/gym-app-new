/**
 * PrintCardSheets — the actual card layout (data + sheets + styles), with NO
 * routing of its own. It is rendered two ways:
 *
 *   1. Inline inside PrintPreviewModal (the in-app preview + PDF source). This
 *      is the only way that works on native: the app boots with MemoryRouter
 *      there, so an iframe pointed at /admin/print-cards/preview?ids=… never
 *      sees the URL and just shows the app home. Rendering inline keeps the
 *      cards in the same React tree / auth context.
 *
 *   2. Inside the /admin/print-cards/preview route (PrintCardsView), used on
 *      web for the standalone "open in a window + print" flow.
 *
 * Paper formats:
 *   POSTCARDS — 4×6 portrait; sheet is 4×6, 2-up Letter, or flyer Letter.
 *   FOLDED    — 11×4.25 spread; one US-Letter-landscape sheet (outside top,
 *               inside bottom).
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { PostcardRenderer, FoldedSpreadRenderer } from './CardDispatcher.jsx';
import { getCardPaperType } from './cardPaperType.js';

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;600&family=Caveat:wght@400&display=swap';

// Sort key for grouping postcards by format. Order matches the printer
// workflow: 4×6 cardstock first, swap to Letter, swap to Letter (flyer).
const FORMAT_ORDER = { postcard: 0, 'letter-2up': 1, 'letter-1up': 2 };

// How many cards to render on first paint. Each card is a fairly heavy DOM
// subtree (QR SVG + multiple web-font runs); rendering a large selection all
// at once OOM-ed the WebView. We render this many up front and reveal the rest
// in chunks. The PDF/print paths call revealAll() (imperative handle) first so
// output still includes everything regardless of what's revealed on screen.
const INITIAL_RENDER = 5;
const RENDER_STEP = 5;

const PrintCardSheets = forwardRef(function PrintCardSheets(
  { ids, overrideGymId = null, formatOverride = null, renderAll = false, printRules = false, onState },
  ref
) {
  const { gymName, gymLogoUrl, profile } = useAuth();
  const { t } = useTranslation('pages');
  const gymId = overrideGymId || profile?.gym_id;

  // How many cards are currently revealed on screen (see INITIAL_RENDER).
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDER);

  // Let the parent force every card to render (before a PDF capture / print).
  useImperativeHandle(ref, () => ({
    revealAll: () => setVisibleCount(Number.MAX_SAFE_INTEGER),
  }), []);

  // Cards joined to member profile. occasion_data carries card-specific bits
  // (HabitCard count, BirthdayCard month/day, etc.); print_format drives the
  // per-card layout (postcard 4×6 / letter 2-up / flyer).
  const { data: cards = [], isLoading } = useQuery({
    queryKey: ['print-cards-preview', gymId, (ids || []).join(',')],
    queryFn: async () => {
      if (!gymId || !ids || ids.length === 0) return [];
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
    enabled: !!gymId && !!ids && ids.length > 0,
    // Always refetch when the preview opens. print_format isn't in the query
    // key, so a cached result could otherwise show a stale format and fail to
    // pair letter-2up cards (the whole point of "2 per page"). The card set is
    // small, so a fresh fetch on each open is cheap.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Gym branding (primary color) + the two v2 fields (cup_noun, founded_year)
  // used by HabitCard and Tenure365 respectively.
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

  // The card typography (EB Garamond / DM Sans / JetBrains Mono / Caveat) isn't
  // part of the app's own font set, so inject it whenever these sheets mount —
  // both on the standalone route and inline in the modal (the app document).
  useEffect(() => {
    if (document.querySelector(`link[href="${FONT_HREF}"]`)) return undefined;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    document.head.appendChild(link);
    return () => {
      try { document.head.removeChild(link); } catch { /* already removed */ }
    };
  }, []);

  // Standalone print always renders every card so output is complete; on-screen
  // previews honour the revealed slice.
  const effectiveVisible = renderAll ? cards.length : visibleCount;
  const visibleCards = useMemo(() => cards.slice(0, effectiveVisible), [cards, effectiveVisible]);
  const hasMore = visibleCards.length < cards.length;

  // Partition by paper type, sort postcards by format, pair consecutive
  // letter-2up cards into shared sheets (unpaired tail prints alone).
  const { postcardSheets, foldedCards } = useMemo(() => {
    const post = [];
    const folded = [];
    for (const c of visibleCards) {
      if (getCardPaperType(c.occasion) === 'folded') folded.push(c);
      else post.push(c);
    }
    const fmtOf = (c) => formatOverride || c.print_format || 'postcard';
    post.sort((a, b) => (FORMAT_ORDER[fmtOf(a)] ?? 99) - (FORMAT_ORDER[fmtOf(b)] ?? 99));
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
  }, [visibleCards, formatOverride]);

  const totalCards = postcardSheets.reduce((n, s) => n + s.cards.length, 0) + foldedCards.length;

  // Surface load/empty state to the parent (modal enables its buttons on it).
  useEffect(() => {
    onState?.({ isLoading, total: cards.length });
  }, [isLoading, cards.length, onState]);

  return (
    <div className="print-cards-root">
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

          {/* Reveal control — kept out of print. Loads the rest of a large
              selection in chunks instead of paying the full render cost up front. */}
          {hasMore && (
            <div className="no-print flex flex-col items-center gap-2 py-6">
              <p className="text-[12px] text-[#6B7280]">
                {t('admin.printCards.previewShowing', {
                  shown: visibleCards.length,
                  total: cards.length,
                  defaultValue: 'Showing {{shown}} of {{total}}',
                })}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setVisibleCount((n) => n + RENDER_STEP)}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-bold border border-white/10 hover:brightness-110 transition"
                  style={{ background: '#1E293B', color: '#E5E7EB' }}
                >
                  {t('admin.printCards.previewLoadMore', { defaultValue: 'Load 5 more' })}
                </button>
                <button
                  onClick={() => setVisibleCount(Number.MAX_SAFE_INTEGER)}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-bold text-black hover:brightness-95 transition"
                  style={{ background: '#D4AF37' }}
                >
                  {t('admin.printCards.previewShowAll', { defaultValue: 'Show all' })}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <style>{`
        ${printRules ? `
        /* Fallback @page for browsers that ignore named pages (Firefox). */
        @page                  { size: 4in 6in;         margin: 0; }
        @page postcard-4x6     { size: 4in 6in;         margin: 0; }
        @page postcard-letter  { size: letter portrait; margin: 0; }
        @page folded-page      { size: letter landscape; margin: 0; }
        ` : ''}

        .print-cards-root {
          background: #f3f4f6;
          color: #000;
          font-family: 'DM Sans', system-ui, sans-serif;
          min-height: 100%;
        }

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

        .sheet--postcard-postcard {
          ${printRules ? 'page: postcard-4x6;' : ''}
          width: 4in;
          height: 6in;
          padding: 0;
        }

        .sheet--postcard-letter-2up {
          ${printRules ? 'page: postcard-letter;' : ''}
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

        .sheet--postcard-letter-1up {
          ${printRules ? 'page: postcard-letter;' : ''}
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

        .sheet--folded {
          ${printRules ? 'page: folded-page;' : ''}
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
        .folded-cut-guide {
          position: absolute;
          left: 0; right: 0;
          top: 4.25in;
          height: 0;
          border-top: 0.25pt dashed rgba(0,0,0,0.25);
        }

        @media screen {
          .sheet { box-shadow: 0 6px 18px rgba(0,0,0,0.18); }
          .postcard-slot, .folded-slot {
            outline: 1px dashed rgba(212,175,55,0.45);
            outline-offset: -1px;
          }
        }

        ${printRules ? `
        @media print {
          .no-print { display: none !important; }
          .print-cards-root { background: #fff; }
          .sheet { box-shadow: none; margin: 0; }
          .postcard-slot, .folded-slot { outline: none; }
        }
        ` : ''}
      `}</style>
    </div>
  );
});

export default PrintCardSheets;
