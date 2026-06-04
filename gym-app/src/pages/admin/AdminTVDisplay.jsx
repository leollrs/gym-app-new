import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { logAdminAction } from '../../lib/adminAudit';
import { AdminPageShell, FadeIn } from '../../components/admin';
import { TV_STYLES, derivePalette } from '../../lib/tv/palette';
import { PROD_WEB_URL } from '../../lib/appUrls';
import { TK, FK, TONE, Ico, Card } from './components/retosKit';

/* ── local inline-icon path map (mock's TVIC) ── */
const TVIC = {
  rotate: <><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>,
  ext: <><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2 0-1.5 1-2 2-2h2a3 3 0 0 0 3-3 9 9 0 0 0-9-9Z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></>,
  check: <path d="m5 12 4.5 4.5L19 7" />,
  tv: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  wifi: <><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01" /></>,
  wifiOff: <><path d="m2 2 20 20M8.5 16a5 5 0 0 1 6.3-.6M5 12.5a10 10 0 0 1 4-2.6M16.7 9.9A10 10 0 0 1 19 12.5M12 19.5h.01" /></>,
  alert: <><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>,
};

/**
 * AdminTVDisplay — manages the gym's TV display code + connected screens.
 *
 * The admin sees:
 *   - The current code (large, copyable, also rendered as a QR for
 *     scanning from a phone and loading onto the TV browser).
 *   - The URL the TV should be pointed at.
 *   - A live preview style picker (4 themes, brand-tinted).
 *   - Step-by-step setup instructions.
 *   - Multi-TV URL patterns.
 *   - Live list of connected TVs (heartbeat within last 2 min = alive).
 *   - Rotate button — generates a new code and immediately invalidates
 *     all currently-connected TVs (they bounce to the code-entry screen).
 */
