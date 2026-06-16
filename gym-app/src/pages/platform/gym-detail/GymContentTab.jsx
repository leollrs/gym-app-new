import { useState } from 'react';
import {
  Users, Trophy, BookOpen, Award, Gift, Plus,
  Edit3, Trash2, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';

const CHALLENGE_STATUS_STYLES = {
  active:    'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  upcoming:  'bg-blue-500/10 text-blue-400 border-blue-500/20',
  draft:     'bg-amber-500/10 text-amber-400 border-amber-500/20',
  completed: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  ended:     'bg-white/6 text-[#6B7280] border-white/10',
};

export default function GymContentTab({
  challenges,
  programs,
  achievements,
  rewardsAvailable,
  getChallengeStatus,
  setEditingChallenge,
  setShowChallengeModal,
  setEditingProgram,
  setShowProgramModal,
  toggleProgramPublish,
  setEditingAchievement,
  setShowAchievementModal,
  setEditingReward,
  setShowRewardModal,
  toggleRewardActive,
  setDeleteConfirm,
  initialSubTab,
}) {
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;
  const [contentSubTab, setContentSubTab] = useState(initialSubTab || 'challenges');

  return (
    <div>
      {/* Content sub-tabs */}
      <div className="flex gap-1 mb-4">
        {[
          { key: 'challenges', label: t('platform.gymDetail.contentTab.challengesTab', { count: challenges.length }) },
          { key: 'programs', label: t('platform.gymDetail.contentTab.programsTab', { count: programs.length }) },
          { key: 'achievements', label: t('platform.gymDetail.contentTab.achievementsTab', { count: achievements.length }) },
          { key: 'rewards', label: t('platform.gymDetail.contentTab.rewardsTab') },
        ].map(st => (
          <button
            key={st.key}
            onClick={() => setContentSubTab(st.key)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
              contentSubTab === st.key ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'text-[#6B7280] hover:text-[#9CA3AF] bg-white/[0.02]'
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      {contentSubTab === 'challenges' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-[#E5E7EB]">{t('platform.gymDetail.contentTab.gymChallenges')}</h3>
            <button
              onClick={() => { setEditingChallenge(null); setShowChallengeModal(true); }}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors"
              style={{ background: '#D4AF37', color: '#000' }}
            >
              <Plus className="w-3.5 h-3.5" />
              {t('platform.gymDetail.contentTab.addChallenge')}
            </button>
          </div>

          {challenges.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl py-16 text-center">
              <Trophy className="w-8 h-8 text-[#6B7280] mx-auto mb-3" />
              <p className="text-[#6B7280] text-sm">{t('platform.gymDetail.contentTab.noChallenges')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {challenges.map(c => {
                const status = getChallengeStatus(c);
                const statusStyle = CHALLENGE_STATUS_STYLES[status] ?? CHALLENGE_STATUS_STYLES.ended;
                const participantCount = c.challenge_participants?.length ?? 0;
                return (
                  <div key={c.id} className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="text-[13px] font-semibold text-[#E5E7EB] truncate">{c.name}</h4>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusStyle}`}>
                            {t(`platform.gymDetail.contentTab.status.${status}`, status)}
                          </span>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20">
                            {t(`platform.gymDetail.contentTab.challengeType.${c.type ?? 'general'}`, c.type ?? 'general')}
                          </span>
                        </div>
                        {c.description && (
                          <p className="text-[12px] text-[#6B7280] mb-1 line-clamp-1">{c.description}</p>
                        )}
                        <div className="flex items-center gap-4 text-[11px] text-[#6B7280]">
                          {c.start_date && <span>{t('platform.gymDetail.contentTab.start')} {format(new Date(c.start_date), 'MMM d, yyyy', dateFnsLocale || {})}</span>}
                          {c.end_date && <span>{t('platform.gymDetail.contentTab.end')} {format(new Date(c.end_date), 'MMM d, yyyy', dateFnsLocale || {})}</span>}
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {t('platform.gymDetail.contentTab.participants', { count: participantCount })}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditingChallenge(c); setShowChallengeModal(true); }}
                          className="p-1.5 rounded-lg hover:bg-white/6 text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
                          aria-label={t('platform.gymDetail.contentTab.editChallenge')}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({ type: 'challenge', id: c.id, name: c.name })}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors"
                          aria-label={t('platform.gymDetail.contentTab.deleteChallenge')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {contentSubTab === 'programs' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-[#E5E7EB]">{t('platform.gymDetail.contentTab.gymPrograms')}</h3>
            <button
              onClick={() => { setEditingProgram(null); setShowProgramModal(true); }}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors"
              style={{ background: '#D4AF37', color: '#000' }}
            >
              <Plus className="w-3.5 h-3.5" />
              {t('platform.gymDetail.contentTab.addProgram')}
            </button>
          </div>

          {programs.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl py-16 text-center">
              <BookOpen className="w-8 h-8 text-[#6B7280] mx-auto mb-3" />
              <p className="text-[#6B7280] text-sm">{t('platform.gymDetail.contentTab.noPrograms')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {programs.map(p => (
                <div key={p.id} className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="text-[13px] font-semibold text-[#E5E7EB] truncate">{p.name}</h4>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                          p.is_published
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        }`}>
                          {p.is_published ? t('platform.gymDetail.contentTab.published') : t('platform.gymDetail.contentTab.draft')}
                        </span>
                        {/* difficulty chip removed — gym_programs has no such column */}
                      </div>
                      {p.description && (
                        <p className="text-[12px] text-[#6B7280] mb-1 line-clamp-1">{p.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-[11px] text-[#6B7280]">
                        {p.duration_weeks && <span>{t('platform.gymDetail.contentTab.weeks', { count: p.duration_weeks })}</span>}
                        {p.created_at && <span>{t('platform.gymDetail.contentTab.created', { date: format(new Date(p.created_at), 'MMM d, yyyy', dateFnsLocale || {}) })}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleProgramPublish(p)}
                        className="p-1.5 rounded-lg hover:bg-white/6 text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
                        title={p.is_published ? t('platform.gymDetail.contentTab.draft') : t('platform.gymDetail.contentTab.published')}
                        aria-label={p.is_published ? t('platform.gymDetail.contentTab.draft') : t('platform.gymDetail.contentTab.published')}
                      >
                        {p.is_published
                          ? <ToggleRight className="w-4 h-4 text-emerald-400" />
                          : <ToggleLeft className="w-4 h-4" />
                        }
                      </button>
                      <button
                        onClick={() => { setEditingProgram(p); setShowProgramModal(true); }}
                        className="p-1.5 rounded-lg hover:bg-white/6 text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
                        aria-label={t('platform.gymDetail.contentTab.editProgram')}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm({ type: 'program', id: p.id, name: p.name })}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors"
                        aria-label={t('platform.gymDetail.contentTab.deleteProgram')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {contentSubTab === 'achievements' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-[#E5E7EB]">{t('platform.gymDetail.contentTab.achievementDefs')}</h3>
            <button
              onClick={() => { setEditingAchievement(null); setShowAchievementModal(true); }}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors"
              style={{ background: '#D4AF37', color: '#000' }}
            >
              <Plus className="w-3.5 h-3.5" />
              {t('platform.gymDetail.contentTab.addAchievement')}
            </button>
          </div>

          {achievements.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl py-16 text-center">
              <Award className="w-8 h-8 text-[#6B7280] mx-auto mb-3" />
              <p className="text-[#6B7280] text-sm">{t('platform.gymDetail.contentTab.noAchievements')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {achievements.map(a => {
                const earnedCount = a.user_achievements?.length ?? 0;
                return (
                  <div key={a.id} className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      {/* Real achievement_definitions columns: icon / category / criteria */}
                      <div className="w-10 h-10 rounded-lg bg-[#D4AF37]/10 border border-[#D4AF37]/20 flex items-center justify-center flex-shrink-0 text-[18px]">
                        {a.icon || '\u{1F3C6}'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="text-[13px] font-semibold text-[#E5E7EB] truncate">{a.name}</h4>
                          {a.category && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20">
                              {t(`platform.gymDetail.contentTab.achievementCategory.${a.category}`, String(a.category).replace(/_/g, ' '))}
                            </span>
                          )}
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {t('platform.gymDetail.contentTab.earned', { count: earnedCount })}
                          </span>
                        </div>
                        {a.description && (
                          <p className="text-[12px] text-[#6B7280] mb-1 line-clamp-1">{a.description}</p>
                        )}
                        {a.criteria && Object.keys(a.criteria).length > 0 && (
                          <span className="text-[11px] text-[#6B7280] font-mono">
                            {JSON.stringify(a.criteria)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditingAchievement(a); setShowAchievementModal(true); }}
                          className="p-1.5 rounded-lg hover:bg-white/6 text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
                          aria-label={t('platform.gymDetail.contentTab.editAchievement')}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({ type: 'achievement', id: a.id, name: a.name })}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors"
                          aria-label={t('platform.gymDetail.contentTab.deleteAchievement')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {contentSubTab === 'rewards' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-[#E5E7EB]">{t('platform.gymDetail.contentTab.gymRewards', 'Gym rewards')}</h3>
            <button
              onClick={() => { setEditingReward(null); setShowRewardModal(true); }}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors"
              style={{ background: '#D4AF37', color: '#000' }}
            >
              <Plus className="w-3.5 h-3.5" />
              {t('platform.gymDetail.contentTab.addReward', 'Add reward')}
            </button>
          </div>
          {/* gym_rewards catalog (0187) — the old tab read reward_points (per-member
              balances, select_own RLS) and rendered columns that never existed. */}
          {rewardsAvailable === false ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl py-20 text-center">
              <Gift className="w-10 h-10 text-[#D4AF37]/40 mx-auto mb-4" />
              <h3 className="text-[15px] font-semibold text-[#E5E7EB] mb-2">{t('platform.gymDetail.contentTab.rewardsLoadFailed', "Couldn't load the rewards catalog")}</h3>
              <p className="text-[12px] text-[#6B7280] max-w-sm mx-auto">
                {t('platform.gymDetail.contentTab.rewardsLoadFailedDesc', 'Reload the page to try again. If this persists, the gym_rewards read policy (migration 0542) may not be applied yet.')}
              </p>
            </div>
          ) : Array.isArray(rewardsAvailable) && rewardsAvailable.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl py-16 text-center">
              <Gift className="w-8 h-8 text-[#6B7280] mx-auto mb-3" />
              <p className="text-[#6B7280] text-sm">{t('platform.gymDetail.contentTab.noRewards')}</p>
            </div>
          ) : Array.isArray(rewardsAvailable) ? (
            <div className="space-y-3">
              {rewardsAvailable.map(r => {
                const isEs = i18n.language?.startsWith('es');
                const name = (isEs ? r.name_es : null) || r.name || t('platform.gymDetail.contentTab.rewardFallback');
                const description = (isEs ? r.description_es : null) || r.description;
                return (
                  <div key={r.id} className={`bg-[#0F172A] border border-white/6 rounded-xl p-4 ${r.is_active === false ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0 text-[18px]">
                        {r.emoji_icon || <Gift className="w-5 h-5 text-[#D4AF37]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-[13px] font-semibold text-[#E5E7EB] truncate">{name}</h4>
                          {r.is_active === false && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/6 text-[#9CA3AF] border border-white/10">
                              {t('platform.gymDetail.contentTab.rewardInactive', 'Inactive')}
                            </span>
                          )}
                        </div>
                        {description && (
                          <p className="text-[12px] text-[#6B7280] line-clamp-1">{description}</p>
                        )}
                      </div>
                      <span className="text-[12px] font-semibold text-[#D4AF37] bg-[#D4AF37]/10 px-3 py-1 rounded-lg whitespace-nowrap">
                        {(r.cost_points ?? 0).toLocaleString()} {t('platform.gymDetail.contentTab.pointsSuffix')}
                      </span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => toggleRewardActive(r)} title={r.is_active === false ? t('platform.gymDetail.contentTab.activate', 'Activate') : t('platform.gymDetail.contentTab.deactivate', 'Deactivate')} aria-label={r.is_active === false ? t('platform.gymDetail.contentTab.activate', 'Activate') : t('platform.gymDetail.contentTab.deactivate', 'Deactivate')} className="p-1.5 rounded-lg text-[#6B7280] hover:bg-white/[0.04] transition-colors">
                          {r.is_active === false ? <ToggleLeft className="w-4 h-4" /> : <ToggleRight className="w-4 h-4 text-[#D4AF37]" />}
                        </button>
                        <button onClick={() => { setEditingReward(r); setShowRewardModal(true); }} title={t('platform.gymDetail.contentTab.edit', 'Edit')} aria-label={t('platform.gymDetail.contentTab.edit', 'Edit')} className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#E5E7EB] hover:bg-white/[0.04] transition-colors">
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteConfirm({ type: 'reward', id: r.id, name: r.name })} title={t('platform.gymDetail.contentTab.delete', 'Delete')} aria-label={t('platform.gymDetail.contentTab.delete', 'Delete')} className="p-1.5 rounded-lg text-[#6B7280] hover:text-red-400 hover:bg-red-500/10 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
