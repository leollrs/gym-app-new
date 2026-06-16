import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, Send, X, Mail, Loader2, Users, BarChart3, Activity, Flame, Trophy, CalendarDays } from 'lucide-react';
import { AdminCard } from '../../../components/admin';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { supabase } from '../../../lib/supabase';
import logger from '../../../lib/logger';
import { DESIGNER_CAMPAIGNS, renderDesignerEmail } from '../../../lib/admin/emailDesignerTemplates';
import DesignerEmail from './designerEmailComponents';
import { ToneIconChip } from './emailTemplateKinds';

// Section header icon + tone per designer campaign (replaces the old emoji).
// Tones resolve to theme tokens via ToneIconChip — dark-mode + white-label safe.
const CAMPAIGN_META = {
  welcome: { Icon: Users, tone: 'teal' },
  recap: { Icon: BarChart3, tone: 'coach' },
  winback: { Icon: Activity, tone: 'warn' },
  streak: { Icon: Flame, tone: 'hot' },
  pr: { Icon: Trophy, tone: 'good' },
  class: { Icon: CalendarDays, tone: 'info' },
};

// Read the live brand colors injected by branding.js so the gallery previews
// show each design in the gym's actual palette. Falls back to the editorial
// defaults inside the renderer if the vars aren't present.
function readBrandColors() {
  if (typeof document === 'undefined') return { primary: '', secondary: '' };
  const css = getComputedStyle(document.documentElement);
  const pick = (...names) => {
    for (const n of names) {
      const v = css.getPropertyValue(n).trim();
      if (v) return v;
    }
    return '';
  };
  return {
    primary: pick('--accent-primary', '--color-accent'),
    secondary: pick('--accent-secondary'),
  };
}

/**
 * Gallery of the 13 polished "Email System" designs (magazine recaps,
 * certificates, boarding-pass class reminders, coach-chat winbacks).
 *
 * These are fixed editorial layouts — not block-editable. The gym picks one,
 * we inject its name + logo + the `{{first_name}}` merge token, and hand it to
 * Outreach (`?designer=<id>`), which re-renders the same HTML at send time.
 *
 * Each card shows a live, scaled iframe of the real rendered email so the
 * admin sees exactly what ships. Tapping a card opens a full-size preview.
 */


// Per-design visual presets for the gallery thumbnail. Each pulls a couple of
// signature elements from the actual design (the bg color, accent, headline
// vibe, optional emoji) so a glance at the card communicates what the design
// IS, without needing to inject the email's table-HTML into the page (which
// fights every CSS reset in the admin app).
const THUMB_PRESETS = {
  'welcome-editorial': { bg: '#f0eee9', ink: '#0B0F12', accent: '#FF5A2E', serif: true, label: { es: 'Empezamos.', en: 'We start now.' }, kicker: { es: '— BIENVENIDA', en: '— WELCOME' } },
  'welcome-poster': { bg: '#FF5A2E', ink: '#ffffff', accent: '#E8C547', label: { es: 'FUERZA LOCAL.', en: 'STRONGER TOGETHER.' }, kicker: { es: 'BIENVENIDO', en: 'WELCOME' }, bold: true },
  'recap-magazine': { bg: '#f0eee9', ink: '#0B0F12', accent: '#FF5A2E', serif: true, label: { es: '6/7', en: '6/7' }, kicker: { es: 'EDICIÓN 47', en: 'ISSUE 47' }, big: true },
  'recap-receipt': { bg: '#ffffff', ink: '#0B0F12', accent: '#FF5A2E', mono: true, label: { es: 'Semana 21', en: 'Week 21' }, kicker: { es: '// RECAP', en: '// RECAP' } },
  'recap-dark': { bg: '#0E1316', ink: '#f0eee9', accent: '#19B8B8', label: { es: 'Buena semana.', en: 'Good week.' }, kicker: { es: 'TU SEMANA', en: 'YOUR WEEK' }, bold: true },
  'winback-quiet': { bg: '#f0eee9', ink: '#0B0F12', accent: '#FF5A2E', serif: true, label: { es: '23', en: '23' }, kicker: { es: 'DÍAS SIN VERNOS', en: 'DAYS SINCE WE SAW YOU' }, big: true, italic: true },
  'winback-data': { bg: '#ffffff', ink: '#0B0F12', accent: '#FF5A2E', label: { es: 'Mientras no estabas:', en: 'While you were away:' }, kicker: { es: 'REPORTE DE AUSENCIA', en: 'ABSENCE REPORT' }, bold: true },
  'winback-text': { bg: '#ffffff', ink: '#0B0F12', accent: '#19B8B8', label: { es: 'oye 👋', en: 'hey 👋' }, kicker: { es: 'Tu entrenador', en: 'Your coach' } },
  'streak-poster': { bg: '#FF5A2E', ink: '#ffffff', accent: '#ffffff', label: { es: '14', en: '14' }, kicker: { es: 'TU RACHA ACTUAL', en: 'YOUR CURRENT STREAK' }, big: true, bold: true },
  'streak-calm': { bg: '#ffffff', ink: '#0B0F12', accent: '#FF5A2E', serif: true, label: { es: '14 días.', en: '14 days.' }, kicker: { es: 'RECORDATORIO', en: 'REMINDER' }, italic: true },
  'pr-certificate': { bg: '#f0eee9', ink: '#0B0F12', accent: '#FF5A2E', serif: true, label: { es: '95kg', en: '95kg' }, kicker: { es: '— RÉCORD PERSONAL —', en: '— PERSONAL RECORD —' }, big: true },
  'pr-bignumber': { bg: '#0B0F12', ink: '#f0eee9', accent: '#E8C547', label: { es: '95kg', en: '95kg' }, kicker: { es: 'NUEVO RÉCORD PERSONAL', en: 'NEW PERSONAL RECORD' }, big: true, bold: true },
  'class-ticket': { bg: '#f0eee9', ink: '#0B0F12', accent: '#FF5A2E', label: { es: '6:30am', en: '6:30am' }, kicker: { es: 'MAÑANA · MARTES', en: 'TOMORROW · TUESDAY' }, bold: true },
  'class-clean': { bg: '#ffffff', ink: '#0B0F12', accent: '#19B8B8', label: { es: 'Mañana a las 6:30am.', en: 'Tomorrow at 6:30am.' }, kicker: { es: 'RECORDATORIO', en: 'REMINDER' }, bold: true },
};

