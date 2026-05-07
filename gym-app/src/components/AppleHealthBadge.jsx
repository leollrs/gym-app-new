/**
 * Apple Health branding components for App Store Guideline 2.5.1 compliance.
 * HealthKit functionality must be clearly identified in the UI.
 */

/* ── Apple Health heart icon (gradient matching official branding) ─── */
export const AppleHealthIcon = ({ size = 20, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-label="Apple Health"
  >
    <defs>
      <linearGradient id="ahGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#FF6B8A" />
        <stop offset="100%" stopColor="#FF2D55" />
      </linearGradient>
    </defs>
    <path
      d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
      fill="url(#ahGrad)"
    />
  </svg>
);

/* ── "from Apple Health" inline attribution badge ──────────────────── */
export const AppleHealthSourceBadge = ({ label = 'Apple Health', small = false }) => (
  <span
    className={`inline-flex items-center gap-1 ${small ? 'text-[9px]' : 'text-[10px]'} font-medium rounded-full`}
    style={{ color: '#FF2D55', opacity: 0.85 }}
  >
    <AppleHealthIcon size={small ? 10 : 12} />
    {label}
  </span>
);

/* ── "Synced to Apple Health" confirmation chip ────────────────────── */
export const AppleHealthSyncedChip = ({ label = 'Saved to Apple Health' }) => (
  <div
    className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-[12px] font-semibold"
    style={{
      backgroundColor: 'rgba(255,45,85,0.08)',
      border: '1px solid rgba(255,45,85,0.15)',
      color: '#FF2D55',
    }}
  >
    <AppleHealthIcon size={16} />
    {label}
  </div>
);

/* ── "Powered by HealthKit" footer ─────────────────────────────────── */
export const PoweredByHealthKit = ({ label = 'Powered by Apple HealthKit' }) => (
  <div className="flex items-center justify-center gap-2 py-3">
    <AppleHealthIcon size={14} />
    <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
      {label}
    </span>
  </div>
);
