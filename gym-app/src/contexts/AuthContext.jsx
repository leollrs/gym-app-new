import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { applyBranding } from '../lib/branding';
import { setAppName } from '../lib/appName';
import { getPalette } from '../lib/palettes';
import { resetToDefault } from '../lib/themeGenerator';
import { setErrorTrackerAuth } from '../lib/errorTracker';
import { syncUserContextToWatch, syncFriendsToWatch, syncRoutinesToWatch, syncQRToWatch, syncDailySummaryToWatch, syncExercisesToWatch, syncNutritionToWatch, onWatchMessage } from '../lib/watchBridge';
import { readTodayActivityRings } from '../lib/healthSync';
import { removePushTokens } from '../lib/pushNotifications';
import posthog from 'posthog-js';
import i18n from '../i18n/i18n';
import { getSessionCreatedAt, setSessionCreatedAt, clearSessionCreatedAt, isSessionExpired } from '../lib/sessionAge';
import { safeNavigate } from '../lib/navigationRef';

const AuthContext = createContext({});

// Hash a user id (or any string) to hex via SHA-256. Used for PostHog identify
// so we never send the raw auth.users UUID across analytics. Falls back to
// the raw id if SubtleCrypto is unavailable (older WebView, insecure ctx).
async function hashId(id) {
  try {
    if (!id || !globalThis.crypto?.subtle) return id;
    const buf = new TextEncoder().encode(String(id));
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return id;
  }
}

