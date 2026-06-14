/**
 * PrintCardsView — the /admin/print-cards/preview route (web only).
 *
 * On web (BrowserRouter) this renders the card sheets in a standalone window
 * and can print them: the PrintPreviewModal's "Print direct" opens this route
 * with ?autoprint=1, which reveals every card, waits for fonts, then fires the
 * OS print dialog on this own document (reliable, unlike printing an iframe in
 * WebKit). The in-app preview + PDF go through PrintCardSheets rendered inline
 * in the modal — see PrintPreviewModal — because on native the app uses
 * MemoryRouter and a URL-routed preview can't be reached.
 *
 * All layout/data/styles live in PrintCardSheets; this file is just the route
 * wrapper (reads URL params, owns the toolbar + autoprint).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import PrintCardSheets from '../../components/printCards/PrintCardSheets.jsx';

export default function PrintCardsView() {
  const [searchParams] = useSearchParams();
  const { gymName } = useAuth();
  const { t } = useTranslation('pages');
  const sheetsRef = useRef(null);

  const overrideGymId = searchParams.get('gymId') || null;
  const formatOverride = searchParams.get('format');
  const isEmbedded = searchParams.get('embed') === '1';
  const autoPrint = searchParams.get('autoprint') === '1';

  const ids = useMemo(() => {
    const raw = searchParams.get('ids') || '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }, [searchParams]);

  // Document title for the standalone window.
  useEffect(() => {
    const title = t('admin.printCards.previewDocTitle', { defaultValue: 'Print cards' });
    document.title = `${title} | ${gymName || 'TuGymPR'}`;
  }, [gymName, t]);

  // Standalone direct print (?autoprint=1): reveal all cards (renderAll prop on
  // the sheets), wait for fonts + a paint tick, then print this document only.
  useEffect(() => {
    if (!autoPrint) return undefined;
    let cancelled = false;
    (async () => {
      try { await document.fonts?.ready; } catch { /* not all browsers */ }
      await new Promise((r) => setTimeout(r, 600));
      if (!cancelled) window.print();
    })();
    return () => { cancelled = true; };
  }, [autoPrint]);

  return (
    <div className="print-cards-route" style={{ minHeight: '100vh', background: '#f3f4f6' }}>
      {/* Toolbar — hidden in print and when embedded (legacy iframe path). */}
      {!isEmbedded && !autoPrint && (
        <div className="no-print sticky top-0 z-10 bg-[#0F172A] border-b border-white/8 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Printer size={16} className="text-[#D4AF37]" />
            <p className="text-[13px] font-bold text-[#E5E7EB]">
              {t('admin.printCards.previewToolbarTitleV2', {
                defaultValue: 'Print preview — postcards 2-up portrait, folded cards 1-up landscape',
              })}
            </p>
          </div>
          <button
            onClick={() => { sheetsRef.current?.revealAll(); window.print(); }}
            className="px-3 py-1.5 rounded-lg text-[12px] font-bold hover:brightness-95 transition"
            style={{ background: '#D4AF37' }}
          >
            {t('admin.printCards.printBtn', { defaultValue: 'Print' })}
          </button>
        </div>
      )}

      <PrintCardSheets
        ref={sheetsRef}
        ids={ids}
        overrideGymId={overrideGymId}
        formatOverride={formatOverride}
        renderAll={autoPrint}
        printRules
      />
    </div>
  );
}
