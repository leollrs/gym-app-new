import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, Download } from 'lucide-react';
import { STRATA_FONT_DISPLAY, STRATA_HOT } from './strataTokens';
import ShareCard, {
  SHARE_FORMATS, SHARE_TEMPLATES, SHARE_FILTERS,
  sessionFromFeedItem,
} from './ShareCard';

const ACCENT_SWATCHES = [
  { value: '#FF5A2E', labelKey: 'share.accentHotOrange',  labelDefault: 'Hot orange' },
  { value: '#2EC4C4', labelKey: 'share.accentTeal',       labelDefault: 'Teal' },
  { value: '#E8C547', labelKey: 'share.accentGold',       labelDefault: 'Gold' },
  { value: '#7B5BD9', labelKey: 'share.accentCoachPurple', labelDefault: 'Coach purple' },
  { value: '#0a0d10', labelKey: 'share.accentInk',         labelDefault: 'Ink' },
];

const TEMPLATE_LABELS = {
  photo:   { key: 'share.templatePhoto',   default: 'Photo' },
  stats:   { key: 'share.templateStats',   default: 'Stats' },
  minimal: { key: 'share.templateMinimal', default: 'Minimal' },
};

// ─── Format glyph: tiny rectangle showing aspect ratio ────────────────────
function FormatGlyph({ w, h, active, color, baseColor }) {
  const W = 14;
  const ratio = w / h;
  const sw = ratio > 1 ? W : W * ratio;
  const sh = ratio > 1 ? W / ratio : W;
  return (
    <svg width={W} height={W} viewBox={`0 0 ${W} ${W}`}>
      <rect
        x={(W - sw) / 2}
        y={(W - sh) / 2}
        width={sw}
        height={sh}
        rx="1.5"
        fill="none"
        stroke={active ? color : baseColor}
        strokeWidth="1.4"
      />
    </svg>
  );
}

