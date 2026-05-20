/**
 * PrintCardsView — print-friendly Avery 8371 layout.
 *
 * Avery 8371 = US Letter sheet, 10 business cards per page:
 *   card size: 3.5" x 2"
 *   margins:   top/bottom 0.5", left/right 0.75"
 *   grid:      2 columns x 5 rows, no gutters
 *
 * Owner workflow:
 *   1. Click "Print preview" in CardsToPrintPanel with cards selected
 *   2. This page opens in a new window
 *   3. Cmd/Ctrl+P → browser print dialog → "More settings" → Margins: None
 *   4. Print on Avery 8371 cardstock
 *   5. Sign + hand off at the gym
 *   6. Back in admin, click "Mark printed" + later "Mark delivered"
 */
import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

export default function PrintCardsView() {
  const [searchParams] = useSearchParams();
  const { gymName, gymLogoUrl, profile } = useAuth();
  const { t } = useTranslation('pages');
  const gymId = profile?.gym_id;

  const ids = useMemo(() => {
    const raw = searchParams.get('ids') || '';
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }, [searchParams]);

  const { data: cards = [], isLoading } = useQuery({
    queryKey: ['print-cards-preview', gymId, ids.join(',')],
    queryFn: async () => {
      if (!gymId || ids.length === 0) return [];
      const { data, error } = await supabase
        .from('print_cards')
        .select('id, headline, subline, printed_note, occasion, profiles:profile_id(full_name)')
        .eq('gym_id', gymId)
        .in('id', ids);
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId && ids.length > 0,
    staleTime: 60_000,
  });

  useEffect(() => {
    const title = t('admin.printCards.previewDocTitle', { defaultValue: 'Print cards' });
    document.title = `${title} | ${gymName || 'TuGymPR'}`;
  }, [gymName, t]);

  // Pad cards out to a multiple of 10 so the Avery sheet alignment
  // stays correct when the owner prints a non-round batch.
  const paddedCards = useMemo(() => {
    const padCount = (10 - (cards.length % 10)) % 10;
    return [...cards, ...Array(padCount).fill(null)];
  }, [cards]);

  return (
    <div className="print-cards-root">
      {/* Toolbar (hidden in print) */}
      <div className="no-print sticky top-0 z-10 bg-[#0F172A] border-b border-white/8 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Printer size={16} className="text-[#D4AF37]" />
          <p className="text-[13px] font-bold text-[#E5E7EB]">
            {t('admin.printCards.previewToolbarTitle', {
              defaultValue: 'Print preview — Avery 8371 (10 cards / US Letter sheet)',
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
      ) : cards.length === 0 ? (
        <p className="no-print p-8 text-center text-[#9CA3AF]">
          {t('admin.printCards.previewBatchEmpty', {
            defaultValue: 'No cards to preview. Go back and select cards to print.',
          })}
        </p>
      ) : (
        <div className="sheet">
          {paddedCards.map((c, idx) => (
            <div key={c?.id || `pad-${idx}`} className={`card ${c ? '' : 'card--blank'}`}>
              {c && (
                <>
                  {gymLogoUrl ? (
                    <img src={gymLogoUrl} alt={gymName || ''} className="card__logo" />
                  ) : (
                    <p className="card__brand">{gymName || 'TuGymPR'}</p>
                  )}
                  <p className="card__headline">{c.headline}</p>
                  {c.subline && <p className="card__subline">{c.subline}</p>}
                  <p className="card__to">
                    — {t('admin.printCards.cardForLabel', { defaultValue: 'for' })} {c.profiles?.full_name || ''}
                  </p>
                  {c.printed_note && <p className="card__note">{c.printed_note}</p>}
                  <p className="card__signline">_________________________</p>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Print-only stylesheet. Lives inline so the new-window route
          doesn't depend on the app's global print CSS being loaded. */}
      <style>{`
        @page {
          size: letter portrait;
          margin: 0;
        }
        .print-cards-root {
          background: #fff;
          color: #000;
          font-family: 'Barlow', system-ui, sans-serif;
        }
        .sheet {
          /* US Letter = 8.5" x 11". Avery 8371 layout:
             top margin .5", left margin .75", cards 3.5" x 2", 2 cols x 5 rows. */
          width: 8.5in;
          height: 11in;
          padding: 0.5in 0.75in;
          box-sizing: border-box;
          display: grid;
          grid-template-columns: repeat(2, 3.5in);
          grid-template-rows: repeat(5, 2in);
          gap: 0;
          margin: 0 auto;
          background: #fff;
        }
        .card {
          width: 3.5in;
          height: 2in;
          padding: 0.2in 0.25in;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          justify-content: center;
          page-break-inside: avoid;
          color: #111;
        }
        .card--blank { /* keeps the grid intact for partial batches */ }
        .card__logo {
          max-height: 0.35in;
          max-width: 1.4in;
          object-fit: contain;
          margin-bottom: 0.06in;
        }
        .card__brand {
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 700;
          font-size: 11pt;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin: 0 0 0.06in 0;
          color: #555;
        }
        .card__headline {
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 700;
          font-size: 15pt;
          line-height: 1.05;
          margin: 0 0 0.04in 0;
        }
        .card__subline {
          font-size: 9pt;
          color: #444;
          margin: 0 0 0.06in 0;
          line-height: 1.2;
        }
        .card__to {
          font-size: 8pt;
          font-style: italic;
          color: #666;
          margin: 0 0 0.06in 0;
        }
        .card__note {
          font-size: 8pt;
          color: #333;
          margin: 0 0 0.08in 0;
          line-height: 1.25;
        }
        .card__signline {
          margin-top: auto;
          font-size: 8pt;
          color: #999;
          letter-spacing: 1px;
        }
        @media screen {
          .sheet {
            margin: 12px auto;
            box-shadow: 0 6px 18px rgba(0,0,0,0.25);
          }
          .card {
            outline: 1px dashed #d4af37;
            outline-offset: -1px;
          }
        }
        @media print {
          .no-print { display: none !important; }
          .sheet { box-shadow: none; margin: 0; }
          .card { outline: none; }
        }
      `}</style>
    </div>
  );
}
