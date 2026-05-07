// Stable home for custom Capacitor plugin registrations.
//
// `registerPlugin` must only be called once per plugin name per page lifetime.
// Co-locating these here (instead of inline at every callsite) avoids the
// "Capacitor plugin X already registered" warning that fires when Vite HMR
// re-evaluates a feature module that contained a registerPlugin call.

import { registerPlugin } from '@capacitor/core';

// Android-only: native bridge that fires ACTION_APPLICATION_DETAILS_SETTINGS so
// the "Tap to allow" affordance in MemberSettings can deep-link into Android's
// app-info Settings screen. Implementation lives in
// android/app/src/main/java/com/tugympr/app/AppSettingsPlugin.java.
export const AppSettings = registerPlugin('AppSettings');
