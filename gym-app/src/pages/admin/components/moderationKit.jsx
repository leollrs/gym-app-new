/* ============================================================
   TuGymPR · Moderación de Contenido Restyle — shared kit
   Ported from the Claude Design "Moderación de Contenido Restyle"
   handoff (needs clases-restyle-kit = retosKit). Re-exports the
   retos primitives + adds the moderation-specific bits: avatar,
   filter pills, type/status badges, table header, and the icon
   tab bar. All data/logic stays in the tab components — this is
   presentation only, on admin CSS vars (theme + white-label safe).
   ============================================================ */
import { TK, FK, TONE, Ico, ICON, Card } from './retosKit';

export { TK, FK, TONE, Ico, ICON, Card };

/* ── moderation icon paths (exact from the mock) ── */
export const MIC = {
  flag: <><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>,
  pulse: <path d="M3 12h4l3 7 4-14 3 7h4" />,
  chat: <path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12Z" />,
  check: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.4 2.4L16 9.5" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
  trash: <><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></>,
  restore: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 4v4h4" /></>,
  xCircle: <><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></>,
  chevR: <path d="m9 18 6-6-6-6" />,
  chevL: <path d="m15 18-6-6 6-6" />,
  dumbbell: <><path d="M6.5 6.5 17.5 17.5M3 7v10M21 7v10M6 4v16M18 4v16M2 12h2M20 12h2" /></>,
  trophy: <><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" /><path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11" /><path d="M9.5 14.5 9 18h6l-.5-3.5M8 21h8M12 18v3" /></>,
  medal: <><path d="m8 4-3 .6 2 4.4M16 4l3 .6-2 4.4" /><circle cx="12" cy="14.5" r="5.5" /><path d="M12 12v2l1.4 1" /></>,
  question: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.5M12 17h.01" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  checkin: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" /></>,
};

/* avatar with initial (accent-tinted disc) */
export function Av({ name, sm = false }) {
  const s = sm ? 30 : 36;
  const ch = (name || '?').trim()[0]?.toUpperCase() || '?';
  return (
    <span style={{
      width: s, height: s, borderRadius: 99, flexShrink: 0, display: 'grid', placeItems: 'center',
      background: TK.accentSoft, color: TK.accent, fontFamily: FK.display, fontSize: sm ? 12.5 : 14, fontWeight: 800,
    }}>{ch}</span>
  );
}

/* pill filter group with counts */
export function FilterPills({ items, active, onPick }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, margin: '4px 0 18px' }}>
      {items.map(it => {
        const on = it.id === active;
        return (
          <button key={it.id} type="button" onClick={() => onPick(it.id)} style={{
            padding: '9px 17px', borderRadius: 999, cursor: 'pointer',
            fontFamily: FK.body, fontSize: 13, fontWeight: on ? 700 : 600, color: on ? TK.accent : TK.textSub,
            background: on ? TK.accentSoft : TK.surface, border: `1px solid ${on ? TK.accentLine : TK.borderSolid}`,
          }}>
            {it.label} <span style={{ color: on ? TK.accent : TK.textFaint, fontWeight: 700 }}>({it.count})</span>
          </button>
        );
      })}
    </div>
  );
}

/* table header label */
export const TH = ({ children, right = false }) => (
  <span style={{ fontFamily: FK.body, fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: TK.textFaint, textAlign: right ? 'right' : 'left' }}>{children}</span>
);

/* tone → display color (neutral falls back to muted text) */
function toneColor(tone) {
  if (!tone || tone === 'neutral') return TK.textMute;
  return (TONE[tone] || TONE.neutral).ink;
}

/* status dot + label */
export function StatusDot({ tone = 'neutral', label }) {
  const c = toneColor(tone);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: FK.body, fontSize: 14, fontWeight: 700, color: c }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: c, flexShrink: 0 }} />{label}
    </span>
  );
}

/* content-type / post-type badge (tone + icon + label) */
export function TypeBadge({ tone = 'neutral', icon, label }) {
  const c = TONE[tone] || TONE.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 999,
      background: c.bg, border: `1px solid ${c.line}`, fontFamily: FK.body, fontSize: 12.5, fontWeight: 700, color: c.ink, whiteSpace: 'nowrap',
    }}>
      {icon && <Ico ch={icon} size={13} color={c.ink} stroke={2} />}{label}
    </span>
  );
}

/* square icon action button (eye / trash / restore / remove).
   tone !== 'neutral' → fully tinted box (e.g. good "restore").
   iconColor → colored icon on a plain box (e.g. danger trash on surface). */
