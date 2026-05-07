import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, AlertCircle, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const OB = {
  bg: '#f0eee9',
  surface: '#ffffff',
  ink: '#0B0F12',
  sub: '#6B6A63',
  mute: '#9A988E',
  line: 'rgba(11,15,18,0.08)',
  teal: '#2EC4C4',
  tealDeep: '#0FA5A5',
};
const FONT_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const FONT_BODY = '"Familjen Grotesk", -apple-system, system-ui, sans-serif';

const ResetPassword = () => {
  const navigate = useNavigate();
  const { t } = useTranslation(['auth', 'common']);

  const [recoveryReady, setRecoveryReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Supabase auto-parses the recovery token from the URL hash and emits
    // PASSWORD_RECOVERY. We mark the form ready as soon as we see the event,
    // OR if a session already exists (page loaded after the SDK initialized).
    let active = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (active && session) setRecoveryReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryReady(true);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError(t('minChars', 'Password must be at least 8 characters'));
      return;
    }
    if (password !== confirm) {
      setError(t('passwordsDoNotMatch', 'Passwords do not match'));
      return;
    }
    setLoading(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) throw updateErr;
      setSuccess(true);
      setTimeout(() => navigate('/', { replace: true }), 1500);
    } catch (err) {
      setError(err?.message || t('resetFailed', 'Could not update password. The link may have expired.'));
    } finally {
      setLoading(false);
    }
  };

  const inputWrap = {
    position: 'relative', display: 'flex', alignItems: 'center',
    height: 52, background: OB.surface, border: `1.5px solid ${OB.line}`,
    borderRadius: 14, paddingLeft: 44, paddingRight: 44,
  };
  const inputStyle = {
    flex: 1, height: '100%', background: 'transparent', border: 'none',
    outline: 'none', fontFamily: FONT_BODY, fontSize: 15, color: OB.ink,
  };
  const labelStyle = {
    display: 'block', fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700,
    color: OB.sub, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8,
  };
  const primaryBtn = (disabled) => ({
    width: '100%', height: 54, borderRadius: 999, background: OB.teal,
    color: '#0A2A2A', fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 16,
    border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  });

  return (
    <main
      className="min-h-screen flex items-center justify-center px-5 py-10"
      style={{ backgroundColor: OB.bg, fontFamily: FONT_BODY, color: OB.ink }}
    >
      <div className="w-full max-w-[420px] animate-fade-in">
        <h1 style={{
          fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 34,
          letterSpacing: -1.4, color: OB.ink, margin: 0,
        }}>
          {t('setNewPassword', 'Set a new password')}
        </h1>
        <p style={{ fontSize: 15, color: OB.sub, marginTop: 6 }}>
          {t('setNewPasswordSubtitle', 'Choose a strong password you haven\'t used before.')}
        </p>

        <div style={{ marginTop: 28 }}>
          {success && (
            <div role="status" style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: '#E7F5E7', border: `1px solid #5EAA5E33`,
              borderRadius: 14, padding: '12px 14px', marginBottom: 18,
            }}>
              <CheckCircle size={15} color="#3E7A3E" />
              <p style={{ fontSize: 13, color: '#2d5a2d', margin: 0 }}>
                {t('passwordUpdated', 'Password updated. Redirecting…')}
              </p>
            </div>
          )}

          {error && (
            <div role="alert" style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: '#FDECE7', border: `1px solid #FF5A2E33`,
              borderRadius: 14, padding: '12px 14px', marginBottom: 18,
            }}>
              <AlertCircle size={15} color="#C13B14" />
              <p style={{ fontSize: 13, color: '#C13B14', margin: 0 }}>{error}</p>
            </div>
          )}

          {!recoveryReady && !success && (
            <p style={{ fontSize: 13, color: OB.mute, marginBottom: 18 }}>
              {t('verifyingResetLink', 'Verifying your reset link…')}
            </p>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <label htmlFor="new-password" style={labelStyle}>{t('newPassword', 'New password')}</label>
              <div style={inputWrap}>
                <Lock size={16} color={OB.mute} style={{ position: 'absolute', left: 16 }} />
                <input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  aria-label={showPassword ? t('hidePassword', { defaultValue: 'Hide password' }) : t('showPassword', { defaultValue: 'Show password' })}
                  style={{
                    position: 'absolute', right: 12, background: 'transparent',
                    border: 'none', color: OB.mute, cursor: 'pointer',
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirm-password" style={labelStyle}>{t('confirmPassword', 'Confirm password')}</label>
              <div style={{ ...inputWrap, paddingRight: 12 }}>
                <Lock size={16} color={OB.mute} style={{ position: 'absolute', left: 16 }} />
                <input
                  id="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  style={inputStyle}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || success || !recoveryReady}
              style={primaryBtn(loading || success || !recoveryReady)}
            >
              {loading ? t('saving', 'Saving…') : t('updatePassword', 'Update password')}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
};

export default ResetPassword;
