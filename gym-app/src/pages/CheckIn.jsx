import { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, CheckCircle, QrCode } from 'lucide-react';
import { usePostHog } from '@posthog/react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useTranslation } from 'react-i18next';
import { addPoints } from '../lib/rewardsEngine';
import { format, isToday, isYesterday, formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import QRCodeModal from '../components/QRCodeModal';
import { useCachedState, hasCachedState } from '../hooks/useCachedState';
import { useFeatureEnabled } from '../hooks/usePlatformFlags';

// GPS check-in is intentionally omitted: GPS is reserved for cardio tracking.
// Members check in via QR (admin scan) or manual entry only. Legacy rows with
// method='gps' fall back to the manual label/color when surfaced in history.
const getMethodLabels = (t) => ({ manual: t('checkIn.manual'), qr: t('checkIn.qrScan') });
const METHOD_COLORS = { manual: 'var(--color-text-muted)', qr: 'var(--color-accent)' };

// ── Main ─────────────────────────────────────────────────────────────────────
export default function CheckIn() {
  const navigate  = useNavigate();
  const { user, profile, gymName, gymConfig } = useAuth();
  const { showToast } = useToast();
  const { t, i18n } = useTranslation('pages');
  const dfLocale = i18n.language?.startsWith('es') ? esLocale : undefined;
  const posthog = usePostHog();
  // Platform kill switch (Operations → feature_qr) gates ONLY the QR display
  // section below — check-in history, streak, and admin-side manual check-in
  // keep working while QR is paused.
  const qrEnabled = useFeatureEnabled('qr');

  const checkinsCacheKey = `checkin-list-${user?.id || 'anon'}`;
  const streakCacheKey   = `checkin-streak-${user?.id || 'anon'}`;
  const [checkins,  setCheckins]  = useCachedState(checkinsCacheKey, []);
  // Only show skeleton on a genuine first-ever visit. If we have any cached
  // history, paint from cache instantly and revalidate silently.
  const [loading,   setLoading]   = useState(!hasCachedState(checkinsCacheKey));
  const [showQR,    setShowQR]    = useState(false);

  const qrPayload = profile?.qr_code_payload || null;

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('check_ins')
      .select('id, checked_in_at, method')
      .eq('profile_id', user.id)
      .order('checked_in_at', { ascending: false })
      .limit(50);
    if (data) setCheckins(data);
    setLoading(false);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  useEffect(() => { document.title = `${t('checkIn.title')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  // Already checked in today?
  const todayCheckIn = checkins.find(c => isToday(new Date(c.checked_in_at)));

  // ── Streak (from streak_cache — same source as Navigation) ──────────────────
  // Cached so the streak number paints instantly on remount / app cold start.
  const [streak, setStreak] = useCachedState(streakCacheKey, 0);
  const loadStreak = useCallback(() => {
    if (!user) return;
    supabase
      .from('streak_cache')
      .select('current_streak_days')
      .eq('profile_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setStreak(data.current_streak_days || 0);
      });
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadStreak(); }, [loadStreak]);

  // Keep-alive refresh: /checkin is a core tab that stays mounted, and its
  // whole job is showing data written from OUTSIDE the app — the admin scanner
  // writes the check_in row, and a workout updates the streak. Without this the
  // history + streak stayed frozen at the pre-action state until a full remount
  // (same keep-alive staleness class as the GymWOD fix). Re-pull on foreground
  // and on the workout-changed signal.
  useEffect(() => {
    if (!user) return undefined;
    const refresh = () => { load(); loadStreak(); };
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('tugympr:workouts-changed', refresh);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('tugympr:workouts-changed', refresh);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user, load, loadStreak]);

  // ── Group history by date label ──────────────────────────────────────────────
  const grouped = useMemo(() => checkins.reduce((acc, c) => {
    const d   = new Date(c.checked_in_at);
    const key = isToday(d) ? t('checkIn.today') : isYesterday(d) ? t('checkIn.yesterday') : format(d, 'MMMM d, yyyy', { locale: dfLocale });
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {}), [checkins, t, dfLocale]);

  return (
    <div className="mx-auto w-full max-w-[480px] md:max-w-4xl lg:max-w-6xl px-4 pt-6 pb-28 md:pb-12 animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          aria-label={t('checkIn.goBack', 'Go back')}
          className="w-11 h-11 flex items-center justify-center rounded-xl focus:ring-2 focus:outline-none"
          style={{ backgroundColor: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)', '--tw-ring-color': 'var(--color-accent, #2EC4C4)' }}
        >
          <ArrowLeft size={18} style={{ color: 'var(--color-text-muted)' }} />
        </button>
        <div>
          <h1 className="text-[28px] truncate" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.4px' }}>{t('checkIn.title')}</h1>
          <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('checkIn.subtitle')}</p>
        </div>
      </div>

      {/* ── QR Check-in ──────────────────────────────────────────────────── */}
      <div className="rounded-[22px] overflow-hidden p-5 mb-5 flex flex-col items-center text-center" style={{ backgroundColor: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>

        {todayCheckIn ? (
          <>
            <div
              className="w-36 h-36 rounded-full flex flex-col items-center justify-center gap-2 mb-5"
              style={{ background: 'rgba(16,185,129,0.12)', border: '3px solid rgba(16,185,129,0.4)' }}
            >
              <CheckCircle size={44} style={{ color: 'var(--color-success)' }} strokeWidth={1.5} />
              <p className="text-[13px] font-bold text-[#10B981]">{t('checkIn.checkedIn')}</p>
            </div>
            <p className="text-[15px] font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>{t('checkIn.youreIn')}</p>
            <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('checkIn.checkedInAt', { time: format(new Date(todayCheckIn.checked_in_at), 'h:mm a', { locale: dfLocale }) })}
            </p>
          </>
        ) : qrEnabled ? (
          <>
            {/* QR Code button */}
            <button
              onClick={() => { posthog?.capture('check_in', { method: 'qr' }); setShowQR(true); }}
              aria-label={t('checkIn.showQRAria', 'Show QR code for check-in')}
              className="w-36 h-36 rounded-full flex flex-col items-center justify-center gap-2 mb-5 transition-all duration-300 active:scale-95 focus:ring-2 focus:outline-none"
              style={{
                background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                border: '3px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
                '--tw-ring-color': 'var(--color-accent, #2EC4C4)',
              }}
            >
              <QrCode size={44} style={{ color: 'var(--color-accent)' }} strokeWidth={1.5} />
              <p className="text-[13px] font-bold" style={{ color: 'var(--color-accent, #2EC4C4)' }}>{t('checkIn.showQR')}</p>
            </button>
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('checkIn.showQRInstruction')}
            </p>
          </>
        ) : (
          <>
            {/* QR display paused by the platform kill switch (feature_qr) */}
            <div
              className="w-36 h-36 rounded-full flex flex-col items-center justify-center gap-2 mb-5"
              style={{
                background: 'color-mix(in srgb, var(--color-text-muted) 8%, transparent)',
                border: '3px solid color-mix(in srgb, var(--color-text-muted) 18%, transparent)',
              }}
            >
              <QrCode size={44} style={{ color: 'var(--color-text-subtle)' }} strokeWidth={1.5} />
            </div>
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('checkIn.qrUnavailable', 'QR check-in is temporarily unavailable. Ask the front desk to check you in.')}
            </p>
          </>
        )}

        {/* Streak */}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('tugympr:open-streak-modal'))}
          className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-full active:scale-95 transition-transform focus:outline-none focus:ring-2"
          style={{ background: 'color-mix(in srgb, #FF5A2E 8%, transparent)', border: '1px solid color-mix(in srgb, #FF5A2E 15%, transparent)', '--tw-ring-color': '#FF5A2E' }}
          aria-label={t('checkIn.openStreakDetails', 'Open streak details')}
        >
          <span className="text-[22px] tabular-nums" style={{ color: '#FF5A2E', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 900 }}>{streak}</span>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
            {streak !== 1 ? t('checkIn.daysStreak') : t('checkIn.dayStreak')}
          </span>
        </button>
      </div>

      {/* ── History ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="h-16 rounded-[22px] animate-pulse" style={{ backgroundColor: 'var(--color-bg-card)' }} />
          ))}
        </div>
      ) : checkins.length === 0 ? (
        <div className="rounded-[22px] py-12 text-center" style={{ backgroundColor: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
          <MapPin size={28} style={{ color: 'var(--color-text-muted)', margin: '0 auto 12px' }} strokeWidth={1.5} />
          <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('checkIn.noCheckInsYet')}</p>
        </div>
      ) : (
        <div className="rounded-[22px] overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
          <p className="text-[17px] px-5 pt-4 pb-2" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.3px' }}>{t('checkIn.history')}</p>
          <div className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
            {Object.entries(grouped).map(([label, items]) => (
              <div key={label}>
                <p className="text-[11px] font-bold uppercase tracking-widest px-5 py-2" style={{ color: 'var(--color-text-subtle)' }}>
                  {label}
                </p>
                {items.map(c => (
                  <div key={c.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-[var(--color-surface-hover)] transition-colors duration-200">
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: `${METHOD_COLORS[c.method] ?? 'var(--color-text-muted)'}18` }}
                    >
                      <MapPin size={14} style={{ color: METHOD_COLORS[c.method] ?? 'var(--color-text-muted)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                        {format(new Date(c.checked_in_at), 'h:mm a', { locale: dfLocale })}
                      </p>
                      <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        {t(`checkIn.methods.${c.method}`) ?? c.method}
                      </p>
                    </div>
                    <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
                      {formatDistanceToNow(new Date(c.checked_in_at), { addSuffix: true, locale: dfLocale })}
                    </p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* QR Code Modal — portaled to body so fixed positioning isn't broken by parent transforms.
          qrEnabled guard auto-closes it if the kill switch flips while open. */}
      {showQR && qrEnabled && createPortal(
        <QRCodeModal
          payload={qrPayload}
          memberName={profile?.full_name}
          displayFormat={gymConfig?.qrDisplayFormat}
          gymName={gymName}
          onClose={() => setShowQR(false)}
        />,
        document.body
      )}
    </div>
  );
}