export function IconBtn({ icon, tone = 'neutral', iconColor, onClick, disabled = false, title, size = 34 }) {
  const tinted = tone !== 'neutral';
  const c = tinted ? (TONE[tone] || TONE.neutral) : null;
  const fg = iconColor || (c ? c.fg : TK.textSub);
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title} style={{
      width: size, height: size, borderRadius: 9, display: 'grid', placeItems: 'center', flexShrink: 0,
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
      background: c ? c.bg : TK.surface2, border: `1px solid ${c ? c.line : TK.borderSolid}`,
    }}>
      <Ico ch={icon} size={16} color={fg} stroke={2} />
    </button>
  );
}

/* "Cargar N más" load-more button (matches the mock) */
export function LoadMoreBtn({ children, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '9px 18px', borderRadius: 999, cursor: 'pointer', background: TK.accentWash, border: `1px solid ${TK.accentLine}`,
      fontFamily: FK.body, fontSize: 13, fontWeight: 700, color: TK.accent,
    }}>{children}</button>
  );
}

/* prev/next page navigation ("‹  p / N  ›") */
export function Pager({ page, pageCount, onPrev, onNext, style = {} }) {
  if (pageCount <= 1) return null;
  const btn = (disabled) => ({
    width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', flexShrink: 0,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
    background: TK.surface2, border: `1px solid ${TK.borderSolid}`,
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '15px 22px', borderTop: `1px solid ${TK.divider}`, ...style }}>
      <button type="button" disabled={page === 0} onClick={onPrev} style={btn(page === 0)} aria-label="Previous page">
        <Ico ch={MIC.chevL} size={15} color={TK.textSub} stroke={2.2} />
      </button>
      <span style={{ fontFamily: FK.mono, fontSize: 12.5, color: TK.textMute }}>{page + 1} / {pageCount}</span>
      <button type="button" disabled={page >= pageCount - 1} onClick={onNext} style={btn(page >= pageCount - 1)} aria-label="Next page">
        <Ico ch={MIC.chevR} size={15} color={TK.textSub} stroke={2.2} />
      </button>
    </div>
  );
}

/* ── top icon-tab nav (accent underline) ── */
export function ModTabs({ tabs, active, onPick }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tabs.length},1fr)`, borderBottom: `1px solid ${TK.borderSolid}`, margin: '24px 0 22px' }}>
      {tabs.map(tab => {
        const on = tab.key === active;
        return (
          <button key={tab.key} type="button" onClick={() => onPick(tab.key)} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 0 18px',
            position: 'relative', cursor: 'pointer', background: 'transparent', border: 'none',
          }}>
            <Ico ch={tab.icon} size={18} color={on ? TK.accent : TK.textMute} stroke={on ? 2.1 : 1.9} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: FK.body, fontSize: 14.5, fontWeight: on ? 700 : 600, color: on ? TK.accent : TK.textMute }}>{tab.label}</span>
              {tab.count != null && (
                <span style={{
                  minWidth: 22, padding: '2px 7px', borderRadius: 999, textAlign: 'center',
                  background: on ? TK.accentSoft : TK.surface3, fontFamily: FK.mono, fontSize: 12, fontWeight: 700, color: on ? TK.accent : TK.textMute,
                }}>{tab.count}</span>
              )}
            </span>
            {on && <span style={{ position: 'absolute', left: '38%', right: '38%', bottom: -1, height: 2.5, borderRadius: 99, background: TK.accent }} />}
          </button>
        );
      })}
    </div>
  );
}

/* ── visual maps: real keys → {tone, icon}. Labels come from
   moderationHelpers (already i18n'd) so this is style-only. ── */

// activity-feed post type → tone + icon
export const POST_TYPE_VISUAL = {
  workout_completed:    { tone: 'good',  icon: MIC.dumbbell },
  pr_hit:               { tone: 'accent', icon: MIC.trophy },
  achievement_unlocked: { tone: 'coach', icon: MIC.medal },
  challenge_joined:     { tone: 'warn',  icon: MIC.trophy },
  challenge_won:        { tone: 'warn',  icon: MIC.trophy },
  check_in:             { tone: 'info',  icon: MIC.checkin },
  program_started:      { tone: 'info',  icon: MIC.pulse },
};
export const postTypeVisual = (type) => POST_TYPE_VISUAL[type] || { tone: 'neutral', icon: MIC.question };

// content_report content_type → tone + icon
export const CONTENT_TYPE_VISUAL = {
  activity: { tone: 'info',  icon: MIC.pulse },
  comment:  { tone: 'info',  icon: MIC.chat },
  message:  { tone: 'coach', icon: MIC.chat },
  profile:  { tone: 'coach', icon: MIC.user },
};
export const contentTypeVisual = (ct) => CONTENT_TYPE_VISUAL[ct] || CONTENT_TYPE_VISUAL.activity;

// content_report status → tone
export const REPORT_STATUS_TONE = {
  pending: 'warn',
  reviewed: 'info',
  dismissed: 'neutral',
  actioned: 'good',
};
export const reportStatusTone = (s) => REPORT_STATUS_TONE[s] || 'warn';
