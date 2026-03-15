import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { applyBranding } from '../lib/branding';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
  const [user, setUser]       = useState(null);
  const [profile, setProfile] = useState(null);
  const [gymName, setGymName] = useState('');
  const [gymLogoUrl, setGymLogoUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

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
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    setProfile(data ?? null);

    if (data?.gym_id) {
      const [{ data: branding }, { data: gym }] = await Promise.all([
        supabase
          .from('gym_branding')
          .select('primary_color, accent_color, custom_app_name, logo_url')
          .eq('gym_id', data.gym_id)
          .single(),
        supabase
          .from('gyms')
          .select('name')
          .eq('id', data.gym_id)
          .single(),
      ]);
      if (branding?.primary_color) applyBranding(branding.primary_color);
      setGymName(gym?.name || branding?.custom_app_name || '');

      // Resolve a signed logo URL if a storage path is present
      if (branding?.logo_url) {
        const { data: signed, error } = await supabase
          .storage
          .from('gym-logos')
          .createSignedUrl(branding.logo_url, 60 * 60 * 24); // 1 day
        if (!error && signed?.signedUrl) {
          setGymLogoUrl(signed.signedUrl);
        } else {
          setGymLogoUrl('');
        }
      } else {
        setGymLogoUrl('');
      }
    } else {
      setGymLogoUrl('');
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

    // 2. Check if username is already taken
    const { count, error: usernameError } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('username', username.toLowerCase().trim());

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
