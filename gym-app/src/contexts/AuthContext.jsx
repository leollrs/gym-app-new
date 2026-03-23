import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { applyBranding } from '../lib/branding';
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

  // Fetch unread notification count for the current profile
  const fetchUnreadNotifications = async (profileId) => {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', profileId)
      .eq('read', false);
    if (!error) setUnreadNotifications(count || 0);
  };

  const refreshNotifications = () => {
    if (profile?.id) fetchUnreadNotifications(profile.id);
  };

  // Fetch the profile row for a given user id, then apply gym branding
  const fetchProfile = async (userId) => {
    const { data } = await supabase
      .from('profiles')
      .select('id, gym_id, full_name, username, role, is_onboarded, avatar_url, preferred_language, membership_status, last_active_at, qr_code_payload, leaderboard_visible')
      .eq('id', userId)
      .maybeSingle();
    setProfile(data ?? null);

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
    }

    setLoading(false);
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
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch unread notification count whenever the profile is loaded/changed
  useEffect(() => {
    if (profile?.id) {
      fetchUnreadNotifications(profile.id);
    } else {
      setUnreadNotifications(0);
    }
  }, [profile?.id]);

  // ── SIGN UP ────────────────────────────────────────────────
  // Creates the Supabase auth user then immediately inserts
  // a profiles row. Email confirmation must be DISABLED in
  // Supabase Auth settings for this to work without extra steps.
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
      .select('*', { count: 'exact', head: true })
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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  // ── SIGN OUT ───────────────────────────────────────────────
  const signOut = async () => {
    // Clear session drafts and preferences from localStorage to prevent data leakage
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('gym_session_') || key.startsWith('notification_prefs_'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch { /* localStorage may be unavailable */ }

    await supabase.auth.signOut();
  };

  // ── DELETE ACCOUNT ───────────────────────────────────────────
  const deleteAccount = async () => {
    // Server-side cascade delete via RPC
    const { error } = await supabase.rpc('delete_user_account');
    if (error) throw new Error(error.message || 'Failed to delete account. Please try again.');

    // Clear local data
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('gym_session_') || key.startsWith('notification_prefs_'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch { /* localStorage may be unavailable */ }

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
      signUp,
      signIn,
      signOut,
      deleteAccount,
      refreshProfile,
      unreadNotifications,
      refreshNotifications,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
