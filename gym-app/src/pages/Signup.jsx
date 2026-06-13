import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  Mail, Lock, User, AlertCircle, CheckCircle, Loader2,
  Eye, EyeOff, QrCode, ArrowRight, ChevronLeft, Check, Ticket, Gift, Calendar,
} from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { validateEmail } from '../lib/validateEmail';

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
  orange: '#FF5A2E',
  purple: '#6D5FDB',
  gold: '#E8C547',
  green: '#5EAA5E',
  greenSoft: '#DFF0DF',
};
const FONT_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const FONT_BODY = '"Familjen Grotesk", -apple-system, system-ui, sans-serif';
const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const CARD_SHADOW = '0 1px 2px rgba(11,15,18,0.04), 0 6px 18px rgba(11,15,18,0.05)';

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

const inputWrap = (hasError = false, hasRight = false) => ({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  height: 52,
  background: OB.surface,
  border: `1.5px solid ${hasError ? '#FF5A2E' : OB.line}`,
  borderRadius: 14,
  paddingLeft: 44,
  paddingRight: hasRight ? 44 : 12,
  transition: 'border-color 0.2s ease',
});

const inputStyle = {
  flex: 1,
  height: '100%',
  background: 'transparent',
  border: 'none',
  outline: 'none',
  fontFamily: FONT_BODY,
  fontSize: 15,
  color: OB.ink,
  width: '100%',
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
  transition: 'background 0.2s ease',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
});

const darkBtn = (disabled) => ({
  width: '100%',
  height: 54,
  borderRadius: 999,
  background: OB.ink,
  color: '#fff',
  fontFamily: FONT_DISPLAY,
  fontWeight: 800,
  fontSize: 16,
  border: 'none',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.55 : 1,
  transition: 'background 0.2s ease',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
});

// Minimum age floor for self-signup (no invite code).
// Under-13 users are still allowed when they have a valid gym invite code:
// the gym vouches for them and handles real-world parental consent at the
// membership counter. 13–15 users may self-signup without restriction.
const MIN_AGE = 13;

// Compute age in whole years from an ISO date string. Returns NaN if invalid.
const computeAge = (isoDate) => {
  if (!isoDate) return NaN;
  const dob = new Date(isoDate);
  if (Number.isNaN(dob.getTime())) return NaN;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
};

// Best-effort split of a stored full name into the PR-convention name parts
// (first / middle / first surname / second surname). Used only to PRE-FILL
// the split inputs when a gym invite carries a full_name — the user can fix
// any mis-split before submitting. Heuristic favors two surnames over a
// middle name (the common case in Puerto Rico):
//   2 tokens → first + last1; 3 → first + last1 + last2;
//   4+ → first + middle(joined) + last1 + last2.
const splitFullName = (full) => {
  const tokens = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: '', middleName: '', lastName1: '', lastName2: '' };
  if (tokens.length === 1) return { firstName: tokens[0], middleName: '', lastName1: '', lastName2: '' };
  if (tokens.length === 2) return { firstName: tokens[0], middleName: '', lastName1: tokens[1], lastName2: '' };
  if (tokens.length === 3) return { firstName: tokens[0], middleName: '', lastName1: tokens[1], lastName2: tokens[2] };
  return {
    firstName: tokens[0],
    middleName: tokens.slice(1, -2).join(' '),
    lastName1: tokens[tokens.length - 2],
    lastName2: tokens[tokens.length - 1],
  };
};

// Compose the canonical profiles.full_name from the split inputs.
const composeFullName = (f) =>
  [f.firstName, f.middleName, f.lastName1, f.lastName2]
    .map(s => (s || '').trim())
    .filter(Boolean)
    .join(' ');

// gyms_public only exposes registration_mode from migration 0551 on — treat
// a missing column as "not enforced yet" (same resilience pattern as
// GymClosuresCard).
const isMissingColumn = (err) =>
  !!err && (err.code === '42703' || err.code === 'PGRST204' || /column .* does not exist/i.test(err.message || ''));

// Today as YYYY-MM-DD for the date picker `max` attribute.
const todayISO = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// Password strength → 0..4 segments
const passwordStrength = (pw) => {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^a-zA-Z0-9]/.test(pw) && pw.length >= 10) s++;
  return s;
};

const strengthLabel = (s, t) => {
  if (s === 0) return '';
  if (s === 1) return t('signup.strengthWeak', 'Weak — add more characters');
  if (s === 2) return t('signup.strengthFair', 'Fair — mix upper & lowercase');
  if (s === 3) return t('signup.strengthGood', 'Good — add a number or symbol for stronger');
  return t('signup.strengthStrong', 'Strong password');
};

