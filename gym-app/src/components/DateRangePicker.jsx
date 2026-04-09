import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';

const PRESETS = [
  { key: '7d',   label: 'Last 7 Days',   days: 7,    i18nKey: 'last7' },
  { key: '14d',  label: 'Last 14 Days',  days: 14,   i18nKey: 'last14' },
  { key: '30d',  label: 'Last 30 Days',  days: 30,   i18nKey: 'last30' },
  { key: '90d',  label: 'Last 90 Days',  days: 90,   i18nKey: 'last90' },
  { key: '6m',   label: 'Last 6 Months', days: 183,  i18nKey: 'last6m' },
  { key: '1y',   label: 'Last Year',     days: 365,  i18nKey: 'lastYear' },
  { key: 'all',  label: 'All Time',      days: null,  i18nKey: 'allTime' },
];

function daysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function today() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function rangeFromPreset(key) {
  const preset = PRESETS.find((p) => p.key === key);
  if (!preset) return null;
  const to = today();
  const from = preset.days != null ? daysAgo(preset.days) : new Date(2000, 0, 1);
  return { from, to, label: preset.label };
}

export default function DateRangePicker({ defaultPreset = '30d', onChange }) {
  const { t } = useTranslation('pages');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(defaultPreset);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const ref = useRef(null);

  // Compute the display label
  const displayLabel = useMemo(() => {
    if (selected === 'custom') {
      if (customFrom && customTo) return `${customFrom} — ${customTo}`;
      return t('dateRange.customRange');
    }
    const preset = PRESETS.find((p) => p.key === selected);
    return preset ? t(`dateRange.${preset.i18nKey}`) : t('dateRange.selectRange');
  }, [selected, customFrom, customTo, t]);

  // Fire onChange on mount with default preset
  useEffect(() => {
    const range = rangeFromPreset(defaultPreset);
    if (range && onChange) onChange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  function handlePreset(key) {
    setSelected(key);
    const range = rangeFromPreset(key);
    if (range && onChange) onChange(range);
    setOpen(false);
  }

  function handleCustomApply() {
    if (!customFrom || !customTo) return;
    const from = new Date(customFrom + 'T00:00:00');
    const to = new Date(customTo + 'T23:59:59');
    if (from > to) return;
    if (onChange) onChange({ from, to, label: `${customFrom} — ${customTo}` });
    setOpen(false);
  }

  return (
    <div className="relative inline-block" ref={ref}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-[14px] bg-[#0F172A] border border-white/6
                   text-[#E5E7EB] text-sm font-medium hover:border-[#D4AF37]/40 transition-colors cursor-pointer"
      >
        <CalendarDays size={16} className="text-[#D4AF37]" />
        <span>{displayLabel}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-64 py-2 rounded-[14px] bg-[#0F172A] border border-white/8
                     shadow-xl shadow-black/40"
        >
          {/* Preset Options */}
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => handlePreset(p.key)}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors cursor-pointer
                ${
                  selected === p.key
                    ? 'bg-[#D4AF37]/10 text-[#D4AF37] font-medium'
                    : 'text-[#E5E7EB] hover:bg-white/5'
                }`}
            >
              {t(`dateRange.${p.i18nKey}`)}
            </button>
          ))}

          {/* Divider */}
          <div className="my-1.5 border-t border-white/6" />

          {/* Custom Range Toggle */}
          <button
            type="button"
            onClick={() => setSelected('custom')}
            className={`w-full text-left px-4 py-2.5 text-sm transition-colors cursor-pointer
              ${
                selected === 'custom'
                  ? 'bg-[#D4AF37]/10 text-[#D4AF37] font-medium'
                  : 'text-[#E5E7EB] hover:bg-white/5'
              }`}
          >
            {t('dateRange.customRange')}
          </button>

          {/* Custom Date Inputs */}
          {selected === 'custom' && (
            <div className="px-4 pt-2 pb-3 space-y-3">
              <div>
                <label htmlFor="daterange-from" className="block text-xs text-[#9CA3AF] mb-1">{t('dateRange.from')}</label>
                <input
                  id="daterange-from"
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#111827] border border-white/6 rounded-xl
                             text-[#E5E7EB] outline-none focus:border-[#D4AF37]/50 transition-colors
                             [color-scheme:dark]"
                />
              </div>
              <div>
                <label htmlFor="daterange-to" className="block text-xs text-[#9CA3AF] mb-1">{t('dateRange.to')}</label>
                <input
                  id="daterange-to"
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#111827] border border-white/6 rounded-xl
                             text-[#E5E7EB] outline-none focus:border-[#D4AF37]/50 transition-colors
                             [color-scheme:dark]"
                />
              </div>
              <button
                type="button"
                onClick={handleCustomApply}
                disabled={!customFrom || !customTo}
                className="w-full py-2 text-sm font-medium rounded-xl transition-colors cursor-pointer
                           bg-[#D4AF37] text-[#05070B] hover:bg-[#D4AF37]/90
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('dateRange.apply')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
