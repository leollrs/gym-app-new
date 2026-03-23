import { useState } from 'react';
import { Search, X, UserPlus } from 'lucide-react';
import { AdminModal, Avatar } from '../../../components/admin';

export default function AddTrainerModal({ isOpen, onClose, allMembers, onPromote }) {
  const [addSearch, setAddSearch] = useState('');
  const [promoting, setPromoting] = useState(null);

  const promotableMembers = allMembers.filter(m =>
    addSearch.length > 0 &&
    (m.full_name?.toLowerCase().includes(addSearch.toLowerCase()) || m.email?.toLowerCase().includes(addSearch.toLowerCase()))
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
      title="Add Trainer"
      titleIcon={UserPlus}
      subtitle="Promote an existing member to the trainer role"
      size="md"
      footer={
        <p className="text-[10px] text-[#4B5563]">
          Promoting a member changes their role to trainer. They'll get access to the trainer dashboard and can manage clients.
        </p>
      }
    >
      {/* Search */}
      <div className="mb-4">
        <div className="flex items-center gap-2 bg-[#111827] border border-white/6 rounded-lg px-3 py-2">
          <Search size={14} className="text-[#6B7280] flex-shrink-0" />
          <input
            type="text"
            value={addSearch}
            onChange={e => setAddSearch(e.target.value)}
            placeholder="Search members by name or email..."
            aria-label="Search members by name or email"
            className="flex-1 bg-transparent text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none"
            autoFocus
          />
          {addSearch && (
            <button onClick={() => setAddSearch('')} className="text-[#6B7280] hover:text-[#9CA3AF]">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="max-h-72 overflow-y-auto">
        {addSearch.length === 0 ? (
          <div className="py-8 text-center">
            <Search size={20} className="text-[#4B5563] mx-auto mb-2" />
            <p className="text-[12px] text-[#6B7280]">Type a name or email to find members</p>
          </div>
        ) : promotableMembers.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-[12px] text-[#6B7280]">No matching members found</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {promotableMembers.slice(0, 15).map(m => (
              <button
                key={m.id}
                disabled={promoting === m.id}
                onClick={() => handlePromote(m.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.03] transition-colors disabled:opacity-50 text-left"
              >
                <Avatar name={m.full_name} size="sm" variant="neutral" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{m.full_name}</p>
                  <p className="text-[11px] text-[#6B7280] truncate">{m.email}</p>
                </div>
                {promoting === m.id ? (
                  <div className="w-5 h-5 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin flex-shrink-0" />
                ) : (
                  <span className="text-[11px] font-medium text-[#D4AF37] flex-shrink-0 px-2 py-0.5 rounded-md bg-[#D4AF37]/10">
                    Promote
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
