import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Dumbbell, Mail, Lock, AlertCircle, ArrowLeft, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const Login = () => {
  const { signIn } = useAuth();
  const navigate   = useNavigate();
  const { t }      = useTranslation(['auth', 'common']);

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  // Forgot password state
  const [forgotMode,    setForgotMode]    = useState(false);
  const [resetEmail,    setResetEmail]    = useState('');
  const [resetError,    setResetError]    = useState('');
  const [resetSuccess,  setResetSuccess]  = useState(false);
  const [resetLoading,  setResetLoading]  = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn({ email, password });
      navigate('/');
    } catch (err) {
      setError(err.message || t('invalidCredentials'));
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
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail);
      if (error) throw error;
      setResetSuccess(true);
    } catch (err) {
      setResetError(err.message || t('resetFailed'));
    } finally {
      setResetLoading(false);
    }
  };

  const enterForgotMode = () => {
    setForgotMode(true);
    setResetEmail(email); // pre-fill with login email if entered
    setResetError('');
    setResetSuccess(false);
  };

  const exitForgotMode = () => {
    setForgotMode(false);
    setResetError('');
    setResetSuccess(false);
  };

  return (
    <div className="min-h-screen bg-[#05070B] flex items-center justify-center px-5">
      <div className="w-full max-w-[400px]">

        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#D4AF37]/15 border border-[#D4AF37]/25 mb-5">
            <Dumbbell size={26} className="text-[#D4AF37]" strokeWidth={2} />
          </div>
          <h1 className="text-[26px] font-bold text-[#E5E7EB]">
            {forgotMode ? t('resetPassword') : t('welcomeBack')}
          </h1>
          <p className="text-[13px] text-[#6B7280] mt-1">
            {forgotMode ? t('resetSubtitle') : t('signInSubtitle')}
          </p>
        </div>

        {/* Card */}
        <div className="bg-[#0F172A] border border-white/6 rounded-2xl p-7">

          {forgotMode ? (
            <>
              {/* Reset success */}
              {resetSuccess && (
                <div className="flex items-center gap-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 mb-6">
                  <CheckCircle size={15} className="text-emerald-400 flex-shrink-0" />
                  <p className="text-[13px] text-emerald-400">{t('resetSuccess')}</p>
                </div>
              )}

              {/* Reset error */}
              {resetError && (
                <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-6">
                  <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
                  <p className="text-[13px] text-red-400">{resetError}</p>
                </div>
              )}

              <form onSubmit={handleResetPassword} className="flex flex-col gap-4">
                {/* Email */}
                <div>
                  <label className="block text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                    {t('email')}
                  </label>
                  <div className="relative">
                    <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#4B5563]" />
                    <input
                      type="email"
                      value={resetEmail}
                      onChange={e => setResetEmail(e.target.value)}
                      required
                      placeholder="you@example.com"
                      className="w-full bg-[#0B1220] border border-white/8 rounded-xl pl-10 pr-4 py-3 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
                    />
                  </div>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="mt-2 w-full bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold text-[15px] py-3.5 rounded-xl transition-colors"
                >
                  {resetLoading ? t('sendingReset') : t('sendResetLink')}
                </button>
              </form>

              {/* Back to login */}
              <button
                type="button"
                onClick={exitForgotMode}
                className="mt-4 w-full flex items-center justify-center gap-1.5 text-[13px] text-[#D4AF37] hover:text-[#E6C766] font-semibold transition-colors"
              >
                <ArrowLeft size={14} />
                {t('backToLogin')}
              </button>
            </>
          ) : (
            <>
              {/* Error */}
              {error && (
                <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-6">
                  <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
                  <p className="text-[13px] text-red-400">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">

                {/* Email */}
                <div>
                  <label className="block text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                    {t('email')}
                  </label>
                  <div className="relative">
                    <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#4B5563]" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      placeholder="you@example.com"
                      className="w-full bg-[#0B1220] border border-white/8 rounded-xl pl-10 pr-4 py-3 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                      {t('password')}
                    </label>
                    <button
                      type="button"
                      onClick={enterForgotMode}
                      className="text-[11px] text-[#D4AF37] hover:text-[#E6C766] font-semibold transition-colors"
                    >
                      {t('forgotPassword')}
                    </button>
                  </div>
                  <div className="relative">
                    <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#4B5563]" />
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      className="w-full bg-[#0B1220] border border-white/8 rounded-xl pl-10 pr-4 py-3 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
                    />
                  </div>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading}
                  className="mt-2 w-full bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold text-[15px] py-3.5 rounded-xl transition-colors"
                >
                  {loading ? t('signingIn') : t('signIn')}
                </button>
              </form>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-[13px] text-[#6B7280] mt-6">
          {t('dontHaveAccount')}{' '}
          <Link to="/signup" className="text-[#D4AF37] hover:text-[#E6C766] font-semibold transition-colors">
            {t('signUp')}
          </Link>
        </p>
        <p className="text-center text-[11px] text-[#6B7280] mt-3">
          <a href="/privacy" className="text-[#6B7280] hover:text-[#9CA3AF] hover:underline">{t('common:privacyPolicy')}</a>
          {' · '}
          <a href="/terms" className="text-[#6B7280] hover:text-[#9CA3AF] hover:underline">{t('common:termsOfService')}</a>
        </p>
      </div>
    </div>
  );
};

export default Login;
