/**
 * AdminSettingsBranding: standalone sub-page that owns gym branding —
 * welcome message, logo, primary/accent colors, palette picker, and
 * custom-color overrides. Self-contained query + save mutation.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Save, Upload, Image as ImageIcon, ChevronDown, ChevronUp,
  Palette, Check, RotateCcw, AlertTriangle, Wand2, ArrowLeft,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import posthog from 'posthog-js';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { applyBranding } from '../../lib/branding';
import { getAllPalettes, getPalette, DEFAULT_PALETTE } from '../../lib/palettes';
import { analyzeColorPair, autoHarmonize } from '../../lib/themeGenerator';
import { validateImageFile } from '../../lib/validateImage';
import { adminKeys } from '../../lib/adminQueryKeys';
import { PageHeader, AdminCard, SectionLabel, FadeIn, CardSkeleton, AdminPageShell } from '../../components/admin';

const LOGO_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 7;

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
      canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = URL.createObjectURL(file);
  });
}

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

export default function AdminSettingsBranding() {
  const { profile, refreshProfile, availableRoles } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation('pages');
  const gymId = profile?.gym_id;
  const isAuthorized = profile && availableRoles.some(r => r === 'admin' || r === 'super_admin') && !!gymId;

  const [error, setError] = useState('');
  const [primaryColor, setPrimary] = useState('var(--color-accent)');
  const [accentColor, setAccent] = useState('var(--color-accent)');
  const [welcomeMsg, setWelcome] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [selectedPalette, setSelectedPalette] = useState(null);
  const [customPrimary, setCustomPrimary] = useState('');
  const [customSecondary, setCustomSecondary] = useState('');
  const [customExpanded, setCustomExpanded] = useState(false);
  const [colorAnalysis, setColorAnalysis] = useState(null);
  const [paletteSaved, setPaletteSaved] = useState(false);

  useEffect(() => { document.title = `${t('admin.settings.tabBranding', 'Branding')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  const { data: brandingData, isLoading } = useQuery({
    queryKey: [...adminKeys.settings(gymId), 'branding'],
    queryFn: async () => {
      const { data, error: brandErr } = await supabase
        .from('gym_branding')
        .select('primary_color, accent_color, welcome_message, logo_url, palette_name')
        .eq('gym_id', gymId)
        .maybeSingle();
      if (brandErr) logger.warn('Failed to load branding settings', brandErr);
      let signedLogoUrl = '';
      if (data?.logo_url) signedLogoUrl = await getSignedLogoUrl(data.logo_url);
      return { branding: data, signedLogoUrl };
    },
    enabled: !!gymId,
  });

  useEffect(() => {
    if (!brandingData) return;
    const { branding, signedLogoUrl } = brandingData;
    if (branding) {
      setPrimary(branding.primary_color ?? 'var(--color-accent)');
      setAccent(branding.accent_color ?? 'var(--color-success)');
      setWelcome(branding.welcome_message ?? '');
      const paletteName = branding.palette_name || null;
      setSelectedPalette(paletteName);
      if (paletteName === 'custom') {
        setCustomPrimary(branding.primary_color ?? '');
        setCustomSecondary(branding.accent_color ?? '');
        setCustomExpanded(true);
      }
    }
    setLogoUrl(signedLogoUrl);
  }, [brandingData]);

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
      const { error: dbErr } = await supabase
        .from('gym_branding')
        .upsert({ gym_id: gymId, logo_url: path }, { onConflict: 'gym_id' });
      if (dbErr) throw dbErr;
    } catch (err) {
      setError(err.message || t('admin.settings.logoUploadFailed', 'Logo upload failed'));
    }
    setUploadingLogo(false);
  };

  const saveBrandingMutation = useMutation({
    mutationFn: async () => {
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

  const handleSelectPalette = (paletteId) => {
    const palette = getPalette(paletteId);
    setSelectedPalette(paletteId);
    setCustomExpanded(false);
    applyBranding({ primaryColor: palette.primary, secondaryColor: palette.secondary });
    setPrimary(palette.primary);
    setAccent(palette.secondary);
  };

  const isValidHex = (hex) => /^#[0-9A-Fa-f]{6}$/.test(hex);

  const handleApplyCustomColors = () => {
    if (isValidHex(customPrimary) && isValidHex(customSecondary)) {
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

  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[14px] font-semibold" style={{ color: 'var(--color-danger, #EF4444)' }}>
          {t('admin.overview.accessDenied', 'Access denied. You are not authorized to view this page.')}
        </p>
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

  const backLink = (
    <Link
      to="/admin/settings"
      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold transition-colors"
      style={{
        backgroundColor: 'var(--color-bg-deep)',
        border: '1px solid var(--color-border-subtle)',
        color: 'var(--color-text-muted)',
      }}
    >
      <ArrowLeft size={14} />
      {t('admin.settings.title', 'Settings')}
    </Link>
  );

  return (
    <AdminPageShell>
      <PageHeader
        title={t('admin.settings.tabBranding', 'Branding')}
        subtitle={t('admin.settingsHub.brandingDesc', 'Logo, welcome message, palette')}
        actions={backLink}
        className="mb-4"
      />

      {error && <p className="text-[13px] text-red-400 mb-4">{error}</p>}

      <div className="space-y-4 min-w-0">
        <div className="grid xl:grid-cols-12 gap-4 min-w-0">
          {/* Logo & Welcome */}
          <FadeIn delay={0} className="xl:col-span-6 min-w-0">
            <AdminCard hover padding="p-4 sm:p-5">
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
                        <ImageIcon size={20} style={{ color: 'var(--color-text-muted)' }} />
                      </div>
                    )}
                    <label
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl cursor-pointer transition-colors"
                      style={{ border: '1px dashed var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
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
            <div id="theme" />
            <AdminCard hover padding="p-4 sm:p-5">
              <SectionLabel icon={Palette} className="mb-2">{t('admin.settings.themeColors', 'Theme & Colors')}</SectionLabel>
              <p className="text-[12px] mb-5" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.settings.themeColorsDesc', 'Choose a predefined palette or create custom colors. Changes preview instantly.')}
              </p>

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
                      {isActive && (
                        <div
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center shadow-lg"
                          style={{ backgroundColor: palette.primary }}
                        >
                          <Check size={11} className="text-[var(--color-text-on-accent)]" strokeWidth={3} />
                        </div>
                      )}

                      <div className="flex items-center gap-2 mb-2.5">
                        <span className="w-6 h-6 rounded-full border border-white/10 flex-shrink-0" style={{ backgroundColor: palette.primary }} />
                        <span className="w-6 h-6 rounded-full border border-white/10 flex-shrink-0" style={{ backgroundColor: palette.secondary }} />
                        <span className="w-6 h-6 rounded-full border border-white/10 flex-shrink-0" style={{ backgroundColor: palette.preview?.dark || '#0B0F1A' }} />
                      </div>

                      <p className="text-[13px] font-bold truncate" style={{ color: isActive ? palette.primary : 'var(--color-text-primary)' }}>
                        {t(`admin.settings.palettes.${palette.id}.name`, palette.name)}
                      </p>
                      <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>
                        {t(`admin.settings.palettes.${palette.id}.description`, palette.description)}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Custom Colors */}
              <div
                className="rounded-[14px] border transition-all"
                style={{
                  backgroundColor: 'var(--color-bg-deep)',
                  borderColor: selectedPalette === 'custom' ? 'var(--color-accent)' : 'var(--color-border-subtle)',
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
                            style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-bg-deep)' }}
                          />
                          <input
                            type="text"
                            value={customPrimary}
                            onChange={e => setCustomPrimary(e.target.value)}
                            placeholder="var(--color-danger)"
                            maxLength={7}
                            className="flex-1 bg-transparent border rounded-lg px-2.5 py-1.5 text-[12px] font-mono outline-none transition-colors"
                            style={{
                              color: 'var(--color-text-primary)',
                              borderColor: customPrimary && !isValidHex(customPrimary) ? 'var(--color-danger)' : 'var(--color-border-subtle)',
                            }}
                          />
                        </div>
                        {customPrimary && !isValidHex(customPrimary) && (
                          <p className="text-[10px] mt-1" style={{ color: 'var(--color-danger)' }}>{t('admin.settings.invalidHex', 'Invalid hex format')}</p>
                        )}
                      </div>

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
                            style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-bg-deep)' }}
                          />
                          <input
                            type="text"
                            value={customSecondary}
                            onChange={e => setCustomSecondary(e.target.value)}
                            placeholder="var(--color-success)"
                            maxLength={7}
                            className="flex-1 bg-transparent border rounded-lg px-2.5 py-1.5 text-[12px] font-mono outline-none transition-colors"
                            style={{
                              color: 'var(--color-text-primary)',
                              borderColor: customSecondary && !isValidHex(customSecondary) ? 'var(--color-danger)' : 'var(--color-border-subtle)',
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
    </AdminPageShell>
  );
}
