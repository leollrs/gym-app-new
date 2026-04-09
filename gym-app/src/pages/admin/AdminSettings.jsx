import { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Save, Clock, Upload, Image as ImageIcon, Users, ChevronDown, ChevronUp, Shield, CalendarOff, Plus, Trash2, Palette, Check, RotateCcw, AlertTriangle, Wand2, CalendarDays, Mail, Eye, Bell, Globe, Settings2, Megaphone, Tag, ArrowUp, ArrowDown, Pencil, Sparkles, Sun, Gift, Percent, Cake } from 'lucide-react';

const AdminNotificationPrefs = lazy(() => import('./AdminNotificationPrefs'));
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import posthog from 'posthog-js';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { useToast } from '../../contexts/ToastContext';
import { applyBranding, resetToDefault } from '../../lib/branding';
import { getAllPalettes, getPalette, DEFAULT_PALETTE } from '../../lib/palettes';
import { analyzeColorPair, autoHarmonize } from '../../lib/themeGenerator';
import { validateImageFile } from '../../lib/validateImage';
import { adminKeys } from '../../lib/adminQueryKeys';
import { PageHeader, AdminCard, SectionLabel, FadeIn, CardSkeleton, AdminPageShell, AdminTabs, AdminModal, Toggle } from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import { useAutoTranslate } from '../../hooks/useAutoTranslate';

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '\u{1F1FA}\u{1F1F8}' },
  { code: 'es', label: 'Espa\u00F1ol', flag: '\u{1F1EA}\u{1F1F8}' },
];

// Signed URL expiry for logos (1 day)
const LOGO_URL_EXPIRY_SECONDS = 60 * 60 * 24;

const REWARD_TYPES = ['points', 'discount', 'free_month', 'custom'];

