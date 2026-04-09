import {
  Settings, Palette, QrCode, CalendarDays, Smartphone, Link2,
  ShieldOff, Pause, Play, AlertTriangle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import RoleBadge from './RoleBadge';

export default function GymSettingsTab({
  gym,
  branding,
  invites,
  editingGym,
  setEditingGym,
  savingGym,
  saveGymSettings,
  gymStatus,
  setLifecycleModal,
  t,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Gym info */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4">
        <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
          <Settings className="w-4 h-4 text-[#D4AF37]" />
          Gym Info
        </h3>

        <div>
          <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Name</label>
          <input
            type="text"
            value={editingGym.name}
            onChange={e => setEditingGym(prev => ({ ...prev, name: e.target.value }))}
            className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
          />
        </div>

        <div>
          <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Slug</label>
          <input
            type="text"
            value={editingGym.slug}
            onChange={e => setEditingGym(prev => ({ ...prev, slug: e.target.value }))}
            className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 font-mono"
          />
        </div>

        <div>
          <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Timezone</label>
          <p className="text-[13px] text-[#E5E7EB]">{gym.timezone ?? t('platform.gymDetail.settings.notSet')}</p>
        </div>

        <div>
          <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Owner</label>
          <p className="text-[13px] text-[#9CA3AF] font-mono text-[11px]">{gym.owner_user_id ?? t('platform.gymDetail.people.unknown')}</p>
        </div>

        <button
          onClick={saveGymSettings}
          disabled={savingGym}
          className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50"
        >
          {savingGym ? t('platform.gymDetail.settings.saving') : t('platform.gymDetail.settings.saveChanges')}
        </button>
      </div>

      {/* Branding preview */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4">
        <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
          <Palette className="w-4 h-4 text-[#D4AF37]" />
          Branding
        </h3>

        {branding ? (
          <>
            <div className="flex items-center gap-3">
              <div>
                <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Primary Color</label>
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-lg border border-white/10"
                    style={{ backgroundColor: branding.primary_color ?? '#D4AF37' }}
                  />
                  <span className="text-[12px] text-[#9CA3AF] font-mono">{branding.primary_color ?? '\u2014'}</span>
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Accent Color</label>
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-lg border border-white/10"
                    style={{ backgroundColor: branding.accent_color ?? '#E6C766' }}
                  />
                  <span className="text-[12px] text-[#9CA3AF] font-mono">{branding.accent_color ?? '\u2014'}</span>
                </div>
              </div>
            </div>

            {branding.custom_app_name && (
              <div>
                <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Custom App Name</label>
                <p className="text-[13px] text-[#E5E7EB]">{branding.custom_app_name}</p>
              </div>
            )}

            {branding.logo_url && (
              <div>
                <label className="block text-[11px] text-[#6B7280] font-medium mb-1">Logo</label>
                <img
                  src={branding.logo_url}
                  alt={`${gym.name} logo`}
                  className="h-12 w-auto rounded-lg border border-white/6 bg-white/[0.03] p-1"
                />
              </div>
            )}
          </>
        ) : (
          <p className="text-[#6B7280] text-sm">No branding configured for this gym.</p>
        )}
      </div>

      {/* QR Code Configuration */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4 lg:col-span-2">
        <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
          <QrCode className="w-4 h-4 text-[#D4AF37]" />
          QR Code Check-In
        </h3>
        <p className="text-[12px] text-[#6B7280]">
          Generate unique QR codes for members to scan at this gym's existing access system
        </p>

        {/* Enable toggle */}
        <div className="flex items-center justify-between p-3 bg-[#111827] rounded-xl border border-white/6">
          <div>
            <p className="text-[13px] font-semibold text-[#E5E7EB]">Enable QR Codes</p>
            <p className="text-[11px] text-[#6B7280]">Members will see a "Show QR" button on the check-in screen</p>
          </div>
          <button
            onClick={() => setEditingGym(prev => ({ ...prev, qr_enabled: !prev.qr_enabled }))}
            className={`relative w-11 h-6 rounded-full transition-colors ${editingGym.qr_enabled ? 'bg-[#D4AF37]' : 'bg-[#374151]'}`}
            role="switch"
            aria-checked={editingGym.qr_enabled}
            aria-label="Toggle QR codes"
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${editingGym.qr_enabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>

        {editingGym.qr_enabled && (
          <div className="space-y-4">
            {/* Payload type */}
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1.5">Code Type</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { key: 'auto_id', label: t('platform.gymDetail.settings.autoGenerated'), desc: t('platform.gymDetail.settings.autoGeneratedDesc') },
                  { key: 'external_id', label: t('platform.gymDetail.settings.externalId'), desc: t('platform.gymDetail.settings.externalIdDesc') },
                  { key: 'custom_template', label: t('platform.gymDetail.settings.customTemplate'), desc: t('platform.gymDetail.settings.customTemplateDesc') },
                ].map(opt => (
                  <button key={opt.key} onClick={() => setEditingGym(prev => ({ ...prev, qr_payload_type: opt.key }))}
                    className={`text-left p-3 rounded-xl border transition-colors ${
                      editingGym.qr_payload_type === opt.key
                        ? 'border-[#D4AF37]/40 bg-[#D4AF37]/8'
                        : 'border-white/6 bg-[#111827] hover:border-white/12'
                    }`}>
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
                <label className="block text-[11px] text-[#6B7280] font-medium mb-1.5">Template</label>
                <input
                  value={editingGym.qr_payload_template}
                  onChange={e => setEditingGym(prev => ({ ...prev, qr_payload_template: e.target.value }))}
                  placeholder="e.g. GYM-{member_id} or {external_id}"
                  className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 font-mono"
                />
                <p className="text-[11px] text-[#6B7280] mt-1.5">
                  Variables: <span className="font-mono text-[#D4AF37]/70">{'{member_id}'}</span>, <span className="font-mono text-[#D4AF37]/70">{'{external_id}'}</span>, <span className="font-mono text-[#D4AF37]/70">{'{full_name}'}</span>, <span className="font-mono text-[#D4AF37]/70">{'{username}'}</span>
                </p>
              </div>
            )}

            {editingGym.qr_payload_type === 'external_id' && (
              <div className="p-3 bg-[#111827] rounded-xl border border-white/6">
                <p className="text-[12px] text-[#9CA3AF]">
                  Set each member's external code in the <span className="font-semibold text-[#E5E7EB]">Members</span> tab {'\u2192'} click member {'\u2192'} External ID field.
                </p>
              </div>
            )}

            {/* Display format */}
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1.5">Display Format</label>
              <div className="flex gap-2">
                {[
                  { key: 'qr_code', label: 'QR Code' },
                  { key: 'barcode_128', label: t('platform.gymDetail.settings.barcode128') },
                  { key: 'barcode_39', label: t('platform.gymDetail.settings.barcode39') },
                ].map(opt => (
                  <button key={opt.key} onClick={() => setEditingGym(prev => ({ ...prev, qr_display_format: opt.key }))}
                    className={`flex-1 py-2 rounded-xl text-[12px] font-medium transition-colors ${
                      editingGym.qr_display_format === opt.key
                        ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                        : 'bg-[#111827] border border-white/6 text-[#6B7280]'
                    }`}>
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
          Class Booking
        </h3>
        <p className="text-[11px] text-[#6B7280]">
          Allow members to book scheduled classes at this gym
        </p>
        <div className="flex items-center justify-between p-3 bg-[#111827] rounded-xl border border-white/6">
          <div>
            <p className="text-[13px] font-semibold text-[#E5E7EB]">Enable Class Booking</p>
            <p className="text-[11px] text-[#6B7280]">Members will see a Classes tab in the app</p>
          </div>
          <button
            onClick={() => setEditingGym(prev => ({ ...prev, classes_enabled: !prev.classes_enabled }))}
            className={`relative w-11 h-6 rounded-full transition-colors ${editingGym.classes_enabled ? 'bg-[#D4AF37]' : 'bg-[#374151]'}`}
            role="switch"
            aria-checked={editingGym.classes_enabled}
            aria-label="Toggle class booking"
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${editingGym.classes_enabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>
      </div>

      {/* Multi-Admin */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between py-3 border-b border-white/4">
          <div>
            <p className="text-[13px] font-medium text-[#E5E7EB]">Multi-Admin</p>
            <p className="text-[11px] text-[#6B7280]">Allow multiple admin accounts for this gym</p>
          </div>
          <button onClick={() => setEditingGym(p => ({ ...p, multi_admin_enabled: !p.multi_admin_enabled }))}
            className="w-10 h-5.5 rounded-full relative flex-shrink-0 transition-colors"
            role="switch"
            aria-checked={editingGym.multi_admin_enabled}
            aria-label="Toggle multi-admin"
            style={{ backgroundColor: editingGym.multi_admin_enabled ? '#D4AF37' : '#6B7280' }}>
            <span className="absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform"
              style={{ left: editingGym.multi_admin_enabled ? 'calc(100% - 20px)' : '2px' }} />
          </button>
        </div>
        {editingGym.multi_admin_enabled && (
          <div className="flex items-center justify-between py-3 border-b border-white/4">
            <div>
              <p className="text-[13px] font-medium text-[#E5E7EB]">Max Admin Seats</p>
              <p className="text-[11px] text-[#6B7280]">Maximum number of admin accounts</p>
            </div>
            <input type="number" min="1" max="20" value={editingGym.max_admin_seats}
              onChange={e => setEditingGym(p => ({ ...p, max_admin_seats: parseInt(e.target.value) || 1 }))}
              aria-label="Max admin seats"
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
            aria-label="SMS phone number"
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

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          {gymStatus === 'active' && (
            <button
              onClick={() => setLifecycleModal('pause')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium border border-amber-500/20 bg-amber-500/8 text-amber-400 hover:bg-amber-500/15 transition-colors"
            >
              <Pause className="w-4 h-4" />
              {t('platform.gymDetail.lifecycle.pauseBtn')}
            </button>
          )}
          {gymStatus !== 'active' && (
            <button
              onClick={() => setLifecycleModal('reactivate')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium border border-emerald-500/20 bg-emerald-500/8 text-emerald-400 hover:bg-emerald-500/15 transition-colors"
            >
              <Play className="w-4 h-4" />
              {t('platform.gymDetail.lifecycle.reactivateBtn')}
            </button>
          )}
          {gymStatus !== 'deactivated' && (
            <button
              onClick={() => setLifecycleModal('delete')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium border border-red-500/20 bg-red-500/8 text-red-400 hover:bg-red-500/15 transition-colors"
            >
              <AlertTriangle className="w-4 h-4" />
              {t('platform.gymDetail.lifecycle.deleteBtn')}
            </button>
          )}
        </div>
      </div>

      {/* Invite links */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-5 space-y-4 lg:col-span-2">
        <h3 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
          <Link2 className="w-4 h-4 text-[#D4AF37]" />
          Invite Links
        </h3>

        {invites.length === 0 ? (
          <p className="text-[#6B7280] text-sm">No invite links found.</p>
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
                  <span className="text-[12px] text-[#9CA3AF] font-mono flex-1 truncate">{inv.token}</span>
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
