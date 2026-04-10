import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Dumbbell, Mail, Lock, User, Hash, AlertCircle, CheckCircle, Gift, Loader2, Camera, Ticket, ChevronDown, Phone, X, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { validateEmail } from '../lib/validateEmail';

const AREA_CODES = [
  { code: '+1',   flag: '🇺🇸', label: 'US/CA' },
  { code: '+1',   flag: '🇵🇷', label: 'PR' },
  { code: '+52',  flag: '🇲🇽', label: 'MX' },
  { code: '+57',  flag: '🇨🇴', label: 'CO' },
  { code: '+34',  flag: '🇪🇸', label: 'ES' },
  { code: '+44',  flag: '🇬🇧', label: 'UK' },
  { code: '+55',  flag: '🇧🇷', label: 'BR' },
  { code: '+56',  flag: '🇨🇱', label: 'CL' },
  { code: '+58',  flag: '🇻🇪', label: 'VE' },
  { code: '+54',  flag: '🇦🇷', label: 'AR' },
  { code: '+51',  flag: '🇵🇪', label: 'PE' },
  { code: '+593', flag: '🇪🇨', label: 'EC' },
  { code: '+507', flag: '🇵🇦', label: 'PA' },
  { code: '+506', flag: '🇨🇷', label: 'CR' },
  { code: '+502', flag: '🇬🇹', label: 'GT' },
  { code: '+503', flag: '🇸🇻', label: 'SV' },
  { code: '+504', flag: '🇭🇳', label: 'HN' },
  { code: '+505', flag: '🇳🇮', label: 'NI' },
  { code: '+809', flag: '🇩🇴', label: 'DO' },
];

let fieldIdCounter = 0;
const Field = ({ label, icon: Icon, error, suffix, id: propId, ...props }) => {
  const fieldId = propId || `field-${label?.toString().replace(/\s+/g, '-').toLowerCase() || ++fieldIdCounter}`;
  return (
    <div>
      <label htmlFor={fieldId} className="block text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </label>
      <div className="relative">
        {Icon && <Icon size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--color-text-muted)" }} />}
        <input
          id={fieldId}
          {...props}
          className={`w-full bg-[var(--color-bg-input)] border rounded-xl ${Icon ? 'pl-10' : 'pl-4'} ${suffix ? 'pr-10' : 'pr-4'} py-3 text-[14px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none transition-colors ${
            error ? 'border-red-500/40 focus:border-red-500/60' : 'border-white/8 focus:border-[#D4AF37]/40'
          }`}
        />
        {suffix && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 z-10">
            {suffix}
          </div>
        )}
      </div>
      {error && <p className="text-[11px] text-red-400 mt-1.5">{error}</p>}
    </div>
  );
};

