import { useState, useMemo } from 'react';
import {
  KeyRound, Search, Copy, Check, Printer, Users, CheckCircle2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  PageHeader, AdminPageShell, FadeIn, AdminCard,
} from '../../components/admin';
import { selectAllRows, selectInBatches } from '../../lib/churn/batchedSelect.js';

/**
 * AdminMemberCodes
 *
 * Front-desk tool for looking up the 6-char invite code attached to an
 * imported member's pre-created profile, so staff can hand it over during
 * rollout. Lives separately from AdminMembers because the front-desk use
 * case (search by name → read code → copy) doesn't match the at-risk +
 * churn-focused member list layout.
 *
 * Source of truth for what's "imported":
 *   - `profiles.import_batch_id IS NOT NULL` AND `imported_archived = false`
 *
 * "Claimed" means the matching `gym_invites` row has a `used_by` set. We
 * join via phone since that's how the import RPC populates both sides.
 */
export default function AdminMemberCodes() {
  const { profile } = useAuth();
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const gymId = profile?.gym_id;

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('unclaimed'); // 'all' | 'unclaimed' | 'claimed'
  const [copiedCode, setCopiedCode] = useState(null);

  // Single query: imported active profiles joined with their invite codes
  // by phone. (We can't FK on profile_id directly because the import RPC
  // doesn't pre-set gym_invites.used_by — that gets set when the member
  // actually claims the code at signup. Phone is the matching key.)
  const { data, isLoading } = useQuery({
    queryKey: ['admin-member-codes', gymId],
    queryFn: async () => {
      // Imported members can be member-scale — paginate to get all rows.
      const { data: imported } = await selectAllRows((from, to) =>
        supabase
          .from('profiles')
          .select('id, full_name, phone:phone_number, membership_started_at, created_at')
          .eq('gym_id', gymId)
          .eq('imported_archived', false)
          .not('import_batch_id', 'is', null)
          .order('full_name', { ascending: true })
          .range(from, to)
      );

      const phones = (imported || []).map((p) => p.phone).filter(Boolean);
      if (phones.length === 0) return { imported: imported || [], invitesByPhone: new Map() };

      // phones array can match all imported members — batch to avoid HTTP 414.
      const { data: invites } = await selectInBatches(
        (chunk) => supabase
          .from('gym_invites')
          .select('phone, invite_code, used_by, used_at, created_at')
          .eq('gym_id', gymId)
          .in('phone', chunk),
        phones
      );

      const invitesByPhone = new Map();
      (invites || []).forEach((inv) => {
        // Prefer the most recently created invite per phone in case a
        // member somehow ended up with multiple (defensive — shouldn't
        // happen with the dup-check in bulk_import_members, but if an
        // operator runs CreateInviteModal manually after import we want
        // the latest code to win).
        const existing = invitesByPhone.get(inv.phone);
        if (!existing || inv.created_at > existing.created_at) {
          invitesByPhone.set(inv.phone, inv);
        }
      });

      return { imported: imported || [], invitesByPhone };
    },
    enabled: !!gymId,
    staleTime: 30_000,
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const { imported, invitesByPhone } = data;
    const q = search.trim().toLowerCase();

    return imported
      .map((p) => {
        const inv = p.phone ? invitesByPhone.get(p.phone) : null;
        return {
          profileId: p.id,
          name: p.full_name || '',
          phone: p.phone || '',
          email: p.email || '',
          code: inv?.invite_code || null,
          claimed: !!inv?.used_by,
          claimedAt: inv?.used_at || null,
          joinDate: p.membership_started_at || null,
        };
      })
      .filter((r) => {
        if (filter === 'unclaimed' && r.claimed) return false;
        if (filter === 'claimed' && !r.claimed) return false;
        if (!q) return true;
        return (
          r.name.toLowerCase().includes(q)
          || r.phone.includes(q)
          || (r.code && r.code.toLowerCase().includes(q))
        );
      });
  }, [data, search, filter]);

  const stats = useMemo(() => {
    if (!data) return { total: 0, claimed: 0, unclaimed: 0 };
    const { imported, invitesByPhone } = data;
    let claimed = 0;
    imported.forEach((p) => {
      const inv = p.phone ? invitesByPhone.get(p.phone) : null;
      if (inv?.used_by) claimed += 1;
    });
    return { total: imported.length, claimed, unclaimed: imported.length - claimed };
  }, [data]);

  const handleCopy = async (code) => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1600);
      showToast(t('admin.memberCodes.codeCopied', { code, defaultValue: `Code ${code} copied` }), 'success');
    } catch {
      showToast(t('admin.memberCodes.copyFailed', 'Copy failed — long-press to select'), 'error');
    }
  };

  const handlePrint = () => {
    // Window.print over a print-formatted body section. Each card holds
    // name + phone + the big 6-char code in tracking-wide mono. Designed
    // to be cut into business-card slips at the front desk.
    const instr = t('admin.memberCodes.printInstr', 'Open the app → Sign up → Use this code');
    const cardsHtml = rows.filter((r) => r.code).map((r) => `
      <div class="card">
        <div class="card-name">${escapeHtml(r.name)}</div>
        <div class="card-phone">${escapeHtml(r.phone)}</div>
        <div class="card-code">${r.code}</div>
        <div class="card-instr">${escapeHtml(instr)}</div>
      </div>
    `).join('');

    const win = window.open('', '_blank');
    if (!win) {
      showToast(t('admin.memberCodes.popupBlocked', 'Allow popups to print codes'), 'error');
      return;
    }
    win.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>${escapeHtml(t('admin.memberCodes.printTitle', 'Member codes'))}</title>
          <style>
            @page { size: letter; margin: 0.4in; }
            * { box-sizing: border-box; }
            body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 12px; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
            .card { border: 1px dashed #999; border-radius: 8px; padding: 10px 12px; min-height: 92px; page-break-inside: avoid; }
            .card-name { font-size: 13px; font-weight: 700; color: #111; }
            .card-phone { font-size: 11px; color: #666; margin-top: 1px; }
            .card-code { font-family: ui-monospace, monospace; font-size: 22px; font-weight: 800; letter-spacing: 0.18em; color: #000; margin-top: 8px; }
            .card-instr { font-size: 9px; color: #777; margin-top: 6px; }
            h1 { font-size: 14px; margin: 0 0 12px 0; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(t('admin.memberCodes.printHeading', 'Member Access Codes'))} — ${escapeHtml(profile?.full_name || 'Gym')} (${rows.filter(r => r.code).length})</h1>
          <div class="grid">${cardsHtml}</div>
          <script>window.onload = function() { window.print(); };</script>
        </body>
      </html>
    `);
    win.document.close();
  };

  return (
    <AdminPageShell>
      <FadeIn className="mb-6">
        <PageHeader
          title={t('admin.memberCodes.title', 'Member Codes')}
          subtitle={t('admin.memberCodes.subtitle', 'Imported members and their app access codes')}
          actions={
            <button
              onClick={handlePrint}
              disabled={stats.total === 0}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[12px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
            >
              <Printer size={13} />
              {t('admin.memberCodes.printSheet', 'Print codes sheet')}
            </button>
          }
        />
      </FadeIn>

      {/* Stats strip */}
      <FadeIn delay={40}>
        <div className="grid grid-cols-3 gap-2.5 md:gap-3 mb-5">
          <MiniStat label={t('admin.memberCodes.imported', 'Imported')} value={stats.total} icon={Users} />
          <MiniStat label={t('admin.memberCodes.claimed', 'Claimed')} value={stats.claimed} icon={CheckCircle2} accent="success" />
          <MiniStat label={t('admin.memberCodes.unclaimed', 'Unclaimed')} value={stats.unclaimed} icon={KeyRound} accent="warning" />
        </div>
      </FadeIn>

      {/* Filter pills */}
      <FadeIn delay={80}>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {[
            { key: 'unclaimed', label: t('admin.memberCodes.filterUnclaimed', 'Unclaimed'), count: stats.unclaimed },
            { key: 'claimed',   label: t('admin.memberCodes.filterClaimed', 'Claimed'),     count: stats.claimed   },
            { key: 'all',       label: t('admin.memberCodes.filterAll', 'All'),             count: stats.total     },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`admin-pill ${filter === tab.key ? 'admin-pill--dark' : 'admin-pill--outline'}`}
            >
              {tab.label} · {tab.count}
            </button>
          ))}
          <div className="flex-1" />
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-subtle)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('admin.memberCodes.searchPlaceholder', 'Search name, phone, or code')}
              className="rounded-xl pl-9 pr-3 py-2 text-[12.5px] w-[260px] outline-none transition-colors"
              style={{
                background: 'var(--color-bg-input, var(--color-bg-elevated))',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>
        </div>
      </FadeIn>

      {/* Empty + loading states */}
      {isLoading && (
        <AdminCard><p className="text-center text-[12px] py-6" style={{ color: 'var(--color-text-muted)' }}>{t('admin.memberCodes.loading', 'Loading…')}</p></AdminCard>
      )}

      {!isLoading && stats.total === 0 && (
        <AdminCard>
          <div className="text-center py-10">
            <div className="w-10 h-10 mx-auto rounded-xl flex items-center justify-center mb-3" style={{ background: 'var(--color-admin-panel)' }}>
              <KeyRound size={18} style={{ color: 'var(--color-text-subtle)' }} />
            </div>
            <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('admin.memberCodes.emptyTitle', 'No imported members')}</p>
            <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.memberCodes.emptyDesc', 'This page populates after the platform runs a CSV import for your gym.')}</p>
          </div>
        </AdminCard>
      )}

      {!isLoading && stats.total > 0 && rows.length === 0 && (
        <AdminCard>
          <p className="text-center py-8 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.memberCodes.noMatches', 'No matches.')}</p>
        </AdminCard>
      )}

      {!isLoading && rows.length > 0 && (
        <FadeIn delay={120}>
          <AdminCard padding="p-0">
            <ul className="divide-y" style={{ borderColor: 'var(--color-admin-border)' }}>
              {rows.map((r) => (
                <li key={r.profileId} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{r.name || '—'}</p>
                      {r.claimed ? (
                        <span className="admin-pill admin-pill--success text-[10px]" style={{ padding: '1px 6px' }}>
                          {t('admin.memberCodes.claimed', 'Claimed')}
                        </span>
                      ) : (
                        <span className="admin-pill admin-pill--warning text-[10px]" style={{ padding: '1px 6px' }}>
                          {t('admin.memberCodes.unclaimed', 'Unclaimed')}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>{r.phone || '—'}</p>
                  </div>

                  {r.code ? (
                    <button
                      onClick={() => handleCopy(r.code)}
                      title={t('admin.memberCodes.tapToCopy', 'Tap to copy')}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono font-bold tracking-[0.18em] transition-colors"
                      style={{
                        background: copiedCode === r.code
                          ? 'color-mix(in srgb, var(--color-success) 14%, transparent)'
                          : 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
                        color: copiedCode === r.code ? 'var(--color-success)' : 'var(--color-accent)',
                        border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)',
                      }}
                    >
                      {copiedCode === r.code ? <Check size={12} /> : <Copy size={12} />}
                      <span className="text-[13px]">{r.code}</span>
                    </button>
                  ) : (
                    <span className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{t('admin.memberCodes.noCode', 'No code')}</span>
                  )}
                </li>
              ))}
            </ul>
          </AdminCard>
        </FadeIn>
      )}
    </AdminPageShell>
  );
}

// ── Helpers ────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/[<]/g, '&lt;')
    .replace(/[>]/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function MiniStat({ label, value, icon: Icon, accent }) {
  const color = accent === 'success' ? 'var(--color-success)'
              : accent === 'warning' ? 'var(--color-warning)'
              : 'var(--color-text-muted)';
  return (
    <div className="admin-card p-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
        {Icon && <Icon size={15} style={{ color }} />}
      </div>
      <div className="min-w-0">
        <p className="admin-eyebrow" style={{ fontSize: '10.5px' }}>{label}</p>
        <p className="text-[20px] font-extrabold tabular-nums leading-none mt-0.5" style={{ color: 'var(--color-text-primary)' }}>{value}</p>
      </div>
    </div>
  );
}
