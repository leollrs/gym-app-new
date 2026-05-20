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

export default function PrintCardsView() {
  const [searchParams] = useSearchParams();
  const { gymName, gymLogoUrl, profile } = useAuth();
  const { t } = useTranslation('pages');
  const gymId = profile?.gym_id;

  const ids = useMemo(() => {
    const raw = searchParams.get('ids') || '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }, [searchParams]);

  // Cards joined to member profile. We pull occasion_data so card-specific
  // bits (HabitCard count, BirthdayCard month/day, etc.) reach the renderer.
  const { data: cards = [], isLoading } = useQuery({
    queryKey: ['print-cards-preview', gymId, ids.join(',')],
    queryFn: async () => {
      if (!gymId || ids.length === 0) return [];
      const { data, error } = await supabase
        .from('print_cards')
        .select(
          'id, headline, subline, printed_note, occasion, occasion_data, reward_qr_code, reward_label, profiles:profile_id(full_name)'
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
          .select('primary_color, accent_color')
          .eq('gym_id', gymId)
          .maybeSingle(),
        supabase
          .from('gyms')
          .select('cup_noun, founded_year')
          .eq('id', gymId)
          .maybeSingle(),
      ]);
      return {
        primary: brandingRes.data?.primary_color || brandingRes.data?.accent_color || '#111111',
        cupNoun: gymRes.data?.cup_noun || null,
        est: gymRes.data?.founded_year || null,
      };
    },
    enabled: !!gymId,
    staleTime: 5 * 60_000,
  });

  const gym = useMemo(
    () => ({
      name: gymName || 'TuGymPR',
      logo: gymLogoUrl || null,
      primary: gymExtras?.primary || '#111111',
      cupNoun: gymExtras?.cupNoun,
      est: gymExtras?.est,
    }),
    [gymName, gymLogoUrl, gymExtras]
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

  // Partition cards into the two paper layouts, then chunk postcards into
  // pairs (2 per sheet). Folded cards are 1-per-sheet so no chunking needed.
  const { postcardSheets, foldedCards } = useMemo(() => {
    const post = [];
    const folded = [];
    for (const c of cards) {
      if (getCardPaperType(c.occasion) === 'folded') folded.push(c);
      else post.push(c);
    }
    const sheets = [];
    for (let i = 0; i < post.length; i += 2) sheets.push(post.slice(i, i + 2));
    return { postcardSheets: sheets, foldedCards: folded };
  }, [cards]);

  const totalCards = postcardSheets.reduce((n, s) => n + s.length, 0) + foldedCards.length;

  return (
    <div className="print-cards-root">
      {/* Toolbar (hidden in print) */}
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
          {/* Postcard sheets — US Letter portrait, 2-up */}
          {postcardSheets.map((pair, idx) => (
            <section className="sheet sheet--postcard" key={`pc-${idx}`}>
              <div className="postcard-pair">
                <div className="postcard-slot">
                  <PostcardRenderer card={pair[0]} gym={gym} />
                </div>
                {pair[1] ? (
                  <div className="postcard-slot">
                    <PostcardRenderer card={pair[1]} gym={gym} />
                  </div>
                ) : (
                  <div className="postcard-slot postcard-slot--blank" />
                )}
              </div>
              {/* Faint cut guides — visible in screen preview only, hidden on paper */}
              <div className="postcard-cut-guide postcard-cut-guide--horizontal" aria-hidden />
              <div className="postcard-cut-guide postcard-cut-guide--vertical" aria-hidden />
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
          and doesn't share the app's global print CSS. */}
      <style>{`
        /* Default @page used when named pages aren't supported (e.g. Firefox).
           margin:0 makes sure no extra browser-default 22mm margin appears. */
        @page              { size: letter; margin: 0; }
        /* Named pages so postcards print portrait and folded cards print landscape
           within the same print job. Supported in Chromium (what owners use). */
        @page postcard-page { size: letter portrait; margin: 0; }
        @page folded-page   { size: letter landscape; margin: 0; }

        .print-cards-root {
          background: #f3f4f6;
          color: #000;
          font-family: 'DM Sans', system-ui, sans-serif;
          min-height: 100vh;
        }

        /* ── Postcard sheet (8.5w × 11h, 2-up portrait) ───────────────────── */
        .sheet--postcard {
          page: postcard-page;
          width: 8.5in;
          height: 11in;
          margin: 12px auto;
          background: #fff;
          position: relative;
          box-sizing: border-box;
          padding: 2.5in 0.25in;     /* centers the 4×6 pair vertically */
        }
        .postcard-pair {
          display: grid;
          grid-template-columns: 4in 4in;
          gap: 0;
          width: 8in;
          margin: 0 auto;
        }
        .postcard-slot {
          width: 4in;
          height: 6in;
          overflow: hidden;
          page-break-inside: avoid;
        }
        .postcard-slot--blank { background: transparent; }
        /* The shells render at 384×576 px = 4×6 in @ 96 dpi, so they slot in
           1:1 without scaling. No transform needed. */

        /* ── Postcard cut guides (faint, paper-friendly) ──────────────────── */
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