// 24h freshness window for cached non-privilege profile fields. Anything
// older forces a network refetch before we trust it for routing.
const OFFLINE_PROFILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// 30-day hard cap on total session age. Beyond this we force re-auth even
// if supabase has happily kept refreshing the access token.
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const clearPersistedUserData = () => {
  try {
    const sensitiveKeyPrefixes = [
      'gym_session_',
      'notification_prefs_',
      'saved_recipes',
      'grocery_list',
      'tugympr_health_',
      'health_sync_',
      'churn_contacted_',
      'challenge_joined_',
      'streak_freeze_',
      'app_tour_',
      'coachmark_',
      'watchPendingNav',
      'sb-',
      '_bodyScan',
      '_pending',
      'offline_',
      'meal_plan_',
      'program_adaptations',
      'archived_conversations',
      'platform_gym_defaults',
      'admin_export_history',
    ];
    const exactKeys = ['offline_profile', 'offline_gym', 'tugympr-query-cache'];
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (exactKeys.includes(key) || sensitiveKeyPrefixes.some(prefix => key.startsWith(prefix))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch { /* localStorage may be unavailable */ }

  try { sessionStorage.clear(); } catch {}
};

export const AuthProvider = ({ children }) => {
  // Hydrate user + profile from localStorage on init so the app boots
  // straight to the dashboard offline — no spinner, no "can't connect to
  // account" screen. The full profile cached at offline_profile carries
  // `role`, `gym_id`, `is_onboarded` etc. that ProtectedRoute needs.
  // Hydrate cached profile, but ALWAYS strip role/additional_roles before use.
  // Privilege must come from a fresh server fetch — never trust cached privilege.
  // Also gate on cached_at: if older than OFFLINE_PROFILE_MAX_AGE_MS, mark stale
  // so the UI shows a loading state until the network fetch returns.
  const { cachedProfile, cachedProfileStale } = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem('offline_profile'));
      if (!raw || !raw.id) return { cachedProfile: null, cachedProfileStale: false };
      // Defensively strip privilege fields even if a stale build wrote them.
      const { role: _r, additional_roles: _ar, ...safe } = raw;
      const stale = !raw.cached_at || (Date.now() - Number(raw.cached_at)) > OFFLINE_PROFILE_MAX_AGE_MS;
      return { cachedProfile: safe, cachedProfileStale: stale };
    } catch {
      return { cachedProfile: null, cachedProfileStale: false };
    }
  })();
  const [user, setUser] = useState(cachedProfile?.id ? { id: cachedProfile.id } : null);
  const [profile, setProfile] = useState(cachedProfile);
  const [gymName, setGymName] = useState(() => {
    try { return JSON.parse(localStorage.getItem('offline_gym'))?.name || ''; } catch { return ''; }
  });
  const [gymLogoUrl, setGymLogoUrl] = useState('');
  // If cache is stale (>24h), show loading state until network fetch resolves —
  // we have no current `role`/`additional_roles` to safely route with.
  const [loading, setLoading] = useState(!cachedProfile?.id || cachedProfileStale);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [gymDeactivated, setGymDeactivated] = useState(false);
  const [gymConfig, setGymConfig] = useState({});
  const [memberBlocked, setMemberBlocked] = useState(null); // null = not blocked, 'deactivated' | 'banned'
  const [lifetimePoints, setLifetimePoints] = useState(null); // null = not loaded yet, 0+ = loaded
  const watchSyncTimeoutRef = useRef(null);

  // ── Multi-role view switching ─────────────────────────────
  // activeView tracks which "experience" the user is currently in:
  // 'member' | 'trainer' | 'admin' | 'super_admin'. Stored in localStorage
  // so it persists across reloads. NEVER trusted by the backend — it's a
  // pure UI hint. RLS still enforces on profile.role / additional_roles.
  const [activeView, setActiveView] = useState(() => {
    try { return localStorage.getItem('tugympr_active_view') || null; } catch { return null; }
  });

  // Fetch unread notification count for the *member* inbox only.
  // Trainer/admin views maintain their own badge counts (audience-scoped).
  // Legacy rows have NULL audience and are treated as member.
  const fetchUnreadNotifications = useCallback(async (profileId) => {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profileId)
      .or('audience.is.null,audience.eq.member')
      .is('read_at', null)
      .is('dismissed_at', null);
    if (!error) setUnreadNotifications(count || 0);
  }, []);

  const refreshNotifications = useCallback(() => {
    if (profile?.id) fetchUnreadNotifications(profile.id);
  }, [profile?.id, fetchUnreadNotifications]);

  // Fetch the profile row for a given user id, then apply gym branding
  const fetchProfile = async (userId) => {
    try {
    // Single RPC call replaces profile + branding + gym + points + notifications queries
    const { data: rpcResult, error: rpcError } = await supabase.rpc('get_auth_context');

    // Fallback to direct query if RPC fails (e.g. migration not yet applied)
    let data, branding, gym;
    if (rpcError || !rpcResult) {
      const { data: fallback } = await supabase
        .from('profiles')
        .select('id, gym_id, full_name, username, role, additional_roles, is_onboarded, avatar_url, avatar_type, avatar_value, preferred_language, membership_status, last_active_at, qr_code_payload, preferred_training_days, skip_suggestion_date, accent_color, trainer_icon, phone_number, bio, specialties, years_of_experience, date_of_birth, age_verified_at, created_at')
        .eq('id', userId)
        .maybeSingle();
      data = fallback;
      branding = null;
      gym = null;

      // last_active_at update handled after the if/else block for all paths
    } else {
      data = rpcResult.profile ?? null;
      branding = rpcResult.branding ?? null;
      gym = rpcResult.gym ?? null;
      setLifetimePoints(rpcResult.lifetime_points ?? 0);
      // Don't seed the unread count from get_auth_context — its server-side
      // counting logic has historically over-counted (admin/system notifs
      // bleeding into the member badge). We always re-fetch via
      // fetchUnreadNotifications which uses the same filter as the
      // Notifications page for consistency. See useEffect below.
    }

    setProfile(data ?? null);

    // Update last_active_at for all roles (client-side, throttled once/hour)
    if (data?.id) {
      const lastActive = data.last_active_at ? new Date(data.last_active_at) : null;
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      if (!lastActive || lastActive < oneHourAgo) {
        supabase.from('profiles').update({ last_active_at: new Date().toISOString() })
          .eq('id', data.id).then(() => {}).catch(() => {});
      }
    }

    // Only fetch points separately if RPC didn't provide them (fallback path)
    if ((!rpcResult || rpcError) && data?.id) {
      supabase
        .from('reward_points')
        .select('lifetime_points')
        .eq('profile_id', data.id)
        .maybeSingle()
        .then(({ data: pts }) => setLifetimePoints(pts?.lifetime_points ?? 0));
    }

    // Check if the individual member is blocked (deactivated or banned)
    const blockedStatus = data?.membership_status;
    if (blockedStatus === 'deactivated' || blockedStatus === 'banned') {
      setMemberBlocked(blockedStatus);
    } else {
      setMemberBlocked(null);
    }

    // Sync language preference from profile to i18next
    if (data?.preferred_language && data.preferred_language !== i18n.language) {
      i18n.changeLanguage(data.preferred_language);
    }

    if (data?.gym_id) {
      // If RPC didn't provide branding/gym, fetch them (fallback path)
      if (!rpcResult || rpcError) {
        const [brandingRes, gymRes] = await Promise.all([
          supabase
            .from('gym_branding')
            .select('primary_color, accent_color, custom_app_name, logo_url, palette_name, surface_color')
            .eq('gym_id', data.gym_id)
            .single(),
          supabase
            .from('gyms')
            .select('name, is_active, qr_enabled, qr_display_format, classes_enabled, setup_completed')
            .eq('id', data.gym_id)
            .maybeSingle(),
        ]);
        branding = brandingRes.data;
        gym = gymRes.data;
      }

      // If the gym query returned null, RLS blocked it because is_active = false
      // (the policy only exposes inactive gyms to super_admins).
      // Treat "user has gym_id but can't read the gym row" as deactivated.
      const isDeactivated = data.role !== 'super_admin' && (!gym || gym.is_active === false);
      setGymDeactivated(isDeactivated);

      if (isDeactivated) {
        setGymName('');
        setGymLogoUrl('');
        setErrorTrackerAuth({ id: userId }, data, '');
        setLoading(false);
        return;
      }

      if (branding?.palette_name) {
        const palette = getPalette(branding.palette_name);
        applyBranding({
          primaryColor: branding.primary_color || palette.primary,
          secondaryColor: branding.accent_color || palette.secondary,
          surfaceColor: branding.surface_color || null,
        });
      } else if (branding?.primary_color || branding?.accent_color) {
        applyBranding({
          primaryColor: branding.primary_color,
          secondaryColor: branding.accent_color,
        });
      }
      const resolvedName = gym?.name || branding?.custom_app_name || '';
      setGymName(resolvedName);
      setAppName(resolvedName);
      setGymConfig({
        qrEnabled: gym?.qr_enabled ?? false,
        qrDisplayFormat: gym?.qr_display_format ?? 'qr_code',
        classesEnabled: gym?.classes_enabled ?? false,
        setupCompleted: gym?.setup_completed ?? true, // default true so existing gyms don't see wizard
      });

      // Cache a SAFE subset of the profile so the app can boot offline.
      // SECURITY: role must always come from a fresh server fetch — never
      // trust cached privilege. We deliberately exclude `role` and
      // `additional_roles` from this cache; they are re-fetched every time
      // the app starts. `availableRoles` will be empty until the network
      // fetch completes (or until the user signs in fresh).
      try {
        const safeProfileForCache = {
          id: data.id,
          gym_id: data.gym_id,
          is_onboarded: data.is_onboarded,
          membership_status: data.membership_status,
          full_name: data.full_name,
          username: data.username,
          avatar_url: data.avatar_url,
          cached_at: Date.now(),
        };
        localStorage.setItem('offline_profile', JSON.stringify(safeProfileForCache));
        localStorage.setItem('offline_gym', JSON.stringify({
          name: gym?.name || branding?.custom_app_name || '',
          qrEnabled: gym?.qr_enabled ?? false,
          qrDisplayFormat: gym?.qr_display_format ?? 'qr_code',
          classesEnabled: gym?.classes_enabled ?? false,
          setupCompleted: gym?.setup_completed ?? true,
          isActive: gym?.is_active ?? true,
        }));
      } catch {}

      setErrorTrackerAuth({ id: userId }, data, gym?.name || branding?.custom_app_name || '');

      // Identify user in PostHog — PII reduction:
      //  - hash the auth UUID to a SHA-256 hex digest (no raw user id leaves device)
      //  - only pass non-PII properties (role, gym_id, is_onboarded)
      //  - NEVER pass email, full_name, username, last_active_at, avatar URLs
      try {
        const hashedId = await hashId(userId);
        posthog.identify(hashedId, {
          role: data.role,
          gym_id: data.gym_id,
          is_onboarded: data.is_onboarded,
        });
        posthog?.capture('app_session_started', {
          role: data.role,
          gym_id: data.gym_id,
          is_onboarded: data.is_onboarded,
        });
      } catch {}


      // Resolve a signed logo URL — non-blocking (don't delay auth loading)
      if (branding?.logo_url) {
        supabase.storage
          .from('gym-logos')
          .createSignedUrl(branding.logo_url, 60 * 60 * 24) // 1 day
          .then(({ data: signed, error }) => {
            setGymLogoUrl(!error && signed?.signedUrl ? signed.signedUrl : '');
          });
      } else {
        setGymLogoUrl('');
      }
    } else {
      setGymLogoUrl('');
      setGymDeactivated(false);
      setErrorTrackerAuth({ id: userId }, data, '');
    }

    // Defer Watch sync to after render — these queries are non-critical and should
    // not block the auth path. Profile data is already set above.
    if (data?.id) {
      const capturedData = data;
      watchSyncTimeoutRef.current = setTimeout(() => {
        Promise.all([
          supabase.from('check_ins').select('checked_in_at').eq('profile_id', capturedData.id).order('checked_in_at', { ascending: false }).limit(30),
          supabase.from('workout_sessions').select('completed_at').eq('profile_id', capturedData.id).eq('status', 'completed').gte('completed_at', new Date(Date.now() - 7 * 86400000).toISOString()),
        ]).then(([checkInsRes, weeklyRes]) => {
          // Calculate streak from check-ins
          let streak = 0;
          const checkIns = checkInsRes.data || [];
          if (checkIns.length > 0) {
            const today = new Date(); today.setHours(0,0,0,0);
            let checkDay = new Date(checkIns[0].checked_in_at); checkDay.setHours(0,0,0,0);
            const diffDays = Math.round((today - checkDay) / 86400000);
            if (diffDays <= 1) {
              streak = 1;
              for (let i = 1; i < checkIns.length; i++) {
                const prev = new Date(checkIns[i].checked_in_at); prev.setHours(0,0,0,0);
                if (Math.round((checkDay - prev) / 86400000) === 1) {
                  streak++;
                  checkDay = prev;
                } else break;
              }
            }
          }
          // Read latest gym branding from offline cache (populated by gym query)
          let watchGymName = '';
          let watchAccent = '';
          try {
            const gymData = JSON.parse(localStorage.getItem('offline_gym') || '{}');
            watchGymName = gymData?.name || '';
            watchAccent = gymData?.accent_color || gymData?.primary_color || capturedData?.accent_color || '';
          } catch {}
          syncUserContextToWatch({
            qrPayload: capturedData.qr_code_payload || '',
            userName: capturedData.full_name || capturedData.username || '',
            streak,
            lastWorkoutDate: weeklyRes.data?.[0]?.completed_at || '',
            weeklyWorkoutCount: weeklyRes.data?.length || 0,
            gymName: watchGymName,
            gymAccentHex: watchAccent,
            // i18n.language is the source of truth for the user's preferred
            // language; the Watch mirrors it via `tr(en:es:)` so labels
            // match the iPhone instead of always rendering in English.
            language: (i18n?.language || capturedData.preferred_language || 'en'),
          });
          // Pre-render the QR payload to PNG and push to the Watch so it can
          // display the user's ACTUAL check-in QR (CoreImage not available on
          // watchOS target).
          if (capturedData.qr_code_payload) {
            syncQRToWatch(capturedData.qr_code_payload).catch(() => {});
          }
          // Push today's Apple-style activity rings + reward points to the
          // Watch's DailySummaryView. Skipped silently when Apple Health
          // permissions haven't been granted — the Watch then falls back to
          // its previously cached values rather than showing stale ones.
          (async () => {
            try {
              const [rings, pointsRes, todayLog] = await Promise.all([
                readTodayActivityRings(),
                supabase.from('reward_points').select('total_points').eq('profile_id', capturedData.id).maybeSingle(),
                supabase.from('reward_points_log')
                  .select('points')
                  .eq('profile_id', capturedData.id)
                  .gte('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
              ]);
              const pointsTotal = pointsRes?.data?.total_points || 0;
              const pointsToday = (todayLog?.data || []).reduce((sum, r) => sum + (Number(r.points) || 0), 0);
              await syncDailySummaryToWatch({
                ...rings,
                pointsToday,
                pointsTotal,
              });
            } catch {}
          })();

          // Today's macro totals + targets → Watch Nutrition tab.
          (async () => {
            try {
              const todayDate = new Date().toISOString().slice(0, 10);
              const [tgtRes, logsRes] = await Promise.all([
                supabase.from('nutrition_targets')
                  .select('daily_calories, daily_protein_g, daily_carbs_g, daily_fat_g')
                  .eq('profile_id', capturedData.id)
                  .maybeSingle(),
                supabase.from('food_logs')
                  .select('calories, protein_g, carbs_g, fat_g')
                  .eq('profile_id', capturedData.id)
                  .eq('log_date', todayDate),
              ]);
              const t = tgtRes?.data || {};
              const totals = (logsRes?.data || []).reduce(
                (acc, r) => ({
                  cal: acc.cal + (Number(r.calories) || 0),
                  p:   acc.p   + (Number(r.protein_g) || 0),
                  c:   acc.c   + (Number(r.carbs_g)   || 0),
                  f:   acc.f   + (Number(r.fat_g)     || 0),
                }),
                { cal: 0, p: 0, c: 0, f: 0 },
              );
              await syncNutritionToWatch({
                caloriesEaten: Math.round(totals.cal),
                caloriesGoal:  Math.round(t.daily_calories  || 2000),
                proteinEaten:  Math.round(totals.p),
                proteinGoal:   Math.round(t.daily_protein_g || 150),
                carbsEaten:    Math.round(totals.c),
                carbsGoal:     Math.round(t.daily_carbs_g   || 250),
                fatEaten:      Math.round(totals.f),
                fatGoal:       Math.round(t.daily_fat_g     || 70),
              });
            } catch {}
          })();

          // Push the exercise library so the Watch's Free Lift picker
          // works without a round trip per tap. We use the static bundled
          // catalog (~170 exercises) — keeping just id + name + category
          // keeps the message under WCSession's payload ceiling.
          (async () => {
            try {
              const mod = await import('../data/exercises');
              const lang = (i18n?.language || capturedData.preferred_language || 'en').startsWith('es') ? 'es' : 'en';
              const slim = (mod.exercises || []).map((e) => ({
                id: e.id,
                name: lang === 'es' && e.name_es ? e.name_es : e.name,
                category: e.muscle || e.category || '',
              }));
              await syncExercisesToWatch(slim);
            } catch {}
          })();
        }).catch(() => {});

        // Sync friends activity to Watch (non-blocking)
        supabase
          .from('friendships')
          .select('requester_id, addressee_id')
          .or(`requester_id.eq.${capturedData.id},addressee_id.eq.${capturedData.id}`)
          .eq('status', 'accepted')
          .limit(20)
          .then(({ data: friendships }) => {
            if (!friendships?.length) return;
            const friendIds = friendships.map(f => f.requester_id === capturedData.id ? f.addressee_id : f.requester_id);
            const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours
            Promise.all([
              supabase.from('profiles').select('id, full_name, username').in('id', friendIds),
              supabase.from('workout_sessions').select('profile_id, started_at, status, name').in('profile_id', friendIds).gte('started_at', cutoff).order('started_at', { ascending: false }),
            ]).then(([profilesRes, sessionsRes]) => {
              const profiles = profilesRes.data || [];
              const sessions = sessionsRes.data || [];
              const friends = profiles.map(p => {
                const activeSession = sessions.find(s => s.profile_id === p.id && s.status === 'in_progress');
                const lastSession = sessions.find(s => s.profile_id === p.id);
                return {
                  name: p.full_name || p.username || 'Friend',
                  isActive: !!activeSession,
                  status: activeSession ? (activeSession.name || 'Working out') : (lastSession ? 'Recently active' : ''),
                };
              }).filter(f => f.isActive || f.status);
              syncFriendsToWatch(friends);
            });
          }).catch(() => {});

        // Sync routines to Watch on login (non-blocking)
        Promise.all([
          supabase.from('routines').select('id, name, routine_exercises(id)').eq('created_by', capturedData.id).eq('is_template', false).order('created_at', { ascending: false }),
          supabase.from('workout_sessions').select('routine_id, completed_at').eq('profile_id', capturedData.id).eq('status', 'completed').order('completed_at', { ascending: false }).limit(50),
          supabase.from('generated_programs').select('program_start, expires_at').eq('profile_id', capturedData.id).order('created_at', { ascending: false }).limit(1),
        ]).then(([routinesRes, sessionsRes, programsRes]) => {
          const routines = routinesRes.data || [];
          const lastPerformed = {};
          (sessionsRes.data || []).forEach(s => {
            if (s.routine_id && !lastPerformed[s.routine_id]) lastPerformed[s.routine_id] = s.completed_at;
          });
          // Determine today's program routines
          let todayIds = new Set();
          const prog = programsRes.data?.[0];
          if (prog && new Date(prog.expires_at) > new Date()) {
            const weekNum = Math.floor((new Date() - new Date(prog.program_start)) / (7 * 86400000)) + 1;
            const isWeekA = weekNum % 2 === 1;
            todayIds = new Set(
              routines.filter(r => r.name?.startsWith('Auto:') && (isWeekA ? (r.name.endsWith(' A') || !r.name.endsWith(' B')) : r.name.endsWith(' B'))).map(r => r.id)
            );
          }
          syncRoutinesToWatch(routines.map(r => ({
            id: r.id,
            name: r.name,
            exercises: r.routine_exercises || [],
            exerciseCount: r.routine_exercises?.length || 0,
            lastUsed: lastPerformed[r.id] || '',
            isProgram: r.name?.startsWith('Auto:') || false,
            isTodayWorkout: todayIds.has(r.id),
          })));
        }).catch(() => {});
      }, 0);
    }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Hard session max-age guard: even if supabase keeps refreshing tokens,
    // force re-auth after SESSION_MAX_AGE_MS. Runs synchronously on every
    // mount of AuthContext so stale long-lived sessions are killed asap.
    if (isSessionExpired(SESSION_MAX_AGE_MS)) {
      try { clearSessionCreatedAt(); } catch {}
      try { clearPersistedUserData(); } catch {}
      supabase.auth.signOut().finally(() => {
        // Use safeNavigate so Capacitor doesn't reload the WebView from disk
        // (which kills JS state, in-flight fetches, and pending native callbacks).
        safeNavigate('/login', { replace: true });
      });
      setLoading(false);
      return undefined;
    }

    // Wrap any unhandled promise rejection so a 401 anywhere in the app
    // (stale/revoked refresh token, RLS policy reject) forces a clean
    // sign-out instead of silently leaving the user in a half-auth state.
    const onUnhandledRejection = (event) => {
      try {
        const reason = event?.reason;
        const status = reason?.status ?? reason?.statusCode ?? reason?.code;
        const msg = String(reason?.message || reason || '');
        if (status === 401 || /jwt|invalid token|not authenticated|unauthor/i.test(msg)) {
          supabase.auth.signOut().catch(() => {});
        }
      } catch { /* swallow — we're already in a global handler */ }
    };
    try { window.addEventListener('unhandledrejection', onUnhandledRejection); } catch {}

    // Check for an existing session on mount. If offline/unreachable, the
    // hydrated user/profile from localStorage stays in place — we don't
    // overwrite to null just because getSession returned no live session.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        fetchProfile(session.user.id);
      } else if (!cachedProfile?.id) {
        // Truly logged out (no cached profile, no live session)
        setUser(null);
        setLoading(false);
      } else {
        // Offline + cached profile — stay logged in, refresh in background
        // when network returns (handled by onAuthStateChange + retry effects).
        setLoading(false);
      }
    }).catch(() => {
      // getSession itself failed (rare) — keep cached state
      setLoading(false);
    });

    // Subscribe to auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (_event === 'TOKEN_REFRESHED') {
        // Only the token changed — profile data is unchanged. Update the user
        // object in state (new access token) without triggering a loading flash
        // or a redundant DB round-trip.
        setUser(session?.user ?? null);
        // Multi-tab session-revocation: if another tab signed out (or the
        // refresh token was revoked server-side), getSession will return null
        // here even though we received a TOKEN_REFRESHED event. Treat that as
        // a forced sign-out so this tab doesn't keep impersonating a dead user.
        try {
          const { data: { session: liveSession } } = await supabase.auth.getSession();
          if (!liveSession) {
            await supabase.auth.signOut();
          }
        } catch { /* network blip — leave state alone */ }
        return;
      }

      // CRITICAL: only treat as sign-out if it's an EXPLICIT SIGNED_OUT event.
      // The previous `|| !session?.user` clause also fired on failed token
      // refreshes when offline — which wiped offline_profile from localStorage
      // and stranded the user on ProfileUnavailableScreen on next cold-start.
      // If session is just transiently missing (offline refresh), keep the
      // cached state in place.
      if (_event === 'SIGNED_OUT') {
        setUser(null);
        setProfile(null);
        setGymName('');
        setGymLogoUrl('');
        setGymDeactivated(false);
        setGymConfig({});
        setMemberBlocked(null);
        setLifetimePoints(null);
        setUnreadNotifications(0);
        setMfaRequired(false);
        setLoading(false);
        resetToDefault();
        try { clearSessionCreatedAt(); } catch {}
        try { posthog.reset(); } catch {}
        return;
      }

      // For non-SIGNED_OUT events, only update user if session exists. Don't
      // null it out (that would orphan the cached profile UI).
      if (session?.user) {
        setUser(session.user);
      }

      if (_event === 'SIGNED_IN') {
        // Stamp the session creation time so isSessionExpired() can enforce
        // the 30-day hard cap on every subsequent mount.
        try {
          if (!getSessionCreatedAt()) setSessionCreatedAt(Date.now());
        } catch {}
        // Full profile fetch with loading screen for new sign-ins
        setLoading(true);
        fetchProfile(session.user.id);
        return;
      }

      if (_event === 'USER_UPDATED') {
        // Profile data may have changed (e.g. email/password update) — refresh
        // silently in the background without showing the loading screen.
        fetchProfile(session.user.id);
        return;
      }

      // Fallback for any other events (INITIAL_SESSION handled by getSession above)
      // Do nothing — avoids unnecessary re-fetches.
    });

    return () => {
      subscription.unsubscribe();
      try { window.removeEventListener('unhandledrejection', onUnhandledRejection); } catch {}
      // Clean up any pending Watch sync timeout
      if (watchSyncTimeoutRef.current) {
        clearTimeout(watchSyncTimeoutRef.current);
        watchSyncTimeoutRef.current = null;
      }
    };
  }, []);

  // Fetch unread notification count whenever the profile is loaded/changed
  // + subscribe to realtime changes so the bell badge stays accurate.
  //
  // Why we refetch instead of incrementing locally:
  //   - The previous "prev + 1" on INSERT didn't filter by audience (admin
  //     pushes were over-counting the member badge) and never decremented
  //     on read/dismiss/delete (so the count drifted upward over time).
  //   - Refetching on ANY change to the user's notification rows is cheap
  //     (single COUNT query, head-only) and keeps the badge in sync with
  //     the same filters used by fetchUnreadNotifications (member-audience,
  //     unread, not-dismissed).
  useEffect(() => {
    if (profile?.id) {
      fetchUnreadNotifications(profile.id);

      const refetch = () => fetchUnreadNotifications(profile.id);
      const channel = supabase
        .channel('unread-notif-badge')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `profile_id=eq.${profile.id}`,
        }, refetch)
        .subscribe();

      return () => supabase.removeChannel(channel);
    } else {
      setUnreadNotifications(0);
    }
  }, [profile?.id, fetchUnreadNotifications]);

  // ── SIGN UP ────────────────────────────────────────────────
  // Creates the Supabase auth user then immediately inserts a profiles row.
  // Compliance fields (dateOfBirth, termsAcceptedAt, privacyAcceptedAt,
  // ageVerifiedAt) are persisted alongside the profile for App Store /
  // Play Store / GDPR-K compliance — see migration 0344_eula_age_consent.
  const signUp = useCallback(async ({
    email,
    password,
    fullName,
    username,
    gymSlug,
    dateOfBirth,
    termsAcceptedAt,
    privacyAcceptedAt,
    ageVerifiedAt,
  }) => {
    // 1. Look up the gym by slug
    // Use gyms_public (security-barrier view granted to anon, see migration 0110)
    // instead of raw gyms table — raw gyms relies on RLS policy traversal which
    // can 401 if a stale auth token is leaking through from a prior session.
    const { data: gym, error: gymError } = await supabase
      .from('gyms_public')
      .select('id')
      .eq('slug', gymSlug.toLowerCase().trim())
      .maybeSingle();

    if (gymError || !gym) {
      throw new Error('Gym code not found. Ask your gym for the correct code.');
    }

    // 2. Check if username is already taken (scoped to this gym)
    const { count, error: usernameError } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('username', username.toLowerCase().trim())
      .eq('gym_id', gym.id);

    if (usernameError) {
      throw new Error('Unable to verify username. Please try again.');
    }
    if (count > 0) {
      throw new Error('Username already taken. Please choose a different one.');
    }

    // 3. Create the auth user
    const { data, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError) throw authError;

    // 4. Insert the profile row (user is now authenticated)
    //    If this fails, sign out to avoid an orphaned auth user with no profile.
    if (data.user) {
      try {
        const { error: profileError } = await supabase.from('profiles').insert({
          id:                  data.user.id,
          gym_id:              gym.id,
          full_name:           fullName,
          username:            username.toLowerCase().trim(),
          role:                'member',
          is_onboarded:        false,
          date_of_birth:       dateOfBirth ?? null,
          terms_accepted_at:   termsAcceptedAt ?? null,
          privacy_accepted_at: privacyAcceptedAt ?? null,
          age_verified_at:     ageVerifiedAt ?? null,
        });
        if (profileError) throw profileError;

        // Fetch the profile now that it exists — the onAuthStateChange listener
        // already called fetchProfile, but it ran before the profile row was
        // inserted, so it returned null. This second call picks up the real row.
        await fetchProfile(data.user.id);
      } catch (err) {
        await supabase.auth.signOut();
        throw new Error('Account created but profile setup failed. Please try signing up again.');
      }
    }

    return data;
  }, []);

  // ── SIGN IN ────────────────────────────────────────────────
  const signIn = useCallback(async ({ email, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  // ── SIGN OUT ───────────────────────────────────────────────
  // Every step is wrapped — if push-token removal or local cleanup throws
  // (e.g. push_tokens RLS rejects, localStorage quota, etc.) we still want
  // the auth.signOut() to fire so the user actually gets signed out. Before
  // this fix, a thrown removePushTokens() left the user authenticated and
  // the button looked broken.
  const signOut = useCallback(async () => {
    try { if (user?.id) await removePushTokens(user.id); } catch (err) { console.warn('[signOut] removePushTokens failed:', err); }
    try { clearPersistedUserData(); } catch (err) { console.warn('[signOut] clearPersistedUserData failed:', err); }
    try { localStorage.removeItem('tugympr_active_view'); } catch { /* noop */ }
    try { setActiveView(null); } catch { /* noop */ }
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('[signOut] supabase.auth.signOut failed:', err);
      // Last resort: clear the auth-token from localStorage so the next
      // session check sees a logged-out state.
      try {
        for (let i = 0; i < localStorage.length; i += 1) {
          const k = localStorage.key(i);
          if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
            localStorage.removeItem(k);
          }
        }
      } catch { /* noop */ }
    }
    // Always navigate explicitly. Without this, the success path relies on the
    // SIGNED_OUT auth event cascading through React Router, which races against
    // realtime channel teardowns / posthog.reset() / Navigation unmount — any
    // throw in that cascade was the likely cause of the logout black screen.
    safeNavigate('/login', { replace: true });
  }, [user?.id]);

  // ── DELETE ACCOUNT ───────────────────────────────────────────
  // Cascade RPC wipes profile, storage objects, all user data, then
  // auth.users. Local cleanup + signOut drops any cached tokens.
  const deleteAccount = useCallback(async () => {
    const { error } = await supabase.rpc('delete_user_account');
    if (error) throw new Error(error.message || 'Failed to delete account. Please try again.');

    clearPersistedUserData();
    await supabase.auth.signOut();
    safeNavigate('/login', { replace: true });
  }, []);

  // ── REFRESH PROFILE ────────────────────────────────────────
  // Call this after onboarding completes to pick up is_onboarded = true
  const refreshProfile = useCallback(() => {
    if (user) return fetchProfile(user.id);
  }, [user]);

  // ── ROLE DEMOTION DETECTOR ─────────────────────────────────
  // If a trainer/admin is demoted while logged in, the cached profile.role
  // would otherwise stay until next login. On window focus / visibility,
  // re-fetch the profile; if the role changed and the active view is no
  // longer permitted, sign the user out so the route guards can route them
  // correctly on next login.
  useEffect(() => {
    if (!user?.id) return undefined;
    const handleFocus = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('role, additional_roles, membership_status')
          .eq('id', user.id)
          .maybeSingle();
        if (!data) return;
        const cachedRole = profile?.role;
        const serverRole = data.role;
        const downgraded =
          (cachedRole === 'trainer' && serverRole === 'member') ||
          (cachedRole === 'admin' && serverRole !== 'admin' && serverRole !== 'super_admin') ||
          (cachedRole === 'super_admin' && serverRole !== 'super_admin');
        const banned = ['banned', 'cancelled', 'deactivated'].includes(data.membership_status);
        if (downgraded || banned) {
          await supabase.auth.signOut();
        } else if (serverRole !== cachedRole) {
          // Role changed but not a downgrade — refresh cache silently.
          fetchProfile(user.id);
        }
      } catch { /* network blip — ignore */ }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') handleFocus();
    });
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [user?.id, profile?.role]);

  // Optimistic patch — merges safelisted fields into the local profile
  // immediately without a DB round-trip.  Follow up with refreshProfile() to confirm.
  const PATCHABLE_FIELDS = ['avatar_url', 'avatar_type', 'avatar_value', 'full_name', 'username', 'bio', 'privacy_public', 'leaderboard_visible', 'accent_color', 'trainer_icon', 'phone_number', 'specialties', 'years_of_experience', 'date_of_birth', 'age_verified_at'];
  const patchProfile = useCallback((fields) => {
    const safe = Object.fromEntries(
      Object.entries(fields).filter(([k]) => PATCHABLE_FIELDS.includes(k))
    );
    if (Object.keys(safe).length === 0) return;
    setProfile((prev) => (prev ? { ...prev, ...safe } : prev));
  }, []);

  const refreshLifetimePoints = useCallback(() => {
    if (profile?.id) {
      supabase.from('reward_points').select('lifetime_points').eq('profile_id', profile.id).maybeSingle()
        .then(({ data: pts }) => setLifetimePoints(pts?.lifetime_points ?? 0));
    }
  }, [profile?.id]);

  // ── Multi-role helpers ─────────────────────────────────────
  // availableRoles = profile.role + profile.additional_roles, deduped.
  // The order matters: primary role first, then extras, so the switcher
  // UI lists "your real role" first.
  const availableRoles = useMemo(() => {
    if (!profile?.role) return [];
    const extras = Array.isArray(profile.additional_roles) ? profile.additional_roles : [];
    return [profile.role, ...extras.filter((r) => r !== profile.role)];
  }, [profile?.role, profile?.additional_roles]);

  // effectiveView resolves to the user's current experience:
  // 1. activeView if set AND it's a role they actually have
  // 2. else profile.role (their primary)
  // 3. else null while loading
  const effectiveView = useMemo(() => {
    if (activeView && availableRoles.includes(activeView)) return activeView;
    return profile?.role || null;
  }, [activeView, availableRoles, profile?.role]);

  // switchView(role) — flips the active experience. The caller is
  // responsible for navigating to the right landing route after this
  // returns (member→/, trainer→/trainer, admin→/admin, super_admin→/platform).
  const switchView = useCallback(async (nextRole) => {
    if (!availableRoles.includes(nextRole)) {
      // Defensive — UI should already filter to available roles. Silently no-op.
      return false;
    }
    // SECURITY: never trust client-side `availableRoles` (derived from a
    // possibly-stale profile cache). Re-verify with the server before
    // flipping the view, so a tampered localStorage / stale tab can't grant
    // privilege the user no longer has.
    try {
      const { data, error } = await supabase.rpc('get_effective_roles');
      if (!error && data) {
        const serverRoles = Array.isArray(data) ? data : (data.roles || []);
        if (serverRoles.length && !serverRoles.includes(nextRole)) {
          return false;
        }
      } else if (error) {
        // TODO: get_effective_roles RPC not deployed yet — fall back to
        // client-side check above. Once the RPC is live, this branch should
        // become a hard reject.
        // eslint-disable-next-line no-console
        console.warn('[switchView] get_effective_roles unavailable; falling back to cached roles', error?.message);
      }
    } catch (err) {
      // TODO: as above — RPC may not exist yet on this gym's project.
      // eslint-disable-next-line no-console
      console.warn('[switchView] get_effective_roles threw; falling back', err?.message);
    }
    try { localStorage.setItem('tugympr_active_view', nextRole); } catch { /* quota */ }
    setActiveView(nextRole);
    return true;
  }, [availableRoles]);

  // Clear active view on sign-out so the next user doesn't inherit it.
  // Wrap signOut to do the cleanup. (signOut itself is defined later above
  // contextValue — we re-export a wrapper from there.)

  const contextValue = useMemo(() => ({
    user,
    profile,
    gymName,
    gymLogoUrl,
    loading,
    gymDeactivated,
    gymConfig,
    memberBlocked,
    lifetimePoints,
    refreshLifetimePoints,
    signUp,
    signIn,
    signOut,
    deleteAccount,
    refreshProfile,
    patchProfile,
    unreadNotifications,
    refreshNotifications,
    // True for legacy accounts (signed up before migration 0344) that have
    // no DOB on file. Enforced via a route-level interstitial; prevents
    // continued use of the app until the user self-attests age >= MIN_AGE.
    // New signups are gated at Signup.jsx so they always have DOB set.
    requiresAgeVerification: !!profile && !profile.date_of_birth && !profile.age_verified_at,
    // Multi-role
    availableRoles,
    activeView: effectiveView,
    switchView,
  }), [
    user,
    profile,
    gymName,
    gymLogoUrl,
    loading,
    gymDeactivated,
    gymConfig,
    memberBlocked,
    lifetimePoints,
    refreshLifetimePoints,
    signUp,
    signIn,
    signOut,
    deleteAccount,
    refreshProfile,
    patchProfile,
    unreadNotifications,
    refreshNotifications,
    availableRoles,
    effectiveView,
    switchView,
  ]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
