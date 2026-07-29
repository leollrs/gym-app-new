import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Activity, Dumbbell, RefreshCw, Settings } from 'lucide-react';
import { AppleHealthIcon, PoweredByHealthKit } from '../components/AppleHealthBadge';
import PermissionExplainerModal from '../components/PermissionExplainerModal';
import { isAvailable, readTodaySteps, readWeeklyActivitySummary } from '../lib/healthSync';
import { ensurePermission } from '../lib/devicePermissions';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import logger from '../lib/logger';
import { usePostHog } from '@posthog/react';

const HealthSync = () => {
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
  const { user } = useAuth();
  const { showToast } = useToast();
  const posthog = usePostHog();

  const [connected, setConnected] = useState(false);
  const [available, setAvailable] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [todaySteps, setTodaySteps] = useState(0);
  // null = HealthKit gave us nothing (no data, or the read was denied —
  // HealthKit does not distinguish). Rendered as an em dash, never guessed.
  const [weeklyCalories, setWeeklyCalories] = useState(null);
  // Permission explainer modal — shown before triggering the OS prompt so
  // the user understands *why* we want Health access (App Store 5.1.1).
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const explainerResolverRef = useRef(null);

  const openExplainer = useCallback(() => new Promise((resolve) => {
    explainerResolverRef.current = resolve;
    setExplainerOpen(true);
  }), []);

  const handleExplainerAgree = useCallback(() => {
    const resolve = explainerResolverRef.current;
    explainerResolverRef.current = null;
    setExplainerOpen(false);
    resolve?.(true);
  }, []);

  const handleExplainerCancel = useCallback(() => {
    const resolve = explainerResolverRef.current;
    explainerResolverRef.current = null;
    setExplainerOpen(false);
    resolve?.(false);
  }, []);

  // Check availability
  useEffect(() => {
    if (/iphone|ipad/i.test(navigator.userAgent)) {
      setAvailable(true);
    } else {
      isAvailable().then(setAvailable);
    }
  }, []);

  // Restore connected state from DB (fall back to localStorage)
  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      if (user?.id) {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('health_sync_enabled')
            .eq('id', user.id)
            .single();
          if (!cancelled && data?.health_sync_enabled != null) {
            setConnected(data.health_sync_enabled);
            // Keep localStorage cache in sync
            localStorage.setItem('tugympr_health_connected', String(data.health_sync_enabled));
            return;
          }
        } catch {
          // Column may not exist yet; fall through to localStorage
        }
      }
      // Fallback: localStorage
      if (!cancelled && localStorage.getItem('tugympr_health_connected') === 'true') {
        setConnected(true);
      }
    };
    restore();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Fetch activity data when connected
  const fetchActivity = useCallback(async () => {
    if (!connected || !available) return;
    setRefreshing(true);
    try {
      const ok = await isAvailable();
      if (!ok) { setRefreshing(false); return; }
      const [steps, weekly] = await Promise.all([
        readTodaySteps(),
        readWeeklyActivitySummary(),
      ]);
      setTodaySteps(steps);
      // NO ESTIMATE. This used to fall back to `steps * 0.04` whenever HealthKit
      // returned no active-energy data — under a card that says "Data from
      // Apple Health", which made an invented number look like a reading. And
      // it fires often: HealthKit deliberately reports DENIED read permissions
      // as empty results rather than errors, so "user didn't grant calories" is
      // indistinguishable from "zero calories" and both landed on the guess.
      // A dash is honest; a fabricated 2,631 is not.
      setWeeklyCalories(weekly.calories > 0 ? weekly.calories : null);
    } catch {}
    setRefreshing(false);
  }, [connected, available]);

  useEffect(() => { fetchActivity(); }, [fetchActivity]);

  // Persist health_sync_enabled to profiles table + localStorage cache
  const persistConnected = useCallback(async (enabled) => {
    localStorage.setItem('tugympr_health_connected', String(enabled));
    if (user?.id) {
      try {
        await supabase
          .from('profiles')
          .update({ health_sync_enabled: enabled })
          .eq('id', user.id);
      } catch {
        // DB write failed; localStorage still has the value as cache
      }
    }
  }, [user?.id]);

  // Connect — shows the explainer modal first, then triggers the OS Health
  // permission sheet via ensurePermission (which is what the Settings page
  // uses for camera/location/notifications, so behaviour is consistent).
  const isIOS = /iphone|ipad/i.test(navigator.userAgent);
  const handleConnect = async () => {
    setConnecting(true);
    try {
      const status = await ensurePermission('health', () => openExplainer());
      if (status !== 'granted') {
        const msg = status === 'unsupported'
          ? t('healthSync.permissionUnsupported', { defaultValue: 'Health data isn’t available on this device.' })
          : t('healthSync.permissionDenied', { defaultValue: 'Permission denied. Open Settings to enable Health access.' });
        showToast?.(msg, status === 'unsupported' ? 'info' : 'error');
        setConnecting(false);
        return;
      }
      setConnected(true);
      await persistConnected(true);
      posthog?.capture('health_sync_connected', { provider: isIOS ? 'apple' : 'google' });
      localStorage.setItem('tugympr_health_settings', JSON.stringify({
        syncWeight: true, syncWorkouts: true, importWeight: true,
      }));
    } catch (err) {
      logger.warn?.('handleConnect: permission flow failed', err);
      showToast?.(t('healthSync.permissionFailed', { defaultValue: 'Could not enable Health sync.' }), 'error');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setConnected(false);
    await persistConnected(false);
    posthog?.capture('health_sync_disconnected');
    localStorage.setItem('tugympr_health_settings', JSON.stringify({
      syncWeight: false, syncWorkouts: false, importWeight: false,
    }));
    setTodaySteps(0);
    setWeeklyCalories(null);
  };


  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      {/* Header */}
      <div className="sticky sticky-under-appbar z-30 backdrop-blur-2xl" style={{ backgroundColor: 'var(--color-bg-nav)', borderBottom: '1px solid var(--color-border-default)' }}>
        <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto flex items-center gap-3 px-4 py-3">
          <button type="button" onClick={() => navigate(-1)} aria-label={t('healthSync.goBack', 'Go back')} className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors flex-shrink-0 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={{ color: 'var(--color-text-muted)' }}>
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-[22px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{t('healthSync.title')}</h1>
        </div>
      </div>

      <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 pb-28 md:pb-12 pt-4 space-y-6">
        {/* Connection Card */}
        <div className="rounded-2xl p-5 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: connected ? 'rgba(255,45,85,0.1)' : 'rgba(255,45,85,0.06)' }}>
              <AppleHealthIcon size={26} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[16px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                {isIOS ? 'Apple Health' : 'Health Connect'}
              </p>
              <p className="text-[12px]" style={{ color: connected ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                {connected ? t('healthSync.syncingHealthData') : t('healthSync.notConnected')}
              </p>
            </div>
          </div>

          {connected ? (
            <div className="space-y-3">
              <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                  {t('healthSync.connectedDesc', 'Weight, workouts, and activity data are syncing automatically. Manage permissions in Settings > Health.')}
                </p>
              </div>
              {/* Disconnecting stops every health sync at once and the button
                  sat one stray tap away from doing it silently. Confirm inline —
                  a second step, not a second screen. */}
              {confirmDisconnect ? (
                <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
                  <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
                    {t('healthSync.disconnectConfirm', 'Stop syncing with Apple Health? Weight, workouts and activity will no longer flow in or out. Nothing already saved is deleted, and you can reconnect anytime.')}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setConfirmDisconnect(false)}
                      className="flex-1 min-w-0 py-2.5 rounded-xl text-[13px] font-bold transition-colors"
                      style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-subtle)' }}>
                      {t('healthSync.keepConnected', 'Keep it on')}
                    </button>
                    <button type="button" onClick={() => { setConfirmDisconnect(false); handleDisconnect(); }}
                      className="flex-1 min-w-0 py-2.5 rounded-xl text-[13px] font-bold transition-colors"
                      style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.3)' }}>
                      {t('healthSync.disconnectYes', 'Yes, disconnect')}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmDisconnect(true)}
                  className="w-full py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
                  style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.15)' }}>
                  {t('healthSync.disconnect')}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {available ? (
                <>
                  <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                    {t('healthSync.connectDesc', 'Connect to sync weight, workouts, steps, and calories automatically.')}
                  </p>
                  <button type="button" onClick={handleConnect} disabled={connecting}
                    className="w-full py-3 rounded-xl text-[14px] font-bold transition-colors disabled:opacity-50"
                    style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent, #fff)' }}>
                    {connecting ? t('healthSync.connecting') : t('healthSync.connect')}
                  </button>
                </>
              ) : (
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                  {t('healthSync.notAvailableHint')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Activity Data */}
        {connected && (
          <div className="rounded-2xl p-5 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                  {t('healthSync.todaysActivity')}
                </h2>
                <p className="text-[10px] mt-0.5" style={{ color: '#FF2D55' }}>
                  {isIOS ? t('healthSync.dataFromAppleHealth', 'Data from Apple Health') : t('healthSync.dataFromHealthConnect', 'Data from Health Connect')}
                </p>
              </div>
              <button type="button" onClick={fetchActivity} disabled={refreshing}
                aria-label={t('healthSync.refreshActivityData', 'Refresh activity data')}
                className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                style={{ color: 'var(--color-text-muted)' }}>
                <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl p-4 text-center overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)' }}>
                <Activity size={20} style={{ color: 'var(--color-accent)' }} className="mx-auto mb-2" />
                <p className="text-[24px] font-bold tabular-nums leading-none truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {todaySteps.toLocaleString()}
                </p>
                <p className="text-[11px] mt-1 uppercase tracking-wider truncate" style={{ color: 'var(--color-text-muted)' }}>{t('healthSync.steps')}</p>
              </div>
              <div className="rounded-xl p-4 text-center overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)' }}>
                <Dumbbell size={20} style={{ color: 'var(--color-accent)' }} className="mx-auto mb-2" />
                <p className="text-[24px] font-bold tabular-nums leading-none truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {weeklyCalories == null ? '\u2014' : weeklyCalories.toLocaleString()}
                </p>
                <p className="text-[11px] mt-1 uppercase tracking-wider truncate" style={{ color: 'var(--color-text-muted)' }}>{t('healthSync.cal7d')}</p>
              </div>
            </div>
          </div>
        )}

        {/* Settings hint */}
        <div className="rounded-2xl p-4 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
          <div className="flex items-start gap-3">
            <Settings size={16} style={{ color: 'var(--color-text-muted)' }} className="mt-0.5 shrink-0" />
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              {t('healthSync.settingsHint')}
            </p>
          </div>
        </div>

        {/* HealthKit attribution footer */}
        {isIOS && (
          <PoweredByHealthKit label={t('healthSync.poweredByHealthKit', 'Powered by Apple HealthKit')} />
        )}
      </div>

      <PermissionExplainerModal
        open={explainerOpen}
        type="health"
        onAgree={handleExplainerAgree}
        onCancel={handleExplainerCancel}
      />
    </div>
  );
};

export default HealthSync;