// Renders the actual designed email component, scaled down via CSS transform
// so it fits in a card thumbnail. Because the content is real React DOM (not
// HTML injection), the transform works reliably and Tailwind's resets can't
// collapse the layout.
function DesignerThumb({ id, lang, gymName, gymLogoUrl, primary, secondary }) {
  // The designed emails are authored at a fixed 640px width (real email width).
  // To make each preview FILL its card — instead of floating tiny in the corner —
  // we measure the card and scale the 640px render down to exactly that width
  // (scale = cardWidth / 640). A ResizeObserver keeps it correct across the
  // 1/2/3-column breakpoints and any window resize.
  const DESIGN_W = 640;
  const cardH = 300;
  const ref = useRef(null);
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(w / DESIGN_W);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className="relative w-full overflow-hidden rounded-lg border"
      style={{ height: cardH, borderColor: 'var(--color-border-subtle)', background: '#f0eee9' }}
    >
      <div
        style={{
          width: DESIGN_W,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
        }}
      >
        <DesignerEmail
          id={id}
          lang={lang}
          gymName={gymName}
          gymLogoUrl={gymLogoUrl}
          primaryColor={primary}
          secondaryColor={secondary}
        />
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-16"
        style={{ background: 'linear-gradient(to bottom, transparent, rgba(240,238,233,0.95))' }}
      />
    </div>
  );
}

