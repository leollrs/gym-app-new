// Shared invoice UI — the editor + detail modals + helpers.
// Mounted per-client from TrainerClientInvoices (the "Invoices" card that sits
// under the Payment card in the client-info page). Records-only billing; money
// is off-platform (see lib/invoiceService.js + migration 0639).
//
// Delivery is a real PDF FILE shared through the OS share sheet (lib/invoicePdf),
// not a link — app.tugympr.com is auth-gated so a URL would be useless.

import { useState, useCallback, useMemo } from 'react';
import SafeImg from '../../../components/SafeImg';
import { createPortal } from 'react-dom';
import { Plus, X, Trash2, Send, Check, RotateCcw, Ban, Pencil, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '../../../contexts/ToastContext';
import { saveInvoice, sendInvoice, getInvoice, markInvoicePaid, reopenInvoice, voidInvoice, deleteInvoice } from '../../../lib/invoiceService';
import { shareInvoicePdf } from '../../../lib/invoicePdf';
import { TT, TFont } from './designTokens';
import { TCard, TPill, TEyebrow, TPrimaryButton, TDarkButton, TIconButton } from './designPrimitives';

export const fmtMoney = (n) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
};
export const invNo = (n) => `INV-${String(n || 0).padStart(4, '0')}`;
export const nameOf = (c) => c?.full_name || c?.username || '—';
export const STATUS_TONE = { draft: 'neutral', sent: 'warn', paid: 'good', void: 'neutral' };
export const statusLabel = (t, s) => t(`trainerInvoices.status.${s}`, s);

