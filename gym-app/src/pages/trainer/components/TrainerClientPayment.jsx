import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, Circle, Bell, X, Pencil, MessageCircle, Package, Plus, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import logger from '../../../lib/logger';
import { openWhatsApp, hasWhatsApp } from '../../../lib/whatsapp';
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
export default function TrainerClientPayment({ clientId }) {
  const { t, i18n } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [status, setStatus] = useState(null);
  const [loaded, setLoaded] = useState(false);
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
  // session packs (table may not exist yet — migration 0534; hide silently)
  const [packs, setPacks] = useState([]);
  const [packsAvailable, setPacksAvailable] = useState(false);
  const [sellingPack, setSellingPack] = useState(false);
  const [packSessions, setPackSessions] = useState('10');
  const [packAmount, setPackAmount] = useState('');
  const [packNote, setPackNote] = useState('');
  const [packBusy, setPackBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_client_payment_status', { p_client_id: clientId });
      if (error) throw error;
      setStatus(data);
      setLoadErr(false);
    } catch (e) {
      logger.error(e);
      setLoadErr(true);
    } finally { setLoaded(true); }
  }, [clientId]);

  const loadPacks = useCallback(async () => {
    const { data, error } = await supabase
      .from('session_packs')
      .select('id, sessions_total, sessions_used, amount, note, is_active, created_at')
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
  const weekly = status?.weekly_sessions || 0;
  const nextDue = status?.next_due_date || null;
  const phone = status?.phone_number;
  const canWhatsApp = hasWhatsApp(phone);
  const collectedMonth = Number(status?.collected_this_month || 0);
  const attendedTotal = status?.attended_total ?? 0;
  const attendedWith = status?.attended_with_trainer ?? 0;
  const showSummary = fee != null || attendedTotal > 0 || collectedMonth > 0;

  // per-session → monthly estimate (uses the client's weekly schedule)
  const feeCpsNum = feeCps ? Number(feeCps) : null;
  const feeMonthlyPreview = (Number.isFinite(feeCpsNum) && feeCpsNum && weekly > 0) ? Math.round(feeCpsNum * weekly * 52 / 12) : null;

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

  // ── Session packs ──────────────────────────────────────────────────────────
  const activePack = packs.find(p => p.is_active) || null;

  const sellPack = async () => {
    if (packBusy) return;
    const n = parseInt(packSessions, 10);
    if (!Number.isFinite(n) || n <= 0) {
      showToast(t('trainerPayment.packInvalid', 'Enter how many sessions the pack includes'), 'error');
      return;
    }
    const amt = packAmount ? Number(packAmount) : null;
    setPackBusy(true);
    try {
      const { error } = await supabase.from('session_packs').insert({
        gym_id: profile?.gym_id,
        trainer_id: profile?.id,
        client_id: clientId,
        sessions_total: n,
        amount: Number.isFinite(amt) ? amt : null,
        note: packNote.trim() || null,
      });
      if (error) throw error;
      showToast(t('trainerPayment.packSold', 'Pack sold'), 'success');
      setSellingPack(false); setPackSessions('10'); setPackAmount(''); setPackNote('');
      await loadPacks();
    } catch (e) {
      logger.error('session pack insert failed', e);
      showToast(t('trainerPayment.error', 'Something went wrong'), 'error');
    } finally { setPackBusy(false); }
  };

  const closePack = async () => {
    if (packBusy || !activePack) return;
    const ok = window.confirm(t('trainerPayment.packCloseConfirm', 'Close this pack? Remaining sessions will no longer be tracked.'));
    if (!ok) return;
    setPackBusy(true);
    try {
      const { error } = await supabase.from('session_packs').update({ is_active: false }).eq('id', activePack.id);
      if (error) throw error;
      showToast(t('trainerPayment.packClosed', 'Pack closed'), 'success');
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
    setFeeMethod(status?.payment_method && METHODS.includes(status.payment_method) ? status.payment_method : 'cash');
    setFeeDay(status?.billing_day ? String(status.billing_day) : '');
    setEditingFee(true);
  };

  const saveFee = async () => {
    const amt = feeAmount ? Number(feeAmount) : null;
    const cpsVal = feeCps ? Number(feeCps) : null;
    let day = feeDay ? parseInt(feeDay, 10) : null;
    if (day != null) day = Math.max(1, Math.min(28, day));
    await run(() => supabase.rpc('set_client_fee', {
      p_client_id: clientId,
      p_monthly_fee: Number.isFinite(amt) ? amt : null,
      p_payment_method: feeMethod || null,
      p_billing_day: day,
      p_cost_per_session: Number.isFinite(cpsVal) ? cpsVal : null,
    }), t('trainerPayment.feeSaved', 'Fee saved'));
    setEditingFee(false);
  };

  const remindWhatsApp = () => {
    const name = (status?.full_name || '').split(' ')[0];
    const msg = t('trainerPayment.waMessage', 'Hi {{name}}, just a reminder that your membership payment for this month is pending. Thanks!', { name: name || '' });
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
        <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3, marginBottom: 11 }}>
          {t('trainerPayment.title', 'Payment')}
        </div>
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
      <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3, marginBottom: 11 }}>
        {t('trainerPayment.title', 'Payment')}
      </div>
      <div style={{ background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: 'var(--tt-card-radius, 20px)', boxShadow: TT.shadow, padding: 16, marginBottom: 22 }}>
        {/* Cuota mensual — big fee + Editar ghost */}
        {!editingFee && (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, color: TT.textMute, textTransform: 'uppercase' }}>
                {t('trainerPayment.feeLabel', 'Monthly fee')}
              </div>
              {fee != null ? (
                <div style={{ fontFamily: TFont.display, fontSize: 24, fontWeight: 800, color: TT.text, letterSpacing: -0.8, marginTop: 3 }}>
                  ${fee.toFixed(0)}<span style={{ fontSize: 13, color: TT.textMute, fontWeight: 700 }}>/{t('trainerPayment.perMonthShort', 'mo')}</span>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: TT.textSub, marginTop: 4 }}>{t('trainerPayment.noFee', 'Not set')}</div>
              )}
              {fee != null && (cps != null || status?.payment_method || status?.billing_day) && (
                <div style={{ fontSize: 11.5, color: TT.textSub, fontWeight: 600, marginTop: 3 }}>
                  {[
                    cps != null ? `$${cps.toFixed(0)}/${t('trainerPayment.perSessionShort', 'sess')}` : null,
                    status?.payment_method ? methodLabel(status.payment_method) : null,
                    status?.billing_day ? t('trainerPayment.dayShort', 'day {{d}}', { d: status.billing_day }) : null,
                  ].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
            <button onClick={openFeeEditor} disabled={busy} className="tt-tap"
              style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 10, border: 'none', background: 'transparent', color: TT.accent, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              <Pencil size={14} strokeWidth={2.2} /> {fee != null ? t('trainerPayment.editFee', 'Edit') : t('trainerPayment.addFee', 'Set fee')}
            </button>
          </div>
        )}

        {/* Fee editor */}
        {editingFee && (
          <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${TT.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase' }}>
              {t('trainerPayment.feeLabel', 'Monthly fee')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: TT.textSub }}>$</span>
              <input
                inputMode="decimal" value={feeAmount} onChange={e => setFeeAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder={t('trainerPayment.amount', 'Amount')}
                style={{ flex: 1, padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 14, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }}
              />
              <input
                inputMode="numeric" value={feeDay} onChange={e => setFeeDay(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                placeholder={t('trainerPayment.dayPlaceholder', 'Day')}
                style={{ width: 64, padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 14, fontFamily: TFont.display, fontWeight: 700, outline: 'none', textAlign: 'center' }}
              />
            </div>

            {/* Optional cost per session */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase', marginBottom: 6 }}>
                {t('trainerPayment.costPerSessionOpt', 'Cost / session (optional)')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: TT.textSub }}>$</span>
                <input
                  inputMode="decimal" value={feeCps} onChange={e => setFeeCps(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder={t('trainerPayment.perSession', 'Per session')}
                  style={{ flex: 1, padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 14, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }}
                />
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
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase' }}>{t('trainerPayment.generated', 'Generated')}</div>
              <div style={{ fontFamily: TFont.display, fontSize: 17, fontWeight: 800, color: collectedMonth > 0 ? TT.good : TT.text, letterSpacing: -0.5, marginTop: 2 }}>${collectedMonth.toFixed(0)}</div>
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
        {!marking && !editingFee && (
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
                <Package size={13} strokeWidth={2.2} style={{ color: '#1E9C8E' }} /> {t('trainerPayment.packTitle', 'Session pack')}
              </div>
              {activePack && (
                <button type="button" onClick={closePack} disabled={packBusy}
                  style={{ border: 'none', background: 'transparent', color: TT.textSub, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', opacity: packBusy ? 0.5 : 1 }}>
                  {t('trainerPayment.packClose', 'Close pack')}
                </button>
              )}
            </div>

            {activePack ? (() => {
              const total = Number(activePack.sessions_total) || 0;
              const used = Math.max(0, Number(activePack.sessions_used) || 0);
              const left = Math.max(0, total - used);
              return (
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontFamily: TFont.display, fontSize: 19, fontWeight: 800, color: left > 0 ? TT.text : TT.warnInk, letterSpacing: -0.5 }}>
                      {t('trainerPayment.packRemaining', '{{left}} of {{total}} left', { left, total })}
                    </span>
                    {activePack.amount != null && (
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: TT.textSub }}>${Number(activePack.amount).toFixed(0)}</span>
                    )}
                  </div>
                  {/* progress pips */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 7 }}>
                    {Array.from({ length: Math.min(total, 40) }).map((_, k) => (
                      <span key={k} style={{ width: total > 20 ? 8 : 14, height: 6, borderRadius: 999, background: k < used ? TT.border : '#1E9C8E' }} />
                    ))}
                  </div>
                  {activePack.note && (
                    <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activePack.note}</div>
                  )}
                  {left === 0 && (
                    <div style={{ fontSize: 11.5, color: TT.warnInk, fontWeight: 700, marginTop: 6 }}>
                      {t('trainerPayment.packEmpty', 'No sessions left — close it and sell a new pack.')}
                    </div>
                  )}
                </div>
              );
            })() : sellingPack ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: TT.textSub }}>$</span>
                  <input
                    inputMode="decimal" value={packAmount} onChange={e => setPackAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder={t('trainerPayment.amount', 'Amount')}
                    style={{ flex: 1, padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 14, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }}
                  />
                </div>
                <input
                  value={packNote} onChange={e => setPackNote(e.target.value)}
                  placeholder={t('trainerPayment.notePlaceholder', 'Note (optional)')}
                  style={{ padding: '9px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 13, outline: 'none' }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={sellPack} disabled={packBusy}
                    style={{ flex: 1, padding: '10px 12px', borderRadius: 12, border: 'none', background: TT.accent, color: '#fff', fontFamily: TFont.display, fontWeight: 800, fontSize: 12.5, cursor: 'pointer', opacity: packBusy ? 0.5 : 1 }}>
                    {t('trainerPayment.packConfirmSell', 'Sell pack')}
                  </button>
                  <button onClick={() => { setSellingPack(false); setPackAmount(''); setPackNote(''); }} disabled={packBusy}
                    style={{ width: 44, display: 'grid', placeItems: 'center', padding: '10px', borderRadius: 12, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.textSub, cursor: 'pointer' }}>
                    <X size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setSellingPack(true)} disabled={packBusy}
                className="tt-tap"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 11, border: `1px dashed ${TT.border}`, background: 'transparent', color: TT.accent, fontFamily: TFont.display, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
                <Plus size={14} strokeWidth={2.4} /> {t('trainerPayment.packSell', 'Sell pack')}
              </button>
            )}
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${TT.border}` }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: TT.textMute, textTransform: 'uppercase', marginBottom: 7 }}>
              {t('trainerPayment.history', 'History')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {history.map((h, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: TT.text, minWidth: 74 }}>{fmtMonth(h.period_month)}</span>
                  <span style={{ fontFamily: TFont.display, fontSize: 13, fontWeight: 800, color: TT.text, minWidth: 52 }}>
                    {h.amount != null ? `$${Number(h.amount).toFixed(0)}` : '—'}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: TT.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.note || ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
