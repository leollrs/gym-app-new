import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DollarSign, Bell, MessageCircle, CheckCircle2, ChevronLeft, ChevronRight, AlertTriangle, RotateCcw, Pencil, X, Download, Ticket } from 'lucide-react';
import { format, addMonths, startOfMonth } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { enUS } from 'date-fns/locale/en-US';
import { supabase } from '../../lib/supabase';
import logger from '../../lib/logger';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { openWhatsApp, hasWhatsApp } from '../../lib/whatsapp';
import { exportCSV } from '../../lib/csvExport';
import { readTrainerCache, writeTrainerCache } from '../../lib/trainerCache';
import EmptyState from '../../components/EmptyState';
import { TT, TFont, avatarIdx } from './components/designTokens';
import { TCard, TAvatar } from './components/designPrimitives';

const METHODS = ['cash', 'athmovil', 'card', 'transfer', 'other'];
const METHOD_DEFAULT = { cash: 'Efectivo', athmovil: 'ATH Móvil', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' };
// $62 stays $62, but 62.5 must render $62.50 — toFixed(0) was silently
// rounding cents away on a money surface.
const fmtMoney = (n) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
};
const fmtAmountPlain = (n) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};
const todayYmd = () => format(new Date(), 'yyyy-MM-dd');
// Manual tracking started with the app — nothing exists before 2024.
const MIN_YEAR = 2024;