// ── Centered-modal shell (backdrop + content-sized card) ─────────────────────
// The card sizes to its content up to maxHeight, so the footer hugs the content
// (no dead white space) and only the body scrolls when the invoice is long.
function ModalShell({ onClose, maxWidth = 520, dismissable = true, children }) {
  // Portal to <body> so `position: fixed` is relative to the VIEWPORT, not an
  // ancestor with a transform (the client page renders this inside the swipe
  // carousel's translateX track, which would otherwise anchor the modal to a
  // 300%-wide box and blow it past the screen edges).
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-4 py-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }} onClick={dismissable ? onClose : undefined} />
      <div className="relative w-full" style={{ maxWidth, background: TT.bg, borderRadius: 24, border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg, display: 'flex', flexDirection: 'column', maxHeight: '88vh', overflow: 'hidden' }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ── Invoice editor (create / edit draft) ─────────────────────────────────────
// `lockedClient` ({id, full_name}) scopes the editor to one client (no picker);
// otherwise pass `clients` to render a picker. `shareCtx` carries gym branding +
// pay instructions used when the PDF is generated on Save & send.
export function InvoiceEditor({ existing, clients = [], lockedClient, trainerId, gymId, shareCtx, onClose, onSaved, t }) {
  const { showToast } = useToast();
  const [clientId, setClientId] = useState(existing?.client_id || lockedClient?.id || '');
  const [notes, setNotes] = useState(existing?.notes || '');
  const [dueDate, setDueDate] = useState(existing?.due_date || '');
  const [items, setItems] = useState(
    existing?.items?.length
      ? existing.items.map((it) => ({ description: it.description, quantity: String(it.quantity), unit_price: String(it.unit_price) }))
      : [{ description: '', quantity: '1', unit_price: '' }],
  );
  const [saving, setSaving] = useState(false);

  const total = useMemo(() => items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0), [items]);
  const valid = clientId && items.some((it) => it.description.trim() && (Number(it.quantity) || 0) * (Number(it.unit_price) || 0) > 0);

  const setItem = (i, k, v) => setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const addItem = () => setItems((prev) => [...prev, { description: '', quantity: '1', unit_price: '' }]);
  const removeItem = (i) => setItems((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const persist = useCallback(() => saveInvoice({
    id: existing?.id, trainerId, gymId, clientId,
    items: items.map((it) => ({ description: it.description, quantity: it.quantity, unit_price: it.unit_price })),
    notes, dueDate: dueDate || null,
  }), [existing?.id, trainerId, gymId, clientId, items, notes, dueDate]);

  const onSaveDraft = async () => {
    if (!valid || saving) return; setSaving(true);
    try { const inv = await persist(); showToast(t('trainerInvoices.savedDraft', 'Draft saved'), 'success'); onSaved(inv); }
    catch (e) { showToast(e?.message || t('common:error', 'Something went wrong'), 'error'); }
    finally { setSaving(false); }
  };
  const onSaveSend = async () => {
    if (!valid || saving) return; setSaving(true);
    try {
      const inv = await persist();
      await sendInvoice(inv.id);
      const fresh = await getInvoice(inv.id);
      try { await shareInvoicePdf(fresh, shareCtx, { t, showToast }); }
      catch (e) { showToast(e?.message || t('common:error', 'Something went wrong'), 'error'); }
      onSaved(fresh);
    } catch (e) {
      showToast(e?.message || t('common:error', 'Something went wrong'), 'error');
    } finally { setSaving(false); }
  };

  const inputStyle = { width: '100%', padding: '11px 12px', borderRadius: 12, background: TT.surface, border: `1px solid ${TT.borderSolid}`, color: TT.text, fontSize: 14, fontFamily: TFont.body };
  const labelStyle = { fontSize: 11.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: TT.textSub, marginBottom: 6, display: 'block' };

  return (
    <ModalShell onClose={onClose} dismissable={!saving}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: `1px solid ${TT.border}` }}>
        <TIconButton onClick={onClose} ariaLabel={t('common:close', 'Close')}><X size={18} style={{ color: TT.text }} /></TIconButton>
        <div style={{ fontFamily: TFont.display, fontSize: 18, fontWeight: 800, color: TT.text, letterSpacing: -0.4 }}>
          {existing ? t('trainerInvoices.editTitle', 'Edit invoice') : t('trainerInvoices.newTitle', 'New invoice')}
        </div>
      </div>

      <div style={{ flexShrink: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Client — locked (per-client card) or picker */}
        <div>
          <label style={labelStyle}>{t('trainerInvoices.client', 'Client')}</label>
          {lockedClient ? (
            <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', color: TT.text, fontWeight: 700 }}>{nameOf(lockedClient)}</div>
          ) : (
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ ...inputStyle, appearance: 'none' }}>
              <option value="">{t('trainerInvoices.pickClient', 'Select a client…')}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{nameOf(c)}</option>)}
            </select>
          )}
        </div>

        {/* Line items */}
        <div>
          <label style={labelStyle}>{t('trainerInvoices.items', 'Items')}</label>
          <TCard padded={12} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((it, i) => {
              const amt = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: i < items.length - 1 ? 10 : 0, borderBottom: i < items.length - 1 ? `1px solid ${TT.border}` : 'none' }}>
                  <input value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder={t('trainerInvoices.itemDesc', 'Description (e.g. 4 PT sessions)')} style={inputStyle} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} inputMode="decimal" placeholder={t('trainerInvoices.qty', 'Qty')} style={{ ...inputStyle, width: 64, textAlign: 'center' }} aria-label={t('trainerInvoices.qty', 'Qty')} />
                    <span style={{ color: TT.textMute, fontSize: 14 }}>×</span>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: TT.textMute, fontSize: 14 }}>$</span>
                      <input value={it.unit_price} onChange={(e) => setItem(i, 'unit_price', e.target.value)} inputMode="decimal" placeholder="0" style={{ ...inputStyle, paddingLeft: 24 }} aria-label={t('trainerInvoices.unitPrice', 'Unit price')} />
                    </div>
                    <span style={{ minWidth: 62, textAlign: 'right', fontWeight: 800, color: TT.text, fontSize: 14, fontFamily: TFont.mono }}>{fmtMoney(amt)}</span>
                    <button type="button" onClick={() => removeItem(i)} disabled={items.length <= 1} className="tt-tap" aria-label={t('common:remove', 'Remove')}
                      style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: items.length <= 1 ? TT.textMute : TT.hot, opacity: items.length <= 1 ? 0.4 : 1, cursor: 'pointer' }}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
            <button type="button" onClick={addItem} className="tt-tap"
              style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', padding: '7px 12px', borderRadius: 10, background: TT.accentSoft, color: TT.accent, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              <Plus size={15} /> {t('trainerInvoices.addItem', 'Add item')}
            </button>
          </TCard>
        </div>

        <div>
          <label style={labelStyle}>{t('trainerInvoices.dueDate', 'Due date')}</label>
          <input type="date" value={dueDate || ''} onChange={(e) => setDueDate(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>{t('trainerInvoices.notes', 'Note to client (optional)')}</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder={t('trainerInvoices.notesPh', 'Thanks for training with me!')} />
        </div>
      </div>

      <div style={{ flexShrink: 0, borderTop: `1px solid ${TT.border}`, padding: 16, background: TT.bg }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: TT.textSub }}>{t('trainerInvoices.total', 'Total')}</span>
          <span style={{ fontFamily: TFont.display, fontSize: 26, fontWeight: 800, color: TT.text }}>{fmtMoney(total)} <span style={{ fontSize: 13, color: TT.textSub, fontWeight: 700 }}>USD</span></span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <TDarkButton onClick={onSaveDraft} disabled={!valid || saving} style={{ flex: 1, opacity: !valid || saving ? 0.5 : 1 }}>{t('trainerInvoices.saveDraft', 'Save draft')}</TDarkButton>
          <TPrimaryButton onClick={onSaveSend} disabled={!valid || saving} style={{ flex: 1.4, opacity: !valid || saving ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            <Send size={15} /> {saving ? t('trainerInvoices.preparing', 'Preparing…') : t('trainerInvoices.saveSend', 'Save & send')}
          </TPrimaryButton>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Invoice detail ───────────────────────────────────────────────────────────
// ── Invoice "paper" preview ───────────────────────────────────────────────────
// A faithful on-screen render of the exact PDF the client receives (mirrors
// lib/invoicePdf drawInvoice, including its English document labels) so the
// trainer sees precisely what he's about to send. Fixed light palette — it's a
// paper document, so it stays light in both app themes. Rendered as DOM (not a
// PDF iframe) because the Capacitor WebView can't render a PDF preview on device.
const PAPER = { ink: '#111827', sub: '#6B7280', mute: '#9CA3AF', line: '#E5E7EB', wash: '#F3F4F6', good: '#16A34A' };
const PAPER_HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const paperAccent = (c) => (typeof c === 'string' && PAPER_HEX.test(c.trim()) ? c.trim() : '#1E9C8E');
const qtyStrP = (q) => { const v = Number(q) || 0; return Number.isInteger(v) ? String(v) : v.toFixed(2); };
const paperDate = (d) => { try { return format(new Date(d), 'MMM d, yyyy'); } catch { return ''; } };

export function InvoicePaper({ invoice, ctx = {} }) {
  const accent = paperAccent(ctx.accentColor);
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const isPaid = invoice.status === 'paid';
  const isVoid = invoice.status === 'void';
  const eyebrow = { fontSize: 8.5, fontWeight: 800, letterSpacing: 0.6, color: PAPER.sub, textTransform: 'uppercase' };
  const clampName = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  return (
    <div style={{ background: '#FFFFFF', color: PAPER.ink, borderRadius: 12, border: `1px solid ${PAPER.line}`, boxShadow: '0 8px 24px -10px rgba(0,0,0,0.30)', padding: 18, fontFamily: 'Helvetica, Arial, sans-serif', width: '100%', maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
      {/* Header — gym identity (left) + INVOICE meta (right) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {ctx.gymLogoUrl ? (
            <>
              <SafeImg src={ctx.gymLogoUrl} alt="" style={{ maxHeight: 40, maxWidth: '100%', objectFit: 'contain', display: 'block' }} />
              {ctx.gymName && <div style={{ fontSize: 11, fontWeight: 700, color: PAPER.sub, marginTop: 6, ...clampName }}>{ctx.gymName}</div>}
            </>
          ) : (
            <div style={{ fontSize: 19, fontWeight: 800, color: accent, letterSpacing: -0.4, ...clampName }}>{ctx.gymName || 'Invoice'}</div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: PAPER.ink, letterSpacing: 0.5 }}>INVOICE</div>
          <div style={{ fontSize: 11, color: PAPER.sub, marginTop: 4, fontFamily: TFont.mono }}>{invNo(invoice.invoice_number)}</div>
          <div style={{ fontSize: 11, color: PAPER.sub, marginTop: 3, whiteSpace: 'nowrap' }}>Issued {paperDate(invoice.issued_at || invoice.created_at)}</div>
          {invoice.due_date && <div style={{ fontSize: 11, color: PAPER.sub, marginTop: 2, whiteSpace: 'nowrap' }}>Due {paperDate(invoice.due_date)}</div>}
        </div>
      </div>

      <div style={{ height: 2, background: accent, borderRadius: 2, margin: '14px 0' }} />

      {/* Billed to / From */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <div style={eyebrow}>Billed to</div>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: PAPER.ink, marginTop: 4, ...clampName }}>{nameOf(invoice.client)}</div>
        </div>
        {ctx.trainerName && (
          <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 0, maxWidth: '50%' }}>
            <div style={eyebrow}>From</div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: PAPER.ink, marginTop: 4, ...clampName }}>{ctx.trainerName}</div>
          </div>
        )}
      </div>

      {/* Items table */}
      <div style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', background: PAPER.wash, borderRadius: 5, padding: '7px 10px', ...eyebrow }}>
          <span style={{ flex: 1 }}>Description</span>
          <span style={{ width: 34, textAlign: 'right' }}>Qty</span>
          <span style={{ width: 66, textAlign: 'right' }}>Price</span>
          <span style={{ width: 66, textAlign: 'right' }}>Amount</span>
        </div>
        {items.map((it, i) => (
          <div key={it.id || i} style={{ display: 'flex', alignItems: 'baseline', padding: '8px 10px', borderBottom: `1px solid ${PAPER.line}`, fontSize: 11.5 }}>
            <span style={{ flex: 1, color: PAPER.ink, minWidth: 0, wordBreak: 'break-word', paddingRight: 8 }}>{it.description}</span>
            <span style={{ width: 34, textAlign: 'right', color: PAPER.sub }}>{qtyStrP(it.quantity)}</span>
            <span style={{ width: 66, textAlign: 'right', color: PAPER.sub, fontFamily: TFont.mono }}>{fmtMoney(it.unit_price)}</span>
            <span style={{ width: 66, textAlign: 'right', fontWeight: 700, color: PAPER.ink, fontFamily: TFont.mono }}>{fmtMoney(it.amount)}</span>
          </div>
        ))}
      </div>

      {/* Total */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 12, marginTop: 12 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, color: PAPER.sub, textTransform: 'uppercase' }}>Total</span>
        <span style={{ fontSize: 20, fontWeight: 800, color: isPaid ? PAPER.good : accent, fontFamily: TFont.mono }}>{fmtMoney(invoice.total)} <span style={{ fontSize: 11, color: PAPER.sub }}>{invoice.currency || 'USD'}</span></span>
      </div>

      {/* PAID / VOID stamp */}
      {(isPaid || isVoid) && (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: isPaid ? PAPER.good : PAPER.mute, border: `1px solid ${isPaid ? PAPER.good : PAPER.mute}`, background: isPaid ? '#EAF7EF' : '#F3F4F6', borderRadius: 5, padding: '3px 9px' }}>{isPaid ? 'PAID' : 'VOID'}</span>
          {isPaid && invoice.paid_at && <span style={{ fontSize: 10.5, color: PAPER.sub }}>Paid {paperDate(invoice.paid_at)}{invoice.payment_method ? ` · ${invoice.payment_method}` : ''}</span>}
        </div>
      )}

      {/* Notes */}
      {invoice.notes && <p style={{ fontSize: 11, color: PAPER.sub, marginTop: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{invoice.notes}</p>}

      {/* How to pay */}
      {ctx.paymentInstructions && (
        <div style={{ marginTop: 14, background: '#F9FAFB', border: `1px solid ${PAPER.line}`, borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 0.6, color: accent, textTransform: 'uppercase' }}>How to pay</div>
          <div style={{ fontSize: 11, color: PAPER.ink, marginTop: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{ctx.paymentInstructions}</div>
        </div>
      )}

      <div style={{ fontSize: 9, color: PAPER.mute, marginTop: 16 }}>Powered by TuGymPR</div>
    </div>
  );
}

export function InvoiceDetail({ invoice, shareCtx, onClose, onChanged, onEdit, t }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // 'void' | 'unpaid'
  const run = async (fn, okMsg) => {
    if (busy) return; setBusy(true);
    try { await fn(); if (okMsg) showToast(okMsg, 'success'); onChanged(); }
    catch (e) { showToast(e?.message || t('common:error', 'Something went wrong'), 'error'); }
    finally { setBusy(false); }
  };
  // Generate + share the PDF file. Draft → flip to sent first.
  const sharePdf = async () => {
    if (busy) return; setBusy(true);
    const flip = invoice.status === 'draft';
    try {
      if (flip) await sendInvoice(invoice.id);
      await shareInvoicePdf({ ...invoice, status: flip ? 'sent' : invoice.status }, shareCtx, { t, showToast });
      if (flip) onChanged();
    } catch (e) { showToast(e?.message || t('common:error', 'Something went wrong'), 'error'); }
    finally { setBusy(false); }
  };
  const tone = { draft: TT.textMute, sent: TT.warn, paid: TT.good, void: TT.textMute }[invoice.status] || TT.textMute;

  return (
    <>
    <ModalShell onClose={onClose} dismissable={!busy}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderBottom: `1px solid ${TT.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <TIconButton onClick={onClose} ariaLabel={t('common:close', 'Close')}><X size={18} style={{ color: TT.text }} /></TIconButton>
          <div style={{ fontFamily: TFont.display, fontSize: 18, fontWeight: 800, color: TT.text, letterSpacing: -0.4 }}>{invNo(invoice.invoice_number)}</div>
          <TPill tone={STATUS_TONE[invoice.status]}>{statusLabel(t, invoice.status)}</TPill>
        </div>
        {invoice.status === 'draft' && (
          <TIconButton onClick={() => onEdit(invoice)} ariaLabel={t('common:edit', 'Edit')}><Pencil size={16} style={{ color: TT.text }} /></TIconButton>
        )}
      </div>

      <div style={{ flexShrink: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: TT.textMute, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Eye size={13} /> {t('trainerInvoices.previewLabel', 'Preview · what your client receives')}
          </div>
          <InvoicePaper invoice={invoice} ctx={shareCtx} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {invoice.status !== 'void' && (
            <TPrimaryButton onClick={sharePdf} disabled={busy} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
              <Send size={15} /> {busy ? t('trainerInvoices.preparing', 'Preparing…') : invoice.status === 'draft' ? t('trainerInvoices.sendNow', 'Send invoice') : t('trainerInvoices.resend', 'Resend')}
            </TPrimaryButton>
          )}

          {/* Draft — delete (two-tap) */}
          {invoice.status === 'draft' && (
            confirmDelete ? (
              <button type="button" onClick={() => run(async () => { await deleteInvoice(invoice.id); onClose(); })} className="tt-tap"
                style={{ padding: '11px', borderRadius: 14, background: `${TT.hot}14`, color: TT.hot, border: `1px solid ${TT.hot}55`, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                {t('trainerInvoices.confirmDelete', 'Tap again to delete draft')}
              </button>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="tt-tap"
                style={{ padding: '11px', borderRadius: 14, background: 'transparent', color: TT.hot, border: `1px solid ${TT.borderSolid}`, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                <Trash2 size={15} /> {t('trainerInvoices.deleteDraft', 'Delete draft')}
              </button>
            )
          )}

          {/* Sent / Paid — [Mark paid|unpaid · Void] 50/50; Void is red + confirmed */}
          {(invoice.status === 'sent' || invoice.status === 'paid') && (
            <div style={{ display: 'flex', gap: 10 }}>
              {invoice.status === 'sent' ? (
                <TDarkButton onClick={() => run(() => markInvoicePaid(invoice.id), t('trainerInvoices.markedPaid', 'Marked as paid'))} disabled={busy} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                  <Check size={15} /> {t('trainerInvoices.markPaid', 'Mark as paid')}
                </TDarkButton>
              ) : (
                <TDarkButton onClick={() => setConfirmAction('unpaid')} disabled={busy} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                  <RotateCcw size={15} /> {t('trainerInvoices.reopen', 'Mark unpaid')}
                </TDarkButton>
              )}
              <button type="button" onClick={() => setConfirmAction('void')} className="tt-tap" disabled={busy}
                style={{ flex: 1, padding: '11px', borderRadius: 14, background: `color-mix(in srgb, ${TT.hot} 10%, transparent)`, color: TT.hot, border: `1px solid ${TT.hot}55`, fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                <Ban size={15} /> {t('trainerInvoices.void', 'Void invoice')}
              </button>
            </div>
          )}

          {/* Void — restore (un-void) */}
          {invoice.status === 'void' && (
            <TDarkButton onClick={() => run(() => reopenInvoice(invoice.id), t('trainerInvoices.restored', 'Invoice restored'))} disabled={busy} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
              <RotateCcw size={15} /> {t('trainerInvoices.unvoid', 'Restore invoice')}
            </TDarkButton>
          )}
        </div>
      </div>
    </ModalShell>

    {/* Confirm void / mark-unpaid — portaled above the invoice modal */}
    {confirmAction && createPortal(
      <div className="fixed inset-0 z-[141] flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !busy && setConfirmAction(null)}>
        <div onClick={e => e.stopPropagation()}
          style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, borderRadius: 18, width: '100%', maxWidth: 380, overflow: 'hidden' }}>
          <div style={{ padding: '18px 18px 14px' }}>
            <div style={{ fontFamily: TFont.display, fontSize: 17, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>
              {confirmAction === 'void' ? t('trainerInvoices.confirmVoidTitle', 'Void this invoice?') : t('trainerInvoices.confirmUnpaidTitle', 'Mark as unpaid?')}
            </div>
            <p style={{ fontSize: 13.5, color: TT.textSub, marginTop: 6, lineHeight: 1.5 }}>
              {confirmAction === 'void' ? t('trainerInvoices.confirmVoidBody', 'It will be marked void. You can restore it later.') : t('trainerInvoices.confirmUnpaidBody', 'This reopens the invoice as unpaid.')}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, padding: '0 18px 18px' }}>
            <button type="button" onClick={() => setConfirmAction(null)} disabled={busy}
              style={{ flex: 1, height: 44, borderRadius: 12, background: TT.surface2, border: `1px solid ${TT.border}`, color: TT.textSub, fontWeight: 800, fontSize: 13.5, cursor: 'pointer' }}>
              {t('trainerInvoices.cancel', 'Cancel')}
            </button>
            <button type="button" disabled={busy}
              onClick={() => { const a = confirmAction; setConfirmAction(null); if (a === 'void') run(() => voidInvoice(invoice.id), t('trainerInvoices.voided', 'Invoice voided')); else run(() => reopenInvoice(invoice.id), t('trainerInvoices.reopened', 'Marked unpaid')); }}
              style={{ flex: 1, height: 44, borderRadius: 12, border: 'none', color: '#fff', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', background: TT.hot, opacity: busy ? 0.6 : 1 }}>
              {confirmAction === 'void' ? t('trainerInvoices.void', 'Void invoice') : t('trainerInvoices.reopen', 'Mark unpaid')}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )}
    </>
  );
}
