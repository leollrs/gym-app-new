import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import {
  UserPlus, Phone, Mail, Gift, Check, X, Pencil, ArrowRight, Users, AlertTriangle,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import logger from '../../../lib/logger';
import { logAdminAction } from '../../../lib/adminAudit';
import { Avatar, FilterBar } from '../../../components/admin';
import AdminPagination from '../../../components/admin/AdminPagination';
import { prospectFollowUpTier } from '../../../lib/admin/memberQueries';

const PAGE_SIZE = 8;

// Same CSS variables StatusBadge's TONE_VARS uses (that map isn't exported).
// A prospect's pipeline stage is NOT a membership status, so StatusBadge itself
// can't be reused — it's keyed to active/frozen/cancelled and would look up
// `admin.statusLabels.<status>`, which has no entry for these.
const TONE = {
  info:    { bg: 'var(--color-info-soft)',    fg: 'var(--color-info)' },
  warn:    { bg: 'var(--color-warning-soft)', fg: 'var(--color-warning-ink)' },
  good:    { bg: 'var(--color-success-soft)', fg: 'var(--color-success-ink)' },
  hot:     { bg: 'var(--color-danger-soft)',  fg: 'var(--color-danger-ink)' },
  neutral: { bg: 'var(--color-admin-panel)',  fg: 'var(--color-admin-text-sub)' },
};

const STATUS_TONE = {
  new: 'info', contacted: 'warn', converted: 'good', lost: 'neutral',
};

// Only 'cold' earns a pill. Flagging every fresh prospect would make the tab
// read as all-urgent, which is exactly what made the churn queue unusable.
const FOLLOWUP_TONE = { cold: 'hot', warm: 'warn', fresh: null };

function Pill({ tone = 'neutral', children }) {
  const c = TONE[tone] || TONE.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 999,
      background: c.bg, color: c.fg, fontSize: 10, fontWeight: 800,
      letterSpacing: 0.4, textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function RowAction({ icon, label, onClick, disabled = false, danger = false, primary = false }) {
  // Bound as a variable, not destructured straight to `Icon`: this config
  // doesn't credit JSX-only usage, and its ignore pattern (^[A-Z_]) exempts
  // capitalised vars but not args — same shape the other admin components use.
  const Icon = icon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-colors disabled:opacity-45"
      style={{
        background: primary ? 'var(--color-accent)' : danger ? 'var(--color-danger-soft)' : 'var(--color-bg-hover)',
        color: primary ? 'var(--color-text-on-accent, #fff)' : danger ? 'var(--color-danger)' : 'var(--color-admin-text-muted)',
        border: `1px solid ${primary ? 'var(--color-accent)' : danger ? 'color-mix(in srgb, var(--color-danger) 20%, transparent)' : 'var(--color-admin-border)'}`,
      }}
    >
      <Icon size={12} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/**
 * Prospects tab — walk-ins, free-first-class guests and members' guests, the
 * step of the funnel before an invite exists. Converting one hands off to
 * CreateInviteModal (prefilled) via `onConvert`, which is also where the
 * referral gets attributed to whoever brought them.
 */
export default function ProspectsTab({
  prospects = [],
  isLoading = false,
  // "No hay ninguno" y "no se pudo cargar" significan lo contrario y se
  // dibujaban idénticos. Swag.jsx ya lo distinguía; esta pestaña no.
  isError = false,
  refetch,
  onConvert,
  onEdit,
  onAdd,
  dateFnsLocale,
}) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const [filter, setFilter] = useState('open');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);

  // A returning prospect reads their code off their phone and the desk types
  // it. That second (or third) visit is the strongest conversion signal the gym
  // has, and before this nothing anywhere recorded it.
  const markVisitByCode = async () => {
    const entered = code.trim();
    if (!entered) return;
    setChecking(true);
    try {
      const { data: found, error } = await supabase.rpc('lookup_prospect_by_code', { p_code: entered });
      if (error) throw error;
      if (!found?.success) {
        showToast(k('codeNotFound', 'No prospect with that code'), 'error');
        setChecking(false);
        return;
      }
      const { data: visit, error: vErr } = await supabase.rpc('record_prospect_visit', { p_prospect_id: found.id });
      if (vErr) throw vErr;
      if (visit?.duplicate) {
        showToast(k('visitAlready', '{{name}} was already marked in the last few hours', { name: visit.full_name }), 'info');
      } else {
        showToast(k('visitRecorded', '{{name}} — visit {{n}}', { name: visit.full_name, n: visit.visit_count }), 'success');
      }
      setCode('');
      refetch?.();
    } catch (err) {
      logger.error('ProspectsTab: visit by code failed:', err);
      showToast(err?.message || k('codeFailed', 'Could not record the visit'), 'error');
    }
    setChecking(false);
  };

  const k = (key, fallback, opts) => t(`admin.prospects.${key}`, { defaultValue: fallback, ...(opts || {}) });

  const counts = useMemo(() => {
    const c = { all: prospects.length, open: 0, converted: 0, lost: 0 };
    prospects.forEach(p => {
      if (p.status === 'converted') c.converted++;
      else if (p.status === 'lost') c.lost++;
      else c.open++;
    });
    return c;
  }, [prospects]);

  const filtered = useMemo(() => {
    if (filter === 'all') return prospects;
    if (filter === 'open') return prospects.filter(p => p.status === 'new' || p.status === 'contacted');
    return prospects.filter(p => p.status === filter);
  }, [prospects, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const filterOptions = [
    { key: 'open', label: k('filterOpen', 'Open'), count: counts.open },
    { key: 'converted', label: k('filterConverted', 'Converted'), count: counts.converted },
    { key: 'lost', label: k('filterLost', 'Lost'), count: counts.lost },
    { key: 'all', label: k('filterAll', 'All'), count: counts.all },
  ];

  const setStatus = async (prospect, status, extra = {}) => {
    setBusyId(prospect.id);
    try {
      // .select('id'): un update que no matcha NINGUNA fila resuelve con
      // error:null, así que un desajuste de RLS o de gym_id daba el toast de
      // "Prospecto actualizado" y la fila volvía a su estado anterior al
      // refrescar.
      const { data, error } = await supabase
        .from('gym_prospects')
        .update({ status, ...extra })
        .eq('id', prospect.id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('no rows matched');
      logAdminAction('update_prospect', 'prospect', prospect.id, { status });
      showToast(k('savedToast', 'Prospect updated'), 'success');
      refetch?.();
    } catch (err) {
      logger.error('ProspectsTab: status update failed:', err);
      showToast(err?.message || k('saveFailedToast', 'Could not update prospect'), 'error');
    }
    setBusyId(null);
  };

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <FilterBar
          options={filterOptions}
          active={filter}
          onChange={(key) => { setFilter(key); setPage(1); }}
        />
        <div className="flex items-center gap-2 flex-wrap">
          {/* "They came back" — the whole reason the code exists. */}
          <div className="flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-xl"
            style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)' }}>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') markVisitByCode(); }}
              placeholder={k('codePlaceholder', 'Code')}
              maxLength={8}
              className="bg-transparent outline-none text-[12.5px] font-mono tracking-widest w-[86px]"
              style={{ color: 'var(--color-text-primary)' }}
            />
            <button
              type="button"
              onClick={markVisitByCode}
              disabled={!code.trim() || checking}
              className="px-2.5 py-1.5 rounded-lg text-[11.5px] font-bold disabled:opacity-45"
              style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #fff)' }}
            >
              {checking ? '…' : k('markVisit', 'Visit')}
            </button>
          </div>
          <button
            type="button"
            onClick={onAdd}
            className="admin-pill admin-pill--dark flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap"
          >
            <UserPlus size={13} /> {k('addProspect', 'New prospect')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-[14px] overflow-hidden" style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
          {[0, 1, 2].map(i => (
            <div key={i} className="h-[76px] animate-pulse" style={{ borderBottom: '1px solid var(--color-border-subtle)', background: 'var(--color-admin-panel)' }} />
          ))}
        </div>
      ) : isError ? (
        <div className="text-center py-16">
          <AlertTriangle size={28} className="mx-auto mb-3" style={{ color: 'var(--color-danger)' }} />
          <p className="text-[14px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
            {k('loadFailed', "Couldn't load prospects")}
          </p>
          <button
            type="button"
            onClick={() => refetch?.()}
            className="mt-3 px-4 py-2 rounded-[10px] text-[12.5px] font-bold"
            style={{ background: 'var(--color-bg-hover)', color: 'var(--color-admin-text)', border: '1px solid var(--color-admin-border)' }}>
            {k('retry', 'Try again')}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Users size={28} className="mx-auto mb-3" style={{ color: 'var(--color-text-faint)' }} />
          <p className="text-[14px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
            {filter === 'open' ? k('emptyOpen', 'No prospects waiting on you') : k('empty', 'No prospects yet')}
          </p>
          <p className="text-[12px] mt-1.5 max-w-sm mx-auto" style={{ color: 'var(--color-text-faint)' }}>
            {k('emptyHint', 'Log the people who come in for a free class or as a member\'s guest. They convert better than any ad.')}
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-[14px] overflow-hidden"
            style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
            <div className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
              {pageItems.map(p => {
                const tier = prospectFollowUpTier(p);
                const tierTone = tier ? FOLLOWUP_TONE[tier] : null;
                const busy = busyId === p.id;
                const resolved = p.status === 'converted' || p.status === 'lost';
                return (
                  <div key={p.id} className="w-full flex items-start gap-3 px-4 py-3.5 hover:bg-white/[0.03] transition-colors">
                    <Avatar name={p.full_name} size="sm" />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-admin-text)' }}>
                          {p.full_name}
                        </p>
                        <Pill tone={STATUS_TONE[p.status] || 'neutral'}>
                          {k(`status.${p.status}`, p.status)}
                        </Pill>
                        {tierTone && (
                          <Pill tone={tierTone}>{k(`followUp.${tier}`, tier)}</Pill>
                        )}
                        {/* Repeat visits outrank everything else on this row.
                            Someone on their third free class is the best lead
                            in the building. */}
                        {p.visit_count > 1 && (
                          <Pill tone="good">{k('visitCount', '{{n}} visits', { n: p.visit_count })}</Pill>
                        )}
                        {p.unreachable_at && (
                          <Pill tone="hot">{k('unreachable', 'Unreachable')}</Pill>
                        )}
                      </div>

                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-admin-text-muted)' }}>
                        <span>{k(`source.${p.source}`, p.source)}</span>
                        {p.phone && <span className="inline-flex items-center gap-0.5 ml-2"><Phone size={9} /> {p.phone}</span>}
                        {p.email && <span className="inline-flex items-center gap-0.5 ml-2"><Mail size={9} /> {p.email}</span>}
                        {p.visited_at && (
                          <span className="ml-2">
                            · {formatDistanceToNow(new Date(p.visited_at), { addSuffix: true, ...(dateFnsLocale || {}) })}
                          </span>
                        )}
                      </p>

                      {/* The referral hook. Naming who brought them is the whole
                          reason this row exists — it's what gets credited on
                          conversion. */}
                      {p.referrer?.full_name && (
                        <p className="text-[11px] mt-1 inline-flex items-center gap-1" style={{ color: 'var(--color-accent)' }}>
                          <Gift size={10} />
                          {k('broughtBy', 'Brought by {{name}}', { name: p.referrer.full_name })}
                        </p>
                      )}

                      {p.status === 'lost' && p.lost_reason && (
                        <p className="text-[11px] mt-1" style={{ color: 'var(--color-admin-text-faint)' }}>
                          {p.lost_reason}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                      {!resolved && (
                        <>
                          {p.status === 'new' && (
                            <RowAction icon={Check} label={k('markContacted', 'Contacted')} disabled={busy}
                              onClick={() => setStatus(p, 'contacted')} />
                          )}
                          <RowAction icon={Pencil} label={k('edit', 'Edit')} disabled={busy}
                            onClick={() => onEdit?.(p)} />
                          <RowAction icon={X} label={k('markLost', 'Lost')} danger disabled={busy}
                            onClick={() => setStatus(p, 'lost')} />
                          <RowAction icon={ArrowRight} label={k('convert', 'Convert')} primary disabled={busy}
                            onClick={() => onConvert?.(p)} />
                        </>
                      )}
                      {p.status === 'lost' && (
                        <RowAction icon={ArrowRight} label={k('reopen', 'Reopen')} disabled={busy}
                          onClick={() => setStatus(p, 'new', { lost_reason: null })} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <AdminPagination
            page={safePage}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onPageChange={setPage}
            className="mt-3"
          />
        </>
      )}
    </div>
  );
}
