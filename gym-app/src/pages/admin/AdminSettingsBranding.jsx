/**
 * AdminSettingsBranding: gym branding — welcome message, logo, primary/accent
 * colors, palette picker, and custom-color overrides. Self-contained query +
 * save mutation + live preview. Restyled onto settingsKit.
 */
import { useEffect, useState } from 'react';
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
import { FadeIn, CardSkeleton, AdminPageShell } from '../../components/admin';
import { TK, FK, Ico, Card, DIC, SettingsHeader, CardHd, Fld, Help, TextField, SaveBar, fieldStyle } from './components/settingsKit';

const LOGO_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 7;

const BIC = {
  img: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-4.5-4.5L7 20" /></>,
  wand: <><path d="M15 4V2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5" /></>,
  alert: <><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>,
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function resolveColorToHex(value, fallbackVar, fallbackHex) {
  if (typeof value === 'string' && HEX_RE.test(value.trim())) return value.trim();
  try {
    const source = (typeof value === 'string' && value.includes('var(')) ? value : fallbackVar;
    const m = source.match(/var\(\s*(--[a-zA-Z0-9-]+)\s*\)/);
    if (m && typeof document !== 'undefined') {
      const resolved = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
      if (HEX_RE.test(resolved)) return resolved;
      const rgb = resolved.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
      if (rgb) return '#' + [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    }
  } catch { /* fall through */ }
  return fallbackHex;
}

async function compressImage(file, maxSize = 512, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > height) { if (width > maxSize) { height = Math.round((height * maxSize) / width); width = maxSize; } }
      else if (height > maxSize) { width = Math.round((width * maxSize) / height); height = maxSize; }
      canvas.width = width; canvas.height = height;
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
  const { data, error } = await supabase.storage.from('gym-logos').createSignedUrl(path, LOGO_URL_EXPIRY_SECONDS);
  if (error || !data?.signedUrl) { logger.warn('Failed to create signed URL for logo', error); return ''; }
  return data.signedUrl;
}

const isValidHex = (hex) => /^#[0-9A-Fa-f]{6}$/.test(hex);

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
      setPrimary(resolveColorToHex(branding.primary_color, 'var(--color-accent)', '#D4AF37'));
      setAccent(resolveColorToHex(branding.accent_color, 'var(--color-success)', '#10B981'));
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
    if (!validation.valid) { setError(validation.error); showToast(validation.error, 'error'); return; }
    setUploadingLogo(true);
    try {
      const compressed = await compressImage(file);
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${gymId}/logo.${ext}`;
      const { error: storageErr } = await supabase.storage.from('gym-logos').upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });
      if (storageErr) { setError(`${t('admin.settings.logoUploadFailed', 'Logo upload failed')}: ${storageErr.message}`); setUploadingLogo(false); return; }
      const signedUrl = await getSignedLogoUrl(path);
      setLogoUrl(signedUrl);
      setLogoFile(null);
      const { error: dbErr } = await supabase.from('gym_branding').upsert({ gym_id: gymId, logo_url: path }, { onConflict: 'gym_id' });
      if (dbErr) throw dbErr;
    } catch (err) {
      setError(err.message || t('admin.settings.logoUploadFailed', 'Logo upload failed'));
    }
    setUploadingLogo(false);
  };

  const saveBrandingMutation = useMutation({
    mutationFn: async () => {
      const primaryHex = resolveColorToHex(primaryColor, 'var(--color-accent)', '#D4AF37');
      const accentHex = resolveColorToHex(accentColor, 'var(--color-success)', '#10B981');
      const { error: brandingErr } = await supabase.from('gym_branding').upsert({
        gym_id: gymId,
        primary_color: primaryHex,
        accent_color: accentHex,
        welcome_message: welcomeMsg,
        palette_name: selectedPalette || DEFAULT_PALETTE,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'gym_id' });
      if (brandingErr) throw brandingErr;
      logAdminAction('update_settings', 'gym', gymId);
      setPrimary(primaryHex);
      setAccent(accentHex);
      applyBranding({ primaryColor: primaryHex, secondaryColor: accentHex });
    },
    onSuccess: () => {
      posthog?.capture('admin_branding_updated');
      queryClient.invalidateQueries({ queryKey: adminKeys.settings(gymId) });
      refreshProfile();
      setPaletteSaved(true);
      setTimeout(() => setPaletteSaved(false), 2500);
      showToast(t('admin.settings.brandingSaved', 'Branding saved'), 'success');
    },
    onError: (err) => { setError(err.message); showToast(err.message, 'error'); },
  });

  const handleSelectPalette = (paletteId) => {
    const palette = getPalette(paletteId);
    setSelectedPalette(paletteId);
    setCustomExpanded(false);
    applyBranding({ primaryColor: palette.primary, secondaryColor: palette.secondary });
    setPrimary(palette.primary);
    setAccent(palette.secondary);
  };

  const handleApplyCustomColors = () => {
    if (isValidHex(customPrimary) && isValidHex(customSecondary)) {
      setColorAnalysis(analyzeColorPair(customPrimary, customSecondary));
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
    setColorAnalysis(analyzeColorPair(fixed.primary, fixed.secondary));
    if (fixed.wasAdjusted) showToast(t('admin.settings.colorsAutoAdjusted', 'Colors auto-adjusted for better harmony'), 'success');
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
      <AdminPageShell>
        <Card style={{ padding: '40px 20px', textAlign: 'center' }}>
          <p style={{ fontFamily: FK.body, fontSize: 14, color: 'var(--color-danger)' }}>{t('admin.overview.accessDenied', 'Access denied. You are not authorized to view this page.')}</p>
        </Card>
      </AdminPageShell>
    );
  }

  if (isLoading) return (
    <AdminPageShell className="space-y-4">
      <CardSkeleton h="h-[60px]" />
      <CardSkeleton h="h-[280px]" />
    </AdminPageShell>
  );

  const swatch = { width: 42, height: 42, borderRadius: 10, padding: 2, border: `1px solid ${TK.borderSolid}`, background: TK.surface2, cursor: 'pointer', flexShrink: 0 };

  return (
    <AdminPageShell>
      <SettingsHeader t={t} title={t('admin.settings.tabBranding', 'Branding')} sub={t('admin.settingsHub.brandingDesc', 'Logo, welcome message, palette')} />

      {error && <p style={{ fontFamily: FK.body, fontSize: 13, color: 'var(--color-danger)', margin: '14px 0 0' }}>{error}</p>}

      <div style={{ marginTop: 22 }}>
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.25fr] gap-[18px] items-start">
          {/* ── Marca: welcome + logo + colors ── */}
          <FadeIn delay={0} className="min-w-0">
            <Card style={{ padding: '22px 24px' }}>
              <CardHd icon={DIC.palette}>{t('admin.settings.branding', 'Branding')}</CardHd>

              <Fld>{t('admin.settings.welcomeMessage', 'Welcome Message')}</Fld>
              <textarea value={welcomeMsg} onChange={e => setWelcome(e.target.value)} rows={2} placeholder={t('admin.settings.welcomePlaceholder')}
                onFocus={e => { e.target.style.borderColor = TK.accent; }} onBlur={e => { e.target.style.borderColor = 'var(--color-admin-border)'; }}
                style={{ ...fieldStyle, resize: 'none', minHeight: 58, lineHeight: 1.45 }} />

              <Fld>{t('admin.settings.gymLogo', 'Gym Logo')}</Fld>
              <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
                {logoUrl ? (
                  <img src={logoUrl} alt={t('admin.settings.gymLogo', 'Gym Logo')} style={{ width: 54, height: 54, borderRadius: 13, objectFit: 'contain', padding: 4, flexShrink: 0, background: TK.surface2, border: `1px solid ${TK.borderSolid}` }} />
                ) : (
                  <span style={{ width: 54, height: 54, borderRadius: 13, flexShrink: 0, display: 'grid', placeItems: 'center', background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}><Ico ch={BIC.img} size={20} color={TK.textMute} stroke={1.9} /></span>
                )}
                <label style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 12, border: `1.5px dashed ${TK.borderSolid}`, background: TK.surface2, fontFamily: FK.body, fontSize: 14, fontWeight: 600, color: TK.textMute, cursor: uploadingLogo ? 'default' : 'pointer' }}>
                  <Ico ch={DIC.upload} size={16} color={TK.textMute} stroke={2} />
                  {uploadingLogo ? t('admin.settings.uploading', 'Uploading...') : logoFile ? logoFile.name : t('admin.settings.uploadLogo', 'Upload logo')}
                  <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} disabled={uploadingLogo}
                    onChange={e => { const f = e.target.files?.[0]; if (f) { setLogoFile(f); handleLogoUpload(f); } }} />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 4 }}>
                <div>
                  <Fld>{t('admin.settings.primaryColor', 'Primary Color')}</Fld>
                  <div style={{ display: 'flex', gap: 9 }}>
                    <input type="color" value={isValidHex(primaryColor) ? primaryColor : '#333333'} onChange={e => setPrimary(e.target.value)} style={swatch} />
                    <TextField value={primaryColor} onChange={e => setPrimary(e.target.value)} mono />
                  </div>
                </div>
                <div>
                  <Fld>{t('admin.settings.accentColor', 'Accent Color')}</Fld>
                  <div style={{ display: 'flex', gap: 9 }}>
                    <input type="color" value={isValidHex(accentColor) ? accentColor : '#333333'} onChange={e => setAccent(e.target.value)} style={swatch} />
                    <TextField value={accentColor} onChange={e => setAccent(e.target.value)} mono />
                  </div>
                </div>
              </div>
            </Card>
          </FadeIn>

          {/* ── Tema y colores: palette grid + custom ── */}
          <FadeIn delay={30} className="min-w-0">
            <Card id="theme" style={{ padding: '22px 24px' }}>
              <CardHd icon={DIC.palette}>{t('admin.settings.themeColors', 'Theme & Colors')}</CardHd>
              <Help>{t('admin.settings.themeColorsDesc', 'Choose a predefined palette or create custom colors. Changes preview instantly.')}</Help>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5" style={{ marginTop: 16 }}>
                {getAllPalettes().map((palette) => {
                  const isActive = selectedPalette === palette.id;
                  return (
                    <button key={palette.id} type="button" onClick={() => handleSelectPalette(palette.id)} style={{ position: 'relative', textAlign: 'left', borderRadius: 14, padding: '16px 18px', cursor: 'pointer', background: isActive ? TK.accentWash : TK.surface2, border: `1.5px solid ${isActive ? palette.primary : TK.borderSolid}`, boxShadow: isActive ? `0 0 18px ${palette.primary}22` : 'none' }}>
                      {isActive && (
                        <span style={{ position: 'absolute', top: -9, right: -9, width: 24, height: 24, borderRadius: 99, display: 'grid', placeItems: 'center', background: palette.primary, boxShadow: '0 2px 6px rgba(0,0,0,.2)' }}><Ico ch={DIC.check} size={14} color="#fff" stroke={3} /></span>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginBottom: 11 }}>
                        {[palette.primary, palette.secondary, palette.preview?.dark || '#0B0F1A'].map((c, i) => (
                          <span key={i} style={{ width: 26, height: 26, borderRadius: 99, background: c, border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,.15)' }} />
                        ))}
                      </div>
                      <div style={{ fontFamily: FK.display, fontSize: 15.5, fontWeight: 800, letterSpacing: -0.3, color: isActive ? palette.primary : TK.text }}>{t(`admin.settings.palettes.${palette.id}.name`, palette.name)}</div>
                      <div style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textMute, marginTop: 3, lineHeight: 1.4 }}>{t(`admin.settings.palettes.${palette.id}.description`, palette.description)}</div>
                    </button>
                  );
                })}
              </div>

              {/* custom colors (collapsible) */}
              <div style={{ borderRadius: 14, marginTop: 14, background: TK.surface2, border: `1px solid ${selectedPalette === 'custom' ? TK.accent : TK.borderSolid}` }}>
                <button type="button" onClick={() => setCustomExpanded(e => !e)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', cursor: 'pointer', background: 'transparent', border: 'none' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontFamily: FK.body, fontSize: 14, fontWeight: 700, color: TK.text }}>
                    <Ico ch={DIC.palette} size={16} color={TK.textSub} stroke={2} />{t('admin.settings.customColors', 'Custom Colors')}
                    {selectedPalette === 'custom' && <span style={{ fontFamily: FK.body, fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 999, background: TK.accentSoft, color: TK.accentInk }}>{t('admin.settings.active', 'Active')}</span>}
                  </span>
                  <Ico ch={customExpanded ? DIC.chevU : DIC.chevD} size={16} color={TK.textMute} stroke={2.2} />
                </button>

                {customExpanded && (
                  <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      {[['primaryColor', customPrimary, setCustomPrimary], ['secondaryColor', customSecondary, setCustomSecondary]].map(([labelKey, val, setVal]) => (
                        <div key={labelKey} style={{ minWidth: 0 }}>
                          <Fld style={{ margin: '0 0 8px' }}>{t(`admin.settings.${labelKey}`)}</Fld>
                          <div style={{ display: 'flex', gap: 9 }}>
                            <input type="color" value={isValidHex(val) ? val : '#333333'} onChange={e => setVal(e.target.value)} style={swatch} />
                            <TextField value={val} onChange={e => setVal(e.target.value)} placeholder="#10B981" maxLength={7} mono style={{ borderColor: val && !isValidHex(val) ? 'var(--color-danger)' : undefined }} />
                          </div>
                          {val && !isValidHex(val) && <p style={{ fontFamily: FK.body, fontSize: 10.5, marginTop: 4, color: 'var(--color-danger)' }}>{t('admin.settings.invalidHex', 'Invalid hex format')}</p>}
                        </div>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: 10 }}>
                      <button type="button" onClick={handleApplyCustomColors} disabled={!isValidHex(customPrimary) || !isValidHex(customSecondary)} style={{ flex: 1, padding: '11px 0', borderRadius: 11, cursor: 'pointer', border: 'none', background: TK.accent, color: '#fff', fontFamily: FK.body, fontSize: 13, fontWeight: 700, opacity: (!isValidHex(customPrimary) || !isValidHex(customSecondary)) ? 0.4 : 1 }}>
                        {t('admin.settings.previewColors', 'Preview Colors')}
                      </button>
                      {isValidHex(customPrimary) && (
                        <button type="button" onClick={handleAutoFix} title={t('admin.settings.autoFixTitle', 'Auto-adjust colors for best harmony and contrast')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '11px 14px', borderRadius: 11, cursor: 'pointer', background: TK.accentWash, border: `1px solid ${TK.accentLine}`, color: TK.accent, fontFamily: FK.body, fontSize: 13, fontWeight: 700 }}>
                          <Ico ch={BIC.wand} size={13} color={TK.accent} stroke={2} />{t('admin.settings.autoFix', 'Auto-fix')}
                        </button>
                      )}
                    </div>

                    {colorAnalysis && !colorAnalysis.ok && (
                      <div style={{ borderRadius: 11, padding: 12, background: 'var(--color-warning-soft)', border: '1px solid color-mix(in srgb, var(--color-warning) 22%, transparent)', display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: FK.body, fontSize: 11.5, fontWeight: 800, color: 'var(--color-warning-ink, var(--color-warning))' }}>
                          <Ico ch={BIC.alert} size={13} color="var(--color-warning)" stroke={2} />{t('admin.settings.colorIssuesDetected', 'Color Issues Detected')}
                        </span>
                        {colorAnalysis.warnings.map((w, i) => <p key={i} style={{ margin: 0, fontFamily: FK.body, fontSize: 11.5, paddingLeft: 20, color: TK.textMute }}>{w.message}</p>)}
                      </div>
                    )}

                    {colorAnalysis && (
                      <div style={{ display: 'flex', gap: 14, fontFamily: FK.body, fontSize: 10.5, color: TK.textFaint }}>
                        <span>{t('admin.settings.darkContrast', 'Dark contrast')}: <b style={{ color: colorAnalysis.contrast.primaryOnDark >= 3 ? 'var(--color-success)' : 'var(--color-danger)' }}>{colorAnalysis.contrast.primaryOnDark.toFixed(1)}:1</b></span>
                        <span>{t('admin.settings.lightContrast', 'Light contrast')}: <b style={{ color: colorAnalysis.contrast.primaryOnLight >= 3 ? 'var(--color-success)' : 'var(--color-danger)' }}>{colorAnalysis.contrast.primaryOnLight.toFixed(1)}:1</b></span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 16, cursor: 'pointer', fontFamily: FK.body, fontSize: 13.5, fontWeight: 600, color: TK.textMute }} onClick={handleResetPalette}>
                <Ico ch={DIC.reset} size={15} color={TK.textMute} stroke={2} />{t('admin.settings.reset', 'Reset')}
              </div>
            </Card>
          </FadeIn>
        </div>

        <FadeIn delay={60}>
          <SaveBar
            onClick={() => { setError(''); saveBrandingMutation.mutate(); }}
            saving={saveBrandingMutation.isPending}
            saved={paletteSaved}
            label={t('admin.settings.saveBranding', 'Save Branding')}
            savingLabel={t('admin.settings.saving', 'Saving...')}
            savedLabel={t('admin.settings.saved', 'Saved!')}
          />
        </FadeIn>
      </div>
    </AdminPageShell>
  );
}
