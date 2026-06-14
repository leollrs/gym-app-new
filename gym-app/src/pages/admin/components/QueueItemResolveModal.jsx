import { useState } from 'react';
import { CheckCircle, PhoneCall, EyeOff, UserMinus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AdminModal } from '../../../components/admin';

// Owner-facing "I did the thing — here's how it went" capture.
// Outcomes feed back into the orchestrator's effectiveness analysis
// later (which signal types respond to which actions).
const OUTCOMES = [
  { key: 'reached_out', Icon: PhoneCall },
  { key: 'returned',    Icon: CheckCircle },
  { key: 'no_response', Icon: EyeOff },
  { key: 'lost',        Icon: UserMinus },
];

export default function QueueItemResolveModal({
  isOpen,
  onClose,
  onConfirm,
  memberName,
  suggestedAction,
  saving = false,
}) {
  const { t } = useTranslation('pages');
  const tc = (k, opts) => t(`admin.common.${k}`, opts);
  const [outcome, setOutcome] = useState(null);
  const [note, setNote] = useState('');

  const reset = () => {
    setOutcome(null);
    setNote('');
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleConfirm = () => {
    if (!outcome) return;
    onConfirm({ outcome, note: note.trim() || null });
  };

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('admin.morningQueue.resolveTitle', { defaultValue: 'Mark resolved' })}
      subtitle={memberName}
      titleIcon={CheckCircle}
      size="md"
      footer={
        <>
          <button
            onClick={handleClose}
            disabled={saving}
            className="flex-1 py-2 rounded-lg text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors whitespace-nowrap disabled:opacity-40"
          >
            {tc('cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving || !outcome}
            style={{ background: '#10B981', color: '#fff' }}
            className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors whitespace-nowrap disabled:opacity-40"
          >
            {saving
              ? tc('saving', { defaultValue: 'Saving...' })
              : t('admin.morningQueue.resolveBtn', { defaultValue: 'Mark resolved' })}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {suggestedAction && (
          <p className="text-[12px] text-[#9CA3AF]">
            {t('admin.morningQueue.suggestedActionWas', { defaultValue: 'Suggested action was' })}{' '}
            <span className="font-semibold text-[#E5E7EB]">
              {t(`admin.morningQueue.actions.${suggestedAction}`, suggestedAction)}
            </span>
            .
          </p>
        )}

        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-[#6B7280] mb-2">
            {t('admin.morningQueue.outcomeLabel', { defaultValue: 'How did it go?' })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {OUTCOMES.map(({ key, Icon }) => {
              const selected = outcome === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOutcome(key)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-left text-[12px] border transition-colors ${
                    selected
                      ? 'bg-[#10B981]/10 border-[#10B981]/40 text-[#E5E7EB]'
                      : 'bg-white/[0.03] border-white/8 text-[#9CA3AF] hover:bg-white/[0.06] hover:text-[#E5E7EB]'
                  }`}
                  aria-pressed={selected}
                >
                  <Icon size={14} className={selected ? 'text-[#10B981]' : 'text-[#6B7280]'} />
                  <span className="font-medium">
                    {t(`admin.morningQueue.outcomes.${key}`, key)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-[#6B7280] mb-2">
            {t('admin.morningQueue.noteLabel', { defaultValue: 'Note' })}
            <span className="ml-1 text-[10px] normal-case text-[#6B7280]/70 font-normal">
              ({t('admin.morningQueue.optional', { defaultValue: 'optional' })})
            </span>
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={400}
            placeholder={t('admin.morningQueue.notePlaceholder', { defaultValue: 'Anything worth remembering' })}
            className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[12px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none resize-none"
          />
        </div>
      </div>
    </AdminModal>
  );
}