export default function ShareCustomize({
  open, item, profile, gymName = 'TuGymPR', onClose, onSave, t,
}) {
  const [fmt, setFmt] = useState('story');
  const [tpl, setTpl] = useState('photo');
  const [branding, setBranding] = useState(true);
  const [accent, setAccent] = useState(STRATA_HOT);
  const [filter, setFilter] = useState('moody');
  const stats = useMemo(() => ['duration', 'volume', 'exercises', 'pr'], []);

  // lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // close on Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !item) return null;
  const session = sessionFromFeedItem(item, profile);
  const PREVIEW_W = 240;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('social.customize', 'Customize share')}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 220,
        background: 'var(--color-bg-primary)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* nav bar */}
      <div
        className="flex items-center gap-3"
        style={{
          paddingTop: 'max(20px, env(safe-area-inset-top))',
          padding: '20px 16px 12px',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-card)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.back', 'Back')}
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)' }}
        >
          <ChevronLeft size={20} strokeWidth={2.2} />
        </button>
        <div className="flex-1 min-w-0">
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
            }}
          >
            {t('social.share', 'Share')}
          </div>
          <div
            style={{
              fontFamily: STRATA_FONT_DISPLAY,
              fontSize: 17,
              fontWeight: 800,
              color: 'var(--color-text-primary)',
              letterSpacing: -0.4,
            }}
          >
            {t('social.customize', 'Customize')}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onSave?.({ fmt, tpl, branding, accent, filter, stats })}
          className="inline-flex items-center gap-1.5"
          style={{
            padding: '8px 14px',
            borderRadius: 999,
            border: 'none',
            background: accent,
            color: '#fff',
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: 0.2,
          }}
        >
          <Download size={13} strokeWidth={2.4} />
          {t('social.save', 'Save')}
        </button>
      </div>

      {/* scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {/* format tabs */}
        <div
          className="flex"
          style={{
            gap: 6,
            padding: '14px 16px 10px',
            overflowX: 'auto',
            scrollbarWidth: 'none',
          }}
        >
          {Object.keys(SHARE_FORMATS).map((k) => {
            const f = SHARE_FORMATS[k];
            const isOn = k === fmt;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setFmt(k)}
                className="inline-flex items-center gap-1.5 transition-colors"
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: isOn ? 'var(--color-text-primary)' : 'var(--color-bg-secondary)',
                  color: isOn ? 'var(--color-bg-card)' : 'var(--color-text-muted)',
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 0.2,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <FormatGlyph
                  w={f.w}
                  h={f.h}
                  active={isOn}
                  color="var(--color-bg-card)"
                  baseColor="var(--color-text-muted)"
                />
                {f.label}
              </button>
            );
          })}
        </div>

        {/* preview */}
        <div
          className="flex justify-center items-center"
          style={{ padding: '14px 16px 18px', minHeight: 280 }}
        >
          <ShareCard
            format={fmt}
            template={tpl}
            displayW={PREVIEW_W}
            branding={branding}
            accent={accent}
            filter={filter}
            stats={stats}
            session={session}
            gymName={gymName}
          />
        </div>

        {/* template tabs */}
        <div style={{ padding: '0 16px 14px' }}>
          <SectionLabel>{t('social.template', 'Template')}</SectionLabel>
          <div className="flex gap-2">
            {SHARE_TEMPLATES.map((id) => {
              const isOn = id === tpl;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTpl(id)}
                  className="flex-1"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 12,
                    background: isOn ? 'var(--color-bg-card)' : 'var(--color-bg-secondary)',
                    border: `1.5px solid ${isOn ? accent : 'transparent'}`,
                    fontSize: 12,
                    fontWeight: 800,
                    color: isOn ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    letterSpacing: 0.2,
                    cursor: 'pointer',
                    transition: 'all 150ms',
                  }}
                >
                  {TEMPLATE_LABELS[id] ? t(TEMPLATE_LABELS[id].key, TEMPLATE_LABELS[id].default) : id}
                </button>
              );
            })}
          </div>
        </div>

        {/* options card */}
        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* branding */}
          <div
            className="flex items-center gap-3"
            style={{
              padding: '12px 14px',
              borderRadius: 14,
              background: 'var(--color-bg-card)',
              boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 6px 18px rgba(15,20,25,0.04)',
            }}
          >
            <div
              className="flex items-center justify-center"
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: 'color-mix(in srgb, var(--color-accent, #2EC4C4) 15%, transparent)',
              }}
            >
              <span
                style={{
                  fontFamily: STRATA_FONT_DISPLAY,
                  fontWeight: 800,
                  fontSize: 13,
                  color: 'var(--color-accent, #2EC4C4)',
                }}
              >
                G
              </span>
            </div>
            <div className="flex-1" style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              {t('social.brandingLabel', 'Show {{gym}} branding', { gym: gymName })}
            </div>
            <Toggle value={branding} onChange={setBranding} accent={accent} />
          </div>

          {/* accent swatches */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 14,
              background: 'var(--color-bg-card)',
              boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 6px 18px rgba(15,20,25,0.04)',
            }}
          >
            <SectionLabel>{t('social.accentColor', 'Accent color')}</SectionLabel>
            <div className="flex gap-2">
              {ACCENT_SWATCHES.map((s) => {
                const label = t(s.labelKey, s.labelDefault);
                return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setAccent(s.value)}
                  title={label}
                  aria-label={label}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: s.value,
                    border:
                      accent === s.value
                        ? '2px solid var(--color-text-primary)'
                        : '2px solid transparent',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
                );
              })}
            </div>
          </div>

          {/* filter strip */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 14,
              background: 'var(--color-bg-card)',
              boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 6px 18px rgba(15,20,25,0.04)',
            }}
          >
            <SectionLabel>{t('social.photoFilter', 'Photo filter')}</SectionLabel>
            <div className="flex gap-2" style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
              {SHARE_FILTERS.map((f) => {
                const isOn = f === filter;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className="flex flex-col items-center gap-1 flex-shrink-0"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 9,
                        overflow: 'hidden',
                        border: `2px solid ${isOn ? accent : 'transparent'}`,
                        position: 'relative',
                      }}
                    >
                      <ShareCard
                        format="square"
                        template="photo"
                        displayW={40}
                        branding={false}
                        accent={accent}
                        filter={f}
                        stats={[]}
                        session={session}
                        gymName={gymName}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: 0.4,
                        color: isOn ? accent : 'var(--color-text-muted)',
                        textTransform: 'uppercase',
                      }}
                    >
                      {f}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 800,
        color: 'var(--color-text-muted)',
        letterSpacing: 1.2,
        marginBottom: 8,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  );
}

function Toggle({ value, onChange, accent }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      style={{
        width: 36,
        height: 20,
        borderRadius: 999,
        padding: 2,
        background: value ? accent : 'var(--color-border-strong)',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        transition: 'background 150ms',
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: 999,
          background: '#fff',
          transform: value ? 'translateX(16px)' : 'translateX(0)',
          transition: 'transform 150ms',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  );
}
