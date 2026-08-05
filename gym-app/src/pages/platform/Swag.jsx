/**
 * Swag — platform (super-admin) merch inventory and box shipping (mig 0682).
 *
 * Three questions this page answers, and nobody else can see any of them:
 *   • What's left in MY warehouse?      (purchases − shipped)
 *   • What's left at each gym?          (shipped to them − handed to members)
 *   • What's in box #XXXXXX and where is it going?
 *
 * Gym admins never see inventory or unit cost — swag_items / swag_purchases /
 * swag_boxes / swag_box_items are super-admin-only by RLS. Their entire verb is
 * "mark this gift delivered", which happens at check-in or on /admin/print-cards.
 *
 * Fixed-dark like every other platform page (no admin CSS vars, no retosKit).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import {
  Package, Boxes, ShoppingCart, Plus, Truck, Printer, X, Building2, AlertTriangle, Sparkles,
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { logAdminAction } from '../../lib/adminAudit';
import FadeIn from '../../components/platform/FadeIn';
import PlatformSpinner from '../../components/platform/PlatformSpinner';
import { availableToPack, boxTotals, formatCents } from '../../lib/platform/swagStock';

// Platform palette — hardcoded on purpose, same as every sibling page.
const C = {
  card: '#0F172A', hover: '#111827', line: 'rgba(255,255,255,0.06)',
  text: '#E5E7EB', muted: '#9CA3AF', faint: '#6B7280', accent: '#D4AF37',
  good: '#10B981', warn: '#F59E0B',
};

const inputCls = 'w-full rounded-lg px-3 py-2 text-[13px] outline-none';
const inputSty = { background: '#0B1220', border: `1px solid ${C.line}`, color: C.text };

// Only the occasions that actually have a generator in
// generate_print_cards_daily (0415). milestone_25 / first_pr / custom are in
// the enum for historical rows but nothing ever fires them, so a rule attached
// to one would silently never produce a gift. Mirrors AdminSettingsCards:19.
const RULE_OCCASIONS = [
  'welcome', 'habit_9in6', 'tenure_30', 'tenure_90', 'tenure_365',
  'milestone_100', 'milestone_250', 'milestone_500', 'returning', 'birthday',
];

function Tab({ active, onClick, icon, children, count }) {
  // Bound as a variable rather than destructured to `Icon`: this config doesn't
  // credit JSX-only usage, and its ignore pattern (^[A-Z_]) exempts capitalised
  // vars but not args. GoldBtn below escapes it only because `{Icon && ...}` is
  // a plain reference.
  const Icon = icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-[12.5px] font-semibold whitespace-nowrap transition-colors"
      style={{
        background: active ? 'rgba(212,175,55,0.12)' : C.card,
        color: active ? C.accent : C.muted,
        border: `1px solid ${active ? 'rgba(212,175,55,0.32)' : C.line}`,
      }}
    >
      <Icon size={14} />{children}
      {count != null && <span style={{ color: C.faint }}>({count})</span>}
    </button>
  );
}

function Panel({ title, action, children }) {
  return (
    <div className="rounded-2xl overflow-hidden mb-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
          <p className="text-[13px] font-bold" style={{ color: C.text }}>{title}</p>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function GoldBtn({ onClick, children, icon: Icon, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold disabled:opacity-45"
      style={{ background: C.accent, color: '#000' }}>
      {Icon && <Icon size={13} />}{children}
    </button>
  );
}

export default function Swag() {
  const { t } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const k = (key, fallback, opts) => t(`platform.swag.${key}`, { defaultValue: fallback, ...(opts || {}) });

  const [tab, setTab] = useState('inventory');
  const [labelBox, setLabelBox] = useState(null);
  const [busy, setBusy] = useState(false);

  // ── Data ──
  const stockQ = useQuery({
    queryKey: ['platform', 'swag', 'stock'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('platform_swag_stock');
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });

  const gymStockQ = useQuery({
    queryKey: ['platform', 'swag', 'gym-stock'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('platform_gym_swag_stock');
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });

  const boxesQ = useQuery({
    queryKey: ['platform', 'swag', 'boxes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('swag_boxes')
        .select('id, box_code, gym_id, status, shipped_at, note, created_at, gyms:gym_id(name), items:swag_box_items(id, item_id, qty)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });

  const rulesQ = useQuery({
    queryKey: ['platform', 'swag', 'rules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_swag_rules')
        .select('id, gym_id, occasion, item_id, is_active');
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });

  const purchasesQ = useQuery({
    queryKey: ['platform', 'swag', 'purchases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('swag_purchases')
        .select('id, item_id, qty, unit_cost_cents, purchased_at, note')
        .order('purchased_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });

  const gymsQ = useQuery({
    queryKey: ['platform', 'swag', 'gyms'],
    queryFn: async () => {
      const { data, error } = await supabase.from('gyms').select('id, name').eq('is_active', true).order('name');
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Memoised rather than `stockQ.data || []`: the bare fallback mints a new
  // array identity every render and re-runs everything downstream that depends
  // on it.
  const stock = useMemo(() => stockQ.data || [], [stockQ.data]);
  const boxes = useMemo(() => boxesQ.data || [], [boxesQ.data]);
  const itemById = useMemo(() => Object.fromEntries(stock.map(i => [i.item_id, i])), [stock]);
  const costOf = (id) => itemById[id]?.unit_cost_cents ?? 0;

  const refresh = () => {
    ['stock', 'gym-stock', 'boxes', 'purchases', 'rules'].forEach(kk =>
      queryClient.invalidateQueries({ queryKey: ['platform', 'swag', kk] }));
  };

  // Set (or clear) which gift a gym gives on an occasion. Clearing DELETES the
  // row rather than flipping is_active — an occasion with no gift is the
  // absence of a rule, not a disabled one, and leaving tombstones behind would
  // make the UNIQUE(gym_id, occasion) constraint fight the next re-add.
  const setRule = async (gymId, occasion, itemId) => {
    try {
      if (!itemId) {
        const { error } = await supabase.from('gym_swag_rules')
          .delete().eq('gym_id', gymId).eq('occasion', occasion);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('gym_swag_rules')
          .upsert({ gym_id: gymId, occasion, item_id: itemId, is_active: true },
                  { onConflict: 'gym_id,occasion' });
        if (error) throw error;
        logAdminAction('swag_rule_set', 'gym', gymId, { occasion, item_id: itemId }, gymId);
      }
      refresh();
    } catch (err) {
      logger.error('Swag: setRule', err);
      showToast(err?.message || k('saveFailed', 'Could not save'), 'error');
    }
  };

  const failed = stockQ.isError || boxesQ.isError;

  // ── Mutations (plain async — the platform pages don't wrap simple writes) ──
  const addItem = async (form) => {
    setBusy(true);
    try {
      const { error } = await supabase.from('swag_items').insert({
        name: form.name.trim(),
        name_es: form.name_es.trim() || null,
        emoji: form.emoji.trim() || null,
        unit_cost_cents: Math.round(Number(form.cost || 0) * 100),
      });
      if (error) throw error;
      logAdminAction('swag_item_created', 'swag_item', null, { name: form.name });
      showToast(k('itemSaved', 'Item saved'), 'success');
      refresh();
    } catch (err) {
      logger.error('Swag: addItem', err);
      showToast(err?.message || k('saveFailed', 'Could not save'), 'error');
    }
    setBusy(false);
  };

  const addPurchase = async (form) => {
    setBusy(true);
    try {
      const { error } = await supabase.from('swag_purchases').insert({
        item_id: form.item_id,
        qty: Number(form.qty),
        unit_cost_cents: Math.round(Number(form.cost || 0) * 100),
        note: form.note.trim() || null,
        created_by: profile?.id ?? null,
      });
      if (error) throw error;
      logAdminAction('swag_purchase_recorded', 'swag_item', form.item_id, { qty: form.qty });
      showToast(k('purchaseSaved', 'Purchase recorded'), 'success');
      refresh();
    } catch (err) {
      logger.error('Swag: addPurchase', err);
      showToast(err?.message || k('saveFailed', 'Could not save'), 'error');
    }
    setBusy(false);
  };

  const createBox = async (gymId) => {
    setBusy(true);
    try {
      const { error } = await supabase.from('swag_boxes').insert({ gym_id: gymId || null, created_by: profile?.id ?? null });
      if (error) throw error;
      showToast(k('boxCreated', 'Box created'), 'success');
      refresh();
    } catch (err) {
      logger.error('Swag: createBox', err);
      showToast(err?.message || k('saveFailed', 'Could not save'), 'error');
    }
    setBusy(false);
  };

  const setBoxLine = async (box, itemId, qty) => {
    const n = Number(qty);
    try {
      if (!Number.isFinite(n) || n <= 0) {
        const line = (box.items || []).find(l => l.item_id === itemId);
        if (line) await supabase.from('swag_box_items').delete().eq('id', line.id);
      } else {
        const { error } = await supabase.from('swag_box_items')
          .upsert({ box_id: box.id, item_id: itemId, qty: n }, { onConflict: 'box_id,item_id' });
        if (error) throw error;
      }
      refresh();
    } catch (err) {
      logger.error('Swag: setBoxLine', err);
      showToast(err?.message || k('saveFailed', 'Could not save'), 'error');
    }
  };

  const shipBox = async (box) => {
    if (!box.gym_id) { showToast(k('needGym', 'Assign a gym before shipping'), 'error'); return; }
    if ((box.items || []).length === 0) { showToast(k('needItems', 'This box is empty'), 'error'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from('swag_boxes')
        .update({ status: 'shipped', shipped_at: new Date().toISOString() })
        .eq('id', box.id);
      if (error) throw error;
      logAdminAction('swag_box_shipped', 'swag_box', box.id, { box_code: box.box_code }, box.gym_id);
      showToast(k('boxShipped', 'Box marked shipped'), 'success');
      refresh();
    } catch (err) {
      logger.error('Swag: shipBox', err);
      showToast(err?.message || k('saveFailed', 'Could not save'), 'error');
    }
    setBusy(false);
  };

  const assignGym = async (box, gymId) => {
    try {
      const { error } = await supabase.from('swag_boxes').update({ gym_id: gymId || null }).eq('id', box.id);
      if (error) throw error;
      refresh();
    } catch (err) {
      logger.error('Swag: assignGym', err);
    }
  };

  if (stockQ.isLoading) {
    return <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-5xl"><PlatformSpinner /></div>;
  }

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-5xl pb-28 md:pb-12">
      <div className="mb-5">
        <h1 className="text-[26px] font-extrabold tracking-tight" style={{ color: C.text }}>
          {k('title', 'Swag & inventory')}
        </h1>
        <p className="text-[13px] mt-1" style={{ color: C.muted }}>
          {k('subtitle', 'What you bought, what you shipped, and what each gym has left')}
        </p>
      </div>

      {/* A failed read must never render as an empty-but-healthy inventory —
          "0 left" and "couldn't load" look identical and mean opposite things. */}
      {failed && (
        <div className="rounded-2xl px-4 py-3 mb-4 flex items-start gap-2.5"
          style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" style={{ color: '#EF4444' }} />
          <p className="text-[12.5px]" style={{ color: '#FCA5A5' }}>
            {k('loadError', "Inventory failed to load — the numbers below are not reliable. If migration 0682 hasn't been applied yet, that's why.")}
          </p>
        </div>
      )}

      <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-hide">
        <Tab active={tab === 'inventory'} onClick={() => setTab('inventory')} icon={Package}>{k('tabInventory', 'Inventory')}</Tab>
        <Tab active={tab === 'boxes'} onClick={() => setTab('boxes')} icon={Boxes} count={boxes.filter(b => b.status === 'packed').length}>{k('tabBoxes', 'Boxes')}</Tab>
        <Tab active={tab === 'rules'} onClick={() => setTab('rules')} icon={Sparkles} count={(rulesQ.data || []).length}>{k('tabRules', 'Rules')}</Tab>
        <Tab active={tab === 'purchases'} onClick={() => setTab('purchases')} icon={ShoppingCart}>{k('tabPurchases', 'Purchases')}</Tab>
      </div>

      {tab === 'inventory' && (
        <FadeIn>
          <InventoryTab
            stock={stock} gymStock={gymStockQ.data || []} k={k}
            onAddItem={addItem} busy={busy}
          />
        </FadeIn>
      )}

      {tab === 'boxes' && (
        <FadeIn>
          <BoxesTab
            boxes={boxes} stock={stock} gyms={gymsQ.data || []} k={k} busy={busy}
            costOf={costOf} onCreate={createBox} onSetLine={setBoxLine}
            onShip={shipBox} onAssign={assignGym} onLabel={setLabelBox}
          />
        </FadeIn>
      )}

      {tab === 'rules' && (
        <FadeIn>
          <RulesTab
            rules={rulesQ.data || []} stock={stock} gyms={gymsQ.data || []}
            k={k} t={t} onSet={setRule}
          />
        </FadeIn>
      )}

      {tab === 'purchases' && (
        <FadeIn>
          <PurchasesTab
            purchases={purchasesQ.data || []} stock={stock} itemById={itemById}
            k={k} busy={busy} onAdd={addPurchase}
          />
        </FadeIn>
      )}

      {labelBox && <BoxLabelModal box={labelBox} stock={stock} k={k} onClose={() => setLabelBox(null)} />}
    </div>
  );
}