const Signup = () => {
  const { signUp } = useAuth();
  const navigate   = useNavigate();
  const { t }      = useTranslation(['auth', 'common']);
  const [searchParams] = useSearchParams();

  const inviteSlug = searchParams.get('gym') ?? '';

  // Pre-fill referral code from URL param or localStorage (set by deep link)
  const initialRefCode = searchParams.get('ref') ?? localStorage.getItem('pendingReferralCode') ?? '';
  // Pre-fill invite code from localStorage (set by deep link in App.jsx)
  const initialInviteCode = localStorage.getItem('pendingInviteCode') ?? '';
  const [gymName, setGymName] = useState('');

  // ── Entry mode: 'choose' | 'invite' | 'gymcode' ──
  const [entryMode, setEntryMode] = useState(
    inviteSlug ? 'gymcode' : initialInviteCode ? 'invite' : 'choose'
  );

  // ── Invite code state ──
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [inviteStatus, setInviteStatus] = useState('idle'); // idle | checking | valid | invalid
  const [inviteData, setInviteData] = useState(null); // { gym_name, member_name, email, phone, gym_slug }
  const inviteTimer = useRef(null);

  // ── QR Scanner state ──
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState('');

  const [form, setForm] = useState({
    fullName: '', username: '', email: '',
    password: '', confirmPassword: '', gymSlug: inviteSlug,
    referralCode: initialRefCode, phone: '',
  });
  const [areaCode, setAreaCode] = useState('+1');
  const [errors,      setErrors]      = useState({});
  const [globalError, setGlobalError] = useState('');
  const [loading,     setLoading]     = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Referral code validation state
  const [referralStatus, setReferralStatus] = useState('idle');
  const [referralData, setReferralData] = useState(null);
  const referralTimer = useRef(null);

  // Anti-enumeration: track failed signup attempts
  const signupAttempts = useRef(0);
  const MAX_SIGNUP_ATTEMPTS = 8;

  // Show form when invite or gym code is validated
  const showForm = entryMode === 'gymcode' || (entryMode === 'invite' && inviteStatus === 'valid');

  // Clear stored codes once we've loaded them
  useEffect(() => {
    if (initialRefCode) localStorage.removeItem('pendingReferralCode');
    if (initialInviteCode) localStorage.removeItem('pendingInviteCode');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // If the referral code was pre-filled, validate it immediately
  useEffect(() => {
    if (initialRefCode) validateReferralCode(initialRefCode);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // If invite code was pre-filled (from deep link), validate immediately
  useEffect(() => {
    if (initialInviteCode) validateInviteCode(initialInviteCode);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // If coming via invite link (?gym=slug), verify gym exists
  useEffect(() => {
    if (!inviteSlug) return;
    supabase
      .from('gyms')
      .select('id, name')
      .eq('slug', inviteSlug.toLowerCase())
      .eq('is_active', true)
      .single()
      .then(({ data }) => { if (data) setGymName(data.name || 'your gym'); });
  }, [inviteSlug]);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  // ── Invite code validation ──
  const validateInviteCode = async (code) => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setInviteStatus('idle');
      setInviteData(null);
      return;
    }

    setInviteStatus('checking');
    try {
      // Use SECURITY DEFINER RPC to look up invite codes (bypasses RLS)
      const { data: lookupResult } = await supabase.rpc('lookup_invite_by_code', {
        p_code: trimmed,
      });

      if (lookupResult) {
        // Found in member_invites via RPC
        // Fetch gym details for the gym_id
        const { data: gym } = await supabase
          .from('gyms')
          .select('id, name, slug')
          .eq('id', lookupResult.gym_id)
          .eq('is_active', true)
          .maybeSingle();

        setInviteStatus('valid');
        setInviteData({
          invite_id: null,
          gym_name: gym?.name || '',
          gym_slug: gym?.slug || '',
          member_name: lookupResult.full_name || '',
          email: '',
          phone: '',
          _source: 'member_invites',
        });

        setForm(f => ({
          ...f,
          fullName: f.fullName || lookupResult.full_name || '',
          gymSlug: gym?.slug || f.gymSlug,
        }));
        setGymName(gym?.name || '');
        return;
      }

      // Not in member_invites — try gym_invites via RPC
      const { data: gymLookup } = await supabase.rpc('lookup_gym_invite_by_code', {
        p_code: trimmed,
      });

      if (gymLookup) {
        const { data: gym } = await supabase
          .from('gyms')
          .select('id, name, slug')
          .eq('id', gymLookup.gym_id)
          .eq('is_active', true)
          .maybeSingle();

        setInviteStatus('valid');
        setInviteData({
          invite_id: gymLookup.id,
          gym_name: gym?.name || '',
          gym_slug: gym?.slug || '',
          member_name: gymLookup.full_name || '',
          email: gymLookup.email || '',
          phone: gymLookup.phone || '',
          _source: 'gym_invites',
        });

        setForm(f => ({
          ...f,
          fullName: f.fullName || gymLookup.full_name || '',
          email: f.email || gymLookup.email || '',
          phone: f.phone || gymLookup.phone || '',
          gymSlug: gym?.slug || f.gymSlug,
        }));
        setGymName(gym?.name || '');
        return;
      }

      // Not found in either table
      setInviteStatus('invalid');
      setInviteData(null);
    } catch {
      setInviteStatus('invalid');
      setInviteData(null);
    }
  };

  const handleInviteCodeChange = (e) => {
    const value = e.target.value.toUpperCase();
    setInviteCode(value);
    if (inviteTimer.current) clearTimeout(inviteTimer.current);
    if (!value.trim()) {
      setInviteStatus('idle');
      setInviteData(null);
      return;
    }
    inviteTimer.current = setTimeout(() => validateInviteCode(value), 600);
  };

  const handleInviteCodeBlur = () => {
    if (inviteTimer.current) clearTimeout(inviteTimer.current);
    if (inviteCode.trim()) validateInviteCode(inviteCode);
  };

  // ── QR Scanner ──
  const handleScanQR = async () => {
    const isNative = Capacitor.isNativePlatform();

    if (!isNative) {
      setScanError(t('qrScanRequiresApp'));
      return;
    }

    try {
      setScanError('');
      setScannerOpen(true);

      const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');

      const { camera } = await BarcodeScanner.requestPermissions();
      if (camera !== 'granted') {
        setScanError('Camera permission denied. Allow camera access in Settings.');
        setScannerOpen(false);
        return;
      }

      const { barcodes } = await BarcodeScanner.scan({
        formats: [BarcodeFormat.QrCode],
      });

      setScannerOpen(false);

      if (barcodes.length > 0 && barcodes[0].rawValue) {
        const rawValue = barcodes[0].rawValue.trim();
        // Extract invite code from URL like https://tugympr.app/invite/TGP-7X3K
        const inviteMatch = rawValue.match(/\/invite\/([A-Z0-9-]+)$/i);
        if (inviteMatch) {
          const code = inviteMatch[1].toUpperCase();
          setInviteCode(code);
          setEntryMode('invite');
          validateInviteCode(code);
        } else if (/^[A-Z0-9]+-[A-Z0-9]+$/i.test(rawValue)) {
          // Plain invite code (e.g. TGP-7X3K)
          const code = rawValue.toUpperCase();
          setInviteCode(code);
          setEntryMode('invite');
          validateInviteCode(code);
        } else {
          setScanError(t('qrScanError'));
        }
      }
    } catch (err) {
      setScannerOpen(false);
      if (err?.message?.includes('canceled') || err?.message?.includes('cancelled')) {
        return;
      }
      setScanError(err?.message || t('qrScanError'));
    }
  };

  // ── Referral code validation ──
  const validateReferralCode = async (code) => {
    const trimmed = code.trim();
    if (!trimmed) {
      setReferralStatus('idle');
      setReferralData(null);
      return;
    }

    setReferralStatus('checking');
    try {
      const { data, error } = await supabase
        .from('referral_codes')
        .select('id, profile_id, profiles!referral_codes_profile_id_fkey(full_name)')
        .eq('code', trimmed.toUpperCase())
        .eq('is_active', true)
        .single();

      if (error || !data) {
        setReferralStatus('invalid');
        setReferralData(null);
        return;
      }

      setReferralStatus('valid');
      setReferralData({
        referrer_id: data.profile_id,
        referrer_name: data.profiles?.full_name || 'Member',
        code_id: data.id,
      });
    } catch {
      setReferralStatus('invalid');
      setReferralData(null);
    }
  };

  const handleReferralChange = (e) => {
    const value = e.target.value;
    setForm(f => ({ ...f, referralCode: value }));
    if (referralTimer.current) clearTimeout(referralTimer.current);
    if (!value.trim()) {
      setReferralStatus('idle');
      setReferralData(null);
      return;
    }
    referralTimer.current = setTimeout(() => validateReferralCode(value), 600);
  };

  const handleReferralBlur = () => {
    if (referralTimer.current) clearTimeout(referralTimer.current);
    if (form.referralCode.trim()) validateReferralCode(form.referralCode);
  };

  const validate = () => {
    const errs = {};
    if (!form.fullName.trim())              errs.fullName        = t('common:required');
    if (!form.username.trim())              errs.username        = t('common:required');
    else if (!/^[a-zA-Z0-9_]{3,20}$/.test(form.username.trim()))
      errs.username = 'Username must be 3-20 characters: letters, numbers, or underscores only';
    if (!form.email.trim()) {
      errs.email = t('common:required');
    } else {
      const emailCheck = validateEmail(form.email);
      if (!emailCheck.valid) errs.email = emailCheck.reason;
    }
    if (form.password.length < 8)           errs.password        = t('minChars');
    else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(form.password))
      errs.password = 'Password must include uppercase, lowercase, and a number';
    if (form.password !== form.confirmPassword) errs.confirmPassword = t('passwordsMismatch');
    // Gym slug required unless invite code is valid (invite provides the gym)
    if (!form.gymSlug.trim() && inviteStatus !== 'valid') errs.gymSlug = t('common:required');
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGlobalError('');

    if (signupAttempts.current >= MAX_SIGNUP_ATTEMPTS) {
      setGlobalError('Too many attempts. Please try again later.');
      return;
    }

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
      // Use gym slug from invite data if available
      const gymSlug = inviteData?.gym_slug || form.gymSlug;

      const signUpResult = await signUp({
        email:    form.email,
        password: form.password,
        fullName: form.fullName,
        username: form.username,
        gymSlug,
      });

      // Save phone number to profile if provided
      if (form.phone.trim() && signUpResult?.user) {
        const fullPhone = `${areaCode}${form.phone.trim().replace(/\D/g, '')}`;
        supabase.from('profiles').update({ phone_number: fullPhone }).eq('id', signUpResult.user.id).then(() => {});
      }

      // After successful signup, claim the invite to mark it as used
      if (inviteStatus === 'valid' && inviteCode && signUpResult?.user) {
        try {
          if (inviteData?._source === 'gym_invites') {
            const { data: claimResult, error: claimErr } = await supabase.rpc('claim_invite_code', {
              p_invite_code: inviteCode.trim().toUpperCase(),
            });
            if (claimErr) console.warn('claim_invite_code error:', claimErr);
            else if (claimResult && !claimResult.success) console.warn('claim_invite_code failed:', claimResult.error);
          } else {
            const { error: claimErr } = await supabase.rpc('claim_member_invite', {
              p_invite_code: inviteCode.trim().toUpperCase(),
              p_profile_id: signUpResult.user.id,
            });
            if (claimErr) console.warn('claim_member_invite error:', claimErr);
          }
        } catch (err) {
          console.warn('Invite claim failed:', err);
        }
      }

      // Process referral code
      if (referralStatus === 'valid' && referralData && signUpResult?.user) {
        try {
          await processReferral(signUpResult.user.id, gymSlug);
        } catch {
          // Don't block signup if referral processing fails
        }
      }

      navigate('/onboarding');
    } catch (err) {
      signupAttempts.current += 1;
      setGlobalError(err.message || t('common:somethingWentWrong'));
    } finally {
      setLoading(false);
    }
  };

  const processReferral = async (newUserId, gymSlug) => {
    if (!referralData) return;

    const { data: gym } = await supabase
      .from('gyms')
      .select('id')
      .eq('slug', gymSlug.toLowerCase().trim())
      .eq('is_active', true)
      .single();

    if (!gym) return;

    const { data: referral, error: refError } = await supabase
      .from('referrals')
      .insert({
        referrer_id: referralData.referrer_id,
        referred_id: newUserId,
        gym_id: gym.id,
        referral_code_id: referralData.code_id,
        status: 'pending',
      })
      .select('id')
      .single();

    if (refError || !referral) return;

    // Auto-add referrer as friend (accepted friendship)
    try {
      await supabase.from('friendships').insert({
        requester_id: referralData.referrer_id,
        addressee_id: newUserId,
        status: 'accepted',
      });
    } catch {
      // Don't block if friendship insert fails (e.g., already friends)
    }

    // Save referrer info to localStorage so onboarding can pre-fill workout buddy
    try {
      localStorage.setItem('referrer_buddy', JSON.stringify({
        id: referralData.referrer_id,
        name: referralData.referrer_name,
      }));
    } catch {}

    const { data: gymData } = await supabase
      .from('gyms')
      .select('referral_config')
      .eq('id', gym.id)
      .maybeSingle();

    const requireApproval = gymData?.referral_config?.require_admin_approval;
    if (requireApproval === false) {
      await supabase.rpc('safe_complete_referral', { p_referral_id: referral.id });
    }
  };

  const referralSuffix = () => {
    if (referralStatus === 'checking') return <Loader2 size={14} className="text-[#D4AF37] animate-spin" />;
    if (referralStatus === 'valid') return <CheckCircle size={14} className="text-emerald-400" />;
    return null;
  };

  const inviteSuffix = () => {
    if (inviteStatus === 'checking') return <Loader2 size={14} className="text-[#D4AF37] animate-spin" />;
    if (inviteStatus === 'valid') return <CheckCircle size={14} className="text-emerald-400" />;
    return null;
  };

  // ── Fullscreen Scanner Overlay (native only, shows spinner while scanning) ──
  if (scannerOpen) {
    return (
      <div className="fixed inset-0 z-[70] flex flex-col" style={{ backgroundColor: "var(--color-bg-primary)" }}>
        <div className="relative flex items-center justify-center py-4 px-4 border-b border-white/[0.06]">
          <button
            onClick={() => setScannerOpen(false)}
            aria-label="Close scanner"
            className="absolute left-4 w-11 h-11 flex items-center justify-center rounded-full bg-white/[0.06] transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={{ color: "var(--color-text-muted)" }}
          >
            <X size={18} />
          </button>
          <div className="flex items-center gap-2">
            <Camera size={16} className="text-[#D4AF37]" />
            <span className="text-[15px] font-bold" style={{ color: "var(--color-text-primary)" }}>{t('scanQR')}</span>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8">
          <div className="w-10 h-10 border-[3px] border-[#D4AF37]/20 border-t-[#D4AF37] rounded-full animate-spin mb-4" />
          <p className="text-[14px]" style={{ color: "var(--color-text-muted)" }}>{t('scanningQR')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ backgroundColor: "var(--color-bg-primary)" }}>
      <div className="w-full max-w-[480px] mx-auto md:max-w-4xl">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#D4AF37]/15 border border-[#D4AF37]/25 mb-5">
            <Dumbbell size={26} className="text-[#D4AF37]" strokeWidth={2} />
          </div>
          <h1 className="text-[22px] font-bold truncate" style={{ color: "var(--color-text-primary)" }}>{t('createAccount')}</h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--color-text-subtle)" }}>
            {gymName ? t('joinGymNameSubtitle', { gymName }) : t('joinGymSubtitle')}
          </p>
        </div>

        {/* Welcome banner when invite is validated */}
        {inviteStatus === 'valid' && inviteData && (
          <div className="flex items-center gap-2.5 bg-[#D4AF37]/10 border border-[#D4AF37]/25 rounded-xl px-4 py-3 mb-5">
            <CheckCircle size={15} className="text-[#D4AF37] flex-shrink-0" />
            <div>
              <p className="text-[13px] text-[#D4AF37] font-medium">
                {t('welcomeTo', { gym: inviteData.gym_name })}
              </p>
              {inviteData.member_name && (
                <p className="text-[11px] text-[#D4AF37]/70 mt-0.5">
                  {t('inviteFor', { name: inviteData.member_name })}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Invite context banner for gym slug links */}
        {inviteSlug && entryMode === 'gymcode' && (
          <div className="flex items-center gap-2.5 bg-[#D4AF37]/10 border border-[#D4AF37]/25 rounded-xl px-4 py-3 mb-5">
            <CheckCircle size={15} className="text-[#D4AF37] flex-shrink-0" />
            <p className="text-[13px] text-[#D4AF37]">
              {gymName ? t('joiningGym', { gymName }) : t('joiningGymLoading')}
            </p>
          </div>
        )}

        {/* Card */}
        <div className="border border-white/6 rounded-2xl p-7 overflow-hidden" style={{ backgroundColor: "var(--color-bg-card)" }}>

          {globalError && (
            <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-6">
              <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
              <p className="text-[13px] text-red-400">{globalError}</p>
            </div>
          )}

          {scanError && (
            <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-6">
              <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
              <p className="text-[13px] text-red-400">{scanError}</p>
            </div>
          )}

          {/* ── ENTRY MODE CHOOSER ── */}
          {entryMode === 'choose' && (
            <div className="flex flex-col gap-3">

              {/* 1. Scan QR Code — big prominent button */}
              <button
                type="button"
                onClick={handleScanQR}
                className="w-full flex items-center gap-4 bg-[#D4AF37]/10 hover:bg-[#D4AF37]/15 border border-[#D4AF37]/25 hover:border-[#D4AF37]/40 rounded-xl px-5 py-4 transition-all text-left group"
              >
                <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-[#D4AF37]/15 border border-[#D4AF37]/25 flex-shrink-0">
                  <Camera size={20} className="text-[#D4AF37]" />
                </div>
                <div>
                  <p className="text-[15px] font-bold" style={{ color: "var(--color-text-primary)" }}>{t('scanQR')}</p>
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--color-text-subtle)" }}>{t('scanQRSubtitle')}</p>
                </div>
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3 my-1">
                <div className="flex-1 h-px bg-white/6" />
                <span className="text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--color-text-muted)" }}>{t('orDivider')}</span>
                <div className="flex-1 h-px bg-white/6" />
              </div>

              {/* 2. Enter invite code */}
              <button
                type="button"
                onClick={() => setEntryMode('invite')}
                className="w-full flex items-center gap-4 bg-[var(--color-bg-input)] hover:bg-[var(--color-bg-input)]/80 border border-white/8 hover:border-[#D4AF37]/30 rounded-xl px-5 py-4 transition-all text-left group"
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex-shrink-0">
                  <Ticket size={18} className="" style={{ color: "var(--color-text-muted)" }} />
                </div>
                <div>
                  <p className="text-[14px] font-semibold" style={{ color: "var(--color-text-primary)" }}>{t('enterInviteCode')}</p>
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--color-text-subtle)" }}>{t('enterInviteCodeSubtitle')}</p>
                </div>
              </button>

              {/* 3. I have a gym code — smaller link */}
              <button
                type="button"
                onClick={() => setEntryMode('gymcode')}
                className="mt-2 text-center text-[13px] text-[#D4AF37] hover:text-[#E6C766] font-semibold transition-colors"
              >
                {t('haveGymCode')}
              </button>
            </div>
          )}

          {/* ── INVITE CODE ENTRY ── */}
          {entryMode === 'invite' && !showForm && (
            <div className="flex flex-col gap-4">
              <Field
                label={t('inviteCode')}
                icon={Ticket}
                type="text"
                placeholder={t('inviteCodePlaceholder')}
                value={inviteCode}
                onChange={handleInviteCodeChange}
                onBlur={handleInviteCodeBlur}
                suffix={inviteSuffix()}
                maxLength={20}
                autoFocus
              />
              {inviteStatus === 'valid' && inviteData && (
                <p className="text-[11px] text-emerald-400 mt-[-8px] flex items-center gap-1">
                  <CheckCircle size={11} />
                  {t('inviteCodeValid', { gym: inviteData.gym_name })}
                </p>
              )}
              {inviteStatus === 'invalid' && (
                <p className="text-[11px] text-red-400 mt-[-8px] flex items-center gap-1">
                  <AlertCircle size={11} />
                  {t('inviteCodeInvalid')}
                </p>
              )}
              {inviteStatus === 'checking' && (
                <p className="text-[11px] mt-[-8px]" style={{ color: "var(--color-text-subtle)" }}>
                  {t('inviteCodeChecking')}
                </p>
              )}

              {/* Scan QR as alternative */}
              <button
                type="button"
                onClick={handleScanQR}
                className="flex items-center justify-center gap-2 text-[13px] text-[#D4AF37] hover:text-[#E6C766] font-semibold transition-colors mt-1"
              >
                <Camera size={14} />
                {t('scanQR')}
              </button>

              <button
                type="button"
                onClick={() => { setEntryMode('choose'); setInviteCode(''); setInviteStatus('idle'); setInviteData(null); }}
                className="text-[12px] transition-colors text-center" style={{ color: "var(--color-text-muted)" }}
              >
                {t('common:back')}
              </button>
            </div>
          )}

          {/* ── SIGNUP FORM (shown after invite validation or for gym code flow) ── */}
          {showForm && (
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
                autoComplete="name"
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
                autoComplete="username"
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
                autoComplete="email"
              />

              <Field
                label={t('password')}
                icon={Lock}
                type={showPassword ? 'text' : 'password'}
                placeholder="--------"
                value={form.password}
                onChange={set('password')}
                error={errors.password}
                maxLength={128}
                autoComplete="new-password"
                suffix={
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label="Toggle password visibility"
                    className="hover:text-[var(--color-text-muted)] transition-colors" style={{ color: "var(--color-text-muted)" }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                }
              />

              <Field
                label={t('confirmPassword')}
                icon={Lock}
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="--------"
                value={form.confirmPassword}
                onChange={set('confirmPassword')}
                error={errors.confirmPassword}
                autoComplete="new-password"
                suffix={
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(v => !v)}
                    aria-label="Toggle password visibility"
                    className="hover:text-[var(--color-text-muted)] transition-colors" style={{ color: "var(--color-text-muted)" }}
                  >
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                }
              />

              {/* Phone number with area code */}
              <div>
                <label htmlFor="signup-phone" className="block text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-muted)" }}>
                  {t('phoneNumber')}
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-shrink-0">
                    <select
                      value={areaCode}
                      onChange={e => setAreaCode(e.target.value)}
                      aria-label="Area code"
                      className="appearance-none w-[90px] bg-[var(--color-bg-input)] border border-white/8 rounded-xl pl-3 pr-7 py-3 text-[14px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none transition-colors cursor-pointer"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {AREA_CODES.map((ac, i) => (
                        <option key={`${ac.code}-${ac.label}-${i}`} value={ac.code}>
                          {ac.flag} {ac.code}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--color-text-muted)" }} />
                  </div>
                  <div className="relative flex-1">
                    <Phone size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--color-text-muted)" }} />
                    <input
                      id="signup-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder="787 555 1234"
                      value={form.phone}
                      onChange={set('phone')}
                      maxLength={15}
                      className="w-full bg-[var(--color-bg-input)] border border-white/8 rounded-xl pl-10 pr-4 py-3 text-[14px] placeholder-[var(--color-text-muted)] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none transition-colors"
                      style={{ color: "var(--color-text-primary)" }}
                    />
                  </div>
                </div>
              </div>

              {/* Gym code — only shown in gymcode mode and when NOT coming from invite link */}
              {entryMode === 'gymcode' && !inviteSlug && (
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
                  <p className="text-[11px] mt-1.5" style={{ color: "var(--color-text-muted)" }}>
                    {t('gymCodeHint')}
                  </p>
                </div>
              )}

              {/* Referral code — optional, always shown */}
              <div className="border-t border-white/6 pt-4 mt-1">
                <Field
                  label={t('referralCode')}
                  icon={Gift}
                  type="text"
                  placeholder={t('referralCodePlaceholder')}
                  value={form.referralCode}
                  onChange={handleReferralChange}
                  onBlur={handleReferralBlur}
                  suffix={referralSuffix()}
                  maxLength={30}
                />
                {referralStatus === 'valid' && referralData && (
                  <p className="text-[11px] text-emerald-400 mt-1.5 flex items-center gap-1">
                    <CheckCircle size={11} />
                    {t('referralCodeValid', { name: referralData.referrer_name })}
                  </p>
                )}
                {referralStatus === 'invalid' && (
                  <p className="text-[11px] mt-1.5" style={{ color: "var(--color-text-muted)" }}>
                    {t('referralCodeInvalid')}
                  </p>
                )}
                {referralStatus === 'checking' && (
                  <p className="text-[11px] mt-1.5" style={{ color: "var(--color-text-subtle)" }}>
                    {t('referralCodeChecking')}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold text-[14px] whitespace-nowrap py-3.5 rounded-xl transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              >
                {loading ? t('creatingAccount') : t('createAccountBtn')}
              </button>
              <p className="text-[11px] text-center leading-relaxed" style={{ color: "var(--color-text-subtle)" }}>
                {t('agreeTerms')}{' '}
                <a href="/terms" className="text-[#D4AF37] hover:underline">{t('common:termsOfService')}</a>
                {' '}{t('and')}{' '}
                <a href="/privacy" className="text-[#D4AF37] hover:underline">{t('common:privacyPolicy')}</a>.
              </p>

              {/* Back to choose entry method (if not from gym slug link) */}
              {!inviteSlug && (
                <button
                  type="button"
                  onClick={() => {
                    setEntryMode('choose');
                    if (entryMode === 'invite') {
                      // Keep invite data in case they go back
                    }
                  }}
                  className="text-[12px] transition-colors text-center" style={{ color: "var(--color-text-muted)" }}
                >
                  {t('common:back')}
                </button>
              )}
            </form>
          )}
        </div>

        <p className="text-center text-[13px] mt-6" style={{ color: "var(--color-text-subtle)" }}>
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
