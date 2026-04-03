import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ChevronRight, ChevronLeft, Upload, Copy, Check, Sparkles,
  Users, Trophy, CalendarDays, X, Image as ImageIcon, QrCode,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { validateImageFile } from '../../lib/validateImage';

// ── Constants ────────────────────────────────────────────────
const TOTAL_STEPS = 7;

const PRESET_COLORS = [
  '#D4AF37', '#EF4444', '#F97316', '#EAB308',
  '#22C55E', '#10B981', '#06B6D4', '#3B82F6',
  '#8B5CF6', '#EC4899',
];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_VALUES = [1, 2, 3, 4, 5, 6, 0]; // Monday=1 ... Sunday=0

// Compress image on the client before upload
async function compressImage(file, maxSize = 512, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > height) {
        if (width > maxSize) { height = Math.round((height * maxSize) / width); width = maxSize; }
      } else if (height > maxSize) {
        width = Math.round((width * maxSize) / height); height = maxSize;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => resolve(blob || file),
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

// ── Step Components ──────────────────────────────────────────

function StepWelcome({ gymName, t }) {
  return (
    <div className="flex flex-col items-center text-center px-4">
      <div className="w-20 h-20 rounded-2xl bg-[#D4AF37]/15 flex items-center justify-center mb-6">
        <Sparkles size={36} className="text-[#D4AF37]" />
      </div>
      <h2 className="text-2xl font-bold text-white mb-3">
        {t('admin.onboarding.welcomeTitle')}
      </h2>
      <p className="text-[#D4AF37] font-semibold text-lg mb-4">{gymName}</p>
      <p className="text-[#9CA3AF] text-sm max-w-md leading-relaxed">
        {t('admin.onboarding.welcomeDescription')}
      </p>
    </div>
  );
}

function StepBranding({ gymName, setGymName, primaryColor, setPrimaryColor, customColor, setCustomColor, logoPreview, onLogoSelect, uploading, t }) {
  return (
    <div className="space-y-6 px-4 max-w-md mx-auto w-full">
      <div className="text-center mb-2">
        <h2 className="text-xl font-bold text-white mb-1">
          {t('admin.onboarding.brandingTitle')}
        </h2>
        <p className="text-[#9CA3AF] text-sm">
          {t('admin.onboarding.brandingDescription')}
        </p>
      </div>

      {/* Logo upload */}
      <div>
        <label className="block text-[12px] font-medium text-[#6B7280] mb-2">
          {t('admin.onboarding.logoLabel')}
        </label>
        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-white/10 rounded-xl cursor-pointer hover:border-[#D4AF37]/40 transition-colors bg-white/[0.02]">
          {logoPreview ? (
            <img src={logoPreview} alt="Logo" className="h-20 w-20 object-contain rounded-lg" />
          ) : (
            <>
              <Upload size={24} className="text-[#6B7280] mb-2" />
              <span className="text-[12px] text-[#6B7280]">
                {uploading ? t('admin.onboarding.uploading') : t('admin.onboarding.uploadLogo')}
              </span>
            </>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={onLogoSelect}
            disabled={uploading}
          />
        </label>
      </div>

      {/* Primary color */}
      <div>
        <label className="block text-[12px] font-medium text-[#6B7280] mb-2">
          {t('admin.onboarding.colorLabel')}
        </label>
        <div className="flex flex-wrap gap-2.5">
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => { setPrimaryColor(color); setCustomColor(''); }}
              className="w-9 h-9 rounded-full border-2 transition-all flex items-center justify-center"
              style={{
                backgroundColor: color,
                borderColor: primaryColor === color ? 'white' : 'transparent',
                transform: primaryColor === color ? 'scale(1.15)' : 'scale(1)',
              }}
            >
              {primaryColor === color && <Check size={14} className="text-white drop-shadow" />}
            </button>
          ))}
          {/* Custom color input */}
          <div className="relative">
            <input
              type="color"
              value={customColor || primaryColor}
              onChange={(e) => { setCustomColor(e.target.value); setPrimaryColor(e.target.value); }}
              className="w-9 h-9 rounded-full cursor-pointer border-2 border-white/10"
              style={{ padding: 0 }}
            />
          </div>
        </div>
      </div>

      {/* Gym name */}
      <div>
        <label className="block text-[12px] font-medium text-[#6B7280] mb-2">
          {t('admin.onboarding.gymNameLabel')}
        </label>
        <input
          type="text"
          value={gymName}
          onChange={(e) => setGymName(e.target.value)}
          placeholder={t('admin.onboarding.gymNamePlaceholder')}
          className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-3 text-[14px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
        />
      </div>
    </div>
  );
}

function StepHours({ openTime, setOpenTime, closeTime, setCloseTime, openDays, toggleDay, t }) {
  return (
    <div className="space-y-6 px-4 max-w-md mx-auto w-full">
      <div className="text-center mb-2">
        <h2 className="text-xl font-bold text-white mb-1">
          {t('admin.onboarding.hoursTitle')}
        </h2>
        <p className="text-[#9CA3AF] text-sm">
          {t('admin.onboarding.hoursDescription')}
        </p>
      </div>

      {/* Time inputs */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[12px] font-medium text-[#6B7280] mb-2">
            {t('admin.onboarding.openTime')}
          </label>
          <input
            type="time"
            value={openTime}
            onChange={(e) => setOpenTime(e.target.value)}
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-3 text-[14px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[12px] font-medium text-[#6B7280] mb-2">
            {t('admin.onboarding.closeTime')}
          </label>
          <input
            type="time"
            value={closeTime}
            onChange={(e) => setCloseTime(e.target.value)}
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-3 text-[14px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          />
        </div>
      </div>

      {/* Day toggles */}
      <div>
        <label className="block text-[12px] font-medium text-[#6B7280] mb-3">
          {t('admin.onboarding.openDays')}
        </label>
        <div className="flex gap-2 justify-center">
          {DAY_LABELS.map((label, idx) => {
            const dayVal = DAY_VALUES[idx];
            const isOpen = openDays.includes(dayVal);
            return (
              <button
                key={dayVal}
                onClick={() => toggleDay(dayVal)}
                className={`w-11 h-11 rounded-xl text-[12px] font-semibold transition-all ${
                  isOpen
                    ? 'bg-[#D4AF37] text-[#0F172A]'
                    : 'bg-white/[0.04] text-[#6B7280] border border-white/6'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StepFeatures({ features, toggleFeature, t }) {
  const FEATURE_LIST = [
    { key: 'classes_enabled', label: t('admin.onboarding.classesLabel'), desc: t('admin.onboarding.classesDesc'), icon: CalendarDays },
    { key: 'qr_enabled', label: t('admin.onboarding.qrLabel'), desc: t('admin.onboarding.qrDesc'), icon: QrCode },
  ];

  return (
    <div className="space-y-6 px-4 max-w-md mx-auto w-full">
      <div className="text-center mb-2">
        <h2 className="text-xl font-bold text-white mb-1">
          {t('admin.onboarding.featuresTitle')}
        </h2>
        <p className="text-[#9CA3AF] text-sm">
          {t('admin.onboarding.featuresDescription')}
        </p>
      </div>
      <div className="space-y-3">
        {FEATURE_LIST.map(({ key, label, desc, icon: Icon }) => (
          <div key={key}
            className="flex items-center gap-4 p-4 bg-white/[0.02] border border-white/6 rounded-xl">
            <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
              <Icon size={20} className="text-[#D4AF37]" />
            </div>
            <div className="flex-1">
              <p className="text-[14px] font-semibold text-white">{label}</p>
              <p className="text-[12px] text-[#6B7280]">{desc}</p>
            </div>
            <button
              onClick={() => toggleFeature(key)}
              className="w-11 h-6 rounded-full relative flex-shrink-0 transition-colors"
              style={{ backgroundColor: features[key] ? '#D4AF37' : '#4B5563' }}
            >
              <span
                className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                style={{ left: features[key] ? 'calc(100% - 22px)' : '2px' }}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepFirstChallenge({ challengeName, setChallengeType, challengeType, t }) {
  const CHALLENGE_TYPES = [
    { value: 'consistency', label: t('admin.onboarding.challengeConsistency'), desc: t('admin.onboarding.challengeConsistencyDesc') },
    { value: 'volume', label: t('admin.onboarding.challengeVolume'), desc: t('admin.onboarding.challengeVolumeDesc') },
  ];

  return (
    <div className="space-y-6 px-4 max-w-md mx-auto w-full">
      <div className="text-center mb-2">
        <h2 className="text-xl font-bold text-white mb-1">
          {t('admin.onboarding.challengeTitle')}
        </h2>
        <p className="text-[#9CA3AF] text-sm">
          {t('admin.onboarding.challengeDescription')}
        </p>
      </div>
      <div className="space-y-3">
        {CHALLENGE_TYPES.map(ct => (
          <button key={ct.value}
            onClick={() => setChallengeType(ct.value)}
            className={`w-full text-left p-4 rounded-xl border transition-all ${
              challengeType === ct.value
                ? 'border-[#D4AF37]/40 bg-[#D4AF37]/8'
                : 'border-white/6 bg-white/[0.02] hover:border-white/12'
            }`}>
            <div className="flex items-center gap-3">
              <Trophy size={20} className={challengeType === ct.value ? 'text-[#D4AF37]' : 'text-[#6B7280]'} />
              <div>
                <p className={`text-[14px] font-semibold ${challengeType === ct.value ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>{ct.label}</p>
                <p className="text-[12px] text-[#6B7280]">{ct.desc}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-[#6B7280] text-center italic">
        {t('admin.onboarding.challengeOptional')}
      </p>
    </div>
  );
}

function StepInvite({ slug, copied, onCopy, t }) {
  const inviteUrl = `${window.location.origin}/signup?gym=${slug || ''}`;

  return (
    <div className="space-y-6 px-4 max-w-md mx-auto w-full">
      <div className="text-center mb-2">
        <h2 className="text-xl font-bold text-white mb-1">
          {t('admin.onboarding.inviteTitle')}
        </h2>
        <p className="text-[#9CA3AF] text-sm">
          {t('admin.onboarding.inviteDescription')}
        </p>
      </div>

      {/* Invite link */}
      <div className="bg-white/[0.03] border border-white/6 rounded-xl p-4">
        <label className="block text-[12px] font-medium text-[#6B7280] mb-2">
          {t('admin.onboarding.inviteLink')}
        </label>
        <div className="flex gap-2">
          <div className="flex-1 bg-[#111827] border border-white/6 rounded-lg px-3 py-2.5 text-[13px] text-[#D4AF37] font-mono truncate">
            {inviteUrl}
          </div>
          <button
            onClick={() => onCopy(inviteUrl)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#D4AF37] text-[#0F172A] text-[13px] font-semibold hover:bg-[#C5A033] transition-colors flex-shrink-0"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? t('admin.onboarding.copied') : t('admin.onboarding.copyLink')}
          </button>
        </div>
      </div>

      {/* Explanation */}
      <div className="bg-white/[0.02] border border-white/6 rounded-xl p-4 space-y-3">
        <p className="text-[13px] text-[#9CA3AF] leading-relaxed">
          {t('admin.onboarding.inviteExplanation')}
        </p>
      </div>
    </div>
  );
}

function StepDone({ t }) {
  return (
    <div className="flex flex-col items-center text-center px-4">
      {/* Celebration icon */}
      <div className="relative mb-6">
        <div className="w-24 h-24 rounded-full bg-[#D4AF37]/15 flex items-center justify-center">
          <span className="text-5xl">🎉</span>
        </div>
        {/* Sparkle particles */}
        {[...Array(8)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1.5 h-1.5 rounded-full bg-[#D4AF37]"
            initial={{ opacity: 0, scale: 0 }}
            animate={{
              opacity: [0, 1, 0],
              scale: [0, 1.2, 0],
              x: Math.cos((i / 8) * Math.PI * 2) * 60,
              y: Math.sin((i / 8) * Math.PI * 2) * 60,
            }}
            transition={{ duration: 1.5, delay: 0.2 + i * 0.08, repeat: Infinity, repeatDelay: 2 }}
          />
        ))}
      </div>

      <h2 className="text-2xl font-bold text-white mb-3">
        {t('admin.onboarding.doneTitle')}
      </h2>
      <p className="text-[#9CA3AF] text-sm max-w-sm leading-relaxed mb-8">
        {t('admin.onboarding.doneDescription')}
      </p>

      {/* Quick links */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
        {[
          { icon: Users, labelKey: 'admin.onboarding.linkMembers', path: '/admin/members' },
          { icon: Trophy, labelKey: 'admin.onboarding.linkChallenges', path: '/admin/challenges' },
          { icon: CalendarDays, labelKey: 'admin.onboarding.linkClasses', path: '/admin/classes' },
        ].map(({ icon: Icon, labelKey, path }) => (
          <a
            key={path}
            href={path}
            className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white/[0.03] border border-white/6 hover:border-[#D4AF37]/30 transition-colors"
          >
            <Icon size={20} className="text-[#D4AF37]" />
            <span className="text-[11px] font-medium text-[#9CA3AF]">{t(labelKey)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Main Wizard Component ────────────────────────────────────

export default function AdminOnboardingWizard({ onComplete }) {
  const { profile, gymName: authGymName, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation('pages');
  const gymId = profile?.gym_id;

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1); // 1=forward, -1=back
  const [saving, setSaving] = useState(false);

  // Step 2: Branding state
  const [gymName, setGymName] = useState(authGymName || '');
  const [primaryColor, setPrimaryColor] = useState('#D4AF37');
  const [customColor, setCustomColor] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState('');
  const [uploading, setUploading] = useState(false);

  // Step 3: Hours state
  const [openTime, setOpenTime] = useState('06:00');
  const [closeTime, setCloseTime] = useState('22:00');
  const [openDays, setOpenDays] = useState([0, 1, 2, 3, 4, 5, 6]);

  // Step 3: Features state
  const [features, setFeatures] = useState({ classes_enabled: false, qr_enabled: true });
  const [challengeType, setChallengeType] = useState('consistency');

  // Step 4: Invite state
  const [slug, setSlug] = useState('');
  const [copied, setCopied] = useState(false);

  // Load existing gym data
  useEffect(() => {
    if (!gymId) return;
    (async () => {
      const [{ data: gym }, { data: branding }] = await Promise.all([
        supabase.from('gyms').select('name, slug, open_time, close_time, open_days, setup_step').eq('id', gymId).single(),
        supabase.from('gym_branding').select('primary_color, logo_url').eq('gym_id', gymId).single(),
      ]);
      if (gym) {
        setGymName(gym.name || '');
        setSlug(gym.slug || '');
        setOpenTime(gym.open_time || '06:00');
        setCloseTime(gym.close_time || '22:00');
        setOpenDays(gym.open_days || [0, 1, 2, 3, 4, 5, 6]);
        // Resume from last step if partially completed
        if (gym.setup_step > 0 && gym.setup_step < TOTAL_STEPS - 1) {
          setStep(gym.setup_step);
        }
      }
      if (branding?.primary_color) {
        setPrimaryColor(branding.primary_color);
      }
      if (branding?.logo_url) {
        const { data: signed } = await supabase.storage
          .from('gym-logos')
          .createSignedUrl(branding.logo_url, 3600);
        if (signed?.signedUrl) setLogoPreview(signed.signedUrl);
      }
    })();
  }, [gymId]);

  const toggleFeature = useCallback((key) => {
    setFeatures(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleDay = useCallback((day) => {
    setOpenDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }, []);

  const handleLogoSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = await validateImageFile(file);
    if (!validation.valid) {
      showToast(validation.error, 'error');
      return;
    }

    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }, [showToast]);

  const handleCopy = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Failed to copy', 'error');
    }
  }, [showToast]);

  // Save progress to DB on each step change
  const saveStepProgress = useCallback(async (currentStep) => {
    if (!gymId) return;
    await supabase.from('gyms').update({ setup_step: currentStep }).eq('id', gymId);
  }, [gymId]);

  const handleNext = useCallback(async () => {
    if (step === TOTAL_STEPS - 1) {
      // Final step — complete setup
      setSaving(true);
      try {
        // Upload logo if selected
        if (logoFile && gymId) {
          setUploading(true);
          const compressed = await compressImage(logoFile);
          const ext = 'jpg';
          const path = `${gymId}/logo.${ext}`;
          await supabase.storage.from('gym-logos').upload(path, compressed, {
            upsert: true,
            contentType: 'image/jpeg',
          });
          await supabase.from('gym_branding').upsert({
            gym_id: gymId,
            logo_url: path,
            primary_color: primaryColor,
          }, { onConflict: 'gym_id' });
          setUploading(false);
        } else if (gymId) {
          // Save color even without logo
          await supabase.from('gym_branding').upsert({
            gym_id: gymId,
            primary_color: primaryColor,
          }, { onConflict: 'gym_id' });
        }

        // Save gym settings
        if (gymId) {
          await supabase.from('gyms').update({
            name: gymName,
            open_time: openTime,
            close_time: closeTime,
            open_days: openDays,
            classes_enabled: features.classes_enabled,
            qr_enabled: features.qr_enabled,
            setup_completed: true,
            setup_step: TOTAL_STEPS,
          }).eq('id', gymId);

          // Upsert gym hours
          const hoursRows = openDays.map((d) => ({
            gym_id: gymId,
            day_of_week: d,
            open_time: openTime,
            close_time: closeTime,
            is_closed: false,
          }));
          // Also mark closed days
          const closedDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !openDays.includes(d));
          closedDays.forEach((d) => {
            hoursRows.push({
              gym_id: gymId,
              day_of_week: d,
              open_time: '00:00',
              close_time: '00:00',
              is_closed: true,
            });
          });
          await supabase.from('gym_hours').upsert(hoursRows, { onConflict: 'gym_id,day_of_week' });
        }

        await refreshProfile();
        onComplete?.();
      } catch (err) {
        showToast(err.message || 'Failed to save', 'error');
      } finally {
        setSaving(false);
      }
      return;
    }

    // Save branding on step 2 completion
    if (step === 1 && gymId) {
      try {
        if (logoFile) {
          setUploading(true);
          const compressed = await compressImage(logoFile);
          const path = `${gymId}/logo.jpg`;
          await supabase.storage.from('gym-logos').upload(path, compressed, {
            upsert: true,
            contentType: 'image/jpeg',
          });
          await supabase.from('gym_branding').upsert({
            gym_id: gymId,
            logo_url: path,
            primary_color: primaryColor,
          }, { onConflict: 'gym_id' });
          setUploading(false);
          setLogoFile(null); // Prevent re-upload on final step
        } else {
          await supabase.from('gym_branding').upsert({
            gym_id: gymId,
            primary_color: primaryColor,
          }, { onConflict: 'gym_id' });
        }
        if (gymName) {
          await supabase.from('gyms').update({ name: gymName }).eq('id', gymId);
        }
      } catch {
        // Non-blocking — we continue to next step
      }
    }

    // Save feature toggles on step 3 completion
    if (step === 3 && gymId) {
      try {
        await supabase.from('gyms').update({
          classes_enabled: features.classes_enabled,
          qr_enabled: features.qr_enabled,
        }).eq('id', gymId);
      } catch {
        // Non-blocking
      }
    }

    // Create first challenge on step 4 completion
    if (step === 4 && gymId && challengeType) {
      try {
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);
        await supabase.from('challenges').insert({
          gym_id: gymId,
          created_by: profile?.id,
          name: challengeType === 'consistency' ? '30-Day Consistency Challenge' : '30-Day Volume Challenge',
          type: challengeType,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
        });
      } catch {
        // Non-blocking
      }
    }

    const nextStep = step + 1;
    setDirection(1);
    setStep(nextStep);
    saveStepProgress(nextStep);
  }, [step, gymId, gymName, primaryColor, logoFile, openTime, closeTime, openDays, features, challengeType, profile, refreshProfile, onComplete, showToast, saveStepProgress]);

  const handleBack = useCallback(() => {
    if (step <= 0) return;
    setDirection(-1);
    setStep(step - 1);
  }, [step]);

  const handleSkip = useCallback(() => {
    if (step === TOTAL_STEPS - 1) {
      // Skip on last step = complete without saving remaining
      setSaving(true);
      supabase.from('gyms').update({ setup_completed: true, setup_step: TOTAL_STEPS }).eq('id', gymId)
        .then(() => refreshProfile())
        .then(() => onComplete?.())
        .finally(() => setSaving(false));
      return;
    }
    setDirection(1);
    const nextStep = step + 1;
    setStep(nextStep);
    saveStepProgress(nextStep);
  }, [step, gymId, refreshProfile, onComplete, saveStepProgress]);

  // Animation variants
  const slideVariants = {
    enter: (dir) => ({ x: dir > 0 ? 80 : -80, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir) => ({ x: dir > 0 ? -80 : 80, opacity: 0 }),
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="relative w-full max-w-lg mx-4 bg-[#0F172A] border border-white/8 rounded-2xl shadow-2xl overflow-hidden">
        {/* Skip / Close button */}
        {step < TOTAL_STEPS - 1 && (
          <button
            onClick={handleSkip}
            className="absolute top-4 right-4 z-10 text-[12px] text-[#6B7280] hover:text-[#9CA3AF] transition-colors py-1 px-2"
          >
            {t('admin.onboarding.skip')}
          </button>
        )}

        {/* Progress indicator */}
        <div className="flex justify-center gap-2 pt-6 pb-2">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{
                width: i === step ? 24 : 8,
                backgroundColor: i <= step ? '#D4AF37' : 'rgba(255,255,255,0.08)',
              }}
            />
          ))}
        </div>

        {/* Step number */}
        <p className="text-center text-[11px] text-[#6B7280] font-medium mt-1 mb-4">
          {t('admin.onboarding.stepOf', { current: step + 1, total: TOTAL_STEPS })}
        </p>

        {/* Step content */}
        <div className="min-h-[380px] flex items-center justify-center px-2 pb-2">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="w-full"
            >
              {step === 0 && <StepWelcome gymName={gymName} t={t} />}
              {step === 1 && (
                <StepBranding
                  gymName={gymName}
                  setGymName={setGymName}
                  primaryColor={primaryColor}
                  setPrimaryColor={setPrimaryColor}
                  customColor={customColor}
                  setCustomColor={setCustomColor}
                  logoPreview={logoPreview}
                  onLogoSelect={handleLogoSelect}
                  uploading={uploading}
                  t={t}
                />
              )}
              {step === 2 && (
                <StepHours
                  openTime={openTime}
                  setOpenTime={setOpenTime}
                  closeTime={closeTime}
                  setCloseTime={setCloseTime}
                  openDays={openDays}
                  toggleDay={toggleDay}
                  t={t}
                />
              )}
              {step === 3 && <StepFeatures features={features} toggleFeature={toggleFeature} t={t} />}
              {step === 4 && <StepFirstChallenge challengeType={challengeType} setChallengeType={setChallengeType} t={t} />}
              {step === 5 && (
                <StepInvite
                  slug={slug}
                  copied={copied}
                  onCopy={handleCopy}
                  t={t}
                />
              )}
              {step === 6 && <StepDone t={t} />}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between px-6 pb-6 pt-2">
          <button
            onClick={handleBack}
            disabled={step === 0}
            className={`flex items-center gap-1 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${
              step === 0
                ? 'text-transparent cursor-default'
                : 'text-[#9CA3AF] hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <ChevronLeft size={16} />
            {t('admin.onboarding.back')}
          </button>

          <button
            onClick={handleNext}
            disabled={saving || uploading}
            className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-[#D4AF37] text-[#0F172A] text-[13px] font-bold hover:bg-[#C5A033] transition-colors disabled:opacity-50"
          >
            {saving ? (
              <span className="w-4 h-4 border-2 border-[#0F172A]/30 border-t-[#0F172A] rounded-full animate-spin" />
            ) : step === TOTAL_STEPS - 1 ? (
              t('admin.onboarding.finish')
            ) : (
              <>
                {t('admin.onboarding.next')}
                <ChevronRight size={16} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
