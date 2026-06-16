/**
 * usePlatformFlags — client side of the platform feature kill switches.
 *
 * The super-admin Operations page writes platform_config keys
 * `feature_<name>`; the member app reads them via the SECURITY DEFINER RPC
 * get_platform_flags() (migration 0547; 0551 added the `ai` key — the
 * OpenAI photo surfaces are the only direct per-call spend, so they get
 * their own kill switch). platform_config itself stays super_admin-only.
 * Pages gate themselves with useFeatureEnabled('<key>').
 *
 * FAIL-OPEN by design: if the RPC errors, doesn't exist yet (PGRST202
 * before the migration is applied), or returns garbage, every flag reads
 * true. While the first fetch is in flight flags also read true, so a
 * feature is never flash-blocked on load.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export const PLATFORM_FLAG_KEYS = ['referrals', 'classes', 'social', 'messaging', 'qr', 'challenges', 'nutrition', 'ai'];

const ALL_ENABLED = Object.freeze(
  Object.fromEntries(PLATFORM_FLAG_KEYS.map((k) => [k, true]))
);

export function usePlatformFlags() {
  const { data, isLoading } = useQuery({
    queryKey: ['platform-flags'],
    queryFn: async () => {
      try {
        // Per-gym effective flags (0586) = global master kill AND the caller
        // gym's entitlement override. Fall back to the global-only RPC if the
        // merged one isn't deployed yet (e.g. OTA bundle ahead of the migration).
        let resp = await supabase.rpc('get_effective_feature_flags');
        if (resp.error) resp = await supabase.rpc('get_platform_flags');
        const { data, error } = resp;
        if (error || !data || typeof data !== 'object') return ALL_ENABLED;
        // Only an explicit false disables; unknown/missing keys stay enabled.
        const flags = { ...ALL_ENABLED };
        for (const key of PLATFORM_FLAG_KEYS) {
          if (data[key] === false) flags[key] = false;
        }
        return flags;
      } catch {
        return ALL_ENABLED; // network/unknown failure → fail open
      }
    },
    // Infra kill switches: a super-admin flipping one expects it to take
    // effect quickly, so poll briskly and re-check on every mount/focus/
    // reconnect. This query is also excluded from the 7-day persisted cache
    // (main.jsx) so a stale "off" can't survive a re-enable or app restart.
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
    retry: false,
  });

  return { flags: data || ALL_ENABLED, isLoading };
}

/**
 * Convenience guard for pages: `const ok = useFeatureEnabled('classes');`
 * Returns true while flags are loading so content never flashes off.
 */
export function useFeatureEnabled(key) {
  const { flags, isLoading } = usePlatformFlags();
  if (isLoading) return true;
  return flags?.[key] !== false;
}
