import { AlertTriangle } from 'lucide-react';
import { AdminModal } from '../../../components/admin';

export default function ConfirmDemoteModal({ isOpen, onClose, trainer, clientCount, onConfirm }) {
  if (!trainer) return null;

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={onClose}
      title="Remove Trainer"
      titleIcon={AlertTriangle}
      size="sm"
      footer={
        <>
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(trainer.id)}
            className="flex-1 py-2 rounded-lg text-[12px] font-semibold bg-[#EF4444] text-white hover:bg-[#DC2626] transition-colors whitespace-nowrap"
          >
            Remove Trainer
          </button>
        </>
      }
    >
      <div className="text-center">
        <p className="text-[12px] text-[#9CA3AF]">
          This will demote <span className="font-semibold text-[#E5E7EB]">{trainer.name}</span> back to a regular member.
        </p>
        {clientCount > 0 && (
          <p className="text-[11px] text-[#F59E0B] mt-2 bg-[#F59E0B]/10 rounded-lg px-3 py-1.5 inline-block">
            {clientCount} client{clientCount !== 1 ? 's' : ''} will be unassigned
          </p>
        )}
      </div>
    </AdminModal>
  );
}
