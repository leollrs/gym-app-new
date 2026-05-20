import { useMemo, useState } from 'react';
import { UserX, AlertTriangle, Plane, DollarSign, Clock, TrendingDown, Frown, HeartPulse, MoreHorizontal, Info } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useTranslation } from 'react-i18next';
import { AdminModal } from '../../../components/admin';

const REASONS = [
  { key: 'moved',      Icon: Plane },
  { key: 'financial',  Icon: DollarSign },
  { key: 'time',       Icon: Clock },
  { key: 'no_results', Icon: TrendingDown },
  { key: 'experience', Icon: Frown },
  { key: 'health',     Icon: HeartPulse },
  { key: 'other',      Icon: MoreHorizontal },
];

export default function CancellationSurveyModal({
  isOpen,
  onClose,
  onConfirm,
  memberName,
  saving = false,
  conflict = false,
  priorCancellations = [],
}) {
  const { t, i18n } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const isEs = i18n.language?.startsWith('es');
  const dateLocale = isEs ? { locale: esLocale } : undefined;
  const [category, setCategory] = useState(null);
  const [detailsText, setDetailsText] = useState('');
  const [wouldReturnIf, setWouldReturnIf] = useState('');

  // Most recent prior cancellation (if any). The list arrives sorted
  // newest-first from MemberDetail's query.
  const mostRecentPrior = priorCancellations[0] || null;
  const isRepeatReason = useMemo(
    () => !!(mostRecentPrior && category && mostRecentPrior.category === category),
    [mostRecentPrior, category],
  );

  const reset = () => {
    setCategory(null);
    setDetailsText('');
    setWouldReturnIf('');
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleConfirm = () => {
    if (!category) return;
    onConfirm({
      category,
      details_text: detailsText.trim() || null,
      would_return_if: wouldReturnIf.trim() || null,
    });
  };

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('admin.cancellationSurvey.title', { defaultValue: 'Cancel Membership' })}
      subtitle={memberName}
      titleIcon={UserX}
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
            disabled={saving || !category}
            className="flex-1 py-2 rounded-lg text-[12px] font-semibold bg-[#EF4444] text-white hover:bg-[#DC2626] transition-colors whitespace-nowrap disabled:opacity-40"
          >
            {saving
              ? tc('saving', { defaultValue: 'Saving...' })
              : t('admin.cancellationSurvey.confirmBtn', { defaultValue: 'Cancel Membership' })}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Prior-cancellation banner — shown when the member has cancelled
            before. Helps the owner have a smarter exit conversation. */}
        {mostRecentPrior && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[#60A5FA]/8 border border-[#60A5FA]/20">
            <Info size={14} className="text-[#60A5FA] flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[12px] font-semibold text-[#E5E7EB]">
                  {t('admin.cancellationSurvey.priorTitle', { defaultValue: 'This member has cancelled before' })}
                </p>
                <span className="text-[10px] text-[#60A5FA]/90 font-medium">
                  {t('admin.cancellationSurvey.priorOneCancellation', {
                    count: priorCancellations.length,
                    defaultValue: '{{count}} prior cancellation',
                  })}
                </span>
              </div>
              <p className="text-[11px] text-[#9CA3AF] mt-1">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20 mr-1.5">
                  {t(`admin.cancellationSurvey.reasons.${mostRecentPrior.category}`, { defaultValue: mostRecentPrior.category })}
                </span>
                {formatDistanceToNow(new Date(mostRecentPrior.recorded_at), { addSuffix: true, ...dateLocale })}
              </p>
              {mostRecentPrior.details_text && (
                <p className="text-[11px] text-[#9CA3AF] mt-1 italic line-clamp-2">"{mostRecentPrior.details_text}"</p>
              )}
              <p className="text-[10px] text-[#60A5FA]/80 mt-1.5 font-medium">
                {t('admin.cancellationSurvey.priorSameReasonQuestion', { defaultValue: 'Same reason as last time?' })}
              </p>
            </div>
          </div>
        )}

        <p className="text-[12px] text-[#9CA3AF]">
          {t('admin.cancellationSurvey.prompt', {
            defaultValue: 'Take 10 seconds to capture why. This drives the retention report — anonymous to the member.',
          })}
        </p>

        {/* Reason grid */}
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-[#6B7280] mb-2">
            {t('admin.cancellationSurvey.reasonLabel', { defaultValue: 'Primary reason' })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {REASONS.map(({ key, Icon }) => {
              const selected = category === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCategory(key)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-left text-[12px] border transition-colors ${
                    selected
                      ? 'bg-[#EF4444]/10 border-[#EF4444]/40 text-[#E5E7EB]'
                      : 'bg-white/[0.03] border-white/8 text-[#9CA3AF] hover:bg-white/[0.06] hover:text-[#E5E7EB]'
                  }`}
                  aria-pressed={selected}
                >
                  <Icon size={14} className={selected ? 'text-[#EF4444]' : 'text-[#6B7280]'} />
                  <span className="font-medium">
                    {t(`admin.cancellationSurvey.reasons.${key}`, { defaultValue: key })}
                  </span>
                </button>
              );
            })}
          </div>
          {isRepeatReason && (
            <div className="mt-2 flex items-start gap-2 p-2.5 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/20">
              <AlertTriangle size={13} className="text-[#F59E0B] flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-[#F59E0B]">
                {t('admin.cancellationSurvey.priorRepeatCallout', {
                  defaultValue: "Repeat reason — this hasn't been addressed yet.",
                })}
              </p>
            </div>
          )}
        </div>

        {/* Free text — details */}
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-[#6B7280] mb-2">
            {t('admin.cancellationSurvey.detailsLabel', { defaultValue: 'Anything else?' })}
            <span className="ml-1 text-[10px] normal-case text-[#6B7280]/70 font-normal">
              ({t('admin.cancellationSurvey.optional', { defaultValue: 'optional' })})
            </span>
          </p>
          <textarea
            value={detailsText}
            onChange={(e) => setDetailsText(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={t('admin.cancellationSurvey.detailsPlaceholder', {
              defaultValue: 'What they said, in their words',
            })}
            className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[12px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none resize-none"
          />
        </div>

        {/* Free text — win-back triage */}
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-[#6B7280] mb-2">
            {t('admin.cancellationSurvey.winBackLabel', { defaultValue: 'Would return if…' })}
            <span className="ml-1 text-[10px] normal-case text-[#6B7280]/70 font-normal">
              ({t('admin.cancellationSurvey.optional', { defaultValue: 'optional' })})
            </span>
          </p>
          <textarea
            value={wouldReturnIf}
            onChange={(e) => setWouldReturnIf(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={t('admin.cancellationSurvey.winBackPlaceholder', {
              defaultValue: 'e.g. price drop, new schedule, after baby is born',
            })}
            className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[12px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none resize-none"
          />
        </div>

        {conflict && (
          <div className="flex items-center gap-2 p-2.5 bg-[#F59E0B]/10 border border-[#F59E0B]/20 rounded-lg">
            <AlertTriangle size={14} className="text-[#F59E0B] flex-shrink-0" />
            <p className="text-[11px] text-[#F59E0B]">
              {t('admin.memberDetail.statusConflict', {
                defaultValue:
                  'This member was modified by another admin. The status has been refreshed. Please review and try again.',
              })}
            </p>
          </div>
        )}
      </div>
    </AdminModal>
  );
}
