// devicePermissions.js
// Single entry point for native permission checks/requests across the app.
// Each helper returns one of: 'granted' | 'denied' | 'prompt' | 'unsupported'.
//
// 'denied' means the OS has remembered a denial — JS can't re-prompt.
// Caller should show the user a button that opens iOS Settings via openAppSettings().

import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Camera } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { PushNotifications } from '@capacitor/push-notifications';
import { AppSettings } from './nativePlugins';

let HealthPlugin = null;
async function getHealth() {
  if (HealthPlugin) return HealthPlugin;
  try {
    const mod = await import('@capgo/capacitor-health');
    HealthPlugin = mod.Health || mod.CapacitorHealth || mod.default;
  } catch { /* not installed */ }
  return HealthPlugin;
}

const isNative = () => Capacitor.isNativePlatform?.() || Capacitor.getPlatform?.() !== 'web';

function normalize(state) {
  if (!state) return 'prompt';
  if (state === 'granted' || state === 'authorized' || state === 'always' || state === 'limited') return 'granted';
  if (state === 'denied' || state === 'restricted') return 'denied';
  return 'prompt';
}

export async function checkPermission(type) {
  if (!isNative()) return 'unsupported';
  try {
    if (type === 'notifications') {
      const r = await PushNotifications.checkPermissions();
      return normalize(r?.receive);
    }
    if (type === 'camera') {
      const r = await Camera.checkPermissions();
      return normalize(r?.camera);
    }
    if (type === 'location') {
      const r = await Geolocation.checkPermissions();
      return normalize(r?.location);
    }
    if (type === 'health') {
      // The @capgo/capacitor-health plugin does not expose a synchronous
      // permission-status check (no `isAuthorized` method). We rely on the
      // canonical "user opted in" flag written by Onboarding / Settings /
      // Recovery, falling back to the request-flow status cache.
      try {
        if (localStorage.getItem('tugympr_health_connected') === 'true') return 'granted';
        const cached = localStorage.getItem('healthPermissionStatus');
        if (cached === 'granted' || cached === 'denied') return cached;
      } catch {}
      return 'prompt';
    }
  } catch (err) {
    console.warn('[devicePermissions] check failed', type, err);
  }
  return 'prompt';
}

export async function requestPermission(type) {
  if (!isNative()) return 'unsupported';
  try {
    if (type === 'notifications') {
      const r = await PushNotifications.requestPermissions();
      const status = normalize(r?.receive);
      if (status === 'granted') {
        try { await PushNotifications.register(); } catch {}
      }
      return status;
    }
    if (type === 'camera') {
      const r = await Camera.requestPermissions({ permissions: ['camera'] });
      return normalize(r?.camera);
    }
    if (type === 'location') {
      const r = await Geolocation.requestPermissions();
      return normalize(r?.location);
    }
    if (type === 'health') {
      // Reuse the working request flow from lib/healthSync.js — same fields,
      // already battle-tested in the Health Sync page.
      try {
        const { requestPermissions: requestHealth, isAvailable } = await import('./healthSync');
        const avail = await isAvailable();
        if (!avail) return 'unsupported';
        const result = await requestHealth();
        const status = result?.granted ? 'granted' : 'denied';
        try {
          localStorage.setItem('healthPermissionStatus', status);
          // Also write the canonical "user opted in" flag that Onboarding
          // and Recovery use — so granting in Settings propagates to those
          // surfaces. Caller still needs to update profiles.health_sync_enabled
          // for cross-device / cold-start visibility.
          if (status === 'granted') {
            localStorage.setItem('tugympr_health_connected', 'true');
          }
        } catch {}
        return status;
      } catch (err) {
        console.warn('[devicePermissions] health request failed', err);
        try { localStorage.setItem('healthPermissionStatus', 'denied'); } catch {}
        return 'denied';
      }
    }
  } catch (err) {
    console.warn('[devicePermissions] request failed', type, err);
  }
  return 'denied';
}

export async function openAppSettings() {
  try {
    const platform = Capacitor.getPlatform();
    if (platform === 'ios') await CapApp.openUrl({ url: 'app-settings:' });
    else if (platform === 'android') await AppSettings.open();
  } catch (err) {
    console.warn('[devicePermissions] openAppSettings failed', err);
  }
}

/**
 * Full flow: explain → request → fallback to settings.
 * Caller provides an `explainer({ type }) => Promise<boolean>` to render the modal.
 * Returns final status: 'granted' | 'denied' | 'prompt'.
 */
export async function ensurePermission(type, explainer) {
  const current = await checkPermission(type);
  if (current === 'granted') return 'granted';
  if (current === 'unsupported') return 'unsupported';

  // Explain why we need it before triggering the OS prompt — App Store best practice.
  if (explainer) {
    const ok = await explainer({ type });
    if (!ok) return current;
  }

  if (current === 'denied') {
    await openAppSettings();
    return 'denied';
  }

  return await requestPermission(type);
}
