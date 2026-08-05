import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { Gift, Search, Plus, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import logger from '../../../lib/logger';
import { AdminCard, AdminModal, Avatar } from '../../../components/admin';

/**
 * Gifts waiting to be handed to a member, on the gym side (mig 0682).
 *
 * The primary surface for this is the check-in toast — the front desk sees the
 * gift the moment the member scans in. This panel is the fallback for the
 * member who is already standing there without having scanned, and for clearing
 * a backlog.
 *
 * Renders nothing when there's nothing pending: an empty card on a page that
 * already has three panels is just noise.
 */
export default function PendingSwagPanel({ gymId }) {
  const { t, i18n } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const isEs = i18n.language?.startsWith('es');
  const dateLocale = isEs ? { locale: esLocale } : undefined;
  const k = (key, fallback, opts) => t(`admin.swag.${key}`, { defaultValue: fallback, ...(opts || {}) });

  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [granting, setGranting] = useState(false);

  const queryKey = ['admin', 'swag', 'pending', gymId];

  // What this gym is allowed to hand out. Comes from an RPC, not a table read:
  // swag_items is super-admin-only, and this narrow door returns id/name/emoji
  // for shipped items only — no cost, no quantities, no inventory.
  const { data: options = [] } = useQuery({
    queryKey: ['admin', 'swag', 'options', gymId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('gym_swag_options');
      if (error) { logger.warn('PendingSwagPanel: options:', error?.message); return []; }
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: grants = [] } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('swag_grants')
        .select('id, item_name, item_name_es, item_emoji, occasion, created_at, profile_id, profiles:profile_id(full_name, avatar_url)')
        .eq('gym_id', gymId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      // A gym whose DB predates 0682 errors here; treat it as "nothing pending"
      // rather than breaking the whole Print Cards page.
      if (error) { logger.warn('PendingSwagPanel: load failed:', error?.message); return []; }
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return grants;
    return grants.filter(g => (g.profiles?.full_name || '').toLowerCase().includes(q));
  }, [grants, search]);

  const deliver = async (grant) => {
    setBusyId(grant.id);
    try {
      const { data, error } = await supabase.rpc('deliver_swag_grant', {
        p_grant_id: grant.id,
        p_handler_name: profile?.full_name ?? null,
        p_note: null,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'DELIVER_FAILED');
      showToast(k('deliveredToast', 'Gift handed over'), 'success');
      queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      logger.error('PendingSwagPanel: deliver failed:', err);
      showToast(err?.message || k('deliverFailedToast', 'Could not mark it delivered'), 'error');
    }
    setBusyId(null);
  };

  // Hidden only when there is nothing pending AND nothing this gym could give.
  // Gating on `grants` alone would make the ad-hoc button unreachable exactly
  // when it's most useful — an empty queue and a member standing at the desk.
  if (grants.length === 0 && options.length === 0) return null;

  return (
    <AdminCard padding="p-0" className="mb-5">
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3"
        style={{ borderBottom: '1px solid var(--color-admin-border)' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--color-success-soft)' }}>
            <Gift size={14} style={{ color: 'var(--color-success)' }} />
          </div>
          <div>
            <p className="text-[13.5px] font-bold" style={{ color: 'var(--color-admin-text)' }}>
              {k('pendingTitle', 'Gifts to hand over')}
            </p>
            <p className="text-[11.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>
              {k('pendingCount', '{{count}} waiting', { count: grants.length })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {grants.length > 4 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
              style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)' }}>
              <Search size={13} style={{ color: 'var(--color-text-faint)' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={k('searchMember', 'Search member…')}
                className="bg-transparent outline-none text-[12.5px] w-[160px]"
                style={{ color: 'var(--color-text-primary)' }}
              />
            </div>
          )}
          {options.length > 0 && (
            <button
              type="button"
              onClick={() => setGranting(true)}
              className="admin-pill admin-pill--outline flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap"
              style={{ color: 'var(--color-success)', borderColor: 'color-mix(in srgb, var(--color-success) 25%, transparent)' }}
            >
              <Plus size={13} /> {k('giveGift', 'Give a gift')}
            </button>
          )}
        </div>
      </div>

      <ul className="divide-y" style={{ borderColor: 'var(--color-admin-border)' }}>
        {filtered.map(g => {
          const label = (isEs && g.item_name_es) ? g.item_name_es : g.item_name;
          const busy = busyId === g.id;
          return (
            <li key={g.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={g.profiles?.full_name} size="sm" src={g.profiles?.avatar_url} />
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--color-admin-text)' }}>
                  {g.profiles?.full_name || k('unknownMember', 'Unknown member')}
                </p>
                <p className="text-[11.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                  {g.item_emoji ? `${g.item_emoji} ` : ''}{label}
                  {g.occasion && <> · {t(`admin.printCards.occasions.${g.occasion}`, g.occasion)}</>}
                  {g.created_at && <> · {formatDistanceToNow(new Date(g.created_at), { addSuffix: true, ...(dateLocale || {}) })}</>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => deliver(g)}
                disabled={busy}
                className="flex-shrink-0 px-3 py-1.5 rounded-xl text-[11.5px] font-bold transition-all active:scale-95 disabled:opacity-50"
                style={{ background: 'var(--color-success)', color: '#fff' }}
              >
                {busy ? k('delivering', '…') : k('deliver', 'Handed over')}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-4 py-6 text-center text-[12.5px]" style={{ color: 'var(--color-admin-text-faint)' }}>
            {grants.length === 0
              ? k('noneWaiting', 'Nothing waiting — use "Give a gift" to hand something over now')
              : k('noMatch', 'No member by that name has a gift waiting')}
          </li>
        )}
      </ul>

      {granting && (
        <GiveGiftModal
          gymId={gymId}
          options={options}
          isEs={isEs}
          k={k}
          onClose={() => setGranting(false)}
          onGranted={() => queryClient.invalidateQueries({ queryKey })}
        />
      )}
    </AdminCard>
  );
}

/**
 * Ad-hoc gift: hand something to a member no occasion queued. Creates the grant
 * and — because the person is standing right there — offers to mark it
 * delivered in the same breath.
 */
function GiveGiftModal({ gymId, options, isEs, k, onClose, onGranted }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [memberSearch, setMemberSearch] = useState('');
  const [member, setMember] = useState(null);
  const [itemId, setItemId] = useState(options[0]?.item_id || '');
  const [saving, setSaving] = useState(false);

  // Búsqueda en el servidor: con .limit(1000) + filtro en cliente, pasados los
  // 1000 miembros no se le podía dar un regalo a nadie alfabéticamente
  // posterior al corte.
  const [memberQuery, setMemberQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setMemberQuery(memberSearch.trim()), 250);
    return () => clearTimeout(timer);
  }, [memberSearch]);

  const { data: matches = [] } = useQuery({
    queryKey: ['admin', 'swag', 'member-options', gymId, memberQuery],
    queryFn: async () => {
      const safe = memberQuery.replace(/[,()\\]/g, ' ').trim();
      if (!safe) return [];
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .eq('gym_id', gymId).eq('role', 'member').eq('imported_archived', false)
        .ilike('full_name', `%${safe}%`)
        .order('full_name').limit(6);
      if (error) { logger.warn('GiveGiftModal: members:', error?.message); return []; }
      return data || [];
    },
    enabled: !!gymId && !!memberQuery,
    staleTime: 5 * 60 * 1000,
  });

  const submit = async (alsoDeliver) => {
    if (!member || !itemId) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('admin_grant_swag', {
        p_profile_id: member.id, p_item_id: itemId, p_note: null,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'GRANT_FAILED');

      if (alsoDeliver) {
        const { data: d2, error: e2 } = await supabase.rpc('deliver_swag_grant', {
          p_grant_id: data.grant_id,
          p_handler_name: profile?.full_name ?? null,
          p_note: null,
        });
        if (e2 || !d2?.success) {
          // The grant exists either way — say so rather than implying nothing
          // happened, or the desk will hand it over and record it twice.
          showToast(k('grantedNotDelivered', 'Gift recorded, but marking it delivered failed'), 'error');
          onGranted?.(); onClose(); return;
        }
      }

      showToast(alsoDeliver ? k('deliveredToast', 'Gift handed over') : k('grantedToast', 'Gift queued'), 'success');
      onGranted?.();
      onClose();
    } catch (err) {
      logger.error('GiveGiftModal: grant failed:', err);
      const msg = err?.message === 'NOT_STOCKED'
        ? k('notStocked', "That gift hasn't been shipped to this gym")
        : (err?.message || k('grantFailed', 'Could not record the gift'));
      showToast(msg, 'error');
    }
    setSaving(false);
  };

  return (
    <AdminModal
      isOpen
      onClose={onClose}
      title={k('giveGift', 'Give a gift')}
      titleIcon={Gift}
      subtitle={k('giveGiftSub', 'For a member no occasion queued one for')}
      size="sm"
      footer={
        <div className="grid grid-cols-2 gap-2 w-full">
          <button type="button" onClick={() => submit(false)} disabled={!member || !itemId || saving}
            className="w-full px-4 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
            {k('queueOnly', 'Queue it')}
          </button>
          <button type="button" onClick={() => submit(true)} disabled={!member || !itemId || saving}
            className="w-full px-4 py-2.5 rounded-xl text-[13px] font-bold disabled:opacity-50"
            style={{ background: 'var(--color-success)', color: '#fff' }}>
            {saving ? k('delivering', '…') : k('grantAndDeliver', 'Hand it over now')}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
            {k('member', 'Member')}
          </label>
          {member ? (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
              style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)' }}>
              <Avatar name={member.full_name} size="sm" src={member.avatar_url} />
              <span className="flex-1 text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                {member.full_name}
              </span>
              <button type="button" onClick={() => { setMember(null); setMemberSearch(''); }}
                aria-label={k('clear', 'Clear')} style={{ color: 'var(--color-text-muted)' }}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)' }}>
                <Search size={14} style={{ color: 'var(--color-text-faint)' }} />
                <input type="text" value={memberSearch} onChange={e => setMemberSearch(e.target.value)}
                  placeholder={k('searchMember', 'Search member…')}
                  className="flex-1 bg-transparent outline-none text-[13px]"
                  style={{ color: 'var(--color-text-primary)' }} />
              </div>
              {matches.length > 0 && (
                <div className="mt-1 rounded-xl overflow-hidden"
                  style={{ border: '1px solid var(--color-border-subtle)' }}>
                  {matches.map(m => (
                    <button key={m.id} type="button" onClick={() => setMember(m)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[color:var(--color-admin-panel)]">
                      <Avatar name={m.full_name} size="sm" src={m.avatar_url} />
                      <span className="text-[13px] truncate" style={{ color: 'var(--color-text-primary)' }}>{m.full_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
            {k('gift', 'Gift')}
          </label>
          <select value={itemId} onChange={e => setItemId(e.target.value)}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
            style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}>
            {options.map(o => (
              <option key={o.item_id} value={o.item_id}>
                {o.emoji ? `${o.emoji} ` : ''}{(isEs && o.name_es) ? o.name_es : o.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </AdminModal>
  );
}
