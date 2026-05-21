import { useState } from 'react';
import {
  Tv, Copy, Check, RefreshCw, Wifi, WifiOff, Monitor, AlertTriangle, ExternalLink,
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

/**
 * AdminTVDisplay — manages the gym's TV display code + connected screens.
 *
 * The admin sees:
 *   - The current 6-char code (large, copyable, also rendered as a QR for
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
                    className="font-mono font-black tabular-nums tracking-[0.25em]"
                    style={{
                      fontSize: '56px',
                      lineHeight: 1,
                      color: 'var(--color-accent)',
                      letterSpacing: '0.25em',
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
                {t('admin.tvDisplay.step2', { defaultValue: 'Type the 6-character code shown above.' })}
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
                <SessionRow key={s.session_id} session={s} />
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

function SessionRow({ session }) {
  const { i18n } = useTranslation();
  const locale = i18n.language === 'es' ? { locale: esLocale } : undefined;
  const browserHint = parseBrowser(session.user_agent);
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
          {browserHint || 'Unknown device'}
        </p>
        <p className="text-[10.5px] font-mono truncate" style={{ color: 'var(--color-text-subtle)' }}>
          {session.session_id.slice(0, 16)}…
        </p>
      </div>
      <div className="text-right">
        <p className="text-[11px] font-semibold flex items-center gap-1 justify-end" style={{ color: session.is_alive ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
          {session.is_alive ? <Wifi size={11} /> : <WifiOff size={11} />}
          {session.is_alive ? 'Live' : 'Dropped'}
        </p>
        <p className="text-[10.5px]" style={{ color: 'var(--color-text-subtle)' }}>
          {formatDistanceToNow(new Date(session.last_heartbeat_at), { addSuffix: true, ...(locale || {}) })}
        </p>
      </div>
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
                    defaultValue: 'A new 6-character code will replace the current one. The old code stops working immediately.',
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
