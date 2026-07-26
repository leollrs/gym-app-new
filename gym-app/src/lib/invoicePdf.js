// Trainer invoice → PDF file, shared straight through the OS share sheet.
//
// There is NO hosted invoice page: app.tugympr.com is auth-gated (a member with
// no account can't open it), so a link is useless. Instead we render the invoice
// to a real PDF on-device and hand the FILE to the native share sheet — the
// trainer sends it via whatever app they want (WhatsApp, Messages, email…),
// exactly like sharing any file from their phone. On the web we use the Web
// Share API when it supports files, else fall back to a plain download.
//
// jsPDF is loaded dynamically so it stays out of the main bundle.

import { Capacitor } from '@capacitor/core';
import { format } from 'date-fns';

// ── tiny local formatters (kept here to avoid a cycle with invoiceModals) ──────
const money = (n) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
};
const invNo = (n) => `INV-${String(n || 0).padStart(4, '0')}`;
const clientName = (inv) => inv?.client?.full_name || inv?.client?.username || 'Client';
const qtyStr = (q) => {
  const v = Number(q) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};
const fmtDate = (d) => {
  try { return format(new Date(d), 'MMM d, yyyy'); } catch { return ''; }
};
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const safeHex = (c, fallback) => (typeof c === 'string' && HEX.test(c.trim()) ? c.trim() : fallback);

// ── logo loading (optional; PNG/JPEG only — jsPDF can't do SVG/WebP) ───────────
function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(blob);
  });
}
function imgSize(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
async function loadLogo(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const fmt = /png/i.test(blob.type) ? 'PNG' : (/jpe?g/i.test(blob.type) ? 'JPEG' : null);
    if (!fmt) return null;
    const data = await blobToDataUrl(blob);
    if (!data) return null;
    const size = await imgSize(data);
    if (!size) return null;
    return { data, fmt, ...size };
  } catch { return null; }
}

// ── layout ────────────────────────────────────────────────────────────────────
const PAGE_W = 612, PAGE_H = 792, M = 48, R = PAGE_W - M; // letter, pt
const INK = '#111827', SUB = '#6B7280', MUTE = '#9CA3AF', LINE = '#E5E7EB', WASH = '#F3F4F6';
const GOOD = '#16A34A';

function ensureSpace(doc, y, need) {
  if (y + need > PAGE_H - 60) { doc.addPage(); return 56; }
  return y;
}

