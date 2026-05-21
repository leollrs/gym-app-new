/**
 * PrintPreviewModal — in-page preview + PDF download / print for selected cards.
 *
 * Two output paths, both targeting the existing /admin/print-cards/preview
 * route in a same-origin iframe:
 *
 *   1. Download PDF (primary) — captures each .sheet element to a canvas
 *      and builds a multi-page PDF where each page's MediaBox matches the
 *      card's physical size (4x6 for postcards, 11x8.5 for folded). Browser
 *      print dialogs don't respect CSS @page size when picking the printer
 *      paper, but PDF readers DO respect the embedded page size — so opening
 *      the downloaded PDF and printing at Actual Size gives correctly-sized
 *      cards with zero cutting (assuming 4x6 cardstock is loaded).
 *
 *   2. Print (secondary) — direct iframe.contentWindow.print(). Fast but
 *      relies on the user manually selecting the right paper size in the
 *      browser print dialog. Kept as an escape hatch for owners who've
 *      already configured 4x6 as their printer default.
 *
 * jspdf + html2canvas are dynamically imported on first click so they don't
 * bloat the main bundle.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, X, Loader2, Download } from 'lucide-react';
import { saveBlob } from '../../lib/saveBlob';

export default function PrintPreviewModal({ ids, onClose }) {
  const { t } = useTranslation('pages');
  const iframeRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  // No format selector here — each card carries its own print_format,
  // set in CardsToPrintPanel (per-row pill or bulk-set in action bar).
  // PrintCardsView reads the per-card format and sorts/groups so all
  // same-format cards print together.
  const src = useMemo(() => {
    const params = new URLSearchParams({ ids: ids.join(','), embed: '1' });
    return `/admin/print-cards/preview?${params.toString()}`;
  }, [ids]);

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

  const handlePrint = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    // focus() first — some browsers ignore print() on an unfocused iframe.
    win.focus();
    win.print();
  };

  const handleDownloadPDF = async () => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc) return;
    setGenerating(true);
    setError(null);
    try {
      // Lazy-load the PDF libs — ~450KB combined, kept out of the main bundle.
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ]);

      // Wait for the iframe's web fonts to finish loading. Without this,
      // html2canvas can capture mid-load and the EB Garamond / Caveat text
      // renders in fallback fonts (Times / cursive) — looks wrong on print.
      try { await doc.fonts?.ready; } catch { /* not all browsers expose .fonts */ }

      const sheets = Array.from(doc.querySelectorAll('.sheet'));
      if (sheets.length === 0) throw new Error('No sheets to capture');

      // Page dimensions per sheet — picked off the CSS class so we don't
      // duplicate format logic between the iframe and the PDF builder.
      const dimsFor = (sheet) => {
        if (sheet.classList.contains('sheet--folded')) {
          return { w: 11, h: 8.5, orient: 'landscape' };
        }
        if (sheet.classList.contains('sheet--postcard-postcard')) {
          return { w: 4, h: 6, orient: 'portrait' };
        }
        // Both letter-2up and letter-1up sit on US Letter portrait.
        if (sheet.classList.contains('sheet--postcard-letter-2up') ||
            sheet.classList.contains('sheet--postcard-letter-1up')) {
          return { w: 8.5, h: 11, orient: 'portrait' };
        }
        // Defensive default — should never hit.
        return { w: 4, h: 6, orient: 'portrait' };
      };

      let pdf = null;
      for (const sheet of sheets) {
        const { w, h, orient } = dimsFor(sheet);

        // Render at 3x device pixel density for crisp print output. The
        // ~285 DPI result is comfortably above the 200 DPI floor where
        // print artifacts become visible.
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
      // pdf.save() uses jsPDF's web-only blob+anchor pattern AND revokes
      // the object URL synchronously, which on Capacitor WebView and some
      // Chromium builds produced files with garbled names. Route through
      // saveBlob instead — native on iOS/Android, defer-revoke on web.
      const blob = pdf.output('blob');
      await saveBlob(`print-cards-${stamp}.pdf`, blob);
    } catch (err) {
      console.error('[PrintPreviewModal] PDF generation failed:', err);
      setError(err?.message || 'PDF generation failed');
    } finally {
      setGenerating(false);
    }
  };

  return (
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
            <button
              onClick={handlePrint}
              disabled={!loaded || generating}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition active:scale-95 disabled:opacity-50"
              style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)' }}
              title={t('admin.printCards.directPrintHint', { defaultValue: 'Opens browser print dialog. Set paper size manually.' })}
            >
              <Printer size={11} />
              {t('admin.printCards.printDirectBtn', { defaultValue: 'Print direct' })}
            </button>
            <button
              onClick={handleDownloadPDF}
              disabled={!loaded || generating}
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

        {/* Iframe body */}
        <div className="flex-1 relative overflow-hidden" style={{ background: '#f3f4f6' }}>
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center">
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
          <iframe
            ref={iframeRef}
            src={src}
            title="print-cards-preview"
            className="w-full h-full border-0"
            onLoad={() => setLoaded(true)}
          />
        </div>
      </div>
    </div>
  );
}
