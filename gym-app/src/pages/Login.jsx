import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Lock, AlertCircle, ChevronLeft, CheckCircle, Eye, EyeOff, KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { PROD_RESET_URL } from '../lib/appUrls';

const LOCKOUT_KEY = 'tugympr_login_lockout';

// ─── Warm-paper design tokens (branded auth, pre-gym-theme) ───────────
const OB = {
  bg: '#f0eee9',
  surface: '#ffffff',
  surface2: '#e8e5de',
  ink: '#0B0F12',
  sub: '#6B6A63',
  mute: '#9A988E',
  line: 'rgba(11,15,18,0.08)',
  lineStrong: 'rgba(11,15,18,0.14)',
  teal: '#2EC4C4',
  tealDeep: '#0FA5A5',
  tealSoft: '#D7F1F1',
};
const FONT_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const FONT_BODY = '"Familjen Grotesk", -apple-system, system-ui, sans-serif';
const CARD_SHADOW = '0 1px 2px rgba(11,15,18,0.04), 0 6px 18px rgba(11,15,18,0.05)';

// Inline logo (gold-teal PR monogram mark on dark ink background)
const OBLogo = ({ size = 48 }) => (
  <img
    src="/icon-512.png"
    alt="TuGymPR"
    width={size}
    height={size}
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.26,
      objectFit: 'cover',
      display: 'block',
    }}
  />
);

