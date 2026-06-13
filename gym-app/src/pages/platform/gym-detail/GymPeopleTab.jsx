import { useState, useMemo } from 'react';
import { Search, UserPlus, Trash2, Copy, X, Plus, ChevronLeft, ChevronRight, KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format, formatDistanceToNow } from 'date-fns';
import RoleBadge from './RoleBadge';
import StatusBadge from './StatusBadge';
import UserAvatar from '../../../components/UserAvatar';

const ROLE_OPTIONS = ['member', 'trainer', 'admin'];
const STATUS_ACTIONS = ['active', 'deactivated', 'banned'];
const PAGE_SIZE = 50;

// Rows holding super_admin (primary OR additional_roles) are read-only here —
// this is what stops the founder one-click self-demoting out of the platform
// tier, and stops role edits on any other platform staff (audit P2-3).
const isSuperAdminRow = (m) =>
  m.role === 'super_admin' || (m.additional_roles ?? []).includes('super_admin');

const isStaff = (m) =>
  m.role === 'admin' || m.role === 'trainer' || m.role === 'super_admin' ||
  (m.additional_roles ?? []).some(r => r === 'admin' || r === 'trainer' || r === 'super_admin');

export default function GymPeopleTab({
  members,
  invites,
  updateMemberRole,
  updateMemberStatus,
  deleteMember,
  setShowAddMemberModal,
  createInvite,
  revokeInvite,
  copyInviteCode,
}) {
  const { t } = useTranslation('pages');
  const [peopleSubTab, setPeopleSubTab] = useState('members');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'member' });
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteError, setInviteError] = useState('');

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return members;
    const q = search.toLowerCase();
    return members.filter(m =>
      (m.full_name ?? '').toLowerCase().includes(q) ||
      (m.username ?? '').toLowerCase().includes(q) ||
      (m.role ?? '').toLowerCase().includes(q)
    );
  }, [members, search]);

  // Simple client-side pagination — the list was previously unbounded.
  const pageCount = Math.max(1, Math.ceil(filteredMembers.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedMembers = useMemo(
    () => filteredMembers.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [filteredMembers, safePage]
  );

  const staffList = useMemo(() => members.filter(isStaff), [members]);

  const handleCreateInvite = async (e) => {
    e.preventDefault();
    setInviteError('');
    setInviteSaving(true);
    const err = await createInvite({ email: inviteForm.email, role: inviteForm.role });
    setInviteSaving(false);
    if (err) { setInviteError(err); return; }
    setInviteForm({ email: '', role: 'member' });
    setShowInviteForm(false);
  };

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex gap-1 mb-4">
        {[
          { key: 'members', label: t('platform.gymDetail.people.membersTab', { count: members.length }) },
          { key: 'staff', label: t('platform.gymDetail.people.staffTab', { count: staffList.length }) },
          { key: 'invites', label: t('platform.gymDetail.people.invitesTab', { count: invites.length }) },
        ].map(st => (
          <button
            key={st.key}
            onClick={() => setPeopleSubTab(st.key)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
              peopleSubTab === st.key ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'text-[#6B7280] hover:text-[#9CA3AF] bg-white/[0.02]'
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      {peopleSubTab === 'members' && (
        <div>
          {/* Header + Add button */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4B5563]" />
              <input
                type="text"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0); }}
                placeholder={t('platform.gymDetail.people.searchPlaceholder')}
                aria-label={t('platform.gymDetail.people.searchAria')}
                className="w-full bg-[#111827] border border-white/6 rounded-lg pl-9 pr-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
              />
            </div>
            <button
              onClick={() => setShowAddMemberModal(true)}
              className="flex items-center gap-1.5 bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" />
              {t('platform.gymDetail.people.addMember')}
            </button>
          </div>

          {/* Members list */}
          <div className="bg-[#0F172A] border border-white/6 rounded-xl overflow-hidden">
            {/* Desktop header */}
            <div className="hidden md:grid md:grid-cols-[1fr_120px_100px_120px_120px_100px_100px_40px] gap-3 px-4 py-3 border-b border-white/6 text-[11px] text-[#6B7280] font-medium uppercase tracking-wider">
              <span>{t('platform.gymDetail.columns.name')}</span>
              <span>{t('platform.gymDetail.columns.username')}</span>
              <span>{t('platform.gymDetail.columns.role')}</span>
              <span>{t('platform.gymDetail.columns.joined')}</span>
              <span>{t('platform.gymDetail.columns.lastActive')}</span>
              <span>{t('platform.gymDetail.columns.status')}</span>
              <span>{t('platform.gymDetail.columns.actions')}</span>
              <span></span>
            </div>

            {pagedMembers.length === 0 && (
              <div className="py-12 text-center text-[#6B7280] text-sm">{t('platform.gymDetail.people.noMembersFound')}</div>
            )}

            {pagedMembers.map(m => {
              const locked = isSuperAdminRow(m);
              return (
                <div
                  key={m.id}
                  className="grid grid-cols-1 md:grid-cols-[1fr_120px_100px_120px_120px_100px_100px_40px] gap-2 md:gap-3 px-4 py-3 border-b border-white/6 last:border-0 hover:bg-white/[0.02] transition-colors"
                >
                  {/* Name */}
                  <div className="flex items-center gap-2 min-w-0">
                    <UserAvatar user={m} size={28} />
                    <span className="text-[13px] text-[#E5E7EB] truncate">{m.full_name ?? t('platform.gymDetail.people.unknown')}</span>
                  </div>

                  {/* Username */}
                  <div className="flex items-center">
                    <span className="text-[12px] text-[#6B7280] font-mono truncate">@{m.username ?? '—'}</span>
                  </div>

                  {/* Role — read-only badge for super_admin rows */}
                  <div className="flex items-center">
                    {locked ? (
                      <RoleBadge role="super_admin" />
                    ) : (
                      <select
                        value={m.role ?? 'member'}
                        onChange={e => updateMemberRole(m, e.target.value)}
                        aria-label={t('platform.gymDetail.people.memberRoleAria')}
                        className="bg-[#111827] border border-white/6 rounded px-1.5 py-0.5 text-[11px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer"
                      >
                        {ROLE_OPTIONS.map(r => (
                          <option key={r} value={r}>{t(`platform.gymDetail.roles.${r}`)}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Joined */}
                  <div className="flex items-center">
                    <span className="text-[12px] text-[#6B7280]">
                      {m.created_at ? format(new Date(m.created_at), 'MMM d, yyyy') : '—'}
                    </span>
                  </div>

                  {/* Last active */}
                  <div className="flex items-center">
                    <span className="text-[12px] text-[#6B7280]">
                      {m.last_active_at ? formatDistanceToNow(new Date(m.last_active_at), { addSuffix: true }) : t('platform.gymDetail.people.never')}
                    </span>
                  </div>

                  {/* Status */}
                  <div className="flex items-center">
                    <StatusBadge status={m.membership_status ?? 'active'} />
                  </div>

                  {/* Status actions */}
                  <div className="flex items-center">
                    {!locked && (
                      <select
                        value={m.membership_status ?? 'active'}
                        onChange={e => updateMemberStatus(m, e.target.value)}
                        aria-label={t('platform.gymDetail.people.memberStatusAria')}
                        className="bg-[#111827] border border-white/6 rounded px-1.5 py-0.5 text-[11px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer"
                      >
                        {STATUS_ACTIONS.map(s => (
                          <option key={s} value={s}>{t(`platform.gymDetail.statuses.${s}`)}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Delete */}
                  <div className="flex items-center justify-center">
                    {!locked && (
                      <button
                        onClick={() => deleteMember(m)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#4B5563] hover:text-red-400 transition-colors"
                        title={t('platform.gymDetail.people.deleteMemberAria')}
                        aria-label={t('platform.gymDetail.people.deleteMemberAria')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-2">
            <p className="text-[11px] text-[#6B7280]">
              {t('platform.gymDetail.people.showingOf', { filtered: pagedMembers.length, total: filteredMembers.length })}
            </p>
            {pageCount > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  aria-label={t('platform.gymDetail.people.prevPage', 'Previous page')}
                  className="p-1.5 rounded-lg border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/[0.03] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] text-[#6B7280] font-mono tabular-nums">{safePage + 1} / {pageCount}</span>
                <button
                  onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                  disabled={safePage >= pageCount - 1}
                  aria-label={t('platform.gymDetail.people.nextPage', 'Next page')}
                  className="p-1.5 rounded-lg border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/[0.03] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Staff sub-tab */}
      {peopleSubTab === 'staff' && (
        <div className="space-y-2">
          {staffList.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-8 text-center">
              <p className="text-[13px] text-[#6B7280]">{t('platform.gymDetail.people.noStaff')}</p>
            </div>
          ) : (
            staffList.map(m => (
              <div key={m.id} className="bg-[#0F172A] border border-white/6 rounded-xl px-4 py-3 flex items-center gap-3">
                <UserAvatar user={m} size={36} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{m.full_name || m.username}</p>
                  <p className="text-[11px] text-[#6B7280]">@{m.username}</p>
                </div>
                <RoleBadge role={m.role} />
                <StatusBadge status={m.membership_status || 'active'} />
              </div>
            ))
          )}
        </div>
      )}

      {/* Invites sub-tab — create / copy / revoke (P0-1d) */}
      {peopleSubTab === 'invites' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-[#6B7280]">
              {t('platform.gymDetail.invites.subtitle', 'Codes members and the owner enter at signup. Expire after 30 days.')}
            </p>
            <button
              onClick={() => { setShowInviteForm(v => !v); setInviteError(''); }}
              className="flex items-center gap-1.5 bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-3.5 py-2 text-[12px] font-semibold transition-colors whitespace-nowrap"
            >
              {showInviteForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              {showInviteForm ? t('platform.gymDetail.invites.cancelNew', 'Cancel') : t('platform.gymDetail.invites.newInvite', 'New invite')}
            </button>
          </div>

          {showInviteForm && (
            <form onSubmit={handleCreateInvite} className="bg-[#0F172A] border border-[#D4AF37]/20 rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.invites.emailOptional', 'Email (optional)')}</label>
                  <input
                    type="email"
                    value={inviteForm.email}
                    onChange={e => setInviteForm(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="owner@gym.com"
                    className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.roleLabel', 'Role')}</label>
                  <select
                    value={inviteForm.role}
                    onChange={e => setInviteForm(prev => ({ ...prev, role: e.target.value }))}
                    className="bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer"
                  >
                    {/* gym_invites.role CHECK only allows member/trainer (0022); claims force member anyway (0198) */}
                    <option value="member">{t('platform.gymDetail.roles.member', 'Member')}</option>
                    <option value="trainer">{t('platform.gymDetail.roles.trainer', 'Trainer')}</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={inviteSaving}
                    className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {inviteSaving ? t('platform.gymDetail.modals.creating', 'Creating...') : t('platform.gymDetail.invites.createBtn', 'Create invite')}
                  </button>
                </div>
              </div>
              {inviteError && <p className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{inviteError}</p>}
            </form>
          )}

          {invites.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-8 text-center">
              <p className="text-[13px] text-[#6B7280]">{t('platform.gymDetail.people.noInvites')}</p>
            </div>
          ) : (
            invites.map(inv => {
              const isExpired = inv.expires_at && new Date(inv.expires_at) < new Date();
              const isUsed = !!inv.used_at;
              const code = inv.invite_code ?? inv.token;
              return (
                <div key={inv.id} className="bg-[#0F172A] border border-white/6 rounded-xl px-4 py-3 flex items-center gap-3">
                  <KeyRound className="w-4 h-4 text-[#D4AF37]/60 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-semibold font-mono ${inv.invite_code ? 'tracking-[0.15em] text-[#E5E7EB]' : 'text-[#9CA3AF] truncate'}`}>{code}</p>
                    <p className="text-[11px] text-[#6B7280] truncate">
                      {t('platform.gymDetail.people.inviteRole', { role: inv.role || 'member' })}
                      {inv.email ? ` · ${inv.email}` : ''}
                      {inv.expires_at && !isUsed ? ` · ${t('platform.gymDetail.settings.expires', { date: format(new Date(inv.expires_at), 'MMM d, yyyy') })}` : ''}
                    </p>
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                    isUsed ? 'bg-emerald-500/15 text-emerald-400' : isExpired ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'
                  }`}>
                    {isUsed ? t('platform.gymDetail.people.claimed') : isExpired ? t('platform.gymDetail.people.expired') : t('platform.gymDetail.people.pending')}
                  </span>
                  {!isUsed && (
                    <>
                      <button
                        onClick={() => copyInviteCode(inv)}
                        className="p-1.5 rounded-lg hover:bg-white/6 text-[#6B7280] hover:text-[#E5E7EB] transition-colors flex-shrink-0"
                        title={t('platform.gymDetail.invites.copyAria', 'Copy invite code')}
                        aria-label={t('platform.gymDetail.invites.copyAria', 'Copy invite code')}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => revokeInvite(inv)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors flex-shrink-0"
                        title={t('platform.gymDetail.invites.revokeAria', 'Revoke invite')}
                        aria-label={t('platform.gymDetail.invites.revokeAria', 'Revoke invite')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
