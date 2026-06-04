import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format, formatDistanceToNow, subDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { AdminPageShell, FadeIn } from '../../components/admin';
import { TK, FK, TONE, Ico, ICON, Card } from './components/retosKit';

// ── Constants ────────────────────────────────────────────────────────────────

// One page of audit rows. Capped at 8 with prev/next pagination (server-side via
// .range + exact count) so the list stays scannable on the admin dashboard.
const PAGE_SIZE = 8;
const COLS = '1.4fr 1.3fr 1.3fr 1.3fr';

// Curated filter options — REAL action strings written by logAdminAction(...)
// across the app. Any action not listed still shows under "All" and still gets a
// sensible tone + icon from the prefix resolvers below.
const ACTION_TYPES = [
  'add_member', 'invite_member', 'change_status', 'deactivate_member', 'delete_account',
  'change_role', 'add_trainer', 'demote_trainer', 'update_settings', 'settings_cards_updated',
  'update_hours', 'create_challenge', 'create_program', 'create_class', 'create_product',
  'create_announcement', 'outreach_send', 'send_email', 'send_sms', 'award_prizes',
  'moderation', 'print_cards_marked', 'print_cards_delivered',
];

const DATE_PRESETS = [
  { key: 'today', days: 0 },
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
];

// ── Icons (from the Registro de Acciones mock + retosKit) ──────────────────────
const LIC = {
  download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 20h16" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  chevD: <path d="m6 9 6 6 6-6" />,
  chevL: <path d="m15 18-6-6 6-6" />,
  chevR: <path d="m9 18 6-6-6-6" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  pulse: <path d="M3 12h4l3 7 4-14 3 7h4" />,
  chat: <path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12Z" />,
  flag: <><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>,
  member: <><path d="M16 19a4 4 0 0 0-8 0M12 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 12 11Z" /></>,
  megaphone: <><path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1Z" /><path d="M14 8a4 4 0 0 1 0 8" /></>,
};

// entity_type → icon (fallback: box)
const ENTITY_ICON = {
  member: LIC.member, trainer: LIC.member, member_segment: ICON.users,
  activity_feed_item: LIC.pulse, feed_comment: LIC.chat, conversation: LIC.chat,
  content_report: LIC.flag,
  product: ICON.box, gym: ICON.box, gym_closure: ICON.box, platform_config: ICON.box,
  gym_card_settings: ICON.box, owner_queue_item: ICON.box, print_card: ICON.box,
  challenge: ICON.trophy, program: ICON.dumbbell, routine: ICON.dumbbell,
  class: ICON.cal, gym_class_schedule: ICON.cal,
  reward: ICON.gift, gym_email_template: ICON.mail, message_template: ICON.mail, invite: ICON.mail,
  announcement: LIC.megaphone, win_back_attempt: ICON.refresh, admin_notification_prefs: ICON.bolt,
};
const entityIcon = (et) => ENTITY_ICON[et] || ICON.box;

// Tone is resolved by PREFIX so all ~90 real action strings get a sensible
// treatment. Explicit overrides handle the ones that break the verb_noun pattern.
// (moderation → accent per the Registro de Acciones design.)
const TONE_OVERRIDES = {
  moderation: 'accent',
  block_user: 'hot', unblock_user: 'good', change_role: 'hot',
  add_trainer: 'coach', demote_trainer: 'hot', outreach_send: 'coach', gym_import: 'warn',
};

const TONE_PREFIXES = [
  ['permanently_', 'hot'], ['super_admin_delete', 'hot'], ['super_admin_schedule', 'hot'],
  ['delete_', 'hot'], ['revoke_', 'hot'], ['deactivate_', 'hot'], ['pause_', 'hot'], ['expire_', 'hot'],
  ['create_', 'good'], ['add_', 'good'], ['award_', 'good'], ['claim_', 'good'], ['redeem_', 'good'],
  ['reactivate_', 'good'], ['resolve_', 'good'],
  ['invite_', 'coach'], ['resend_', 'coach'], ['send_', 'coach'], ['bulk_', 'coach'], ['quick_', 'coach'],
  ['update_', 'warn'], ['change_', 'warn'], ['set_', 'warn'], ['save_', 'warn'], ['toggle_', 'warn'],
  ['settings_', 'warn'], ['reset_', 'warn'],
  ['print_card', 'info'], ['checkin_', 'info'], ['purchase_', 'info'], ['referral', 'info'], ['tv_', 'info'],
];

