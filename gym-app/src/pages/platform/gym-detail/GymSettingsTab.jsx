import { useMemo, useState } from 'react';
import {
  Settings, Palette, QrCode, CalendarDays, Smartphone, Link2,
  ShieldOff, AlertTriangle, Crown,
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { logAdminAction } from '../../../lib/adminAudit';
import RoleBadge from './RoleBadge';

// A7: strict hex validation — deliberately NO var(--…) resolution here (the
// admin page's resolveColorToHex resolves against the CURRENT document's CSS
// vars, which on the platform tier would poison the gym's colors with
// platform gold — the exact data bug this editor exists to repair).
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const asValidHex = (v) => (typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim() : '');

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
  // Owner candidates: this gym's admins (primary or additional role).
  const adminCandidates = useMemo(
    () => members.filter(m =>
      m.role === 'admin' || m.role === 'super_admin' ||
      (m.additional_roles ?? []).some(r => r === 'admin' || r === 'super_admin')
    ),
    [members]
  );
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

  const saveBranding = async () => {
    if (!brandValid || brandSaving) return;
    setBrandSaving(true);
    const payload = { primary_color: brandPrimary.trim(), accent_color: brandAccent.trim() };
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
    notify?.(t('platform.gymDetail.settings.brandingSaved', 'Branding saved'));
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
          {adminCandidates.length === 0 ? (
            <p className="text-[12px] text-[#6B7280]">
              {currentOwner?.full_name ?? (gym.owner_user_id ? gym.owner_user_id : t('platform.gymDetail.settings.noOwnerCandidates', 'No admins yet — promote someone to admin first, then set them as owner.'))}
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
                {adminCandidates.map(a => (
                  <option key={a.id} value={a.id}>{a.full_name || a.username || a.id}</option>
                ))}
                {/* keep a stale owner visible even if no longer an admin */}
                {gym.owner_user_id && !adminCandidates.some(a => a.id === gym.owner_user_id) && (
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
            disabled={!brandValid || !brandDirty || brandSaving}
            className="rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#D4AF37', color: '#000' }}
          >
            {brandSaving ? t('platform.gymDetail.settings.saving') : t('platform.gymDetail.settings.saveBranding', 'Save branding')}
          </button>
          <p className="text-[11px] text-[#6B7280]">
            {t('platform.gymDetail.settings.brandingApplyNote', "The gym's app picks up new colors on its next launch.")}
          </p>
        </div>

        {branding?.custom_app_name && (
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.settings.customAppName')}</label>
            <p className="text-[13px] text-[#E5E7EB]">{branding.custom_app_name}</p>
          </div>
        )}

        {logoUrl && (
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.settings.logo')}</label>
            <img
              src={logoUrl}
              alt={t('platform.gymDetail.settings.logoAlt', { name: gym.name })}
              className="h-12 w-auto rounded-lg border border-white/6 bg-white/[0.03] p-1"
            />
          </div>
        )}
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

            {/* Display format */}
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1.5">{t('platform.gymDetail.settings.displayFormat')}</label>
              <div className="flex gap-2">
                {[
                  { key: 'qr_code', label: t('platform.gymDetail.settings.qrCode') },
                  { key: 'barcode_128', label: t('platform.gymDetail.settings.barcode128') },
                  { key: 'barcode_39', label: t('platform.gymDetail.settings.barcode39') },
                ].map(opt => (
                  <button key={opt.key} onClick={() => setEditingGym(prev => ({ ...prev, qr_display_format: opt.key }))}
                    className={`flex-1 py-2 rounded-xl text-[12px] font-medium transition-colors ${
                      editingGym.qr_display_format === opt.key
                        ? 'text-[#D4AF37]'
                        : 'border border-white/6 text-[#6B7280]'
                    }`}
                    style={{ background: editingGym.qr_display_format === opt.key ? 'rgba(212,175,55,0.15)' : '#111827' }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
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
