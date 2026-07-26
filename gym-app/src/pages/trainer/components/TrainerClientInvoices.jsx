import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, ChevronRight, Clock, Receipt } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { listClientInvoices, getInvoice, getTrainerPaymentInstructions } from '../../../lib/invoiceService';
import { TT, TFont } from './designTokens';
import { TPill } from './designPrimitives';
import { InvoiceEditor, InvoiceDetail, fmtMoney, invNo, STATUS_TONE, statusLabel } from './invoiceModals';

// Read the gym's accent color from the runtime branding CSS var (falls back to
// the trainer-kit teal). Used to brand the generated invoice PDF.
function readAccent() {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : TT.accent;
  } catch { return TT.accent; }
}

// "Invoices" card — sits right under the Payment card in the client-info page.
// Itemized bills for THIS client, sent as a PDF file via WhatsApp/SMS/share.
// Money is off-platform; the trainer marks paid manually.
export default function TrainerClientInvoices({ clientId, clientName, hideHeader = false }) {
  const { t } = useTranslation('pages');
  const { profile, gymName, gymLogoUrl } = useAuth();
  const { showToast } = useToast();
  const trainerName = profile?.full_name || profile?.username || '';

  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(true); // false until migration 0639 is applied
  const [payInstr, setPayInstr] = useState('');
  const [editing, setEditing] = useState(null); // {} for new (locked to this client) or an existing invoice
  const [detail, setDetail] = useState(null);

  useScrollLock(!!editing || !!detail);

  // Branding + pay-instructions context handed to the PDF generator.
  const shareCtx = useMemo(() => ({
    gymName, gymLogoUrl, accentColor: readAccent(), trainerName, paymentInstructions: payInstr,
  }), [gymName, gymLogoUrl, trainerName, payInstr]);

  const load = useCallback(async () => {
    if (!clientId) return;
    try { setRows(await listClientInvoices(clientId)); }
    catch (e) {
      // Table not deployed yet (42P01 / PGRST205) → hide the card silently,
      // exactly like the session-packs block. Any other error → toast.
      if (e?.code === '42P01' || e?.code === 'PGRST205') setAvailable(false);
      else showToast(e?.message || t('common:error', 'Something went wrong'), 'error');
    }
    finally { setLoaded(true); }
  }, [clientId, showToast, t]);
  useEffect(() => { load(); }, [load]);

  // Trainer's "how to pay" text (shown on every invoice PDF).
  useEffect(() => {
    let alive = true;
    if (!profile?.id) return undefined;
    getTrainerPaymentInstructions(profile.id)
      .then((txt) => { if (alive) setPayInstr(txt || ''); })
      .catch(() => { /* non-fatal — PDF just omits the pay box */ });
    return () => { alive = false; };
  }, [profile?.id]);

  const openDetail = async (id) => {
    try { const full = await getInvoice(id); if (full) setDetail(full); }
    catch (e) { showToast(e?.message || t('common:error', 'Something went wrong'), 'error'); }
  };

  if (!loaded || !available) return null;

  return (
    <>
      {!hideHeader && (
        <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3, marginBottom: 11 }}>
          {t('trainerInvoices.title', 'Invoices')}
        </div>
      )}
      <div style={{ background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: 'var(--tt-card-radius, 20px)', boxShadow: TT.shadow, padding: 16, marginBottom: 22 }}>
        {rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '6px 0 4px' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, margin: '0 auto 10px', display: 'grid', placeItems: 'center', background: TT.accentSoft, color: TT.accent }}>
              <Receipt size={19} strokeWidth={2.1} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: TT.text }}>{t('trainerInvoices.clientEmpty', 'No invoices for this client yet')}</div>
            <div style={{ fontSize: 12, color: TT.textSub, marginTop: 2, marginBottom: 12 }}>{t('trainerInvoices.clientEmptySub', 'Bill for sessions, packs or anything else — send as a PDF via WhatsApp or text.')}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {rows.map((inv) => (
              <button key={inv.id} type="button" onClick={() => openDetail(inv.id)} className="tt-tap"
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 12, background: TT.surface2, border: `1px solid ${TT.border}`, cursor: 'pointer' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: TT.text }}>{invNo(inv.invoice_number)}</span>
                    <TPill tone={STATUS_TONE[inv.status]} size="s">{statusLabel(t, inv.status)}</TPill>
                  </div>
                  <div style={{ fontSize: 11, color: TT.textSub, marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Clock size={10} /> {format(new Date(inv.created_at), 'MMM d')}
                  </div>
                </div>
                <span style={{ fontFamily: TFont.display, fontSize: 15, fontWeight: 800, color: inv.status === 'paid' ? TT.good : TT.text }}>{fmtMoney(inv.total)}</span>
                <ChevronRight size={15} style={{ color: TT.textMute, flexShrink: 0 }} />
              </button>
            ))}
          </div>
        )}

        <button type="button" onClick={() => setEditing({})} className="tt-tap"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 11, border: `1px dashed ${TT.border}`, background: 'transparent', color: TT.accent, fontFamily: TFont.display, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
          <Plus size={14} strokeWidth={2.4} /> {t('trainerInvoices.newForClient', 'New invoice')}
        </button>
      </div>

      {editing && (
        <InvoiceEditor
          existing={editing.id ? editing : null}
          lockedClient={{ id: clientId, full_name: clientName }}
          trainerId={profile?.id} gymId={profile?.gym_id}
          shareCtx={shareCtx}
          onClose={() => setEditing(null)}
          onSaved={(inv) => { setEditing(null); load(); if (inv) openDetail(inv.id); }}
          t={t}
        />
      )}
      {detail && (
        <InvoiceDetail
          invoice={detail}
          shareCtx={shareCtx}
          onClose={() => setDetail(null)}
          onChanged={async () => { const fresh = await getInvoice(detail.id).catch(() => null); if (fresh) setDetail(fresh); load(); }}
          onEdit={(inv) => { setDetail(null); setEditing(inv); }}
          t={t}
        />
      )}
    </>
  );
}