function getActionTone(action) {
  if (!action) return 'neutral';
  if (TONE_OVERRIDES[action]) return TONE_OVERRIDES[action];
  for (const [prefix, tone] of TONE_PREFIXES) {
    if (action.startsWith(prefix)) return tone;
  }
  return 'neutral';
}

// Humanize an unknown action/entity key (snake_case → "Sentence case") so the UI
// never shows a raw code when a translation happens to be missing.
function humanizeKey(key) {
  if (!key) return '—';
  const s = String(key).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ts, dateFnsLocale) {
  if (!ts) return '—';
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true, ...dateFnsLocale }); }
  catch { return '—'; }
}

function absoluteTime(ts, dateFnsLocale) {
  if (!ts) return '';
  try { return format(new Date(ts), 'MMM d, yyyy HH:mm:ss', dateFnsLocale || {}); }
  catch { return ''; }
}

function sanitizeDetailsForExport(details) {
  if (!details || typeof details !== 'object') return '';
  const sanitized = {};
  const sensitiveKeys = ['id', 'actor_id', 'entity_id', 'gym_id', 'user_id', 'member_id', 'profile_id', 'token', 'secret', 'password', 'ip_address'];
  for (const [key, value] of Object.entries(details)) {
    if (sensitiveKeys.includes(key)) continue;
    if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) continue;
    sanitized[key] = value;
  }
  return Object.keys(sanitized).length > 0 ? JSON.stringify(sanitized) : '';
}

function buildCSVRows(pages, t) {
  const rows = [];
  for (const page of pages) {
    for (const entry of page) {
      rows.push({
        date: entry.created_at ? format(new Date(entry.created_at), 'yyyy-MM-dd HH:mm:ss') : '',
        actor: entry.profiles?.full_name || t('admin.audit.unknownUser', 'Unknown user'),
        action: entry.action,
        entity_type: entry.entity_type || '',
        entity_ref: entry.entity_type && entry.entity_id ? `${entry.entity_type}#${entry.entity_id.slice(0, 6)}` : '',
        details: sanitizeDetailsForExport(entry.details),
      });
    }
  }
  return rows;
}

async function downloadCSVRows(rows) {
  if (!rows.length) return;
  const { downloadCSVString } = await import('../../lib/csvExport');
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')),
  ];
  await downloadCSVString(`audit_log_${format(new Date(), 'yyyy-MM-dd')}.csv`, lines.join('\n'));
}

// ── Presentational bits ────────────────────────────────────────────────────────

