/* ============================================================
   TuGymPR · Configuración (Ajustes) sub-pages — shared kit
   Ported from the Claude Design "Configuración — detail sub-pages"
   handoff (needs clases-restyle-kit = retosKit). Re-exports the retos
   primitives + the settings-detail chrome (back header, card header,
   field/help labels, toggle, text field, save bar) used across the 6
   Ajustes sub-pages. Presentation only — all data/save logic stays in
   the page components.
   ============================================================ */
import { Link } from 'react-router-dom';
import { TK, FK, TONE, Ico, ICON, Card } from './retosKit';

export { TK, FK, TONE, Ico, ICON, Card };

export const DIC = {
  back: <path d="m15 18-6-6 6-6" />,
  chevD: <path d="m6 9 6 6 6-6" />,
  chevU: <path d="m6 15 6-6 6 6" />,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  building: <><path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 21V9h5a1 1 0 0 1 1 1v11M3 21h18M7 8h3M7 12h3M7 16h3" /></>,
  dollar: <><path d="M12 2v20M16.5 6.5C16.5 4.6 14.5 3.5 12 3.5S7.5 4.7 7.5 6.8 9.5 9.8 12 10.2s4.5 1.4 4.5 3.5-2 3.3-4.5 3.3-4.5-1.1-4.5-3" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" /></>,
  save: <><path d="M5 3h11l3 3v15H5V3Z" /><path d="M8 3v5h7M8 21v-7h8v7" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2 0-1.5 1-2 2-2h2a3 3 0 0 0 3-3 9 9 0 0 0-9-9Z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 20h16" /></>,
  check: <path d="m5 12 4.5 4.5L19 7" />,
  reset: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 4v4h4" /></>,
  repeat: <><path d="m17 2 4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>,
  calX: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4M9.5 14l5 4M14.5 14l-5 4" /></>,
  edit: <><path d="M4 20h4L18.5 9.5a2 2 0 0 0-3-3L5 17v3Z" /><path d="M13.5 6.5l3 3" /></>,
  trash: <><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></>,
  shield: <><path d="M12 3 5 6v5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z" /></>,
  cal: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></>,
  cake: <><path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7" /><path d="M5 15c1.2 0 1.2 1 2.3 1s1.2-1 2.3-1 1.2 1 2.4 1 1.2-1 2.3-1 1.2 1 2.4 1" /><path d="M9 8.5V6M12 8.5V6M15 8.5V6" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6 8.5-6" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M2 12s3.5-7 10-7c1.7 0 3.2.4 4.5 1M22 12s-3.5 7-10 7c-1.7 0-3.2-.4-4.5-1M3 3l18 18M9.5 9.5a3 3 0 0 0 4 4" /></>,
  printer: <><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M6 14h12v7H6v-7Z" /></>,
};

/** Sub-page header: title + subtitle on the left, optional extra + a "back to
 *  Configuración" pill on the right. */
export function SettingsHeader({ t, title, sub, extra }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        <h1 className="admin-page-title" style={{ margin: 0, fontSize: 32, fontWeight: 800, letterSpacing: -1.1, lineHeight: 1 }}>{title}</h1>
        {sub && <div style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, marginTop: 9 }}>{sub}</div>}
      </div>
      <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
        {extra}
        <Link to="/admin/settings" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 999, background: TK.surface, border: `1px solid ${TK.borderSolid}`, boxShadow: TK.shadow, fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.textSub, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          <Ico ch={DIC.back} size={15} color={TK.textSub} stroke={2.2} />{t('admin.settings.title', 'Settings')}
        </Link>
      </div>
    </div>
  );
}

export const CardHd = ({ icon, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
    {icon && <Ico ch={icon} size={15} color={TK.textFaint} stroke={2} />}
    <span style={{ fontFamily: FK.body, fontSize: 12, fontWeight: 800, letterSpacing: 1.3, textTransform: 'uppercase', color: TK.textFaint }}>{children}</span>
  </div>
);

export const Fld = ({ children, style = {} }) => (
  <div style={{ fontFamily: FK.body, fontSize: 12.5, fontWeight: 600, color: TK.textSub, margin: '14px 0 8px', ...style }}>{children}</div>
);

export const Help = ({ children, style = {} }) => (
  <div style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textFaint, marginTop: 7, lineHeight: 1.45, ...style }}>{children}</div>
);

export function Toggle({ on = true, onClick, disabled = false }) {
  return (
    <span role="switch" aria-checked={on} onClick={disabled ? undefined : onClick} style={{ width: 44, height: 25, borderRadius: 99, cursor: disabled ? 'default' : 'pointer', flexShrink: 0, opacity: disabled ? 0.6 : 1, background: on ? TK.accent : TK.surface3, border: `1px solid ${on ? TK.accent : TK.borderSolid}`, position: 'relative', transition: 'background .2s, border-color .2s', display: 'inline-block' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 21 : 2, width: 19, height: 19, borderRadius: 99, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)', transition: 'left .2s' }} />
    </span>
  );
}

export const fieldStyle = { width: '100%', boxSizing: 'border-box', padding: '12px 15px', borderRadius: 12, background: TK.surface2, border: `1px solid ${TK.borderSolid}`, color: TK.text, outline: 'none', fontFamily: FK.body, fontSize: 14.5 };

/** Real (controlled) text/number input styled to the design field look. */
export function TextField({ mono = false, style = {}, ...rest }) {
  return (
    <input
      {...rest}
      onFocus={(e) => { e.target.style.borderColor = TK.accent; }}
      onBlur={(e) => { e.target.style.borderColor = 'var(--color-admin-border)'; }}
      style={{ ...fieldStyle, fontFamily: mono ? FK.mono : FK.body, ...style }}
    />
  );
}

/** Full-width accent save button (turns success-green + check when saved). */
export function SaveBar({ label, icon = DIC.save, onClick, saving = false, saved = false, savingLabel, savedLabel, disabled = false }) {
  return (
    <button type="button" onClick={onClick} disabled={saving || disabled} style={{
      width: '100%', marginTop: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 11,
      padding: '15px 0', borderRadius: 14, cursor: (saving || disabled) ? 'default' : 'pointer', border: 'none',
      background: saved ? 'var(--color-success)' : TK.accent, color: '#fff', fontFamily: FK.body, fontSize: 15.5, fontWeight: 800,
      letterSpacing: 0.2, boxShadow: '0 6px 18px color-mix(in srgb, var(--color-accent) 32%, transparent)', opacity: (saving || disabled) ? 0.7 : 1,
    }}>
      <Ico ch={saved ? DIC.check : icon} size={18} color="#fff" stroke={2.2} />
      {saving ? (savingLabel || label) : saved ? (savedLabel || label) : label}
    </button>
  );
}
