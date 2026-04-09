import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { applyBranding } from '../lib/branding';
import { getPalette } from '../lib/palettes';
import { resetToDefault } from '../lib/themeGenerator';
import { setErrorTrackerAuth } from '../lib/errorTracker';
import { syncUserContextToWatch, syncFriendsToWatch, syncRoutinesToWatch } from '../lib/watchBridge';
import { removePushTokens } from '../lib/pushNotifications';
import posthog from 'posthog-js';
import i18n from '../i18n/i18n';

const AuthContext = createContext({});

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
  const [user, setUser]       = useState(null);
  const [profile, setProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem('offline_profile')); } catch { return null; }
  });
  const [gymName, setGymName] = useState(() => {
    try { return JSON.parse(localStorage.getItem('offline_gym'))?.name || ''; } catch { return ''; }
  });
  const [gymLogoUrl, setGymLogoUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [gymDeactivated, setGymDeactivated] = useState(false);
  const [gymConfig, setGymConfig] = useState({});
  const [memberBlocked, setMemberBlocked] = useState(null); // null = not blocked, 'deactivated' | 'banned'
  const [lifetimePoints, setLifetimePoints] = useState(null); // null = not loaded yet, 0+ = loaded
  const [mfaRequired, setMfaRequired] = useState(false);
  const watchSyncTimeoutRef = useRef(null);

  // Fetch unread notification count for the current profile
  const fetchUnreadNotifications = useCallback(async (profileId) => {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profileId)
      .is('read_at', null)
      .is('dismissed_at', null);
    if (!error) setUnreadNotifications(count || 0);
  }, []);

  const refreshNotifications = useCallback(() => {
    if (profile?.id) fetchUnreadNotifications(profile.id);
  }, [profile?.id, fetchUnreadNotifications]);

  // Fetch the profile row for a given user id, then apply gym branding
  const fetchProfile = async (userId) => {
    // Single RPC call replaces profile + branding + gym + points + notifications queries
    const { data: rpcResult, error: rpcError } = await supabase.rpc('get_auth_context');

    // Fallback to direct query if RPC fails (e.g. migration not yet applied)
    let data, branding, gym;
    if (rpcError || !rpcResult) {
      const { data: fallback } = await supabase
        .from('profiles')
        .select('id, gym_id, full_name, username, role, is_onboarded, avatar_url, avatar_type, avatar_value, avatar_color, avatar_design, preferred_language, membership_status, last_active_at, qr_code_payload, preferred_training_days, skip_suggestion_date')
        .eq('id', userId)
        .maybeSingle();
      data = fallback;
      branding = null;
      gym = null;
    } else {
      data = rpcResult.profile ?? null;
      branding = rpcResult.branding ?? null;
      gym = rpcResult.gym ?? null;
      // Apply lifetime points and unread count from RPC
      setLifetimePoints(rpcResult.lifetime_points ?? 0);
      setUnreadNotifications(rpcResult.unread_count ?? 0);
    }

    setProfile(data ?? null);

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
      setGymName(gym?.name || branding?.custom_app_name || '');
      setGymConfig({
        qrEnabled: gym?.qr_enabled ?? false,
        qrDisplayFormat: gym?.qr_display_format ?? 'qr_code',
        classesEnabled: gym?.classes_enabled ?? false,
        setupCompleted: gym?.setup_completed ?? true, // default true so existing gyms don't see wizard
      });

      // Cache minimal non-sensitive data for offline display only
      try {
        localStorage.setItem('offline_profile', JSON.stringify({
          id: data.id,
          full_name: data.full_name,
          username: data.username,
          avatar_url: data.avatar_url,
          avatar_type: data.avatar_type,
          avatar_value: data.avatar_value,
        }));
        localStorage.setItem('offline_gym', JSON.stringify({
          name: gym?.name || branding?.custom_app_name || '',
          qrEnabled: gym?.qr_enabled ?? false,
          qrDisplayFormat: gym?.qr_display_format ?? 'qr_code',
          classesEnabled: gym?.classes_enabled ?? false,
          setupCompleted: gym?.setup_completed ?? true,
        }));
      } catch {}

      setErrorTrackerAuth({ id: userId }, data, gym?.name || branding?.custom_app_name || '');

      // Identify user in PostHog
      try {
        posthog.identify(userId, {
          role: data.role,
          gym_id: data.gym_id,
          platform: window.Capacitor?.getPlatform?.() || 'web',
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

    // MFA check for privileged roles (silent — does not block login)
    if (['admin', 'super_admin', 'trainer'].includes(data?.role)) {
      try {
        const { data: mfaData } = await supabase.auth.mfa.listFactors();
        const hasVerifiedFactor = mfaData?.totp?.some(f => f.status === 'verified');
        setMfaRequired(!hasVerifiedFactor);
      } catch {
        setMfaRequired(false);
      }
    } else {
      setMfaRequired(false);
    }

    setLoading(false);

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
          syncUserContextToWatch({
            qrPayload: capturedData.qr_code_payload || '',
            userName: capturedData.full_name || capturedData.username || '',
            streak,
            lastWorkoutDate: weeklyRes.data?.[0]?.completed_at || '',
            weeklyWorkoutCount: weeklyRes.data?.length || 0,
          });
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
  };

  useEffect(() => {
    // Check for an existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setLoading(false);
    });

    // Subscribe to auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        setLoading(true);
        fetchProfile(session.user.id);
      } else {
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
        try { posthog.reset(); } catch {}
      }
    });

    return () => {
      subscription.unsubscribe();
      // Clean up any pending Watch sync timeout
      if (watchSyncTimeoutRef.current) {
        clearTimeout(watchSyncTimeoutRef.current);
        watchSyncTimeoutRef.current = null;
      }
    };
  }, []);

  // Fetch unread notification count whenever the profile is loaded/changed
  // + subscribe to realtime inserts so the bell badge updates live
  useEffect(() => {
    if (profile?.id) {
      fetchUnreadNotifications(profile.id);

      const channel = supabase
        .channel('unread-notif-badge')
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `profile_id=eq.${profile.id}`,
        }, () => {
          setUnreadNotifications(prev => prev + 1);
        })
        .subscribe();

      return () => supabase.removeChannel(channel);
    } else {
      setUnreadNotifications(0);
    }
  }, [profile?.id]);

  // ── SIGN UP ────────────────────────────────────────────────
  // Creates the Supabase auth user then immediately inserts a profiles row.
  const signUp = useCallback(async ({ email, password, fullName, username, gymSlug }) => {
    // 1. Look up the gym by slug
    const { data: gym, error: gymError } = await supabase
      .from('gyms')
      .select('id')
      .eq('slug', gymSlug.toLowerCase().trim())
      .eq('is_active', true)
      .single();

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
          id:           data.user.id,
          gym_id:       gym.id,
          full_name:    fullName,
          username:     username.toLowerCase().trim(),
          role:         'member',
          is_onboarded: false,
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
  const signOut = useCallback(async () => {
    // Remove push tokens so the device stops receiving notifications
    if (user?.id) await removePushTokens(user.id);

    clearPersistedUserData();

    await supabase.auth.signOut();
  }, [user?.id]);

  // ── DELETE ACCOUNT ───────────────────────────────────────────
  const deleteAccount = useCallback(async () => {
    // Server-side cascade delete via RPC
    const { error } = await supabase.rpc('delete_user_account');
    if (error) throw new Error(error.message || 'Failed to delete account. Please try again.');

    clearPersistedUserData();

    await supabase.auth.signOut();
  }, []);

  // ── REFRESH PROFILE ────────────────────────────────────────
  // Call this after onboarding completes to pick up is_onboarded = true
  const refreshProfile = useCallback(() => {
    if (user) return fetchProfile(user.id);
  }, [user]);

  // Optimistic patch — merges safelisted fields into the local profile
  // immediately without a DB round-trip.  Follow up with refreshProfile() to confirm.
  const PATCHABLE_FIELDS = ['avatar_url', 'avatar_type', 'avatar_value', 'full_name', 'username', 'bio', 'privacy_public', 'leaderboard_visible'];
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
    mfaRequired,
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
    mfaRequired,
  ]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