// ── Inventory ────────────────────────────────────────────────
function InventoryTab({ stock, gymStock, k, onAddItem, busy }) {
  const [form, setForm] = useState({ name: '', name_es: '', emoji: '', cost: '' });
  const [open, setOpen] = useState(false);

  const byGym = useMemo(() => {
    const m = new Map();
    for (const r of gymStock) {
      if (!m.has(r.gym_id)) m.set(r.gym_id, { name: r.gym_name, rows: [] });
      m.get(r.gym_id).rows.push(r);
    }
    return [...m.values()];
  }, [gymStock]);

  return (
    <>
      <Panel
        title={k('myStock', 'In my warehouse')}
        action={<GoldBtn icon={Plus} onClick={() => setOpen(o => !o)}>{k('newItem', 'New item')}</GoldBtn>}
      >
        {open && (
          <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-2" style={{ borderBottom: `1px solid ${C.line}`, background: '#0B1220' }}>
            <input className={inputCls} style={inputSty} placeholder={k('itemName', 'Name (EN)')}
              value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input className={inputCls} style={inputSty} placeholder={k('itemNameEs', 'Name (ES)')}
              value={form.name_es} onChange={e => setForm({ ...form, name_es: e.target.value })} />
            <input className={inputCls} style={inputSty} placeholder="🎒"
              value={form.emoji} onChange={e => setForm({ ...form, emoji: e.target.value })} />
            <div className="flex gap-2">
              <input className={inputCls} style={inputSty} placeholder={k('unitCost', 'Cost $')} inputMode="decimal"
                value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} />
              <GoldBtn disabled={busy || !form.name.trim()}
                onClick={async () => { await onAddItem(form); setForm({ name: '', name_es: '', emoji: '', cost: '' }); setOpen(false); }}>
                {k('save', 'Save')}
              </GoldBtn>
            </div>
          </div>
        )}
        {stock.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12.5px]" style={{ color: C.faint }}>{k('noItems', 'No items yet')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr style={{ color: C.faint }}>
                  <th className="text-left font-semibold px-4 py-2">{k('item', 'Item')}</th>
                  <th className="text-right font-semibold px-3 py-2">{k('purchased', 'Bought')}</th>
                  <th className="text-right font-semibold px-3 py-2">{k('shipped', 'Shipped')}</th>
                  <th className="text-right font-semibold px-4 py-2">{k('onHand', 'On hand')}</th>
                </tr>
              </thead>
              <tbody>
                {stock.map(i => (
                  <tr key={i.item_id} style={{ borderTop: `1px solid ${C.line}` }}>
                    <td className="px-4 py-2.5" style={{ color: C.text }}>
                      {i.emoji ? `${i.emoji} ` : ''}{i.name}
                      <span className="ml-2" style={{ color: C.faint }}>{formatCents(i.unit_cost_cents)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: C.muted }}>{i.purchased}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: C.muted }}>{i.shipped_out}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold"
                      style={{ color: i.on_hand > 0 ? C.good : C.warn }}>{i.on_hand}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={k('gymStock', 'At the gyms')}>
        {byGym.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12.5px]" style={{ color: C.faint }}>{k('noGymStock', 'Nothing shipped yet')}</p>
        ) : byGym.map((g, i) => (
          <div key={i} className="px-4 py-3" style={{ borderTop: i ? `1px solid ${C.line}` : 'none' }}>
            <div className="flex items-center gap-2 mb-2">
              <Building2 size={13} style={{ color: C.accent }} />
              <p className="text-[13px] font-bold" style={{ color: C.text }}>{g.name}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {g.rows.map(r => (
                <span key={r.item_id} className="px-2.5 py-1 rounded-lg text-[12px]"
                  style={{ background: C.hover, border: `1px solid ${C.line}`, color: C.muted }}>
                  {r.emoji ? `${r.emoji} ` : ''}{r.item_name}{' '}
                  <b style={{ color: r.on_hand > 0 ? C.good : C.warn }}>{r.on_hand}</b>
                  <span style={{ color: C.faint }}> / {r.received}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </Panel>
    </>
  );
}

// ── Boxes ────────────────────────────────────────────────────
function BoxesTab({ boxes, stock, gyms, k, busy, costOf, onCreate, onSetLine, onShip, onAssign, onLabel }) {
  const [newGym, setNewGym] = useState('');

  return (
    <>
      <Panel title={k('newBox', 'Pack a box')}>
        <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
          <select className={inputCls} style={{ ...inputSty, width: 'auto', minWidth: 180 }}
            value={newGym} onChange={e => setNewGym(e.target.value)}>
            <option value="">{k('pickGym', 'Pick a gym…')}</option>
            {gyms.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <GoldBtn icon={Plus} disabled={busy} onClick={() => { onCreate(newGym); setNewGym(''); }}>
            {k('createBox', 'Create box')}
          </GoldBtn>
        </div>
      </Panel>

      {boxes.length === 0 && (
        <Panel><p className="px-4 py-8 text-center text-[12.5px]" style={{ color: C.faint }}>{k('noBoxes', 'No boxes yet')}</p></Panel>
      )}

      {boxes.map(box => {
        const totals = boxTotals(box.items, costOf);
        const isPacked = box.status === 'packed';
        return (
          <Panel
            key={box.id}
            title={
              <span>
                <span className="font-mono" style={{ color: C.accent }}>#{box.box_code}</span>
                <span className="ml-2" style={{ color: C.muted, fontWeight: 500 }}>
                  {box.gyms?.name || k('unassigned', 'unassigned')}
                </span>
                <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
                  style={{ background: isPacked ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)', color: isPacked ? C.warn : C.good }}>
                  {isPacked ? k('packed', 'packed') : k('shippedTag', 'shipped')}
                </span>
              </span>
            }
            action={
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => onLabel(box)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold"
                  style={{ background: C.hover, border: `1px solid ${C.line}`, color: C.muted }}>
                  <Printer size={12} />{k('label', 'Label')}
                </button>
                {isPacked && (
                  <GoldBtn icon={Truck} disabled={busy} onClick={() => onShip(box)}>{k('ship', 'Ship')}</GoldBtn>
                )}
              </div>
            }
          >
            <div className="px-4 py-3">
              {isPacked ? (
                <>
                  {!box.gym_id && (
                    <select className={`${inputCls} mb-3`} style={{ ...inputSty, width: 'auto', minWidth: 180 }}
                      value="" onChange={e => onAssign(box, e.target.value)}>
                      <option value="">{k('pickGym', 'Pick a gym…')}</option>
                      {gyms.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {stock.map(item => {
                      const line = (box.items || []).find(l => l.item_id === item.item_id);
                      // Available excludes what OTHER packed boxes already hold,
                      // plus whatever this box already has (so editing its own
                      // line doesn't fight itself).
                      const others = boxes.filter(b => b.id !== box.id);
                      const avail = availableToPack(item.item_id, item.on_hand, others);
                      return (
                        <div key={item.item_id} className="flex items-center gap-2">
                          <span className="flex-1 text-[12.5px] truncate" style={{ color: C.muted }}>
                            {item.emoji ? `${item.emoji} ` : ''}{item.name}
                            <span style={{ color: C.faint }}> · {k('avail', '{{n}} free', { n: avail })}</span>
                          </span>
                          <input
                            type="number" min="0" max={avail}
                            className="rounded-lg px-2 py-1 text-[12.5px] w-[72px] text-right outline-none"
                            style={inputSty}
                            defaultValue={line?.qty ?? ''}
                            onBlur={e => {
                              const v = e.target.value;
                              if (String(line?.qty ?? '') !== v) onSetLine(box, item.item_id, v);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(box.items || []).map(l => {
                    const item = stock.find(s => s.item_id === l.item_id);
                    return (
                      <span key={l.id} className="px-2.5 py-1 rounded-lg text-[12px]"
                        style={{ background: C.hover, border: `1px solid ${C.line}`, color: C.muted }}>
                        {item?.emoji ? `${item.emoji} ` : ''}{item?.name || '—'} <b style={{ color: C.text }}>×{l.qty}</b>
                      </span>
                    );
                  })}
                </div>
              )}
              <p className="text-[11.5px] mt-3" style={{ color: C.faint }}>
                {k('boxTotals', '{{units}} units · {{cost}}', { units: totals.units, cost: formatCents(totals.costCents) })}
                {box.shipped_at && <> · {k('shippedOn', 'shipped {{date}}', { date: format(new Date(box.shipped_at), 'MMM d, yyyy') })}</>}
              </p>
            </div>
          </Panel>
        );
      })}
    </>
  );
}

// ── Rules ────────────────────────────────────────────────────
// Without a rule here the nightly job matches nothing and the whole automatic
// side of the feature is inert — this tab is the ignition switch.
function RulesTab({ rules, stock, gyms, k, t, onSet }) {
  const [gymId, setGymId] = useState(gyms[0]?.id || '');
  const byOccasion = useMemo(() => {
    const m = {};
    for (const r of rules) if (r.gym_id === gymId) m[r.occasion] = r;
    return m;
  }, [rules, gymId]);

  const configured = Object.keys(byOccasion).length;

  return (
    <>
      <Panel title={k('rulesTitle', 'What each gym gives, and when')}>
        <div className="px-4 py-3">
          <p className="text-[12.5px] mb-3" style={{ color: C.muted }}>
            {k('rulesHelp', 'A gift is queued the same night the member earns the occasion. Occasions the gym has switched off in its card settings never fire, so they never produce a gift either.')}
          </p>
          <select className={inputCls} style={{ ...inputSty, width: 'auto', minWidth: 220 }}
            value={gymId} onChange={e => setGymId(e.target.value)}>
            <option value="">{k('pickGym', 'Pick a gym…')}</option>
            {gyms.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
      </Panel>

      {gymId && (
        <Panel title={k('rulesFor', '{{n}} occasion(s) configured', { n: configured })}>
          {stock.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px]" style={{ color: C.faint }}>
              {k('rulesNoItems', 'Create an item first — there is nothing to give yet.')}
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: C.line }}>
              {RULE_OCCASIONS.map(occ => {
                const rule = byOccasion[occ];
                return (
                  <li key={occ} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="flex-1 text-[12.5px]" style={{ color: rule ? C.text : C.muted }}>
                      {t(`admin.printCards.occasions.${occ}`, occ)}
                    </span>
                    <select
                      className="rounded-lg px-2 py-1.5 text-[12.5px] outline-none"
                      style={{ ...inputSty, minWidth: 170 }}
                      value={rule?.item_id || ''}
                      onChange={e => onSet(gymId, occ, e.target.value)}
                    >
                      <option value="">{k('noGift', 'No gift')}</option>
                      {stock.map(i => (
                        <option key={i.item_id} value={i.item_id}>
                          {i.emoji ? `${i.emoji} ` : ''}{i.name}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
    </>
  );
}

// ── Purchases ────────────────────────────────────────────────
function PurchasesTab({ purchases, stock, itemById, k, busy, onAdd }) {
  const [form, setForm] = useState({ item_id: '', qty: '', cost: '', note: '' });

  return (
    <>
      <Panel title={k('recordPurchase', 'Record a purchase')}>
        <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-5 gap-2">
          <select className={inputCls} style={inputSty} value={form.item_id}
            onChange={e => setForm({ ...form, item_id: e.target.value })}>
            <option value="">{k('pickItem', 'Item…')}</option>
            {stock.map(i => <option key={i.item_id} value={i.item_id}>{i.name}</option>)}
          </select>
          <input className={inputCls} style={inputSty} placeholder={k('qty', 'Qty')} inputMode="numeric"
            value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} />
          <input className={inputCls} style={inputSty} placeholder={k('unitCost', 'Cost $')} inputMode="decimal"
            value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} />
          <input className={inputCls} style={inputSty} placeholder={k('note', 'Note')}
            value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
          <GoldBtn icon={Plus} disabled={busy || !form.item_id || !(Number(form.qty) > 0)}
            onClick={async () => { await onAdd(form); setForm({ item_id: '', qty: '', cost: '', note: '' }); }}>
            {k('save', 'Save')}
          </GoldBtn>
        </div>
      </Panel>

      <Panel title={k('purchaseHistory', 'History')}>
        {purchases.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12.5px]" style={{ color: C.faint }}>{k('noPurchases', 'Nothing recorded yet')}</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: C.line }}>
            {purchases.map(p => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-[12.5px]">
                <span className="flex-1 truncate" style={{ color: C.text }}>
                  {itemById[p.item_id]?.emoji ? `${itemById[p.item_id].emoji} ` : ''}
                  {itemById[p.item_id]?.name || '—'}
                  {p.note && <span style={{ color: C.faint }}> · {p.note}</span>}
                </span>
                <span className="tabular-nums" style={{ color: C.muted }}>×{p.qty}</span>
                <span className="tabular-nums" style={{ color: C.muted }}>{formatCents(p.unit_cost_cents * p.qty)}</span>
                <span style={{ color: C.faint }}>{format(new Date(p.purchased_at), 'MMM d')}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

// ── Printable box label ──────────────────────────────────────
function BoxLabelModal({ box, stock, k, onClose }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div className="swag-label w-full max-w-[380px] rounded-2xl overflow-hidden"
        style={{ background: '#fff' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2 no-print" style={{ borderBottom: '1px solid #E5E7EB' }}>
          <p className="text-[12px] font-bold" style={{ color: '#111' }}>{k('boxLabel', 'Box label')}</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-bold"
              style={{ background: '#111', color: '#fff' }}>
              <Printer size={12} />{k('print', 'Print')}
            </button>
            <button type="button" onClick={onClose} aria-label="Close" style={{ color: '#6B7280' }}><X size={16} /></button>
          </div>
        </div>
        <div className="px-6 py-6 text-center">
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#6B7280' }}>TuGymPR</p>
          <p className="font-mono text-[34px] font-extrabold leading-none mt-1" style={{ color: '#111' }}>#{box.box_code}</p>
          <p className="text-[14px] font-semibold mt-1" style={{ color: '#111' }}>{box.gyms?.name || '—'}</p>
          <div className="flex justify-center my-4">
            <QRCodeSVG value={`gym-box:${box.box_code}`} size={132} level="M" bgColor="#ffffff" fgColor="#000000" />
          </div>
          <ul className="text-left text-[12.5px]" style={{ color: '#374151' }}>
            {(box.items || []).map(l => {
              const item = stock.find(s => s.item_id === l.item_id);
              return <li key={l.id}>· {item?.name || '—'} × <b>{l.qty}</b></li>;
            })}
          </ul>
        </div>
      </div>

      {/* Print only the label. The QR encodes gym-box:<code> so a scanner can
          resolve it once that payload type is wired into scanRouter. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .swag-label, .swag-label * { visibility: visible !important; }
          .swag-label { position: absolute; left: 0; top: 0; box-shadow: none; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}
