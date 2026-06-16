import { useEffect, useState } from 'react';
import {
  Users, Activity, Dumbbell, Building2, Trophy,
  Settings as SettingsIcon, Crown, Mail, Phone, MessageCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import SmsUsageCard from './SmsUsageCard';

export default function GymOverviewTab({
  gym,
  branding,
  logoUrl,
  stats,
  checkIns,
  challenges,
  programs,
  achievements,
  invites,
  members,
  gymId,
  setTab,
  setContentSubTab,
}) {
  const { t } = useTranslation('pages');

  // Owner contact (email/phone) via the super_admin RPC (0588) — joins
  // auth.users, which a plain client query can't. Powers manual outreach.
  const [ownerContact, setOwnerContact] = useState(null);
  useEffect(() => {
    if (!gym?.owner_user_id) { setOwnerContact(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc('platform_gym_owner_contact', { p_gym_id: gymId });
      if (!cancelled) setOwnerContact(Array.isArray(data) ? (data[0] || null) : (data || null));
    })();
    return () => { cancelled = true; };
  }, [gym?.owner_user_id, gymId]);

  return (
    <div className="space-y-5">
      {/* Gym identity card */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
        <div className="flex items-start gap-4">
          {logoUrl ? (
            <img src={logoUrl} alt={`${gym.name} logo`} className="w-14 h-14 rounded-xl object-cover flex-shrink-0 border border-white/6" />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0 border border-[#D4AF37]/20">
              <Building2 size={24} className="text-[#D4AF37]" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-[#E5E7EB]">{gym.name}</p>
            <p className="text-[12px] text-[#6B7280] font-mono">/{gym.slug}</p>
            {branding?.palette_name && (
              <span className="inline-block mt-1.5 text-[10px] text-[#9CA3AF] bg-white/5 px-2 py-0.5 rounded-full capitalize">{branding.palette_name.replace(/_/g, ' ')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Owner / admin summary */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
        <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-3">{t('platform.gymDetail.overview.ownerStaff')}</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[18px] font-bold text-[#E5E7EB]">{members.filter(m => m.role === 'admin' || m.role === 'super_admin').length}</p>
            <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.overview.admins')}</p>
          </div>
          <div>
            <p className="text-[18px] font-bold text-[#E5E7EB]">{members.filter(m => m.role === 'trainer').length}</p>
            <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.overview.trainers')}</p>
          </div>
          <div>
            <p className="text-[18px] font-bold text-[#E5E7EB]">{members.filter(m => m.role === 'member').length}</p>
            <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.overview.members')}</p>
          </div>
        </div>
        {gym?.owner_user_id && ownerContact && (
          <div className="mt-4 pt-3 border-t border-white/6">
            <p className="text-[11px] text-[#6B7280] mb-1.5 flex items-center gap-1.5">
              <Crown size={11} className="text-[#D4AF37]" />
              {t('platform.gymDetail.overview.ownerContact', 'Owner contact')}
            </p>
            <p className="text-[13px] font-medium text-[#E5E7EB]">{ownerContact.full_name || '—'}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {ownerContact.email && (
                <a href={`mailto:${ownerContact.email}`}
                  className="inline-flex items-center gap-1.5 text-[11px] text-[#9CA3AF] bg-white/5 hover:bg-white/10 border border-white/6 rounded-lg px-2.5 py-1 transition-colors">
                  <Mail size={12} className="text-[#D4AF37]" /> {ownerContact.email}
                </a>
              )}
              {ownerContact.phone_number && (
                <>
                  <a href={`tel:${ownerContact.phone_number}`}
                    className="inline-flex items-center gap-1.5 text-[11px] text-[#9CA3AF] bg-white/5 hover:bg-white/10 border border-white/6 rounded-lg px-2.5 py-1 transition-colors">
                    <Phone size={12} className="text-[#D4AF37]" /> {ownerContact.phone_number}
                  </a>
                  <a href={`https://wa.me/${ownerContact.phone_number.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] text-[#9CA3AF] bg-white/5 hover:bg-white/10 border border-white/6 rounded-lg px-2.5 py-1 transition-colors">
                    <MessageCircle size={12} className="text-emerald-400" /> {t('platform.gymDetail.overview.whatsapp', 'WhatsApp')}
                  </a>
                </>
              )}
              {!ownerContact.email && !ownerContact.phone_number && (
                <span className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.overview.noOwnerContact', 'No contact info on file')}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Activity snapshot */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
        <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-3">{t('platform.gymDetail.overview.activity30d')}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <p className="text-[18px] font-bold text-[#E5E7EB]">{stats.recentSessions}</p>
            <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.overview.sessions')}</p>
          </div>
          <div>
            <p className="text-[18px] font-bold text-[#E5E7EB]">{stats.activeMembers}</p>
            <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.overview.activeMembers')}</p>
          </div>
          <div>
            <p className="text-[18px] font-bold text-[#E5E7EB]">{stats.avgSessions}</p>
            <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.overview.avgSessionsMember')}</p>
          </div>
          <div>
            {/* real 30d count (P1-4) — checkIns is the 20-row feed, list-only */}
            <p className="text-[18px] font-bold text-[#E5E7EB]">{stats.checkIns30d ?? checkIns.length}</p>
            <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.overview.checkIns')}</p>
          </div>
        </div>
      </div>

      {/* Content summary */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
        <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-3">{t('platform.gymDetail.overview.content')}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button onClick={() => { setTab('content'); setContentSubTab('challenges'); }} className="text-left hover:bg-white/[0.03] rounded-lg p-1 transition-colors">
            <p className="text-[18px] font-bold text-[#E5E7EB]">{challenges.length}</p>
            <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.overview.challenges')}</p>
          </button>
          <button onClick={() => { setTab('content'); setContentSubTab('programs'); }} className="text-left hover:bg-white/[0.03] rounded-lg p-1 transition-colors">
            <p className="text-[18px] font-bold text-[#E5E7EB]">{programs.length}</p>
            <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.overview.programs')}</p>
          </button>
          <button onClick={() => { setTab('content'); setContentSubTab('achievements'); }} className="text-left hover:bg-white/[0.03] rounded-lg p-1 transition-colors">
            <p className="text-[18px] font-bold text-[#E5E7EB]">{achievements.length}</p>
            <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.overview.achievements')}</p>
          </button>
          <div className="p-1">
            {/* only invites that can still be claimed (unused + unexpired) */}
            <p className="text-[18px] font-bold text-[#E5E7EB]">{invites.filter(i => !i.used_at && (!i.expires_at || new Date(i.expires_at) > new Date())).length}</p>
            <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.overview.invites')}</p>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <button onClick={() => setTab('people')} className="border border-white/6 rounded-xl p-3 text-left transition-colors" style={{ background: '#0F172A' }}>
          <Users size={16} className="text-[#D4AF37] mb-2" />
          <p className="text-[12px] font-medium text-[#9CA3AF]">{t('platform.gymDetail.overview.managePeople')}</p>
        </button>
        <button onClick={() => setTab('content')} className="border border-white/6 rounded-xl p-3 text-left transition-colors" style={{ background: '#0F172A' }}>
          <Trophy size={16} className="text-[#D4AF37] mb-2" />
          <p className="text-[12px] font-medium text-[#9CA3AF]">{t('platform.gymDetail.overview.manageContent')}</p>
        </button>
        <button onClick={() => setTab('activity')} className="border border-white/6 rounded-xl p-3 text-left transition-colors" style={{ background: '#0F172A' }}>
          <Dumbbell size={16} className="text-[#D4AF37] mb-2" />
          <p className="text-[12px] font-medium text-[#9CA3AF]">{t('platform.gymDetail.overview.viewActivity')}</p>
        </button>
        <button onClick={() => setTab('settings')} className="border border-white/6 rounded-xl p-3 text-left transition-colors" style={{ background: '#0F172A' }}>
          <SettingsIcon size={16} className="text-[#D4AF37] mb-2" />
          <p className="text-[12px] font-medium text-[#9CA3AF]">{t('platform.gymDetail.overview.gymSettings')}</p>
        </button>
      </div>

      {/* SMS Usage */}
      <SmsUsageCard gymId={gymId} />
    </div>
  );
}
