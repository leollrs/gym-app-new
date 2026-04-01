import React from 'react';
import { Trophy } from 'lucide-react';
import { sanitize } from '../../lib/sanitize';
import { localizeRoutineName } from '../../lib/exerciseName';
import { formatStatNumber, statFontSize } from '../../lib/formatStatValue';
import { useTranslation } from 'react-i18next';

const RATING_EMOJIS = [
  { value: 1, emoji: '\u{1F62B}' },
  { value: 2, emoji: '\u{1F615}' },
  { value: 3, emoji: '\u{1F610}' },
  { value: 4, emoji: '\u{1F4AA}' },
  { value: 5, emoji: '\u{1F525}' },
];

const SessionSummary = ({ workout, sessionPRs, totalVolume, duration, completedSets, totalSets, onConfirm, onCancel, saving, error, sessionRating, onRatingChange }) => {
  const { t } = useTranslation('pages');
  return (
  <div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/60 backdrop-blur-sm">
    <div className="rounded-t-3xl w-full max-w-lg pb-10 pt-6 px-6 animate-fade-in border-t border-white/10 shadow-[0_-8px_40px_rgba(0,0,0,0.6)]" style={{ background: 'var(--color-bg-card)' }}>
      <div className="w-10 h-1 rounded-full mx-auto mb-6 bg-white/20" />
      <h2 className="font-black text-[22px] mb-1 truncate" style={{ color: 'var(--color-text-primary)' }}>{t('sessionSummary.thatsAWrap')}</h2>
      <p className="text-[14px] mb-6 truncate" style={{ color: 'var(--color-text-subtle)' }}>{localizeRoutineName(workout)} · {duration}</p>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { value: `${formatStatNumber(totalVolume)}`, label: t('sessionSummary.volumeLbs') },
          { value: totalSets > 0 ? `${completedSets}/${totalSets}` : completedSets, label: t('sessionSummary.setsDone') },
          { value: duration, label: t('sessionSummary.duration') },
        ].map(({ value, label }) => (
          <div key={label} className="rounded-2xl p-3 text-center bg-white/5 border border-white/8 overflow-hidden min-w-0">
            <p className={`${statFontSize(value, 'text-[24px]')} font-black truncate`} style={{ color: 'var(--color-text-primary)' }}>{value}</p>
            <p className="text-[10px] mt-0.5 uppercase font-semibold truncate" style={{ color: 'var(--color-text-subtle)' }}>{label}</p>
          </div>
        ))}
      </div>

      {sessionPRs.length > 0 && (
        <div className="bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded-2xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Trophy size={16} className="text-[#D4AF37]" />
            <p className="text-[#D4AF37] font-bold text-[13px]">{t('sessionSummary.newPRCount', { count: sessionPRs.length })}</p>
          </div>
          {sessionPRs.map((pr, i) => (
            <p key={`pr-${pr.exercise}-${pr.weight}`} className="text-[13px] py-0.5" style={{ color: 'var(--color-text-primary)' }}>
              {sanitize(pr.exercise)} — {pr.weight} lbs × {pr.reps}
            </p>
          ))}
        </div>
      )}

      {/* Session Rating */}
      <div className="mb-6">
        <p className="text-[13px] font-semibold mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('sessionSummary.howDidItFeel')}</p>
        <div className="flex items-center justify-center gap-3">
          {RATING_EMOJIS.map(({ value, emoji }) => (
            <button
              key={value}
              onClick={() => onRatingChange(value)}
              className={`w-11 h-11 rounded-xl text-[22px] flex items-center justify-center transition-all ${
                sessionRating === value
                  ? 'border-2 border-[#D4AF37] bg-[#D4AF37]/10 scale-110'
                  : 'border border-white/8 bg-white/5'
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-2xl p-3 mb-4 text-[13px] text-red-400">
          {error}
        </div>
      )}

      <button
        onClick={onConfirm}
        disabled={saving}
        className="w-full disabled:opacity-50 font-black text-[14px] py-4 rounded-2xl transition-colors mb-3 bg-[#D4AF37] text-black"
      >
        {saving ? t('sessionSummary.savingEllipsis') : t('sessionSummary.saveAndFinish')}
      </button>
      <button
        onClick={onCancel}
        disabled={saving}
        className="w-full font-semibold text-[14px] py-2 transition-colors"
        style={{ color: 'var(--color-text-subtle)' }}
      >
        {t('sessionSummary.notDoneYet')}
      </button>
    </div>
  </div>
  );
};

export default SessionSummary;