function ActionBadge({ action, label }) {
  const c = TONE[getActionTone(action)] || TONE.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '6px 14px', borderRadius: 999,
      background: c.bg, border: `1px solid ${c.line}`, fontFamily: FK.body, fontSize: 11.5, fontWeight: 800,
      letterSpacing: 0.8, textTransform: 'uppercase', color: c.ink, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function Avatar({ name, url, size = 34 }) {
  if (url) return <img src={url} alt={name || ''} style={{ width: size, height: size, borderRadius: 99, objectFit: 'cover', flexShrink: 0 }} />;
  const ch = (name || '?').trim()[0]?.toUpperCase() || '?';
  return (
    <span style={{
      width: size, height: size, borderRadius: 99, flexShrink: 0, display: 'grid', placeItems: 'center',
      background: TK.accentSoft, color: TK.accent, fontFamily: FK.display, fontSize: size * 0.41, fontWeight: 800,
    }}>{ch}</span>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AdminAuditLog() {
  const { profile } = useAuth();
  const gymId = profile?.gym_id;
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsOpts = isEs ? { locale: esLocale } : undefined;

  const [actionFilter, setActionFilter] = useState('all');
  const [datePreset, setDatePreset] = useState('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => { document.title = `${t('admin.audit.title', 'Admin - Audit Log')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  // Debounce the actor-name search so we don't fire a query per keystroke.
  // Reset to page 1 in the SAME batch as the search lands so a stale high
  // offset is never sent with the new query. (Filter changes reset inline at
  // their change sites for the same reason — see setActionFilter/preset/custom.)
  useEffect(() => {
    const id = setTimeout(() => { setDebouncedSearch(userSearch); setPage(0); }, 300);
    return () => clearTimeout(id);
  }, [userSearch]);

  const dateRange = useMemo(() => {
    if (datePreset === 'custom') {
      return {
        from: customFrom ? new Date(customFrom).toISOString() : null,
        to: customTo ? new Date(customTo + 'T23:59:59').toISOString() : null,
      };
    }
    const preset = DATE_PRESETS.find(p => p.key === datePreset);
    if (!preset) return { from: null, to: null };
    if (preset.days === 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return { from: today.toISOString(), to: null };
    }
    return { from: subDays(new Date(), preset.days).toISOString(), to: null };
  }, [datePreset, customFrom, customTo]);

  // ── Paginated query (8/page, server-side via .range + exact count) ──
  const { data, isLoading, isFetching } = useQuery({
    queryKey: [...adminKeys.auditLog.list(gymId, actionFilter, datePreset, customFrom, customTo), debouncedSearch, page],
    queryFn: async () => {
      const search = debouncedSearch.trim();
      let query = supabase
        .from('admin_audit_log')
        .select(
          'id, gym_id, actor_id, action, entity_type, entity_id, details, created_at, profiles!admin_audit_log_actor_id_fkey!inner(full_name, avatar_url)',
          { count: 'exact' },
        )
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (actionFilter !== 'all') query = query.eq('action', actionFilter);
      if (dateRange.from) query = query.gte('created_at', dateRange.from);
      if (dateRange.to) query = query.lte('created_at', dateRange.to);
      // actor_id is NOT NULL (every row has a profile) so the inner join never
      // drops rows; the ilike narrows by actor name across the WHOLE dataset.
      if (search) query = query.ilike('profiles.full_name', `%${search}%`);

      const { data: rows, count, error } = await query;
      if (error) throw error;
      return { rows: rows || [], count: count || 0 };
    },
    enabled: !!gymId,
    placeholderData: (prev) => prev,
  });

  const entries = data?.rows || [];
  const totalCount = data?.count || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);

  // Clamp if the result set shrank under the current page.
  useEffect(() => { if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1)); }, [totalPages, page]);

  const handleExport = useCallback(async () => {
    if (!gymId) return;
    const search = debouncedSearch.trim();
    const EXPORT_CAP = 5000;
    let query = supabase
      .from('admin_audit_log')
      .select('id, action, entity_type, entity_id, details, created_at, profiles!admin_audit_log_actor_id_fkey!inner(full_name, avatar_url)')
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false })
      .range(0, EXPORT_CAP - 1);
    if (actionFilter !== 'all') query = query.eq('action', actionFilter);
    if (dateRange.from) query = query.gte('created_at', dateRange.from);
    if (dateRange.to) query = query.lte('created_at', dateRange.to);
    if (search) query = query.ilike('profiles.full_name', `%${search}%`);
    const { data: rows, error } = await query;
    if (error) { console.error('Audit export failed:', error); return; }
    const csvRows = buildCSVRows([rows || []], t);
    await downloadCSVRows(csvRows);
  }, [gymId, actionFilter, dateRange, debouncedSearch, t]);

  // ── shared bits ──
  const actionLabel = (a) => t(`admin.audit.actions.${a}`, { defaultValue: humanizeKey(a) });
  const entityLabel = (e) => t(`admin.audit.entities.${e}`, { defaultValue: humanizeKey(e) });

  const goPrev = () => setPage(p => Math.max(0, p - 1));
  const goNext = () => setPage(p => Math.min(totalPages - 1, p + 1));

  // Today (local) as YYYY-MM-DD — custom range dates can't be in the future
  // (an audit log only ever has past entries).
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const rangePill = (key, label) => {
    const on = datePreset === key;
    return (
      <button key={key} type="button" onClick={() => { setDatePreset(key); setPage(0); }} style={{
        padding: '9px 16px', borderRadius: 999, cursor: 'pointer', fontFamily: FK.body, fontSize: 12.5,
        fontWeight: on ? 700 : 600, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap',
        color: on ? '#fff' : TK.textSub, background: on ? TK.accent : TK.surface, border: `1px solid ${on ? TK.accent : TK.borderSolid}`,
      }}>{label}</button>
    );
  };

  return (
    <AdminPageShell>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="admin-page-title" style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>{t('admin.audit.title')}</h1>
          <div style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, marginTop: 9 }}>{t('admin.audit.subtitle')}</div>
        </div>
        <button onClick={handleExport} disabled={!totalCount} style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 17px', borderRadius: 11, flexShrink: 0,
          cursor: totalCount ? 'pointer' : 'default', background: TK.surface, border: `1px solid ${TK.borderSolid}`, boxShadow: TK.shadow,
          fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.textSub, opacity: totalCount ? 1 : 0.5,
        }}>
          <Ico ch={LIC.download} size={16} color={TK.accent} stroke={2.1} />{t('admin.audit.exportCSV')}
        </button>
      </div>

      {/* filter bar */}
      <FadeIn>
        <Card style={{ padding: '16px 20px', marginTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
              {DATE_PRESETS.map(p => rangePill(p.key, t(`admin.audit.date.${p.key}`)))}
              {rangePill('custom', t('admin.audit.date.custom'))}
            </div>

            {/* action filter (native select, styled) */}
            <div style={{ position: 'relative' }}>
              <select
                value={actionFilter}
                onChange={e => { setActionFilter(e.target.value); setPage(0); }}
                style={{
                  appearance: 'none', WebkitAppearance: 'none', padding: '11px 38px 11px 15px', borderRadius: 11,
                  background: TK.surface, border: `1px solid ${TK.borderSolid}`, fontFamily: FK.body, fontSize: 14, fontWeight: 600,
                  color: TK.textSub, cursor: 'pointer', outline: 'none',
                }}
              >
                <option value="all">{t('admin.audit.allActions')}</option>
                {ACTION_TYPES.map(a => <option key={a} value={a}>{t(`admin.audit.actions.${a}`)}</option>)}
              </select>
              <Ico ch={LIC.chevD} size={15} color={TK.textMute} stroke={2.2} style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            </div>

            {/* user search */}
            <div style={{ flex: 1, minWidth: 180, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 15px', borderRadius: 11, background: TK.surface, border: `1px solid ${TK.borderSolid}` }}>
              <Ico ch={LIC.search} size={16} color={TK.textMute} stroke={2} />
              <input
                type="text"
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                placeholder={t('admin.audit.searchUser', { defaultValue: 'Search user…' })}
                aria-label={t('admin.audit.searchUser', { defaultValue: 'Search user…' })}
                style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontFamily: FK.body, fontSize: 14, color: TK.text }}
              />
              {userSearch && (
                <button onClick={() => setUserSearch('')} aria-label={t('admin.audit.clearSearch', { defaultValue: 'Clear search' })} style={{ display: 'grid', placeItems: 'center', cursor: 'pointer', background: 'transparent', border: 'none', padding: 0 }}>
                  <Ico ch={LIC.x} size={14} color={TK.textMute} stroke={2.2} />
                </button>
              )}
            </div>
          </div>

          {/* custom date inputs */}
          {datePreset === 'custom' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${TK.divider}` }}>
              {[['from', customFrom, setCustomFrom], ['to', customTo, setCustomTo]].map(([key, val, set]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <label style={{ fontFamily: FK.body, fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: TK.textMute }}>{t(`admin.audit.date.${key}`)}</label>
                  <input
                    type="date"
                    value={val}
                    max={key === 'from' ? (customTo || todayStr) : todayStr}
                    min={key === 'to' ? (customFrom || undefined) : undefined}
                    onChange={e => { const v = e.target.value; set(v && v > todayStr ? todayStr : v); setPage(0); }}
                    style={{ borderRadius: 10, padding: '8px 12px', fontFamily: FK.body, fontSize: 13, background: TK.surface, border: `1px solid ${TK.borderSolid}`, color: TK.text, outline: 'none' }}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>
      </FadeIn>

      {/* table */}
      <FadeIn delay={0.05}>
        {isLoading ? (
          <Card style={{ overflow: 'hidden', marginTop: 18 }}>
            {[...Array(6)].map((_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '17px 24px', borderTop: i > 0 ? `1px solid ${TK.divider}` : 'none' }}>
                <span className="animate-pulse" style={{ width: 34, height: 34, borderRadius: 99, background: TK.surface2 }} />
                <span className="animate-pulse" style={{ flex: 1, height: 14, borderRadius: 6, background: TK.surface2 }} />
                <span className="animate-pulse" style={{ width: 90, height: 22, borderRadius: 999, background: TK.surface2 }} />
              </div>
            ))}
          </Card>
        ) : entries.length === 0 ? (
          <Card style={{ marginTop: 18, padding: '60px 20px', textAlign: 'center' }}>
            <Ico ch={ICON.bar} size={30} color={TK.textFaint} stroke={1.7} style={{ margin: '0 auto 12px' }} />
            <p style={{ fontFamily: FK.body, fontSize: 14, color: TK.textMute }}>{t('admin.audit.empty')}</p>
          </Card>
        ) : (
          <>
            {/* desktop grid table */}
            <div className="hidden md:block">
            <Card style={{ overflow: 'hidden', marginTop: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '14px 24px', background: TK.surface2 }}>
                {[t('admin.audit.actor'), t('admin.audit.actionLabel'), t('admin.audit.entity'), t('admin.audit.dateColumn')].map((h, i) => (
                  <span key={i} style={{ fontFamily: FK.body, fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: TK.textFaint }}>{h}</span>
                ))}
              </div>
              {entries.map((row, i) => {
                const name = row.profiles?.full_name || t('admin.audit.unknownUser');
                return (
                  <div key={row.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '15px 24px', borderTop: i > 0 ? `1px solid ${TK.divider}` : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <Avatar name={name} url={row.profiles?.avatar_url} />
                      <span style={{ fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                    </div>
                    <div><ActionBadge action={row.action} label={actionLabel(row.action)} /></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      {row.entity_type ? (
                        <>
                          <span style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center', background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
                            <Ico ch={entityIcon(row.entity_type)} size={15} color={TK.textMute} stroke={2} />
                          </span>
                          <span style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entityLabel(row.entity_type)}</span>
                        </>
                      ) : <span style={{ fontFamily: FK.body, fontSize: 13, color: TK.textFaint }}>—</span>}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{relativeTime(row.created_at, dateFnsOpts)}</div>
                      <div style={{ fontFamily: FK.mono, fontSize: 12, color: TK.textFaint, whiteSpace: 'nowrap' }}>{absoluteTime(row.created_at, dateFnsOpts)}</div>
                    </div>
                  </div>
                );
              })}
            </Card>
            </div>

            {/* mobile card list */}
            <div className="md:hidden flex flex-col gap-2.5" style={{ marginTop: 18 }}>
              {entries.map(row => {
                const name = row.profiles?.full_name || t('admin.audit.unknownUser');
                return (
                  <Card key={row.id} style={{ padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 10 }}>
                      <Avatar name={name} url={row.profiles?.avatar_url} size={32} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: FK.body, fontSize: 14, fontWeight: 700, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                        <div style={{ fontFamily: FK.mono, fontSize: 11.5, color: TK.textFaint }}>{relativeTime(row.created_at, dateFnsOpts)}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <ActionBadge action={row.action} label={actionLabel(row.action)} />
                      {row.entity_type && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FK.body, fontSize: 12.5, color: TK.textMute }}>
                          <Ico ch={entityIcon(row.entity_type)} size={14} color={TK.textMute} stroke={2} />{entityLabel(row.entity_type)}
                        </span>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, marginTop: 24 }}>
                <button type="button" onClick={goPrev} disabled={safePage === 0 || isFetching} aria-label={t('admin.audit.prevPage', { defaultValue: 'Previous page' })} style={{
                  width: 38, height: 38, borderRadius: 99, display: 'grid', placeItems: 'center', cursor: safePage === 0 ? 'default' : 'pointer',
                  background: TK.surface, border: `1px solid ${TK.borderSolid}`, opacity: safePage === 0 ? 0.45 : 1, boxShadow: safePage === 0 ? 'none' : TK.shadow,
                }}>
                  <Ico ch={LIC.chevL} size={16} color={TK.textSub} stroke={2.2} />
                </button>
                <span style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub }}><b style={{ color: TK.text, fontWeight: 800 }}>{safePage + 1}</b> / {totalPages}</span>
                <button type="button" onClick={goNext} disabled={safePage >= totalPages - 1 || isFetching} aria-label={t('admin.audit.nextPage', { defaultValue: 'Next page' })} style={{
                  width: 38, height: 38, borderRadius: 99, display: 'grid', placeItems: 'center', cursor: safePage >= totalPages - 1 ? 'default' : 'pointer',
                  background: TK.surface, border: `1px solid ${TK.borderSolid}`, opacity: safePage >= totalPages - 1 ? 0.45 : 1, boxShadow: safePage >= totalPages - 1 ? 'none' : TK.shadow,
                }}>
                  <Ico ch={LIC.chevR} size={16} color={TK.textSub} stroke={2.2} />
                </button>
              </div>
            )}
          </>
        )}
      </FadeIn>
    </AdminPageShell>
  );
}