export default function AdminTVDisplay() {
  const { profile } = useAuth();
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  const [copiedField, setCopiedField] = useState(null);
  const [showRotateConfirm, setShowRotateConfirm] = useState(false);

  // The TV URL the admin will type / scan onto each screen. Uses the live
  // origin so it Just Works whether they're on the deployed domain, a
  // staging URL, or localhost during testing.
  // Canonical public TV URL the gym enters on the actual TV / shares as a QR.
  // In dev, window.location.origin is localhost (unreachable from a TV/phone),
  // so use the production app URL; in prod the real serving origin is correct
  // (handles custom domains). "Open preview" keeps the local origin so a dev
  // can preview against local data.
  const appBase = import.meta.env.DEV ? PROD_WEB_URL : (typeof window !== 'undefined' ? window.location.origin : PROD_WEB_URL);
  const tvUrl = `${appBase}/tv`;
  const previewUrl = `${typeof window !== 'undefined' ? window.location.origin : appBase}/tv`;

  // ── Code fetch (lazy-init on first load) ─────────────────────
  const { data: codeData, isLoading: codeLoading } = useQuery({
    queryKey: ['admin-tv-code', gymId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_or_create_tv_code', {
        p_gym_id: gymId,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!gymId,
    // Long staleTime — the code rarely changes unless explicitly rotated.
    staleTime: 5 * 60_000,
  });

  // ── Current TV style + branding (for the live previews) ──────
  // Pulls the current style choice + the gym's brand colors so the
  // picker thumbnails render in the same palette they'll use on the
  // actual TV. Both come straight from gym_tv_settings + gym_branding.
  const { data: styleData } = useQuery({
    queryKey: ['admin-tv-style', gymId],
    queryFn: async () => {
      const brandingP = supabase.from('gym_branding').select('primary_color, accent_color').eq('gym_id', gymId).maybeSingle();
      // Resilient to pre-0518 schema: retry without tv_period if the column
      // isn't there yet so the style picker still loads.
      let res = await supabase.from('gym_tv_settings').select('tv_style, tv_period').eq('gym_id', gymId).maybeSingle();
      if (res.error && /tv_period/i.test(res.error.message || '')) {
        res = await supabase.from('gym_tv_settings').select('tv_style').eq('gym_id', gymId).maybeSingle();
      }
      const settings = res.data;
      const { data: branding } = await brandingP;
      return {
        currentStyle: settings?.tv_style || 'stadium',
        currentPeriod: settings?.tv_period || 'month',
        primary_color: branding?.primary_color,
        accent_color: branding?.accent_color,
      };
    },
    enabled: !!gymId,
    staleTime: 30_000,
  });

  // ── Style change mutation ────────────────────────────────────
  const setStyleMutation = useMutation({
    mutationFn: async (newStyle) => {
      const { data, error } = await supabase.rpc('admin_set_tv_style', {
        p_gym_id: gymId,
        p_style: newStyle,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, newStyle) => {
      logAdminAction('tv_style_changed', 'gym', gymId, { style: newStyle });
      queryClient.setQueryData(['admin-tv-style', gymId], (prev) => ({
        ...(prev || {}),
        currentStyle: newStyle,
      }));
      showToast(
        t('admin.tvDisplay.styleChanged', { defaultValue: 'Style updated — connected TVs will switch within 30s.' }),
        'success',
      );
    },
    onError: () => {
      showToast(
        t('admin.tvDisplay.styleChangeFailed', { defaultValue: 'Could not update style.' }),
        'error',
      );
    },
  });

  // ── Leaderboard period change mutation ───────────────────────
  const setPeriodMutation = useMutation({
    mutationFn: async (newPeriod) => {
      const { data, error } = await supabase.rpc('admin_set_tv_period', {
        p_gym_id: gymId,
        p_period: newPeriod,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, newPeriod) => {
      logAdminAction('tv_period_changed', 'gym', gymId, { period: newPeriod });
      queryClient.setQueryData(['admin-tv-style', gymId], (prev) => ({
        ...(prev || {}),
        currentPeriod: newPeriod,
      }));
      showToast(
        t('admin.tvDisplay.periodChanged', { defaultValue: 'Range updated — connected TVs will switch within 30s.' }),
        'success',
      );
    },
    onError: () => {
      showToast(
        t('admin.tvDisplay.periodChangeFailed', { defaultValue: 'Could not update range.' }),
        'error',
      );
    },
  });

  // ── Sessions list (auto-refetch every 30s to keep alive count fresh) ──
  const { data: sessions = [] } = useQuery({
    queryKey: ['admin-tv-sessions', gymId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_tv_sessions', {
        p_gym_id: gymId,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const aliveCount = sessions.filter((s) => s.is_alive).length;

  // ── Rotate mutation ──────────────────────────────────────────
  const rotateMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('admin_rotate_tv_code', {
        p_gym_id: gymId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      logAdminAction('tv_code_rotated', 'gym', gymId, { rotated_at: data.rotated_at });
      queryClient.setQueryData(['admin-tv-code', gymId], data);
      queryClient.invalidateQueries({ queryKey: ['admin-tv-sessions', gymId] });
      setShowRotateConfirm(false);
      showToast(
        t('admin.tvDisplay.codeRotated', { defaultValue: 'New code generated. All connected TVs disconnected.' }),
        'success',
      );
    },
    onError: () => {
      showToast(
        t('admin.tvDisplay.rotateFailed', { defaultValue: 'Could not rotate code. Try again.' }),
        'error',
      );
    },
  });

  // ── Revoke ONE session (surgical disconnect) ─────────────────
  // Unlike rotate (which kills every TV), this disconnects just the one
  // screen on its next ≤30s heartbeat. The TV bounces to the code-entry
  // screen and can reconnect by re-entering the same code.
  const revokeMutation = useMutation({
    mutationFn: async (sessionId) => {
      const { data, error } = await supabase.rpc('admin_revoke_tv_session', {
        p_gym_id: gymId,
        p_session_id: sessionId,
      });
      if (error) throw error;
      if (data && data.success === false) throw new Error(data.error || 'revoke_failed');
      return data;
    },
    onSuccess: (_data, sessionId) => {
      logAdminAction('tv_session_revoked', 'gym', gymId, { session_id: sessionId });
      queryClient.invalidateQueries({ queryKey: ['admin-tv-sessions', gymId] });
      showToast(
        t('admin.tvDisplay.sessionRevoked', { defaultValue: 'TV disconnected. It will drop within 30 seconds.' }),
        'success',
      );
    },
    onError: () => {
      showToast(
        t('admin.tvDisplay.sessionRevokeFailed', { defaultValue: 'Could not disconnect that TV. Try again.' }),
        'error',
      );
    },
  });

  const copy = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1600);
    } catch {
      showToast('Copy failed', 'error');
    }
  };

  const code = codeData?.code || '';

  const eyebrow = {
    fontFamily: FK.body, fontSize: 11.5, fontWeight: 800, letterSpacing: 1.6,
    textTransform: 'uppercase', color: TK.textFaint,
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <AdminPageShell>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        {/* ── Header ─────────────────────────────────────────── */}
        <FadeIn>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ margin: 0, fontFamily: FK.display, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1, color: TK.text }}>
                {t('admin.tvDisplay.title', { defaultValue: 'TV Display' })}
              </h1>
              <div style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, marginTop: 9 }}>
                {t('admin.tvDisplay.subtitle', { defaultValue: 'Code-gated leaderboard + challenge screens for the gym floor' })}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowRotateConfirm(true)}
              disabled={!code || rotateMutation.isPending}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 999,
                cursor: !code || rotateMutation.isPending ? 'default' : 'pointer', flexShrink: 0,
                background: TK.accentWash, border: `1px solid ${TK.accentLine}`,
                fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.accent,
                opacity: !code || rotateMutation.isPending ? 0.5 : 1,
              }}
            >
              <Ico ch={TVIC.rotate} size={16} color={TK.accent} stroke={2.1} />
              {t('admin.tvDisplay.rotateBtn', { defaultValue: 'Rotate code' })}
            </button>
          </div>
        </FadeIn>

        {/* ── Code + QR card ─────────────────────────────────── */}
        <FadeIn delay={40}>
          <Card style={{ padding: 0, marginTop: 22, overflow: 'hidden' }}>
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px]">
              <div style={{ padding: '30px 32px' }}>
                <div style={eyebrow}>{t('admin.tvDisplay.currentCode', { defaultValue: 'Current code' })}</div>
                {codeLoading ? (
                  <div style={{ height: 70, display: 'flex', alignItems: 'center' }}>
                    <span style={{ fontFamily: FK.body, fontSize: 14, color: TK.textMute }}>
                      {t('admin.tvDisplay.loading', { defaultValue: 'Loading…' })}
                    </span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', margin: '12px 0 26px' }}>
                    <span
                      style={{
                        fontFamily: FK.mono, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                        // clamp so a new 8-char code (migration 0491) doesn't overflow on
                        // mobile — shrinks toward 34px on a phone, big on desktop.
                        fontSize: 'clamp(34px, 9vw, 46px)', letterSpacing: '0.12em',
                        color: TK.accent, lineHeight: 1, whiteSpace: 'nowrap',
                      }}
                    >
                      {code}
                    </span>
                    <button
                      type="button"
                      onClick={() => copy(code, 'code')}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 10, cursor: 'pointer',
                        background: copiedField === 'code' ? 'var(--color-success-soft)' : TK.surface2,
                        border: `1px solid ${copiedField === 'code' ? 'color-mix(in srgb, var(--color-success) 35%, transparent)' : TK.borderSolid}`,
                        fontFamily: FK.body, fontSize: 13.5, fontWeight: 700,
                        color: copiedField === 'code' ? 'var(--color-success)' : TK.textSub,
                      }}
                    >
                      <Ico ch={copiedField === 'code' ? TVIC.check : TVIC.copy} size={15} color={copiedField === 'code' ? 'var(--color-success)' : TK.textSub} stroke={2} />
                      {copiedField === 'code'
                        ? t('admin.tvDisplay.copied', { defaultValue: 'Copied' })
                        : t('admin.tvDisplay.copy', { defaultValue: 'Copy' })}
                    </button>
                  </div>
                )}

                <div style={eyebrow}>{t('admin.tvDisplay.urlLabel', { defaultValue: 'TV URL' })}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', marginTop: 11 }}>
                  <code
                    style={{
                      padding: '12px 16px', borderRadius: 11, background: TK.surface2, border: `1px solid ${TK.borderSolid}`,
                      fontFamily: FK.mono, fontSize: 14, fontWeight: 600, color: TK.text, wordBreak: 'break-all',
                    }}
                  >
                    {tvUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(tvUrl, 'url')}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', background: 'none', border: 'none', padding: 0,
                      fontFamily: FK.body, fontSize: 13.5, fontWeight: 700,
                      color: copiedField === 'url' ? 'var(--color-success)' : TK.accent,
                    }}
                  >
                    <Ico ch={copiedField === 'url' ? TVIC.check : TVIC.copy} size={14} color={copiedField === 'url' ? 'var(--color-success)' : TK.accent} stroke={2} />
                    {copiedField === 'url'
                      ? t('admin.tvDisplay.copied', { defaultValue: 'Copied' })
                      : t('admin.tvDisplay.copyUrl', { defaultValue: 'Copy URL' })}
                  </button>
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none',
                      fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.accent,
                    }}
                  >
                    <Ico ch={TVIC.ext} size={14} color={TK.accent} stroke={2} />
                    {t('admin.tvDisplay.openPreview', { defaultValue: 'Open preview' })}
                  </a>
                </div>
              </div>

              {/* QR — scan from phone to load the TV URL on a screen */}
              <div
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24,
                  background: TK.surface2, borderStyle: 'solid', borderColor: TK.divider,
                }}
                // mobile: card stacks → divider on top; desktop: side-by-side → divider on left
                className="border-t border-l-0 lg:border-t-0 lg:border-l"
              >
                <div style={{ padding: 10, background: '#fff', borderRadius: 14, border: `1px solid ${TK.borderSolid}` }}>
                  <QRCodeSVG value={tvUrl} size={140} level="M" bgColor="#FFFFFF" fgColor="#000000" includeMargin={false} />
                </div>
                <span style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: TK.textMute, textAlign: 'center', lineHeight: 1.5 }}>
                  {t('admin.tvDisplay.qrCaption', { defaultValue: 'Scan to open URL' })}
                </span>
              </div>
            </div>
          </Card>
        </FadeIn>

        {/* ── Style picker ─────────────────────────────────────
             Four visual themes, each rendered as a small live preview
             tinted with the gym's actual brand colors (via
             derivePalette). Tapping a card switches the style for every
             connected TV — they pick it up on next 30s heartbeat. */}
        <FadeIn delay={60}>
          <Card style={{ padding: '24px 26px', marginTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
              <Ico ch={TVIC.palette} size={17} color={TK.accent} stroke={2} />
              <span style={{ fontFamily: FK.display, fontSize: 18, fontWeight: 800, letterSpacing: -0.4, color: TK.text }}>
                {t('admin.tvDisplay.styleTitle', { defaultValue: 'TV display style' })}
              </span>
              {setStyleMutation.isPending && (
                <span style={{ fontFamily: FK.body, fontSize: 11.5, color: TK.textMute }}>
                  {t('admin.tvDisplay.applying', { defaultValue: 'Applying…' })}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" style={{ gap: 16 }}>
              {TV_STYLES.map((style) => {
                const active = styleData?.currentStyle === style.id;
                return (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => !active && setStyleMutation.mutate(style.id)}
                    disabled={setStyleMutation.isPending}
                    style={{
                      textAlign: 'left', borderRadius: 18, padding: 11, overflow: 'hidden',
                      cursor: setStyleMutation.isPending ? 'default' : 'pointer', transition: 'all .15s',
                      background: TK.surface,
                      border: `2px solid ${active ? TK.accent : TK.borderSolid}`,
                      boxShadow: active ? '0 4px 16px color-mix(in srgb, var(--color-accent) 16%, transparent)' : TK.shadow,
                      opacity: setStyleMutation.isPending ? 0.6 : 1,
                    }}
                  >
                    <div style={{ borderRadius: 12, overflow: 'hidden' }}>
                      <StylePreview
                        styleId={style.id}
                        palette={derivePalette({ primary: styleData?.primary_color, accent: styleData?.accent_color })}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '13px 4px 0' }}>
                      <span style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, letterSpacing: -0.3, color: TK.text }}>
                        {t(`admin.tvDisplay.style_${style.id}_label`, { defaultValue: style.label })}
                      </span>
                      {active && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999,
                          background: TK.accent, color: '#fff', fontFamily: FK.body, fontSize: 10.5, fontWeight: 800,
                          letterSpacing: 0.6, textTransform: 'uppercase', flexShrink: 0,
                        }}>
                          <Ico ch={TVIC.check} size={12} color="#fff" stroke={3} />
                          {t('admin.tvDisplay.active', { defaultValue: 'Active' })}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: '7px 4px 4px', fontFamily: FK.body, fontSize: 13, color: TK.textMute, lineHeight: 1.45 }}>
                      {t(`admin.tvDisplay.style_${style.id}_description`, { defaultValue: style.description })}
                    </p>
                  </button>
                );
              })}
            </div>
          </Card>
        </FadeIn>

        {/* ── Leaderboard time range ─────────────────────────── */}
        <FadeIn delay={70}>
          <Card style={{ padding: '24px 26px', marginTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
              <Ico ch={<><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>} size={17} color={TK.accent} stroke={2} />
              <span style={{ fontFamily: FK.display, fontSize: 18, fontWeight: 800, letterSpacing: -0.4, color: TK.text }}>
                {t('admin.tvDisplay.periodTitle', { defaultValue: 'Leaderboard time range' })}
              </span>
              {setPeriodMutation.isPending && (
                <span style={{ fontFamily: FK.body, fontSize: 11.5, color: TK.textMute }}>
                  {t('admin.tvDisplay.applying', { defaultValue: 'Applying…' })}
                </span>
              )}
            </div>
            <p style={{ margin: '0 0 16px', fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, lineHeight: 1.5, maxWidth: 660 }}>
              {t('admin.tvDisplay.periodHint', { defaultValue: 'Window for the Volume, Workouts, and Check-ins boards. Top PRs stay all-time; Most Improved and Consistency stay monthly.' })}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                ['today', t('admin.tvDisplay.periodToday', { defaultValue: 'Today' })],
                ['week',  t('admin.tvDisplay.periodWeek',  { defaultValue: 'This week' })],
                ['month', t('admin.tvDisplay.periodMonth', { defaultValue: 'Last 30 days' })],
                ['90d',   t('admin.tvDisplay.period90',    { defaultValue: 'Last 90 days' })],
                ['all',   t('admin.tvDisplay.periodAll',   { defaultValue: 'All time' })],
              ].map(([id, label]) => {
                const active = (styleData?.currentPeriod || 'month') === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => !active && setPeriodMutation.mutate(id)}
                    disabled={setPeriodMutation.isPending}
                    style={{
                      padding: '9px 17px', borderRadius: 999,
                      cursor: setPeriodMutation.isPending ? 'default' : 'pointer',
                      fontFamily: FK.body, fontSize: 13, fontWeight: active ? 700 : 600,
                      color: active ? '#fff' : TK.textSub,
                      background: active ? TK.accent : TK.surface,
                      border: `1px solid ${active ? TK.accent : TK.borderSolid}`,
                      opacity: setPeriodMutation.isPending && !active ? 0.6 : 1,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </Card>
        </FadeIn>

        {/* ── Setup instructions ─────────────────────────────── */}
        <FadeIn delay={80}>
          <Card style={{ padding: '24px 26px', marginTop: 18 }}>
            <div style={{ fontFamily: FK.display, fontSize: 18, fontWeight: 800, letterSpacing: -0.4, color: TK.text, marginBottom: 4 }}>
              {t('admin.tvDisplay.setupTitle', { defaultValue: 'Set up a TV' })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
              {[
                t('admin.tvDisplay.step1', { defaultValue: 'Open a browser on your TV / Fire Stick / Chromecast / Apple TV and navigate to the URL above.' }),
                t('admin.tvDisplay.step2', { defaultValue: 'Type the code shown above.' }),
                t('admin.tvDisplay.step3', { defaultValue: 'Leaderboards + active challenges will start rotating automatically. Leave the browser open.' }),
                t('admin.tvDisplay.step4', { defaultValue: 'If a code leaks, hit "Rotate code" above. All connected TVs disconnect immediately and need the new code.' }),
              ].map((txt, i) => (
                <div key={i} style={{ display: 'flex', gap: 14 }}>
                  <span style={{
                    width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center',
                    background: TK.accentSoft, border: `1px solid ${TK.accentLine}`,
                    fontFamily: FK.display, fontSize: 13, fontWeight: 800, color: TK.accentInk,
                  }}>{i + 1}</span>
                  <span style={{ fontFamily: FK.body, fontSize: 14.5, color: TK.textSub, lineHeight: 1.5, paddingTop: 2 }}>{txt}</span>
                </div>
              ))}
            </div>
          </Card>
        </FadeIn>

        {/* ── Multi-TV URL patterns ──────────────────────────── */}
        <FadeIn delay={100}>
          <Card style={{ padding: '24px 26px', marginTop: 18 }}>
            <div style={{ fontFamily: FK.display, fontSize: 18, fontWeight: 800, letterSpacing: -0.4, color: TK.text, marginBottom: 4 }}>
              {t('admin.tvDisplay.multiTvTitle', { defaultValue: 'Running multiple TVs' })}
            </div>
            <p style={{ margin: '6px 0 16px', fontFamily: FK.body, fontSize: 14, color: TK.textMute, lineHeight: 1.55, maxWidth: 760 }}>
              {t('admin.tvDisplay.multiTvBody', { defaultValue: 'Each TV can use the same code but a different URL. Bookmark whichever URL fits where the screen lives — lobby, weight room, cardio area, bilingual side-by-side.' })}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { suffix: '?track=mixed',              label: t('admin.tvDisplay.urlMixed',            { defaultValue: 'Mixed (default) — leaderboards + challenges interleaved' }) },
                { suffix: '?track=leaderboards',       label: t('admin.tvDisplay.urlLeaderboards',     { defaultValue: 'Leaderboards only — skip challenge slides' }) },
                { suffix: '?track=challenges',         label: t('admin.tvDisplay.urlChallenges',       { defaultValue: 'Challenges only — perfect for a second TV next to the leaderboard' }) },
                { suffix: '?lang=es',                  label: t('admin.tvDisplay.urlEs',               { defaultValue: 'Spanish display — overrides auto-detection from gym timezone' }) },
                { suffix: '?lang=en',                  label: t('admin.tvDisplay.urlEn',               { defaultValue: 'English display — for a bilingual gym with one EN + one ES TV' }) },
                { suffix: '?lang=es&track=challenges', label: t('admin.tvDisplay.urlComboEsChallenges',{ defaultValue: 'Spanish challenges-only TV (combined params)' }) },
                { suffix: '?track=mixed&lang=es',      label: t('admin.tvDisplay.urlComboEsMixed',     { defaultValue: 'Spanish mixed — leaderboards + challenges in Spanish' }) },
              ].map((row) => {
                const full = `${tvUrl}${row.suffix}`;
                const copyKey = `multitv-${row.suffix}`;
                const copied = copiedField === copyKey;
                return (
                  <div key={row.suffix} style={{
                    display: 'flex', alignItems: 'center', gap: 16, padding: '15px 18px', borderRadius: 13,
                    background: TK.surface2, border: `1px solid ${TK.borderSolid}`,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: FK.mono, fontSize: 14, fontWeight: 600, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{full}</div>
                      <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, marginTop: 5 }}>{row.label}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => copy(full, copyKey)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10, cursor: 'pointer', flexShrink: 0,
                        background: TK.surface, border: `1px solid ${copied ? 'color-mix(in srgb, var(--color-success) 35%, transparent)' : TK.borderSolid}`,
                        fontFamily: FK.body, fontSize: 13, fontWeight: 700, color: copied ? 'var(--color-success)' : TK.accent,
                      }}
                    >
                      <Ico ch={copied ? TVIC.check : TVIC.copy} size={14} color={copied ? 'var(--color-success)' : TK.accent} stroke={2} />
                      {copied
                        ? t('admin.tvDisplay.copied', { defaultValue: 'Copied' })
                        : t('admin.tvDisplay.copy', { defaultValue: 'Copy' })}
                    </button>
                  </div>
                );
              })}
            </div>
            <p style={{ margin: '16px 0 0', fontFamily: FK.body, fontSize: 12, color: TK.textFaint }}>
              {t('admin.tvDisplay.multiTvNote', { defaultValue: 'All TVs share the same code — rotating disconnects every one of them.' })}
            </p>
          </Card>
        </FadeIn>

        {/* ── Connected TVs ──────────────────────────────────── */}
        <FadeIn delay={120}>
          <Card style={{ padding: 0, marginTop: 18, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '18px 22px', borderBottom: `1px solid ${TK.divider}` }}>
              <span style={{
                width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'grid', placeItems: 'center',
                background: aliveCount > 0 ? TONE.good.bg : TK.surface2,
                border: `1px solid ${aliveCount > 0 ? TONE.good.line : TK.borderSolid}`,
              }}>
                <Ico ch={TVIC.tv} size={18} color={aliveCount > 0 ? TONE.good.ink : TK.textMute} stroke={2} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, letterSpacing: -0.3, color: TK.text }}>
                  {t('admin.tvDisplay.connectedTitle', { defaultValue: 'Connected TVs' })}
                </div>
                <div style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textMute, marginTop: 2 }}>
                  {aliveCount === 0
                    ? t('admin.tvDisplay.noneConnected', { defaultValue: 'No TVs currently connected' })
                    : t('admin.tvDisplay.connectedCount', {
                        count: aliveCount,
                        defaultValue: `${aliveCount} TV${aliveCount === 1 ? '' : 's'} alive · heartbeat within 2 min`,
                      })}
                </div>
              </div>
              <span style={{
                fontFamily: FK.mono, fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', padding: '4px 11px', borderRadius: 999,
                background: aliveCount > 0 ? TONE.good.bg : TK.surface2,
                color: aliveCount > 0 ? TONE.good.ink : TK.textMute,
              }}>{aliveCount}</span>
            </div>

            {sessions.length === 0 ? (
              <div style={{ padding: '32px 22px', textAlign: 'center' }}>
                <span style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute }}>
                  {t('admin.tvDisplay.noSessions', { defaultValue: 'No TV has connected yet. Once a screen authenticates, it will appear here.' })}
                </span>
              </div>
            ) : (
              <div>
                {sessions.map((s) => (
                  <SessionRow
                    key={s.session_id}
                    session={s}
                    onRevoke={() => revokeMutation.mutate(s.session_id)}
                    isRevoking={revokeMutation.isPending && revokeMutation.variables === s.session_id}
                  />
                ))}
              </div>
            )}
          </Card>
        </FadeIn>
      </div>

      {/* ── Rotate confirm modal (inline) ──────────────────────── */}
      {showRotateConfirm && (
        <RotateConfirm
          aliveCount={aliveCount}
          isPending={rotateMutation.isPending}
          onCancel={() => setShowRotateConfirm(false)}
          onConfirm={() => rotateMutation.mutate()}
        />
      )}
    </AdminPageShell>
  );
}

