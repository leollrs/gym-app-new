import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import logger from '../lib/logger';

/**
 * Public unsubscribe / email-preference page (mig 0685). No session, no
 * account, no app — the recipient clicks a link in an inbox.
 *
 * EVERY colour here is a hardcoded hex on an inline style, and every heading
 * carries an explicit `color`. This is not stylistic. Without a session
 * `applyBranding()` never runs, so `--color-text-primary` sits at its LIGHT
 * default, and `index.css` sets `h1,h2,… { color: var(--color-text-primary) }`
 * — a rule on the element beats inherited colour. That is exactly how the
 * headline on /get, /t/:id and /invite/t/:id shipped invisible.
 *
 * `?scope=` supports the one-click case straight from the email footer: the
 * link lands already unsubscribed from that stream, and the page then shows the
 * full switch board so it can be undone or narrowed.
 */

const BG = '#0B0F12';
const CARD = '#151A1F';
const LINE = 'rgba(255,255,255,0.10)';
const TEXT = '#FFFFFF';
const MUTED = 'rgba(255,255,255,0.62)';
const FAINT = 'rgba(255,255,255,0.38)';
const GOLD = '#D4AF37';
const GREEN = '#10B981';

const SCOPES = ['lifecycle', 'classes', 'winback'];

export default function Unsubscribe() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const { t, i18n } = useTranslation('pages');

  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_unsubscribe_context', { p_token: token });
      if (rpcErr) throw rpcErr;
      if (!data?.found) { setError(true); setLoading(false); return; }
      setCtx(data);
      // The member's own language, not the browser's — this link gets opened on
      // whatever device happens to be nearby.
      if (data.language && !String(i18n.language || '').startsWith(String(data.language))) {
        i18n.changeLanguage(data.language);
      }
    } catch (err) {
      logger.error('Unsubscribe: context load failed:', err);
      setError(true);
    }
    setLoading(false);
  }, [token, i18n]);

  // One-click from the footer: honour ?scope= before painting anything, so the
  // page never says "you're still subscribed" to someone who just clicked
  // unsubscribe. List-Unsubscribe-Post clients hit this same URL.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const scope = searchParams.get('scope');
      if (scope && ['all', ...SCOPES].includes(scope)) {
        try {
          await supabase.rpc('unsubscribe_by_token', { p_token: token, p_scope: scope, p_on: false });
        } catch (err) { logger.warn('Unsubscribe: one-click failed:', err?.message); }
      }
      if (!cancelled) await load();
    })();
    return () => { cancelled = true; };
  }, [token, searchParams, load]);

  const setScope = async (scope, on) => {
    setSaving(scope);
    try {
      const { data, error: rpcErr } = await supabase.rpc('unsubscribe_by_token', {
        p_token: token, p_scope: scope, p_on: on,
      });
      if (rpcErr) throw rpcErr;
      if (!data?.success) throw new Error(data?.error || 'FAILED');
      setCtx(prev => prev ? { ...prev, prefs: { ...prev.prefs, [scope]: on } } : prev);
    } catch (err) {
      logger.error('Unsubscribe: toggle failed:', err);
    }
    setSaving(null);
  };

  const shell = (children) => (
    <div style={{
      minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '32px 20px',
      fontFamily: 'Barlow, -apple-system, system-ui, sans-serif',
    }}>
      <div style={{ width: '100%', maxWidth: 460 }}>{children}</div>
    </div>
  );

  if (loading) {
    return shell(
      <p style={{ color: MUTED, fontSize: 14, textAlign: 'center' }}>
        {t('unsubscribe.loading', 'Cargando…')}
      </p>,
    );
  }

  if (error || !ctx) {
    return shell(
      <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 18, padding: '30px 26px', textAlign: 'center' }}>
        <h1 style={{
          fontFamily: '"Barlow Condensed", Barlow, system-ui, sans-serif',
          fontWeight: 800, fontSize: 26, margin: '0 0 8px', color: TEXT,
        }}>
          {t('unsubscribe.invalidTitle', 'Este enlace ya no sirve')}
        </h1>
        <p style={{ fontSize: 14.5, lineHeight: 1.5, color: MUTED, margin: 0 }}>
          {t('unsubscribe.invalidBody', 'Si sigues recibiendo correos que no quieres, responde a cualquiera de ellos y lo resolvemos.')}
        </p>
      </div>,
    );
  }

  const allOff = ctx.prefs.all === false;

  return shell(
    <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 18, overflow: 'hidden' }}>
      <div style={{ padding: '26px 26px 20px', borderBottom: `1px solid ${LINE}` }}>
        <p style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: GOLD, margin: '0 0 6px' }}>
          {ctx.gym_name}
        </p>
        <h1 style={{
          fontFamily: '"Barlow Condensed", Barlow, system-ui, sans-serif',
          fontWeight: 800, fontSize: 28, lineHeight: 1.1, margin: '0 0 8px', color: TEXT,
        }}>
          {ctx.first_name
            ? t('unsubscribe.titleNamed', 'Tus correos, {{name}}', { name: ctx.first_name })
            : t('unsubscribe.title', 'Tus correos')}
        </h1>
        <p style={{ fontSize: 14.5, lineHeight: 1.5, color: MUTED, margin: 0 }}>
          {t('unsubscribe.subtitle', 'Escoge qué quieres recibir. Esto no afecta los correos de tu cuenta — invitaciones, contraseñas y códigos de acceso siguen llegando.')}
        </p>
      </div>

      {allOff ? (
        <div style={{ padding: '26px' }}>
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px',
            borderRadius: 12, background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.25)',
          }}>
            <span style={{ color: GREEN, fontSize: 16, lineHeight: 1.2 }}>✓</span>
            <p style={{ fontSize: 14, lineHeight: 1.5, color: '#A7F3D0', margin: 0 }}>
              {t('unsubscribe.allOff', 'Listo. No vas a recibir más correos de este tipo.')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setScope('all', true)}
            disabled={saving === 'all'}
            style={{
              marginTop: 16, width: '100%', padding: '13px 18px', borderRadius: 12, cursor: 'pointer',
              background: 'transparent', border: `1px solid ${LINE}`, color: MUTED,
              fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
            }}
          >
            {t('unsubscribe.resubscribe', 'Me di de baja por error — volver a suscribirme')}
          </button>
        </div>
      ) : (
        <>
          <div style={{ padding: '8px 0' }}>
            {SCOPES.map(scope => {
              const on = ctx.prefs[scope] !== false;
              return (
                <div key={scope} style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '15px 26px',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: TEXT, margin: '0 0 3px' }}>
                      {t(`unsubscribe.scope.${scope}.title`, scope)}
                    </p>
                    <p style={{ fontSize: 13, lineHeight: 1.45, color: FAINT, margin: 0 }}>
                      {t(`unsubscribe.scope.${scope}.desc`, '')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={t(`unsubscribe.scope.${scope}.title`, scope)}
                    onClick={() => setScope(scope, !on)}
                    disabled={saving === scope}
                    style={{
                      width: 50, height: 30, borderRadius: 999, flexShrink: 0, cursor: 'pointer',
                      border: 'none', padding: 3, transition: 'background 150ms',
                      background: on ? GREEN : 'rgba(255,255,255,0.16)',
                      opacity: saving === scope ? 0.5 : 1,
                    }}
                  >
                    <span style={{
                      display: 'block', width: 24, height: 24, borderRadius: 999, background: '#fff',
                      transform: on ? 'translateX(20px)' : 'translateX(0)', transition: 'transform 150ms',
                    }} />
                  </button>
                </div>
              );
            })}
          </div>

          <div style={{ padding: '16px 26px 26px', borderTop: `1px solid ${LINE}` }}>
            <button
              type="button"
              onClick={() => setScope('all', false)}
              disabled={saving === 'all'}
              style={{
                width: '100%', padding: '13px 18px', borderRadius: 12, cursor: 'pointer',
                background: 'transparent', border: `1px solid ${LINE}`, color: MUTED,
                fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
              }}
            >
              {saving === 'all'
                ? t('unsubscribe.saving', 'Guardando…')
                : t('unsubscribe.unsubAll', 'Darme de baja de todo')}
            </button>
          </div>
        </>
      )}

      {/* Postal address. CAN-SPAM requires a physical address on commercial
          mail, and gyms.address is already stored and rendered nowhere. */}
      {ctx.gym_address && (
        <p style={{
          fontSize: 11.5, lineHeight: 1.5, color: FAINT, textAlign: 'center',
          margin: 0, padding: '0 26px 22px',
        }}>
          {ctx.gym_name} · {ctx.gym_address}
        </p>
      )}
    </div>,
  );
}
