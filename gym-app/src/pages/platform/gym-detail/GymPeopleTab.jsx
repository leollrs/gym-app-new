import { useState, useMemo } from 'react';
import { Search, UserPlus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format, formatDistanceToNow } from 'date-fns';
import RoleBadge from './RoleBadge';
import StatusBadge from './StatusBadge';
import UserAvatar from '../../../components/UserAvatar';

const ROLE_OPTIONS = ['member', 'trainer', 'admin'];
const STATUS_ACTIONS = ['active', 'deactivated', 'banned'];

export default function GymPeopleTab({
  members,
  invites,
  updateMemberRole,
  updateMemberStatus,
  deleteMember,
  setShowAddMemberModal,
}) {
  const { t } = useTranslation('pages');
  const [peopleSubTab, setPeopleSubTab] = useState('members');
  const [search, setSearch] = useState('');

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return members;
    const q = search.toLowerCase();
    return members.filter(m =>
      (m.full_name ?? '').toLowerCase().includes(q) ||
      (m.username ?? '').toLowerCase().includes(q) ||
      (m.role ?? '').toLowerCase().includes(q)
    );
  }, [members, search]);

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex gap-1 mb-4">
        {[
          { key: 'members', label: `Members (${members.length})` },
          { key: 'staff', label: `Staff (${members.filter(m => m.role === 'admin' || m.role === 'trainer').length})` },
          { key: 'invites', label: `Invites (${invites.length})` },
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
                onChange={e => setSearch(e.target.value)}
                placeholder="Search members..."
                aria-label="Search members"
                className="w-full bg-[#111827] border border-white/6 rounded-lg pl-9 pr-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
              />
            </div>
            <button
              onClick={() => setShowAddMemberModal(true)}
              className="flex items-center gap-1.5 bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Add Member
            </button>
          </div>

          {/* Members list */}
          <div className="bg-[#0F172A] border border-white/6 rounded-xl overflow-hidden">
            {/* Desktop header */}
            <div className="hidden md:grid md:grid-cols-[1fr_120px_100px_120px_120px_100px_100px_40px] gap-3 px-4 py-3 border-b border-white/6 text-[11px] text-[#6B7280] font-medium uppercase tracking-wider">
              <span>Name</span>
              <span>Username</span>
              <span>Role</span>
              <span>Joined</span>
              <span>Last Active</span>
              <span>Status</span>
              <span>Actions</span>
              <span></span>
            </div>

            {filteredMembers.length === 0 && (
              <div className="py-12 text-center text-[#6B7280] text-sm">No members found.</div>
            )}

            {filteredMembers.map(m => (
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
                  <span className="text-[12px] text-[#6B7280] font-mono truncate">@{m.username ?? '\u2014'}</span>
                </div>

                {/* Role dropdown */}
                <div className="flex items-center">
                  <select
                    value={m.role ?? 'member'}
                    onChange={e => updateMemberRole(m.id, e.target.value)}
                    aria-label="Member role"
                    className="bg-[#111827] border border-white/6 rounded px-1.5 py-0.5 text-[11px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer"
                  >
                    {ROLE_OPTIONS.map(r => (
                      <option key={r} value={r}>{t(`platform.gymDetail.roles.${r}`)}</option>
                    ))}
                  </select>
                </div>

                {/* Joined */}
                <div className="flex items-center">
                  <span className="text-[12px] text-[#6B7280]">
                    {m.created_at ? format(new Date(m.created_at), 'MMM d, yyyy') : '\u2014'}
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
                  <select
                    value={m.membership_status ?? 'active'}
                    onChange={e => updateMemberStatus(m.id, e.target.value)}
                    aria-label="Member status"
                    className="bg-[#111827] border border-white/6 rounded px-1.5 py-0.5 text-[11px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer"
                  >
                    {STATUS_ACTIONS.map(s => (
                      <option key={s} value={s}>{t(`platform.gymDetail.statuses.${s}`)}</option>
                    ))}
                  </select>
                </div>

                {/* Delete */}
                <div className="flex items-center justify-center">
                  <button
                    onClick={() => deleteMember(m)}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#4B5563] hover:text-red-400 transition-colors"
                    title="Delete member"
                    aria-label="Delete member"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-[#6B7280] mt-2">
            Showing {filteredMembers.length} of {members.length} members
          </p>
        </div>
      )}

      {/* Staff sub-tab */}
      {peopleSubTab === 'staff' && (
        <div className="space-y-2">
          {members.filter(m => m.role === 'admin' || m.role === 'trainer' || m.role === 'super_admin').length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-8 text-center">
              <p className="text-[13px] text-[#6B7280]">No staff members</p>
            </div>
          ) : (
            members.filter(m => m.role === 'admin' || m.role === 'trainer' || m.role === 'super_admin').map(m => (
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

      {/* Invites sub-tab */}
      {peopleSubTab === 'invites' && (
        <div className="space-y-2">
          {invites.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl p-8 text-center">
              <p className="text-[13px] text-[#6B7280]">No invites</p>
            </div>
          ) : (
            invites.map(inv => {
              const isExpired = inv.expires_at && new Date(inv.expires_at) < new Date();
              return (
                <div key={inv.id} className="bg-[#0F172A] border border-white/6 rounded-xl px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[#E5E7EB] font-mono">{inv.code}</p>
                    <p className="text-[11px] text-[#6B7280]">Role: {inv.role || 'member'}</p>
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    inv.is_used ? 'bg-emerald-500/15 text-emerald-400' : isExpired ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'
                  }`}>
                    {inv.is_used ? t('platform.gymDetail.people.claimed') : isExpired ? t('platform.gymDetail.people.expired') : t('platform.gymDetail.people.pending')}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