const OFFER_TYPES = ['discount', 'free_trial', 'bundle', 'class_pass', 'bring_friend', 'custom'];
const OFFER_TYPE_COLORS = {
  discount: '#EF4444',
  free_trial: '#10B981',
  bundle: '#8B5CF6',
  class_pass: '#3B82F6',
  bring_friend: '#F59E0B',
  custom: '#6B7280',
};
const OFFER_COVERS = [
  { key: 'new_year',     label: 'Año Nuevo',      icon: Sparkles,   gradient: 'linear-gradient(135deg, #D4AF37 0%, #92751E 100%)' },
  { key: 'summer',       label: 'Verano',          icon: Sun,        gradient: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' },
  { key: 'black_friday', label: 'Black Friday',    icon: Tag,        gradient: 'linear-gradient(135deg, #111827 0%, #374151 100%)' },
  { key: 'referral',     label: 'Referidos',       icon: Users,      gradient: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)' },
  { key: 'comeback',     label: 'Regresa',         icon: RotateCcw,  gradient: 'linear-gradient(135deg, #10B981 0%, #047857 100%)' },
  { key: 'anniversary',  label: 'Aniversario',     icon: Cake,       gradient: 'linear-gradient(135deg, #EC4899 0%, #BE185D 100%)' },
  { key: 'trial',        label: 'Prueba Gratis',   icon: Gift,       gradient: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)' },
  { key: 'discount',     label: 'Descuento',       icon: Percent,    gradient: 'linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)' },
];

function OfferCoverBadge({ preset, size = 40, iconSize = 18 }) {
  if (!preset) return null;
  const cover = OFFER_COVERS.find(c => c.key === preset);
  if (!cover) return null;
  const Icon = cover.icon;
  return (
    <div
      className="rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ background: cover.gradient, width: size, height: size }}
    >
      <Icon size={iconSize} className="text-white/90" />
    </div>
  );
}

const DEFAULT_OFFER = {
  title: '',
  description: '',
  type: 'discount',
  badge_label: '',
  valid_from: '',
  valid_until: '',
  active: true,
  title_es: '',
  description_es: '',
  cover_preset: '',
  cover_image_url: '',
};

const DEFAULT_REFERRAL_CONFIG = {
  enabled: false,
  referrer_reward: { type: 'points', value: '', label: '' },
  referred_reward: { type: 'points', value: '', label: '' },
  require_approval: true,
  max_per_month: null,
  referrer_reward_id: null,
  referred_reward_id: null,
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
      <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{labelPrefix}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.referral.rewardType')}</label>
          <select
            value={reward.type}
            onChange={e => onChange({ ...reward, type: e.target.value })}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none appearance-none transition-colors"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
          >
            {REWARD_TYPES.map(rt => (
              <option key={rt} value={rt}>{typeLabels[rt]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.referral.rewardValue')}</label>
          <input
            type={reward.type === 'custom' ? 'text' : 'number'}
            value={reward.value}
            onChange={e => onChange({ ...reward, value: e.target.value })}
            placeholder={reward.type === 'discount' ? '%' : reward.type === 'points' ? '5000' : ''}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
          />
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.referral.rewardLabel')}</label>
        <input
          type="text"
          value={reward.label}
          onChange={e => onChange({ ...reward, label: e.target.value })}
          placeholder={t('admin.referral.rewardLabelPlaceholder')}
          className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
        />
      </div>
    </div>
  );
}

// ── Status pill for config summary ──
function ConfigPill({ label, value, color }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}: {value}
    </span>
  );
}

// Tab keys
const TAB_GENERAL = 'general';
const TAB_BRANDING = 'branding';
const TAB_OPERATIONS = 'operations';
export default function AdminSettings() {
  const { profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('pages');
  const gymId = profile?.gym_id;
  const isAuthorized = profile && ['admin', 'super_admin'].includes(profile.role) && !!gymId;

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const settingsTab = searchParams.get('tab') || 'general';
  const setSettingsTab = useCallback((tab) => {
    setSearchParams({ tab }, { replace: true });
  }, [setSearchParams]);

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

  // Referral reward picker from catalog
  const { data: gymRewards = [] } = useQuery({
    queryKey: [...adminKeys.settings(gymId), 'gym-rewards-catalog'],
    queryFn: async () => {
      const { data, error: fetchErr } = await supabase
        .from('gym_rewards')
        .select('id, name, cost_points, cover_preset')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('cost_points');
      if (fetchErr) { logger.warn('Failed to load gym rewards for referral picker', fetchErr); return []; }
      return data || [];
    },
    enabled: !!gymId,
  });

  // Offers state
  const [offersOpen, setOffersOpen] = useState(false);
  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState(null);
  const [offerForm, setOfferForm] = useState(DEFAULT_OFFER);
  const [offerSaving, setOfferSaving] = useState(false);
  const [deletingOfferId, setDeletingOfferId] = useState(null);


  // Palette picker state
  const [selectedPalette, setSelectedPalette] = useState(null);
  const [customPrimary, setCustomPrimary] = useState('');
  const [customSecondary, setCustomSecondary] = useState('');
  const [paletteSaving, setPaletteSaving] = useState(false);
  const [paletteSaved, setPaletteSaved] = useState(false);
  const [customExpanded, setCustomExpanded] = useState(false);
  const [colorAnalysis, setColorAnalysis] = useState(null); // { ok, warnings, suggestions, contrast }

  // Track which sections loaded successfully (Bug 1: prevent saving over failed loads)
  const [loadedSections, setLoadedSections] = useState({ gym: false, branding: false, hours: false, followup: false });

  // Gym closures state
  const [closures, setClosures] = useState([]);
  const [closureDate, setClosureDate] = useState('');
  const [closureReason, setClosureReason] = useState('holiday');
  const [closureName, setClosureName] = useState('');
  const [closureSaving, setClosureSaving] = useState(false);

  useEffect(() => { document.title = `Admin - Settings | ${window.__APP_NAME || 'TuGymPR'}`; }, []);

  // ── Load settings ──
  const { data: settingsData, isLoading } = useQuery({
    queryKey: adminKeys.settings(gymId),
    queryFn: async () => {
      const [gymResult, brandingResult, hoursResult, followupResult, digestConfigResult] = await Promise.all([
        supabase.from('gyms').select('*').eq('id', gymId).single(),
        supabase.from('gym_branding').select('primary_color, accent_color, welcome_message, logo_url, palette_name').eq('gym_id', gymId).maybeSingle(),
        supabase.from('gym_hours').select('*').eq('gym_id', gymId).order('day_of_week'),
        supabase.from('churn_followup_settings').select('digest_enabled, digest_day').eq('gym_id', gymId).single(),
        supabase.from('admin_digest_config').select('*').eq('gym_id', gymId).eq('profile_id', profile.id).maybeSingle(),
      ]);
      // Track which sections loaded successfully
      const sections = {
        gym: !gymResult.error,
        branding: !brandingResult.error,
        hours: !hoursResult.error,
        followup: !followupResult.error,
      };
      setLoadedSections(sections);

      // Log errors but don't throw — partial data is better than none
      if (gymResult.error) logger.warn('Failed to load gym settings', gymResult.error);
      if (brandingResult.error) logger.warn('Failed to load branding settings', brandingResult.error);
      if (hoursResult.error) logger.warn('Failed to load gym hours', hoursResult.error);
      if (followupResult.error) logger.warn('Failed to load followup settings', followupResult.error);

      const gymData = gymResult.data;
      const brandingData = brandingResult.data;
      const hoursData = hoursResult.data;
      const followupData = followupResult.data;

      let signedLogoUrl = '';
      const path = brandingData?.logo_url ?? '';
      if (path) {
        signedLogoUrl = await getSignedLogoUrl(path);
      }
      return { gym: gymData, branding: brandingData, signedLogoUrl, hours: hoursData, followup: followupData, digestConfig: digestConfigResult.data, loadedSections: sections };
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
      // Load digest config from admin_digest_config table
      const dc = settingsData?.digestConfig;
      if (dc) {
        if (dc.frequency) setDigestFrequency(dc.frequency);
        setDigestContent(prev => ({
          ...prev,
          churn_alerts: dc.include_churn ?? prev.churn_alerts,
          attendance_trends: dc.include_attendance ?? prev.attendance_trends,
          new_members: dc.include_signups ?? prev.new_members,
          challenge_updates: dc.include_challenges ?? prev.challenge_updates,
          revenue_redemptions: dc.include_revenue ?? prev.revenue_redemptions,
        }));
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
        setError(`${t('admin.settings.logoUploadFailed', 'Logo upload failed')}: ${storageErr.message}`);
        setUploadingLogo(false);
        return;
      }
      const signedUrl = await getSignedLogoUrl(path);
      setLogoUrl(signedUrl);
      setLogoFile(null);
      await supabase
        .from('gym_branding')
        .upsert({ gym_id: gymId, logo_url: path }, { onConflict: 'gym_id' });
    } catch (err) {
      setError(err.message || t('admin.settings.logoUploadFailed', 'Logo upload failed'));
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

  // ── Auto-translate hook ──
  const { translate, translating } = useAutoTranslate();

  // ── Offers query ──
  const offersQueryKey = [...adminKeys.settings(gymId), 'offers'];
  const { data: offers = [] } = useQuery({
    queryKey: offersQueryKey,
    queryFn: async () => {
      const { data, error: fetchErr } = await supabase
        .from('gym_offers')
        .select('*')
        .eq('gym_id', gymId)
        .order('sort_order')
        .order('created_at');
      if (fetchErr) { logger.warn('Failed to load offers', fetchErr); return []; }
      return data || [];
    },
    enabled: !!gymId,
  });

  const openOfferModal = (offer = null) => {
    if (offer) {
      setEditingOffer(offer);
      setOfferForm({
        title: offer.title || '',
        description: offer.description || '',
        type: offer.type || 'discount',
        badge_label: offer.badge_label || '',
        valid_from: offer.valid_from || '',
        valid_until: offer.valid_until || '',
        active: offer.active ?? true,
        title_es: offer.title_es || '',
        description_es: offer.description_es || '',
        cover_preset: offer.cover_preset || '',
        cover_image_url: offer.cover_image_url || '',
      });
    } else {
      setEditingOffer(null);
      setOfferForm({ ...DEFAULT_OFFER });
    }
    setOfferModalOpen(true);
  };

  const handleSaveOffer = async () => {
    if (!offerForm.title.trim()) return;
    setOfferSaving(true);
    try {
      const payload = {
        gym_id: gymId,
        title: offerForm.title.trim(),
        description: offerForm.description.trim() || null,
        type: offerForm.type,
        badge_label: offerForm.badge_label.trim() || null,
        valid_from: offerForm.valid_from || null,
        valid_until: offerForm.valid_until || null,
        active: offerForm.active,
        title_es: offerForm.title_es.trim() || null,
        description_es: offerForm.description_es.trim() || null,
        cover_preset: offerForm.cover_preset || null,
        cover_image_url: offerForm.cover_image_url || null,
      };
      if (editingOffer) {
        const { error: upErr } = await supabase.from('gym_offers').update(payload).eq('id', editingOffer.id).eq('gym_id', gymId);
        if (upErr) throw upErr;
      } else {
        payload.sort_order = offers.length;
        const { error: insErr } = await supabase.from('gym_offers').insert(payload);
        if (insErr) throw insErr;
      }
      queryClient.invalidateQueries({ queryKey: offersQueryKey });
      setOfferModalOpen(false);
      showToast(t('admin.offers.saved'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
    setOfferSaving(false);
  };

  const handleDeleteOffer = async (id) => {
    try {
      const { error: delErr } = await supabase.from('gym_offers').delete().eq('id', id).eq('gym_id', gymId);
      if (delErr) throw delErr;
      logAdminAction('delete_offer', 'gym_offer', id);
      queryClient.invalidateQueries({ queryKey: offersQueryKey });
      setDeletingOfferId(null);
      showToast(t('admin.offers.deleted'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleToggleOfferActive = async (offer) => {
    try {
      const { error: upErr } = await supabase.from('gym_offers').update({ active: !offer.active }).eq('id', offer.id).eq('gym_id', gymId);
      if (upErr) throw upErr;
      queryClient.invalidateQueries({ queryKey: offersQueryKey });
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleReorderOffer = async (index, direction) => {
    const swapIdx = index + direction;
    if (swapIdx < 0 || swapIdx >= offers.length) return;
    const a = offers[index];
    const b = offers[swapIdx];
    try {
      await Promise.all([
        supabase.from('gym_offers').update({ sort_order: swapIdx }).eq('id', a.id).eq('gym_id', gymId),
        supabase.from('gym_offers').update({ sort_order: index }).eq('id', b.id).eq('gym_id', gymId),
      ]);
      queryClient.invalidateQueries({ queryKey: offersQueryKey });
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleAutoTranslateOffer = async () => {
    const texts = [offerForm.title, offerForm.description].filter(Boolean);
    if (!texts.length) return;
    const result = await translate(texts, 'ES');
    if (result?.translations) {
      const updates = {};
      if (offerForm.title) updates.title_es = result.translations[0] || '';
      if (offerForm.description) updates.description_es = result.translations[offerForm.title ? 1 : 0] || '';
      setOfferForm(prev => ({ ...prev, ...updates }));
    }
  };

  // ── Save digest config ──
  const handleSaveDigestConfig = async () => {
    if (!loadedSections.followup && !loadedSections.gym) {
      showToast(t('admin.settings.digestLoadFailed', 'Digest settings failed to load — cannot save. Please reload the page.'), 'error');
      return;
    }
    setDigestSaving(true);
    try {
      // Save enabled + day to churn_followup_settings (upsert to create row if missing)
      const { error: fupErr } = await supabase
        .from('churn_followup_settings')
        .upsert({
          gym_id: gymId,
          digest_enabled: digestEnabled,
          digest_day: digestDay,
        }, { onConflict: 'gym_id' });
      if (fupErr) throw fupErr;

      // Save extended config (frequency, content) to admin_digest_config
      const { error: dcErr } = await supabase
        .from('admin_digest_config')
        .upsert({
          gym_id: gymId,
          profile_id: profile.id,
          enabled: digestEnabled,
          frequency: digestFrequency,
          day_of_week: digestDay,
          include_churn: digestContent.churn_alerts ?? true,
          include_attendance: digestContent.attendance_trends ?? true,
          include_signups: digestContent.new_members ?? true,
          include_challenges: digestContent.challenge_updates ?? true,
          include_revenue: digestContent.revenue_redemptions ?? true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'gym_id,profile_id' });
      if (dcErr) throw dcErr;

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
    // Upsert to create row if missing
    const { error } = await supabase
      .from('churn_followup_settings')
      .upsert({ gym_id: gymId, digest_enabled: v }, { onConflict: 'gym_id' });
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
      logAdminAction('update_closures', 'gym', gymId);
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
      const { error: delErr } = await supabase.from('gym_closures').delete().eq('id', id).eq('gym_id', gymId);
      if (delErr) throw delErr;
      logAdminAction('delete_closure', 'gym_closure', id);
      setClosures(prev => prev.filter(c => c.id !== id));
      showToast(t('admin.closures.removed'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ── Save General section ──
  const saveGeneralMutation = useMutation({
    mutationFn: async () => {
      if (!loadedSections.gym) throw new Error(t('admin.settings.gymLoadFailed', 'Gym settings failed to load — cannot save. Please reload the page.'));
      if (!loadedSections.hours) throw new Error(t('admin.settings.hoursLoadFailed', 'Gym hours failed to load — cannot save. Please reload the page.'));

      // Derive open_days from dayHours for backward compat
      const derivedOpenDays = dayHours.filter(d => !d.is_closed).map(d => d.day_of_week).sort();
      const { error: gymErr } = await supabase.from('gyms').update({
        name,
        open_time: dayHours.find(d => !d.is_closed)?.open_time || openTime,
        close_time: dayHours.find(d => !d.is_closed)?.close_time || closeTime,
        open_days: derivedOpenDays,
        registration_mode: registrationMode,
        classes_enabled: classesEnabled,
        updated_at: new Date().toISOString(),
      }).eq('id', gymId);

      // Bug 4: Check gym_hours upsert error
      const hoursRows = dayHours.map(d => ({ gym_id: gymId, day_of_week: d.day_of_week, open_time: d.open_time, close_time: d.close_time, is_closed: d.is_closed }));
      const { error: hoursErr } = await supabase.from('gym_hours').upsert(hoursRows, { onConflict: 'gym_id,day_of_week' });

      const errors = [gymErr, hoursErr].filter(Boolean);
      if (errors.length) {
        throw new Error(errors.map(e => e.message).join('; '));
      }
      logAdminAction('update_settings', 'gym', gymId);
      logAdminAction('update_hours', 'gym', gymId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.settings(gymId) });
      refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      showToast(t('admin.settings.settingsSaved', 'Settings saved'), 'success');
    },
    onError: (err) => {
      setError(err.message);
      showToast(err.message, 'error');
    },
  });

  // ── Save Branding section ──
  const saveBrandingMutation = useMutation({
    mutationFn: async () => {
      if (!loadedSections.branding) throw new Error(t('admin.settings.brandingLoadFailed', 'Branding settings failed to load — cannot save. Please reload the page.'));

      const isCustom = selectedPalette === 'custom';
      const { error: brandingErr } = await supabase.from('gym_branding').upsert({
        gym_id: gymId,
        primary_color: primaryColor,
        accent_color: accentColor,
        welcome_message: welcomeMsg,
        palette_name: selectedPalette || DEFAULT_PALETTE,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'gym_id' });
      if (brandingErr) throw brandingErr;
      logAdminAction('update_settings', 'gym', gymId);
      applyBranding({ primaryColor, secondaryColor: accentColor });
    },
    onSuccess: () => {
      posthog?.capture('admin_branding_updated');
      queryClient.invalidateQueries({ queryKey: adminKeys.settings(gymId) });
      refreshProfile();
      setPaletteSaved(true);
      setTimeout(() => setPaletteSaved(false), 2500);
      showToast(t('admin.settings.brandingSaved', 'Branding saved'), 'success');
    },
    onError: (err) => {
      setError(err.message);
      showToast(err.message, 'error');
    },
  });

  // ── Save Operations section ──
  const saveOperationsMutation = useMutation({
    mutationFn: async () => {
      const promises = [];

      // Save digest config
      if (loadedSections.followup || loadedSections.gym) {
        promises.push(
          supabase.from('churn_followup_settings').upsert({
            gym_id: gymId,
            digest_enabled: digestEnabled,
            digest_day: digestDay,
          }, { onConflict: 'gym_id' }),
        );
        promises.push(
          supabase.from('admin_digest_config').upsert({
            gym_id: gymId,
            profile_id: profile.id,
            enabled: digestEnabled,
            frequency: digestFrequency,
            day_of_week: digestDay,
            include_churn: digestContent.churn_alerts ?? true,
            include_attendance: digestContent.attendance_trends ?? true,
            include_signups: digestContent.new_members ?? true,
            include_challenges: digestContent.challenge_updates ?? true,
            include_revenue: digestContent.revenue_redemptions ?? true,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'gym_id,profile_id' }),
        );
        promises.push(
          supabase.from('gyms').update({
            referral_config: {
              ...referralConfig,
              max_per_month: referralConfig.max_per_month ? Number(referralConfig.max_per_month) : null,
            },
            updated_at: new Date().toISOString(),
          }).eq('id', gymId),
        );
      }

      const results = await Promise.all(promises);
      const errors = results.map(r => r.error).filter(Boolean);
      if (errors.length) {
        throw new Error(errors.map(e => e.message).join('; '));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.settings(gymId) });
      queryClient.invalidateQueries({ queryKey: adminKeys.referrals.config(gymId) });
      refreshProfile();
      showToast(t('admin.settings.operationsSaved', 'Operations settings saved'), 'success');
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
      showToast(t('admin.settings.colorsAutoAdjusted', 'Colors auto-adjusted for better harmony'), 'success');
    }
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

  // ── Tab options ──
  const tabOptions = [
    { key: TAB_GENERAL, label: t('admin.settings.tabGeneral', 'General') },
    { key: TAB_BRANDING, label: t('admin.settings.tabBranding', 'Branding') },
    { key: TAB_OPERATIONS, label: t('admin.settings.tabOperations', 'Operations') },
  ];

  // ── Derived summary values ──
  const regModeLabel = registrationMode === 'invite_only'
    ? t('admin.registrationMode.inviteOnly')
    : registrationMode === 'gym_code'
      ? t('admin.registrationMode.gymCode')
      : t('admin.registrationMode.both');
  const paletteName = selectedPalette
    ? (getAllPalettes().find(p => p.id === selectedPalette)?.name || selectedPalette)
    : t('admin.settings.tabDefault', 'Default');

  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[14px] font-semibold" style={{ color: 'var(--color-danger, #EF4444)' }}>{t('admin.overview.accessDenied', 'Access denied. You are not authorized to view this page.')}</p>
      </div>
    );
  }

  if (isLoading) return (
    <AdminPageShell className="space-y-4">
      <CardSkeleton h="h-[60px]" />
      <CardSkeleton h="h-[280px]" />
      <CardSkeleton h="h-[200px]" />
    </AdminPageShell>
  );

  return (
    <AdminPageShell>
      <PageHeader title={t('admin.settings.title', 'Settings')} subtitle={t('admin.settings.subtitle', 'Gym branding and configuration')} className="mb-4" />

      {/* Warning for sections that failed to load */}
      {settingsData && (!loadedSections.gym || !loadedSections.branding || !loadedSections.hours || !loadedSections.followup) && (
        <div className="flex items-start gap-3 rounded-xl px-4 py-3 mb-4" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)' }}>
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning)' }} />
          <div>
            <p className="text-[13px] font-semibold" style={{ color: 'var(--color-warning)' }}>
              {t('admin.settings.loadWarningTitle', 'Some settings failed to load')}
            </p>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.settings.loadWarningDesc', 'The following sections could not be loaded and cannot be saved until the page is reloaded:')}
              {' '}
              {[
                !loadedSections.gym && t('admin.settings.sectionGym', 'Gym info'),
                !loadedSections.branding && t('admin.settings.sectionBranding', 'Branding'),
                !loadedSections.hours && t('admin.settings.sectionHours', 'Gym hours'),
                !loadedSections.followup && t('admin.settings.sectionDigest', 'Digest settings'),
              ].filter(Boolean).join(', ')}
            </p>
          </div>
        </div>
      )}

      {/* ── Compact Live Config Summary ── */}
      <FadeIn delay={0}>
        <AdminCard padding="p-3 px-4" className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider mr-1" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.settings.liveConfigTitle', 'Current Live Config')}
            </p>
            <ConfigPill
              label={t('admin.settings.gymName', 'Gym Name')}
              value={name || '—'}
              color="var(--color-accent)"
            />
            <ConfigPill
              label={t('admin.settings.summaryPalette', 'Palette')}
              value={paletteName}
              color="var(--color-accent)"
            />
            <ConfigPill
              label={t('admin.settings.summaryRegistration', 'Registration')}
              value={regModeLabel}
              color={registrationMode === 'invite_only' ? 'var(--color-warning)' : 'var(--color-success)'}
            />
          </div>
        </AdminCard>
      </FadeIn>

      {/* ── Tab Navigation ── */}
      <AdminTabs
        tabs={tabOptions}
        active={settingsTab}
        onChange={setSettingsTab}
        className="mb-5"
      />

      {error && <p className="text-[13px] text-red-400 mb-4">{error}</p>}

      <SwipeableTabContent tabs={tabOptions} active={settingsTab} onChange={setSettingsTab}>
        {(tabKey) => {
          if (tabKey === TAB_GENERAL) return (
        <div className="space-y-4 min-w-0">
          {/* Gym Info */}
          <FadeIn delay={0}>
            <AdminCard hover padding="p-5">
              <SectionLabel className="mb-4">{t('admin.settings.gymName', 'Gym Name')}</SectionLabel>
              <div className="space-y-4">
                <div>
                  <label htmlFor="gym-name" className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.settings.gymName', 'Gym Name')}</label>
                  <input id="gym-name" value={name} onChange={e => setName(e.target.value)}
                    className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none transition-colors"
                    style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                </div>
                {/* Gym Slug */}
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('admin.settings.gymSlug', 'Gym Slug')}</p>
                  <p className="text-[12px] mt-0.5 break-words" style={{ color: 'var(--color-text-muted)' }}>{t('admin.settings.gymSlugDesc', 'Members sign up using:')} <span style={{ color: 'var(--color-accent)' }} className="font-mono break-all">{settingsData?.gym?.slug}</span></p>
                </div>
              </div>
            </AdminCard>
          </FadeIn>

          {/* Language / Idioma */}
          <FadeIn delay={20}>
            <AdminCard hover padding="p-5">
              <SectionLabel icon={Globe} className="mb-3">{t('admin.settings.language')}</SectionLabel>
              <div className="rounded-2xl min-w-0 divide-y" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                {LANGUAGES.map(lang => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={async () => {
                      i18n.changeLanguage(lang.code);
                      if (profile?.id) {
                        await supabase.from('profiles').update({ preferred_language: lang.code }).eq('id', profile.id);
                      }
                    }}
                    className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors duration-200"
                    style={{ backgroundColor: i18n.language?.startsWith(lang.code) ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'transparent' }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[18px]">{lang.flag}</span>
                      <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{lang.label}</span>
                    </div>
                    {i18n.language?.startsWith(lang.code) && (
                      <Check size={16} style={{ color: 'var(--color-accent)' }} />
                    )}
                  </button>
                ))}
              </div>
            </AdminCard>
          </FadeIn>

          <div className="grid xl:grid-cols-12 gap-4 min-w-0">
            {/* Gym hours — per-day table */}
            <FadeIn delay={40} className="xl:col-span-6 min-w-0">
              <AdminCard hover padding="p-5">
                <SectionLabel icon={Clock} className="mb-4">{t('admin.settings.gymHours', 'Gym Hours')}</SectionLabel>
                <p className="text-[12px] mb-4" style={{ color: 'var(--color-text-muted)' }}>{t('admin.settings.gymHoursDesc', 'Set opening hours for each day. Toggle days off to mark as closed.')}</p>
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
                          <span className="text-[12px] font-medium" style={{ color: 'var(--color-danger)' }}>{t('admin.settings.closed', 'Closed')}</span>
                        ) : (
                          <div className="flex items-center gap-2 flex-1">
                            <input type="time" value={dh.open_time} onChange={e => updateDay('open_time', e.target.value)}
                              className="rounded-lg px-2.5 py-1.5 text-[12px] outline-none w-[110px] transition-colors"
                              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                            <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.settings.to', 'to')}</span>
                            <input type="time" value={dh.close_time} onChange={e => updateDay('close_time', e.target.value)}
                              className="rounded-lg px-2.5 py-1.5 text-[12px] outline-none w-[110px] transition-colors"
                              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </AdminCard>
            </FadeIn>

            {/* Gym Closures */}
            <FadeIn delay={60} className="xl:col-span-6 min-w-0">
              <AdminCard hover padding="p-5">
                <SectionLabel icon={CalendarOff} className="mb-4">{t('admin.closures.sectionTitle')}</SectionLabel>
                <p className="text-[12px] mb-4" style={{ color: 'var(--color-text-muted)' }}>{t('admin.closures.description')}</p>

                {/* Add closure form */}
                <div className="space-y-3 mb-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.closures.date')}</label>
                      <input
                        type="date"
                        value={closureDate}
                        onChange={e => setClosureDate(e.target.value)}
                        min={new Date().toISOString().slice(0, 10)}
                        className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
                        style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.closures.reason')}</label>
                      <select
                        value={closureReason}
                        onChange={e => setClosureReason(e.target.value)}
                        className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none appearance-none transition-colors"
                        style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                      >
                        <option value="holiday">{t('admin.closures.reasonHoliday')}</option>
                        <option value="maintenance">{t('admin.closures.reasonMaintenance')}</option>
                        <option value="special_event">{t('admin.closures.reasonSpecialEvent')}</option>
                        <option value="other">{t('admin.closures.reasonOther')}</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.closures.name')}</label>
                    <input
                      type="text"
                      value={closureName}
                      onChange={e => setClosureName(e.target.value)}
                      placeholder={t('admin.closures.namePlaceholder')}
                      className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
                      style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={handleAddClosure}
                      disabled={!closureDate || closureSaving}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-50"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                        color: 'var(--color-accent)',
                        border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
                      }}
                    >
                      <Plus size={14} />
                      {closureSaving ? t('admin.closures.adding') : t('admin.closures.addClosure')}
                    </button>
                  </div>
                </div>

                {/* Upcoming closures list */}
                {closures.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[12px] font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('admin.closures.upcoming')}</p>
                    {closures.map(c => (
                      <div key={c.id} className="flex items-center justify-between rounded-xl px-4 py-3" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                            {c.name || t(`admin.closures.reason${c.reason?.charAt(0).toUpperCase()}${c.reason?.slice(1)?.replace('_', '')}`, c.reason)}
                          </p>
                          <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                            {new Date(c.closure_date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                            {c.reason && <span className="ml-2" style={{ color: 'var(--color-text-subtle)' }}>({t(`admin.closures.reason${c.reason?.charAt(0).toUpperCase()}${c.reason?.slice(1)?.replace('_', '')}`, c.reason)})</span>}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDeleteClosure(c.id)}
                          className="p-2 rounded-lg hover:bg-red-500/10 transition-colors"
                          style={{ color: 'var(--color-text-muted)' }}
                          aria-label={t('admin.closures.remove')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] italic" style={{ color: 'var(--color-text-muted)' }}>{t('admin.closures.noClosure')}</p>
                )}
              </AdminCard>
            </FadeIn>

            {/* Registration Mode */}
            <FadeIn delay={80} className="xl:col-span-6">
              <AdminCard hover padding="p-5">
                <SectionLabel icon={Shield} className="mb-4">{t('admin.registrationMode.sectionTitle')}</SectionLabel>
                <p className="text-[12px] mb-4" style={{ color: 'var(--color-text-muted)' }}>{t('admin.registrationMode.description')}</p>
                <div className="space-y-2">
                  {[
                    { value: 'invite_only', label: t('admin.registrationMode.inviteOnly'), desc: t('admin.registrationMode.inviteOnlyDesc') },
                    { value: 'gym_code', label: t('admin.registrationMode.gymCode'), desc: t('admin.registrationMode.gymCodeDesc') },
                    { value: 'both', label: t('admin.registrationMode.both'), desc: t('admin.registrationMode.bothDesc') },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setRegistrationMode(opt.value)}
                      className="w-full flex items-start gap-3 rounded-xl px-4 py-3 text-left transition-all border"
                      style={{
                        backgroundColor: registrationMode === opt.value
                          ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)'
                          : 'var(--color-bg-deep)',
                        borderColor: registrationMode === opt.value
                          ? 'color-mix(in srgb, var(--color-accent) 30%, transparent)'
                          : 'var(--color-border-subtle)',
                      }}
                    >
                      <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors`}
                        style={{ borderColor: registrationMode === opt.value ? 'var(--color-accent)' : 'var(--color-text-faint)' }}>
                        {registrationMode === opt.value && (
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-accent)' }} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold" style={{ color: registrationMode === opt.value ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                          {opt.label}
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{opt.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </AdminCard>
            </FadeIn>

            {/* Class Booking */}
            <FadeIn delay={100} className="xl:col-span-6">
              <AdminCard hover padding="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <SectionLabel icon={CalendarDays}>{t('admin.classes.settingTitle')}</SectionLabel>
                  </div>
                  <Toggle
                    checked={classesEnabled}
                    onChange={(v) => setClassesEnabled(v)}
                    label={t('admin.classes.settingTitle')}
                  />
                </div>
                <p className="text-[12px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.settingDesc')}</p>
              </AdminCard>
            </FadeIn>
          </div>

          {/* Save General Button */}
          <FadeIn delay={120}>
            <button
              onClick={() => { setError(''); saveGeneralMutation.mutate(); }}
              disabled={saveGeneralMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[14px] transition-all disabled:opacity-50"
              style={{
                backgroundColor: saved ? 'var(--color-success)' : 'var(--color-accent)',
                color: saved ? '#fff' : 'var(--color-bg-base)',
              }}
            >
              <Save size={16} />
              {saveGeneralMutation.isPending
                ? t('admin.settings.saving', 'Saving...')
                : saved
                  ? t('admin.settings.saved', 'Saved!')
                  : t('admin.settings.saveGeneral', 'Save General Settings')}
            </button>
          </FadeIn>
        </div>
          );
          if (tabKey === TAB_BRANDING) return (
        <div className="space-y-4 min-w-0">
          <div className="grid xl:grid-cols-12 gap-4 min-w-0">
            {/* Logo & Welcome */}
            <FadeIn delay={0} className="xl:col-span-6 min-w-0 min-w-0">
              <AdminCard hover padding="p-5">
                <SectionLabel className="mb-4">{t('admin.settings.branding', 'Branding')}</SectionLabel>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="welcome-msg" className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.settings.welcomeMessage', 'Welcome Message')}</label>
                    <textarea id="welcome-msg" value={welcomeMsg} onChange={e => setWelcome(e.target.value)} rows={2}
                      placeholder={t('admin.settings.welcomePlaceholder')}
                      className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none resize-none transition-colors"
                      style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.settings.gymLogo', 'Gym Logo')}</label>
                    <div className="flex items-center gap-3">
                      {logoUrl ? (
                        <img src={logoUrl} alt={t('admin.settings.gymLogo', 'Gym Logo')} className="w-12 h-12 rounded-xl object-contain p-1" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }} />
                      ) : (
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                          <ImageIcon size={20} className="text-[#6B7280]" />
                        </div>
                      )}
                      <label className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl cursor-pointer transition-colors border border-dashed border-white/10 hover:border-white/20 text-[#6B7280] hover:text-[#9CA3AF]">
                        <Upload size={14} />
                        <span className="text-[12px] font-medium">
                          {uploadingLogo ? t('admin.settings.uploading', 'Uploading...') : logoFile ? logoFile.name : t('admin.settings.uploadLogo', 'Upload logo')}
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="min-w-0">
                      <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.settings.primaryColor', 'Primary Color')}</label>
                      <div className="flex items-center gap-3 min-w-0">
                        <input type="color" value={primaryColor} onChange={e => setPrimary(e.target.value)}
                          className="w-10 h-10 rounded-xl cursor-pointer p-1 flex-shrink-0"
                          style={{ border: '1px solid var(--color-border-subtle)', backgroundColor: 'var(--color-bg-deep)' }} />
                        <input value={primaryColor} onChange={e => setPrimary(e.target.value)}
                          className="flex-1 min-w-0 rounded-xl px-3 py-2 text-[13px] outline-none font-mono transition-colors"
                          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.settings.accentColor', 'Accent Color')}</label>
                      <div className="flex items-center gap-3 min-w-0">
                        <input type="color" value={accentColor} onChange={e => setAccent(e.target.value)}
                          className="w-10 h-10 rounded-xl cursor-pointer p-1 flex-shrink-0"
                          style={{ border: '1px solid var(--color-border-subtle)', backgroundColor: 'var(--color-bg-deep)' }} />
                        <input value={accentColor} onChange={e => setAccent(e.target.value)}
                          className="flex-1 min-w-0 rounded-xl px-3 py-2 text-[13px] outline-none font-mono transition-colors"
                          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                      </div>
                    </div>
                  </div>
                </div>
              </AdminCard>
            </FadeIn>

            {/* Theme & Colors */}
            <FadeIn delay={30} className="xl:col-span-6 min-w-0">
              <AdminCard hover padding="p-5">
                <SectionLabel icon={Palette} className="mb-2">{t('admin.settings.themeColors', 'Theme & Colors')}</SectionLabel>
                <p className="text-[12px] mb-5" style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.settings.themeColorsDesc', 'Choose a predefined palette or create custom colors. Changes preview instantly.')}
                </p>

                {/* Palette Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
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
                        {t('admin.settings.customColors', 'Custom Colors')}
                      </span>
                      {selectedPalette === 'custom' && (
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-bg-base)' }}
                        >
                          {t('admin.settings.active', 'Active')}
                        </span>
                      )}
                    </div>
                    {customExpanded
                      ? <ChevronUp size={14} style={{ color: 'var(--color-text-muted)' }} />
                      : <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
                    }
                  </button>

                  {customExpanded && (
                    <div className="px-4 pb-4 space-y-3 min-w-0">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Primary color */}
                        <div className="min-w-0">
                          <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                            {t('admin.settings.primaryColor', 'Primary Color')}
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
                            <p className="text-[10px] mt-1" style={{ color: 'var(--color-danger)' }}>{t('admin.settings.invalidHex', 'Invalid hex format')}</p>
                          )}
                        </div>

                        {/* Secondary color */}
                        <div>
                          <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                            {t('admin.settings.secondaryColor', 'Secondary Color')}
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
                            <p className="text-[10px] mt-1" style={{ color: 'var(--color-danger)' }}>{t('admin.settings.invalidHex', 'Invalid hex format')}</p>
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
                          {t('admin.settings.previewColors', 'Preview Colors')}
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
                            title={t('admin.settings.autoFixTitle', 'Auto-adjust colors for best harmony and contrast')}
                          >
                            <Wand2 size={12} /> {t('admin.settings.autoFix', 'Auto-fix')}
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
                              {t('admin.settings.colorIssuesDetected', 'Color Issues Detected')}
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
                            <Wand2 size={10} /> {t('admin.settings.fixAutomatically', 'Fix automatically')}
                          </button>
                        </div>
                      )}

                      {/* Contrast scores */}
                      {colorAnalysis && (
                        <div className="flex gap-3 text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>
                          <span>
                            {t('admin.settings.darkContrast', 'Dark contrast')}:{' '}
                            <span style={{ color: colorAnalysis.contrast.primaryOnDark >= 3 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                              {colorAnalysis.contrast.primaryOnDark.toFixed(1)}:1
                            </span>
                          </span>
                          <span>
                            {t('admin.settings.lightContrast', 'Light contrast')}:{' '}
                            <span style={{ color: colorAnalysis.contrast.primaryOnLight >= 3 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                              {colorAnalysis.contrast.primaryOnLight.toFixed(1)}:1
                            </span>
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Reset button */}
                <div className="flex items-center gap-3 mt-5">
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
                    {t('admin.settings.reset', 'Reset')}
                  </button>
                </div>
              </AdminCard>
            </FadeIn>
          </div>

          {/* Save Branding Button */}
          <FadeIn delay={60}>
            <button
              onClick={() => { setError(''); saveBrandingMutation.mutate(); }}
              disabled={saveBrandingMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[14px] transition-all disabled:opacity-50"
              style={{
                backgroundColor: paletteSaved ? 'var(--color-success)' : 'var(--color-accent)',
                color: paletteSaved ? '#fff' : 'var(--color-bg-base)',
              }}
            >
              <Save size={16} />
              {saveBrandingMutation.isPending
                ? t('admin.settings.saving', 'Saving...')
                : paletteSaved
                  ? t('admin.settings.saved', 'Saved!')
                  : t('admin.settings.saveBranding', 'Save Branding')}
            </button>
          </FadeIn>
        </div>
          );
          if (tabKey === TAB_OPERATIONS) return (
        <div className="space-y-4 min-w-0">
          <div className="grid xl:grid-cols-12 gap-4 min-w-0">
            {/* Weekly Digest */}
            <FadeIn delay={0} className="xl:col-span-6 min-w-0 min-w-0">
              <AdminCard hover padding="p-5">
                <SectionLabel icon={Mail} className="mb-4">{t('admin.digest.sectionTitle')}</SectionLabel>

                <div className="space-y-5">
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
                          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
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
                    </>
                  )}
                </div>
              </AdminCard>
            </FadeIn>

            {/* Referral Program */}
            <FadeIn delay={30} className="xl:col-span-6 min-w-0">
              <AdminCard hover padding="p-5">
                <SectionLabel icon={Users} className="mb-4">{t('admin.referral.sectionTitle')}</SectionLabel>

                <div className="space-y-5">
                  {/* Enable toggle */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{t('admin.referral.enableProgram')}</p>
                      <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.referral.enableProgramDesc')}</p>
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
                      <div className="border-t pt-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
                        <RewardConfig
                          reward={referralConfig.referrer_reward}
                          onChange={r => setReferralConfig(c => ({ ...c, referrer_reward: r }))}
                          labelPrefix={t('admin.referral.referrerReward')}
                          t={t}
                        />
                      </div>

                      {/* Referred friend reward */}
                      <div className="border-t pt-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
                        <RewardConfig
                          reward={referralConfig.referred_reward}
                          onChange={r => setReferralConfig(c => ({ ...c, referred_reward: r }))}
                          labelPrefix={t('admin.referral.referredReward')}
                          t={t}
                        />
                      </div>

                      {/* Require approval */}
                      <div className="flex items-center justify-between border-t pt-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
                        <div>
                          <p className="text-[13px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{t('admin.referral.requireApproval')}</p>
                          <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.referral.requireApprovalDesc')}</p>
                        </div>
                        <Toggle
                          checked={referralConfig.require_approval}
                          onChange={v => setReferralConfig(c => ({ ...c, require_approval: v }))}
                          label={t('admin.referral.requireApproval')}
                        />
                      </div>

                      {/* Max per month */}
                      <div className="border-t pt-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
                        <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.referral.maxPerMonth')}</label>
                        <input
                          type="number"
                          min="1"
                          value={referralConfig.max_per_month ?? ''}
                          onChange={e => setReferralConfig(c => ({ ...c, max_per_month: e.target.value ? Number(e.target.value) : null }))}
                          placeholder={t('admin.referral.maxPerMonthPlaceholder')}
                          className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none transition-colors"
                          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                        />
                      </div>

                      {/* Reward choice days */}
                      <div className="border-t pt-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
                        <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                          {t('admin.referral.choiceDays', 'Días para elegir recompensa')}
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={referralConfig.reward_choice_days ?? 7}
                          onChange={e => setReferralConfig(c => ({ ...c, reward_choice_days: e.target.value ? Number(e.target.value) : 7 }))}
                          className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none transition-colors"
                          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                        />
                        <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-faint)' }}>
                          {t('admin.referral.choiceDaysHint', 'El miembro puede elegir su recompensa de referido dentro de este plazo. Después, se asigna la recompensa predeterminada.')}
                        </p>
                      </div>

                      {/* Pick from existing rewards catalog */}
                      {gymRewards.length > 0 && (
                        <div className="border-t pt-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
                          <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                            {t('admin.referral.pickFromCatalog', 'Elegir recompensa del catálogo')}
                          </label>
                          <p className="text-[11px] mb-3" style={{ color: 'var(--color-text-muted)' }}>
                            {t('admin.referral.pickFromCatalogDesc', 'Selecciona una recompensa existente para asignar automáticamente al referidor y/o referido.')}
                          </p>

                          {/* Referrer reward from catalog */}
                          <div className="space-y-3">
                            <div>
                              <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
                                {t('admin.referral.referrerReward', 'Recompensa del Referidor')}
                              </p>
                              <select
                                value={referralConfig.referrer_reward_id ?? ''}
                                onChange={e => setReferralConfig(c => ({ ...c, referrer_reward_id: e.target.value || null }))}
                                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none appearance-none transition-colors"
                                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                              >
                                <option value="">{t('admin.referral.manualReward', 'Recompensa manual (configurada arriba)')}</option>
                                {gymRewards.map(rw => (
                                  <option key={rw.id} value={rw.id}>
                                    {rw.name} — {rw.cost_points.toLocaleString()} pts
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Referred friend reward from catalog */}
                            <div>
                              <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
                                {t('admin.referral.referredReward', 'Recompensa del Amigo Referido')}
                              </p>
                              <select
                                value={referralConfig.referred_reward_id ?? ''}
                                onChange={e => setReferralConfig(c => ({ ...c, referred_reward_id: e.target.value || null }))}
                                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none appearance-none transition-colors"
                                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                              >
                                <option value="">{t('admin.referral.manualReward', 'Recompensa manual (configurada arriba)')}</option>
                                {gymRewards.map(rw => (
                                  <option key={rw.id} value={rw.id}>
                                    {rw.name} — {rw.cost_points.toLocaleString()} pts
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </AdminCard>
            </FadeIn>

            {/* Offers & Promotions */}
            <FadeIn delay={45} className="xl:col-span-12">
              <AdminCard hover padding="p-0">
                <button
                  onClick={() => setOffersOpen(prev => !prev)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}>
                      <Tag size={16} style={{ color: 'var(--color-accent)' }} />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('admin.offers.title')}</p>
                      <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.offers.subtitle')}</p>
                    </div>
                  </div>
                  {offersOpen
                    ? <ChevronUp size={16} style={{ color: 'var(--color-text-muted)' }} />
                    : <ChevronDown size={16} style={{ color: 'var(--color-text-muted)' }} />
                  }
                </button>
                {offersOpen && (
                  <div className="px-5 pb-5 border-t pt-4 space-y-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
                    {/* Add offer button — right-aligned */}
                    <div className="flex justify-end">
                      <button
                        onClick={() => openOfferModal()}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}
                      >
                        <Plus size={14} />
                        {t('admin.offers.addOffer')}
                      </button>
                    </div>

                    {/* Offers list */}
                    {offers.length > 0 ? (
                      <div className="space-y-2">
                        {offers.map((offer, idx) => (
                          <div key={offer.id} className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                            {/* Reorder arrows */}
                            <div className="flex flex-col gap-0.5 flex-shrink-0">
                              <button
                                onClick={() => handleReorderOffer(idx, -1)}
                                disabled={idx === 0}
                                className="p-0.5 rounded transition-colors disabled:opacity-20"
                                style={{ color: 'var(--color-text-muted)' }}
                                aria-label="Move up"
                              >
                                <ArrowUp size={12} />
                              </button>
                              <button
                                onClick={() => handleReorderOffer(idx, 1)}
                                disabled={idx === offers.length - 1}
                                className="p-0.5 rounded transition-colors disabled:opacity-20"
                                style={{ color: 'var(--color-text-muted)' }}
                                aria-label="Move down"
                              >
                                <ArrowDown size={12} />
                              </button>
                            </div>

                            {/* Active toggle */}
                            <Toggle
                              checked={offer.active}
                              onChange={() => handleToggleOfferActive(offer)}
                              label={t('admin.offers.active')}
                            />

                            {/* Cover badge */}
                            {offer.cover_preset ? (
                              <OfferCoverBadge preset={offer.cover_preset} size={36} iconSize={16} />
                            ) : offer.cover_image_url ? (
                              <img src={offer.cover_image_url} alt="" className="w-9 h-9 rounded-xl object-cover flex-shrink-0" />
                            ) : (
                              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-bg-input)', border: '1px solid var(--color-border-subtle)' }}>
                                <Tag size={16} style={{ color: 'var(--color-text-muted)' }} />
                              </div>
                            )}

                            {/* Title + badge */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-[13px] font-semibold truncate" style={{ color: offer.active ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                                  {offer.title}
                                </p>
                                {offer.badge_label && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}>
                                    {offer.badge_label}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                {/* Type badge */}
                                <span
                                  className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                                  style={{
                                    backgroundColor: `color-mix(in srgb, ${OFFER_TYPE_COLORS[offer.type] || '#6B7280'} 12%, transparent)`,
                                    color: OFFER_TYPE_COLORS[offer.type] || '#6B7280',
                                  }}
                                >
                                  {t(`admin.offers.types.${offer.type}`)}
                                </span>
                                {/* Valid dates */}
                                {(offer.valid_from || offer.valid_until) && (
                                  <span className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>
                                    {offer.valid_from && new Date(offer.valid_from + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    {offer.valid_from && offer.valid_until && ' – '}
                                    {offer.valid_until && new Date(offer.valid_until + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    {!offer.valid_until && offer.valid_from && ` – ${t('admin.offers.noExpiry')}`}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Edit / Delete */}
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                onClick={() => openOfferModal(offer)}
                                className="p-2 rounded-lg hover:bg-white/5 transition-colors"
                                style={{ color: 'var(--color-text-muted)' }}
                                aria-label={t('admin.offers.editOffer')}
                              >
                                <Pencil size={14} />
                              </button>
                              {deletingOfferId === offer.id ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleDeleteOffer(offer.id)}
                                    className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
                                  >
                                    {t('common:confirm', 'Confirm')}
                                  </button>
                                  <button
                                    onClick={() => setDeletingOfferId(null)}
                                    className="px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors"
                                    style={{ color: 'var(--color-text-muted)' }}
                                  >
                                    {t('common:cancel', 'Cancel')}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setDeletingOfferId(offer.id)}
                                  className="p-2 rounded-lg hover:bg-red-500/10 transition-colors"
                                  style={{ color: 'var(--color-text-muted)' }}
                                  aria-label={t('admin.offers.deleteConfirm')}
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6">
                        <Tag size={24} className="mx-auto mb-2" style={{ color: 'var(--color-text-faint)' }} />
                        <p className="text-[13px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.offers.noOffers')}</p>
                        <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>{t('admin.offers.noOffersHint')}</p>
                      </div>
                    )}
                  </div>
                )}
              </AdminCard>
            </FadeIn>

            {/* Offer Add/Edit Modal */}
            <AdminModal
              isOpen={offerModalOpen}
              onClose={() => setOfferModalOpen(false)}
              title={editingOffer ? t('admin.offers.editOffer') : t('admin.offers.addOffer')}
              titleIcon={Tag}
              size="sm"
              footer={
                <>
                  <button
                    onClick={() => setOfferModalOpen(false)}
                    className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
                    style={{ backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
                  >
                    {t('common:cancel', 'Cancel')}
                  </button>
                  <button
                    onClick={handleSaveOffer}
                    disabled={offerSaving || !offerForm.title.trim()}
                    className="flex-1 py-2.5 rounded-xl text-[13px] font-bold transition-all disabled:opacity-50"
                    style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-bg-base)' }}
                  >
                    {offerSaving ? t('admin.settings.saving', 'Saving...') : (editingOffer ? t('admin.offers.editOffer') : t('admin.offers.addOffer'))}
                  </button>
                </>
              }
            >
              <div className="space-y-4">
                {/* Cover Image */}
                <div>
                  <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.offers.coverImage', 'Imagen de portada')}
                  </label>
                  <div className="grid grid-cols-4 gap-2 mb-2">
                    {OFFER_COVERS.map(c => {
                      const Icon = c.icon;
                      const selected = offerForm.cover_preset === c.key;
                      return (
                        <button key={c.key} type="button"
                          onClick={() => setOfferForm(prev => ({ ...prev, cover_preset: selected ? '' : c.key, cover_image_url: '' }))}
                          className={`rounded-xl p-2.5 flex flex-col items-center gap-1 transition-all ${selected ? 'ring-2 ring-white scale-[1.03]' : 'opacity-70 hover:opacity-100'}`}
                          style={{ background: c.gradient }}>
                          <Icon size={20} className="text-white/90" />
                          <span className="text-[8px] font-bold text-white/80 uppercase tracking-wide">{c.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  {/* Upload own image */}
                  <div className="flex items-center gap-2 pt-2" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                    <Upload size={14} style={{ color: 'var(--color-text-muted)' }} />
                    <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {t('admin.offers.orUploadImage', 'O sube tu propia imagen:')}
                    </span>
                    <input
                      type="url"
                      value={offerForm.cover_image_url}
                      onChange={e => setOfferForm(prev => ({ ...prev, cover_image_url: e.target.value, cover_preset: '' }))}
                      placeholder="https://..."
                      className="flex-1 rounded-lg px-2.5 py-1 text-[11px] outline-none"
                      style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                    />
                  </div>
                </div>

                {/* Title */}
                <div>
                  <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.offers.offerTitle')} *</label>
                  <input
                    type="text"
                    value={offerForm.title}
                    onChange={e => setOfferForm(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                    style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                    placeholder={t('admin.offers.offerTitle')}
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.offers.offerDescription')}</label>
                  <textarea
                    value={offerForm.description}
                    onChange={e => setOfferForm(prev => ({ ...prev, description: e.target.value }))}
                    rows={3}
                    className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none resize-none focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                    style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                    placeholder={t('admin.offers.offerDescription')}
                  />
                </div>

                {/* Type + Badge Label row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.offers.offerType')}</label>
                    <select
                      value={offerForm.type}
                      onChange={e => setOfferForm(prev => ({ ...prev, type: e.target.value }))}
                      className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none appearance-none"
                      style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                    >
                      {OFFER_TYPES.map(ot => (
                        <option key={ot} value={ot}>{t(`admin.offers.types.${ot}`)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.offers.badgeLabel')}</label>
                    <input
                      type="text"
                      value={offerForm.badge_label}
                      onChange={e => setOfferForm(prev => ({ ...prev, badge_label: e.target.value }))}
                      className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                      style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                      placeholder="e.g. 50% OFF"
                    />
                  </div>
                </div>

                {/* Valid dates row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.offers.validFrom')}</label>
                    <input
                      type="date"
                      value={offerForm.valid_from}
                      onChange={e => setOfferForm(prev => ({ ...prev, valid_from: e.target.value }))}
                      className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                      style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.offers.validUntil')}</label>
                    <input
                      type="date"
                      value={offerForm.valid_until}
                      onChange={e => setOfferForm(prev => ({ ...prev, valid_until: e.target.value }))}
                      className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                      style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                    />
                  </div>
                </div>

                {/* Active toggle */}
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{t('admin.offers.active')}</p>
                  <Toggle
                    checked={offerForm.active}
                    onChange={v => setOfferForm(prev => ({ ...prev, active: v }))}
                    label={t('admin.offers.active')}
                  />
                </div>

                {/* Auto-translate */}
                <div className="border-t pt-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                      <Globe size={12} className="inline mr-1" style={{ verticalAlign: '-2px' }} />
                      {t('common:spanish', 'Spanish')}
                    </p>
                    <button
                      onClick={handleAutoTranslateOffer}
                      disabled={translating || (!offerForm.title.trim() && !offerForm.description.trim())}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-40"
                      style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)' }}
                    >
                      <Wand2 size={12} />
                      {translating ? t('common:translating', 'Translating...') : t('common:autoTranslate', 'Auto-translate')}
                    </button>
                  </div>
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={offerForm.title_es}
                      onChange={e => setOfferForm(prev => ({ ...prev, title_es: e.target.value }))}
                      className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                      style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                      placeholder={`${t('admin.offers.offerTitle')} (ES)`}
                    />
                    <textarea
                      value={offerForm.description_es}
                      onChange={e => setOfferForm(prev => ({ ...prev, description_es: e.target.value }))}
                      rows={2}
                      className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none resize-none focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                      style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                      placeholder={`${t('admin.offers.offerDescription')} (ES)`}
                    />
                  </div>
                </div>
              </div>
            </AdminModal>

            {/* Notification Preferences */}
            <FadeIn delay={60} className="xl:col-span-12">
              <AdminCard hover padding="p-0">
                <button
                  onClick={() => setNotifPrefsOpen(prev => !prev)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}>
                      <Bell size={16} style={{ color: 'var(--color-accent)' }} />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('admin.notificationPrefs.sectionTitle')}</p>
                      <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.notificationPrefs.sectionSubtitle')}</p>
                    </div>
                  </div>
                  {notifPrefsOpen
                    ? <ChevronUp size={16} style={{ color: 'var(--color-text-muted)' }} />
                    : <ChevronDown size={16} style={{ color: 'var(--color-text-muted)' }} />
                  }
                </button>
                {notifPrefsOpen && (
                  <div className="px-5 pb-5 border-t pt-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
                    <Suspense fallback={<CardSkeleton />}>
                      <AdminNotificationPrefs />
                    </Suspense>
                  </div>
                )}
              </AdminCard>
            </FadeIn>
          </div>

          {/* Save Operations Button */}
          <FadeIn delay={90}>
            <button
              onClick={() => { setError(''); saveOperationsMutation.mutate(); }}
              disabled={saveOperationsMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[14px] transition-all disabled:opacity-50"
              style={{
                backgroundColor: saveOperationsMutation.isSuccess ? 'var(--color-success)' : 'var(--color-accent)',
                color: saveOperationsMutation.isSuccess ? '#fff' : 'var(--color-bg-base)',
              }}
            >
              <Save size={16} />
              {saveOperationsMutation.isPending
                ? t('admin.settings.saving', 'Saving...')
                : saveOperationsMutation.isSuccess
                  ? t('admin.settings.saved', 'Saved!')
                  : t('admin.settings.saveOperations', 'Save Operations Settings')}
            </button>
          </FadeIn>
        </div>
          );
          return null;
        }}
      </SwipeableTabContent>
    </AdminPageShell>
  );
}