// Small "send to address X" dialog. Opens on top of (or in place of) the
// preview modal so the admin can pick which inbox to drop the test into —
// their own, a teammate's, or a personal account they actually check.
// Small "send to address X" dialog. Opens on top of the preview modal so the
// admin can pick which inbox to drop the test into — their own, a teammate's,
// or a personal account they actually check.
function SendTestDialog({ open, defaultEmail, sending, onCancel, onSend, t }) {
  if (!open) return null;
  // Re-mount the inner form whenever `defaultEmail` changes so its useState
  // initializer re-runs with the fresh default — no setState-in-effect needed.
  return <SendTestDialogInner key={defaultEmail} defaultEmail={defaultEmail} sending={sending} onCancel={onCancel} onSend={onSend} t={t} />;
}
function SendTestDialogInner({ defaultEmail, sending, onCancel, onSend, t }) {
  const [value, setValue] = useState(defaultEmail || '');
  const [error, setError] = useState('');
  const submit = (e) => {
    e?.preventDefault?.();
    const v = value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setError(t('admin.emailTemplates.sendTestInvalidEmail', 'Enter a valid email'));
      return;
    }
    onSend(v);
  };
  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
      onClick={() => !sending && onCancel()}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-[400px] rounded-2xl shadow-2xl"
        style={{ background: 'var(--color-bg-card, #18181b)', border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-start gap-3 mb-4">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl flex-shrink-0"
              style={{ background: 'color-mix(in srgb, var(--color-accent, #D4AF37) 14%, transparent)' }}
            >
              <Mail size={16} style={{ color: 'var(--color-accent, #D4AF37)' }} />
            </div>
            <div className="min-w-0">
              <p className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary, #fff)' }}>
                {t('admin.emailTemplates.sendTestTitle', 'Send test email')}
              </p>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-muted, #9CA3AF)' }}>
                {t('admin.emailTemplates.sendTestSub', 'Delivers the full design to the address you pick.')}
              </p>
            </div>
          </div>
          <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted, #9CA3AF)', letterSpacing: '0.1em' }}>
            {t('admin.emailTemplates.sendTestTo', 'Send to')}
          </label>
          <input
            type="email"
            value={value}
            onChange={(e) => { setValue(e.target.value); if (error) setError(''); }}
            placeholder="you@example.com"
            autoFocus
            disabled={sending}
            className="w-full rounded-xl px-3 py-2.5 text-[13.5px] outline-none transition-colors"
            style={{
              background: 'var(--color-bg-deep, rgba(255,255,255,0.04))',
              border: `1px solid ${error ? '#EF4444' : 'var(--color-border-subtle, rgba(255,255,255,0.1))'}`,
              color: 'var(--color-text-primary, #fff)',
            }}
          />
          {error && <p className="text-[11px] mt-1.5" style={{ color: '#EF4444' }}>{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: 'var(--color-border-subtle, rgba(255,255,255,0.08))' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="rounded-xl px-3.5 py-2 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
            style={{ color: 'var(--color-text-muted, #9CA3AF)' }}
          >
            {t('admin.emailTemplates.cancel', 'Cancel')}
          </button>
          <button
            type="submit"
            disabled={sending || !value.trim()}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12.5px] font-bold transition-colors disabled:opacity-50"
            style={{ background: 'var(--color-accent, #D4AF37)', color: 'var(--color-text-on-accent, #000)' }}
          >
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {t('admin.emailTemplates.sendTestConfirm', 'Send test')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

// Full-size React-rendered preview using the same per-design preset as the
// thumbnail. Mirrors the design's masthead → kicker → big headline → body →
// CTA → footer rhythm so the admin sees what each design actually FEELS like
// before sending. No iframe / no HTML injection — guaranteed to render.
function DesignerFullPreview({ id, lang, gymName, gymLogoUrl, subject, preview }) {
  const preset = THUMB_PRESETS[id];
  if (!preset) return <div style={{ padding: 24, color: '#5A6570' }}>Preview unavailable</div>;
  const { bg, ink, accent, serif, mono, bold, italic, big, label, kicker } = preset;
  const onBg = ink === '#ffffff' || ink === '#f0eee9';
  const subtle = onBg ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.10)';
  const mutedInk = onBg ? 'rgba(245,242,236,0.7)' : 'rgba(11,15,18,0.6)';
  return (
    <div style={{ background: bg, color: ink, fontFamily: 'Archivo, system-ui, sans-serif', padding: '36px 32px 40px', minHeight: '100%' }}>
      {/* Masthead */}
      <div className="flex items-center justify-between" style={{ marginBottom: 28, paddingBottom: 18, borderBottom: `1px solid ${subtle}` }}>
        <div className="flex items-center gap-2.5">
          {gymLogoUrl
            ? <img src={gymLogoUrl} alt={gymName} style={{ height: 26, width: 'auto', borderRadius: 5 }} />
            : <div style={{ width: 30, height: 30, borderRadius: 7, background: onBg ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent, fontFamily: 'Archivo, sans-serif', fontWeight: 900, fontSize: 14 }}>
                {(gymName || 'G').charAt(0).toUpperCase()}
              </div>}
          <span style={{ fontFamily: 'Archivo, sans-serif', fontWeight: 800, fontSize: 14, color: ink }}>{gymName}</span>
        </div>
        <span style={{ fontFamily: mono ? '"JetBrains Mono", ui-monospace, monospace' : 'Archivo, sans-serif', fontSize: 10, fontWeight: 700, letterSpacing: 1.8, color: mutedInk, textTransform: 'uppercase' }}>
          {lang === 'es' ? 'Vol. 01' : 'Vol. 01'}
        </span>
      </div>

      {/* Kicker */}
      <div style={{ fontFamily: mono ? '"JetBrains Mono", ui-monospace, monospace' : 'Archivo, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: 2.4, color: accent, textTransform: 'uppercase', marginBottom: 20 }}>
        {kicker[lang]}
      </div>

      {/* Hero headline (the design's signature element, big) */}
      <div style={{
        fontFamily: serif ? '"Newsreader", "Times New Roman", serif' : (mono ? '"JetBrains Mono", monospace' : 'Archivo, sans-serif'),
        fontStyle: italic ? 'italic' : 'normal',
        fontWeight: bold ? 900 : (serif ? 400 : 700),
        fontSize: big ? 96 : 48,
        lineHeight: big ? 0.92 : 1.02,
        letterSpacing: big ? -4 : -1.5,
        color: big ? accent : ink,
        margin: 0,
        textTransform: bold && !serif ? 'uppercase' : 'none',
      }}>
        {label[lang]}
      </div>

      {/* Subject line as a deck */}
      <p style={{
        marginTop: 18,
        fontFamily: serif ? '"Newsreader", serif' : 'Archivo, sans-serif',
        fontStyle: serif ? 'italic' : 'normal',
        fontWeight: 400,
        fontSize: 19,
        lineHeight: 1.4,
        color: ink,
        opacity: 0.85,
      }}>
        {subject}
      </p>

      {/* Preview text as body */}
      {preview && (
        <p style={{ marginTop: 14, fontSize: 14.5, lineHeight: 1.55, color: mutedInk }}>
          {preview}
        </p>
      )}

      {/* Member preview chip */}
      <div style={{
        marginTop: 26,
        padding: '14px 16px',
        background: onBg ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
        border: `1px solid ${subtle}`,
        borderRadius: 12,
        fontSize: 12.5,
        color: mutedInk,
        lineHeight: 1.5,
      }}>
        <div style={{ fontWeight: 700, color: ink, marginBottom: 4 }}>
          {lang === 'es' ? 'Para cada miembro' : 'For every member'}
        </div>
        {lang === 'es'
          ? 'Insertamos automáticamente su nombre, su racha, sus sesiones y los días sin venir. Tu logo y tu nombre aparecen en cada correo.'
          : 'We auto-fill their first name, streak, sessions and days inactive. Your logo and gym name appear on every email.'}
      </div>

      {/* CTA */}
      <div style={{ marginTop: 28 }}>
        <span
          style={{
            display: 'inline-block',
            padding: '14px 26px',
            background: accent,
            color: ink === '#ffffff' || ink === '#f0eee9' ? '#0B0F12' : (accent === '#0B0F12' || accent === '#FF5A2E' ? '#fff' : '#0B0F12'),
            fontFamily: 'Archivo, sans-serif',
            fontWeight: 800,
            fontSize: 14,
            letterSpacing: -0.2,
            borderRadius: 999,
          }}
        >
          {lang === 'es' ? 'Abrir la app' : 'Open the app'}
        </span>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 40, paddingTop: 18, borderTop: `1px solid ${subtle}`, textAlign: 'center', fontSize: 11.5, color: mutedInk, lineHeight: 1.6 }}>
        © {new Date().getFullYear()} {gymName}
        <div style={{ marginTop: 4, fontSize: 10, opacity: 0.7 }}>
          {lang === 'es' ? 'Cancelar suscripción · Preferencias' : 'Unsubscribe · Preferences'}
        </div>
      </div>
    </div>
  );
}

// Fit-to-width wrapper for the full-screen preview. Designer emails are a fixed
// 640px canvas; on a phone that overflows the modal and gets clipped (you can't
// reach the right side). Scale it to the available width — capped at 1 so desktop
// still renders at native size — and size the box to the scaled height so the
// whole email simply scrolls vertically.
function ScaledFullEmail(props) {
  const ref = useRef(null);
  const innerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [boxH, setBoxH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) {
        const s = Math.min(1, w / 640);
        setScale(s);
        const natH = innerRef.current?.scrollHeight || 0;
        setBoxH(natH * s);
      }
    };
    measure();
    // Re-measure once the logo / hero images load and change the height.
    const tid = setTimeout(measure, 400);
    if (typeof ResizeObserver === 'undefined') return () => clearTimeout(tid);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(tid); };
  }, []);
  return (
    <div ref={ref} style={{ width: '100%', overflow: 'hidden' }}>
      <div style={{ height: boxH || undefined }}>
        <div ref={innerRef} style={{ width: 640, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <DesignerEmail {...props} />
        </div>
      </div>
    </div>
  );
}

function FullPreviewModal({ entry, html, subject, preview /* eslint-disable-line no-unused-vars */, lang, gymName, gymLogoUrl, primary, secondary, onClose, onUse, onSendTest, sendingTest, testTargetEmail, t }) {
  if (!entry || typeof document === 'undefined') return null;
  // Portal to body so the modal escapes ANY parent stacking context: nothing
  // in the admin shell (transform, overflow, z-index) can clip it or shift it
  // out of view. Pinned to the actual viewport, regardless of page scroll.
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl shadow-2xl"
        style={{ background: 'var(--color-bg-card, #18181b)', border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 flex-shrink-0" style={{ borderColor: 'var(--color-border-subtle, rgba(255,255,255,0.08))' }}>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold" style={{ color: 'var(--color-text-primary, #fff)' }}>{entry.label}</p>
            <p className="truncate text-[11px]" style={{ color: 'var(--color-text-muted, #9CA3AF)' }}>{subject}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition-colors hover:bg-white/[0.08] flex-shrink-0"
            style={{ color: 'var(--color-text-muted, #9CA3AF)' }}
            aria-label={t('admin.emailTemplates.close', 'Close')}
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ background: '#f0eee9' }}>
          <ScaledFullEmail
            id={entry.id}
            lang={lang}
            gymName={gymName}
            gymLogoUrl={gymLogoUrl}
            primaryColor={primary}
            secondaryColor={secondary}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3 flex-shrink-0" style={{ borderColor: 'var(--color-border-subtle, rgba(255,255,255,0.08))' }}>
          <button
            onClick={() => onSendTest(entry.id)}
            disabled={sendingTest || !testTargetEmail || !html}
            title={testTargetEmail || t('admin.emailTemplates.sendTestNoEmail', 'No email on your account')}
            className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'var(--color-bg-deep, rgba(255,255,255,0.06))', color: 'var(--color-text-secondary, #E5E7EB)', border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))' }}
          >
            {sendingTest ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
            {t('admin.emailTemplates.sendTest', 'Send test to me')}
          </button>
          <button
            onClick={() => onUse(entry.id)}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold transition-colors"
            style={{ background: 'var(--color-accent, #D4AF37)', color: 'var(--color-text-on-accent, #000)' }}
          >
            <Send size={14} /> {t('admin.emailTemplates.useInOutreach', 'Use in Outreach')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function EmailDesignerGallery({ gymName, gymLogoUrl }) {
  const { t, i18n } = useTranslation('pages');
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const lang = i18n.language?.startsWith('es') ? 'es' : 'en';
  const [active, setActive] = useState(null);
  const [sendingTest, setSendingTest] = useState(false);
  // When set, the SendTestDialog opens to confirm the destination email for
  // the given designer id. `null` means closed.
  const [testTarget, setTestTarget] = useState(null);

  // Render every template once with the gym's live brand palette. Each render
  // is wrapped in a try/catch — a single bad template shouldn't blank the whole
  // gallery. Failures are logged so we can diagnose if a specific layout broke.
  const { primary, secondary } = useMemo(() => readBrandColors(), [gymName, gymLogoUrl]);
  const rendered = useMemo(() => {
    const map = {};
    for (const campaign of DESIGNER_CAMPAIGNS) {
      for (const item of campaign.items) {
        try {
          map[item.id] = renderDesignerEmail(item.id, {
            lang,
            gymName,
            logoUrl: gymLogoUrl,
            primaryColor: primary,
            secondaryColor: secondary,
            coachName: gymName,
            name: lang === 'es' ? 'José' : 'Alex',
          });
        } catch (err) {
          logger.error('designer render failed', item.id, err);
          map[item.id] = null;
        }
      }
    }
    return map;
  }, [lang, gymName, gymLogoUrl, primary, secondary]);

  const handleUse = (id) => {
    navigate(`/admin/outreach?channel=email&designer=${encodeURIComponent(id)}`);
  };

  // Two-step send-test: clicking "Send test to me" opens a small dialog asking
  // for the destination address (pre-filled with the admin's own email but
  // editable — handy for testing in a real consumer inbox or sending to a
  // teammate). The dialog calls performSendTest with the chosen address.
  const handleSendTest = (id) => setTestTarget({ id, email: user?.email || '' });

  const performSendTest = async (toEmail) => {
    if (!testTarget?.id || !toEmail) return;
    setSendingTest(true);
    try {
      const r = renderDesignerEmail(testTarget.id, {
        lang, gymName, logoUrl: gymLogoUrl,
        primaryColor: primary, secondaryColor: secondary,
        coachName: gymName,
        name: lang === 'es' ? 'José' : 'Alex',
      });
      if (!r?.html) throw new Error('Render returned no HTML');
      const { data: { session } } = await supabase.auth.getSession();
      const { error } = await supabase.functions.invoke('send-admin-email', {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        body: {
          testMode: true,
          to: toEmail,
          subject: `[TEST] ${r.subject}`,
          html: r.html,
        },
      });
      if (error) throw error;
      showToast(t('admin.emailTemplates.sendTestSuccess', { email: toEmail, defaultValue: 'Test sent to {{email}}' }), 'success');
      setTestTarget(null);
    } catch (err) {
      logger.error('send test designer email failed', err);
      showToast(t('admin.emailTemplates.sendTestFailed', 'Test send failed'), 'error');
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="space-y-7">
      <p className="text-[12.5px]" style={{ color: 'var(--color-text-muted)' }}>
        {t('admin.emailTemplates.designerIntro', 'Polished, ready-to-send designs. Your logo, name and each member’s first name are merged in automatically.')}
      </p>

      {DESIGNER_CAMPAIGNS.map((campaign) => {
        const meta = CAMPAIGN_META[campaign.id] || { Icon: Mail, tone: 'neutral' };
        return (
        <section key={campaign.id}>
          <div className="mb-3.5 flex items-center gap-2.5">
            <ToneIconChip icon={meta.Icon} tone={meta.tone} size={30} radius={9} />
            <h3 style={{ fontFamily: 'var(--admin-font-display, "Archivo", system-ui, sans-serif)', fontSize: 16, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>
              {campaign.title[lang]}
            </h3>
            <span
              className="rounded-full px-2 py-0.5 text-[11.5px] font-bold"
              style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', background: 'var(--color-bg-deep)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
            >
              {campaign.items.length}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {campaign.items.map((item) => {
              const r = rendered[item.id];
              const label = item.label[lang];
              return (
                <AdminCard key={item.id} className="group transition-colors hover:border-[#D4AF37]/25" padding="p-3">
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => setActive({ entry: { ...item, label }, rendered: r })}
                    aria-label={t('admin.emailTemplates.previewLabel', { name: label, defaultValue: 'Preview {{name}}' })}
                  >
                    <DesignerThumb id={item.id} lang={lang} gymName={gymName} gymLogoUrl={gymLogoUrl} primary={primary} secondary={secondary} />
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{label}</p>
                        <p className="truncate text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{r?.subject || '—'}</p>
                      </div>
                      <Eye size={14} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                    </div>
                  </button>
                  <div className="mt-2.5 flex items-center gap-2">
                    <button
                      onClick={() => handleUse(item.id)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors"
                      style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 22%, transparent)' }}
                    >
                      <Send size={13} /> {t('admin.emailTemplates.useInOutreach', 'Use in Outreach')}
                    </button>
                  </div>
                </AdminCard>
              );
            })}
          </div>
        </section>
        );
      })}

      <FullPreviewModal
        entry={active?.entry}
        html={active?.rendered?.html}
        subject={active?.rendered?.subject}
        preview={active?.rendered?.preview}
        lang={lang}
        gymName={gymName}
        gymLogoUrl={gymLogoUrl}
        primary={primary}
        secondary={secondary}
        onClose={() => setActive(null)}
        onUse={handleUse}
        onSendTest={handleSendTest}
        sendingTest={sendingTest}
        testTargetEmail={user?.email || ''}
        t={t}
      />
      <SendTestDialog
        open={!!testTarget}
        defaultEmail={testTarget?.email || ''}
        sending={sendingTest}
        onCancel={() => !sendingTest && setTestTarget(null)}
        onSend={performSendTest}
        t={t}
      />
    </div>
  );
}