// Trainer "who owes me" tracker + annual income view. Manual tracking only.
// Month view: page through months, one-tap mark paid (at the set fee), edit an
// entry, see the paid date, nudge in-app/WhatsApp. Year view: income per month
// + per client.
export default function TrainerPayments() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();
  const dateFnsLocale = i18n.language?.startsWith('es') ? es : enUS;

  const [mode, setMode] = useState('month'); // month | year
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());

  // Per-trainer, per-period payment caches → navigating back paints the last
  // month/year instantly, then the RPC revalidates in the background. Keyed by
  // period so paging to an already-seen month/year is also instant.
  const monthCK = `tpay:list:${profile?.id}:${format(startOfMonth(new Date()), 'yyyy-MM-01')}`;
  const yearCK = `tpay:year:${profile?.id}:${new Date().getFullYear()}`;
  const [data, setData] = useState(() => readTrainerCache(monthCK) ?? null);
  const [yearData, setYearData] = useState(() => readTrainerCache(yearCK) ?? null);
  // Cold load only — gate the spinner on the default (month) view's cache.
  const [loading, setLoading] = useState(() => !readTrainerCache(monthCK));
  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState('pending'); // pending | paid | packs | all
  const [editId, setEditId] = useState(null);
  const [editAmount, setEditAmount] = useState('');
  const [editMethod, setEditMethod] = useState('cash');
  const [editNote, setEditNote] = useState('');
  const [editPaidAt, setEditPaidAt] = useState(todayYmd());
  // null = session_packs unavailable (pre-0534) → packs UI hidden entirely.
  const [packs, setPacks] = useState(null);

  useEffect(() => { document.title = `${t('trainerPayments.title', 'Payments')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  const periodStr = (d) => format(d, 'yyyy-MM-01');

  const loadMonth = useCallback(async () => {
    const key = `tpay:list:${profile?.id}:${periodStr(viewMonth)}`;
    // Stale-while-revalidate: paint cached data for this period instantly and
    // skip the spinner; only show it when this period has nothing cached.
    const cached = profile?.id ? readTrainerCache(key) : null;
    if (cached) setData(cached); else setLoading(true);
    try {
      const { data: r, error } = await supabase.rpc('get_trainer_money_overview', { p_month: periodStr(viewMonth) });
      if (error) throw error;
      // Only write through on success so a failed fetch never clobbers good cache.
      const next = r || {};
      setData(next);
      if (profile?.id) writeTrainerCache(key, next);
    } catch (e) { logger.error('TrainerPayments month load failed', e); if (!cached) setData({}); }
    finally { setLoading(false); }
  }, [viewMonth, profile?.id]);

  const loadYear = useCallback(async () => {
    const key = `tpay:year:${profile?.id}:${viewYear}`;
    const cached = profile?.id ? readTrainerCache(key) : null;
    if (cached) setYearData(cached); else setLoading(true);
    try {
      const { data: r, error } = await supabase.rpc('get_trainer_year_overview', { p_year: viewYear });
      if (error) throw error;
      const next = r || {};
      setYearData(next);
      if (profile?.id) writeTrainerCache(key, next);
    } catch (e) { logger.error('TrainerPayments year load failed', e); if (!cached) setYearData({}); }
    finally { setLoading(false); }
  }, [viewYear, profile?.id]);

  useEffect(() => { if (mode === 'month') loadMonth(); else loadYear(); }, [mode, loadMonth, loadYear]);

  // Active session packs (0534). Tolerates the table not existing yet
  // (42P01 pre-migration) by hiding all pack UI.
  useEffect(() => {
    if (!profile?.id) return;
    let on = true;
    (async () => {
      const { data: rows, error } = await supabase
        .from('session_packs')
        .select('id, client_id, sessions_total, sessions_used, is_active, created_at')
        .eq('trainer_id', profile.id)
        .eq('is_active', true)
        .order('created_at', { ascending: true });
      if (!on) return;
      if (error) {
        if (error.code !== '42P01') logger.error('TrainerPayments packs load failed', error);
        setPacks(null);
        return;
      }
      setPacks(rows || []);
    })();
    return () => { on = false; };
  }, [profile?.id]);

  // Oldest active pack per client (the one being consumed).
  const packByClient = useMemo(() => {
    const m = {};
    for (const p of packs || []) if (!m[p.client_id]) m[p.client_id] = p;
    return m;
  }, [packs]);
  const packsAvailable = Array.isArray(packs) && packs.length > 0;

  const methodLabel = (key) => METHODS.includes(key) ? t(`trainerPayment.method.${key}`, METHOD_DEFAULT[key]) : null;
  const fmtDay = (d) => d ? format(new Date(d), 'd MMM', { locale: dateFnsLocale }) : '';

  const clients = useMemo(() => Array.isArray(data?.clients) ? data.clients : [], [data]);
  const filtered = useMemo(() => {
    if (filter === 'pending') return clients.filter(c => Number(c.monthly_fee || 0) > 0 && !c.paid_this_month);
    if (filter === 'paid') return clients.filter(c => c.paid_this_month);
    if (filter === 'packs') return clients.filter(c => packByClient[c.client_id]);
    return clients;
  }, [clients, filter, packByClient]);

  const pendingCount = clients.filter(c => Number(c.monthly_fee || 0) > 0 && !c.paid_this_month).length;
  const paidCount = clients.filter(c => c.paid_this_month).length;
  const packsCount = clients.filter(c => packByClient[c.client_id]).length;

  const act = async (id, fn, okMsg) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const { error } = await fn();
      if (error) throw error;
      if (okMsg) showToast(okMsg, 'success');
      await loadMonth();
    } catch (e) {
      logger.error('TrainerPayments action failed', e);
      showToast(t('trainerPayments.error', 'Something went wrong'), 'error');
    } finally { setBusyId(null); }
  };

  const markPaid = (c) => act(c.client_id,
    () => supabase.rpc('mark_client_paid', {
      p_client_id: c.client_id, p_period_month: periodStr(viewMonth),
      p_amount: c.monthly_fee != null ? Number(c.monthly_fee) : null,
      p_note: methodLabel(c.payment_method) || null,
    }), t('trainerPayment.markedPaid', 'Marked paid'));

  const unmark = (c) => act(c.client_id,
    () => supabase.rpc('unmark_client_paid', { p_client_id: c.client_id, p_period_month: periodStr(viewMonth) }),
    t('trainerPayment.markedUnpaid', 'Marked unpaid'));

  const remindApp = (c) => act(c.client_id,
    () => supabase.rpc('trainer_send_payment_reminder', { p_client_id: c.client_id }),
    t('trainerPayment.reminderSent', 'Reminder sent'));

  const remindWA = (c) => {
    const name = (c.full_name || '').split(' ')[0];
    // P2-11: this is the trainer's own PT fee, not the gym membership.
    openWhatsApp(c.phone_number, t('trainerPayment.waMessage', 'Hi {{name}}! Quick reminder: your training payment for this month is still pending. Thanks!', { name: name || '' }));
  };

  const openEdit = (c) => {
    setEditAmount(c.paid_amount != null ? String(c.paid_amount) : (c.monthly_fee != null ? String(c.monthly_fee) : ''));
    setEditMethod(c.payment_method && METHODS.includes(c.payment_method) ? c.payment_method : 'cash');
    setEditNote('');
    // "Pagado el": default today (or the recorded date when editing); never future.
    const prior = c.paid_at ? format(new Date(c.paid_at), 'yyyy-MM-dd') : todayYmd();
    setEditPaidAt(prior > todayYmd() ? todayYmd() : prior);
    setEditId(c.client_id);
  };
  const saveEdit = (c) => {
    const amt = editAmount ? Number(editAmount) : null;
    const composed = [methodLabel(editMethod), editNote.trim()].filter(Boolean).join(' · ') || null;
    // Noon local keeps the chosen calendar day stable across timezones.
    const paidAtIso = editPaidAt ? new Date(`${editPaidAt}T12:00:00`).toISOString() : null;
    act(c.client_id, () => supabase.rpc('mark_client_paid', {
      p_client_id: c.client_id, p_period_month: periodStr(viewMonth),
      p_amount: Number.isFinite(amt) ? amt : null, p_note: composed,
      p_paid_at: paidAtIso,
    }), t('trainerPayment.markedPaid', 'Marked paid'));
    setEditId(null);
  };

  // ── CSV export (month + year) ──
  const exportMonth = async () => {
    if (!clients.length) return;
    try {
      await exportCSV({
        filename: `cobros-${format(viewMonth, 'yyyy-MM')}`,
        columns: [
          { key: 'full_name', label: t('trainerPayments.csvClient', 'Client'), format: (v, r) => v || r.username || '' },
          { key: 'monthly_fee', label: t('trainerPayments.csvFee', 'Fee'), format: v => v != null ? fmtAmountPlain(v) : '' },
          { key: 'paid_amount', label: t('trainerPayments.csvPaid', 'Amount paid'), format: (v, r) => r.paid_this_month ? fmtAmountPlain(v ?? r.monthly_fee) : '' },
          { key: 'paid_at', label: t('trainerPayments.csvPaidDate', 'Paid date'), format: v => v ? format(new Date(v), 'yyyy-MM-dd') : '' },
          { key: 'note', label: t('trainerPayments.csvNote', 'Note'), format: v => v || '' },
        ],
        data: clients,
      });
    } catch (e) {
      logger.error('TrainerPayments month export failed', e);
      showToast(t('trainerPayments.exportError', 'Could not export the file'), 'error');
    }
  };
  const exportYear = async () => {
    const yClients = Array.isArray(yearData?.clients) ? yearData.clients : [];
    if (!yClients.length) return;
    const monthLabel = (m) => format(new Date(2000, m - 1, 1), 'MMM', { locale: dateFnsLocale });
    try {
      await exportCSV({
        filename: `cobros-${yearData?.year || viewYear}`,
        columns: [
          { key: 'full_name', label: t('trainerPayments.csvClient', 'Client') },
          ...Array.from({ length: 12 }, (_, i) => ({
            key: `m${i}`, label: monthLabel(i + 1),
            format: (_v, r) => fmtAmountPlain(Array.isArray(r.months) ? r.months[i] : 0),
          })),
          { key: 'total', label: t('trainerPayments.csvTotal', 'Total'), format: v => fmtAmountPlain(v) },
        ],
        data: yClients,
      });
    } catch (e) {
      logger.error('TrainerPayments year export failed', e);
      showToast(t('trainerPayments.exportError', 'Could not export the file'), 'error');
    }
  };

  const ExportButton = ({ onClick, disabled }) => (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', border: `1px solid ${TT.border}`, background: TT.surface, color: disabled ? TT.textMute : TT.text, opacity: disabled ? 0.55 : 1 }}>
      <Download size={13} /> {t('trainerPayments.exportCsv', 'Export CSV')}
    </button>
  );

  const collected = Number(data?.collected_total || 0);
  const pendingTotal = Number(data?.pending_total || 0);
  const expected = Number(data?.expected_total || 0);

  const filterTabs = [
    { key: 'pending', label: t('trainerPayments.tabPending', 'Pending'), count: pendingCount },
    { key: 'paid', label: t('trainerPayments.tabPaid', 'Paid'), count: paidCount },
    // Only offered once session_packs exists and has active packs.
    ...(packsAvailable ? [{ key: 'packs', label: t('trainerPayments.tabPacks', 'Packs'), count: packsCount }] : []),
    { key: 'all', label: t('trainerPayments.tabAll', 'All'), count: clients.length },
  ];

  // ── shared header ──
  const Header = (
    <div style={{ padding: '14px 16px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button type="button" onClick={() => navigate('/trainer')} aria-label={t('trainerPayments.back', 'Back')}
          style={{ width: 38, height: 38, borderRadius: 12, border: `1px solid ${TT.border}`, background: TT.surface, display: 'grid', placeItems: 'center', color: TT.text, cursor: 'pointer', flexShrink: 0 }}>
          <ChevronLeft size={20} />
        </button>
        <div style={{ fontFamily: TFont.display, fontSize: 24, fontWeight: 800, color: TT.text, letterSpacing: -0.8, flex: 1 }}>
          {t('trainerPayments.title', 'Payments')}
        </div>
      </div>
      {/* Month / Year toggle */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[{ k: 'month', l: t('trainerPayments.viewMonth', 'Month') }, { k: 'year', l: t('trainerPayments.viewYear', 'Year') }].map(o => {
          const on = mode === o.k;
          return (
            <button key={o.k} type="button" onClick={() => setMode(o.k)}
              style={{ flex: 1, padding: '9px 12px', borderRadius: 12, fontSize: 13, fontWeight: 800, cursor: 'pointer',
                border: on ? 'none' : `1px solid ${TT.border}`, background: on ? TT.text : TT.surface, color: on ? TT.onInverse : TT.textSub }}>
              {o.l}
            </button>
          );
        })}
      </div>
    </div>
  );

  // ── period stepper (big label) ──
  const Stepper = ({ label, onPrev, onNext, nextDisabled, prevDisabled }) => (
    <div style={{ padding: '4px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <button type="button" onClick={onPrev} disabled={prevDisabled} aria-label={t('trainerPayments.prev', 'Previous')}
        style={{ width: 40, height: 40, borderRadius: 12, border: `1px solid ${TT.border}`, background: TT.surface, display: 'grid', placeItems: 'center', color: prevDisabled ? TT.textMute : TT.text, cursor: prevDisabled ? 'not-allowed' : 'pointer', opacity: prevDisabled ? 0.4 : 1 }}>
        <ChevronLeft size={20} />
      </button>
      <div style={{ fontFamily: TFont.display, fontSize: 26, fontWeight: 800, color: TT.text, letterSpacing: -0.8, textTransform: 'capitalize', textAlign: 'center', flex: 1 }}>
        {label}
      </div>
      <button type="button" onClick={onNext} disabled={nextDisabled} aria-label={t('trainerPayments.next', 'Next')}
        style={{ width: 40, height: 40, borderRadius: 12, border: `1px solid ${TT.border}`, background: TT.surface, display: 'grid', placeItems: 'center', color: nextDisabled ? TT.textMute : TT.text, cursor: nextDisabled ? 'not-allowed' : 'pointer', opacity: nextDisabled ? 0.4 : 1 }}>
        <ChevronRight size={20} />
      </button>
    </div>
  );

  const atCurrentMonth = startOfMonth(new Date()).getTime() <= viewMonth.getTime();
  const atCurrentYear = viewYear >= new Date().getFullYear();

  return (
    <div style={{ background: TT.bg, minHeight: '100%' }}>
      <div className="max-w-3xl mx-auto" style={{ padding: '0 0 32px' }}>
        {Header}

        {mode === 'month' ? (
          <>
            <Stepper
              label={format(viewMonth, 'MMMM yyyy', { locale: dateFnsLocale })}
              onPrev={() => setViewMonth(m => addMonths(m, -1))}
              onNext={() => setViewMonth(m => addMonths(m, 1))}
              nextDisabled={atCurrentMonth}
            />

            {/* Stat strip */}
            <div style={{ padding: '12px 16px 0', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[
                { label: t('trainerPayments.collected', 'Collected'), value: fmtMoney(collected), tone: TT.good },
                { label: t('trainerPayments.pending', 'Pending'), value: fmtMoney(pendingTotal), sub: pendingCount, tone: TT.hot },
                { label: t('trainerPayments.expected', 'Expected'), value: fmtMoney(expected), tone: TT.accent },
              ].map((s, i) => (
                <TCard key={i} padded={14}>
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: TT.textMute }}>{s.label}</div>
                  <div style={{ fontFamily: TFont.display, fontSize: 22, fontWeight: 800, color: s.tone, letterSpacing: -0.8, lineHeight: 1, marginTop: 6 }}>{s.value}</div>
                  {s.sub != null && <div style={{ fontSize: 10.5, color: TT.textSub, marginTop: 3, fontWeight: 600 }}>{t('trainerPayments.nClients', '{{count}} clients', { count: Number(s.sub) })}</div>}
                </TCard>
              ))}
            </div>

            {/* Filter tabs + export */}
            <div style={{ padding: '16px 16px 8px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {filterTabs.map(tab => {
                const on = filter === tab.key;
                return (
                  <button key={tab.key} type="button" onClick={() => setFilter(tab.key)}
                    style={{ padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                      border: on ? 'none' : `1px solid ${TT.border}`, background: on ? TT.text : TT.surface, color: on ? TT.onInverse : TT.textSub,
                      display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {tab.label}<span style={{ fontSize: 11, fontWeight: 800, opacity: 0.7 }}>{tab.count}</span>
                  </button>
                );
              })}
              <div style={{ marginLeft: 'auto' }}>
                <ExportButton onClick={exportMonth} disabled={loading || clients.length === 0} />
              </div>
            </div>

            {/* List */}
            <div style={{ padding: '4px 16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {loading ? (
                [0, 1, 2].map(i => <div key={i} className="animate-pulse" style={{ height: 92, borderRadius: 18, background: TT.surface2 }} />)
              ) : filtered.length === 0 ? (
                <div style={{ paddingTop: 24 }}>
                  <EmptyState
                    icon={DollarSign}
                    title={filter === 'pending' ? t('trainerPayments.allPaidTitle', 'All caught up') : t('trainerPayments.emptyTitle', 'Nothing here yet')}
                    description={data?.with_fee === 0
                      ? t('trainerPayments.noFeesDesc', 'Set a monthly fee on a client (from their profile) to start tracking payments here.')
                      : filter === 'pending' ? t('trainerPayments.allPaidDesc', 'Every client with a fee has paid this month. Nice. 💪') : t('trainerPayments.emptyDesc', 'No clients match this filter.')}
                  />
                </div>
              ) : (
                filtered.map(c => {
                  const name = c.full_name || c.username || t('trainerCalendar.client', 'Client');
                  const fee = c.monthly_fee != null ? Number(c.monthly_fee) : null;
                  const paid = !!c.paid_this_month;
                  const overdue = (c.overdue_days || 0) > 0;
                  const busy = busyId === c.client_id;
                  const canWA = hasWhatsApp(c.phone_number);
                  const editing = editId === c.client_id;
                  const pk = packByClient[c.client_id];
                  const pkLeft = pk ? Math.max(0, Number(pk.sessions_total) - Number(pk.sessions_used)) : 0;
                  const feeLine = [
                    fee != null ? t('trainerPayments.perMonth', '${{amount}}/mo', { amount: fmtAmountPlain(fee) }) : t('trainerPayment.noFee', 'No fee set'),
                    c.payment_method ? methodLabel(c.payment_method) : null,
                  ].filter(Boolean).join(' · ');
                  return (
                    <TCard key={c.client_id} padded={0} style={overdue && !paid ? { boxShadow: `inset 3px 0 0 ${TT.hot}, ${TT.shadow}` } : undefined}>
                      <div style={{ padding: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <button type="button" onClick={() => navigate(`/trainer/clients/${c.client_id}`)} aria-label={name}
                            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}>
                            <TAvatar name={name} size={42} idx={avatarIdx(c.client_id)} src={c.avatar_url} />
                          </button>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                              <span style={{ fontSize: 14, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                              {overdue && !paid && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 800, color: TT.hot, background: TT.hotSoft, padding: '2px 7px', borderRadius: 999, flexShrink: 0 }}>
                                  <AlertTriangle size={10} /> {t('trainerPayments.overdue', '{{n}}d', { n: c.overdue_days })}
                                </span>
                              )}
                              {pk && (
                                <span title={t('trainerPayments.packLeft', '{{n}} of {{total}} sessions left', { n: pkLeft, total: pk.sessions_total })}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 800, color: TT.accentInk, background: TT.accentSoft, padding: '2px 7px', borderRadius: 999, flexShrink: 0 }}>
                                  <Ticket size={10} /> {t('trainerPayments.pack', 'Pack')}: {pkLeft}/{pk.sessions_total}
                                </span>
                              )}
                              {c.is_active_client === false && (
                                <span style={{ fontSize: 10, fontWeight: 800, color: TT.textSub, background: TT.surface2, padding: '2px 7px', borderRadius: 999, flexShrink: 0 }}>
                                  {t('trainerPayments.inactiveClient', 'Inactive')}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 2 }}>
                              {paid && c.paid_at
                                ? t('trainerPayments.paidOn', 'Paid {{date}}', { date: fmtDay(c.paid_at) })
                                : feeLine}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontFamily: TFont.display, fontSize: 15, fontWeight: 800, color: paid ? TT.good : TT.text, letterSpacing: -0.4 }}>
                              {paid ? (c.paid_amount != null ? fmtMoney(c.paid_amount) : '✓') : (fee != null ? fmtMoney(fee) : '—')}
                            </div>
                            <div style={{ fontSize: 10, color: paid ? TT.good : TT.warnInk, fontWeight: 700 }}>
                              {paid ? t('trainerPayments.paid', 'Paid') : t('trainerPayments.due', 'Due')}
                            </div>
                          </div>
                        </div>

                        {/* Inline edit */}
                        {editing ? (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${TT.border}`, display: 'flex', flexDirection: 'column', gap: 9 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 17, fontWeight: 800, color: TT.textSub }}>$</span>
                              <input inputMode="decimal" value={editAmount} onChange={e => setEditAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                                placeholder={t('trainerPayment.amount', 'Amount')}
                                style={{ flex: 1, padding: '8px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 14, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }} />
                            </div>
                            {/* "Pagado el" — real payment date (backdate ok, never future) */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 800, color: TT.textSub, letterSpacing: 0.4, textTransform: 'uppercase', flexShrink: 0 }}>
                                {t('trainerPayments.paidOnLabel', 'Paid on')}
                              </span>
                              <input type="date" value={editPaidAt} max={todayYmd()}
                                onChange={e => {
                                  const v = e.target.value;
                                  setEditPaidAt(v && v > todayYmd() ? todayYmd() : v);
                                }}
                                style={{ flex: 1, padding: '8px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {METHODS.map(m => {
                                const on = editMethod === m;
                                return <button key={m} onClick={() => setEditMethod(m)}
                                  style={{ padding: '6px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: on ? 'none' : `1px solid ${TT.border}`, background: on ? TT.accent : TT.surface2, color: on ? TT.onInverse : TT.textSub }}>{methodLabel(m)}</button>;
                              })}
                            </div>
                            <input value={editNote} onChange={e => setEditNote(e.target.value)} placeholder={t('trainerPayment.notePlaceholder', 'Note (optional)')}
                              style={{ padding: '8px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 13, outline: 'none' }} />
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button onClick={() => saveEdit(c)} disabled={busy}
                                style={{ flex: 1, padding: '9px', borderRadius: 11, border: 'none', background: TT.accent, color: '#fff', fontFamily: TFont.display, fontWeight: 800, fontSize: 12.5, cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
                                {t('trainerPayment.confirmPaid', 'Confirm payment')}
                              </button>
                              <button onClick={() => setEditId(null)}
                                style={{ width: 42, display: 'grid', placeItems: 'center', padding: '9px', borderRadius: 11, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.textSub, cursor: 'pointer' }}><X size={16} /></button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                            {paid ? (
                              <>
                                <button type="button" onClick={() => openEdit(c)} disabled={busy}
                                  style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 12px', borderRadius: 11, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontWeight: 700, fontSize: 12, cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
                                  <Pencil size={13} /> {t('trainerPayments.edit', 'Edit')}
                                </button>
                                <button type="button" onClick={() => unmark(c)} disabled={busy}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 11, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.textSub, fontWeight: 700, fontSize: 12, cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
                                  <RotateCcw size={13} /> {t('trainerPayments.undo', 'Undo')}
                                </button>
                              </>
                            ) : (
                              <>
                                <button type="button" onClick={() => markPaid(c)} disabled={busy || fee == null}
                                  style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 12px', borderRadius: 11, border: 'none', background: TT.accent, color: '#fff', fontFamily: TFont.display, fontWeight: 800, fontSize: 12.5, cursor: fee == null ? 'not-allowed' : 'pointer', opacity: (busy || fee == null) ? 0.5 : 1 }}>
                                  <CheckCircle2 size={14} strokeWidth={2.4} /> {t('trainerPayments.markPaidFee', 'Paid {{amount}}', { amount: fee != null ? fmtMoney(fee) : '' })}
                                </button>
                                <button type="button" onClick={() => openEdit(c)} disabled={busy} aria-label={t('trainerPayments.edit', 'Edit')}
                                  style={{ width: 42, display: 'grid', placeItems: 'center', padding: '9px', borderRadius: 11, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
                                  <Pencil size={15} />
                                </button>
                                <button type="button" onClick={() => remindApp(c)} disabled={busy} aria-label={t('trainerPayment.remindApp', 'In-app')}
                                  style={{ width: 42, display: 'grid', placeItems: 'center', padding: '9px', borderRadius: 11, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
                                  <Bell size={15} />
                                </button>
                                {canWA && (
                                  <button type="button" onClick={() => remindWA(c)} aria-label="WhatsApp"
                                    style={{ width: 42, display: 'grid', placeItems: 'center', padding: '9px', borderRadius: 11, border: 'none', background: '#25D366', color: '#fff', cursor: 'pointer' }}>
                                    <MessageCircle size={15} strokeWidth={2.4} />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </TCard>
                  );
                })
              )}
            </div>
          </>
        ) : (
          /* ───────────── YEAR VIEW ───────────── */
          <>
            <Stepper
              label={String(viewYear)}
              onPrev={() => setViewYear(y => Math.max(MIN_YEAR, y - 1))}
              onNext={() => setViewYear(y => y + 1)}
              nextDisabled={atCurrentYear}
              prevDisabled={viewYear <= MIN_YEAR}
            />
            {loading ? (
              <div style={{ padding: '16px' }}>
                <div className="animate-pulse" style={{ height: 200, borderRadius: 18, background: TT.surface2 }} />
              </div>
            ) : (
              <>
                <div style={{ padding: '12px 16px 0', display: 'flex', justifyContent: 'flex-end' }}>
                  <ExportButton onClick={exportYear} disabled={!Array.isArray(yearData?.clients) || yearData.clients.length === 0} />
                </div>
                <YearView yearData={yearData} dateFnsLocale={dateFnsLocale} t={t}
                  onPickMonth={(m) => { setViewMonth(startOfMonth(new Date(viewYear, m - 1, 1))); setMode('month'); }}
                  onOpenClient={(id) => navigate(`/trainer/clients/${id}`)} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Year view body: total + 12-month bar chart + per-client breakdown ──
function YearView({ yearData, dateFnsLocale, t, onPickMonth, onOpenClient }) {
  const total = Number(yearData?.total || 0);
  const months = Array.isArray(yearData?.months) ? yearData.months : [];
  const clients = Array.isArray(yearData?.clients) ? yearData.clients : [];
  const maxMonth = Math.max(1, ...months.map(m => Number(m.collected || 0)));
  const monthInitial = (m) => format(new Date(2000, m - 1, 1), 'MMM', { locale: dateFnsLocale });

  return (
    <div style={{ padding: '12px 16px 0' }}>
      {/* Total */}
      <TCard padded={16} style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: TT.textMute }}>
          {t('trainerPayments.yearTotal', 'Collected in {{year}}', { year: yearData?.year || '' })}
        </div>
        <div style={{ fontFamily: TFont.display, fontSize: 36, fontWeight: 900, color: TT.text, letterSpacing: -1.6, lineHeight: 1, marginTop: 6 }}>
          {fmtMoney(total)}
        </div>
        <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 5, fontWeight: 600 }}>
          {t('trainerPayments.yearPayments', '{{count}} payments collected', { count: yearData?.paid_count || 0 })}
        </div>
      </TCard>

      {/* 12-month bar chart */}
      <TCard padded={16} style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 4, height: 130 }}>
          {months.map(m => {
            const v = Number(m.collected || 0);
            const h = Math.round((v / maxMonth) * 100);
            return (
              <button key={m.month} type="button" onClick={() => onPickMonth(m.month)} aria-label={monthInitial(m.month)}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, background: 'transparent', border: 'none', cursor: 'pointer', height: '100%', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 8.5, fontWeight: 800, color: v > 0 ? TT.good : TT.textMute, fontFamily: TFont.mono }}>
                  {v > 0 ? `$${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0)}` : ''}
                </span>
                <div style={{ width: '78%', height: `${Math.max(2, h)}%`, minHeight: 2, borderRadius: 6, background: v > 0 ? TT.accent : TT.surface2, transition: 'height 0.3s' }} />
                <span style={{ fontSize: 8.5, color: TT.textMute, fontWeight: 700, textTransform: 'capitalize' }}>{monthInitial(m.month).slice(0, 1)}</span>
              </button>
            );
          })}
        </div>
      </TCard>

      {/* Per-client breakdown */}
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: TT.textMute, margin: '4px 2px 8px' }}>
        {t('trainerPayments.byClient', 'By client')}
      </div>
      {clients.length === 0 ? (
        <div style={{ fontSize: 12.5, color: TT.textSub, padding: '8px 2px 20px' }}>
          {t('trainerPayments.yearEmpty', 'No payments recorded this year yet.')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 8 }}>
          {clients.map(c => (
            <TCard key={c.client_id} padded={12}>
              <button type="button" onClick={() => onOpenClient(c.client_id)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <TAvatar name={c.full_name || '?'} size={38} idx={avatarIdx(c.client_id)} src={c.avatar_url} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.full_name}</div>
                  {/* mini 12-month sparkline */}
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 16, marginTop: 4 }}>
                    {(Array.isArray(c.months) ? c.months : []).map((mv, i) => {
                      const v = Number(mv || 0);
                      const h = Math.round((v / maxMonth) * 100);
                      return <div key={i} style={{ flex: 1, height: `${Math.max(6, h)}%`, minHeight: 2, borderRadius: 2, background: v > 0 ? TT.accent : TT.surface2 }} />;
                    })}
                  </div>
                </div>
                <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.5, flexShrink: 0 }}>
                  {fmtMoney(c.total)}
                </div>
              </button>
            </TCard>
          ))}
        </div>
      )}
    </div>
  );
}
