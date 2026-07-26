import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Circle, Bell, X, Pencil, MessageCircle, Package, Plus, RefreshCw, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import logger from '../../../lib/logger';
import { readTrainerCache, writeTrainerCache } from '../../../lib/trainerCache';
import { saveInvoice, markInvoicePaid } from '../../../lib/invoiceService';
import { openWhatsApp, hasWhatsApp } from '../../../lib/whatsapp';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { TT, TFont } from './designTokens';

const METHODS = ['cash', 'athmovil', 'card', 'transfer', 'other'];
const METHOD_DEFAULT = { cash: 'Efectivo', athmovil: 'ATH Móvil', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' };
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Date-ONLY strings ('yyyy-MM-dd' — period_month / next_due_date from the RPC)
// must be parsed as LOCAL dates. `new Date('2026-06-01')` parses as UTC
// midnight, which is the previous day 8pm in PR — history rows rendered the
// PREVIOUS month and next-due showed a day early. Timestamptz strings (paid_at)
// carry zone info and fall through to normal Date parsing.
const parseLocalDate = (v) => {
  if (!v) return null;
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

// First-of-month options for "which month does this cover?" — current month
// first, then up to 3 months back.
const coverMonthOptions = () => {
  const now = new Date();
  return Array.from({ length: 4 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
};

// Trainer-facing payment tracker (manual — no billing integration). Sets the
// client's monthly fee (or a per-session rate that estimates the monthly),
// marks a month paid on a chosen date, shows the next expected due date +
// history, and nudges the member in-app or over WhatsApp.
export default function TrainerClientPayment({ clientId, hideHeader = false }) {
  const { t, i18n } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();
  // Hydrate from the per-session trainer cache so re-entering the Payments tab
  // paints the fee card instantly instead of blanking through a fresh RPC every
  // single time. `load()` still runs on mount and writes through, so a cached
  // value is only on screen for the instant before fresh data replaces it.
  const payCacheKey = `clientPayment:${clientId}`;
  const cachedPay = readTrainerCache(payCacheKey);
  const [status, setStatus] = useState(() => cachedPay?.status || null);
  const [loaded, setLoaded] = useState(() => !!cachedPay?.status);
  const hasDataRef = useRef(!!cachedPay?.status);
  const [loadErr, setLoadErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [marking, setMarking] = useState(false);
  const [editingFee, setEditingFee] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [payDate, setPayDate] = useState(localToday);
  const [coverMonth, setCoverMonth] = useState(() => coverMonthOptions()[0]);
  // fee editor
  const [feeAmount, setFeeAmount] = useState('');
  const [feeMethod, setFeeMethod] = useState('cash');
  const [feeDay, setFeeDay] = useState('');
  const [feeCps, setFeeCps] = useState('');
  const [feeType, setFeeType] = useState('monthly'); // 'monthly' | 'session'
  const [showAllHistory, setShowAllHistory] = useState(false);

  // Ad-hoc payment entry (one-off charges — a single session, a drop-in, etc.
  // — that aren't the monthly fee). Received → a paid invoice; pending → a
  // draft invoice. Both ride the invoice pipeline so nothing pollutes the
  // monthly membership status.
  const [addingPayment, setAddingPayment] = useState(false);
  const [apStatus, setApStatus] = useState('received'); // 'received' | 'pending'
  const [apAmount, setApAmount] = useState('');
  const [apDesc, setApDesc] = useState('');
  const [apMethod, setApMethod] = useState('cash');
  const [apDate, setApDate] = useState(localToday);
  // session packs (table may not exist yet — migration 0534; hide silently)
  const [packs, setPacks] = useState([]);
  const [packsAvailable, setPacksAvailable] = useState(false);
  const [sellingPack, setSellingPack] = useState(false);
  const [editingPackId, setEditingPackId] = useState(null); // null = selling new
  const [packSessions, setPackSessions] = useState('10');
  const [packAmount, setPackAmount] = useState('');
  const [packNote, setPackNote] = useState('');
  const [packTitle, setPackTitle] = useState('');
  const [packStart, setPackStart] = useState('');   // yyyy-MM-dd (optional)
  const [packExpire, setPackExpire] = useState(''); // yyyy-MM-dd (optional)
  const [packBusy, setPackBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [paidInvoices, setPaidInvoices] = useState(() => cachedPay?.paidInvoices || []); // paid ad-hoc invoices → folded into the money ledger
  // Freeze the page behind the portaled close-pack confirm (ref-counted, so it
  // co-exists with any modal the client page already has open).
  useScrollLock(confirmClose);

  const load = useCallback(async () => {
    try {
      // Fetch the payment status AND paid invoices together, so invoice revenue
      // (recorded off in trainer_invoices, not member_payments) is counted in
      // the same money ledger — otherwise "received" invoices are invisible.
      const [{ data, error }, invRes] = await Promise.all([
        supabase.rpc('get_client_payment_status', { p_client_id: clientId }),
        supabase.from('trainer_invoices').select('id, total, paid_at, status').eq('client_id', clientId).eq('status', 'paid'),
      ]);
      if (error) throw error;
      setStatus(data);
      hasDataRef.current = true;
      // Invoice table missing pre-migration → just empty (never break the card).
      const inv = invRes.error ? [] : (invRes.data || []);
      setPaidInvoices(inv);
      setLoadErr(false);
      writeTrainerCache(payCacheKey, { status: data, paidInvoices: inv });
    } catch (e) {
      logger.error(e);
      // Only fall back to the error card when there is nothing to show. With a
      // cached card already on screen, keep it and fail quietly. Tracked in a
      // ref, not state, so `load` stays stable and the mount effect can't loop.
      setLoadErr(!hasDataRef.current);
    } finally { setLoaded(true); }
  }, [clientId, payCacheKey]);

  const loadPacks = useCallback(async () => {
    const { data, error } = await supabase
      .from('session_packs')
      // select('*') so this survives BOTH before and after 0642 (title/
      // starts_at/expires_at simply come back undefined until it's applied) —
      // any explicit missing column would 42703 and hide the whole block.
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    if (error) {
      // 42P01 / PGRST205 = table not deployed yet → hide the block silently.
      // Any other failure also hides it quietly (payment card must not break).
      if (error.code !== '42P01' && error.code !== 'PGRST205') logger.error('session_packs load failed', error);
      setPacksAvailable(false);
      return;
    }
    setPacksAvailable(true);
    setPacks(data || []);
  }, [clientId]);

  useEffect(() => { load(); loadPacks(); }, [load, loadPacks]);

  const fmtDate = (d) => {
    const dt = parseLocalDate(d);
    return dt ? dt.toLocaleDateString(i18n.language === 'es' ? 'es' : 'en', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  };
  const fmtMonth = (d) => {
    const dt = parseLocalDate(d);
    return dt ? dt.toLocaleDateString(i18n.language === 'es' ? 'es' : 'en', { month: 'short', year: 'numeric' }) : '';
  };
  const methodLabel = (key) => METHODS.includes(key) ? t(`trainerPayment.method.${key}`, METHOD_DEFAULT[key]) : null;

  const run = async (fn, okMsg) => {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await fn();
      if (error) throw error;
      if (okMsg) showToast(okMsg, 'success');
      await load();
    } catch (e) {
      logger.error(e);
      showToast(t('trainerPayment.error', 'Something went wrong'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const paid = !!status?.paid_this_month;
  const history = Array.isArray(status?.history) ? status.history : [];
  const fee = status?.monthly_fee != null ? Number(status.monthly_fee) : null;
  const cps = status?.cost_per_session != null ? Number(status.cost_per_session) : null;
  // Per-session billing = a rate is set but no monthly fee (trainer bills by session).
  const perSession = fee == null && cps != null;
  const weekly = status?.weekly_sessions || 0;
  const nextDue = status?.next_due_date || null;
  const phone = status?.phone_number;
  const canWhatsApp = hasWhatsApp(phone);
  const attendedTotal = status?.attended_total ?? 0;
  const attendedWith = status?.attended_with_trainer ?? 0;

  // per-session → monthly estimate (uses the client's weekly schedule)
  const feeCpsNum = feeCps ? Number(feeCps) : null;
  const feeMonthlyPreview = (Number.isFinite(feeCpsNum) && feeCpsNum && weekly > 0) ? Math.round(feeCpsNum * weekly * 52 / 12) : null;

  // Unified money ledger — monthly payments + pack purchases (incl. closed
  // ones) + paid ad-hoc invoices, newest first. BOTH money figures (the
  // this-month box and the lifetime history total) derive from this one ledger,
  // so they can never disagree, and no revenue source is invisible.
  const ledger = (() => {
    const payRows = history.map(h => ({
      kind: 'payment',
      date: h.paid_at || h.period_month,
      amount: h.amount != null ? Number(h.amount) : null,
      note: h.note,
    }));
    const packRows = (packs || []).map(p => ({
      kind: 'pack',
      date: p.created_at,
      sessions: Number(p.sessions_total) || 0,
      amount: p.amount != null ? Number(p.amount) : null,
      note: p.note,
    }));
    const invoiceRows = (paidInvoices || []).map(inv => ({
      kind: 'invoice',
      date: inv.paid_at,
      amount: inv.total != null ? Number(inv.total) : null,
    }));
    return [...payRows, ...packRows, ...invoiceRows].sort((a, b) => {
      const da = parseLocalDate(a.date)?.getTime() || 0;
      const db = parseLocalDate(b.date)?.getTime() || 0;
      return db - da;
    });
  })();
  const totalGenerated = ledger.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);
  // This-month total from the SAME ledger (payments + packs + invoices dated this month).
  const _mStart = (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1).getTime(); })();
  const collectedThisMonth = ledger.reduce((s, r) => {
    const ts = parseLocalDate(r.date)?.getTime() || 0;
    return s + ((ts >= _mStart && Number.isFinite(r.amount)) ? r.amount : 0);
  }, 0);
  // Gate the Expected/This month/Attended row on the SAME figure the row shows
  // (the ledger total), not on the RPC's member_payments-only
  // `collected_this_month` — otherwise a fee-less, attendance-less client with a
  // recorded pack or paid invoice hid the whole row while History listed the money.
  const showSummary = fee != null || attendedTotal > 0 || collectedThisMonth > 0;

  const openMarkPaid = () => {
    setAmount(fee != null ? String(fee) : '');
    setMethod(status?.payment_method && METHODS.includes(status.payment_method) ? status.payment_method : 'cash');
    setNote('');
    setPayDate(localToday());
    setCoverMonth(coverMonthOptions()[0]);
    setMarking(true);
  };

  const confirmPaid = async () => {
    const amt = amount ? Number(amount) : null;
    const composedNote = [methodLabel(method), note.trim()].filter(Boolean).join(' · ') || null;
    await run(() => supabase.rpc('mark_client_paid', {
      p_client_id: clientId,
      // Explicit covered month (defaults to the current one) — without it the
      // period silently follows p_paid_at, so a backdated payment covered the
      // wrong month.
      p_period_month: coverMonth || coverMonthOptions()[0],
      p_amount: Number.isFinite(amt) ? amt : null,
      p_note: composedNote,
      p_paid_at: `${payDate || localToday()}T12:00:00`,
    }), t('trainerPayment.markedPaid', 'Marked paid'));
    setMarking(false); setAmount(''); setMethod('cash'); setNote('');
  };

  // ── Ad-hoc payment (one-off charge, not the monthly fee) ────────────────────
  const openAddPayment = () => {
    setMarking(false); setEditingFee(false);
    setApStatus('received'); setApAmount(''); setApDesc('');
    setApMethod('cash'); setApDate(localToday());
    setAddingPayment(true);
  };

  const confirmAddPayment = async () => {
    if (busy) return;
    const amt = apAmount ? Number(apAmount) : null;
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast(t('trainerPayment.needAmount', 'Enter a monthly amount first'), 'error');
      return;
    }
    if (!profile?.id || !profile?.gym_id) {
      showToast(t('trainerPayment.error', 'Something went wrong'), 'error');
      return;
    }
    setBusy(true);
    try {
      const label = apDesc.trim() || t('trainerPayment.paymentItem', 'Payment');
      // Both paths create an invoice so there's a real record the client can see;
      // "received" is just an immediately-paid invoice.
      const inv = await saveInvoice({
        trainerId: profile.id,
        gymId: profile.gym_id,
        clientId,
        items: [{ description: label, quantity: 1, unit_price: amt }],
        dueDate: apStatus === 'pending' ? (apDate || null) : null,
      });
      if (apStatus === 'received') {
        await markInvoicePaid(inv.id, methodLabel(apMethod));
        showToast(t('trainerPayment.paymentAdded', 'Payment recorded'), 'success');
      } else {
        showToast(t('trainerPayment.pendingAdded', 'Pending invoice created — open Invoices below to send it'), 'success');
      }
      setAddingPayment(false);
      await load();
    } catch (e) {
      logger.error('add ad-hoc payment failed', e);
      showToast(t('trainerPayment.error', 'Something went wrong'), 'error');
    } finally {
      setBusy(false);
    }
  };

  // ── Session packs ──────────────────────────────────────────────────────────
  const activePack = packs.find(p => p.is_active) || null;

  const resetPackForm = () => {
    setEditingPackId(null); setPackSessions('10'); setPackAmount('');
    setPackNote(''); setPackTitle(''); setPackStart(''); setPackExpire('');
  };
  const openSellPack = () => { resetPackForm(); setSellingPack(true); };
  const openEditPack = (p) => {
    setEditingPackId(p.id);
    setPackSessions(String(p.sessions_total || ''));
    setPackAmount(p.amount != null ? String(p.amount) : '');
    setPackNote(p.note || '');
    setPackTitle(p.title || '');
    setPackStart(p.starts_at || '');
    setPackExpire(p.expires_at || '');
    setSellingPack(true);
  };
  const closePackForm = () => { setSellingPack(false); resetPackForm(); };

  const savePack = async () => {
    if (packBusy) return;
    const n = parseInt(packSessions, 10);
    if (!Number.isFinite(n) || n <= 0) {
      showToast(t('trainerPayment.packInvalid', 'Enter how many sessions the pack includes'), 'error');
      return;
    }
    const amt = packAmount ? Number(packAmount) : null;
    // Optional dates — guard the range so expiry can't precede the start.
    if (packStart && packExpire && packExpire < packStart) {
      showToast(t('trainerPayment.packDateOrder', 'Expiry must be after the start date'), 'error');
      return;
    }
    const base = {
      sessions_total: n,
      amount: Number.isFinite(amt) ? amt : null,
      note: packNote.trim() || null,
    };
    // 0642 columns — always sent on edit (so clearing a field persists), but
    // only when set on a fresh sell (keeps quick-sell working pre-0642).
    const extra = { title: packTitle.trim() || null, starts_at: packStart || null, expires_at: packExpire || null };
    setPackBusy(true);
    try {
      if (editingPackId) {
        const target = packs.find(p => p.id === editingPackId);
        const used = Math.max(0, Number(target?.sessions_used) || 0);
        // Keep is_active consistent when the total changes; never touch
        // sessions_used (the 0534 trigger owns it).
        const { error } = await supabase.from('session_packs')
          .update({ ...base, ...extra, is_active: used < n })
          .eq('id', editingPackId);
        if (error) throw error;
        showToast(t('trainerPayment.packUpdated', 'Pack updated'), 'success');
      } else {
        const payload = { gym_id: profile?.gym_id, trainer_id: profile?.id, client_id: clientId, ...base };
        Object.entries(extra).forEach(([k, v]) => { if (v != null) payload[k] = v; });
        const { error } = await supabase.from('session_packs').insert(payload);
        if (error) throw error;
        showToast(t('trainerPayment.packSold', 'Pack sold'), 'success');
      }
      closePackForm();
      await loadPacks();
    } catch (e) {
      logger.error('session pack save failed', e);
      showToast(t('trainerPayment.error', 'Something went wrong'), 'error');
    } finally { setPackBusy(false); }
  };

  // Turn a pack into a draft invoice — reuses the whole invoice PDF/share
  // pipeline so the client gets a document showing exactly what they bought.
  const invoicePack = async (p) => {
    if (packBusy || !p || !profile?.gym_id || !profile?.id) return;
    setPackBusy(true);
    try {
      const label = (p.title && p.title.trim())
        || t('trainerPayment.packRow', '{{n}}-session pack', { n: p.sessions_total });
      await saveInvoice({
        trainerId: profile.id,
        gymId: profile.gym_id,
        clientId,
        items: [{ description: label, quantity: 1, unit_price: p.amount != null ? Number(p.amount) : 0 }],
        notes: p.note || null,
        dueDate: p.expires_at || null,
      });
      showToast(t('trainerPayment.packInvoiced', 'Draft invoice created — open Invoices to send it'), 'success');
    } catch (e) {
      logger.error('invoice from pack failed', e);
      showToast(t('trainerPayment.error', 'Something went wrong'), 'error');
    } finally { setPackBusy(false); }
  };

  const closePack = async () => {
    if (packBusy || !activePack) return;
    setPackBusy(true);
    try {
      const { error } = await supabase.from('session_packs').update({ is_active: false }).eq('id', activePack.id);
      if (error) throw error;
      showToast(t('trainerPayment.packClosed', 'Pack closed'), 'success');
      setConfirmClose(false);
      await loadPacks();
    } catch (e) {
      logger.error('session pack close failed', e);
      showToast(t('trainerPayment.error', 'Something went wrong'), 'error');
    } finally { setPackBusy(false); }
  };

  const openFeeEditor = () => {
    let preMonthly = fee != null ? String(fee) : '';
    let preCps = cps != null ? String(cps) : '';
    // Prefill from the trainer's own default rate when nothing's set yet.
    if (!preMonthly && !preCps && profile?.trainer_default_rate != null) {
      if (profile.trainer_rate_unit === 'session') preCps = String(profile.trainer_default_rate);
      else preMonthly = String(profile.trainer_default_rate);
    }
    setFeeAmount(preMonthly);
    setFeeCps(preCps);
    // Billing type: monthly if a monthly fee is set; per-session if only a
    // per-session rate is set; else fall back to the trainer's default unit.
    setFeeType(fee != null ? 'monthly' : (cps != null || profile?.trainer_rate_unit === 'session') ? 'session' : 'monthly');
    setFeeMethod(status?.payment_method && METHODS.includes(status.payment_method) ? status.payment_method : 'cash');
    setFeeDay(status?.billing_day ? String(status.billing_day) : '');
    setEditingFee(true);
  };

  const saveFee = async () => {
    const isSession = feeType === 'session';
    const amt = feeAmount ? Number(feeAmount) : null;
    const cpsVal = feeCps ? Number(feeCps) : null;
    // Require the amount for the chosen billing type — a blank field used to
    // silently save "nothing" (null fee), which read as "didn't save". Billing
    // day stays optional.
    if (isSession && !(Number.isFinite(cpsVal) && cpsVal > 0)) {
      showToast(t('trainerPayment.needRate', 'Enter a per-session rate first'), 'error');
      return;
    }
    if (!isSession && !(Number.isFinite(amt) && amt > 0)) {
      showToast(t('trainerPayment.needAmount', 'Enter a monthly amount first'), 'error');
      return;
    }
    // Billing day is monthly-only (per-session has no recurring due date).
    let day = (!isSession && feeDay) ? parseInt(feeDay, 10) : null;
    if (day != null) day = Math.max(1, Math.min(28, day));
    await run(() => supabase.rpc('set_client_fee', {
      p_client_id: clientId,
      // Per-session billing clears the monthly fee so no monthly total is implied.
      p_monthly_fee: isSession ? null : (Number.isFinite(amt) ? amt : null),
      p_payment_method: feeMethod || null,
      p_billing_day: day,
      p_cost_per_session: Number.isFinite(cpsVal) ? cpsVal : null,
    }), t('trainerPayment.feeSaved', 'Fee saved'));
    setEditingFee(false);
  };

  const remindWhatsApp = () => {
    const name = (status?.full_name || '').split(' ')[0];
    // Include the amount owed so the client sees exactly what to pay.
    const msg = fee != null
      ? t('trainerPayment.waMessageAmount', 'Hi {{name}}, a reminder that your ${{amount}} membership payment for this month is pending. Thanks!', { name: name || '', amount: fee.toFixed(0) })
      : t('trainerPayment.waMessage', 'Hi {{name}}, just a reminder that your membership payment for this month is pending. Thanks!', { name: name || '' });
    openWhatsApp(status?.phone_number, msg);
  };

  // Green-wash status box (design `rgba(47,166,107,.08)` bg / `.18` border) —
  // theme-aware via color-mix so it survives dark mode.
  const greenWash = 'color-mix(in srgb, #2FA66B 9%, var(--tt-surface))';
  const greenBorder = 'color-mix(in srgb, #2FA66B 22%, transparent)';

  if (!loaded) return null;

  // Failed load → error + Retry, never the editable-empty card (mark-paid /
  // fee writes from a blind state would stomp real data).
  if (loadErr) {
    return (
      <>
        {!hideHeader && (
          <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3, marginBottom: 11 }}>
            {t('trainerPayment.title', 'Payment')}
          </div>
        )}
        <div style={{ background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: 'var(--tt-card-radius, 20px)', boxShadow: TT.shadow, padding: 18, marginBottom: 22, textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TT.text, marginBottom: 4 }}>
            {t('trainerPayment.loadError', "Couldn't load payment info")}
          </div>
          <div style={{ fontSize: 12, color: TT.textSub, marginBottom: 12 }}>
            {t('trainerPayment.loadErrorHint', 'Check your connection and try again.')}
          </div>
          <button type="button" onClick={() => { setLoaded(false); load(); loadPacks(); }} className="tt-btn tt-btn--secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 11, fontFamily: TFont.display, fontWeight: 700, fontSize: 12.5 }}>
            <RefreshCw size={13} strokeWidth={2.4} /> {t('trainerPayment.retry', 'Retry')}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      {!hideHeader && (
        <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3, marginBottom: 11 }}>
          {t('trainerPayment.title', 'Payment')}
        </div>
      )}
      <div style={{ background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: 'var(--tt-card-radius, 20px)', boxShadow: TT.shadow, padding: 16, marginBottom: 22 }}>
        {/* Cuota mensual — big fee + Editar ghost */}
        {!editingFee && (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, color: TT.textMute, textTransform: 'uppercase' }}>
                {perSession ? t('trainerPayment.perSessionLabel', 'Per session') : t('trainerPayment.feeLabel', 'Monthly fee')}
              </div>
              {fee != null ? (
                <div style={{ fontFamily: TFont.display, fontSize: 24, fontWeight: 800, color: TT.text, letterSpacing: -0.8, marginTop: 3 }}>
                  ${fee.toFixed(0)}<span style={{ fontSize: 13, color: TT.textMute, fontWeight: 700 }}>/{t('trainerPayment.perMonthShort', 'mo')}</span>
                </div>
              ) : cps != null ? (
                <div style={{ fontFamily: TFont.display, fontSize: 24, fontWeight: 800, color: TT.text, letterSpacing: -0.8, marginTop: 3 }}>
                  ${cps.toFixed(0)}<span style={{ fontSize: 13, color: TT.textMute, fontWeight: 700 }}>/{t('trainerPayment.perSessionShort', 'sess')}</span>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: TT.textSub, marginTop: 4 }}>{t('trainerPayment.noFee', 'Not set')}</div>
              )}
              {(() => {
                // Secondary detail line: monthly shows optional rate + method + billing day;
                // per-session shows only the method (no monthly due day).
                const bits = perSession
                  ? [status?.payment_method ? methodLabel(status.payment_method) : null]
                  : [
                      cps != null ? `$${cps.toFixed(0)}/${t('trainerPayment.perSessionShort', 'sess')}` : null,
                      status?.payment_method ? methodLabel(status.payment_method) : null,
                      status?.billing_day ? t('trainerPayment.dayShort', 'day {{d}}', { d: status.billing_day }) : null,
                    ];
                const line = bits.filter(Boolean).join(' · ');
                return (fee != null || perSession) && line ? (
                  <div style={{ fontSize: 11.5, color: TT.textSub, fontWeight: 600, marginTop: 3 }}>{line}</div>
                ) : null;
              })()}
            </div>
            <button onClick={openFeeEditor} disabled={busy} className="tt-tap"
              style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 13px', borderRadius: 10, border: `1px solid ${TT.accent}44`, background: TT.accentSoft, color: TT.accentInk, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
              <Pencil size={14} strokeWidth={2.2} /> {fee != null ? t('trainerPayment.editFee', 'Edit') : t('trainerPayment.addFee', 'Set fee')}
            </button>
          </div>
        )}

        {/* Fee editor */}
        {editingFee && (
          <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${TT.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Billing type — monthly fee vs per-session (some trainers bill per session) */}
            <div style={{ display: 'flex', gap: 4, background: TT.surface2, borderRadius: 12, padding: 4, border: `1px solid ${TT.border}` }}>
              {[['monthly', t('trainerPayment.typeMonthly', 'Monthly fee')], ['session', t('trainerPayment.typeSession', 'Per session')]].map(([v, label]) => {
                const on = feeType === v;
                return (
                  <button key={v} type="button" onClick={() => setFeeType(v)}
                    style={{ flex: 1, padding: '8px 10px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: TFont.display, fontWeight: 800, fontSize: 12.5, background: on ? TT.accent : 'transparent', color: on ? '#fff' : TT.textSub }}>
                    {label}
                  </button>
                );
              })}
            </div>

            {feeType === 'monthly' ? (
              <>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase', marginBottom: 6 }}>
                    {t('trainerPayment.feeLabel', 'Monthly fee')}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: TT.textSub }}>$</span>
                    <input inputMode="decimal" value={feeAmount} onChange={e => setFeeAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={t('trainerPayment.amount', 'Amount')}
                      style={{ flex: 1, padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 14, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }} />
                  </div>
                </div>

                {/* Billing day — the day of the month payment is due (clearly labelled) */}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase', marginBottom: 6 }}>
                    {t('trainerPayment.billingDayLabel', 'Billing day — day of the month it’s due')}
                  </div>
                  <input inputMode="numeric" value={feeDay} onChange={e => setFeeDay(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} placeholder={t('trainerPayment.billingDayPlaceholder', 'e.g. 1 (optional)')}
                    style={{ width: '100%', padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 14, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }} />
                </div>

                {/* Optional cost per session (estimate helper) */}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase', marginBottom: 6 }}>
                    {t('trainerPayment.costPerSessionOpt', 'Cost / session (optional)')}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: TT.textSub }}>$</span>
                    <input inputMode="decimal" value={feeCps} onChange={e => setFeeCps(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={t('trainerPayment.perSession', 'Per session')}
                      style={{ flex: 1, padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 14, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }} />
                  </div>
                  {feeMonthlyPreview != null && (
                    <button type="button" onClick={() => setFeeAmount(String(feeMonthlyPreview))}
                      style={{ marginTop: 7, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 999, border: 'none', background: TT.accentSoft, color: TT.accentInk, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                      ≈ ${feeMonthlyPreview}/{t('trainerPayment.perMonthShort', 'mo')} · {t('trainerPayment.useAsMonthly', 'use ({{n}}/wk)', { n: weekly })}
                    </button>
                  )}
                  {feeCpsNum && weekly === 0 && (
                    <div style={{ fontSize: 10.5, color: TT.textMute, marginTop: 6 }}>{t('trainerPayment.needSchedule', 'Set a weekly schedule to estimate the monthly total.')}</div>
                  )}
                </div>
              </>
            ) : (
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase', marginBottom: 6 }}>
                  {t('trainerPayment.perSessionLabel', 'Per session')}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: TT.textSub }}>$</span>
                  <input inputMode="decimal" value={feeCps} onChange={e => setFeeCps(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={t('trainerPayment.ratePerSession', 'Rate per session')}
                    style={{ flex: 1, padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 14, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }} />
                </div>
                <div style={{ fontSize: 10.5, color: TT.textMute, marginTop: 6 }}>{t('trainerPayment.perSessionHint', 'No monthly fee — you charge per completed session.')}</div>
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {METHODS.map(m => {
                const on = feeMethod === m;
                return (
                  <button key={m} onClick={() => setFeeMethod(m)}
                    style={{ padding: '6px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                      border: on ? 'none' : `1px solid ${TT.border}`,
                      background: on ? TT.accent : TT.surface2, color: on ? '#fff' : TT.textSub }}>
                    {methodLabel(m)}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveFee} disabled={busy}
                style={{ flex: 1, padding: '10px 12px', borderRadius: 12, border: 'none', background: TT.accent, color: '#fff', fontFamily: TFont.display, fontWeight: 800, fontSize: 12.5, cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
                {t('trainerPayment.saveFee', 'Save fee')}
              </button>
              <button onClick={() => setEditingFee(false)} disabled={busy}
                style={{ width: 44, display: 'grid', placeItems: 'center', padding: '10px', borderRadius: 12, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.textSub, cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Status box — green wash when paid, warn wash when due */}
        {!editingFee && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 14, padding: '11px 13px', borderRadius: 13, background: paid ? greenWash : TT.warnSoft, border: `1px solid ${paid ? greenBorder : 'transparent'}` }}>
            <div style={{ width: 30, height: 30, borderRadius: 999, background: paid ? TT.good : TT.warn, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              {paid ? <CheckCircle2 size={16} strokeWidth={3} style={{ color: '#fff' }} /> : <Circle size={16} strokeWidth={3} style={{ color: '#fff' }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: TFont.display, fontSize: 13.5, fontWeight: 800, color: paid ? TT.goodInk : TT.warnInk }}>
                {paid
                  ? (status?.last_paid_at ? t('trainerPayment.paidOnDate', 'Paid · {{date}}', { date: fmtDate(status.last_paid_at) }) : t('trainerPayment.paidThisMonth', 'Paid this month'))
                  : t('trainerPayment.unpaid', 'Payment due')}
              </div>
              <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 1 }}>
                {nextDue
                  ? t('trainerPayment.nextCharge', 'Next charge · {{date}}', { date: fmtDate(nextDue) })
                  : (status?.last_paid_at ? t('trainerPayment.lastPaid', 'Last paid {{date}}', { date: fmtDate(status.last_paid_at) }) : t('trainerPayment.neverPaid', 'No payment on record'))}
              </div>
            </div>
          </div>
        )}

        {/* Expected vs generated income + attendance this month */}
        {showSummary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${TT.border}` }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase' }}>{t('trainerPayment.expected', 'Expected')}</div>
              <div style={{ fontFamily: TFont.display, fontSize: 17, fontWeight: 800, color: TT.text, letterSpacing: -0.5, marginTop: 2 }}>{fee != null ? `$${fee.toFixed(0)}` : '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase' }}>{t('trainerPayment.thisMonth', 'This month')}</div>
              <div style={{ fontFamily: TFont.display, fontSize: 17, fontWeight: 800, color: collectedThisMonth > 0 ? TT.good : TT.text, letterSpacing: -0.5, marginTop: 2 }}>${collectedThisMonth.toFixed(0)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase' }}>{t('trainerPayment.attended', 'Attended')}</div>
              <div style={{ fontFamily: TFont.display, fontSize: 17, fontWeight: 800, color: TT.text, letterSpacing: -0.5, marginTop: 2 }}>
                {attendedTotal}<span style={{ fontSize: 10.5, fontWeight: 700, color: TT.accentInk, marginLeft: 4 }}>{t('trainerPayment.withYouShort', '{{n}} with you', { n: attendedWith })}</span>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        {!marking && !editingFee && !addingPayment && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {paid ? (
              <button
                onClick={() => run(() => supabase.rpc('unmark_client_paid', { p_client_id: clientId }), t('trainerPayment.markedUnpaid', 'Marked unpaid'))}
                disabled={busy}
                style={{ padding: '10px 12px', borderRadius: 12, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.textSub, fontFamily: TFont.display, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', opacity: busy ? 0.5 : 1 }}
              >
                {t('trainerPayment.markUnpaid', 'Mark unpaid')}
              </button>
            ) : (
              <>
                <button
                  onClick={openMarkPaid}
                  disabled={busy}
                  className="tt-btn tt-btn--primary"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 12px', borderRadius: 12, fontFamily: TFont.display, fontWeight: 800, fontSize: 13, opacity: busy ? 0.5 : 1 }}
                >
                  <CheckCircle2 size={15} strokeWidth={2.4} /> {t('trainerPayment.markPaid', 'Mark paid')}
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => run(() => supabase.rpc('trainer_send_payment_reminder', { p_client_id: clientId }), t('trainerPayment.reminderSent', 'Reminder sent'))}
                    disabled={busy}
                    className="tt-btn tt-btn--secondary"
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 12px', borderRadius: 12, fontFamily: TFont.display, fontWeight: 700, fontSize: 12, opacity: busy ? 0.5 : 1 }}
                  >
                    <Bell size={14} strokeWidth={2} /> {t('trainerPayment.remindApp', 'In-app')}
                  </button>
                  {canWhatsApp && (
                    <button
                      onClick={remindWhatsApp}
                      disabled={busy}
                      className="tt-tap"
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 12px', borderRadius: 12, border: 'none', background: 'linear-gradient(180deg,#34C759,#23A847)', color: '#fff', fontFamily: TFont.display, fontWeight: 800, fontSize: 12, cursor: 'pointer', boxShadow: '0 6px 14px -5px rgba(35,168,71,.6), inset 0 1px 0 rgba(255,255,255,.3)' }}
                    >
                      <MessageCircle size={14} strokeWidth={2.2} /> {t('trainerPayment.whatsapp', 'WhatsApp')}
                    </button>
                  )}
                </div>
              </>
            )}
            {/* Ad-hoc payment — a one-off charge (single session, drop-in, extra)
                separate from the monthly fee. */}
            <button
              onClick={openAddPayment}
              disabled={busy}
              className="tt-btn tt-btn--secondary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 12px', borderRadius: 12, fontFamily: TFont.display, fontWeight: 700, fontSize: 12.5, opacity: busy ? 0.5 : 1 }}
            >
              <Plus size={15} strokeWidth={2.4} /> {t('trainerPayment.addPayment', 'Add a payment')}
            </button>
          </div>
        )}

        {/* Ad-hoc payment form: received/pending + amount + what-for + method */}
        {addingPayment && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${TT.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase' }}>
              {t('trainerPayment.addPaymentTitle', 'Add a one-off payment')}
            </div>
            {/* Received vs pending */}
            <div style={{ display: 'flex', gap: 6 }}>
              {[['received', t('trainerPayment.received', 'Received')], ['pending', t('trainerPayment.pendingStatus', 'Pending')]].map(([v, label]) => {
                const on = apStatus === v;
                return (
                  <button key={v} type="button" onClick={() => setApStatus(v)}
                    style={{ flex: 1, padding: '9px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
                      border: on ? 'none' : `1px solid ${TT.border}`,
                      background: on ? TT.accent : TT.surface2, color: on ? '#fff' : TT.textSub }}>
                    {label}
                  </button>
                );
              })}
            </div>
            {/* Amount */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: TT.textSub }}>$</span>
              <input inputMode="decimal" value={apAmount} onChange={e => setApAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder={t('trainerPayment.amount', 'Amount')}
                style={{ flex: 1, padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 14, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }} />
            </div>
            {/* What for */}
            <input value={apDesc} onChange={e => setApDesc(e.target.value)}
              placeholder={t('trainerPayment.whatFor', 'What for? e.g. Single session, drop-in')}
              style={{ padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 13, outline: 'none' }} />
            {/* Method (received) or due date (pending) */}
            {apStatus === 'received' ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {METHODS.map(m => {
                  const on = apMethod === m;
                  return (
                    <button key={m} type="button" onClick={() => setApMethod(m)}
                      style={{ padding: '6px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                        border: on ? 'none' : `1px solid ${TT.border}`,
                        background: on ? TT.accent : TT.surface2, color: on ? '#fff' : TT.textSub }}>
                      {methodLabel(m)}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase', marginBottom: 6 }}>
                  {t('trainerPayment.dueDateOpt', 'Due date (optional)')}
                </div>
                <input type="date" value={apDate} onChange={e => setApDate(e.target.value)}
                  style={{ width: '100%', padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 13.5, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }} />
              </div>
            )}
            <div style={{ fontSize: 10.5, color: TT.textMute, display: 'flex', alignItems: 'center', gap: 5 }}>
              <FileText size={12} strokeWidth={2.2} />
              {apStatus === 'received'
                ? t('trainerPayment.receivedHint', 'Logged as a paid invoice you can share as a receipt.')
                : t('trainerPayment.pendingHint', 'Creates an invoice you can send from Invoices below.')}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={confirmAddPayment} disabled={busy}
                style={{ flex: 1, padding: '10px 12px', borderRadius: 12, border: 'none', background: TT.accent, color: '#fff', fontFamily: TFont.display, fontWeight: 800, fontSize: 12.5, cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
                {apStatus === 'received' ? t('trainerPayment.recordPayment', 'Record payment') : t('trainerPayment.createInvoice', 'Create invoice')}
              </button>
              <button onClick={() => setAddingPayment(false)} disabled={busy}
                style={{ width: 44, display: 'grid', placeItems: 'center', padding: '10px', borderRadius: 12, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.textSub, cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Mark-paid form: date + amount + method + note */}
        {marking && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${TT.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Payment date — calendar pick or "today" */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase', marginBottom: 6 }}>
                {t('trainerPayment.paidOn', 'Paid on')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="date" value={payDate} max={localToday()} onChange={e => setPayDate(e.target.value)}
                  style={{ flex: 1, padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 13.5, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }}
                />
                <button type="button" onClick={() => setPayDate(localToday())}
                  style={{ padding: '9px 14px', borderRadius: 10, border: payDate === localToday() ? 'none' : `1px solid ${TT.border}`, background: payDate === localToday() ? TT.accent : TT.surface2, color: payDate === localToday() ? '#fff' : TT.textSub, fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {t('trainerPayment.today', 'Today')}
                </button>
              </div>
            </div>
            {/* Which month does this payment cover? (explicit period, so a
                backdated payment doesn't silently cover the wrong month) */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase', marginBottom: 6 }}>
                {t('trainerPayment.coverMonth', 'Which month does it cover?')}
              </div>
              <select value={coverMonth} onChange={e => setCoverMonth(e.target.value)}
                style={{ width: '100%', padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 13.5, fontFamily: TFont.display, fontWeight: 700, outline: 'none', cursor: 'pointer', textTransform: 'capitalize' }}>
                {coverMonthOptions().map((m, i) => (
                  <option key={m} value={m}>
                    {fmtMonth(m)}{i === 0 ? ` · ${t('trainerPayment.currentMonth', 'current')}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: TT.textSub }}>$</span>
              <input
                inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder={t('trainerPayment.amount', 'Amount')}
                style={{ flex: 1, padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 14, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }}
              />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {METHODS.map(m => {
                const on = method === m;
                return (
                  <button key={m} onClick={() => setMethod(m)}
                    style={{ padding: '6px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                      border: on ? 'none' : `1px solid ${TT.border}`,
                      background: on ? TT.accent : TT.surface2, color: on ? '#fff' : TT.textSub }}>
                    {methodLabel(m)}
                  </button>
                );
              })}
            </div>
            <input
              value={note} onChange={e => setNote(e.target.value)}
              placeholder={t('trainerPayment.notePlaceholder', 'Note (optional)')}
              style={{ padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 13, outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={confirmPaid} disabled={busy}
                style={{ flex: 1, padding: '10px 12px', borderRadius: 12, border: 'none', background: TT.accent, color: '#fff', fontFamily: TFont.display, fontWeight: 800, fontSize: 12.5, cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
                {t('trainerPayment.confirmPaid', 'Confirm payment')}
              </button>
              <button onClick={() => { setMarking(false); setAmount(''); setNote(''); }} disabled={busy}
                style={{ width: 44, display: 'grid', placeItems: 'center', padding: '10px', borderRadius: 12, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.textSub, cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Session pack — balance of a prepaid bundle (table from migration
            0534; the whole block hides when it isn't deployed). Decrement is a
            DB trigger when a session for this pair flips to completed. */}
        {packsAvailable && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${TT.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase' }}>
                <Package size={13} strokeWidth={2.2} style={{ color: '#1E9C8E' }} />
                {sellingPack && editingPackId ? t('trainerPayment.packEditTitle', 'Edit pack') : t('trainerPayment.packTitle', 'Session pack')}
              </div>
              {activePack && !sellingPack && (
                <div style={{ display: 'inline-flex', gap: 6 }}>
                  <button type="button" onClick={() => openEditPack(activePack)} disabled={packBusy}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.textSub, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', opacity: packBusy ? 0.5 : 1, padding: '5px 10px', borderRadius: 999 }}>
                    <Pencil size={12} strokeWidth={2.2} /> {t('trainerPayment.packEdit', 'Edit')}
                  </button>
                  <button type="button" onClick={() => setConfirmClose(true)} disabled={packBusy}
                    style={{ border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.textSub, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', opacity: packBusy ? 0.5 : 1, padding: '5px 11px', borderRadius: 999 }}>
                    {t('trainerPayment.packClose', 'Close pack')}
                  </button>
                </div>
              )}
            </div>

            {activePack && !sellingPack ? (() => {
              const total = Number(activePack.sessions_total) || 0;
              const used = Math.max(0, Number(activePack.sessions_used) || 0);
              const left = Math.max(0, total - used);
              const expired = activePack.expires_at && activePack.expires_at < localToday();
              return (
                <div>
                  {activePack.title && (
                    <div style={{ fontFamily: TFont.display, fontSize: 13.5, fontWeight: 800, color: TT.text, marginBottom: 3, letterSpacing: -0.2 }}>{activePack.title}</div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontFamily: TFont.display, fontSize: 19, fontWeight: 800, color: left > 0 && !expired ? TT.text : TT.warnInk, letterSpacing: -0.5 }}>
                      {t('trainerPayment.packRemaining', '{{left}} of {{total}} left', { left, total })}
                    </span>
                    {activePack.amount != null && (
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: TT.textSub }}>${Number(activePack.amount).toFixed(0)}</span>
                    )}
                  </div>
                  {/* progress pips — even grid (up to 10 per row) so they're evenly divided */}
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(total, 10) || 1}, 1fr)`, gap: 4, marginTop: 7 }}>
                    {Array.from({ length: Math.min(total, 40) }).map((_, k) => (
                      <span key={k} style={{ height: 6, borderRadius: 999, background: k < used ? TT.border : '#1E9C8E' }} />
                    ))}
                  </div>
                  {/* validity window (0642) — red once past expiry */}
                  {(activePack.starts_at || activePack.expires_at) && (
                    <div style={{ fontSize: 11, color: expired ? TT.warnInk : TT.textSub, fontWeight: expired ? 800 : 600, marginTop: 6 }}>
                      {expired
                        ? t('trainerPayment.packExpired', 'Expired {{date}}', { date: fmtDate(activePack.expires_at) })
                        : [
                            activePack.starts_at ? t('trainerPayment.packStarts', 'From {{date}}', { date: fmtDate(activePack.starts_at) }) : null,
                            activePack.expires_at ? t('trainerPayment.packExpires', 'Expires {{date}}', { date: fmtDate(activePack.expires_at) }) : null,
                          ].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {activePack.note && (
                    <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activePack.note}</div>
                  )}
                  {left === 0 && (
                    <div style={{ fontSize: 11.5, color: TT.warnInk, fontWeight: 700, marginTop: 6 }}>
                      {t('trainerPayment.packEmpty', 'No sessions left — close it and sell a new pack.')}
                    </div>
                  )}
                  {/* Invoice this pack — reuses the invoice PDF/share pipeline so
                      the client gets a document of exactly what they bought */}
                  <button type="button" onClick={() => invoicePack(activePack)} disabled={packBusy}
                    className="tt-tap"
                    style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, border: `1px solid ${TT.accent}44`, background: TT.accentSoft, color: TT.accentInk, fontFamily: TFont.display, fontWeight: 800, fontSize: 12, cursor: 'pointer', opacity: packBusy ? 0.5 : 1 }}>
                    <FileText size={13} strokeWidth={2.2} /> {t('trainerPayment.packInvoice', 'Create invoice')}
                  </button>
                </div>
              );
            })() : sellingPack ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Optional pack name (shows to the client on invoices / their wallet card) */}
                <input
                  value={packTitle} onChange={e => setPackTitle(e.target.value)}
                  placeholder={t('trainerPayment.packTitlePlaceholder', 'Pack name (optional)')}
                  style={{ padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 13.5, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }}
                />
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {['5', '10', '20'].map(n => {
                    const on = packSessions === n;
                    return (
                      <button key={n} type="button" onClick={() => setPackSessions(n)}
                        style={{ padding: '7px 13px', borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: 'pointer',
                          border: on ? 'none' : `1px solid ${TT.border}`,
                          background: on ? TT.accent : TT.surface2, color: on ? '#fff' : TT.textSub }}>
                        {n}
                      </button>
                    );
                  })}
                  <input
                    inputMode="numeric" value={['5', '10', '20'].includes(packSessions) ? '' : packSessions}
                    onChange={e => setPackSessions(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                    placeholder={t('trainerPayment.packCustomN', 'Other')}
                    style={{ width: 70, padding: '7px 10px', borderRadius: 999, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 12.5, fontFamily: TFont.display, fontWeight: 700, outline: 'none', textAlign: 'center' }}
                  />
                  <span style={{ fontSize: 11, color: TT.textMute, fontWeight: 700 }}>{t('trainerPayment.packSessions', 'sessions')}</span>
                </div>
                {editingPackId && (() => {
                  const u = Math.max(0, Number(packs.find(p => p.id === editingPackId)?.sessions_used) || 0);
                  return u > 0 ? (
                    <div style={{ fontSize: 11, color: TT.textMute, marginTop: -4 }}>
                      {t('trainerPayment.packUsedNote', '{{n}} already used — total can’t go below this.', { n: u })}
                    </div>
                  ) : null;
                })()}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: TT.textSub }}>$</span>
                  <input
                    inputMode="decimal" value={packAmount} onChange={e => setPackAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder={t('trainerPayment.amount', 'Amount')}
                    style={{ flex: 1, padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 14, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }}
                  />
                </div>
                {/* Optional validity window */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3, color: TT.textMute, textTransform: 'uppercase', marginBottom: 4 }}>{t('trainerPayment.packStartLabel', 'Starts (optional)')}</div>
                    <input type="date" value={packStart} max={packExpire || undefined} onChange={e => setPackStart(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 12.5, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3, color: TT.textMute, textTransform: 'uppercase', marginBottom: 4 }}>{t('trainerPayment.packExpireLabel', 'Expires (optional)')}</div>
                    <input type="date" value={packExpire} min={packStart || undefined} onChange={e => setPackExpire(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 12.5, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }} />
                  </div>
                </div>
                <input
                  value={packNote} onChange={e => setPackNote(e.target.value)}
                  placeholder={t('trainerPayment.notePlaceholder', 'Note (optional)')}
                  style={{ padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 13, outline: 'none' }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={savePack} disabled={packBusy}
                    style={{ flex: 1, padding: '10px 12px', borderRadius: 12, border: 'none', background: TT.accent, color: '#fff', fontFamily: TFont.display, fontWeight: 800, fontSize: 12.5, cursor: 'pointer', opacity: packBusy ? 0.5 : 1 }}>
                    {editingPackId ? t('trainerPayment.packSaveChanges', 'Save changes') : t('trainerPayment.packConfirmSell', 'Sell pack')}
                  </button>
                  <button onClick={closePackForm} disabled={packBusy}
                    style={{ width: 44, display: 'grid', placeItems: 'center', padding: '10px', borderRadius: 12, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.textSub, cursor: 'pointer' }}>
                    <X size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={openSellPack} disabled={packBusy}
                className="tt-tap"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 11, border: `1px dashed ${TT.border}`, background: 'transparent', color: TT.accent, fontFamily: TFont.display, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
                <Plus size={14} strokeWidth={2.4} /> {t('trainerPayment.packSell', 'Sell pack')}
              </button>
            )}
          </div>
        )}

        {/* History — monthly payments + pack purchases, with the lifetime
            "generated by this client" total. Past/closed packs live here so
            they don't vanish once no longer active. */}
        {ledger.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${TT.border}` }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase' }}>
                {t('trainerPayment.history', 'History')}
              </span>
              {totalGenerated > 0 && (
                <span style={{ fontSize: 11, fontWeight: 800, color: TT.good }}>
                  {t('trainerPayment.lifetimeTotal', '${{n}} total', { n: totalGenerated.toFixed(0) })}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(showAllHistory ? ledger : ledger.slice(0, 6)).map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 700, color: TT.text, minWidth: 74 }}>
                    {r.kind === 'pack' && <Package size={11} strokeWidth={2.4} style={{ color: '#1E9C8E', flexShrink: 0 }} />}
                    {fmtMonth(r.date)}
                  </span>
                  <span style={{ fontFamily: TFont.display, fontSize: 13, fontWeight: 800, color: r.kind === 'pack' ? '#1E9C8E' : TT.text, minWidth: 52 }}>
                    {r.amount != null ? `$${r.amount.toFixed(0)}` : '—'}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: TT.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.kind === 'pack'
                      ? [t('trainerPayment.packRow', '{{n}}-session pack', { n: r.sessions }), r.note].filter(Boolean).join(' · ')
                      : r.kind === 'invoice'
                        ? [t('trainerPayment.invoiceRow', 'Invoice'), r.note].filter(Boolean).join(' · ')
                        : (r.note || '')}
                  </span>
                </div>
              ))}
            </div>
            {ledger.length > 6 && (
              <button type="button" onClick={() => setShowAllHistory(v => !v)} className="tt-tap"
                style={{ marginTop: 9, background: 'none', border: 'none', cursor: 'pointer', color: TT.accentInk, fontSize: 11.5, fontWeight: 800, fontFamily: TFont.display, padding: 0 }}>
                {showAllHistory ? t('trainerPayment.showLess', 'Show less') : t('trainerPayment.showAllN', 'Show all {{n}}', { n: ledger.length })}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Close-pack confirm (portaled — the payment card lives in the client-page
          swipe track whose transform would otherwise contain a fixed overlay) */}
      {confirmClose && createPortal(
        <div className="fixed inset-0 z-[130] flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !packBusy && setConfirmClose(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, borderRadius: 18, width: '100%', maxWidth: 400, overflow: 'hidden' }}>
            <div style={{ padding: '18px 18px 14px' }}>
              <div style={{ fontFamily: TFont.display, fontSize: 17, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>
                {t('trainerPayment.packCloseTitle', 'Close this pack?')}
              </div>
              <p style={{ fontSize: 13.5, color: TT.textSub, marginTop: 6, lineHeight: 1.5 }}>
                {t('trainerPayment.packCloseBody', 'Remaining sessions will no longer be tracked.')}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '0 18px 18px' }}>
              <button type="button" onClick={() => setConfirmClose(false)} disabled={packBusy}
                style={{ flex: 1, height: 44, borderRadius: 12, background: TT.surface2, border: `1px solid ${TT.border}`, color: TT.textSub, fontWeight: 800, fontSize: 13.5, cursor: 'pointer' }}>
                {t('trainerPayment.cancel', 'Cancel')}
              </button>
              <button type="button" onClick={closePack} disabled={packBusy}
                style={{ flex: 1, height: 44, borderRadius: 12, border: 'none', color: '#fff', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', background: TT.hot, opacity: packBusy ? 0.6 : 1 }}>
                {t('trainerPayment.packClose', 'Close pack')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
