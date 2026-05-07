import { registerPlugin } from '@capacitor/core';

const BackgroundLocation = registerPlugin('BackgroundLocation');

let listenerHandle = null;
let errorHandle = null;

export async function startBackgroundLocation(onFix, onError) {
  if (typeof window === 'undefined' || !BackgroundLocation?.start) return;
  // Always tear down any previous listeners before attaching new ones,
  // otherwise every resumed cardio session leaks an extra listener and
  // every GPS fix ends up double-handled (doubles distance, doubles renders).
  try {
    if (listenerHandle) { await listenerHandle.remove(); listenerHandle = null; }
    if (errorHandle) { await errorHandle.remove(); errorHandle = null; }
  } catch {}
  try {
    await BackgroundLocation.start();
    if (onFix) {
      let fixCount = 0;
      listenerHandle = await BackgroundLocation.addListener('location', (data) => {
        fixCount += 1;
        if (fixCount <= 5) {
          console.log('[backgroundLocation] native fix', fixCount, {
            lat: data.latitude, lng: data.longitude,
            accuracy: data.accuracy, speed: data.speed,
          });
        }
        onFix({
          coords: {
            latitude: data.latitude,
            longitude: data.longitude,
            accuracy: data.accuracy,
            altitude: data.altitude,
            speed: data.speed >= 0 ? data.speed : null,
            heading: data.heading >= 0 ? data.heading : null,
          },
          timestamp: data.timestamp,
        });
      });
      console.log('[backgroundLocation] location listener attached');
      // Replay the most recent cached fix to the new listener so the tracker
      // starts with non-empty data instead of waiting up to several seconds
      // for the next live update. Crucial when the picker pre-warmed GPS:
      // the warm fix is already cached and we want to use it immediately.
      try {
        const last = await BackgroundLocation.getLastLocation?.();
        const data = last?.location;
        if (data && typeof data.latitude === 'number') {
          console.log('[backgroundLocation] replaying cached fix on attach');
          onFix({
            coords: {
              latitude: data.latitude,
              longitude: data.longitude,
              accuracy: data.accuracy,
              altitude: data.altitude,
              speed: data.speed >= 0 ? data.speed : null,
              heading: data.heading >= 0 ? data.heading : null,
            },
            timestamp: data.timestamp,
          });
        }
      } catch {}
    }
    if (onError) {
      errorHandle = await BackgroundLocation.addListener('error', onError);
    }
  } catch (err) {
    console.warn('[backgroundLocation] start failed:', err);
  }
}

export async function stopBackgroundLocation() {
  try {
    if (listenerHandle) { await listenerHandle.remove(); listenerHandle = null; }
    if (errorHandle) { await errorHandle.remove(); errorHandle = null; }
    if (BackgroundLocation?.stop) await BackgroundLocation.stop();
  } catch (err) {
    console.warn('[backgroundLocation] stop failed:', err);
  }
}

export async function isBackgroundLocationRunning() {
  try {
    const res = await BackgroundLocation?.isRunning?.();
    return res?.running === true;
  } catch { return false; }
}

export async function requestBackgroundLocationPermissions() {
  try {
    if (!BackgroundLocation?.requestPermissions) {
      return { location: 'prompt' };
    }
    const res = await BackgroundLocation.requestPermissions();
    return { location: res?.location || 'prompt' };
  } catch (err) {
    console.warn('[backgroundLocation] requestPermissions failed:', err);
    return { location: 'denied' };
  }
}

export async function checkBackgroundLocationPermissions() {
  try {
    if (!BackgroundLocation?.checkPermissions) {
      return { location: 'prompt' };
    }
    const res = await BackgroundLocation.checkPermissions();
    return { location: res?.location || 'prompt' };
  } catch (err) {
    console.warn('[backgroundLocation] checkPermissions failed:', err);
    return { location: 'prompt' };
  }
}

// Pre-warm GPS so the first fix is already cached by the time the user taps
// Start. Called from the cardio picker as soon as the user lands on a
// GPS-eligible activity. Safe to call repeatedly — the iOS plugin's start()
// is now idempotent.
export async function prewarmBackgroundLocation() {
  if (typeof window === 'undefined' || !BackgroundLocation?.start) return;
  try {
    const perm = await checkBackgroundLocationPermissions();
    if (perm?.location !== 'granted') return; // don't trigger the dialog from a pre-warm
    await BackgroundLocation.start();
  } catch (err) {
    console.warn('[backgroundLocation] prewarm failed:', err);
  }
}

// Returns the most recent cached fix (cell-tower or GPS, whatever's available)
// so the JS can render a non-empty map immediately on tap-Start.
export async function getLastBackgroundLocation() {
  try {
    if (!BackgroundLocation?.getLastLocation) return null;
    const res = await BackgroundLocation.getLastLocation();
    return res?.location || null;
  } catch {
    return null;
  }
}
