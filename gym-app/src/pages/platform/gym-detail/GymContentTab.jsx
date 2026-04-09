import { useState } from 'react';
import {
  Users, Trophy, BookOpen, Award, Gift, Plus,
  Edit3, Trash2, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';

const CHALLENGE_STATUS_STYLES = {
  active:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  upcoming: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  ended:    'bg-white/6 text-[#6B7280] border-white/10',
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
  setDeleteConfirm,
  initialSubTab,
}) {
  const { t } = useTranslation('pages');
  const [contentSubTab, setContentSubTab] = useState(initialSubTab || 'challenges');

  return (
    <div>
      {/* Content sub-tabs */}
      <div className="flex gap-1 mb-4">
        {[
          { key: 'challenges', label: `Challenges (${challenges.length})` },
          { key: 'programs', label: `Programs (${programs.length})` },
          { key: 'achievements', label: `Achievements (${achievements.length})` },
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
            <h3 className="text-[14px] font-semibold text-[#E5E7EB]">Gym Challenges</h3>
            <button
              onClick={() => { setEditingChallenge(null); setShowChallengeModal(true); }}
              className="flex items-center gap-1.5 bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Challenge
            </button>
          </div>

          {challenges.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl py-16 text-center">
              <Trophy className="w-8 h-8 text-[#6B7280] mx-auto mb-3" />
              <p className="text-[#6B7280] text-sm">No challenges yet. Create your first one!</p>
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
                            {status}
                          </span>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20">
                            {c.type ?? 'general'}
                          </span>
                        </div>
                        {c.description && (
                          <p className="text-[12px] text-[#6B7280] mb-1 line-clamp-1">{c.description}</p>
                        )}
                        <div className="flex items-center gap-4 text-[11px] text-[#6B7280]">
                          {c.start_date && <span>Start: {format(new Date(c.start_date), 'MMM d, yyyy')}</span>}
                          {c.end_date && <span>End: {format(new Date(c.end_date), 'MMM d, yyyy')}</span>}
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {participantCount} participants
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditingChallenge(c); setShowChallengeModal(true); }}
                          className="p-1.5 rounded-lg hover:bg-white/6 text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
                          aria-label="Edit challenge"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({ type: 'challenge', id: c.id, name: c.name })}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors"
                          aria-label="Delete challenge"
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
            <h3 className="text-[14px] font-semibold text-[#E5E7EB]">Gym Programs</h3>
            <button
              onClick={() => { setEditingProgram(null); setShowProgramModal(true); }}
              className="flex items-center gap-1.5 bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Program
            </button>
          </div>

          {programs.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl py-16 text-center">
              <BookOpen className="w-8 h-8 text-[#6B7280] mx-auto mb-3" />
              <p className="text-[#6B7280] text-sm">No programs yet. Create your first one!</p>
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
                        {p.difficulty_level && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/6 text-[#9CA3AF] border border-white/10">
                            {p.difficulty_level}
                          </span>
                        )}
                      </div>
                      {p.description && (
                        <p className="text-[12px] text-[#6B7280] mb-1 line-clamp-1">{p.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-[11px] text-[#6B7280]">
                        {p.duration_weeks && <span>{p.duration_weeks} weeks</span>}
                        {p.created_at && <span>Created {format(new Date(p.created_at), 'MMM d, yyyy')}</span>}
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
                        aria-label="Edit program"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm({ type: 'program', id: p.id, name: p.name })}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors"
                        aria-label="Delete program"
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
            <h3 className="text-[14px] font-semibold text-[#E5E7EB]">Achievement Definitions</h3>
            <button
              onClick={() => { setEditingAchievement(null); setShowAchievementModal(true); }}
              className="flex items-center gap-1.5 bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Achievement
            </button>
          </div>

          {achievements.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl py-16 text-center">
              <Award className="w-8 h-8 text-[#6B7280] mx-auto mb-3" />
              <p className="text-[#6B7280] text-sm">No achievements defined yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {achievements.map(a => {
                const earnedCount = a.user_achievements?.length ?? 0;
                return (
                  <div key={a.id} className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="text-[13px] font-semibold text-[#E5E7EB] truncate">{a.name}</h4>
                          {a.type && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20">
                              {a.type}
                            </span>
                          )}
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {earnedCount} earned
                          </span>
                        </div>
                        {a.description && (
                          <p className="text-[12px] text-[#6B7280] mb-1 line-clamp-1">{a.description}</p>
                        )}
                        {a.requirement_value != null && (
                          <span className="text-[11px] text-[#6B7280]">
                            Requirement: {a.requirement_value}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditingAchievement(a); setShowAchievementModal(true); }}
                          className="p-1.5 rounded-lg hover:bg-white/6 text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
                          aria-label="Edit achievement"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({ type: 'achievement', id: a.id, name: a.name })}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors"
                          aria-label="Delete achievement"
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
          {rewardsAvailable === false ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl py-20 text-center">
              <Gift className="w-10 h-10 text-[#D4AF37]/40 mx-auto mb-4" />
              <h3 className="text-[15px] font-semibold text-[#E5E7EB] mb-2">Rewards System Coming Soon</h3>
              <p className="text-[12px] text-[#6B7280] max-w-sm mx-auto">
                The rewards and points system is under development. Members will be able to earn and redeem points for achievements, challenges, and consistency.
              </p>
            </div>
          ) : Array.isArray(rewardsAvailable) && rewardsAvailable.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-xl py-16 text-center">
              <Gift className="w-8 h-8 text-[#6B7280] mx-auto mb-3" />
              <p className="text-[#6B7280] text-sm">No reward items configured for this gym.</p>
            </div>
          ) : Array.isArray(rewardsAvailable) ? (
            <div className="space-y-3">
              {rewardsAvailable.map(r => (
                <div key={r.id} className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                      <Gift className="w-5 h-5 text-[#D4AF37]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-[13px] font-semibold text-[#E5E7EB] truncate">{r.name ?? r.title ?? 'Reward'}</h4>
                      {r.description && (
                        <p className="text-[12px] text-[#6B7280] line-clamp-1">{r.description}</p>
                      )}
                    </div>
                    {r.points != null && (
                      <span className="text-[12px] font-semibold text-[#D4AF37] bg-[#D4AF37]/10 px-3 py-1 rounded-lg">
                        {r.points} pts
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
