import {
  Users, Activity, Dumbbell, Clock, Building2, Trophy,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SmsUsageCard from './SmsUsageCard';

export default function GymOverviewTab({
  gym,
  branding,
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

  return (
    <div className="space-y-5">
      {/* Gym identity card */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
        <div className="flex items-start gap-4">
          {branding?.logo_url ? (
            <img src={branding.logo_url} alt={`${gym.name} logo`} className="w-14 h-14 rounded-xl object-cover flex-shrink-0 border border-white/6" />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0 border border-[#D4AF37]/20">
              <Building2 size={24} className="text-[#D4AF37]" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-[#E5E7EB]">{gym.name}</p>
            <p className="text-[12px] text-[#6B7280] font-mono">/{gym.slug}</p>
            {branding?.palette && (
              <span className="inline-block mt-1.5 text-[10px] text-[#9CA3AF] bg-white/5 px-2 py-0.5 rounded-full capitalize">{branding.palette.replace(/_/g, ' ')}</span>
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
            <p className="text-[18px] font-bold text-[#E5E7EB]">{checkIns.length}</p>
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
            <p className="text-[18px] font-bold text-[#E5E7EB]">{invites.length}</p>
            <p className="text-[11px] text-[#6B7280]">{t('platform.gymDetail.overview.invites')}</p>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <button onClick={() => setTab('people')} className="bg-[#0F172A] border border-white/6 rounded-xl p-3 text-left hover:bg-[#111827] transition-colors">
          <Users size={16} className="text-[#D4AF37] mb-2" />
          <p className="text-[12px] font-medium text-[#9CA3AF]">{t('platform.gymDetail.overview.managePeople')}</p>
        </button>
        <button onClick={() => setTab('content')} className="bg-[#0F172A] border border-white/6 rounded-xl p-3 text-left hover:bg-[#111827] transition-colors">
          <Trophy size={16} className="text-[#D4AF37] mb-2" />
          <p className="text-[12px] font-medium text-[#9CA3AF]">{t('platform.gymDetail.overview.manageContent')}</p>
        </button>
        <button onClick={() => setTab('activity')} className="bg-[#0F172A] border border-white/6 rounded-xl p-3 text-left hover:bg-[#111827] transition-colors">
          <Dumbbell size={16} className="text-[#D4AF37] mb-2" />
          <p className="text-[12px] font-medium text-[#9CA3AF]">{t('platform.gymDetail.overview.viewActivity')}</p>
        </button>
        <button onClick={() => setTab('settings')} className="bg-[#0F172A] border border-white/6 rounded-xl p-3 text-left hover:bg-[#111827] transition-colors">
          <SettingsIcon size={16} className="text-[#D4AF37] mb-2" />
          <p className="text-[12px] font-medium text-[#9CA3AF]">{t('platform.gymDetail.overview.gymSettings')}</p>
        </button>
      </div>

      {/* SMS Usage */}
      <SmsUsageCard gymId={gymId} />
    </div>
  );
}
