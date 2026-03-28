import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { applyBranding } from '../lib/branding';
import { setErrorTrackerAuth } from '../lib/errorTracker';
import { syncUserContextToWatch, syncFriendsToWatch, syncRoutinesToWatch } from '../lib/watchBridge';
import { removePushTokens } from '../lib/pushNotifications';
import posthog from 'posthog-js';
import i18n from '../i18n/i18n';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
  const [user, setUser]       = useState(null);
  const [profile, setProfile] = useState(null);
  const [gymName, setGymName] = useState('');
  const [gymLogoUrl, setGymLogoUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [gymDeactivated, setGymDeactivated] = useState(false);
  const [gymConfig, setGymConfig] = useState({});
  const [memberBlocked, setMemberBlocked] = useState(null); // null = not blocked, 'deactivated' | 'banned'
  const [lifetimePoints, setLifetimePoints] = useState(null); // null = not loaded yet, 0+ = loaded
  const [mfaRequired, setMfaRequired] = useState(false);

  // Fetch unread notification count for the current profile
  const fetchUnreadNotifications = async (profileId) => {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profileId)
      .is('read_at', null);
    if (!error) setUnreadNotifications(count || 0);
  };

  const refreshNotifications = () => {
    if (profile?.id) fetchUnreadNotifications(profile.id);
  };

  // Fetch the profile row for a given user id, then apply gym branding
  const fetchProfile = async (userId) => {
    const { data } = await supabase
      .from('profiles')
      .select('id, gym_id, full_name, username, role, is_onboarded, avatar_url, preferred_language, membership_status, last_active_at, qr_code_payload, preferred_training_days, skip_suggestion_date')
      .eq('id', userId)
      .maybeSingle();
    setProfile(data ?? null);

    // Fetch lifetime points for level calculation (non-blocking)
    if (data?.id) {
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
      const [{ data: branding }, { data: gym }] = await Promise.all([
        supabase
          .from('gym_branding')
          .select('primary_color, accent_color, custom_app_name, logo_url')
          .eq('gym_id', data.gym_id)
          .single(),
        supabase
          .from('gyms')
          .select('name, is_active, qr_enabled, qr_display_format')
          .eq('id', data.gym_id)
          .maybeSingle(),
      ]);

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

      if (branding?.primary_color || branding?.accent_color) {
        applyBranding({
          primaryColor: branding.primary_color,
          secondaryColor: branding.accent_color,
        });
      }
      setGymName(gym?.name || branding?.custom_app_name || '');
      setGymConfig({
        qrEnabled: gym?.qr_enabled ?? false,
        qrDisplayFormat: gym?.qr_display_format ?? 'qr_code',
      });

      setErrorTrackerAuth({ id: userId }, data, gym?.name || branding?.custom_app_name || '');

      // Identify user in PostHog
      try {
        posthog.identify(userId, {
          name: data.full_name || data.username,
          role: data.role,
          gym_id: data.gym_id,
          gym_name: gym?.name || branding?.custom_app_name || '',
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

    // Enforce MFA for privileged roles
    if (['admin', 'super_admin', 'trainer'].includes(data?.role)) {
      try {
        const { data: mfaData } = await supabase.auth.mfa.listFactors();
        const hasVerifiedFactor = mfaData?.totp?.some(f => f.status === 'verified');
        if (!hasVerifiedFactor) {
          console.warn('MFA not enabled for privileged account:', data.role);
          setMfaRequired(true);
        } else {
          setMfaRequired(false);
        }
      } catch {
        // MFA check failed — don't block login, but flag it
        setMfaRequired(false);
      }
    } else {
      setMfaRequired(false);
    }

    setLoading(false);

    // Sync user context to Apple Watch (non-blocking)
    if (data?.id) {
      Promise.all([
        supabase.from('check_ins').select('checked_in_at').eq('profile_id', data.id).order('checked_in_at', { ascending: false }).limit(30),
        supabase.from('workout_sessions').select('completed_at').eq('profile_id', data.id).eq('status', 'completed').gte('completed_at', new Date(Date.now() - 7 * 86400000).toISOString()),
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
          qrPayload: data.qr_code_payload || '',
          userName: data.full_name || data.username || '',
          streak,
          lastWorkoutDate: weeklyRes.data?.[0]?.completed_at || '',
          weeklyWorkoutCount: weeklyRes.data?.length || 0,
        });
      }).catch(() => {});

      // Sync friends activity to Watch (non-blocking)
      supabase
        .from('friendships')
        .select('requester_id, addressee_id')
        .or(`requester_id.eq.${data.id},addressee_id.eq.${data.id}`)
        .eq('status', 'accepted')
        .limit(20)
        .then(({ data: friendships }) => {
          if (!friendships?.length) return;
          const friendIds = friendships.map(f => f.requester_id === data.id ? f.addressee_id : f.requester_id);
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
        supabase.from('routines').select('id, name, routine_exercises(id)').eq('created_by', data.id).eq('is_template', false).order('created_at', { ascending: false }),
        supabase.from('workout_sessions').select('routine_id, completed_at').eq('profile_id', data.id).eq('status', 'completed').order('completed_at', { ascending: false }).limit(50),
        supabase.from('generated_programs').select('program_start, expires_at').eq('profile_id', data.id).order('created_at', { ascending: false }).limit(1),
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
        setLoading(false);
        try { posthog.reset(); } catch {}
      }
    });

    return () => subscription.unsubscribe();
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
  const signUp = async ({ email, password, fullName, username, gymSlug }) => {
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
  };

  // ── SIGN IN ────────────────────────────────────────────────
  const signIn = async ({ email, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  // ── SIGN OUT ───────────────────────────────────────────────
  const signOut = async () => {
    // Remove push tokens so the device stops receiving notifications
    if (user?.id) await removePushTokens(user.id);

    // Clear ALL user-related data from localStorage to prevent data leakage
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
        'sb-',             // Supabase auth tokens
      ];
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && sensitiveKeyPrefixes.some(prefix => key.startsWith(prefix))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch { /* localStorage may be unavailable */ }

    // Also clear sessionStorage
    try { sessionStorage.clear(); } catch {}

    await supabase.auth.signOut();
  };

  // ── DELETE ACCOUNT ───────────────────────────────────────────
  const deleteAccount = async () => {
    // Server-side cascade delete via RPC
    const { error } = await supabase.rpc('delete_user_account');
    if (error) throw new Error(error.message || 'Failed to delete account. Please try again.');

    // Clear ALL user-related data from localStorage to prevent data leakage
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
        'sb-',             // Supabase auth tokens
      ];
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && sensitiveKeyPrefixes.some(prefix => key.startsWith(prefix))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch { /* localStorage may be unavailable */ }

    // Also clear sessionStorage
    try { sessionStorage.clear(); } catch {}

    await supabase.auth.signOut();
  };

  // ── REFRESH PROFILE ────────────────────────────────────────
  // Call this after onboarding completes to pick up is_onboarded = true
  const refreshProfile = () => {
    if (user) fetchProfile(user.id);
  };

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      gymName,
      gymLogoUrl,
      loading,
      gymDeactivated,
      gymConfig,
      memberBlocked,
      lifetimePoints,
      refreshLifetimePoints: () => {
        if (profile?.id) {
          supabase.from('reward_points').select('lifetime_points').eq('profile_id', profile.id).maybeSingle()
            .then(({ data: pts }) => setLifetimePoints(pts?.lifetime_points ?? 0));
        }
      },
      signUp,
      signIn,
      signOut,
      deleteAccount,
      refreshProfile,
      unreadNotifications,
      refreshNotifications,
      mfaRequired,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
