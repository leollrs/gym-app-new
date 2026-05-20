import { registerPlugin } from '@capacitor/core';

// Single registration point for the Capacitor `WalletPass` plugin.
// Module evaluation runs once per JS context, so registering here and
// re-exporting prevents the "Capacitor plugin WalletPass already
// registered. Cannot register plugins twice" warning that fires when
// multiple lazy-loaded routes (Referrals, Rewards, QRCodeModal, etc.)
// each call registerPlugin on their own.
export const WalletPass = registerPlugin('WalletPass');
