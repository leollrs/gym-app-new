/**
 * PrintPreviewModal — in-app preview + PDF download / print for selected cards.
 *
 * The card sheets are rendered INLINE (PrintCardSheets), not in an iframe. An
 * iframe pointed at the preview route can't work on native: the app boots with
 * MemoryRouter there and never reads the iframe URL, so it just shows the app
 * home. Rendering inline keeps the cards in the same React tree / auth context
 * on both web and native.
 *
 * Output paths:
 *   1. Download PDF (primary, all platforms) — reveal every card, then capture
 *      each .sheet element to a canvas and build a multi-page PDF whose page
 *      sizes match the physical card (4×6 / Letter). PDF readers honour the
 *      embedded page size, so printing at Actual Size gives correct cards.
 *   2. Print direct (web only) — opens the standalone /admin/print-cards/preview
 *      route in its own window with ?autoprint=1, which prints just the cards.
 *      Hidden on native (window.open + MemoryRouter can't reach the route).
 *
 * jspdf + html2canvas are dynamically imported on first click.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { Printer, X, Loader2, Download } from 'lucide-react';
import { saveBlob } from '../../lib/saveBlob';
import PrintCardSheets from '../printCards/PrintCardSheets.jsx';

// Job-level size override shown in the preview header. 'auto' = honour each
// card's own print_format; the rest force every card to that layout for this
// preview + its PDF/print output (passed through as formatOverride). Folded
// cards (tenure_365 / milestone_500) ignore this — they're always 1-up Letter.
const SIZE_OPTIONS = [
  { key: 'auto',        short: 'Auto' },
  { key: 'postcard',    short: '4×6' },
  { key: 'letter-2up',  short: '2-up' },
  { key: 'letter-1up',  short: 'Flyer' },
];

export default function PrintPreviewModal({ ids, onClose, previewBase = '/admin/print-cards/preview', gymId = null }) {
  const { t } = useTranslation('pages');
  const sheetsApiRef = useRef(null);   // imperative handle (revealAll)
  const containerRef = useRef(null);   // scroll container holding the .sheet DOM
  const [loaded, setLoaded] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  // 'auto' = use each card's saved print_format; otherwise force this layout
  // for the whole preview/print job.
  const [sizeKey, setSizeKey] = useState('auto');
  const formatOverride = sizeKey === 'auto' ? null : sizeKey;

  const isNative = Capacitor.isNativePlatform();

  // PrintCardSheets reports its load/empty state up so we can gate the buttons.
  const handleState = useCallback(({ isLoading, total }) => {
    setLoaded(!isLoading);
    setEmpty(!isLoading && total === 0);
  }, []);

  // Lock body scroll while open so the background page can't jiggle.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ESC closes — same convention as the rest of the admin UI.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !generating) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, generating]);

  // Web only: open the standalone route in its own window and let it print
  // itself. Reliable across browsers (no iframe-print quirks).
  const handlePrint = () => {
    const params = new URLSearchParams({ ids: ids.join(','), autoprint: '1' });
    if (gymId) params.set('gymId', gymId);
    if (formatOverride) params.set('format', formatOverride);
    window.open(`${previewBase}?${params.toString()}`, '_blank');
  };

  const handleDownloadPDF = async () => {
    setGenerating(true);
    setError(null);
    try {
      // Reveal every card (preview only renders the first few), then give React
      // a tick to paint them before we measure/capture.
      sheetsApiRef.current?.revealAll();
      await new Promise((r) => setTimeout(r, 500));

      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ]);

      // Wait for web fonts so html2canvas doesn't capture fallback fonts.
      try { await document.fonts?.ready; } catch { /* not all browsers */ }

      const root = containerRef.current;
      const sheets = root ? Array.from(root.querySelectorAll('.sheet')) : [];
      if (sheets.length === 0) throw new Error('No sheets to capture');

      // Page dimensions per sheet — read off the CSS class so we don't
      // duplicate format logic between the layout and the PDF builder.
      const dimsFor = (sheet) => {
        if (sheet.classList.contains('sheet--folded')) {
          return { w: 11, h: 8.5, orient: 'landscape' };
        }
        if (sheet.classList.contains('sheet--postcard-postcard')) {
          return { w: 4, h: 6, orient: 'portrait' };
        }
        if (sheet.classList.contains('sheet--postcard-letter-2up') ||
            sheet.classList.contains('sheet--postcard-letter-1up')) {
          return { w: 8.5, h: 11, orient: 'portrait' };
        }
        return { w: 4, h: 6, orient: 'portrait' };
      };

      let pdf = null;
      for (const sheet of sheets) {
        const { w, h, orient } = dimsFor(sheet);
        const canvas = await html2canvas(sheet, {
          scale: 3,
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
          windowWidth: sheet.offsetWidth,
          windowHeight: sheet.offsetHeight,
        });
        const imgData = canvas.toDataURL('image/png');
        if (!pdf) {
          pdf = new jsPDF({ unit: 'in', format: [w, h], orientation: orient });
        } else {
          pdf.addPage([w, h], orient);
        }
        pdf.addImage(imgData, 'PNG', 0, 0, w, h);
      }
      const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
      const blob = pdf.output('blob');
      await saveBlob(`print-cards-${stamp}.pdf`, blob);
    } catch (err) {
      console.error('[PrintPreviewModal] PDF generation failed:', err);
      setError(err?.message || 'PDF generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const busy = !loaded || empty || generating;

  // Portal to <body> so the overlay is positioned against the viewport, not
  // an ancestor. The admin page wraps panels in framer-motion (FadeIn), whose
  // transform creates a containing block that would otherwise trap this
  // `fixed inset-0` inside the panel — pushing it below the fold.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 md:p-6"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !generating) onClose(); }}
    >
      <div
        className="w-full max-w-6xl h-[92vh] rounded-2xl flex flex-col overflow-hidden shadow-2xl"
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0 gap-3 flex-wrap"
          style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}>
              <Printer size={14} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-bold leading-tight truncate" style={{ color: 'var(--color-text-primary)' }}>
                {t('admin.printCards.previewModalTitle', { defaultValue: 'Print preview' })}
              </p>
              <p className="text-[10.5px] leading-tight mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                {t('admin.printCards.previewModalSubtitleV4', {
                  count: ids.length,
                  defaultValue: '{{count}} card · grouped by format · printer matches PDF page size',
                })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {!isNative && (
              <button
                onClick={handlePrint}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition active:scale-95 disabled:opacity-50"
                style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)' }}
                title={t('admin.printCards.directPrintHint', { defaultValue: 'Opens browser print dialog. Set paper size manually.' })}
              >
                <Printer size={11} />
                {t('admin.printCards.printDirectBtn', { defaultValue: 'Print direct' })}
              </button>
            )}
            <button
              onClick={handleDownloadPDF}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold transition active:scale-95 disabled:opacity-50"
              style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
            >
              {generating
                ? <Loader2 size={12} className="animate-spin" />
                : <Download size={12} />}
              {t('admin.printCards.downloadPdfBtn', { defaultValue: 'Download PDF' })}
            </button>
            <button
              onClick={onClose}
              disabled={generating}
              aria-label={t('common.close', { defaultValue: 'Close' })}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50"
              style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)' }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Size selector — overrides the print format for the whole job so the
            owner can switch 4×6 / 2-up / Flyer right here without going back to
            the list. Feeds the inline preview, the PDF, and the print window. */}
        <div
          className="flex items-center gap-1.5 px-4 py-2 flex-shrink-0 flex-wrap"
          style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider mr-1" style={{ color: 'var(--color-text-subtle)' }}>
            {t('admin.printCards.sizeLabel', { defaultValue: 'Size' })}
          </span>
          {SIZE_OPTIONS.map((opt) => {
            const active = sizeKey === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => setSizeKey(opt.key)}
                disabled={generating}
                className="px-2.5 py-1 rounded-lg text-[11px] font-bold transition active:scale-95 disabled:opacity-50"
                style={{
                  background: active ? 'var(--color-accent)' : 'var(--color-bg-hover)',
                  color: active ? 'var(--color-text-on-accent, #000)' : 'var(--color-text-muted)',
                  border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-default)'}`,
                }}
              >
                {opt.key === 'auto'
                  ? t('admin.printCards.sizeAuto', { defaultValue: 'Auto' })
                  : opt.short}
              </button>
            );
          })}
        </div>

        {/* Error banner */}
        {error && (
          <div className="px-4 py-2 text-[12px] font-medium flex-shrink-0"
            style={{
              background: 'color-mix(in srgb, var(--color-danger) 8%, transparent)',
              color: 'var(--color-danger)',
              borderBottom: '1px solid color-mix(in srgb, var(--color-danger) 20%, transparent)',
            }}>
            {error}
          </div>
        )}

        {/* Preview body — sheets rendered inline (no iframe). */}
        <div ref={containerRef} className="flex-1 relative overflow-auto" style={{ background: '#f3f4f6' }}>
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-text-subtle)' }} />
            </div>
          )}
          {generating && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3"
              style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(2px)' }}>
              <Loader2 size={32} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
              <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {t('admin.printCards.generatingPdf', { defaultValue: 'Building PDF…' })}
              </p>
            </div>
          )}
          <PrintCardSheets
            ref={sheetsApiRef}
            ids={ids}
            overrideGymId={gymId}
            formatOverride={formatOverride}
            onState={handleState}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