function drawInvoice(doc, inv, ctx) {
  const accent = safeHex(ctx.accentColor, '#1E9C8E');
  const items = Array.isArray(inv.items) ? inv.items : [];
  let y = 56;

  // Header — gym identity (left) + INVOICE meta (right)
  let leftBottom = y + 8;
  if (ctx._logo) {
    const maxH = 44, maxW = 190;
    const scale = Math.min(maxW / ctx._logo.w, maxH / ctx._logo.h, 1);
    const w = ctx._logo.w * scale, h = ctx._logo.h * scale;
    try { doc.addImage(ctx._logo.data, ctx._logo.fmt, M, y - 6, w, h); } catch { /* skip */ }
    leftBottom = y - 6 + h;
    if (ctx.gymName) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(SUB);
      doc.text(ctx.gymName, M, leftBottom + 15);
      leftBottom += 15;
    }
  } else {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(accent);
    doc.text(ctx.gymName || 'Invoice', M, y + 10);
    leftBottom = y + 10;
  }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(INK);
  doc.text('INVOICE', R, y + 4, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(SUB);
  let ry = y + 22;
  doc.text(invNo(inv.invoice_number), R, ry, { align: 'right' }); ry += 15;
  doc.text(`Issued ${fmtDate(inv.issued_at || inv.created_at)}`, R, ry, { align: 'right' }); ry += 15;
  if (inv.due_date) { doc.text(`Due ${fmtDate(inv.due_date)}`, R, ry, { align: 'right' }); ry += 15; }

  y = Math.max(leftBottom, ry) + 20;

  // Accent divider
  doc.setDrawColor(accent); doc.setLineWidth(2); doc.line(M, y, R, y);
  y += 26;

  // Billed to / From
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(SUB);
  doc.text('BILLED TO', M, y);
  doc.text('FROM', R, y, { align: 'right' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(INK);
  doc.text(clientName(inv), M, y + 16);
  if (ctx.trainerName) doc.text(ctx.trainerName, R, y + 16, { align: 'right' });
  y += 42;

  // Items table header
  const COL_AMT = R, COL_PRICE = R - 92, COL_QTY = R - 178, DESC_X = M + 12;
  const DESC_W = COL_QTY - 34 - DESC_X;
  doc.setFillColor(WASH); doc.roundedRect(M, y, R - M, 24, 5, 5, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(SUB);
  doc.text('DESCRIPTION', DESC_X, y + 15.5);
  doc.text('QTY', COL_QTY, y + 15.5, { align: 'right' });
  doc.text('PRICE', COL_PRICE, y + 15.5, { align: 'right' });
  doc.text('AMOUNT', COL_AMT, y + 15.5, { align: 'right' });
  y += 24 + 4;

  // Item rows
  items.forEach((it) => {
    const descLines = doc.splitTextToSize(String(it.description || ''), DESC_W);
    const rowH = Math.max(20, descLines.length * 13 + 8);
    y = ensureSpace(doc, y, rowH + 4);
    const baseY = y + 13;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(INK);
    doc.text(descLines, DESC_X, baseY);
    doc.setTextColor(SUB);
    doc.text(qtyStr(it.quantity), COL_QTY, baseY, { align: 'right' });
    doc.text(money(it.unit_price), COL_PRICE, baseY, { align: 'right' });
    doc.setFont('helvetica', 'bold'); doc.setTextColor(INK);
    doc.text(money(it.amount), COL_AMT, baseY, { align: 'right' });
    y += rowH;
    doc.setDrawColor(LINE); doc.setLineWidth(0.5); doc.line(M, y, R, y);
    y += 6;
  });

  // Total
  y = ensureSpace(doc, y, 60);
  y += 10;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(SUB);
  doc.text('TOTAL', COL_PRICE, y + 6, { align: 'right' });
  doc.setFontSize(19); doc.setTextColor(inv.status === 'paid' ? GOOD : accent);
  doc.text(`${money(inv.total)} ${inv.currency || 'USD'}`, COL_AMT, y + 8, { align: 'right' });
  y += 30;

  // PAID / VOID stamp
  if (inv.status === 'paid' || inv.status === 'void') {
    const paid = inv.status === 'paid';
    const label = paid ? 'PAID' : 'VOID';
    const col = paid ? GOOD : MUTE;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    const tw = doc.getTextWidth(label) + 20;
    doc.setDrawColor(col); doc.setLineWidth(1); doc.setFillColor(paid ? '#EAF7EF' : '#F3F4F6');
    doc.roundedRect(M, y - 12, tw, 20, 5, 5, 'FD');
    doc.setTextColor(col); doc.text(label, M + 10, y + 2);
    if (paid && inv.paid_at) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(SUB);
      doc.text(`Paid ${fmtDate(inv.paid_at)}${inv.payment_method ? ` · ${inv.payment_method}` : ''}`, M + tw + 10, y + 2);
    }
    y += 22;
  }

  // Notes
  if (inv.notes) {
    y = ensureSpace(doc, y, 40);
    y += 8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(SUB);
    const noteLines = doc.splitTextToSize(String(inv.notes), R - M);
    doc.text(noteLines, M, y + 6);
    y += noteLines.length * 13 + 10;
  }

  // How to pay
  if (ctx.paymentInstructions) {
    const payLines = doc.splitTextToSize(String(ctx.paymentInstructions), R - M - 24);
    const boxH = payLines.length * 13 + 34;
    y = ensureSpace(doc, y, boxH + 10);
    y += 8;
    doc.setFillColor('#F9FAFB'); doc.setDrawColor(LINE); doc.setLineWidth(0.75);
    doc.roundedRect(M, y, R - M, boxH, 8, 8, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(accent);
    doc.text('HOW TO PAY', M + 12, y + 17);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(INK);
    doc.text(payLines, M + 12, y + 31);
    y += boxH;
  }

  // Footer
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(MUTE);
  doc.text('Powered by TuGymPR', M, PAGE_H - 40);
}

/** Build the invoice PDF (async — optionally embeds the gym logo). */
export async function buildInvoicePdf(inv, ctx = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const _logo = ctx.gymLogoUrl ? await loadLogo(ctx.gymLogoUrl) : null;
  drawInvoice(doc, inv, { ...ctx, _logo });
  return doc;
}

const fileNameFor = (inv) =>
  `${invNo(inv.invoice_number)}-${clientName(inv)}`.replace(/[^\w-]+/g, '-').replace(/-+/g, '-') + '.pdf';

/**
 * Generate the PDF and share the FILE via the OS share sheet (native) or the
 * Web Share API / download (web). `ctx` = {gymName, gymLogoUrl, accentColor,
 * trainerName, paymentInstructions}. Returns 'shared' | 'downloaded' | 'cancelled'.
 */
export async function shareInvoicePdf(inv, ctx = {}, { t, showToast } = {}) {
  const doc = await buildInvoicePdf(inv, ctx);
  const fileName = fileNameFor(inv);
  const title = `${invNo(inv.invoice_number)} · ${clientName(inv)}`;
  const text = t
    ? t('trainerInvoices.sendMessage', {
        name: clientName(inv), trainer: ctx.trainerName || '', amount: money(inv.total),
        defaultValue: "Hi {{name}}, here's your invoice from {{trainer}} — {{amount}}.",
      })
    : `Invoice ${money(inv.total)}`;

  // Native: write to cache, share the file URI.
  if (Capacitor.isNativePlatform()) {
    const base64 = doc.output('datauristring').split(',').pop();
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { uri } = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
    const { Share } = await import('@capacitor/share');
    try {
      await Share.share({ title, text, files: [uri], dialogTitle: title });
      return 'shared';
    } catch (e) {
      if (/cancel/i.test(e?.message || '')) return 'cancelled';
      throw e;
    }
  }

  // Web: Web Share API with files, else download.
  const blob = doc.output('blob');
  const file = new File([blob], fileName, { type: 'application/pdf' });
  if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title, text }); return 'shared'; }
    catch (e) { if (/abort|cancel/i.test(e?.name || e?.message || '')) return 'cancelled'; /* else fall through */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  showToast?.(t?.('trainerInvoices.pdfSaved', 'Invoice PDF saved — attach it in WhatsApp, email or text.'), 'success');
  return 'downloaded';
}
