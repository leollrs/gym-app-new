import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, Circle, Bell, X, Pencil, MessageCircle } from 'lucide-react';
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

// Trainer-facing payment tracker (manual — no billing integration). Sets the
// client's monthly fee (or a per-session rate that estimates the monthly),
// marks a month paid on a chosen date, shows the next expected due date +
// history, and nudges the member in-app or over WhatsApp.
export default function TrainerClientPayment({ clientId }) {
  const { t, i18n } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [marking, setMarking] = useState(false);
  const [editingFee, setEditingFee] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [payDate, setPayDate] = useState(localToday);
  // fee editor
  const [feeAmount, setFeeAmount] = useState('');
  const [feeMethod, setFeeMethod] = useState('cash');
  const [feeDay, setFeeDay] = useState('');
  const [feeCps, setFeeCps] = useState('');

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_client_payment_status', { p_client_id: clientId });
      if (error) throw error;
      setStatus(data);
    } catch (e) { logger.error(e); }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString(i18n.language === 'es' ? 'es' : 'en', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const fmtMonth = (d) => d ? new Date(d).toLocaleDateString(i18n.language === 'es' ? 'es' : 'en', { month: 'short', year: 'numeric' }) : '';
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
    setMarking(true);
  };

  const confirmPaid = async () => {
    const amt = amount ? Number(amount) : null;
    const composedNote = [methodLabel(method), note.trim()].filter(Boolean).join(' · ') || null;
    await run(() => supabase.rpc('mark_client_paid', {
      p_client_id: clientId,
      p_period_month: null,
      p_amount: Number.isFinite(amt) ? amt : null,
      p_note: composedNote,
      p_paid_at: `${payDate || localToday()}T12:00:00`,
    }), t('trainerPayment.markedPaid', 'Marked paid'));
    setMarking(false); setAmount(''); setMethod('cash'); setNote('');
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