function SessionRow({ session, onRevoke, isRevoking }) {
  const { t, i18n } = useTranslation('pages');
  const locale = i18n.language === 'es' ? { locale: esLocale } : undefined;
  const browserHint = parseBrowser(session.user_agent);
  // A revoked row reads as "Disconnected" regardless of last heartbeat — the
  // RPC already forces is_alive=false for revoked sessions, but guard here too.
  const revoked = !!session.revoked_at;
  const live = session.is_alive;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 22px', borderTop: `1px solid ${TK.divider}` }}>
      <span style={{
        width: 8, height: 8, borderRadius: 99, flexShrink: 0,
        background: live ? 'var(--color-success)' : TK.textFaint,
        boxShadow: live ? '0 0 0 4px color-mix(in srgb, var(--color-success) 25%, transparent)' : 'none',
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.text }}>
          {browserHint || t('admin.tvDisplay.sessionUnknown', { defaultValue: 'Unknown device' })}
        </div>
        <div style={{ fontFamily: FK.mono, fontSize: 11, color: TK.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.session_id.slice(0, 16)}…
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end', fontFamily: FK.body, fontSize: 12, fontWeight: 700, color: live ? 'var(--color-success)' : TK.textMute }}>
          <Ico ch={live ? TVIC.wifi : TVIC.wifiOff} size={12} color={live ? 'var(--color-success)' : TK.textMute} stroke={2} />
          {revoked
            ? t('admin.tvDisplay.sessionDisconnected', { defaultValue: 'Disconnected' })
            : live
              ? t('admin.tvDisplay.sessionLive', { defaultValue: 'Live' })
              : t('admin.tvDisplay.sessionDropped', { defaultValue: 'Dropped' })}
        </div>
        <div style={{ fontFamily: FK.body, fontSize: 11, color: TK.textFaint, marginTop: 1 }}>
          {formatDistanceToNow(new Date(session.last_heartbeat_at), { addSuffix: true, ...(locale || {}) })}
        </div>
      </div>
      {/* Deactivate — only meaningful while the TV is still alive. Once it has
          dropped/been revoked there's nothing to kick. */}
      {live && !revoked && (
        <button
          type="button"
          onClick={onRevoke}
          disabled={isRevoking}
          title={t('admin.tvDisplay.sessionRevoke', { defaultValue: 'Disconnect this TV' })}
          aria-label={t('admin.tvDisplay.sessionRevoke', { defaultValue: 'Disconnect this TV' })}
          style={{
            flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 999,
            cursor: isRevoking ? 'default' : 'pointer', opacity: isRevoking ? 0.5 : 1,
            background: 'transparent', border: '1px solid color-mix(in srgb, var(--color-danger) 26%, transparent)',
            fontFamily: FK.body, fontSize: 12, fontWeight: 700, color: 'var(--color-danger)',
          }}
        >
          <Ico ch={TVIC.wifiOff} size={13} color="var(--color-danger)" stroke={2} />
          {isRevoking
            ? t('admin.tvDisplay.sessionRevoking', { defaultValue: 'Disconnecting…' })
            : t('admin.tvDisplay.sessionRevokeBtn', { defaultValue: 'Disconnect' })}
        </button>
      )}
    </div>
  );
}

