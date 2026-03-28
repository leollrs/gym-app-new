import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Dumbbell, Mail, Lock, User, Hash, AlertCircle, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const Field = ({ label, icon: Icon, error, ...props }) => (
  <div>
    <label className="block text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
      {label}
    </label>
    <div className="relative">
      {Icon && <Icon size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#4B5563]" />}
      <input
        {...props}
        className={`w-full bg-[#0B1220] border rounded-xl ${Icon ? 'pl-10' : 'pl-4'} pr-4 py-3 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none transition-colors ${
          error ? 'border-red-500/40 focus:border-red-500/60' : 'border-white/8 focus:border-[#D4AF37]/40'
        }`}
      />
    </div>
    {error && <p className="text-[11px] text-red-400 mt-1.5">{error}</p>}
  </div>
);

const Signup = () => {
  const { signUp } = useAuth();
  const navigate   = useNavigate();
  const { t }      = useTranslation(['auth', 'common']);
  const [searchParams] = useSearchParams();

  const inviteSlug = searchParams.get('gym') ?? '';
  const [gymName, setGymName] = useState('');

  const [form, setForm] = useState({
    fullName: '', username: '', email: '',
    password: '', confirmPassword: '', gymSlug: inviteSlug,
  });
  const [errors,      setErrors]      = useState({});
  const [globalError, setGlobalError] = useState('');
  const [loading,     setLoading]     = useState(false);

  // Anti-enumeration: track failed signup attempts
  const signupAttempts = useRef(0);
  const MAX_SIGNUP_ATTEMPTS = 8;

  // If coming via invite link, verify gym exists (don't leak gym name to unauthenticated users)
  useEffect(() => {
    if (!inviteSlug) return;
    supabase
      .from('gyms')
      .select('id')
      .eq('slug', inviteSlug.toLowerCase())
      .eq('is_active', true)
      .single()
      .then(({ data }) => { if (data) setGymName('your gym'); });
  }, [inviteSlug]);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const validate = () => {
    const errs = {};
    if (!form.fullName.trim())              errs.fullName        = t('common:required');
    if (!form.username.trim())              errs.username        = t('common:required');
    else if (!/^[a-zA-Z0-9_]{3,20}$/.test(form.username.trim()))
      errs.username = 'Username must be 3-20 characters: letters, numbers, or underscores only';
    if (!form.email.trim())                 errs.email           = t('common:required');
    if (form.password.length < 8)           errs.password        = t('minChars');
    else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(form.password))
      errs.password = 'Password must include uppercase, lowercase, and a number';
    if (form.password !== form.confirmPassword) errs.confirmPassword = t('passwordsMismatch');
    if (!form.gymSlug.trim())               errs.gymSlug         = t('common:required');
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGlobalError('');

    // Anti-enumeration: block after too many failed attempts
    if (signupAttempts.current >= MAX_SIGNUP_ATTEMPTS) {
      setGlobalError('Too many attempts. Please try again later.');
      return;
    }

    // Server-side-enforceable length validation
    if (form.fullName.trim().length > 100 || form.fullName.trim().length < 1) {
      setGlobalError('Full name must be between 1 and 100 characters');
      return;
    }
    if (form.username && form.username.length > 30) {
      setGlobalError('Username must be 30 characters or less');
      return;
    }
    if (form.email.length > 254) {
      setGlobalError('Email must be 254 characters or less');
      return;
    }
    if (form.password.length > 128) {
      setGlobalError('Password must be 128 characters or less');
      return;
    }

    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    try {
      await signUp({
        email:    form.email,
        password: form.password,
        fullName: form.fullName,
        username: form.username,
        gymSlug:  form.gymSlug,
      });

      navigate('/onboarding');
    } catch (err) {
      signupAttempts.current += 1;
      setGlobalError(err.message || t('common:somethingWentWrong'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#05070B] flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-[420px]">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#D4AF37]/15 border border-[#D4AF37]/25 mb-5">
            <Dumbbell size={26} className="text-[#D4AF37]" strokeWidth={2} />
          </div>
          <h1 className="text-[26px] font-bold text-[#E5E7EB]">{t('createAccount')}</h1>
          <p className="text-[13px] text-[#6B7280] mt-1">
            {gymName ? t('joinGymNameSubtitle', { gymName }) : t('joinGymSubtitle')}
          </p>
        </div>

        {/* Invite context banner */}
        {inviteSlug && (
          <div className="flex items-center gap-2.5 bg-[#D4AF37]/10 border border-[#D4AF37]/25 rounded-xl px-4 py-3 mb-5">
            <CheckCircle size={15} className="text-[#D4AF37] flex-shrink-0" />
            <p className="text-[13px] text-[#D4AF37]">
              {gymName ? t('joiningGym', { gymName }) : t('joiningGymLoading')}
            </p>
          </div>
        )}

        {/* Card */}
        <div className="bg-[#0F172A] border border-white/6 rounded-2xl p-7">

          {globalError && (
            <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-6">
              <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
              <p className="text-[13px] text-red-400">{globalError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">

            <Field
              label={t('fullName')}
              icon={User}
              type="text"
              placeholder="Alex Johnson"
              value={form.fullName}
              onChange={set('fullName')}
              error={errors.fullName}
              maxLength={100}
            />

            <Field
              label={t('username')}
              icon={User}
              type="text"
              placeholder="alexj"
              value={form.username}
              onChange={set('username')}
              error={errors.username}
              maxLength={30}
            />

            <Field
              label={t('email')}
              icon={Mail}
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={set('email')}
              error={errors.email}
              maxLength={254}
            />

            <Field
              label={t('password')}
              icon={Lock}
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={set('password')}
              error={errors.password}
              maxLength={128}
            />

            <Field
              label={t('confirmPassword')}
              icon={Lock}
              type="password"
              placeholder="••••••••"
              value={form.confirmPassword}
              onChange={set('confirmPassword')}
              error={errors.confirmPassword}
            />

            {/* Gym code — hidden when coming from invite link */}
            {!inviteSlug && (
              <div className="border-t border-white/6 pt-4 mt-1">
                <Field
                  label={t('gymCode')}
                  icon={Hash}
                  type="text"
                  placeholder="e.g. demo"
                  value={form.gymSlug}
                  onChange={set('gymSlug')}
                  error={errors.gymSlug}
                />
                <p className="text-[11px] text-[#4B5563] mt-1.5">
                  {t('gymCodeHint')}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold text-[15px] py-3.5 rounded-xl transition-colors"
            >
              {loading ? t('creatingAccount') : t('createAccountBtn')}
            </button>
            <p className="text-[11px] text-[#6B7280] text-center leading-relaxed">
              {t('agreeTerms')}{' '}
              <a href="/terms" className="text-[#D4AF37] hover:underline">{t('common:termsOfService')}</a>
              {' '}{t('and')}{' '}
              <a href="/privacy" className="text-[#D4AF37] hover:underline">{t('common:privacyPolicy')}</a>.
            </p>
          </form>
        </div>

        <p className="text-center text-[13px] text-[#6B7280] mt-6">
          {t('alreadyHaveAccount')}{' '}
          <Link to="/login" className="text-[#D4AF37] hover:text-[#E6C766] font-semibold transition-colors">
            {t('signInLink')}
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Signup;
