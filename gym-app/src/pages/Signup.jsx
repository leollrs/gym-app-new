import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Dumbbell, Mail, Lock, User, Hash, AlertCircle, CheckCircle } from 'lucide-react';
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
    if (!form.fullName.trim())              errs.fullName    = 'Required';
    if (!form.username.trim())              errs.username    = 'Required';
    if (form.username.includes(' '))        errs.username    = 'No spaces allowed';
    if (!form.email.trim())                 errs.email       = 'Required';
    if (form.password.length < 8)           errs.password    = 'At least 8 characters';
    if (form.password !== form.confirmPassword) errs.confirmPassword = 'Passwords do not match';
    if (!form.gymSlug.trim())               errs.gymSlug     = 'Required';
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGlobalError('');
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
      setGlobalError(err.message || 'Something went wrong. Please try again.');
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
          <h1 className="text-[26px] font-bold text-[#E5E7EB]">Create your account</h1>
          <p className="text-[13px] text-[#6B7280] mt-1">
            {gymName ? `Join ${gymName} and start tracking` : 'Join your gym and start tracking'}
          </p>
        </div>

        {/* Invite context banner */}
        {inviteSlug && (
          <div className="flex items-center gap-2.5 bg-[#D4AF37]/10 border border-[#D4AF37]/25 rounded-xl px-4 py-3 mb-5">
            <CheckCircle size={15} className="text-[#D4AF37] flex-shrink-0" />
            <p className="text-[13px] text-[#D4AF37]">
              {gymName ? `You're joining ${gymName}` : 'Joining your gym…'}
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
              label="Full Name"
              icon={User}
              type="text"
              placeholder="Alex Johnson"
              value={form.fullName}
              onChange={set('fullName')}
              error={errors.fullName}
            />

            <Field
              label="Username"
              icon={User}
              type="text"
              placeholder="alexj"
              value={form.username}
              onChange={set('username')}
              error={errors.username}
            />

            <Field
              label="Email"
              icon={Mail}
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={set('email')}
              error={errors.email}
            />

            <Field
              label="Password"
              icon={Lock}
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={set('password')}
              error={errors.password}
            />

            <Field
              label="Confirm Password"
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
                  label="Gym Code"
                  icon={Hash}
                  type="text"
                  placeholder="e.g. demo"
                  value={form.gymSlug}
                  onChange={set('gymSlug')}
                  error={errors.gymSlug}
                />
                <p className="text-[11px] text-[#4B5563] mt-1.5">
                  Ask your gym for their code to join their app.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold text-[15px] py-3.5 rounded-xl transition-colors"
            >
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>
        </div>

        <p className="text-center text-[13px] text-[#6B7280] mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-[#D4AF37] hover:text-[#E6C766] font-semibold transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Signup;