function RotateConfirm({ aliveCount, isPending, onCancel, onConfirm }) {
  const { t } = useTranslation('pages');
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div style={{ maxWidth: 440, width: '100%', borderRadius: 18, padding: 24, background: TK.surface, border: `1px solid ${TK.borderSolid}`, boxShadow: TK.shadowLg }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13, marginBottom: 16 }}>
          <span style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'grid', placeItems: 'center', background: TONE.warn.bg, border: `1px solid ${TONE.warn.line}` }}>
            <Ico ch={TVIC.alert} size={19} color={TONE.warn.ink} stroke={2.1} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FK.display, fontSize: 17, fontWeight: 800, letterSpacing: -0.3, color: TK.text }}>
              {t('admin.tvDisplay.rotateConfirmTitle', { defaultValue: 'Rotate TV code?' })}
            </div>
            <p style={{ margin: '6px 0 0', fontFamily: FK.body, fontSize: 13, color: TK.textMute, lineHeight: 1.5 }}>
              {aliveCount > 0
                ? t('admin.tvDisplay.rotateConfirmBodyAlive', {
                    count: aliveCount,
                    defaultValue: `${aliveCount} connected TV${aliveCount === 1 ? '' : 's'} will disconnect immediately. You'll need to type the new code on each one.`,
                  })
                : t('admin.tvDisplay.rotateConfirmBody', {
                    defaultValue: 'A new code will replace the current one. The old code stops working immediately.',
                  })}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            style={{
              padding: '10px 18px', borderRadius: 999, cursor: isPending ? 'default' : 'pointer',
              background: TK.surface2, border: `1px solid ${TK.borderSolid}`,
              fontFamily: FK.body, fontSize: 13, fontWeight: 700, color: TK.textSub, opacity: isPending ? 0.6 : 1,
            }}
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 999,
              cursor: isPending ? 'default' : 'pointer', border: 'none', background: 'var(--color-danger)', color: '#fff',
              fontFamily: FK.body, fontSize: 13, fontWeight: 700, opacity: isPending ? 0.7 : 1,
            }}
          >
            <span className={isPending ? 'animate-spin' : ''} style={{ display: 'inline-flex' }}>
              <Ico ch={TVIC.rotate} size={14} color="#fff" stroke={2.4} />
            </span>
            {isPending
              ? t('admin.tvDisplay.rotating', { defaultValue: 'Rotating…' })
              : t('admin.tvDisplay.rotateConfirm', { defaultValue: 'Rotate now' })}
          </button>
        </div>
      </div>
    </div>
  );
}

