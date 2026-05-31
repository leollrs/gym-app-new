import { useState } from 'react';
import {
  Tv, Copy, Check, RefreshCw, Wifi, WifiOff, Monitor, AlertTriangle, ExternalLink, Palette,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { logAdminAction } from '../../lib/adminAudit';
import { PageHeader, AdminPageShell, AdminCard, FadeIn } from '../../components/admin';
import { TV_STYLES, derivePalette } from '../../lib/tv/palette';

/**
 * AdminTVDisplay — manages the gym's TV display code + connected screens.
 *
 * The admin sees:
 *   - The current code (large, copyable, also rendered as a QR for
 *     scanning from a phone and loading onto the TV browser).
 *   - The URL the TV should be pointed at.
 *   - Step-by-step setup instructions.
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
  const tvUrl = typeof window !== 'undefined' ? `${window.location.origin}/tv` : '/tv';

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
      const [{ data: settings }, { data: branding }] = await Promise.all([
        supabase.from('gym_tv_settings').select('tv_style').eq('gym_id', gymId).maybeSingle(),
        supabase.from('gym_branding').select('primary_color, accent_color').eq('gym_id', gymId).maybeSingle(),
      ]);
      return {
        currentStyle: settings?.tv_style || 'stadium',
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

  // ── Render ───────────────────────────────────────────────────
  return (
    <AdminPageShell>
      <FadeIn>
        <PageHeader
          title={t('admin.tvDisplay.title', { defaultValue: 'TV Display' })}
          subtitle={t('admin.tvDisplay.subtitle', {
            defaultValue: 'Code-gated leaderboard + challenge screens for the gym floor',
          })}
          actions={
            <button
              onClick={() => setShowRotateConfirm(true)}
              disabled={!code || rotateMutation.isPending}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[12px] font-semibold disabled:opacity-40"
              style={{
                background: 'color-mix(in srgb, var(--color-danger) 12%, transparent)',
                color: 'var(--color-danger)',
                border: '1px solid color-mix(in srgb, var(--color-danger) 25%, transparent)',
              }}
            >
              <RefreshCw size={13} />
              {t('admin.tvDisplay.rotateBtn', { defaultValue: 'Rotate code' })}
            </button>
          }
        />
      </FadeIn>

      {/* ── Code + QR card ──────────────────────────────────────── */}
      <FadeIn delay={40}>
        <AdminCard padding="p-0">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-0">
            <div className="p-6 md:p-8 flex flex-col justify-center">
              <p className="admin-eyebrow mb-3">
                {t('admin.tvDisplay.currentCode', { defaultValue: 'Current code' })}
              </p>
              {codeLoading ? (
                <div className="h-[88px] flex items-center">
                  <p className="text-[14px]" style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
                </div>
              ) : (
                <div className="flex items-center gap-3 flex-wrap mb-5">
                  <p
                    className="font-mono font-black tabular-nums"
                    style={{
                      // clamp so a new 8-char code (migration 0491) doesn't
                      // overflow the card on mobile — shrinks toward 34px on a
                      // phone, stays a big 56px on desktop. Tighter tracking
                      // (0.25em→0.18em) buys room for the 2 extra glyphs.
                      fontSize: 'clamp(34px, 9vw, 56px)',
                      lineHeight: 1,
                      color: 'var(--color-accent)',
                      letterSpacing: '0.18em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {code}
                  </p>
                  <button
                    onClick={() => copy(code, 'code')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors"
                    style={{
                      background: copiedField === 'code'
                        ? 'color-mix(in srgb, var(--color-success) 14%, transparent)'
                        : 'var(--color-bg-hover)',
                      color: copiedField === 'code' ? 'var(--color-success)' : 'var(--color-text-muted)',
                    }}
                  >
                    {copiedField === 'code' ? <Check size={14} /> : <Copy size={14} />}
                    <span className="text-[12px] font-semibold">
                      {copiedField === 'code'
                        ? t('admin.tvDisplay.copied', { defaultValue: 'Copied' })
                        : t('admin.tvDisplay.copy', { defaultValue: 'Copy' })}
                    </span>
                  </button>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <p className="admin-eyebrow mb-1.5">
                    {t('admin.tvDisplay.urlLabel', { defaultValue: 'TV URL' })}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <code
                      className="font-mono text-[13px] px-2.5 py-1.5 rounded-lg"
                      style={{
                        background: 'var(--color-bg-elevated)',
                        color: 'var(--color-text-primary)',
                        border: '1px solid var(--color-border-subtle)',
                      }}
                    >
                      {tvUrl}
                    </code>
                    <button
                      onClick={() => copy(tvUrl, 'url')}
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold transition-colors"
                      style={{
                        color: copiedField === 'url' ? 'var(--color-success)' : 'var(--color-accent)',
                      }}
                    >
                      {copiedField === 'url' ? <Check size={12} /> : <Copy size={12} />}
                      {copiedField === 'url'
                        ? t('admin.tvDisplay.copied', { defaultValue: 'Copied' })
                        : t('admin.tvDisplay.copyUrl', { defaultValue: 'Copy URL' })}
                    </button>
                    <a
                      href={tvUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold"
                      style={{ color: 'var(--color-accent)' }}
                    >
                      <ExternalLink size={12} />
                      {t('admin.tvDisplay.openPreview', { defaultValue: 'Open preview' })}
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* QR — scan from phone to load the TV URL on a screen */}
            <div
              className="p-6 md:p-8 flex flex-col items-center justify-center gap-3"
              style={{ background: 'var(--color-bg-elevated)', borderLeft: '1px solid var(--color-border-subtle)' }}
            >
              <div className="rounded-2xl p-4" style={{ background: '#FFFFFF' }}>
                <QRCodeSVG value={tvUrl} size={180} level="M" bgColor="#FFFFFF" fgColor="#000000" includeMargin={false} />
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-center" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.tvDisplay.qrCaption', { defaultValue: 'Scan to open URL' })}
              </p>
            </div>
          </div>
        </AdminCard>
      </FadeIn>

      {/* ── Style picker ─────────────────────────────────────────
           Four visual themes, each rendered as a small live preview
           tinted with the gym's actual brand colors (via
           derivePalette). Tapping a card switches the style for every
           connected TV — they pick it up on next 30s heartbeat. */}
      <FadeIn delay={60}>
        <AdminCard className="mt-5">
          <div className="flex items-center gap-2 mb-4">
            <Palette size={15} style={{ color: 'var(--color-accent)' }} />
            <p className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {t('admin.tvDisplay.styleTitle', { defaultValue: 'TV display style' })}
            </p>
            {setStyleMutation.isPending && (
              <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.tvDisplay.applying', { defaultValue: 'Applying…' })}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {TV_STYLES.map((style) => {
              const active = styleData?.currentStyle === style.id;
              return (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => !active && setStyleMutation.mutate(style.id)}
                  disabled={setStyleMutation.isPending}
                  className="text-left rounded-xl overflow-hidden transition-all relative group"
                  style={{
                    border: active
                      ? '2px solid var(--color-accent)'
                      : '2px solid var(--color-border-subtle)',
                    background: 'var(--color-bg-elevated)',
                    opacity: setStyleMutation.isPending ? 0.6 : 1,
                  }}
                >
                  <StylePreview
                    styleId={style.id}
                    palette={derivePalette({ primary: styleData?.primary_color, accent: styleData?.accent_color })}
                  />
                  <div className="p-3">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-bold flex-1" style={{ color: 'var(--color-text-primary)' }}>
                        {t(`admin.tvDisplay.style_${style.id}_label`, { defaultValue: style.label })}
                      </p>
                      {active && (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                          style={{
                            background: 'var(--color-accent)',
                            color: 'var(--color-text-on-accent, #000)',
                          }}
                        >
                          <Check size={9} /> {t('admin.tvDisplay.active', { defaultValue: 'Active' })}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--color-text-muted)' }}>
                      {t(`admin.tvDisplay.style_${style.id}_description`, { defaultValue: style.description })}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </AdminCard>
      </FadeIn>

      {/* ── Setup instructions ──────────────────────────────────── */}
      <FadeIn delay={80}>
        <AdminCard className="mt-5">
          <p className="text-[13px] font-bold mb-3" style={{ color: 'var(--color-text-primary)' }}>
            {t('admin.tvDisplay.setupTitle', { defaultValue: 'Set up a TV' })}
          </p>
          <ol className="space-y-2.5 text-[12.5px]" style={{ color: 'var(--color-text-muted)' }}>
            <li className="flex gap-3">
              <span className="font-bold flex-shrink-0 w-5 text-right" style={{ color: 'var(--color-accent)' }}>1.</span>
              <span>
                {t('admin.tvDisplay.step1', {
                  defaultValue: 'Open a browser on your TV / Fire Stick / Chromecast / Apple TV and navigate to the URL above.',
                })}
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-bold flex-shrink-0 w-5 text-right" style={{ color: 'var(--color-accent)' }}>2.</span>
              <span>
                {t('admin.tvDisplay.step2', { defaultValue: 'Type the code shown above.' })}
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-bold flex-shrink-0 w-5 text-right" style={{ color: 'var(--color-accent)' }}>3.</span>
              <span>
                {t('admin.tvDisplay.step3', {
                  defaultValue: 'Leaderboards + active challenges will start rotating automatically. Leave the browser open.',
                })}
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-bold flex-shrink-0 w-5 text-right" style={{ color: 'var(--color-accent)' }}>4.</span>
              <span>
                {t('admin.tvDisplay.step4', {
                  defaultValue: 'If a code leaks, hit "Rotate code" above. All connected TVs disconnect immediately and need the new code.',
                })}
              </span>
            </li>
          </ol>
        </AdminCard>
      </FadeIn>

      {/* ── Multi-TV URL patterns ────────────────────────────────
           For gyms with 2+ TVs that want to dedicate one to challenges,
           run a Spanish + English pair, etc. Each URL bookmarks the
           TV's preferences (same code, different display config). */}
      <FadeIn delay={100}>
        <AdminCard className="mt-5">
          <p className="text-[13px] font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
            {t('admin.tvDisplay.multiTvTitle', { defaultValue: 'Running multiple TVs' })}
          </p>
          <p className="text-[12px] mb-4" style={{ color: 'var(--color-text-muted)' }}>
            {t('admin.tvDisplay.multiTvBody', {
              defaultValue: 'Each TV can use the same code but a different URL. Bookmark whichever URL fits where the screen lives — lobby, weight room, cardio area, bilingual side-by-side.',
            })}
          </p>
          <div className="space-y-2">
            {[
              { suffix: '?track=mixed',         label: t('admin.tvDisplay.urlMixed',         { defaultValue: 'Mixed (default) — leaderboards + challenges interleaved' }) },
              { suffix: '?track=leaderboards',  label: t('admin.tvDisplay.urlLeaderboards',  { defaultValue: 'Leaderboards only — skip challenge slides' }) },
              { suffix: '?track=challenges',    label: t('admin.tvDisplay.urlChallenges',    { defaultValue: 'Challenges only — perfect for a second TV next to the leaderboard' }) },
              { suffix: '?lang=es',             label: t('admin.tvDisplay.urlEs',            { defaultValue: 'Spanish display — overrides auto-detection from gym timezone' }) },
              { suffix: '?lang=en',             label: t('admin.tvDisplay.urlEn',            { defaultValue: 'English display — for a bilingual gym with one EN + one ES TV' }) },
              { suffix: '?lang=es&track=challenges', label: t('admin.tvDisplay.urlComboEsChallenges', { defaultValue: 'Spanish challenges-only TV (combined params)' }) },
            ].map((row) => {
              const full = `${tvUrl}${row.suffix}`;
              const copyKey = `multitv-${row.suffix}`;
              return (
                <div key={row.suffix} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)' }}>
                  <div className="flex-1 min-w-0">
                    <code className="text-[12px] font-mono break-all" style={{ color: 'var(--color-text-primary)' }}>
                      {full}
                    </code>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      {row.label}
                    </p>
                  </div>
                  <button
                    onClick={() => copy(full, copyKey)}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold flex-shrink-0 mt-0.5"
                    style={{ color: copiedField === copyKey ? 'var(--color-success)' : 'var(--color-accent)' }}
                  >
                    {copiedField === copyKey ? <Check size={12} /> : <Copy size={12} />}
                    {copiedField === copyKey
                      ? t('admin.tvDisplay.copied', { defaultValue: 'Copied' })
                      : t('admin.tvDisplay.copy', { defaultValue: 'Copy' })}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] mt-3" style={{ color: 'var(--color-text-subtle)' }}>
            {t('admin.tvDisplay.multiTvNote', {
              defaultValue: 'All TVs share the same code — rotating disconnects every one of them.',
            })}
          </p>
        </AdminCard>
      </FadeIn>

      {/* ── Connected TVs ───────────────────────────────────────── */}
      <FadeIn delay={120}>
        <AdminCard className="mt-5" padding="p-0">
          <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{
                background: aliveCount > 0
                  ? 'color-mix(in srgb, var(--color-success) 14%, transparent)'
                  : 'var(--color-admin-panel)',
              }}
            >
              <Monitor
                size={15}
                style={{ color: aliveCount > 0 ? 'var(--color-success)' : 'var(--color-text-muted)' }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {t('admin.tvDisplay.connectedTitle', { defaultValue: 'Connected TVs' })}
              </p>
              <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {aliveCount === 0
                  ? t('admin.tvDisplay.noneConnected', { defaultValue: 'No TVs currently connected' })
                  : t('admin.tvDisplay.connectedCount', {
                      count: aliveCount,
                      defaultValue: `${aliveCount} TV${aliveCount === 1 ? '' : 's'} alive · heartbeat within 2 min`,
                    })}
              </p>
            </div>
            <span
              className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full"
              style={{
                background: aliveCount > 0 ? 'color-mix(in srgb, var(--color-success) 14%, transparent)' : 'var(--color-bg-hover)',
                color: aliveCount > 0 ? 'var(--color-success)' : 'var(--color-text-muted)',
              }}
            >
              {aliveCount}
            </span>
          </div>

          {sessions.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.tvDisplay.noSessions', {
                  defaultValue: 'No TV has connected yet. Once a screen authenticates, it will appear here.',
                })}
              </p>
            </div>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--color-admin-border)' }}>
              {sessions.map((s) => (
                <SessionRow
                  key={s.session_id}
                  session={s}
                  onRevoke={() => revokeMutation.mutate(s.session_id)}
                  isRevoking={revokeMutation.isPending && revokeMutation.variables === s.session_id}
                />
              ))}
            </ul>
          )}
        </AdminCard>
      </FadeIn>

      {/* ── Rotate confirm modal (inline) ───────────────────────── */}
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
  return (
    <li className="px-5 py-3 flex items-center gap-3">
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{
          background: session.is_alive ? 'var(--color-success)' : 'var(--color-text-subtle)',
          boxShadow: session.is_alive ? '0 0 0 4px color-mix(in srgb, var(--color-success) 25%, transparent)' : 'none',
        }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {browserHint || t('admin.tvDisplay.sessionUnknown', { defaultValue: 'Unknown device' })}
        </p>
        <p className="text-[10.5px] font-mono truncate" style={{ color: 'var(--color-text-subtle)' }}>
          {session.session_id.slice(0, 16)}…
        </p>
      </div>
      <div className="text-right">
        <p className="text-[11px] font-semibold flex items-center gap-1 justify-end" style={{ color: session.is_alive ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
          {session.is_alive ? <Wifi size={11} /> : <WifiOff size={11} />}
          {revoked
            ? t('admin.tvDisplay.sessionDisconnected', { defaultValue: 'Disconnected' })
            : session.is_alive
              ? t('admin.tvDisplay.sessionLive', { defaultValue: 'Live' })
              : t('admin.tvDisplay.sessionDropped', { defaultValue: 'Dropped' })}
        </p>
        <p className="text-[10.5px]" style={{ color: 'var(--color-text-subtle)' }}>
          {formatDistanceToNow(new Date(session.last_heartbeat_at), { addSuffix: true, ...(locale || {}) })}
        </p>
      </div>
      {/* Deactivate — only meaningful while the TV is still alive. Once it has
          dropped/been revoked there's nothing to kick. */}
      {session.is_alive && !revoked && (
        <button
          onClick={onRevoke}
          disabled={isRevoking}
          title={t('admin.tvDisplay.sessionRevoke', { defaultValue: 'Disconnect this TV' })}
          aria-label={t('admin.tvDisplay.sessionRevoke', { defaultValue: 'Disconnect this TV' })}
          className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-40"
          style={{
            background: 'color-mix(in srgb, var(--color-danger) 12%, transparent)',
            color: 'var(--color-danger)',
            border: '1px solid color-mix(in srgb, var(--color-danger) 25%, transparent)',
          }}
        >
          <WifiOff size={12} />
          {isRevoking
            ? t('admin.tvDisplay.sessionRevoking', { defaultValue: 'Disconnecting…' })
            : t('admin.tvDisplay.sessionRevokeBtn', { defaultValue: 'Disconnect' })}
        </button>
      )}
    </li>
  );
}

function RotateConfirm({ aliveCount, isPending, onCancel, onConfirm }) {
  const { t } = useTranslation('pages');
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div
        className="max-w-md w-full rounded-2xl p-6"
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
      >
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'color-mix(in srgb, var(--color-warning) 14%, transparent)' }}
          >
            <AlertTriangle size={18} style={{ color: 'var(--color-warning)' }} />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {t('admin.tvDisplay.rotateConfirmTitle', { defaultValue: 'Rotate TV code?' })}
            </p>
            <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
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
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="px-4 py-2 rounded-xl text-[12.5px] font-semibold"
            style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)' }}
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="px-4 py-2 rounded-xl text-[12.5px] font-bold inline-flex items-center gap-2"
            style={{ background: 'var(--color-danger)', color: '#fff' }}
          >
            <RefreshCw size={13} className={isPending ? 'animate-spin' : ''} />
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
