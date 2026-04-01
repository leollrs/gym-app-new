import { lazy, Suspense, useEffect, useState } from 'react';
import { Save, Clock, Upload, Image as ImageIcon, Users, ChevronDown, ChevronUp, Shield, CalendarOff, Plus, Trash2, Palette, Check, RotateCcw, AlertTriangle, Wand2, CalendarDays, Mail, Eye, Bell } from 'lucide-react';

const AdminNotificationPrefs = lazy(() => import('./AdminNotificationPrefs'));
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { useToast } from '../../contexts/ToastContext';
import { applyBranding, resetToDefault } from '../../lib/branding';
import { getAllPalettes, getPalette, DEFAULT_PALETTE } from '../../lib/palettes';
import { analyzeColorPair, autoHarmonize } from '../../lib/themeGenerator';
import { validateImageFile } from '../../lib/validateImage';
import { adminKeys } from '../../lib/adminQueryKeys';
import { PageHeader, AdminCard, SectionLabel, FadeIn, CardSkeleton, AdminPageShell } from '../../components/admin';

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Signed URL expiry for logos (1 day)
const LOGO_URL_EXPIRY_SECONDS = 60 * 60 * 24;

const REWARD_TYPES = ['points', 'discount', 'free_month', 'custom'];

const DEFAULT_REFERRAL_CONFIG = {
  enabled: false,
  referrer_reward: { type: 'points', value: '', label: '' },
  referred_reward: { type: 'points', value: '', label: '' },
  require_approval: true,
  max_per_month: null,
};

// Compress image on the client before upload
async function compressImage(file, maxSize = 512, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;

      if (width > height) {
        if (width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        }
      } else if (height > maxSize) {
        width = Math.round((width * maxSize) / height);
        height = maxSize;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          resolve(blob);
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = URL.createObjectURL(file);
  });
}

// Helper to generate a signed URL for a logo path in the private bucket
async function getSignedLogoUrl(path) {
  if (!path) return '';
  const { data, error } = await supabase
    .storage
    .from('gym-logos')
    .createSignedUrl(path, LOGO_URL_EXPIRY_SECONDS);
  if (error || !data?.signedUrl) {
    logger.warn('Failed to create signed URL for logo', error);
    return '';
  }
  return data.signedUrl;
}

// ── Toggle switch helper ──
function Toggle({ checked, onChange, label }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-9 h-5 rounded-full relative flex-shrink-0 transition-colors"
      style={{ backgroundColor: checked ? 'var(--color-accent)' : 'var(--color-text-faint)' }}
      aria-label={label}
    >
      <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
        style={{ left: checked ? 'calc(100% - 18px)' : '2px' }} />
    </button>
  );
}

