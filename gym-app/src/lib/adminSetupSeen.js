// Durable, per-browser "this admin has already dismissed the setup wizard" flag.
//
// gyms.setup_completed (DB) is the cross-device source of truth, but a flaky
// write — a network blip, an earlier logo/branding upload throwing before the
// flag is written, or an RLS no-op — must NEVER doom an admin to seeing the
// setup modal on every single login. This local flag is the belt-and-suspenders
// gate, mirroring the localStorage approach AdminTour already uses.
//
// Set on BOTH "complete" and "skip"; checked before the wizard is shown.
export const adminSetupSeenKey = (gymId) => `admin_setup_seen_${gymId || 'x'}`;

export function isAdminSetupSeen(gymId) {
  try {
    return localStorage.getItem(adminSetupSeenKey(gymId)) === '1';
  } catch {
    return false;
  }
}

export function markAdminSetupSeen(gymId) {
  try {
    localStorage.setItem(adminSetupSeenKey(gymId), '1');
  } catch {
    /* quota / privacy mode — non-fatal */
  }
}