const Login = () => {
  const { signIn } = useAuth();
  // Post-login redirect is owned by PublicRoute (it honors any saved deep-link
  // destination, e.g. a TV challenge QR scanned while signed out).
  const { t }      = useTranslation(['auth', 'common']);

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  // Forgot password state
  const [forgotMode,   setForgotMode]   = useState(false);
  const [resetEmail,   setResetEmail]   = useState('');
  const [resetError,   setResetError]   = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  // "I have a reset code" sub-flow — consumes admin-issued / emailed 6-digit
  // codes via the reset-password edge function (front-desk / no-email members).
  const [codeMode,     setCodeMode]     = useState(false);
  const [resetCode,    setResetCode]    = useState('');
  const [newPw,        setNewPw]        = useState('');
  const [confirmPw,    setConfirmPw]    = useState('');
  const [showNewPw,    setShowNewPw]    = useState(false);

  // ── Persist lockout / failCount in localStorage so it survives refresh ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCKOUT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.failCount === 'number') {
          setLoginAttempts(parsed.failCount);
        }
        if (typeof parsed.lockedUntil === 'number' && parsed.lockedUntil > Date.now()) {
          setLockoutUntil(parsed.lockedUntil);
        } else if (parsed.lockedUntil) {
          // expired lock — clear it
          localStorage.removeItem(LOCKOUT_KEY);
        }
      }
    } catch { /* ignore corrupt storage */ }
  }, []);

  const persistLockout = (failCount, lockedUntil) => {
    try {
      if (!failCount && !lockedUntil) {
        localStorage.removeItem(LOCKOUT_KEY);
      } else {
        localStorage.setItem(LOCKOUT_KEY, JSON.stringify({ failCount, lockedUntil }));
      }
    } catch { /* ignore */ }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (lockoutUntil && Date.now() < lockoutUntil) {
      const secondsLeft = Math.ceil((lockoutUntil - Date.now()) / 1000);
      setError(t('lockoutRetry', { defaultValue: 'Too many attempts. Try again in {{seconds}}s', seconds: secondsLeft }));
      return;
    }

    setError('');
    setLoading(true);
    try {
      await signIn({ email, password });
      setLoginAttempts(0);
      setLockoutUntil(null);
      persistLockout(0, null);
      // No explicit navigate — PublicRoute redirects once auth state lands
      // (and restores any saved deep-link destination).
    } catch {
      setError(t('invalidCredentials'));
      const attempts = loginAttempts + 1;
      if (attempts >= 5) {
        const until = Date.now() + 30000;
        setLockoutUntil(until);
        setLoginAttempts(0);
        persistLockout(0, until);
      } else {
        setLoginAttempts(attempts);
        persistLockout(attempts, lockoutUntil);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setResetError('');
    setResetSuccess(false);
    setResetLoading(true);
    try {
      // Always send users to the production HTTPS reset page. The email link
      // travels across devices (phone vs laptop, mail app vs browser) — pinning
      // it to a public URL avoids the "tap email, hits localhost" trap.
      //
      // NOTE: PROD_RESET_URL must also be added to Supabase Dashboard → Auth →
      // URL Configuration → Redirect URLs, otherwise Supabase silently
      // substitutes the Site URL.
      const redirectTo = import.meta.env.PROD
        ? PROD_RESET_URL
        : `${window.location.origin}/auth/reset-password`;

      const { error: err } = await supabase.auth.resetPasswordForEmail(
        resetEmail,
        { redirectTo }
      );
      if (err) throw err;
      setResetSuccess(true);
    } catch (err) {
      setResetError(err.message || t('resetFailed'));
    } finally {
      setResetLoading(false);
    }
  };

  // Consume a 6-digit reset code (admin-issued or emailed) and set a new
  // password via the public reset-password edge function. No auth required —
  // the code + email are the proof of identity.
  const handleResetWithCode = async (e) => {
    e.preventDefault();
    setResetError('');
    setResetSuccess(false);
    if (!/^\d{6}$/.test(resetCode.trim())) {
      setResetError(t('resetCodeInvalid', { defaultValue: 'Enter the 6-digit code.' }));
      return;
    }
    if (newPw.length < 8) {
      setResetError(t('resetPasswordTooShort', { defaultValue: 'Password must be at least 8 characters.' }));
      return;
    }
    if (newPw !== confirmPw) {
      setResetError(t('resetPasswordMismatch', { defaultValue: 'Passwords do not match.' }));
      return;
    }
    setResetLoading(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('reset-password', {
        body: { email_code: resetCode.trim(), email: resetEmail.trim().toLowerCase(), new_password: newPw },
      });
      if (fnErr) {
        // supabase-js wraps non-2xx as FunctionsHttpError with a generic
        // message; the real reason is in the response body. Surface it.
        let serverMsg = '';
        try { const ctx = await fnErr.context?.json?.(); serverMsg = ctx?.error || ''; } catch { /* ignore */ }
        throw new Error(serverMsg || t('resetCodeFailed', { defaultValue: 'Invalid or expired code. Please check it and try again.' }));
      }
      if (data?.error) throw new Error(data.error);
      setResetSuccess(true);
      setResetCode(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      setResetError(err.message || t('resetFailed'));
    } finally {
      setResetLoading(false);
    }
  };

  const enterForgotMode = () => {
    setForgotMode(true);
    setCodeMode(false);
    setResetEmail(email);
    setResetError('');
    setResetSuccess(false);
  };

  const enterCodeMode = () => {
    setCodeMode(true);
    setResetError('');
    setResetSuccess(false);
  };

  const exitForgotMode = () => {
    setForgotMode(false);
    setCodeMode(false);
    setResetCode(''); setNewPw(''); setConfirmPw('');
    setResetError('');
    setResetSuccess(false);
    if (resetEmail) setEmail(resetEmail);
  };

  // ── Shared field styles ─────────────────────────────────────
  const inputWrap = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    height: 52,
    background: OB.surface,
    border: `1.5px solid ${OB.line}`,
    borderRadius: 14,
    paddingLeft: 44,
    paddingRight: 12,
    transition: 'border-color 0.2s ease',
  };

  const inputStyle = {
    flex: 1,
    height: '100%',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    fontFamily: FONT_BODY,
    fontSize: 15,
    color: OB.ink,
    letterSpacing: 0,
  };

  const labelStyle = {
    display: 'block',
    fontFamily: FONT_BODY,
    fontSize: 11,
    fontWeight: 700,
    color: OB.sub,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 8,
  };

  const primaryBtn = (disabled) => ({
    width: '100%',
    height: 54,
    borderRadius: 999,
    background: OB.teal,
    color: '#0A2A2A',
    fontFamily: FONT_DISPLAY,
    fontWeight: 800,
    fontSize: 16,
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'background 0.2s ease, transform 0.1s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  });

  return (
    <main
      className="min-h-screen flex items-center justify-center px-5 py-10"
      style={{ backgroundColor: OB.bg, fontFamily: FONT_BODY, color: OB.ink }}
    >
      <div className="w-full max-w-[420px] animate-fade-in">
        {/* Default entry — no back button, no logo, go straight into welcome back */}
        <div style={{ height: 8 }} />

        {/* Heading */}
        <h1
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 900,
            fontSize: 34,
            letterSpacing: -1.4,
            color: OB.ink,
            lineHeight: 1.02,
            margin: 0,
          }}
        >
          {forgotMode ? (codeMode ? t('resetWithCodeTitle', { defaultValue: 'Enter reset code' }) : t('resetPassword')) : t('welcomeBack')}
        </h1>
        <p style={{ fontSize: 15, color: OB.sub, marginTop: 6 }}>
          {forgotMode ? (codeMode ? t('resetWithCodeSubtitle', { defaultValue: 'Enter the 6-digit code from your gym, then set a new password.' }) : t('resetSubtitle')) : t('signInSubtitle')}
        </p>

        {/* Card */}
        <div style={{ marginTop: 28 }}>
          {forgotMode ? (
            <>
              {resetSuccess && (
                <div
                  role="status"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: '#E7F5E7',
                    border: `1px solid #5EAA5E33`,
                    borderRadius: 14,
                    padding: '12px 14px',
                    marginBottom: 18,
                  }}
                >
                  <CheckCircle size={15} color="#3E7A3E" />
                  <p style={{ fontSize: 13, color: '#2d5a2d', margin: 0 }}>
                    {codeMode ? t('resetCodeSuccess', { defaultValue: 'Password updated — you can sign in now.' }) : t('resetSuccess')}
                  </p>
                </div>
              )}

              {resetError && (
                <div
                  role="alert"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: '#FDECE7',
                    border: `1px solid #FF5A2E33`,
                    borderRadius: 14,
                    padding: '12px 14px',
                    marginBottom: 18,
                  }}
                >
                  <AlertCircle size={15} color="#C13B14" />
                  <p style={{ fontSize: 13, color: '#C13B14', margin: 0 }}>{resetError}</p>
                </div>
              )}

              {codeMode ? (
                !resetSuccess && (
                  <form onSubmit={handleResetWithCode} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <label htmlFor="reset-email-code" style={labelStyle}>{t('email')}</label>
                      <div style={inputWrap}>
                        <Mail size={16} color={OB.mute} style={{ position: 'absolute', left: 16 }} />
                        <input id="reset-email-code" type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} required placeholder={t('emailPlaceholder', { defaultValue: 'you@example.com' })} style={inputStyle} />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="reset-code" style={labelStyle}>{t('resetCodeLabel', { defaultValue: 'Reset code' })}</label>
                      <div style={inputWrap}>
                        <KeyRound size={16} color={OB.mute} style={{ position: 'absolute', left: 16 }} />
                        <input id="reset-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={resetCode} onChange={e => setResetCode(e.target.value.replace(/\D/g, ''))} required placeholder={t('resetCodePlaceholder', { defaultValue: '6-digit code' })} style={{ ...inputStyle, letterSpacing: '0.3em', fontWeight: 700 }} />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="reset-newpw" style={labelStyle}>{t('newPasswordLabel', { defaultValue: 'New password' })}</label>
                      <div style={inputWrap}>
                        <Lock size={16} color={OB.mute} style={{ position: 'absolute', left: 16 }} />
                        <input id="reset-newpw" type={showNewPw ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)} required placeholder={t('newPasswordLabel', { defaultValue: 'New password' })} style={inputStyle} />
                        <button type="button" onClick={() => setShowNewPw(v => !v)} aria-label={showNewPw ? t('hidePassword', { defaultValue: 'Hide password' }) : t('showPassword', { defaultValue: 'Show password' })} style={{ position: 'absolute', right: 14, background: 'transparent', border: 'none', color: OB.mute, cursor: 'pointer', display: 'flex' }}>
                          {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="reset-confirmpw" style={labelStyle}>{t('confirmPasswordLabel', { defaultValue: 'Confirm password' })}</label>
                      <div style={inputWrap}>
                        <Lock size={16} color={OB.mute} style={{ position: 'absolute', left: 16 }} />
                        <input id="reset-confirmpw" type={showNewPw ? 'text' : 'password'} value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required placeholder={t('confirmPasswordLabel', { defaultValue: 'Confirm password' })} style={inputStyle} />
                      </div>
                    </div>
                    <button type="submit" disabled={resetLoading} style={primaryBtn(resetLoading)}>
                      {resetLoading ? t('updatingPassword', { defaultValue: 'Updating…' }) : t('updatePassword', { defaultValue: 'Update password' })}
                    </button>
                  </form>
                )
              ) : (
                !resetSuccess && (
                  <>
                    <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                      <div>
                        <label htmlFor="reset-email" style={labelStyle}>{t('email')}</label>
                        <div style={inputWrap}>
                          <Mail size={16} color={OB.mute} style={{ position: 'absolute', left: 16 }} />
                          <input
                            id="reset-email"
                            type="email"
                            value={resetEmail}
                            onChange={e => setResetEmail(e.target.value)}
                            required
                            placeholder={t('emailPlaceholder', { defaultValue: 'you@example.com' })}
                            style={inputStyle}
                          />
                        </div>
                      </div>

                      <button type="submit" disabled={resetLoading} style={primaryBtn(resetLoading)}>
                        {resetLoading ? t('sendingReset') : t('sendResetLink')}
                      </button>
                    </form>

                    <button
                      type="button"
                      onClick={enterCodeMode}
                      style={{ marginTop: 14, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'transparent', border: 'none', color: OB.tealDeep, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                    >
                      <KeyRound size={14} />
                      {t('haveCodeCta', { defaultValue: 'Have a code from your gym? Enter it' })}
                    </button>
                  </>
                )
              )}

              <button
                type="button"
                onClick={codeMode && !resetSuccess ? () => { setCodeMode(false); setResetError(''); } : exitForgotMode}
                style={{
                  marginTop: 16,
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  background: 'transparent',
                  border: 'none',
                  color: OB.tealDeep,
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                <ChevronLeft size={14} />
                {codeMode && !resetSuccess ? t('back', { defaultValue: 'Back' }) : t('backToLogin')}
              </button>
            </>
          ) : (
            <>
              {error && (
                <div
                  role="alert"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: '#FDECE7',
                    border: `1px solid #FF5A2E33`,
                    borderRadius: 14,
                    padding: '12px 14px',
                    marginBottom: 18,
                  }}
                >
                  <AlertCircle size={15} color="#C13B14" />
                  <p style={{ fontSize: 13, color: '#C13B14', margin: 0 }}>{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {/* Email */}
                <div>
                  <label htmlFor="login-email" style={labelStyle}>{t('email')}</label>
                  <div style={inputWrap}>
                    <Mail size={16} color={OB.mute} style={{ position: 'absolute', left: 16 }} />
                    <input
                      id="login-email"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      placeholder={t('emailPlaceholder', { defaultValue: 'you@example.com' })}
                      autoComplete="email"
                      style={inputStyle}
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label htmlFor="login-password" style={{ ...labelStyle, marginBottom: 0 }}>
                      {t('password')}
                    </label>
                    <button
                      type="button"
                      onClick={enterForgotMode}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: OB.tealDeep,
                        fontFamily: FONT_DISPLAY,
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                        padding: 0,
                        marginBottom: 8,
                      }}
                    >
                      {t('forgotPassword')}
                    </button>
                  </div>
                  <div style={{ ...inputWrap, paddingRight: 44 }}>
                    <Lock size={16} color={OB.mute} style={{ position: 'absolute', left: 16 }} />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      autoComplete="current-password"
                      style={inputStyle}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(p => !p)}
                      aria-label={showPassword ? t('hidePassword', { defaultValue: 'Hide password' }) : t('showPassword', { defaultValue: 'Show password' })}
                      style={{
                        position: 'absolute',
                        right: 12,
                        background: 'transparent',
                        border: 'none',
                        color: OB.mute,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <button type="submit" disabled={loading} style={primaryBtn(loading)}>
                  {loading ? t('signingIn') : t('signIn')}
                </button>
              </form>

            </>
          )}
        </div>

        {/* Footer */}
        <p style={{ textAlign: 'center', fontSize: 13, color: OB.sub, marginTop: 28 }}>
          {t('dontHaveAccount')}{' '}
          <Link
            to="/signup"
            style={{
              color: OB.ink,
              fontWeight: 700,
              textDecoration: 'underline',
              textDecorationColor: OB.teal,
              textDecorationThickness: 2,
              textUnderlineOffset: 3,
            }}
          >
            {t('signUp')}
          </Link>
        </p>
        <p style={{ textAlign: 'center', fontSize: 11, color: OB.mute, marginTop: 10 }}>
          <a href="/privacy" style={{ color: OB.mute, textDecoration: 'none' }}>{t('common:privacyPolicy')}</a>
          {' · '}
          <a href="/terms" style={{ color: OB.mute, textDecoration: 'none' }}>{t('common:termsOfService')}</a>
        </p>
      </div>
    </main>
  );
};

export default Login;
