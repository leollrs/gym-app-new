import { useState } from 'react';
import { Search, X, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AdminModal, Avatar } from '../../../components/admin';

export default function AddTrainerModal({ isOpen, onClose, allMembers, onPromote }) {
  const { t } = useTranslation('pages');
  const [addSearch, setAddSearch] = useState('');
  const [promoting, setPromoting] = useState(null);

  const promotableMembers = allMembers.filter(m =>
    addSearch.length > 0 &&
    (m.full_name?.toLowerCase().includes(addSearch.toLowerCase()) || m.username?.toLowerCase().includes(addSearch.toLowerCase()))
  );

  const handlePromote = async (memberId) => {
    setPromoting(memberId);
    await onPromote(memberId);
    setPromoting(null);
    setAddSearch('');
  };

  const handleClose = () => {
    setAddSearch('');
    setPromoting(null);
    onClose();
  };

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('admin.trainers.addTrainerTitle', 'Add Trainer')}
      titleIcon={UserPlus}
      subtitle={t('admin.trainers.addTrainerSubtitle', 'Promote an existing member to the trainer role')}
      size="md"
      footer={
        <p className="text-[10px]" style={{ color: 'var(--color-admin-text-faint)' }}>
          {t('admin.trainers.addTrainerFooter', "Promoting a member changes their role to trainer. They'll get access to the trainer dashboard and can manage clients.")}
        </p>
      }
    >
      {/* Search */}
      <div className="mb-4">
        <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
          <Search size={14} className="flex-shrink-0" style={{ color: 'var(--color-admin-text-muted)' }} />
          <input
            type="text"
            value={addSearch}
            onChange={e => setAddSearch(e.target.value)}
            placeholder={t('admin.trainers.searchMembersPlaceholder', 'Search members by name or email...')}
            aria-label={t('admin.trainers.searchMembersPlaceholder', 'Search members by name or email...')}
            className="flex-1 bg-transparent text-[13px] outline-none"
            style={{ color: 'var(--color-admin-text)' }}
            autoFocus
          />
          {addSearch && (
            <button onClick={() => setAddSearch('')} aria-label={t('admin.trainers.clearSearch', 'Clear search')} style={{ color: 'var(--color-admin-text-muted)' }}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="max-h-72 overflow-y-auto">
        {addSearch.length === 0 ? (
          <div className="py-8 text-center">
            <Search size={20} className="mx-auto mb-2" style={{ color: 'var(--color-admin-text-faint)' }} />
            <p className="text-[12px]" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.trainers.typeToSearch', 'Type a name or email to find members')}</p>
          </div>
        ) : promotableMembers.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-[12px]" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.trainers.noMatchingMembers', 'No matching members found')}</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {promotableMembers.slice(0, 15).map(m => (
              <button
                key={m.id}
                disabled={promoting === m.id}
                onClick={() => handlePromote(m.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors disabled:opacity-50 text-left hover:bg-[var(--color-bg-hover)]"
              >
                <Avatar name={m.full_name} size="sm" variant="neutral" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate" style={{ color: 'var(--color-admin-text)' }}>{m.full_name}</p>
                  <p className="text-[11px] truncate" style={{ color: 'var(--color-admin-text-muted)' }}>@{m.username}</p>
                </div>
                {promoting === m.id ? (
                  <div className="w-5 h-5 rounded-full animate-spin flex-shrink-0" style={{ border: '2px solid color-mix(in srgb, var(--color-accent) 30%, transparent)', borderTopColor: 'var(--color-accent)' }} />
                ) : (
                  <span className="text-[11px] font-medium flex-shrink-0 px-2 py-0.5 rounded-md" style={{ color: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}>
                    {t('admin.trainers.promote', 'Promote')}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </AdminModal>
  );
}