const Signup = () => {
  const { signUp } = useAuth();
  const navigate   = useNavigate();
  const { t }      = useTranslation(['auth', 'common']);
  const [searchParams] = useSearchParams();

  const inviteSlug = searchParams.get('gym') ?? '';
  const initialRefCode = searchParams.get('ref') ?? localStorage.getItem('pendingReferralCode') ?? '';
  const initialInviteCode = localStorage.getItem('pendingInviteCode') ?? '';
  const [gymName, setGymName] = useState('');

  // Entry mode: 'welcome' | 'invite' | 'gymcode' | 'account'
  const initialMode = inviteSlug
    ? 'account'
    : initialInviteCode
      ? 'invite'
      : 'welcome';
  const [entryMode, setEntryMode] = useState(initialMode);

  // Invite code state
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [inviteStatus, setInviteStatus] = useState('idle');
  const [inviteData, setInviteData] = useState(null);
  const inviteTimer = useRef(null);

  // QR Scanner state
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState('');

  // registration_mode enforcement (invite-only gyms reject slug joins)
  const [slugBlocked, setSlugBlocked] = useState(false);      // gymcode screen: typed slug hit an invite-only gym
  const [slugChecking, setSlugChecking] = useState(false);    // gymcode Continue is resolving the gym
  const [inviteRequiredNotice, setInviteRequiredNotice] = useState(''); // invite screen banner after a blocked ?gym= link

  const [form, setForm] = useState({
    firstName: '', middleName: '', lastName1: '', lastName2: '',
    username: '', email: '',
    password: '', gymSlug: inviteSlug,
    referralCode: initialRefCode,
  });
  const [errors, setErrors] = useState({});
  const [globalError, setGlobalError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Real-time email validation (debounced)
  const [emailValidStatus, setEmailValidStatus] = useState('idle'); // 'idle' | 'valid' | 'invalid'
  const [emailValidReason, setEmailValidReason] = useState('');
  const emailDebounceRef = useRef(null);

  // HIBP soft warning
  const [pwnedWarning, setPwnedWarning] = useState(false);

  // Handoff loader state (between signup success and onboarding navigation)
  const [isHandoff, setIsHandoff] = useState(false);

  // App Store / Play Store compliance: explicit Terms + Privacy acceptance,
  // and self-attested date-of-birth for age verification (>= MIN_AGE). All
  // gate the submit button — see `submitDisabled` below.
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [dobError, setDobError] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [termsError, setTermsError] = useState('');
  const [privacyError, setPrivacyError] = useState('');

  // Referral
  const [referralStatus, setReferralStatus] = useState('idle');
  const [referralData, setReferralData] = useState(null);
  const referralTimer = useRef(null);

  const signupAttempts = useRef(0);
  const MAX_SIGNUP_ATTEMPTS = 8;

  const goAccount = () => setEntryMode('account');

  useEffect(() => {
    if (initialRefCode) localStorage.removeItem('pendingReferralCode');
    if (initialInviteCode) localStorage.removeItem('pendingInviteCode');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (initialRefCode) validateReferralCode(initialRefCode);
    if (initialInviteCode) validateInviteCode(initialInviteCode);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!inviteSlug) return;
    // gyms_public is a security-barrier view explicitly granted to anon
    // (see migration 0110). Querying the raw gyms table from a logged-out
    // signup page can 401 if a stale auth token is still in storage.
    // registration_mode (exposed in 0551) gates open ?gym= links: an
    // invite-only gym must not be joinable just by guessing its slug.
    (async () => {
      let { data, error } = await supabase
        .from('gyms_public')
        .select('id, name, registration_mode')
        .eq('slug', inviteSlug.toLowerCase())
        .single();
      if (error && isMissingColumn(error)) {
        // Pre-0551 schema — proceed exactly as before (no enforcement).
        ({ data } = await supabase
          .from('gyms_public')
          .select('id, name')
          .eq('slug', inviteSlug.toLowerCase())
          .single());
      }
      if (!data) return;
      setGymName(data.name || 'your gym');
      if (data.registration_mode === 'invite_only') {
        // Surface the invite-code entry instead of the open account form.
        // A valid code later auto-advances back to 'account' (effect below).
        setInviteRequiredNotice(t('signup.gymInviteOnly', 'This gym requires an invite code — ask your gym for yours.'));
        setEntryMode('invite');
      }
    })();
  }, [inviteSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-advance once invite validates
  useEffect(() => {
    if (inviteStatus === 'valid' && entryMode === 'invite') {
      // Leave user on invite screen briefly so they see the green chip, then move on
      const tm = setTimeout(() => setEntryMode('account'), 600);
      return () => clearTimeout(tm);
    }
  }, [inviteStatus, entryMode]);

  // ── Real-time email validation (debounced 300ms) ──
  useEffect(() => {
    if (emailDebounceRef.current) clearTimeout(emailDebounceRef.current);
    if (!form.email) {
      setEmailValidStatus('idle');
      setEmailValidReason('');
      return;
    }
    emailDebounceRef.current = setTimeout(() => {
      const result = validateEmail(form.email);
      if (result.valid) {
        setEmailValidStatus('valid');
        setEmailValidReason('');
      } else {
        setEmailValidStatus('invalid');
        setEmailValidReason(result.reason || t('invalidEmail', { defaultValue: 'Invalid email' }));
      }
    }, 300);
    return () => {
      if (emailDebounceRef.current) clearTimeout(emailDebounceRef.current);
    };
  }, [form.email]);

  // ── HIBP password breach check (soft warning, on blur) ──
  const isPasswordPwned = async (pw) => {
    try {
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(pw));
      const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      const r = await fetch(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`);
      if (!r.ok) return false;
      const text = await r.text();
      return text.split('\n').some(line => line.startsWith(hex.slice(5)));
    } catch {
      return false;
    }
  };

  const handlePasswordBlur = async () => {
    if (!form.password || form.password.length < 8) {
      setPwnedWarning(false);
      return;
    }
    const pwned = await isPasswordPwned(form.password);
    setPwnedWarning(pwned);
  };

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  // ── Invite code validation (preserves existing RPC flow) ──
  const validateInviteCode = async (code) => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setInviteStatus('idle');
      setInviteData(null);
      return;
    }

    setInviteStatus('checking');
    try {
      const { data: lookupResult } = await supabase.rpc('lookup_invite_by_code', {
        p_code: trimmed,
      });

      if (lookupResult) {
        const { data: gym } = await supabase
          .from('gyms_public')
          .select('id, name, slug')
          .eq('id', lookupResult.gym_id)
          .maybeSingle();

        setInviteStatus('valid');
        setInviteData({
          invite_id: null,
          gym_id: lookupResult.gym_id || gym?.id || null,
          gym_name: gym?.name || '',
          gym_slug: gym?.slug || '',
          member_name: lookupResult.full_name || '',
          email: '',
          phone: '',
          _source: 'member_invites',
        });

        setForm(f => ({
          ...f,
          // Seed the split name inputs only when the user hasn't typed one yet
          ...((!f.firstName && !f.lastName1) ? splitFullName(lookupResult.full_name) : {}),
          gymSlug: gym?.slug || f.gymSlug,
        }));
        setGymName(gym?.name || '');
        return;
      }

      const { data: gymLookup } = await supabase.rpc('lookup_gym_invite_by_code', {
        p_code: trimmed,
      });

      if (gymLookup) {
        const { data: gym } = await supabase
          .from('gyms_public')
          .select('id, name, slug')
          .eq('id', gymLookup.gym_id)
          .maybeSingle();

        setInviteStatus('valid');
        setInviteData({
          invite_id: gymLookup.id,
          gym_id: gymLookup.gym_id || gym?.id || null,
          gym_name: gym?.name || '',
          gym_slug: gym?.slug || '',
          member_name: gymLookup.full_name || '',
          email: gymLookup.email || '',
          phone: gymLookup.phone || '',
          _source: 'gym_invites',
        });

        setForm(f => ({
          ...f,
          ...((!f.firstName && !f.lastName1) ? splitFullName(gymLookup.full_name) : {}),
          email: f.email || gymLookup.email || '',
          gymSlug: gym?.slug || f.gymSlug,
        }));
        setGymName(gym?.name || '');
        return;
      }

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
        setScanError(t('cameraPermissionDenied', { defaultValue: 'Camera permission denied. Allow camera access in Settings.' }));
        setScannerOpen(false);
        return;
      }
      const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
      setScannerOpen(false);
      if (barcodes.length > 0 && barcodes[0].rawValue) {
        const rawValue = barcodes[0].rawValue.trim();
        const inviteMatch = rawValue.match(/\/invite\/([A-Z0-9-]+)$/i);
        if (inviteMatch) {
          const code = inviteMatch[1].toUpperCase();
          setInviteCode(code);
          validateInviteCode(code);
        } else if (/^[A-Z0-9]+-[A-Z0-9]+$/i.test(rawValue)) {
          const code = rawValue.toUpperCase();
          setInviteCode(code);
          validateInviteCode(code);
        } else {
          setScanError(t('qrScanError'));
        }
      }
    } catch (err) {
      setScannerOpen(false);
      if (err?.message?.includes('canceled') || err?.message?.includes('cancelled')) return;
      setScanError(err?.message || t('qrScanError'));
    }
  };

  // ── Referral code validation ──
  const validateReferralCode = async (code) => {
    const trimmed = code.trim();
    if (!trimmed) {
      setReferralStatus('idle');
      setReferralData(null);
      try { localStorage.removeItem('referrer_buddy'); } catch { /* ignore */ }
      return;
    }
    setReferralStatus('checking');
    try {
      const { data, error } = await supabase.rpc('lookup_referral_code', { p_code: trimmed.toUpperCase() });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row) {
        setReferralStatus('invalid');
        setReferralData(null);
        try { localStorage.removeItem('referrer_buddy'); } catch { /* ignore */ }
        return;
      }
      setReferralStatus('valid');
      setReferralData({
        referrer_id: row.referrer_id,
        referrer_name: row.referrer_name || 'Member',
        code_id: row.code_id,
      });
      try {
        localStorage.setItem('referrer_buddy', JSON.stringify({
          id: row.referrer_id,
          name: row.referrer_name || 'Member',
        }));
      } catch { /* ignore */ }
    } catch {
      setReferralStatus('invalid');
      setReferralData(null);
    }
  };

  // Referral codes are stored as REF-XXXX-XXXX (3-4-4 alphanumeric, two dashes).
  // Auto-format the input as the user types so they never have to type "-":
  // strip non-alphanumerics, uppercase, then insert dashes at positions 3 and 7.
  // Cap raw length at 11 so the formatted string maxes out at "REF-XXXX-XXXX" (13 chars).
  const formatReferralCode = (raw) => {
    const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 11);
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 7) return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  };

  const handleReferralChange = (e) => {
    const value = formatReferralCode(e.target.value);
    setForm(f => ({ ...f, referralCode: value }));
    if (referralTimer.current) clearTimeout(referralTimer.current);
    if (!value.trim()) {
      setReferralStatus('idle');
      setReferralData(null);
      return;
    }
    referralTimer.current = setTimeout(() => validateReferralCode(value), 600);
  };

  const validate = () => {
    const errs = {};
    if (!form.firstName.trim()) errs.firstName = t('common:required');
    if (!form.lastName1.trim()) errs.lastName1 = t('common:required');
    if (!form.username.trim()) errs.username = t('common:required');
    else if (!/^[a-zA-Z0-9_]{3,20}$/.test(form.username.trim()))
      errs.username = t('usernameFormat', { defaultValue: 'Username must be 3-20 characters: letters, numbers, or underscores only' });
    if (!form.email.trim()) {
      errs.email = t('common:required');
    } else {
      const emailCheck = validateEmail(form.email);
      if (!emailCheck.valid) errs.email = emailCheck.reason;
    }
    if (form.password.length < 8) errs.password = t('minChars');
    else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(form.password))
      errs.password = t('passwordComplexity', { defaultValue: 'Password must include uppercase, lowercase, and a number' });
    if (!form.gymSlug.trim() && inviteStatus !== 'valid') errs.gymSlug = t('common:required');
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGlobalError('');
    setDobError('');
    setTermsError('');
    setPrivacyError('');

    // DOB validation
    if (!dateOfBirth) {
      setDobError(t('dobRequired', 'Date of birth is required'));
      return;
    }
    const age = computeAge(dateOfBirth);
    if (Number.isNaN(age)) {
      setDobError(t('dobInvalid', 'Please enter a valid date'));
      return;
    }
    if (new Date(dateOfBirth) > new Date()) {
      setDobError(t('dobInvalid', 'Please enter a valid date'));
      return;
    }
    if (age < MIN_AGE) {
      // Under MIN_AGE — only allowed via a verified gym invite code (gym
      // vouches for parental consent collected at the membership counter).
      if (inviteStatus !== 'valid') {
        setDobError(t('dobUnderMinNeedsInvite', {
          defaultValue: 'You must be {{min}} or older to sign up directly. Ask your gym to send you an invite code to register.',
          min: MIN_AGE,
        }));
        return;
      }
      // With a valid invite — gym vouches, allow signup.
    }

    // ToS / Privacy
    if (!termsAccepted) {
      setTermsError(t('termsRequiredError', 'You must accept the Terms of Service'));
      return;
    }
    if (!privacyAccepted) {
      setPrivacyError(t('privacyRequiredError', 'You must accept the Privacy Policy'));
      return;
    }

    if (signupAttempts.current >= MAX_SIGNUP_ATTEMPTS) {
      setGlobalError(t('tooManyAttempts', { defaultValue: 'Too many attempts. Please try again later.' }));
      return;
    }
    const composedFullName = composeFullName(form);
    if (composedFullName.length > 100 || composedFullName.length < 1) {
      setGlobalError(t('fullNameLength', { defaultValue: 'Full name must be between 1 and 100 characters' }));
      return;
    }
    if (form.username && form.username.length > 30) {
      setGlobalError(t('usernameMaxLength', { defaultValue: 'Username must be 30 characters or less' }));
      return;
    }
    if (form.email.length > 254) {
      setGlobalError(t('emailMaxLength', { defaultValue: 'Email must be 254 characters or less' }));
      return;
    }
    if (form.password.length > 128) {
      setGlobalError(t('passwordMaxLength', { defaultValue: 'Password must be 128 characters or less' }));
      return;
    }

    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    try {
      const gymSlug = inviteData?.gym_slug || form.gymSlug;

      const nowIso = new Date().toISOString();
      const signUpResult = await signUp({
        email:    form.email,
        password: form.password,
        fullName: composedFullName,
        username: form.username,
        gymSlug,
        gymId: inviteData?.gym_id || null,
        dateOfBirth,
        termsAcceptedAt: nowIso,
        privacyAcceptedAt: nowIso,
        ageVerifiedAt: nowIso,
      });

      if (inviteStatus === 'valid' && inviteCode && signUpResult?.user) {
        // The auth user already exists at this point, so a failed claim must
        // NOT block signup — but it must not be swallowed either: signUp
        // pre-attached gym_id, so onboarding would skip its invite step and
        // the invite would never burn (imported shells never merge). Persist
        // the code so Onboarding step 0 re-surfaces prefilled and retries.
        const codeToClaim = inviteCode.trim().toUpperCase();
        const rememberPendingClaim = () => {
          try { localStorage.setItem('tugympr_pending_invite_claim', codeToClaim); } catch { /* ignore */ }
        };
        try {
          if (inviteData?._source === 'gym_invites') {
            // claim_imported_invite is a superset of claim_invite_code: it
            // handles the bulk-import case (merging the pre-created shell
            // profile into the new auth profile) and falls back to the
            // legacy single-member-invite behavior when no shell exists.
            // Safe for all gym_invites codes, imported or admin-created.
            const { data: claimRes, error: claimErr } = await supabase.rpc('claim_imported_invite', {
              p_code: codeToClaim,
            });
            if (claimErr || claimRes?.success === false) {
              console.warn('claim_imported_invite error:', claimErr || claimRes?.error);
              rememberPendingClaim();
            }
          } else {
            const { error: claimErr } = await supabase.rpc('claim_member_invite', {
              p_invite_code: codeToClaim,
              p_profile_id: signUpResult.user.id,
            });
            if (claimErr) {
              console.warn('claim_member_invite error:', claimErr);
              rememberPendingClaim();
            }
          }
        } catch (err) {
          console.warn('Invite claim failed:', err);
          rememberPendingClaim();
        }
      }

      if (referralStatus === 'valid' && referralData && signUpResult?.user) {
        try { await processReferral(signUpResult.user.id); } catch { /* ignore */ }
      }

      // Show full-screen handoff loader while we navigate to onboarding
      setIsHandoff(true);
      navigate('/onboarding');
    } catch (err) {
      signupAttempts.current += 1;
      // Map known Supabase auth errors to generic messages so we don't leak
      // whether an email is already registered (email-enumeration defense).
      const rawMsg = (err?.message || '').toLowerCase();
      const looksLikeAccountExists =
        rawMsg.includes('already registered') ||
        rawMsg.includes('already exists') ||
        rawMsg.includes('user already');
      if (looksLikeAccountExists) {
        setGlobalError(
          t(
            'signupCouldNotCreateAccount',
            'Could not create account. If you already have one, please sign in instead.'
          )
        );
      } else {
        setGlobalError(err.message || t('common:somethingWentWrong'));
      }
    } finally {
      setLoading(false);
    }
  };

  const processReferral = async (newUserId) => {
    if (!referralData) return;
    const code = (form.referralCode || '').trim().toUpperCase();
    if (!code) return;
    const { data, error } = await supabase.rpc('register_referral', {
      p_code: code,
      p_referred_id: newUserId,
    });
    if (error || !data?.success) return;
    try {
      localStorage.setItem('referrer_buddy', JSON.stringify({
        id: data.referrer_id, name: data.referrer_name,
      }));
    } catch { /* ignore */ }
  };

  // ── Handoff loader (shown after successful signup, before onboarding mounts) ──
  if (isHandoff) {
    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center px-6"
        style={{ backgroundColor: OB.bg, fontFamily: FONT_BODY, color: OB.ink }}
      >
        <div style={{
          width: 56, height: 56, borderRadius: 999,
          border: `4px solid ${OB.tealSoft}`, borderTopColor: OB.teal,
          animation: 'spin 1s linear infinite', marginBottom: 22,
        }} />
        <h2 style={{
          fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 24,
          letterSpacing: -0.8, color: OB.ink, margin: 0, textAlign: 'center',
        }}>
          {t('signup.settingUpAccount', 'Setting up your account…')}
        </h2>
        <p style={{ fontSize: 14, color: OB.sub, marginTop: 8, textAlign: 'center', maxWidth: 280 }}>
          {t('signup.settingUpHint', 'Hang tight, we are getting things ready.')}
        </p>
      </main>
    );
  }

  // ── Scanner overlay ──
  if (scannerOpen) {
    return (
      <div className="fixed inset-0 z-[70] flex flex-col" style={{ backgroundColor: OB.bg }}>
        <div className="relative flex items-center justify-center py-4 px-4" style={{ borderBottom: `1px solid ${OB.line}` }}>
          <button
            onClick={() => setScannerOpen(false)}
            aria-label={t('closeScanner', { defaultValue: 'Close scanner' })}
            className="absolute left-4"
            style={{
              width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 999, background: OB.surface, border: `1px solid ${OB.line}`, color: OB.ink,
            }}
          >
            <ChevronLeft size={18} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <QrCode size={16} color={OB.tealDeep} />
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 15, color: OB.ink }}>
              {t('scanQR')}
            </span>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8">
          <div style={{
            width: 40, height: 40, borderRadius: 999,
            border: `3px solid ${OB.tealSoft}`, borderTopColor: OB.teal,
            animation: 'spin 1s linear infinite', marginBottom: 16,
          }} />
          <p style={{ fontSize: 14, color: OB.sub }}>{t('scanningQR')}</p>
        </div>
      </div>
    );
  }

  const strength = passwordStrength(form.password);

  // Password rule checklist (rendered upfront under the password field)
  const pwRules = [
    { key: 'len', label: t('signup.ruleLength', '8+ characters'), pass: form.password.length >= 8 },
    { key: 'upper', label: t('signup.ruleUpper', 'Uppercase letter'), pass: /[A-Z]/.test(form.password) },
    { key: 'lower', label: t('signup.ruleLower', 'Lowercase letter'), pass: /[a-z]/.test(form.password) },
    { key: 'digit', label: t('signup.ruleDigit', 'Number'), pass: /\d/.test(form.password) },
  ];
  const allPwRulesPass = pwRules.every(r => r.pass);

  // Submit disabled when email is being checked / invalid OR pw rules incomplete
  // OR DOB invalid (missing / future / under MIN_AGE) OR either compliance
  // checkbox is unchecked. App Store / Play Store require explicit consent.
  const dobAge = computeAge(dateOfBirth);
  const dobOk = !!dateOfBirth && !Number.isNaN(dobAge)
    && (dobAge >= MIN_AGE || inviteStatus === 'valid');
  const submitDisabled =
    loading ||
    emailValidStatus === 'invalid' ||
    (form.email.length > 0 && emailValidStatus === 'idle') ||
    !allPwRulesPass ||
    !dobOk ||
    !termsAccepted ||
    !privacyAccepted;

  return (
    <main
      className="min-h-screen flex items-start justify-center px-5 py-10"
      style={{ backgroundColor: OB.bg, fontFamily: FONT_BODY, color: OB.ink }}
    >
      <div className="w-full max-w-[420px]">

        {/* ─────────────── SCREEN: WELCOME ─────────────── */}
        {entryMode === 'welcome' && (
          <div className="animate-fade-in flex flex-col items-center" style={{ paddingTop: 40, minHeight: '80vh', justifyContent: 'center' }}>
            {/* Back to Login */}
            <div style={{ position: 'absolute', top: 24, left: 20 }}>
              <Link
                to="/login"
                aria-label={t('common:back', 'Back')}
                className="flex items-center justify-center"
                style={{
                  width: 40, height: 40, borderRadius: 999,
                  background: OB.surface, border: `1.5px solid ${OB.line}`,
                  color: OB.ink, textDecoration: 'none',
                  boxShadow: CARD_SHADOW,
                }}
              >
                <ChevronLeft size={18} strokeWidth={2.2} />
              </Link>
            </div>
            <h1
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 900,
                fontSize: 44,
                color: OB.ink,
                letterSpacing: -2,
                lineHeight: 0.95,
                marginTop: 28,
                textAlign: 'center',
              }}
            >
              {t('signup.welcomeTitleL1', 'Train with')}<br />
              {t('signup.welcomeTitleL2', 'your gym.')}
            </h1>
            <p
              style={{
                fontSize: 16, color: OB.sub, marginTop: 14,
                textAlign: 'center', lineHeight: 1.4, maxWidth: 300,
              }}
            >
              {t('signup.welcomeSubtitle', 'Built for the members and coaches at your local gym — not the algorithm.')}
            </p>

            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, marginTop: 40 }}>
              <button type="button" onClick={() => setEntryMode('invite')} style={primaryBtn(false)}>
                <Ticket size={18} strokeWidth={2.2} />
                {t('haveGymCode', 'I Have a Gym Code')}
              </button>
              <button type="button" onClick={() => setEntryMode('gymcode')} style={darkBtn(false)}>
                {t('noCodeSignup', 'Sign Up Without Code')}
              </button>
            </div>

            <div style={{ marginTop: 22, fontSize: 14, color: OB.sub }}>
              {t('alreadyHaveAccount')}{' '}
              <Link
                to="/login"
                style={{
                  color: OB.ink, fontWeight: 700, textDecoration: 'underline',
                  textDecorationColor: OB.teal, textDecorationThickness: 2, textUnderlineOffset: 3,
                }}
              >
                {t('signInLink', 'Sign in')}
              </Link>
            </div>
          </div>
        )}

        {/* ─────────────── SCREEN: INVITE CODE ─────────────── */}
        {entryMode === 'invite' && (
          <div className="animate-fade-in">
            <div className="flex items-center mb-6">
              <button
                type="button"
                onClick={() => { setEntryMode('welcome'); setInviteCode(''); setInviteStatus('idle'); setInviteData(null); setInviteRequiredNotice(''); }}
                aria-label={t('common:back')}
                style={{
                  width: 40, height: 40, borderRadius: 999, background: OB.surface,
                  border: `1.5px solid ${OB.line}`, color: OB.ink, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', boxShadow: CARD_SHADOW, cursor: 'pointer',
                }}
              >
                <ChevronLeft size={18} strokeWidth={2.2} />
              </button>
            </div>


            <h1 style={{
              fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 32,
              letterSpacing: -1.2, color: OB.ink, lineHeight: 1.05, margin: 0,
            }}>
              {t('signup.inviteTitle', 'Got a gym code?')}
            </h1>
            <p style={{ fontSize: 15, color: OB.sub, marginTop: 6, lineHeight: 1.4 }}>
              {t('signup.inviteSubtitle', 'Enter the code from your gym — or scan the QR on the wall at reception.')}
            </p>

            {/* Invite-only gym reached via an open ?gym= link — explain why
                the code is required before the account form opens. */}
            {inviteRequiredNotice && (
              <div style={{
                marginTop: 16, display: 'flex', alignItems: 'center', gap: 10,
                background: OB.tealSoft, borderRadius: 14, padding: '12px 14px',
              }}>
                <AlertCircle size={15} color={OB.tealDeep} />
                <p style={{ fontSize: 13, color: OB.tealDeep, margin: 0, fontWeight: 600 }}>
                  {gymName ? `${gymName}: ${inviteRequiredNotice}` : inviteRequiredNotice}
                </p>
              </div>
            )}

            {scanError && (
              <div style={{
                marginTop: 16, display: 'flex', alignItems: 'center', gap: 10,
                background: '#FDECE7', border: `1px solid #FF5A2E33`, borderRadius: 14, padding: '12px 14px',
              }}>
                <AlertCircle size={15} color="#C13B14" />
                <p style={{ fontSize: 13, color: '#C13B14', margin: 0 }}>{scanError}</p>
              </div>
            )}

            <div style={{ marginTop: 26 }}>
              <label style={labelStyle}>{t('inviteCode')}</label>
              <div style={{
                height: 76, borderRadius: 18, background: OB.surface,
                border: `2px dashed ${inviteStatus === 'invalid' ? OB.orange : OB.teal}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative',
                transition: 'border-color 0.2s ease',
              }}>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={handleInviteCodeChange}
                  placeholder={t('inviteCodePlaceholder', 'TGP-7X3K')}
                  maxLength={20}
                  autoFocus
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    textAlign: 'center',
                    fontFamily: FONT_MONO,
                    fontSize: 28,
                    fontWeight: 700,
                    color: OB.ink,
                    letterSpacing: 5,
                    textTransform: 'uppercase',
                  }}
                />
                {inviteStatus === 'checking' && (
                  <Loader2 size={18} className="animate-spin" color={OB.tealDeep} style={{ position: 'absolute', right: 16 }} />
                )}
                {inviteStatus === 'valid' && (
                  <CheckCircle size={18} color={OB.green} style={{ position: 'absolute', right: 16 }} />
                )}
              </div>

              {inviteStatus === 'valid' && inviteData && (
                <p style={{ fontSize: 12, color: OB.green, marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                  <CheckCircle size={13} />
                  {t('inviteCodeValid', { gym: inviteData.gym_name })}
                </p>
              )}
              {inviteStatus === 'invalid' && (
                <p style={{ fontSize: 12, color: OB.orange, marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                  <AlertCircle size={13} />
                  {t('inviteCodeInvalid')}
                </p>
              )}
            </div>

            {/* Scan QR card */}
            <button
              type="button"
              onClick={handleScanQR}
              style={{
                marginTop: 16, padding: '14px 16px', borderRadius: 14,
                background: OB.tealSoft, display: 'flex', gap: 12, alignItems: 'center',
                border: 'none', width: '100%', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                background: OB.teal, color: '#0A2A2A',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <QrCode size={20} strokeWidth={2.2} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 15, color: OB.tealDeep }}>
                  {t('scanQR', 'Scan QR instead')}
                </div>
                <div style={{ fontSize: 12, color: OB.tealDeep, opacity: 0.8 }}>
                  {t('signup.scanQRHint', 'Point your camera at the poster at reception')}
                </div>
              </div>
              <ArrowRight size={18} color={OB.tealDeep} />
            </button>

            {/* Help card */}
            <div style={{
              marginTop: 16, padding: '14px 16px', borderRadius: 14,
              background: OB.surface, border: `1px solid ${OB.line}`,
              display: 'flex', gap: 12, alignItems: 'center',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={OB.mute} strokeWidth="1.8" aria-hidden="true">
                <circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h0"/>
              </svg>
              <div style={{ fontSize: 13, color: OB.sub, lineHeight: 1.4 }}>
                <span style={{ color: OB.ink, fontWeight: 700 }}>{t('signup.noCode', 'No code?')}</span>{' '}
                {t('signup.noCodeHint', 'Ask at the front desk — every TuGymPR gym has one.')}
              </div>
            </div>

            <div style={{ marginTop: 26 }}>
              <button
                type="button"
                onClick={() => inviteStatus === 'valid' && goAccount()}
                disabled={inviteStatus !== 'valid'}
                style={primaryBtn(inviteStatus !== 'valid')}
              >
                {t('common:continue', 'Continue')}
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* ─────────────── SCREEN: GYM CODE (no invite) ─────────────── */}
        {entryMode === 'gymcode' && (
          <div className="animate-fade-in">
            <div className="flex items-center mb-6">
              <button
                type="button"
                onClick={() => setEntryMode('welcome')}
                aria-label={t('common:back')}
                style={{
                  width: 40, height: 40, borderRadius: 999, background: OB.surface,
                  border: `1.5px solid ${OB.line}`, color: OB.ink, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', boxShadow: CARD_SHADOW, cursor: 'pointer',
                }}
              >
                <ChevronLeft size={18} strokeWidth={2.2} />
              </button>
            </div>


            <h1 style={{
              fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 32,
              letterSpacing: -1.2, color: OB.ink, lineHeight: 1.05, margin: 0,
            }}>
              {t('signup.gymCodeTitle', 'What\'s your gym?')}
            </h1>
            <p style={{ fontSize: 15, color: OB.sub, marginTop: 6, lineHeight: 1.4 }}>
              {t('gymCodeHint', 'Enter your gym\'s short name (slug). Ask reception if unsure.')}
            </p>

            <div style={{ marginTop: 26 }}>
              <label style={labelStyle}>{t('gymCode')}</label>
              <div style={inputWrap(!!errors.gymSlug)}>
                <Ticket size={16} color={OB.mute} style={{ position: 'absolute', left: 16 }} />
                <input
                  type="text"
                  value={form.gymSlug}
                  onChange={set('gymSlug')}
                  placeholder={t('gymSlugPlaceholder', { defaultValue: 'e.g. demo' })}
                  style={inputStyle}
                  autoFocus
                />
              </div>
              {errors.gymSlug && <p style={{ fontSize: 12, color: OB.orange, marginTop: 8 }}>{errors.gymSlug}</p>}
            </div>

            <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                disabled={slugChecking}
                onClick={async () => {
                  const slug = form.gymSlug.trim().toLowerCase();
                  if (!slug) {
                    setErrors({ gymSlug: t('common:required') });
                    return;
                  }
                  setErrors({});
                  setSlugBlocked(false);
                  // Enforce registration_mode (0551): invite-only gyms can't
                  // be joined by slug. Resilient pre-migration: a missing
                  // column (or any lookup hiccup) proceeds exactly as before.
                  setSlugChecking(true);
                  try {
                    let { data, error } = await supabase
                      .from('gyms_public')
                      .select('id, name, registration_mode')
                      .eq('slug', slug)
                      .maybeSingle();
                    if (error && isMissingColumn(error)) {
                      ({ data } = await supabase
                        .from('gyms_public')
                        .select('id, name')
                        .eq('slug', slug)
                        .maybeSingle());
                    }
                    if (data?.name) setGymName(data.name);
                    if (data?.registration_mode === 'invite_only') {
                      setSlugBlocked(true);
                      setErrors({ gymSlug: t('signup.gymInviteOnly', 'This gym requires an invite code — ask your gym for yours.') });
                      return;
                    }
                  } catch { /* lookup failed — don't block, behave as today */ }
                  finally {
                    setSlugChecking(false);
                  }
                  goAccount();
                }}
                style={primaryBtn(slugChecking)}
              >
                {t('common:continue', 'Continue')}
                {slugChecking ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
              </button>
              {slugBlocked && (
                <button
                  type="button"
                  onClick={() => {
                    setSlugBlocked(false);
                    setErrors({});
                    setEntryMode('invite');
                  }}
                  style={darkBtn(false)}
                >
                  <Ticket size={18} strokeWidth={2.2} />
                  {t('haveGymCode', 'I Have a Gym Code')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ─────────────── SCREEN: CREATE ACCOUNT ─────────────── */}
        {entryMode === 'account' && (
          <div className="animate-fade-in">
            <div className="flex items-center mb-6">
              <button
                type="button"
                onClick={() => setEntryMode(inviteStatus === 'valid' ? 'invite' : (inviteSlug ? 'welcome' : 'gymcode'))}
                aria-label={t('common:back')}
                style={{
                  width: 40, height: 40, borderRadius: 999, background: OB.surface,
                  border: `1.5px solid ${OB.line}`, color: OB.ink, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', boxShadow: CARD_SHADOW, cursor: 'pointer',
                }}
              >
                <ChevronLeft size={18} strokeWidth={2.2} />
              </button>
            </div>

            {/* Code-valid chip */}
            {(inviteStatus === 'valid' && inviteData?.gym_name) || (inviteSlug && gymName) ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
                background: OB.greenSoft, borderRadius: 999, width: 'fit-content',
                marginBottom: 18,
              }}>
                <div style={{
                  width: 18, height: 18, borderRadius: 999, background: OB.green,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                }}>
                  <Check size={12} strokeWidth={3} />
                </div>
                <span style={{
                  fontSize: 12, fontWeight: 800, color: '#2d5a2d',
                  letterSpacing: 0.3, textTransform: 'uppercase',
                }}>
                  {t('signup.codeValid', 'CODE VALID')} · {(inviteData?.gym_name || gymName).toUpperCase()}
                </span>
              </div>
            ) : null}

            <h1 style={{
              fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 28,
              letterSpacing: -1.2, color: OB.ink, lineHeight: 1.05, margin: 0,
            }}>
              {t('signup.accountTitle', 'Create your account.')}
            </h1>
            <p style={{ fontSize: 14, color: OB.sub, marginTop: 4 }}>
              {t('signup.accountSubtitle', 'This takes about 40 seconds.')}
            </p>

            {globalError && (
              <div style={{
                marginTop: 18, display: 'flex', alignItems: 'center', gap: 10,
                background: '#FDECE7', border: `1px solid #FF5A2E33`, borderRadius: 14, padding: '12px 14px',
              }}>
                <AlertCircle size={15} color="#C13B14" />
                <p style={{ fontSize: 13, color: '#C13B14', margin: 0 }}>{globalError}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Name — split into PR-convention parts: first + optional middle,
                  first surname required + optional second surname. Composed
                  into profiles.full_name at submit. */}
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label htmlFor="su-first-name" style={labelStyle}>{t('firstName', 'First name')}</label>
                    <div style={inputWrap(!!errors.firstName)}>
                      <User size={16} color={OB.mute} style={{ position: 'absolute', left: 16 }} />
                      <input
                        id="su-first-name"
                        type="text"
                        value={form.firstName}
                        onChange={set('firstName')}
                        placeholder={t('firstNamePlaceholder', { defaultValue: 'Alex' })}
                        maxLength={40}
                        autoComplete="given-name"
                        style={inputStyle}
                      />
                    </div>
                    {errors.firstName && <p style={{ fontSize: 12, color: OB.orange, marginTop: 6 }}>{errors.firstName}</p>}
                  </div>
                  <div>
                    <label htmlFor="su-middle-name" style={labelStyle}>
                      {t('middleName', 'Middle name')} <span style={{ fontWeight: 500, textTransform: 'none', color: OB.mute }}>· {t('common:optional')}</span>
                    </label>
                    <div style={inputWrap(false)}>
                      <input
                        id="su-middle-name"
                        type="text"
                        value={form.middleName}
                        onChange={set('middleName')}
                        placeholder={t('middleNamePlaceholder', { defaultValue: 'J.' })}
                        maxLength={40}
                        autoComplete="additional-name"
                        style={{ ...inputStyle, paddingLeft: 16 }}
                      />
                    </div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
                  <div>
                    <label htmlFor="su-last-name-1" style={labelStyle}>{t('lastName1', 'Last name')}</label>
                    <div style={inputWrap(!!errors.lastName1)}>
                      <input
                        id="su-last-name-1"
                        type="text"
                        value={form.lastName1}
                        onChange={set('lastName1')}
                        placeholder={t('lastName1Placeholder', { defaultValue: 'Rivera' })}
                        maxLength={40}
                        autoComplete="family-name"
                        style={{ ...inputStyle, paddingLeft: 16 }}
                      />
                    </div>
                    {errors.lastName1 && <p style={{ fontSize: 12, color: OB.orange, marginTop: 6 }}>{errors.lastName1}</p>}
                  </div>
                  <div>
                    <label htmlFor="su-last-name-2" style={labelStyle}>
                      {t('lastName2', 'Second last name')} <span style={{ fontWeight: 500, textTransform: 'none', color: OB.mute }}>· {t('common:optional')}</span>
                    </label>
                    <div style={inputWrap(false)}>
                      <input
                        id="su-last-name-2"
                        type="text"
                        value={form.lastName2}
                        onChange={set('lastName2')}
                        placeholder={t('lastName2Placeholder', { defaultValue: 'Santos' })}
                        maxLength={40}
                        autoComplete="family-name"
                        style={{ ...inputStyle, paddingLeft: 16 }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Username */}
              <div>
                <label htmlFor="su-username" style={labelStyle}>{t('username')}</label>
                <div style={inputWrap(!!errors.username)}>
                  <span style={{ position: 'absolute', left: 16, fontSize: 16, color: OB.mute, fontWeight: 700 }}>@</span>
                  <input
                    id="su-username"
                    type="text"
                    value={form.username}
                    onChange={set('username')}
                    placeholder={t('usernamePlaceholder', { defaultValue: 'alexr' })}
                    maxLength={30}
                    autoComplete="username"
                    style={inputStyle}
                  />
                </div>
                {errors.username && <p style={{ fontSize: 12, color: OB.orange, marginTop: 6 }}>{errors.username}</p>}
              </div>

              {/* Email */}
              <div>
                <label htmlFor="su-email" style={labelStyle}>{t('email')}</label>
                <div style={inputWrap(!!errors.email || emailValidStatus === 'invalid', true)}>
                  <Mail size={16} color={OB.mute} style={{ position: 'absolute', left: 16 }} />
                  <input
                    id="su-email"
                    type="email"
                    value={form.email}
                    onChange={set('email')}
                    placeholder={t('emailPlaceholder', { defaultValue: 'you@example.com' })}
                    maxLength={254}
                    autoComplete="email"
                    style={inputStyle}
                  />
                  {form.email && emailValidStatus === 'valid' && (
                    <CheckCircle size={16} color={OB.green} style={{ position: 'absolute', right: 14 }} />
                  )}
                  {form.email && emailValidStatus === 'invalid' && (
                    <AlertCircle size={16} color={OB.orange} style={{ position: 'absolute', right: 14 }} />
                  )}
                </div>
                {errors.email && <p style={{ fontSize: 12, color: OB.orange, marginTop: 6 }}>{errors.email}</p>}
                {!errors.email && emailValidStatus === 'invalid' && emailValidReason && (
                  <p style={{ fontSize: 12, color: OB.orange, marginTop: 6 }}>{emailValidReason}</p>
                )}
              </div>

              {/* Password */}
              <div>
                <label htmlFor="su-password" style={labelStyle}>{t('password')}</label>
                <div style={inputWrap(!!errors.password, true)}>
                  <Lock size={16} color={OB.mute} style={{ position: 'absolute', left: 16 }} />
                  <input
                    id="su-password"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={set('password')}
                    onBlur={handlePasswordBlur}
                    placeholder={t('passwordPlaceholder', { defaultValue: '8+ characters' })}
                    maxLength={128}
                    autoComplete="new-password"
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={t('togglePasswordVisibility', { defaultValue: 'Toggle password visibility' })}
                    style={{
                      position: 'absolute', right: 12,
                      background: 'transparent', border: 'none', color: OB.mute,
                      cursor: 'pointer', display: 'flex', alignItems: 'center',
                    }}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                {/* 4-segment strength bar */}
                <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                  {[0, 1, 2, 3].map(i => (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        height: 4,
                        borderRadius: 2,
                        background: i < strength ? OB.teal : OB.line,
                        transition: 'background 0.25s ease',
                      }}
                    />
                  ))}
                </div>
                {form.password && (
                  <p style={{ fontSize: 11, color: OB.sub, marginTop: 6 }}>{strengthLabel(strength, t)}</p>
                )}

                {/* Password rule checklist (always visible, fills in as user types) */}
                <ul style={{
                  listStyle: 'none', padding: 0, margin: '10px 0 0',
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px',
                }}>
                  {pwRules.map(rule => (
                    <li
                      key={rule.key}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        fontSize: 12,
                        color: rule.pass ? OB.green : OB.mute,
                        fontWeight: rule.pass ? 600 : 500,
                      }}
                    >
                      {rule.pass ? (
                        <Check size={13} strokeWidth={3} color={OB.green} />
                      ) : (
                        <span style={{
                          width: 10, height: 10, borderRadius: 999,
                          background: OB.line, display: 'inline-block',
                        }} />
                      )}
                      {rule.label}
                    </li>
                  ))}
                </ul>

                {/* HIBP soft warning (does not block submit) */}
                {pwnedWarning && (
                  <p style={{
                    fontSize: 12, color: '#A66A00', marginTop: 8,
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: '#FFF6DB', border: '1px solid #E8C54733',
                    padding: '8px 10px', borderRadius: 10,
                  }}>
                    <AlertCircle size={13} />
                    {t('signup.pwnedWarning', 'This password has appeared in a known data breach. Consider choosing a different one.')}
                  </p>
                )}

                {errors.password && <p style={{ fontSize: 12, color: OB.orange, marginTop: 6 }}>{errors.password}</p>}
              </div>

              {/* Referral (optional, compact) */}
              <div>
                <label htmlFor="su-referral" style={labelStyle}>
                  {t('referralCode')} <span style={{ color: OB.mute, fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>· {t('common:optional', 'optional')}</span>
                </label>
                <div style={inputWrap(false, true)}>
                  <Gift size={16} color={OB.mute} style={{ position: 'absolute', left: 16 }} />
                  <input
                    id="su-referral"
                    type="text"
                    value={form.referralCode}
                    onChange={handleReferralChange}
                    placeholder="REF-XXXX-XXXX"
                    maxLength={13}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    style={inputStyle}
                  />
                  {referralStatus === 'checking' && (
                    <Loader2 size={16} className="animate-spin" color={OB.tealDeep} style={{ position: 'absolute', right: 14 }} />
                  )}
                  {referralStatus === 'valid' && (
                    <CheckCircle size={16} color={OB.green} style={{ position: 'absolute', right: 14 }} />
                  )}
                </div>
                {referralStatus === 'valid' && referralData && (
                  <p style={{ fontSize: 11, color: OB.green, marginTop: 6, fontWeight: 600 }}>
                    {t('referralCodeValid', { name: referralData.referrer_name })}
                  </p>
                )}
                {referralStatus === 'invalid' && (
                  <p style={{ fontSize: 11, color: OB.mute, marginTop: 6 }}>{t('referralCodeInvalid')}</p>
                )}
              </div>

              {/* Date of Birth — App Store / Play Store / GDPR-K age verification */}
              <div>
                <label htmlFor="su-dob" style={labelStyle}>{t('dobLabel', 'Date of Birth')}</label>
                <div style={inputWrap(!!dobError)}>
                  <Calendar size={16} color={OB.mute} style={{ position: 'absolute', left: 16 }} />
                  <input
                    id="su-dob"
                    type="date"
                    value={dateOfBirth}
                    max={todayISO()}
                    onChange={(e) => { setDateOfBirth(e.target.value); if (dobError) setDobError(''); }}
                    autoComplete="bday"
                    aria-describedby={dobError ? 'su-dob-error' : undefined}
                    style={inputStyle}
                  />
                </div>
                {dobError && (
                  <p id="su-dob-error" style={{ fontSize: 12, color: OB.orange, marginTop: 6 }}>
                    {dobError}
                  </p>
                )}
              </div>

              <div style={{ marginTop: 12 }}>
                {/* Terms of Service — explicit consent (App Store 5.1.1(v)) */}
                <label
                  htmlFor="su-terms-accept"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '12px 14px',
                    borderRadius: 14,
                    background: OB.surface,
                    border: `1.5px solid ${termsError ? '#FF5A2E' : OB.line}`,
                    cursor: 'pointer',
                    marginBottom: 10,
                    transition: 'border-color 0.2s ease',
                  }}
                >
                  <input
                    id="su-terms-accept"
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => { setTermsAccepted(e.target.checked); if (e.target.checked) setTermsError(''); }}
                    aria-describedby={termsError ? 'su-terms-error' : undefined}
                    style={{
                      width: 18, height: 18, marginTop: 2, accentColor: OB.teal,
                      cursor: 'pointer', flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 12, color: OB.sub, lineHeight: 1.5 }}>
                    <Trans
                      i18nKey="auth:termsCheckbox"
                      defaults="I have read and agree to the <termsLink>Terms of Service</termsLink>"
                      components={{
                        termsLink: (
                          <a
                            href="https://tugympr.com/terms"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: OB.ink, fontWeight: 700, textDecoration: 'underline', textDecorationColor: OB.teal }}
                          />
                        ),
                      }}
                    />
                  </span>
                </label>
                {termsError && (
                  <p id="su-terms-error" style={{ fontSize: 12, color: OB.orange, marginTop: -4, marginBottom: 6 }}>
                    {termsError}
                  </p>
                )}

                {/* Privacy Policy — explicit consent (separate from Terms) */}
                <label
                  htmlFor="su-privacy-accept"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '12px 14px',
                    borderRadius: 14,
                    background: OB.surface,
                    border: `1.5px solid ${privacyError ? '#FF5A2E' : OB.line}`,
                    cursor: 'pointer',
                    marginBottom: 14,
                    transition: 'border-color 0.2s ease',
                  }}
                >
                  <input
                    id="su-privacy-accept"
                    type="checkbox"
                    checked={privacyAccepted}
                    onChange={(e) => { setPrivacyAccepted(e.target.checked); if (e.target.checked) setPrivacyError(''); }}
                    aria-describedby={privacyError ? 'su-privacy-error' : undefined}
                    style={{
                      width: 18, height: 18, marginTop: 2, accentColor: OB.teal,
                      cursor: 'pointer', flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 12, color: OB.sub, lineHeight: 1.5 }}>
                    <Trans
                      i18nKey="auth:privacyCheckbox"
                      defaults="I have read and agree to the <privacyLink>Privacy Policy</privacyLink>"
                      components={{
                        privacyLink: (
                          <a
                            href="https://tugympr.com/privacy"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: OB.ink, fontWeight: 700, textDecoration: 'underline', textDecorationColor: OB.teal }}
                          />
                        ),
                      }}
                    />
                  </span>
                </label>
                {privacyError && (
                  <p id="su-privacy-error" style={{ fontSize: 12, color: OB.orange, marginTop: -4, marginBottom: 8 }}>
                    {privacyError}
                  </p>
                )}

                <button type="submit" disabled={submitDisabled} style={primaryBtn(submitDisabled)}>
                  {loading ? t('creatingAccount') : t('createAccountBtn', 'Create Account')}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </main>
  );
};

export default Signup;
