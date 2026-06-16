import { useEffect, useMemo, useState } from 'react';
import {
  Settings, Palette, QrCode, CalendarDays, Smartphone, Link2,
  ShieldOff, AlertTriangle, Crown, ToggleRight, CreditCard, Upload,
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { logAdminAction } from '../../../lib/adminAudit';
import { validateImageFile } from '../../../lib/validateImage';
import RoleBadge from './RoleBadge';

// A7: strict hex validation — deliberately NO var(--…) resolution here (the
// admin page's resolveColorToHex resolves against the CURRENT document's CSS
// vars, which on the platform tier would poison the gym's colors with
// platform gold — the exact data bug this editor exists to repair).
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const asValidHex = (v) => (typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim() : '');

// A gym owner administers the gym, so the owner picker offers ADMINS only
// (admin / super_admin, by primary role OR additional_roles) — not every member.
// This also keeps the picked id a real auth user, which the
// gyms.owner_user_id → auth.users FK requires (a ghost/imported profile fails).
const isAdminish = (m) =>
  m.role === 'admin' || m.role === 'super_admin' ||
  (m.additional_roles ?? []).some(r => r === 'admin' || r === 'super_admin');

// Per-gym feature entitlements (0586). classes + qr keep their dedicated cards
// (they're gym-row flags), so the Features card manages the rest. A missing row
// means enabled (default on); only an explicit `false` disables for this gym,
// and the global Operations kill switches still override (off everywhere wins).
const ENTITLEMENT_FEATURES = ['referrals', 'social', 'messaging', 'challenges', 'nutrition', 'ai'];
const FEATURE_FALLBACK = {
  referrals: 'Referrals', social: 'Social feed', messaging: 'Messaging',
  challenges: 'Challenges', nutrition: 'Nutrition', ai: 'AI photo analysis',
};

// Logo compression — same 512px / JPEG approach as the admin branding editor so
// platform-uploaded logos match member-uploaded ones.
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

export default function GymSettingsTab({
  gym,
  branding,
  logoUrl,
  invites,
  editingGym,
  setEditingGym,
  savingGym,
  saveGymSettings,
  settingsError,
  gymStatus,
  setLifecycleModal,
  members = [],
  setGymOwner,
  notify,
  onBrandingSaved,
  t,
}) {
  // Owner candidates: the gym's ADMINS only (see isAdminish), non-archived.
  // Each option still shows the person's role for clarity. If the owner needs to
  // be someone who isn't an admin yet, promote them on the Members tab first.
  const ownerCandidates = useMemo(
    () => members
      .filter(m => m.imported_archived !== true && isAdminish(m))
      .slice()
      .sort((a, b) => (a.full_name || a.username || '').localeCompare(b.full_name || b.username || '')),
    [members]
  );
  // Human-readable role label for an owner-candidate option.
  const roleLabel = (m) => {
    const r = m.role === 'super_admin' || (m.additional_roles ?? []).includes('super_admin')
      ? 'super_admin'
      : (m.role || 'member');
    return t(`platform.gymDetail.roles.${r}`, r);
  };
  const [ownerDraft, setOwnerDraft] = useState(undefined); // undefined = untouched
  const ownerValue = ownerDraft !== undefined ? ownerDraft : (gym.owner_user_id ?? '');
  const ownerDirty = ownerDraft !== undefined && ownerDraft !== (gym.owner_user_id ?? '');
  const currentOwner = members.find(m => m.id === gym.owner_user_id);

  // ── A7: platform branding editor (gym_branding.primary_color /
  //    accent_color — the columns applyBranding consumes; write arm: 0551).
  //    An invalid stored value (e.g. the literal 'var(--color-accent)')
  //    loads as empty so saving overwrites it with a real hex. Same
  //    draft-vs-stored pattern as ownerDraft above (undefined = untouched).
  const storedPrimary = asValidHex(branding?.primary_color);
  const storedAccent = asValidHex(branding?.accent_color);
  const [primaryDraft, setPrimaryDraft] = useState(undefined);
  const [accentDraft, setAccentDraft] = useState(undefined);
  const brandPrimary = primaryDraft !== undefined ? primaryDraft : storedPrimary;
  const brandAccent = accentDraft !== undefined ? accentDraft : storedAccent;
  const [brandSaving, setBrandSaving] = useState(false);
  const brandValid = HEX_RE.test(brandPrimary) && HEX_RE.test(brandAccent);
  const brandDirty = brandPrimary !== storedPrimary || brandAccent !== storedAccent;
  const storedInvalid =
    (!!branding?.primary_color && !storedPrimary) ||
    (!!branding?.accent_color && !storedAccent);

  // custom_app_name (saved together with colors) + logo upload (immediate, like
  // the admin branding editor; cross-gym storage write via 0589).
  const storedAppName = branding?.custom_app_name ?? '';
  const [appNameDraft, setAppNameDraft] = useState(undefined);
  const appName = appNameDraft !== undefined ? appNameDraft : storedAppName;
  const appNameDirty = appNameDraft !== undefined && appNameDraft.trim() !== storedAppName.trim();
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [localLogoUrl, setLocalLogoUrl] = useState(null);
  const [logoError, setLogoError] = useState('');

  const saveBranding = async () => {
    if (!brandValid || brandSaving) return;
    setBrandSaving(true);
    const payload = { primary_color: brandPrimary.trim(), accent_color: brandAccent.trim(), custom_app_name: appName.trim() || null };
    const { error } = await supabase
      .from('gym_branding')
      .upsert({ gym_id: gym.id, ...payload, updated_at: new Date().toISOString() }, { onConflict: 'gym_id' });
    setBrandSaving(false);
    if (error) {
      notify?.(t('platform.gymDetail.settings.brandingSaveFailed', 'Could not save branding: {{error}}', { error: error.message }), 'error');
      return;
    }
    logAdminAction('update_gym_branding', 'gym', gym.id, { gym_name: gym.name, ...payload }, gym.id);
    // Parent updates its branding state → stored values now match the save;
    // clear the drafts so the fields track the new stored values.
    onBrandingSaved?.(payload);
    setPrimaryDraft(undefined);
    setAccentDraft(undefined);
    setAppNameDraft(undefined);
    notify?.(t('platform.gymDetail.settings.brandingSaved', 'Branding saved'));
  };

  const handleLogoUpload = async (file) => {
    if (!file) return;
    setLogoError('');
    const validation = await validateImageFile(file);
    if (!validation.valid) { setLogoError(validation.error); return; }
    setUploadingLogo(true);
    try {
      const compressed = await compressImage(file);
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${gym.id}/logo.${ext}`;
      const { error: upErr } = await supabase.storage.from('gym-logos').upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase.from('gym_branding').upsert({ gym_id: gym.id, logo_url: path, updated_at: new Date().toISOString() }, { onConflict: 'gym_id' });
      if (dbErr) throw dbErr;
      const { data: signed } = await supabase.storage.from('gym-logos').createSignedUrl(path, 60 * 60 * 24);
      setLocalLogoUrl(signed?.signedUrl || null);
      onBrandingSaved?.({ logo_url: path });
      logAdminAction('update_gym_logo', 'gym', gym.id, { gym_name: gym.name }, gym.id);
      notify?.(t('platform.gymDetail.settings.logoUploaded', 'Logo updated'));
    } catch (err) {
      setLogoError(err.message || 'Upload failed');
      notify?.(t('platform.gymDetail.settings.logoUploadFailed', 'Logo upload failed: {{error}}', { error: err.message }), 'error');
    } finally {
      setUploadingLogo(false);
    }
  };

  // ── Per-gym feature entitlements (0586) ──────────────────────────────────
  const [entitlements, setEntitlements] = useState(null); // {feature: enabled} | null = loading
  const [entSaving, setEntSaving] = useState(null);        // feature key currently saving
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('gym_entitlements').select('feature, enabled').eq('gym_id', gym.id);
      if (cancelled) return;
      if (error) { setEntitlements({}); return; }      // pre-migration → treat as all default-on
      const map = {};
      (data || []).forEach(r => { map[r.feature] = r.enabled; });
      setEntitlements(map);
    })();
    return () => { cancelled = true; };
  }, [gym.id]);

  const toggleFeature = async (feature) => {
    const current = entitlements?.[feature] !== false; // missing row = enabled
    const next = !current;
    setEntSaving(feature);
    setEntitlements(prev => ({ ...(prev || {}), [feature]: next })); // optimistic
    const { error } = await supabase.from('gym_entitlements').upsert(
      { gym_id: gym.id, feature, enabled: next, updated_at: new Date().toISOString() },
      { onConflict: 'gym_id,feature' },
    );
    setEntSaving(null);
    if (error) {
      setEntitlements(prev => ({ ...(prev || {}), [feature]: current })); // revert
      notify?.(t('platform.gymDetail.settings.featureSaveFailed', 'Could not update feature: {{error}}', { error: error.message }), 'error');
      return;
    }
    logAdminAction('set_gym_entitlement', 'gym', gym.id, { feature, enabled: next }, gym.id);
  };

  // ── Plan & billing metadata (cols: monthly_price/currency 0041/0397, trial/
  //    renews/seat 0587). Self-contained: reads from gym (select '*'), writes
  //    gyms directly — no billing engine, operator records only. ───────────
  const [planDraft, setPlanDraft] = useState({ monthly_price: '', currency: 'USD', trial_ends_at: '', renews_at: '', member_seat_limit: '' });
  const [planSaving, setPlanSaving] = useState(false);
  useEffect(() => {
    setPlanDraft({
      monthly_price: gym.monthly_price ?? '',
      currency: gym.currency ?? 'USD',
      trial_ends_at: gym.trial_ends_at ? String(gym.trial_ends_at).slice(0, 10) : '',
      renews_at: gym.renews_at ? String(gym.renews_at).slice(0, 10) : '',
      member_seat_limit: gym.member_seat_limit ?? '',
    });
  }, [gym.id]); // re-init only when a different gym is opened

  const savePlan = async () => {
    setPlanSaving(true);
    const payload = {
      monthly_price: planDraft.monthly_price === '' ? null : Number(planDraft.monthly_price),
      currency: (planDraft.currency || 'USD').toUpperCase().slice(0, 3),
      trial_ends_at: planDraft.trial_ends_at || null,
      renews_at: planDraft.renews_at || null,
      member_seat_limit: planDraft.member_seat_limit === '' ? null : parseInt(planDraft.member_seat_limit, 10),
    };
    const { error } = await supabase.from('gyms').update(payload).eq('id', gym.id);
    setPlanSaving(false);
    if (error) {
      notify?.(t('platform.gymDetail.settings.planSaveFailed', 'Could not save plan: {{error}}', { error: error.message }), 'error');
      return;
    }
    logAdminAction('update_gym_plan', 'gym', gym.id, { gym_name: gym.name }, gym.id);
    notify?.(t('platform.gymDetail.settings.planSaved', 'Plan & billing saved'));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Gym info */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4">
        <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
          <Settings className="w-4 h-4 text-[#D4AF37]" />
          {t('platform.gymDetail.settings.gymInfo')}
        </h3>

        <div>
          <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.settings.nameLabel')}</label>
          <input
            type="text"
            value={editingGym.name}
            onChange={e => setEditingGym(prev => ({ ...prev, name: e.target.value }))}
            className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
          />
        </div>

        <div>
          <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.settings.slugLabel')}</label>
          <input
            type="text"
            value={editingGym.slug}
            onChange={e => setEditingGym(prev => ({ ...prev, slug: e.target.value }))}
            className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 font-mono"
          />
        </div>

        <div>
          <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.settings.timezoneLabel')}</label>
          <p className="text-[13px] text-[#E5E7EB]">{gym.timezone ?? t('platform.gymDetail.settings.notSet')}</p>
        </div>

        {/* Set owner (P0-1d) — gyms.owner_user_id had no writer before; the
            GymsOverview Owner column was permanently empty. */}
        <div>
          <label className="block text-[11px] text-[#6B7280] font-medium mb-1 flex items-center gap-1.5">
            <Crown className="w-3 h-3 text-[#D4AF37]" />
            {t('platform.gymDetail.settings.ownerLabel')}
          </label>
          {ownerCandidates.length === 0 && !gym.owner_user_id ? (
            <p className="text-[12px] text-[#6B7280]">
              {t('platform.gymDetail.settings.noAdminCandidates', 'No admins yet — set a member’s role to Admin on the Members tab first, then choose them here.')}
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <select
                value={ownerValue}
                onChange={e => setOwnerDraft(e.target.value)}
                aria-label={t('platform.gymDetail.settings.ownerSelectAria', 'Select gym owner')}
                className="flex-1 bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer"
              >
                <option value="">{t('platform.gymDetail.settings.noOwner', 'No owner set')}</option>
                {ownerCandidates.map(a => (
                  <option key={a.id} value={a.id}>{(a.full_name || a.username || a.id)} — {roleLabel(a)}</option>
                ))}
                {/* keep a stale owner visible even if they're no longer a member */}
                {gym.owner_user_id && !ownerCandidates.some(a => a.id === gym.owner_user_id) && (
                  <option value={gym.owner_user_id}>{currentOwner?.full_name || currentOwner?.username || gym.owner_user_id}</option>
                )}
              </select>
              <button
                onClick={async () => { await setGymOwner(ownerValue || null); setOwnerDraft(undefined); }}
                disabled={!ownerDirty}
                className="px-3 py-2 rounded-lg text-[12px] font-semibold bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {t('platform.gymDetail.settings.setOwner', 'Set owner')}
              </button>
            </div>
          )}
        </div>

        {/* A2: inline slug validation errors from saveGymSettings */}
        {settingsError && (
          <p className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{settingsError}</p>
        )}

        <button
          onClick={saveGymSettings}
          disabled={savingGym}
          className="rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50"
          style={{ background: '#D4AF37', color: '#000' }}
        >
          {savingGym ? t('platform.gymDetail.settings.saving') : t('platform.gymDetail.settings.saveChanges')}
        </button>
      </div>

      {/* Branding \u2014 A7: editable colors (was read-only swatches). Upserts
          gym_branding via the 0551 super_admin ALL policy. */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4">
        <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
          <Palette className="w-4 h-4 text-[#D4AF37]" />
          {t('platform.gymDetail.settings.branding')}
        </h3>

        {!branding && (
          <p className="text-[#6B7280] text-sm">{t('platform.gymDetail.settings.noBranding')}</p>
        )}

        <div className="flex items-start gap-4 flex-wrap">
          {[
            { label: t('platform.gymDetail.settings.primaryColor'), value: brandPrimary, set: setPrimaryDraft, fallback: '#D4AF37' },
            { label: t('platform.gymDetail.settings.accentColor'), value: brandAccent, set: setAccentDraft, fallback: '#10B981' },
          ].map(field => (
            <div key={field.label}>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{field.label}</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={HEX_RE.test(field.value) ? field.value : field.fallback}
                  onChange={e => field.set(e.target.value)}
                  aria-label={field.label}
                  className="w-9 h-9 rounded-lg border border-white/10 bg-[#111827] p-0.5 cursor-pointer"
                />
                <input
                  type="text"
                  value={field.value}
                  onChange={e => field.set(e.target.value)}
                  placeholder={field.fallback}
                  maxLength={7}
                  aria-label={`${field.label} hex`}
                  className={`w-24 bg-[#111827] border rounded-lg px-2.5 py-2 text-[12px] font-mono text-[#E5E7EB] placeholder-[#4B5563] outline-none transition-colors ${
                    field.value === '' || HEX_RE.test(field.value)
                      ? 'border-white/6 focus:border-[#D4AF37]/40'
                      : 'border-red-500/40'
                  }`}
                />
              </div>
            </div>
          ))}
        </div>

        {storedInvalid && (
          <p className="text-[11px] text-amber-400 bg-amber-500/8 border border-amber-500/15 rounded-lg px-3 py-2">
            {t('platform.gymDetail.settings.brandingStoredInvalid', "A stored color isn't a valid hex value \u2014 pick a color and save to repair it.")}
          </p>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={saveBranding}
            disabled={!brandValid || (!brandDirty && !appNameDirty) || brandSaving}
            className="rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#D4AF37', color: '#000' }}
          >
            {brandSaving ? t('platform.gymDetail.settings.saving') : t('platform.gymDetail.settings.saveBranding', 'Save branding')}
          </button>
          <p className="text-[11px] text-[#6B7280]">
            {t('platform.gymDetail.settings.brandingApplyNote', "The gym's app picks up new colors on its next launch.")}
          </p>
        </div>

        <div>
          <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.settings.customAppName')}</label>
          <input
            type="text"
            value={appName}
            onChange={e => setAppNameDraft(e.target.value)}
            placeholder={gym.name}
            maxLength={40}
            className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
          />
          <p className="text-[10px] text-[#6B7280] mt-1">{t('platform.gymDetail.settings.customAppNameHint', "Shown as the app name in this gym's build. Leave blank to use the gym name. Saved with the Save branding button.")}</p>
        </div>

        <div>
          <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.settings.logo')}</label>
          <div className="flex items-center gap-3">
            {(localLogoUrl || logoUrl) ? (
              <img
                src={localLogoUrl || logoUrl}
                alt={t('platform.gymDetail.settings.logoAlt', { name: gym.name })}
                className="h-12 w-12 rounded-lg border border-white/6 bg-white/[0.03] object-contain p-1 flex-shrink-0"
              />
            ) : (
              <div className="h-12 w-12 rounded-lg border border-dashed border-white/10 bg-white/[0.02] flex items-center justify-center flex-shrink-0">
                <Palette className="w-4 h-4 text-[#4B5563]" />
              </div>
            )}
            <label className={`inline-flex items-center gap-2 text-[12px] font-semibold px-3 py-2 rounded-lg border border-white/8 bg-white/[0.04] text-[#E5E7EB] transition-colors ${uploadingLogo ? 'opacity-50' : 'hover:bg-white/[0.08] cursor-pointer'}`}>
              <Upload size={13} className="text-[#D4AF37]" />
              {uploadingLogo ? t('platform.gymDetail.settings.uploading', 'Uploading…') : t('platform.gymDetail.settings.uploadLogo', 'Upload logo')}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploadingLogo}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); e.target.value = ''; }} />
            </label>
          </div>
          {logoError && <p className="text-[11px] text-red-400 mt-1.5">{logoError}</p>}
          <p className="text-[10px] text-[#6B7280] mt-1.5">{t('platform.gymDetail.settings.logoUploadHint', 'PNG, JPEG or WebP, under 5 MB. Compressed to 512px. The app picks it up on next launch.')}</p>
        </div>
      </div>

      {/* QR Code Configuration */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4 lg:col-span-2">
        <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
          <QrCode className="w-4 h-4 text-[#D4AF37]" />
          {t('platform.gymDetail.settings.qrCheckIn')}
        </h3>
        <p className="text-[12px] text-[#6B7280]">
          {t('platform.gymDetail.settings.qrDesc')}
        </p>

        {/* Enable toggle */}
        <div className="flex items-center justify-between p-3 bg-[#111827] rounded-xl border border-white/6">
          <div>
            <p className="text-[13px] font-semibold text-[#E5E7EB]">{t('platform.gymDetail.settings.enableQr')}</p>
            <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.settings.enableQrDesc')}</p>
          </div>
          <button
            onClick={() => setEditingGym(prev => ({ ...prev, qr_enabled: !prev.qr_enabled }))}
            className="relative w-11 h-6 rounded-full transition-colors"
            role="switch"
            aria-checked={editingGym.qr_enabled}
            aria-label={t('platform.gymDetail.settings.toggleQrCodes')}
            style={{ background: editingGym.qr_enabled ? '#D4AF37' : '#374151' }}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${editingGym.qr_enabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>

        {editingGym.qr_enabled && (
          <div className="space-y-4">
            {/* Payload type */}
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1.5">{t('platform.gymDetail.settings.codeType')}</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { key: 'auto_id', label: t('platform.gymDetail.settings.autoGenerated'), desc: t('platform.gymDetail.settings.autoGeneratedDesc') },
                  { key: 'external_id', label: t('platform.gymDetail.settings.externalId'), desc: t('platform.gymDetail.settings.externalIdDesc') },
                  { key: 'custom_template', label: t('platform.gymDetail.settings.customTemplate'), desc: t('platform.gymDetail.settings.customTemplateDesc') },
                ].map(opt => (
                  <button key={opt.key} onClick={() => setEditingGym(prev => ({ ...prev, qr_payload_type: opt.key }))}
                    className={`text-left p-3 rounded-xl border transition-colors ${
                      editingGym.qr_payload_type === opt.key
                        ? 'border-[#D4AF37]/40'
                        : 'border-white/6 hover:border-white/12'
                    }`}
                    style={{ background: editingGym.qr_payload_type === opt.key ? 'rgba(212,175,55,0.08)' : '#111827' }}>
                    <p className={`text-[12px] font-semibold ${editingGym.qr_payload_type === opt.key ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                      {opt.label}
                    </p>
                    <p className="text-[11px] text-[#6B7280]">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom template input */}
            {editingGym.qr_payload_type === 'custom_template' && (
              <div>
                <label className="block text-[11px] text-[#6B7280] font-medium mb-1.5">{t('platform.gymDetail.settings.templateLabel')}</label>
                <input
                  value={editingGym.qr_payload_template}
                  onChange={e => setEditingGym(prev => ({ ...prev, qr_payload_template: e.target.value }))}
                  placeholder={t('platform.gymDetail.settings.templatePlaceholder')}
                  className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 font-mono"
                />
                <p className="text-[11px] text-[#6B7280] mt-1.5">
                  {t('platform.gymDetail.settings.templateVariables')} <span className="font-mono text-[#D4AF37]/70">{'{member_id}'}</span>, <span className="font-mono text-[#D4AF37]/70">{'{external_id}'}</span>, <span className="font-mono text-[#D4AF37]/70">{'{full_name}'}</span>, <span className="font-mono text-[#D4AF37]/70">{'{username}'}</span>
                </p>
              </div>
            )}

            {editingGym.qr_payload_type === 'external_id' && (
              <div className="p-3 bg-[#111827] rounded-xl border border-white/6">
                <p className="text-[12px] text-[#9CA3AF]">
                  {/* externalIdHelp exists in BOTH locales but carries <1>…</1>
                      Trans markup — strip it for this plain-text context.
                      (externalIdHelpPlain existed in neither locale → raw key
                      rendered on screen.) */}
                  {t('platform.gymDetail.settings.externalIdHelp').replace(/<\/?1>/g, '')}
                </p>
              </div>
            )}

            {/* Display format selector removed — check-in codes are always
                rendered as QR codes (barcode_128 / barcode_39 are no longer
                offered; qr_display_format is hardcoded to 'qr_code' on save). */}
          </div>
        )}
      </div>

      {/* Class Booking */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-3">
        <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-[#D4AF37]" />
          {t('platform.gymDetail.settings.classBooking')}
        </h3>
        <p className="text-[11px] text-[#6B7280]">
          {t('platform.gymDetail.settings.classBookingDesc')}
        </p>
        <div className="flex items-center justify-between p-3 bg-[#111827] rounded-xl border border-white/6">
          <div>
            <p className="text-[13px] font-semibold text-[#E5E7EB]">{t('platform.gymDetail.settings.enableClassBooking')}</p>
            <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.settings.enableClassBookingDesc')}</p>
          </div>
          <button
            onClick={() => setEditingGym(prev => ({ ...prev, classes_enabled: !prev.classes_enabled }))}
            className="relative w-11 h-6 rounded-full transition-colors"
            role="switch"
            aria-checked={editingGym.classes_enabled}
            aria-label={t('platform.gymDetail.settings.toggleClassBooking')}
            style={{ background: editingGym.classes_enabled ? '#D4AF37' : '#374151' }}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${editingGym.classes_enabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>
      </div>

      {/* Multi-Admin */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between py-3 border-b border-white/4">
          <div>
            <p className="text-[13px] font-medium text-[#E5E7EB]">{t('platform.gymDetail.settings.multiAdmin')}</p>
            <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.settings.multiAdminDesc')}</p>
          </div>
          <button onClick={() => setEditingGym(p => ({ ...p, multi_admin_enabled: !p.multi_admin_enabled }))}
            className="w-10 h-5.5 rounded-full relative flex-shrink-0 transition-colors"
            role="switch"
            aria-checked={editingGym.multi_admin_enabled}
            aria-label={t('platform.gymDetail.settings.toggleMultiAdmin')}
            style={{ backgroundColor: editingGym.multi_admin_enabled ? '#D4AF37' : '#6B7280' }}>
            <span className="absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform"
              style={{ left: editingGym.multi_admin_enabled ? 'calc(100% - 20px)' : '2px' }} />
          </button>
        </div>
        {editingGym.multi_admin_enabled && (
          <div className="flex items-center justify-between py-3 border-b border-white/4">
            <div>
              <p className="text-[13px] font-medium text-[#E5E7EB]">{t('platform.gymDetail.settings.maxAdminSeats')}</p>
              <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.settings.maxAdminSeatsDesc')}</p>
            </div>
            <input type="number" min="1" max="20" value={editingGym.max_admin_seats}
              onChange={e => setEditingGym(p => ({ ...p, max_admin_seats: parseInt(e.target.value) || 1 }))}
              aria-label={t('platform.gymDetail.settings.maxAdminSeatsAria')}
              className="w-16 bg-[#111827] border border-white/6 rounded-lg px-2 py-1.5 text-[13px] text-[#E5E7EB] text-center outline-none focus:border-[#D4AF37]/40" />
          </div>
        )}
      </div>

      {/* Plan & billing — operator-visible subscription metadata (no billing
          engine). Drives MRR/ARR on Analytics + Attention "trials ending". */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4 lg:col-span-2">
        <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-[#D4AF37]" />
          {t('platform.gymDetail.settings.planBilling', 'Plan & billing')}
        </h3>
        <p className="text-[11px] text-[#6B7280]">
          {t('platform.gymDetail.settings.planBillingDesc', 'Drives MRR/ARR on Analytics and the Attention board. No charges are made — operator records only. The plan tier is set from the gym header.')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.settings.monthlyPrice', 'Monthly price')}</label>
            <input type="number" min="0" step="0.01" value={planDraft.monthly_price}
              onChange={e => setPlanDraft(p => ({ ...p, monthly_price: e.target.value }))}
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.settings.currency', 'Currency')}</label>
            <input type="text" maxLength={3} value={planDraft.currency}
              onChange={e => setPlanDraft(p => ({ ...p, currency: e.target.value }))}
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] uppercase font-mono outline-none focus:border-[#D4AF37]/40" />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.settings.memberSeatLimit', 'Member seat limit')}</label>
            <input type="number" min="0" value={planDraft.member_seat_limit}
              onChange={e => setPlanDraft(p => ({ ...p, member_seat_limit: e.target.value }))}
              placeholder={t('platform.gymDetail.settings.noLimit', 'No limit')}
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.settings.trialEnds', 'Trial ends')}</label>
            <input type="date" value={planDraft.trial_ends_at}
              onChange={e => setPlanDraft(p => ({ ...p, trial_ends_at: e.target.value }))}
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.settings.renewsAt', 'Renews / expires')}</label>
            <input type="date" value={planDraft.renews_at}
              onChange={e => setPlanDraft(p => ({ ...p, renews_at: e.target.value }))}
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
          </div>
        </div>
        <button onClick={savePlan} disabled={planSaving}
          className="rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50"
          style={{ background: '#D4AF37', color: '#000' }}>
          {planSaving ? t('platform.gymDetail.settings.saving') : t('platform.gymDetail.settings.savePlan', 'Save plan')}
        </button>
      </div>

      {/* Per-gym feature entitlements (0586). Global Operations kill switches
          override these — off-everywhere always wins. classes + qr have their
          own cards above. */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-3 lg:col-span-2">
        <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
          <ToggleRight className="w-4 h-4 text-[#D4AF37]" />
          {t('platform.gymDetail.settings.features', 'Features')}
        </h3>
        <p className="text-[11px] text-[#6B7280]">
          {t('platform.gymDetail.settings.featuresDesc', 'Turn capabilities on or off for this gym. The global kill switches on Operations override these (off everywhere wins).')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ENTITLEMENT_FEATURES.map(f => {
            const enabled = entitlements?.[f] !== false;
            return (
              <div key={f} className="flex items-center justify-between p-3 bg-[#111827] rounded-xl border border-white/6">
                <p className="text-[13px] font-medium text-[#E5E7EB]">{t(`platform.gymDetail.settings.feature_${f}`, FEATURE_FALLBACK[f])}</p>
                <button
                  onClick={() => toggleFeature(f)}
                  disabled={entitlements === null || entSaving === f}
                  className="relative w-11 h-6 rounded-full transition-colors disabled:opacity-50"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={t(`platform.gymDetail.settings.feature_${f}`, FEATURE_FALLBACK[f])}
                  style={{ background: enabled ? '#D4AF37' : '#374151' }}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* SMS Configuration */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Smartphone size={14} className="text-[#D4AF37]" />
          <div>
            <p className="text-[13px] font-medium text-[#E5E7EB]">{t('platform.gymDetail.smsConfig', 'SMS Configuration')}</p>
            <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.smsConfigDesc', 'Twilio phone number used to send SMS to members')}</p>
          </div>
        </div>
        <div className="py-3 border-t border-white/4">
          <input
            type="text"
            placeholder="+1XXXXXXXXXX"
            aria-label={t('platform.gymDetail.settings.smsPhoneAria')}
            value={editingGym.sms_phone_number}
            onChange={e => setEditingGym(p => ({ ...p, sms_phone_number: e.target.value }))}
            className="w-full bg-[#111827] border rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none transition-colors"
            style={{
              borderColor: !editingGym.sms_phone_number
                ? 'rgba(255,255,255,0.06)'
                : /^\+1\d{10}$/.test(editingGym.sms_phone_number)
                  ? '#10B981'
                  : '#EF4444',
            }}
          />
          <p className="text-[10px] text-[#6B7280] mt-2">{t('platform.gymDetail.smsPhoneHelp', 'US format required. Leave empty to disable SMS for this gym.')}</p>
        </div>
      </div>

      {/* Gym Lifecycle / Status */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4 lg:col-span-2">
        <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
          <ShieldOff className="w-4 h-4 text-[#D4AF37]" />
          {t('platform.gymDetail.lifecycle.title')}
        </h3>
        <p className="text-[12px] text-[#6B7280]">{t('platform.gymDetail.lifecycle.description')}</p>

        {/* Current status indicator */}
        <div className="flex items-center gap-3 p-3 bg-[#111827] rounded-xl border border-white/6">
          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
            gymStatus === 'active' ? 'bg-emerald-400' : gymStatus === 'paused' ? 'bg-amber-400' : 'bg-red-400'
          }`} />
          <div>
            <p className="text-[13px] font-semibold text-[#E5E7EB]">
              {t('platform.gymDetail.lifecycle.currentStatus')}: {t(`platform.gymDetail.gymStatus.${gymStatus}`)}
            </p>
            <p className="text-[11px] text-[#6B7280]">
              {gymStatus === 'active' && t('platform.gymDetail.lifecycle.activeDesc')}
              {gymStatus === 'paused' && t('platform.gymDetail.lifecycle.pausedDesc')}
              {gymStatus === 'deactivated' && t('platform.gymDetail.lifecycle.deactivatedDesc')}
            </p>
          </div>
        </div>

        {/* Pause/reactivate live in the page header (canonical) — only the
            destructive action that has no header button stays here. A3: this
            is a DEACTIVATE (reversible; nothing is deleted) — permanent
            deletion lives in GymOps. */}
        {gymStatus !== 'deactivated' && (
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setLifecycleModal('delete')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium border border-red-500/20 bg-red-500/8 text-red-400 hover:bg-red-500/15 transition-colors"
            >
              <AlertTriangle className="w-4 h-4" />
              {t('platform.gymDetail.lifecycle.deactivateBtn', 'Deactivate Gym')}
            </button>
          </div>
        )}
      </div>

      {/* Invite links */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4 lg:col-span-2">
        <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
          <Link2 className="w-4 h-4 text-[#D4AF37]" />
          {t('platform.gymDetail.settings.inviteLinks')}
        </h3>

        {invites.length === 0 ? (
          <p className="text-[#6B7280] text-sm">{t('platform.gymDetail.settings.noInviteLinks')}</p>
        ) : (
          <div className="space-y-2">
            {invites.map(inv => {
              const isExpired = inv.expires_at && new Date(inv.expires_at) < new Date();
              const isUsed = !!inv.used_at;
              return (
                <div
                  key={inv.id}
                  className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 bg-[#111827] border border-white/6 rounded-lg px-3 py-2.5"
                >
                  {/* A5: members type invite_code — token is the legacy hex
                      credential nobody uses (mirrors GymPeopleTab). */}
                  <span className="text-[12px] text-[#9CA3AF] font-mono flex-1 truncate">{inv.invite_code ?? inv.token}</span>
                  <RoleBadge role={inv.role ?? 'member'} />
                  <span className="text-[11px] text-[#6B7280]">
                    {inv.expires_at ? t('platform.gymDetail.settings.expires', { date: format(new Date(inv.expires_at), 'MMM d, yyyy') }) : t('platform.gymDetail.settings.noExpiry')}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    isUsed
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : isExpired
                      ? 'bg-red-500/10 text-red-400'
                      : 'bg-amber-500/10 text-amber-400'
                  }`}>
                    {isUsed ? t('platform.gymDetail.settings.used') : isExpired ? t('platform.gymDetail.people.expired') : t('platform.gymDetail.people.pending')}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