// ── Reward config sub-form ──
function RewardConfig({ reward, onChange, labelPrefix, t }) {
  const typeLabels = {
    points: t('admin.referral.typePoints'),
    discount: t('admin.referral.typeDiscount'),
    free_month: t('admin.referral.typeFreeMonth'),
    custom: t('admin.referral.typeCustom'),
  };

  return (
    <div className="space-y-3">
      <p className="text-[12px] font-semibold text-[#E5E7EB]">{labelPrefix}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.referral.rewardType')}</label>
          <select
            value={reward.type}
            onChange={e => onChange({ ...reward, type: e.target.value })}
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 appearance-none"
          >
            {REWARD_TYPES.map(rt => (
              <option key={rt} value={rt}>{typeLabels[rt]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.referral.rewardValue')}</label>
          <input
            type={reward.type === 'custom' ? 'text' : 'number'}
            value={reward.value}
            onChange={e => onChange({ ...reward, value: e.target.value })}
            placeholder={reward.type === 'discount' ? '%' : reward.type === 'points' ? '5000' : ''}
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          />
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.referral.rewardLabel')}</label>
        <input
          type="text"
          value={reward.label}
          onChange={e => onChange({ ...reward, label: e.target.value })}
          placeholder={t('admin.referral.rewardLabelPlaceholder')}
          className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
        />
      </div>
    </div>
  );
}

export default function AdminSettings() {
  const { profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation('pages');
  const gymId = profile?.gym_id;

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Editable fields
  const [name, setName]           = useState('');
  const [primaryColor, setPrimary] = useState('#D4AF37');
  const [accentColor, setAccent]   = useState('#D4AF37');
  const [welcomeMsg, setWelcome]   = useState('');
  const [logoUrl, setLogoUrl]     = useState('');
  const [logoFile, setLogoFile]   = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [openTime, setOpenTime]    = useState('06:00');
  const [closeTime, setCloseTime]  = useState('22:00');
  const [openDays, setOpenDays]    = useState([0, 1, 2, 3, 4, 5, 6]);
  const defaultHours = () => [0,1,2,3,4,5,6].map(d => ({ day_of_week: d, open_time: '06:00', close_time: '22:00', is_closed: false }));
  const [dayHours, setDayHours]    = useState(defaultHours);

  // Registration mode state
  const [registrationMode, setRegistrationMode] = useState('both');

  // Class booking state
  const [classesEnabled, setClassesEnabled] = useState(false);
  const [classesSaving, setClassesSaving] = useState(false);

  // Digest config state
  const [digestOpen, setDigestOpen] = useState(false);
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestFrequency, setDigestFrequency] = useState('weekly');
  const [digestDay, setDigestDay] = useState(1);
  const [digestContent, setDigestContent] = useState({
    member_activity: true,
    churn_alerts: true,
    challenge_updates: true,
    attendance_trends: true,
    new_members: true,
    revenue_redemptions: false,
  });
  const [digestSaving, setDigestSaving] = useState(false);
  const [digestSaved, setDigestSaved] = useState(false);
  const [digestPreview, setDigestPreview] = useState(false);

  // Notification prefs collapsible
  const [notifPrefsOpen, setNotifPrefsOpen] = useState(false);

  // Referral config state
  const [referralOpen, setReferralOpen] = useState(false);
  const [referralConfig, setReferralConfig] = useState(DEFAULT_REFERRAL_CONFIG);
  const [referralSaving, setReferralSaving] = useState(false);
  const [referralSaved, setReferralSaved] = useState(false);


  // Palette picker state
  const [selectedPalette, setSelectedPalette] = useState(null);
  const [customPrimary, setCustomPrimary] = useState('');
  const [customSecondary, setCustomSecondary] = useState('');
  const [paletteSaving, setPaletteSaving] = useState(false);
  const [paletteSaved, setPaletteSaved] = useState(false);
  const [customExpanded, setCustomExpanded] = useState(false);
  const [colorAnalysis, setColorAnalysis] = useState(null); // { ok, warnings, suggestions, contrast }

  // Gym closures state
  const [closures, setClosures] = useState([]);
  const [closureDate, setClosureDate] = useState('');
  const [closureReason, setClosureReason] = useState('holiday');
  const [closureName, setClosureName] = useState('');
  const [closureSaving, setClosureSaving] = useState(false);

  useEffect(() => { document.title = 'Admin - Settings | TuGymPR'; }, []);

  // ── Load settings ──
  const { data: settingsData, isLoading } = useQuery({
    queryKey: adminKeys.settings(gymId),
    queryFn: async () => {
      const [{ data: gymData }, { data: brandingData }, { data: hoursData }, { data: followupData }] = await Promise.all([
        supabase.from('gyms').select('*').eq('id', gymId).single(),
        supabase.from('gym_branding').select('primary_color, accent_color, welcome_message, logo_url, palette_name').eq('gym_id', gymId).single(),
        supabase.from('gym_hours').select('*').eq('gym_id', gymId).order('day_of_week'),
        supabase.from('churn_followup_settings').select('digest_enabled, digest_day').eq('gym_id', gymId).single(),
      ]);
      let signedLogoUrl = '';
      const path = brandingData?.logo_url ?? '';
      if (path) {
        signedLogoUrl = await getSignedLogoUrl(path);
      }
      return { gym: gymData, branding: brandingData, signedLogoUrl, hours: hoursData, followup: followupData };
    },
    enabled: !!gymId,
  });

  // Populate form when data loads
  useEffect(() => {
    if (!settingsData) return;
    const { gym, branding, signedLogoUrl, hours, followup } = settingsData;
    if (gym) {
      setName(gym.name ?? '');
      setOpenTime(gym.open_time ?? '06:00');
      setCloseTime(gym.close_time ?? '22:00');
      setOpenDays(gym.open_days ?? [0, 1, 2, 3, 4, 5, 6]);
      setRegistrationMode(gym.registration_mode ?? 'both');
      setClassesEnabled(gym.classes_enabled ?? false);
      // Load referral config from gym JSONB column
      if (gym.referral_config) {
        setReferralConfig({ ...DEFAULT_REFERRAL_CONFIG, ...gym.referral_config });
      }
      // Load digest config from gym JSONB column
      if (gym.digest_config) {
        const dc = gym.digest_config;
        if (dc.frequency) setDigestFrequency(dc.frequency);
        if (dc.content) setDigestContent(prev => ({ ...prev, ...dc.content }));
      }
    }
    // Load digest settings from churn_followup_settings
    if (followup) {
      setDigestEnabled(followup.digest_enabled ?? false);
      setDigestDay(followup.digest_day ?? 1);
    }
    if (hours?.length) {
      setDayHours(hours.map(h => ({ day_of_week: h.day_of_week, open_time: h.open_time, close_time: h.close_time, is_closed: h.is_closed })));
    }
    if (branding) {
      setPrimary(branding.primary_color ?? '#D4AF37');
      setAccent(branding.accent_color ?? '#10B981');
      setWelcome(branding.welcome_message ?? '');
      // Populate palette state
      const paletteName = branding.palette_name || null;
      setSelectedPalette(paletteName);
      if (paletteName === 'custom') {
        setCustomPrimary(branding.primary_color ?? '');
        setCustomSecondary(branding.accent_color ?? '');
        setCustomExpanded(true);
      }
    }
    setLogoUrl(signedLogoUrl);
  }, [settingsData]);

  const handleLogoUpload = async (file) => {
    if (!file) return;
    const validation = await validateImageFile(file);
    if (!validation.valid) {
      setError(validation.error);
      showToast(validation.error, 'error');
      return;
    }
    setUploadingLogo(true);
    try {
      const compressed = await compressImage(file);
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${gymId}/logo.${ext}`;
      const { error: storageErr } = await supabase.storage
        .from('gym-logos')
        .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });
      if (storageErr) {
        setError(`Logo upload failed: ${storageErr.message}`);
        setUploadingLogo(false);
        return;
      }
      const signedUrl = await getSignedLogoUrl(path);
      setLogoUrl(signedUrl);
      setLogoFile(null);
      await supabase
        .from('gym_branding')
        .update({ logo_url: path })
        .eq('gym_id', gymId);
    } catch (err) {
      setError(err.message || 'Logo upload failed');
    }
    setUploadingLogo(false);
  };

  const toggleDay = (idx) => {
    setOpenDays(prev =>
      prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx].sort()
    );
  };

  // ── Save referral config ──
  const handleSaveReferralConfig = async () => {
    setReferralSaving(true);
    try {
      const payload = {
        ...referralConfig,
        max_per_month: referralConfig.max_per_month ? Number(referralConfig.max_per_month) : null,
      };
      const { error: updateErr } = await supabase
        .from('gyms')
        .update({ referral_config: payload, updated_at: new Date().toISOString() })
        .eq('id', gymId);
      if (updateErr) throw updateErr;
      queryClient.invalidateQueries({ queryKey: adminKeys.settings(gymId) });
      queryClient.invalidateQueries({ queryKey: adminKeys.referrals.config(gymId) });
      setReferralSaved(true);
      setTimeout(() => setReferralSaved(false), 2500);
      showToast(t('admin.referral.configSaved'), 'success');
    } catch (err) {
      setError(err.message);
      showToast(err.message, 'error');
    }
    setReferralSaving(false);
  };

  // ── Save digest config ──
  const handleSaveDigestConfig = async () => {
    setDigestSaving(true);
    try {
      // Save enabled + day to churn_followup_settings
      const { error: fupErr } = await supabase
        .from('churn_followup_settings')
        .update({
          digest_enabled: digestEnabled,
          digest_day: digestDay,
        })
        .eq('gym_id', gymId);
      if (fupErr) throw fupErr;

      // Save extended config (frequency, content) to gyms.digest_config JSONB
      const { error: gymErr } = await supabase
        .from('gyms')
        .update({
          digest_config: { frequency: digestFrequency, content: digestContent },
          updated_at: new Date().toISOString(),
        })
        .eq('id', gymId);
      if (gymErr) throw gymErr;

      queryClient.invalidateQueries({ queryKey: adminKeys.settings(gymId) });
      setDigestSaved(true);
      setTimeout(() => setDigestSaved(false), 2500);
      showToast(t('admin.digest.saved'), 'success');
    } catch (err) {
      setError(err.message);
      showToast(err.message, 'error');
    }
    setDigestSaving(false);
  };

  // ── Toggle digest enabled (optimistic) ──
  const handleToggleDigest = async (v) => {
    const prev = digestEnabled;
    setDigestEnabled(v);
    const { error } = await supabase
      .from('churn_followup_settings')
      .update({ digest_enabled: v })
      .eq('gym_id', gymId);
    if (error) {
      setDigestEnabled(prev);
      showToast(error.message, 'error');
    } else {
      queryClient.invalidateQueries({ queryKey: adminKeys.settings(gymId) });
    }
  };

  // ── Load gym closures ──
  useEffect(() => {
    if (!gymId) return;
    supabase
      .from('gym_closures')
      .select('*')
      .eq('gym_id', gymId)
      .gte('closure_date', new Date().toISOString().slice(0, 10))
      .order('closure_date')
      .then(({ data }) => setClosures(data || []))
      .catch(() => {});
  }, [gymId]);

  const handleAddClosure = async () => {
    if (!closureDate) return;
    setClosureSaving(true);
    try {
      const { data, error: insertErr } = await supabase
        .from('gym_closures')
        .insert({
          gym_id: gymId,
          closure_date: closureDate,
          reason: closureReason,
          name: closureName || null,
          created_by: profile?.id,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;
      setClosures(prev => [...prev, data].sort((a, b) => a.closure_date.localeCompare(b.closure_date)));
      setClosureDate('');
      setClosureName('');
      showToast(t('admin.closures.added'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
    setClosureSaving(false);
  };

  const handleDeleteClosure = async (id) => {
    try {
      const { error: delErr } = await supabase.from('gym_closures').delete().eq('id', id);
      if (delErr) throw delErr;
      setClosures(prev => prev.filter(c => c.id !== id));
      showToast(t('admin.closures.removed'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ── Save mutation ──
  const saveMutation = useMutation({
    mutationFn: async () => {
      // Derive open_days from dayHours for backward compat
      const derivedOpenDays = dayHours.filter(d => !d.is_closed).map(d => d.day_of_week).sort();
      const [{ error: gymErr }, { error: brandingErr }] = await Promise.all([
        supabase.from('gyms').update({
          name,
          open_time: dayHours.find(d => !d.is_closed)?.open_time || openTime,
          close_time: dayHours.find(d => !d.is_closed)?.close_time || closeTime,
          open_days: derivedOpenDays,
          registration_mode: registrationMode,
          updated_at: new Date().toISOString(),
        }).eq('id', gymId),
        supabase.from('gym_branding').update({
          primary_color: primaryColor,
          accent_color: accentColor,
          welcome_message: welcomeMsg,
          updated_at: new Date().toISOString(),
        }).eq('gym_id', gymId),
      ]);
      // Upsert per-day hours
      const hoursRows = dayHours.map(d => ({ gym_id: gymId, day_of_week: d.day_of_week, open_time: d.open_time, close_time: d.close_time, is_closed: d.is_closed }));
      await supabase.from('gym_hours').upsert(hoursRows, { onConflict: 'gym_id,day_of_week' });
      if (!brandingErr) applyBranding({ primaryColor, secondaryColor: accentColor });
      if (gymErr || brandingErr) {
        throw new Error(gymErr?.message || brandingErr?.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.settings(gymId) });
      refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      showToast('Settings saved', 'success');
    },
    onError: (err) => {
      setError(err.message);
      showToast(err.message, 'error');
    },
  });

  // ── Palette selection ──
  const handleSelectPalette = (paletteId) => {
    const palette = getPalette(paletteId);
    setSelectedPalette(paletteId);
    setCustomExpanded(false);
    // Live preview
    applyBranding({ primaryColor: palette.primary, secondaryColor: palette.secondary });
    // Also sync the branding color inputs
    setPrimary(palette.primary);
    setAccent(palette.secondary);
  };

  const isValidHex = (hex) => /^#[0-9A-Fa-f]{6}$/.test(hex);

  const handleApplyCustomColors = () => {
    if (isValidHex(customPrimary) && isValidHex(customSecondary)) {
      // Analyze the color pair for issues
      const analysis = analyzeColorPair(customPrimary, customSecondary);
      setColorAnalysis(analysis);

      setSelectedPalette('custom');
      setPrimary(customPrimary);
      setAccent(customSecondary);
      applyBranding({ primaryColor: customPrimary, secondaryColor: customSecondary });
    }
  };

  const handleAutoFix = () => {
    if (!isValidHex(customPrimary)) return;
    const fixed = autoHarmonize(customPrimary, isValidHex(customSecondary) ? customSecondary : null);
    setCustomPrimary(fixed.primary);
    setCustomSecondary(fixed.secondary);
    setSelectedPalette('custom');
    setPrimary(fixed.primary);
    setAccent(fixed.secondary);
    applyBranding({ primaryColor: fixed.primary, secondaryColor: fixed.secondary });
    // Re-analyze with fixed colors
    const newAnalysis = analyzeColorPair(fixed.primary, fixed.secondary);
    setColorAnalysis(newAnalysis);
    if (fixed.wasAdjusted) {
      showToast('Colors auto-adjusted for better harmony', 'success');
    }
  };

  const handleSavePalette = async () => {
    setPaletteSaving(true);
    try {
      const isCustom = selectedPalette === 'custom';
      const payload = {
        palette_name: selectedPalette || DEFAULT_PALETTE,
        primary_color: primaryColor,
        accent_color: accentColor,
        updated_at: new Date().toISOString(),
      };
      const { error: updateErr } = await supabase
        .from('gym_branding')
        .update(payload)
        .eq('gym_id', gymId);
      if (updateErr) throw updateErr;
      queryClient.invalidateQueries({ queryKey: adminKeys.settings(gymId) });
      refreshProfile();
      setPaletteSaved(true);
      setTimeout(() => setPaletteSaved(false), 2500);
      showToast('Theme saved successfully', 'success');
    } catch (err) {
      setError(err.message);
      showToast(err.message, 'error');
    }
    setPaletteSaving(false);
  };

  const handleResetPalette = () => {
    const palette = getPalette(DEFAULT_PALETTE);
    setSelectedPalette(DEFAULT_PALETTE);
    setPrimary(palette.primary);
    setAccent(palette.secondary);
    setCustomPrimary('');
    setCustomSecondary('');
    setCustomExpanded(false);
    applyBranding({ primaryColor: palette.primary, secondaryColor: palette.secondary });
  };

  const handleSave = () => {
    setError('');
    saveMutation.mutate();
  };

  if (isLoading) return (
    <AdminPageShell className="space-y-4">
      <CardSkeleton h="h-[60px]" />
      <CardSkeleton h="h-[280px]" />
      <CardSkeleton h="h-[200px]" />
    </AdminPageShell>
  );

  return (
    <AdminPageShell>
      <PageHeader title="Settings" subtitle="Gym branding and configuration" className="mb-6" />

      <div className="grid xl:grid-cols-12 gap-4">
        {/* Branding */}
        <FadeIn delay={0} className="xl:col-span-6">
          <AdminCard hover padding="p-5">
            <SectionLabel className="mb-4">Branding</SectionLabel>
            <div className="space-y-4">
              <div>
                <label htmlFor="gym-name" className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Gym Name</label>
                <input id="gym-name" value={name} onChange={e => setName(e.target.value)}
                  className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" />
              </div>
              <div>
                <label htmlFor="welcome-msg" className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Welcome Message</label>
                <textarea id="welcome-msg" value={welcomeMsg} onChange={e => setWelcome(e.target.value)} rows={2}
                  placeholder="Shown to new members during onboarding..."
                  className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 resize-none" />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Gym Logo</label>
                <div className="flex items-center gap-3">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Gym logo" className="w-12 h-12 rounded-xl object-contain bg-[#111827] border border-white/6 p-1" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-[#111827] border border-white/6 flex items-center justify-center flex-shrink-0">
                      <ImageIcon size={20} className="text-[#6B7280]" />
                    </div>
                  )}
                  <label className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl cursor-pointer transition-colors border border-dashed border-white/10 hover:border-white/20 text-[#6B7280] hover:text-[#9CA3AF]">
                    <Upload size={14} />
                    <span className="text-[12px] font-medium">
                      {uploadingLogo ? 'Uploading...' : logoFile ? logoFile.name : 'Upload logo'}
                    </span>
                    <input
                      type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                      disabled={uploadingLogo}
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) { setLogoFile(f); handleLogoUpload(f); }
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Primary Color</label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={primaryColor} onChange={e => setPrimary(e.target.value)}
                      className="w-10 h-10 rounded-xl border border-white/6 bg-[#111827] cursor-pointer p-1" />
                    <input value={primaryColor} onChange={e => setPrimary(e.target.value)}
                      className="flex-1 bg-[#111827] border border-white/6 rounded-xl px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 font-mono" />
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Accent Color</label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={accentColor} onChange={e => setAccent(e.target.value)}
                      className="w-10 h-10 rounded-xl border border-white/6 bg-[#111827] cursor-pointer p-1" />
                    <input value={accentColor} onChange={e => setAccent(e.target.value)}
                      className="flex-1 bg-[#111827] border border-white/6 rounded-xl px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 font-mono" />
                  </div>
                </div>
              </div>
            </div>
          </AdminCard>
        </FadeIn>

        {/* Theme & Colors */}
        <FadeIn delay={30} className="xl:col-span-6">
          <AdminCard hover padding="p-5">
            <SectionLabel icon={Palette} className="mb-2">Theme & Colors</SectionLabel>
            <p className="text-[12px] mb-5" style={{ color: 'var(--color-text-muted)' }}>
              Choose a predefined palette or create custom colors. Changes preview instantly.
            </p>

            {/* Palette Grid */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              {getAllPalettes().map((palette) => {
                const isActive = selectedPalette === palette.id;
                return (
                  <button
                    key={palette.id}
                    onClick={() => handleSelectPalette(palette.id)}
                    className="relative text-left rounded-[14px] p-3.5 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] border"
                    style={{
                      backgroundColor: 'var(--color-bg-deep)',
                      borderColor: isActive ? palette.primary : 'var(--color-border-subtle)',
                      boxShadow: isActive ? `0 0 0 1px ${palette.primary}, 0 0 20px ${palette.primary}22` : 'none',
                    }}
                  >
                    {/* Active check badge */}
                    {isActive && (
                      <div
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center shadow-lg"
                        style={{ backgroundColor: palette.primary }}
                      >
                        <Check size={11} className="text-[var(--color-text-on-accent)]" strokeWidth={3} />
                      </div>
                    )}

                    {/* Color preview strip */}
                    <div className="flex items-center gap-2 mb-2.5">
                      <span
                        className="w-6 h-6 rounded-full border border-white/10 flex-shrink-0"
                        style={{ backgroundColor: palette.primary }}
                      />
                      <span
                        className="w-6 h-6 rounded-full border border-white/10 flex-shrink-0"
                        style={{ backgroundColor: palette.secondary }}
                      />
                      <span
                        className="w-6 h-6 rounded-full border border-white/10 flex-shrink-0"
                        style={{ backgroundColor: palette.preview?.dark || '#0B0F1A' }}
                      />
                    </div>

                    {/* Name & description */}
                    <p className="text-[13px] font-bold truncate" style={{ color: isActive ? palette.primary : 'var(--color-text-primary)' }}>
                      {palette.name}
                    </p>
                    <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>
                      {palette.description}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Custom Colors — Expandable */}
            <div
              className="rounded-[14px] border transition-all"
              style={{
                backgroundColor: 'var(--color-bg-deep)',
                borderColor: selectedPalette === 'custom'
                  ? 'var(--color-accent)'
                  : 'var(--color-border-subtle)',
              }}
            >
              <button
                onClick={() => setCustomExpanded(e => !e)}
                className="w-full flex items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <Palette size={14} style={{ color: 'var(--color-text-muted)' }} />
                  <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    Custom Colors
                  </span>
                  {selectedPalette === 'custom' && (
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-bg-base)' }}
                    >
                      Active
                    </span>
                  )}
                </div>
                {customExpanded
                  ? <ChevronUp size={14} style={{ color: 'var(--color-text-muted)' }} />
                  : <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
                }
              </button>

              {customExpanded && (
                <div className="px-4 pb-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    {/* Primary color */}
                    <div>
                      <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                        Primary Color
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={isValidHex(customPrimary) ? customPrimary : '#333333'}
                          onChange={e => setCustomPrimary(e.target.value)}
                          className="w-11 h-11 rounded-xl border flex-shrink-0 cursor-pointer p-1"
                          style={{
                            borderColor: 'var(--color-border-subtle)',
                            backgroundColor: 'var(--color-bg-deep)',
                          }}
                        />
                        <input
                          type="text"
                          value={customPrimary}
                          onChange={e => setCustomPrimary(e.target.value)}
                          placeholder="#FF5500"
                          maxLength={7}
                          className="flex-1 bg-transparent border rounded-lg px-2.5 py-1.5 text-[12px] font-mono outline-none transition-colors"
                          style={{
                            color: 'var(--color-text-primary)',
                            borderColor: customPrimary && !isValidHex(customPrimary)
                              ? 'var(--color-danger)'
                              : 'var(--color-border-subtle)',
                          }}
                        />
                      </div>
                      {customPrimary && !isValidHex(customPrimary) && (
                        <p className="text-[10px] mt-1" style={{ color: 'var(--color-danger)' }}>Invalid hex format</p>
                      )}
                    </div>

                    {/* Secondary color */}
                    <div>
                      <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                        Secondary Color
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={isValidHex(customSecondary) ? customSecondary : '#333333'}
                          onChange={e => setCustomSecondary(e.target.value)}
                          className="w-11 h-11 rounded-xl border flex-shrink-0 cursor-pointer p-1"
                          style={{
                            borderColor: 'var(--color-border-subtle)',
                            backgroundColor: 'var(--color-bg-deep)',
                          }}
                        />
                        <input
                          type="text"
                          value={customSecondary}
                          onChange={e => setCustomSecondary(e.target.value)}
                          placeholder="#10B981"
                          maxLength={7}
                          className="flex-1 bg-transparent border rounded-lg px-2.5 py-1.5 text-[12px] font-mono outline-none transition-colors"
                          style={{
                            color: 'var(--color-text-primary)',
                            borderColor: customSecondary && !isValidHex(customSecondary)
                              ? 'var(--color-danger)'
                              : 'var(--color-border-subtle)',
                          }}
                        />
                      </div>
                      {customSecondary && !isValidHex(customSecondary) && (
                        <p className="text-[10px] mt-1" style={{ color: 'var(--color-danger)' }}>Invalid hex format</p>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleApplyCustomColors}
                      disabled={!isValidHex(customPrimary) || !isValidHex(customSecondary)}
                      className="flex-1 py-2 rounded-xl text-[12px] font-semibold transition-all disabled:opacity-40 border"
                      style={{
                        backgroundColor: 'var(--color-accent)',
                        color: 'var(--color-bg-base)',
                        borderColor: 'transparent',
                        opacity: (!isValidHex(customPrimary) || !isValidHex(customSecondary)) ? 0.4 : 1,
                      }}
                    >
                      Preview Colors
                    </button>
                    {isValidHex(customPrimary) && (
                      <button
                        onClick={handleAutoFix}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold transition-all border"
                        style={{
                          backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                          color: 'var(--color-accent)',
                          borderColor: 'color-mix(in srgb, var(--color-accent) 25%, transparent)',
                        }}
                        title="Auto-adjust colors for best harmony and contrast"
                      >
                        <Wand2 size={12} /> Auto-fix
                      </button>
                    )}
                  </div>

                  {/* Color analysis warnings */}
                  {colorAnalysis && !colorAnalysis.ok && (
                    <div
                      className="rounded-xl p-3 space-y-2"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--color-warning) 20%, transparent)',
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle size={12} style={{ color: 'var(--color-warning)' }} />
                        <span className="text-[11px] font-semibold" style={{ color: 'var(--color-warning)' }}>
                          Color Issues Detected
                        </span>
                      </div>
                      {colorAnalysis.warnings.map((w, i) => (
                        <p key={i} className="text-[11px] pl-5" style={{ color: 'var(--color-text-muted)' }}>
                          {w.message}
                        </p>
                      ))}
                      <button
                        onClick={handleAutoFix}
                        className="flex items-center gap-1.5 text-[11px] font-semibold pl-5 mt-1 hover:underline"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        <Wand2 size={10} /> Fix automatically
                      </button>
                    </div>
                  )}

                  {/* Contrast scores */}
                  {colorAnalysis && (
                    <div className="flex gap-3 text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>
                      <span>
                        Dark contrast:{' '}
                        <span style={{ color: colorAnalysis.contrast.primaryOnDark >= 3 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                          {colorAnalysis.contrast.primaryOnDark.toFixed(1)}:1
                        </span>
                      </span>
                      <span>
                        Light contrast:{' '}
                        <span style={{ color: colorAnalysis.contrast.primaryOnLight >= 3 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                          {colorAnalysis.contrast.primaryOnLight.toFixed(1)}:1
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Save + Reset buttons */}
            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={handleSavePalette}
                disabled={paletteSaving || !selectedPalette}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-[13px] transition-all disabled:opacity-50"
                style={{
                  backgroundColor: paletteSaved ? '#10B981' : 'var(--color-accent)',
                  color: paletteSaved ? '#fff' : 'var(--color-bg-base)',
                }}
              >
                <Save size={14} />
                {paletteSaving ? 'Saving...' : paletteSaved ? 'Saved!' : 'Save Theme'}
              </button>
              <button
                onClick={handleResetPalette}
                className="flex items-center gap-2 px-4 py-3 rounded-xl text-[13px] font-semibold transition-all border"
                style={{
                  backgroundColor: 'transparent',
                  color: 'var(--color-text-muted)',
                  borderColor: 'var(--color-border-subtle)',
                }}
              >
                <RotateCcw size={14} />
                Reset
              </button>
            </div>
          </AdminCard>
        </FadeIn>

        {/* Gym hours — per-day table */}
        <FadeIn delay={60} className="xl:col-span-6">
          <AdminCard hover padding="p-5">
            <SectionLabel icon={Clock} className="mb-4">Gym Hours</SectionLabel>
            <p className="text-[12px] text-[#6B7280] mb-4">Set opening hours for each day. Toggle days off to mark as closed.</p>
            <div className="space-y-2">
              {DAY_KEYS.map((dayKey, idx) => {
                const dayLabel = t(`common:days.${dayKey}`);
                const dayShort = t(`common:days.${dayKey.slice(0, 3)}`);
                const dh = dayHours.find(d => d.day_of_week === idx) || { open_time: '06:00', close_time: '22:00', is_closed: false };
                const updateDay = (field, value) => {
                  setDayHours(prev => prev.map(d => d.day_of_week === idx ? { ...d, [field]: value } : d));
                };
                return (
                  <div key={dayKey} className={`flex items-center gap-3 rounded-xl px-4 py-3 transition-colors ${dh.is_closed ? 'opacity-50' : ''}`}
                    style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                    <button
                      onClick={() => updateDay('is_closed', !dh.is_closed)}
                      className="w-9 h-5 rounded-full relative flex-shrink-0 transition-colors"
                      style={{ backgroundColor: dh.is_closed ? 'var(--color-text-faint)' : 'var(--color-accent)' }}
                      aria-label={`Toggle ${dayLabel}`}
                    >
                      <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                        style={{ left: dh.is_closed ? '2px' : 'calc(100% - 18px)' }} />
                    </button>
                    <span className="text-[13px] font-semibold w-12 flex-shrink-0" style={{ color: 'var(--color-text-primary)' }}>
                      {dayShort}
                    </span>
                    {dh.is_closed ? (
                      <span className="text-[12px] font-medium" style={{ color: 'var(--color-danger)' }}>Closed</span>
                    ) : (
                      <div className="flex items-center gap-2 flex-1">
                        <input type="time" value={dh.open_time} onChange={e => updateDay('open_time', e.target.value)}
                          className="bg-[#111827] border border-white/6 rounded-lg px-2.5 py-1.5 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 w-[110px]" />
                        <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>to</span>
                        <input type="time" value={dh.close_time} onChange={e => updateDay('close_time', e.target.value)}
                          className="bg-[#111827] border border-white/6 rounded-lg px-2.5 py-1.5 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 w-[110px]" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </AdminCard>
        </FadeIn>

        {/* Registration Mode */}
        <FadeIn delay={75} className="xl:col-span-6">
          <AdminCard hover padding="p-5">
            <SectionLabel icon={Shield} className="mb-4">{t('admin.registrationMode.sectionTitle')}</SectionLabel>
            <p className="text-[12px] text-[#6B7280] mb-4">{t('admin.registrationMode.description')}</p>
            <div className="space-y-2">
              {[
                { value: 'invite_only', label: t('admin.registrationMode.inviteOnly'), desc: t('admin.registrationMode.inviteOnlyDesc') },
                { value: 'gym_code', label: t('admin.registrationMode.gymCode'), desc: t('admin.registrationMode.gymCodeDesc') },
                { value: 'both', label: t('admin.registrationMode.both'), desc: t('admin.registrationMode.bothDesc') },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setRegistrationMode(opt.value)}
                  className={`w-full flex items-start gap-3 rounded-xl px-4 py-3 text-left transition-all border ${
                    registrationMode === opt.value
                      ? 'bg-[#D4AF37]/8 border-[#D4AF37]/30'
                      : 'bg-[#111827] border-white/6 hover:border-white/10'
                  }`}
                >
                  <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    registrationMode === opt.value
                      ? 'border-[#D4AF37]'
                      : 'border-[#4B5563]'
                  }`}>
                    {registrationMode === opt.value && (
                      <div className="w-2 h-2 rounded-full bg-[#D4AF37]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-semibold ${
                      registrationMode === opt.value ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'
                    }`}>
                      {opt.label}
                    </p>
                    <p className="text-[11px] text-[#6B7280] mt-0.5">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </AdminCard>
        </FadeIn>

        {/* Referral Program */}
        <FadeIn delay={90} className="xl:col-span-6">
          <AdminCard hover padding="p-5">
            <button
              onClick={() => setReferralOpen(o => !o)}
              className="w-full flex items-center justify-between"
            >
              <SectionLabel icon={Users}>{t('admin.referral.sectionTitle')}</SectionLabel>
              {referralOpen ? <ChevronUp size={16} className="text-[#6B7280]" /> : <ChevronDown size={16} className="text-[#6B7280]" />}
            </button>

            {referralOpen && (
              <div className="mt-4 space-y-5">
                {/* Enable toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-[#E5E7EB]">{t('admin.referral.enableProgram')}</p>
                    <p className="text-[11px] text-[#6B7280]">{t('admin.referral.enableProgramDesc')}</p>
                  </div>
                  <Toggle
                    checked={referralConfig.enabled}
                    onChange={v => setReferralConfig(c => ({ ...c, enabled: v }))}
                    label={t('admin.referral.enableProgram')}
                  />
                </div>

                {referralConfig.enabled && (
                  <>
                    {/* Referrer reward */}
                    <div className="border-t border-white/6 pt-4">
                      <RewardConfig
                        reward={referralConfig.referrer_reward}
                        onChange={r => setReferralConfig(c => ({ ...c, referrer_reward: r }))}
                        labelPrefix={t('admin.referral.referrerReward')}
                        t={t}
                      />
                    </div>

                    {/* Referred friend reward */}
                    <div className="border-t border-white/6 pt-4">
                      <RewardConfig
                        reward={referralConfig.referred_reward}
                        onChange={r => setReferralConfig(c => ({ ...c, referred_reward: r }))}
                        labelPrefix={t('admin.referral.referredReward')}
                        t={t}
                      />
                    </div>

                    {/* Require approval */}
                    <div className="flex items-center justify-between border-t border-white/6 pt-4">
                      <div>
                        <p className="text-[13px] font-medium text-[#E5E7EB]">{t('admin.referral.requireApproval')}</p>
                        <p className="text-[11px] text-[#6B7280]">{t('admin.referral.requireApprovalDesc')}</p>
                      </div>
                      <Toggle
                        checked={referralConfig.require_approval}
                        onChange={v => setReferralConfig(c => ({ ...c, require_approval: v }))}
                        label={t('admin.referral.requireApproval')}
                      />
                    </div>

                    {/* Max per month */}
                    <div className="border-t border-white/6 pt-4">
                      <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.referral.maxPerMonth')}</label>
                      <input
                        type="number"
                        min="1"
                        value={referralConfig.max_per_month ?? ''}
                        onChange={e => setReferralConfig(c => ({ ...c, max_per_month: e.target.value ? Number(e.target.value) : null }))}
                        placeholder={t('admin.referral.maxPerMonthPlaceholder')}
                        className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                      />
                    </div>

                    {/* Save referral config */}
                    <button
                      onClick={handleSaveReferralConfig}
                      disabled={referralSaving}
                      className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-[13px] transition-all ${
                        referralSaved ? 'bg-emerald-500 text-white' : 'bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20'
                      } disabled:opacity-50`}
                    >
                      <Save size={14} />
                      {referralSaving ? 'Saving...' : referralSaved ? 'Saved!' : t('admin.referral.saveReferralConfig')}
                    </button>
                  </>
                )}
              </div>
            )}
          </AdminCard>
        </FadeIn>

        {/* Class Booking */}
        <FadeIn delay={97} className="xl:col-span-6">
          <AdminCard hover padding="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SectionLabel icon={CalendarDays}>{t('admin.classes.settingTitle')}</SectionLabel>
              </div>
              <Toggle
                checked={classesEnabled}
                onChange={async (v) => {
                  setClassesSaving(true);
                  setClassesEnabled(v);
                  const { error } = await supabase
                    .from('gyms')
                    .update({ classes_enabled: v, updated_at: new Date().toISOString() })
                    .eq('id', gymId);
                  if (error) {
                    setClassesEnabled(!v);
                    showToast(error.message, 'error');
                  } else {
                    queryClient.invalidateQueries({ queryKey: adminKeys.settings(gymId) });
                    refreshProfile();
                  }
                  setClassesSaving(false);
                }}
                label={t('admin.classes.settingTitle')}
              />
            </div>
            <p className="text-[12px] text-[#6B7280] mt-1.5">{t('admin.classes.settingDesc')}</p>
          </AdminCard>
        </FadeIn>

        {/* Weekly Digest */}
        <FadeIn delay={100} className="xl:col-span-6">
          <AdminCard hover padding="p-5">
            <button
              onClick={() => setDigestOpen(o => !o)}
              className="w-full flex items-center justify-between"
            >
              <SectionLabel icon={Mail}>{t('admin.digest.sectionTitle')}</SectionLabel>
              {digestOpen ? <ChevronUp size={16} style={{ color: 'var(--color-text-muted)' }} /> : <ChevronDown size={16} style={{ color: 'var(--color-text-muted)' }} />}
            </button>

            {digestOpen && (
              <div className="mt-4 space-y-5">
                {/* Enable toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{t('admin.digest.enableDigest')}</p>
                    <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.digest.enableDigestDesc')}</p>
                  </div>
                  <Toggle
                    checked={digestEnabled}
                    onChange={handleToggleDigest}
                    label={t('admin.digest.enableDigest')}
                  />
                </div>

                {digestEnabled && (
                  <>
                    {/* Frequency */}
                    <div className="border-t pt-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
                      <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                        {t('admin.digest.frequency')}
                      </label>
                      <select
                        value={digestFrequency}
                        onChange={e => setDigestFrequency(e.target.value)}
                        className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none appearance-none"
                        style={{
                          backgroundColor: 'var(--color-bg-deep)',
                          border: '1px solid var(--color-border-subtle)',
                          color: 'var(--color-text-primary)',
                        }}
                      >
                        <option value="daily">{t('admin.digest.frequencyDaily')}</option>
                        <option value="weekly">{t('admin.digest.frequencyWeekly')}</option>
                        <option value="monthly">{t('admin.digest.frequencyMonthly')}</option>
                      </select>
                    </div>

                    {/* Delivery day */}
                    <div className="border-t pt-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
                      <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                        {digestFrequency === 'monthly' ? t('admin.digest.deliveryDate') : t('admin.digest.deliveryDay')}
                      </label>
                      {digestFrequency === 'weekly' && (
                        <div className="flex flex-wrap gap-2">
                          {DAY_KEYS.map((dayKey, idx) => {
                            const isActive = digestDay === idx;
                            return (
                              <button
                                key={dayKey}
                                onClick={() => setDigestDay(idx)}
                                className="px-3 py-2 rounded-xl text-[12px] font-semibold transition-all border"
                                style={{
                                  backgroundColor: isActive ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)' : 'var(--color-bg-deep)',
                                  borderColor: isActive ? 'var(--color-accent)' : 'var(--color-border-subtle)',
                                  color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
                                }}
                              >
                                {t(`common:days.${dayKey.slice(0, 3)}`)}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {digestFrequency === 'monthly' && (
                        <div className="flex gap-2">
                          {[1, 15].map(d => {
                            const isActive = digestDay === d;
                            return (
                              <button
                                key={d}
                                onClick={() => setDigestDay(d)}
                                className="px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all border"
                                style={{
                                  backgroundColor: isActive ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)' : 'var(--color-bg-deep)',
                                  borderColor: isActive ? 'var(--color-accent)' : 'var(--color-border-subtle)',
                                  color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
                                }}
                              >
                                {t('admin.digest.dayOfMonth', { day: d })}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {digestFrequency === 'daily' && (
                        <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>
                          {t('admin.digest.dailyNote')}
                        </p>
                      )}
                    </div>

                    {/* Content selection */}
                    <div className="border-t pt-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
                      <label className="block text-[12px] font-medium mb-3" style={{ color: 'var(--color-text-muted)' }}>
                        {t('admin.digest.contentTitle')}
                      </label>
                      <div className="space-y-2.5">
                        {[
                          { key: 'member_activity', label: t('admin.digest.contentMemberActivity'), desc: t('admin.digest.contentMemberActivityDesc') },
                          { key: 'churn_alerts', label: t('admin.digest.contentChurnAlerts'), desc: t('admin.digest.contentChurnAlertsDesc') },
                          { key: 'challenge_updates', label: t('admin.digest.contentChallengeUpdates'), desc: t('admin.digest.contentChallengeUpdatesDesc') },
                          { key: 'attendance_trends', label: t('admin.digest.contentAttendanceTrends'), desc: t('admin.digest.contentAttendanceTrendsDesc') },
                          { key: 'new_members', label: t('admin.digest.contentNewMembers'), desc: t('admin.digest.contentNewMembersDesc') },
                          { key: 'revenue_redemptions', label: t('admin.digest.contentRevenueRedemptions'), desc: t('admin.digest.contentRevenueRedemptionsDesc') },
                        ].map(item => (
                          <label
                            key={item.key}
                            className="flex items-start gap-3 rounded-xl px-4 py-3 cursor-pointer transition-all border"
                            style={{
                              backgroundColor: digestContent[item.key] ? 'color-mix(in srgb, var(--color-accent) 6%, transparent)' : 'var(--color-bg-deep)',
                              borderColor: digestContent[item.key] ? 'color-mix(in srgb, var(--color-accent) 25%, transparent)' : 'var(--color-border-subtle)',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={digestContent[item.key]}
                              onChange={e => setDigestContent(prev => ({ ...prev, [item.key]: e.target.checked }))}
                              className="sr-only"
                            />
                            <div
                              className="mt-0.5 w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors border"
                              style={{
                                backgroundColor: digestContent[item.key] ? 'var(--color-accent)' : 'transparent',
                                borderColor: digestContent[item.key] ? 'var(--color-accent)' : 'var(--color-text-faint)',
                              }}
                            >
                              {digestContent[item.key] && <Check size={10} className="text-[var(--color-bg-base)]" strokeWidth={3} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{item.label}</p>
                              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{item.desc}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Preview toggle */}
                    <div className="border-t pt-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
                      <button
                        onClick={() => setDigestPreview(p => !p)}
                        className="flex items-center gap-2 text-[12px] font-semibold transition-colors"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        <Eye size={14} />
                        {digestPreview ? t('admin.digest.hidePreview') : t('admin.digest.showPreview')}
                      </button>

                      {digestPreview && (
                        <div
                          className="mt-3 rounded-xl p-4 space-y-3"
                          style={{
                            backgroundColor: 'var(--color-bg-deep)',
                            border: '1px solid var(--color-border-subtle)',
                          }}
                        >
                          {/* Preview header */}
                          <div className="flex items-center gap-2 pb-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                            <Mail size={14} style={{ color: 'var(--color-accent)' }} />
                            <span className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                              {t('admin.digest.previewTitle', { gym: name || 'Your Gym' })}
                            </span>
                          </div>
                          <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
                            {digestFrequency === 'daily'
                              ? t('admin.digest.previewFreqDaily')
                              : digestFrequency === 'weekly'
                                ? t('admin.digest.previewFreqWeekly', { day: t(`common:days.${DAY_KEYS[digestDay]}`) })
                                : t('admin.digest.previewFreqMonthly', { day: digestDay })}
                          </p>

                          {/* Preview content items */}
                          <div className="space-y-2">
                            {digestContent.member_activity && (
                              <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 8%, transparent)' }}>
                                <span className="text-[11px]" style={{ color: 'var(--color-accent)' }}>●</span>
                                <span className="text-[12px]" style={{ color: 'var(--color-text-primary)' }}>{t('admin.digest.previewMemberActivity')}</span>
                              </div>
                            )}
                            {digestContent.churn_alerts && (
                              <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: 'color-mix(in srgb, var(--color-danger) 8%, transparent)' }}>
                                <span className="text-[11px]" style={{ color: 'var(--color-danger)' }}>●</span>
                                <span className="text-[12px]" style={{ color: 'var(--color-text-primary)' }}>{t('admin.digest.previewChurnAlerts')}</span>
                              </div>
                            )}
                            {digestContent.challenge_updates && (
                              <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: 'color-mix(in srgb, var(--color-info) 8%, transparent)' }}>
                                <span className="text-[11px]" style={{ color: 'var(--color-info)' }}>●</span>
                                <span className="text-[12px]" style={{ color: 'var(--color-text-primary)' }}>{t('admin.digest.previewChallengeUpdates')}</span>
                              </div>
                            )}
                            {digestContent.attendance_trends && (
                              <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 8%, transparent)' }}>
                                <span className="text-[11px]" style={{ color: 'var(--color-success)' }}>●</span>
                                <span className="text-[12px]" style={{ color: 'var(--color-text-primary)' }}>{t('admin.digest.previewAttendanceTrends')}</span>
                              </div>
                            )}
                            {digestContent.new_members && (
                              <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 8%, transparent)' }}>
                                <span className="text-[11px]" style={{ color: 'var(--color-accent)' }}>●</span>
                                <span className="text-[12px]" style={{ color: 'var(--color-text-primary)' }}>{t('admin.digest.previewNewMembers')}</span>
                              </div>
                            )}
                            {digestContent.revenue_redemptions && (
                              <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 8%, transparent)' }}>
                                <span className="text-[11px]" style={{ color: 'var(--color-warning)' }}>●</span>
                                <span className="text-[12px]" style={{ color: 'var(--color-text-primary)' }}>{t('admin.digest.previewRevenueRedemptions')}</span>
                              </div>
                            )}
                          </div>

                          {/* No content selected warning */}
                          {!Object.values(digestContent).some(Boolean) && (
                            <p className="text-[11px] italic" style={{ color: 'var(--color-text-subtle)' }}>
                              {t('admin.digest.previewEmpty')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Save button */}
                    <button
                      onClick={handleSaveDigestConfig}
                      disabled={digestSaving}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-[13px] transition-all disabled:opacity-50"
                      style={{
                        backgroundColor: digestSaved
                          ? 'var(--color-success)'
                          : 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                        color: digestSaved ? '#fff' : 'var(--color-accent)',
                        border: digestSaved ? 'none' : '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
                      }}
                    >
                      <Save size={14} />
                      {digestSaving ? t('admin.digest.saving') : digestSaved ? t('admin.digest.savedBtn') : t('admin.digest.saveConfig')}
                    </button>
                  </>
                )}
              </div>
            )}
          </AdminCard>
        </FadeIn>

        {/* Gym Closures */}
        <FadeIn delay={105} className="xl:col-span-6">
          <AdminCard hover padding="p-5">
            <SectionLabel icon={CalendarOff} className="mb-4">{t('admin.closures.sectionTitle')}</SectionLabel>
            <p className="text-[12px] text-[#6B7280] mb-4">{t('admin.closures.description')}</p>

            {/* Add closure form */}
            <div className="space-y-3 mb-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.closures.date')}</label>
                  <input
                    type="date"
                    value={closureDate}
                    onChange={e => setClosureDate(e.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                    className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.closures.reason')}</label>
                  <select
                    value={closureReason}
                    onChange={e => setClosureReason(e.target.value)}
                    className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 appearance-none"
                  >
                    <option value="holiday">{t('admin.closures.reasonHoliday')}</option>
                    <option value="maintenance">{t('admin.closures.reasonMaintenance')}</option>
                    <option value="special_event">{t('admin.closures.reasonSpecialEvent')}</option>
                    <option value="other">{t('admin.closures.reasonOther')}</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.closures.name')}</label>
                <input
                  type="text"
                  value={closureName}
                  onChange={e => setClosureName(e.target.value)}
                  placeholder={t('admin.closures.namePlaceholder')}
                  className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40"
                />
              </div>
              <button
                onClick={handleAddClosure}
                disabled={!closureDate || closureSaving}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-all disabled:opacity-50"
              >
                <Plus size={14} />
                {closureSaving ? t('admin.closures.adding') : t('admin.closures.addClosure')}
              </button>
            </div>

            {/* Upcoming closures list */}
            {closures.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[12px] font-semibold text-[#E5E7EB] mb-2">{t('admin.closures.upcoming')}</p>
                {closures.map(c => (
                  <div key={c.id} className="flex items-center justify-between rounded-xl px-4 py-3 bg-[#111827] border border-white/6">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[#E5E7EB]">
                        {c.name || t(`admin.closures.reason${c.reason?.charAt(0).toUpperCase()}${c.reason?.slice(1)?.replace('_', '')}`, c.reason)}
                      </p>
                      <p className="text-[11px] text-[#6B7280]">
                        {new Date(c.closure_date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                        {c.reason && <span className="ml-2 text-[#9CA3AF]">({t(`admin.closures.reason${c.reason?.charAt(0).toUpperCase()}${c.reason?.slice(1)?.replace('_', '')}`, c.reason)})</span>}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteClosure(c.id)}
                      className="p-2 rounded-lg hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors"
                      aria-label={t('admin.closures.remove')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-[#6B7280] italic">{t('admin.closures.noClosure')}</p>
            )}
          </AdminCard>
        </FadeIn>

        {/* Notification Preferences */}
        <FadeIn delay={112} className="xl:col-span-6">
          <AdminCard hover padding="p-0">
            <button
              onClick={() => setNotifPrefsOpen(prev => !prev)}
              className="w-full flex items-center justify-between px-5 py-4 text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#D4AF37]/10 flex items-center justify-center">
                  <Bell size={16} className="text-[#D4AF37]" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-[#E5E7EB]">{t('admin.notificationPrefs.sectionTitle')}</p>
                  <p className="text-[11px] text-[#6B7280]">{t('admin.notificationPrefs.sectionSubtitle')}</p>
                </div>
              </div>
              {notifPrefsOpen
                ? <ChevronUp size={16} className="text-[#6B7280]" />
                : <ChevronDown size={16} className="text-[#6B7280]" />
              }
            </button>
            {notifPrefsOpen && (
              <div className="px-5 pb-5 border-t border-white/6 pt-4">
                <Suspense fallback={<CardSkeleton />}>
                  <AdminNotificationPrefs />
                </Suspense>
              </div>
            )}
          </AdminCard>
        </FadeIn>

        {/* Gym info */}
        <FadeIn delay={120} className="xl:col-span-6">
          <AdminCard padding="p-4">
            <p className="text-[13px] font-semibold text-[#E5E7EB] mb-1">Gym Slug</p>
            <p className="text-[12px] text-[#6B7280]">Members sign up using: <span className="text-[#D4AF37] font-mono">{settingsData?.gym?.slug}</span></p>
          </AdminCard>
        </FadeIn>

        {error && <p className="text-[13px] text-red-400 xl:col-span-12">{error}</p>}

        <button onClick={handleSave} disabled={saveMutation.isPending}
          className={`w-full xl:col-span-12 flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[14px] transition-all ${
            saved ? 'bg-emerald-500 text-white' : 'bg-[#D4AF37] text-black'
          } disabled:opacity-50`}>
          <Save size={16} />
          {saveMutation.isPending ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </AdminPageShell>
  );
}