// Style preview thumbnails — tiny stylized renderings of each TV theme
// using the gym's actual brand palette. Not pixel-perfect mockups; just
// distinctive enough that the admin can pick at a glance.
function StylePreview({ styleId, palette }) {
  const baseProps = { palette };
  switch (styleId) {
    case 'brutal':    return <PreviewBrutal {...baseProps} />;
    case 'boricua':   return <PreviewBoricua {...baseProps} />;
    case 'telemetry': return <PreviewTelemetry {...baseProps} />;
    case 'stadium':
    default:          return <PreviewStadium {...baseProps} />;
  }
}

function PreviewStadium({ palette }) {
  return (
    <div className="h-32 px-3 py-2.5" style={{
      background: `radial-gradient(120px 70px at 18% -10%, ${palette.hotGlow}, transparent 60%),
                   radial-gradient(90px 60px at 100% 110%, ${palette.tealGlow}, transparent 55%),
                   linear-gradient(180deg, ${palette.ink} 0%, #06090C 100%)`,
    }}>
      <div className="text-[8px] font-bold uppercase tracking-widest" style={{ color: palette.hot }}>● Live</div>
      <div className="text-[22px] font-black uppercase mt-0.5" style={{ color: '#fff', letterSpacing: '-1px', lineHeight: 1 }}>VOLUME</div>
      <div className="flex gap-1.5 mt-2 items-end">
        <div className="flex-1 rounded p-1.5 relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${palette.ink2}, ${palette.ink})`, border: `1px solid ${palette.hotSoft}` }}>
          <div className="text-[16px] font-black tabular-nums leading-none" style={{ color: palette.hot, letterSpacing: '-0.5px' }}>34K</div>
          <div className="text-[7px] mt-0.5 truncate" style={{ color: '#fff' }}>María R.</div>
        </div>
        <div className="w-12 flex flex-col gap-0.5">
          <div className="rounded px-1 py-0.5 text-[7px] font-bold flex justify-between" style={{ background: palette.ink2, color: '#fff' }}>
            <span style={{ color: palette.coach }}>2</span>
            <span>28K</span>
          </div>
          <div className="rounded px-1 py-0.5 text-[7px] font-bold flex justify-between" style={{ background: palette.ink2, color: '#fff' }}>
            <span style={{ color: palette.teal }}>3</span>
            <span>22K</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewBrutal({ palette }) {
  return (
    <div className="h-32 px-3 py-2.5 relative" style={{ background: palette.cream, color: palette.ink }}>
      <div className="absolute top-0 right-0 bottom-0 w-1.5" style={{ background: palette.hot }} />
      <div className="absolute top-0 left-0 bottom-0 w-1.5" style={{ background: palette.ink }} />
      <div className="px-1.5">
        <div className="text-[7px] font-mono font-bold uppercase tracking-widest" style={{ color: palette.hot }}>● Live · The Board</div>
        <div className="text-[24px] font-black uppercase mt-0.5" style={{ letterSpacing: '-1.5px', lineHeight: 0.85 }}>
          VOLUME<span style={{ color: palette.hot }}>.</span>
        </div>
        <div className="mt-1 space-y-0.5">
          {[
            { r: 1, n: 'MARÍA', v: '34,720', c: palette.hot },
            { r: 2, n: 'JOSÉ',  v: '28,200', c: palette.coach },
            { r: 3, n: 'CARLOS', v: '22,150', c: palette.teal },
          ].map((row) => (
            <div key={row.r} className="grid grid-cols-[14px_1fr_42px] gap-1.5 items-center text-[8px] font-black" style={{ borderBottom: `0.5px solid ${palette.textInkFaint}` }}>
              <span style={{ color: row.c }}>{String(row.r).padStart(2, '0')}</span>
              <span style={{ letterSpacing: '-0.3px' }}>{row.n}</span>
              <span className="text-right tabular-nums">{row.v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewBoricua({ palette }) {
  const sky1 = palette.hot;
  return (
    <div className="h-32 px-3 py-2.5 relative overflow-hidden" style={{
      background: `linear-gradient(180deg, ${sky1} 0%, #FF8A3D 35%, #E83E14 60%, #3D1E5A 90%, #0B1428 100%)`,
      color: '#fff',
    }}>
      <div className="absolute top-1/2 left-1/2 w-24 h-24 rounded-full -translate-x-1/2 -translate-y-1/2" style={{
        background: 'radial-gradient(circle, rgba(255,243,199,0.6), transparent 70%)',
      }} />
      <div className="text-[7px] font-extrabold uppercase tracking-widest text-center opacity-90 relative">Los Más Fuertes</div>
      <div className="text-[20px] font-black uppercase text-center mt-0.5 relative" style={{ letterSpacing: '-1px', lineHeight: 0.9, textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
        VOLUMEN
      </div>
      <div className="grid grid-cols-3 gap-1 mt-2 items-end relative">
        {[2, 1, 3].map((rank) => (
          <div key={rank} className="rounded-t p-1" style={{
            height: rank === 1 ? '54px' : rank === 2 ? '44px' : '38px',
            background: rank === 1
              ? `linear-gradient(180deg, #FFE38A, #FFB04A, #FF6A20)`
              : rank === 2 ? '#FFF' : 'rgba(255,230,200,0.85)',
            color: palette.ink,
          }}>
            <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black" style={{
              background: rank === 1 ? '#FFF' : rank === 2 ? palette.coach : palette.teal,
              color: rank === 1 ? palette.hot : '#FFF',
              border: '1px solid #FFF',
            }}>{rank}</div>
            <div className="text-[8px] font-black tabular-nums text-center mt-0.5" style={{ letterSpacing: '-0.3px' }}>
              {rank === 1 ? '34K' : rank === 2 ? '28K' : '22K'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewTelemetry({ palette }) {
  return (
    <div className="h-32 px-2 py-2 font-mono relative" style={{ background: '#06090C', color: '#fff' }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `repeating-linear-gradient(0deg, ${palette.tealSoft} 0 1px, transparent 1px 3px)`,
      }} />
      <div className="relative text-[7px] tracking-widest font-bold" style={{ color: palette.teal }}>OPS // FEED ▸ leaderboard</div>
      <div className="relative text-[18px] font-black uppercase mt-1" style={{ letterSpacing: '-0.8px', lineHeight: 1 }}>
        VOLUME<span style={{ color: palette.teal }}>_</span>
      </div>
      <div className="relative mt-1 space-y-0.5">
        {[
          { r: 1, n: 'maria_r',  v: '34,720', c: palette.hot },
          { r: 2, n: 'jose_v',   v: '28,200', c: palette.amber },
          { r: 3, n: 'carlos_h', v: '22,150', c: palette.teal },
          { r: 4, n: 'lola_a',   v: '19,400', c: 'rgba(255,255,255,0.5)' },
        ].map((row) => (
          <div key={row.r} className="grid grid-cols-[14px_1fr_44px] gap-1 items-center text-[8px] font-bold tabular-nums" style={{ borderBottom: `0.5px solid ${palette.tealSoft}` }}>
            <span style={{ color: row.c }}>{String(row.r).padStart(2, '0')}</span>
            <span style={{ color: 'rgba(255,255,255,0.85)' }}>@{row.n}</span>
            <span className="text-right">{row.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Tiny user-agent sniffer — enough to label the row "iPad Safari" / "Chrome
// on Windows" so the admin can tell their lobby TV from their treadmill TV.
function parseBrowser(ua) {
  if (!ua) return null;
  const browser = /Chrome\//i.test(ua) ? 'Chrome'
              : /Firefox\//i.test(ua) ? 'Firefox'
              : /Safari\//i.test(ua) ? 'Safari'
              : /Edg\//i.test(ua) ? 'Edge'
              : 'Browser';
  const os = /iPad|iPhone/i.test(ua) ? 'iOS'
          : /Android/i.test(ua) ? 'Android'
          : /Windows/i.test(ua) ? 'Windows'
          : /Mac OS X/i.test(ua) ? 'macOS'
          : /CrOS/i.test(ua) ? 'Chrome OS'
          : /Linux/i.test(ua) ? 'Linux'
          : 'Device';
  return `${browser} on ${os}`;
}
