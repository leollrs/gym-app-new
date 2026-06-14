import { useState } from 'react';
import { HandHelping, Pause, MessageSquare, Gift, Check, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AdminModal } from '../../../components/admin';
import { logAdminAction } from '../../../lib/adminAudit';

/**
 * Save-step modal — appears BEFORE CancellationSurveyModal.
 *
 * Hormozi rule: force a real save attempt before recording the cancellation,
 * so the owner has a real conversation rather than just clicking through.
 *
 * Each attempt is logged to admin_audit_log via logAdminAction so the
 * retention dashboard can see how often save attempts were tried, which
 * types, and how often they actually saved the member.
 */
export default function CancellationSaveStep({
  isOpen,
  onClose,
  member,
  onProceedToCancel,
  onSaved,
}) {
  const { t } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const tk = (k, fallback) => t(`admin.cancellationSave.${k}`, { defaultValue: fallback });

  // Which attempt the admin just logged (null = none yet)
  const [loggedAttempt, setLoggedAttempt] = useState(null);
  // Inline note for "custom" attempt
  const [customOpen, setCustomOpen] = useState(false);
  const [noteText, setNoteText] = useState('');

  const reset = () => {
    setLoggedAttempt(null);
    setCustomOpen(false);
    setNoteText('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleProceedToCancel = () => {
    reset();
    onProceedToCancel();
  };

  const handleSaved = () => {
    // Log the "saved" outcome too — useful retention signal.
    if (member?.id) {
      logAdminAction('cancel_save_success', 'member', member.id, {
        attempt_type: loggedAttempt?.type ?? null,
        note: loggedAttempt?.note ?? null,
      });
    }
    reset();
    onSaved();
  };

  const logAttempt = (type, note = null) => {
    if (member?.id) {
      logAdminAction('cancel_save_attempt', 'member', member.id, {
        attempt_type: type,
        note,
      });
    }
    setLoggedAttempt({ type, note });
  };

  const handleChipClick = (type) => {
    if (type === 'custom') {
      setCustomOpen(true);
      return;
    }
    logAttempt(type);
  };

  const handleCustomSubmit = () => {
    const note = noteText.trim();
    if (!note) return;
    logAttempt('custom', note);
    setCustomOpen(false);
  };

  const chips = [
    {
      type: 'freeze',
      Icon: Pause,
      label: tk('chipFreeze', 'Offer to freeze instead'),
      hint: tk('chipFreezeHint', 'Pause membership instead of cancelling.'),
    },
    {
      type: 'conversation',
      Icon: MessageSquare,
      label: tk('chipConversation', 'Schedule in-person conversation'),
      hint: tk('chipConversationHint', 'Get them on the floor before they walk.'),
    },
    {
      type: 'custom',
      Icon: Gift,
      label: tk('chipCustom', 'Note: offered something specific'),
      hint: tk('chipCustomHint', 'Logged for retention review.'),
    },
  ];

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={handleClose}
      title={tk('title', 'Try this before cancelling')}
      subtitle={member?.full_name}
      titleIcon={HandHelping}
      size="md"
      footer={
        <button
          onClick={handleProceedToCancel}
          className="w-full py-2 rounded-lg text-[11px] font-medium text-[#6B7280] hover:text-[#9CA3AF] transition-colors whitespace-nowrap underline-offset-2 hover:underline"
        >
          {tk('skip', 'Skip — proceed to cancel')}
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-[12px] text-[#9CA3AF] leading-relaxed">
          {tk(
            'prompt',
            'Hormozi rule: a real save attempt before recording the cancellation. Try one of these — even a 30-second offer changes the outcome more often than you think.',
          )}
        </p>

        {/* Save-attempt chips */}
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-[#6B7280] mb-2">
            {tk('attemptsLabel', 'Save attempts')}
          </p>
          <div className="space-y-2">
            {chips.map(({ type, Icon, label, hint }) => {
              const selected = loggedAttempt?.type === type;
              const dimmed = loggedAttempt && !selected;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleChipClick(type)}
                  disabled={dimmed}
                  className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left text-[12px] border transition-colors ${
                    selected
                      ? 'bg-[#10B981]/10 border-[#10B981]/40 text-[#E5E7EB]'
                      : 'bg-white/[0.03] border-white/8 text-[#9CA3AF] hover:bg-white/[0.06] hover:text-[#E5E7EB]'
                  } ${dimmed ? 'opacity-40' : ''}`}
                  aria-pressed={selected}
                >
                  <Icon
                    size={14}
                    className={`mt-0.5 flex-shrink-0 ${selected ? 'text-[#10B981]' : 'text-[#6B7280]'}`}
                  />
                  <span className="flex-1">
                    <span className="block font-medium">{label}</span>
                    <span className="block text-[11px] text-[#6B7280] mt-0.5">{hint}</span>
                  </span>
                  {selected && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-[#10B981] flex-shrink-0">
                      <Check size={12} />
                      {tk('attemptLogged', 'Attempt logged')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Inline custom note input */}
          {customOpen && loggedAttempt?.type !== 'custom' && (
            <div className="mt-2 space-y-2">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={2}
                maxLength={500}
                autoFocus
                placeholder={tk('customPlaceholder', 'What did you offer? (e.g. 1 free PT session, half-off next month)')}
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[12px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none resize-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setCustomOpen(false); setNoteText(''); }}
                  className="flex-1 py-1.5 rounded-lg text-[11px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors"
                >
                  {tc('cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleCustomSubmit}
                  disabled={!noteText.trim()}
                  style={{ background: '#10b981', color: '#fff' }}
                  className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-40"
                >
                  {tk('logAttempt', 'Log attempt')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Outcome buttons — only after an attempt is logged */}
        {loggedAttempt && (
          <div className="pt-1 space-y-2 border-t border-white/6">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-[#6B7280] pt-3">
              {tk('outcomeLabel', 'How did it land?')}
            </p>
            <button
              type="button"
              onClick={handleSaved}
              style={{ background: '#10b981', color: '#fff' }}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-semibold transition-colors"
            >
              <Check size={14} />
              {tk('memberSaved', "Member saved! Don't cancel")}
            </button>
            <button
              type="button"
              onClick={handleProceedToCancel}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-semibold border border-[#EF4444]/30 text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors"
            >
              {tk('stillCancel', 'They still want to cancel')}
              <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
    </AdminModal>
  );
}
