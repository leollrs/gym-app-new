import { useState } from 'react';
import { Users, ChevronDown, Phone, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { Avatar } from '../../../components/admin';
import { RiskBadge, ScoreBar } from '../../../components/admin/StatusBadge';
import { translateSignal, translateSignalName } from '../../../lib/churn/signalI18n';
import { outcomeConfig, METHOD_I18N } from './churnDisplay';

/**
 * Right-pane "member detail" view used by AdminChurn's at-risk tab.
 *
 * Renders churn signals (detailed + healthy collapsible), contact history,
 * win-back attempt log, and action buttons (Contact / Win-Back). Receives
 * the i18n `t` function via prop so it stays a pure presentational component
 * — no internal data fetching, all data sources passed down by the parent.
 */
export default function MemberDetailPanel({ member, contactLogs, contactedIds, winBackAttempts, onMessage, onContact, onWinBack, t, dateFnsLocaleOpt = {} }) {
  const [showHealthy, setShowHealthy] = useState(false);

  if (!member) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="w-14 h-14 rounded-2xl bg-white/4 flex items-center justify-center mb-4">
          <Users size={24} className="text-[#4B5563]" />
        </div>
        <p className="text-[14px] font-semibold text-[#6B7280] mb-1">{t('admin.churn.detailEmpty', 'Select a member')}</p>
        <p className="text-[12px] text-[#4B5563]">{t('admin.churn.detailEmptySub', 'Click a row to view details')}</p>
      </div>
    );
  }

  const riskTier = member.churnScore >= 80 ? 'critical' : member.churnScore >= 55 ? 'high' : 'medium';
  const daysInactive = member.daysSinceLastCheckIn != null ? Math.round(member.daysSinceLastCheckIn) : member.daysSinceLastActivity != null ? Math.round(member.daysSinceLastActivity) : null;
  const tenureMonths = member.tenureMonths != null ? Math.round(member.tenureMonths) : null;
  const isContacted = contactedIds.has(member.id);

  const activityStatus = daysInactive === null
    ? t('admin.churn.neverActive', 'Never active')
    : daysInactive < 1
      ? t('admin.churn.activeToday', 'Active today')
      : daysInactive <= 7
        ? t('admin.churn.recentlyActive', 'Recently active')
        : t('admin.churn.inactive', 'Inactive');

  const activityColor = daysInactive === null ? 'var(--color-text-muted)' : daysInactive < 1 ? 'var(--color-success, #10B981)' : daysInactive <= 7 ? 'var(--color-warning)' : 'var(--color-danger, #EF4444)';

  // Contact history for this member
  const memberContactLogs = contactLogs
    .filter(l => l.member_id === member.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);

  // Win-back attempts for this member
  const memberWinBacks = winBackAttempts
    .filter(a => a.user_id === member.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 3);

  const signals = member.keySignals || [member.keySignal].filter(Boolean);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header: Avatar + Name + Badge + Score */}
      <div className="px-4 pt-4 pb-3 border-b border-white/6">
        <div className="flex items-center gap-2.5">
          <Avatar name={member.full_name} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[14px] font-bold text-[#E5E7EB] truncate">{member.full_name}</p>
              <RiskBadge tier={riskTier} />
            </div>
            {member.username && member.username !== member.full_name && (
              <p className="text-[11px] text-[#6B7280] truncate">@{member.username}</p>
            )}
          </div>
        </div>
        <div className="mt-2.5">
          <ScoreBar score={member.churnScore} />
        </div>
      </div>

      {/* Inline Stats */}
      <div className="px-4 py-3 border-b border-white/6">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className="text-[9px] font-semibold text-[#4B5563] uppercase tracking-wider">{t('admin.churn.daysInactive', 'Days Inactive')}</p>
            <p className="text-[15px] font-bold text-[#E5E7EB]">{daysInactive ?? '—'}</p>
          </div>
          <div>
            <p className="text-[9px] font-semibold text-[#4B5563] uppercase tracking-wider">{t('admin.churn.tenure', 'Tenure (mo)')}</p>
            <p className="text-[15px] font-bold text-[#E5E7EB]">{tenureMonths ?? '—'}</p>
          </div>
          <div>
            <p className="text-[9px] font-semibold text-[#4B5563] uppercase tracking-wider">{t('admin.churn.activity', 'Activity')}</p>
            <p className="text-[12px] font-bold mt-0.5" style={{ color: activityColor }}>{activityStatus}</p>
          </div>
        </div>
      </div>

      {/* Signal Breakdown — full detail */}
      {member.signals && (
        <div className="px-4 py-2.5 border-b border-white/6">
          {(() => {
            const entries = Object.entries(member.signals);
            const contributing = entries.filter(([, s]) => s.score > 0).sort((a, b) => (b[1].weightedScore ?? b[1].score) - (a[1].weightedScore ?? a[1].score));
            const healthy = entries.filter(([, s]) => s.score <= 0);
            return (
              <>
                {contributing.length > 0 && (
                  <>
                    <p className="text-[9px] font-semibold text-[#4B5563] uppercase tracking-wider mb-1.5">{t('admin.churnSignals.contributingFactors', 'Contributing Factors')}</p>
                    <div className="space-y-1.5">
                      {contributing.map(([key, s]) => {
                        const pct = s.maxPts > 0 ? Math.min(100, (s.score / s.maxPts) * 100) : 0;
                        const barColor = pct >= 70 ? 'var(--color-danger)' : pct >= 40 ? 'var(--color-warning)' : 'var(--color-admin-text-sub)';
                        return (
                          <div key={key}>
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] font-semibold text-[#E5E7EB]">{translateSignalName(t, key)}</span>
                              <span className="text-[9px] font-bold tabular-nums" style={{ color: barColor }}>{s.score}/{s.maxPts}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-white/6 overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                            </div>
                            <p className="text-[9px] text-[#6B7280] mt-0.5 truncate">{s.label}</p>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                {healthy.length > 0 && (
                  <div className="mt-2">
                    <button onClick={() => setShowHealthy(p => !p)} className="flex items-center gap-1 text-[9px] font-semibold text-[#4B5563] uppercase tracking-wider hover:text-[#9CA3AF] transition-colors">
                      {t('admin.churnSignals.healthySignals', 'Healthy Signals')} ({healthy.length})
                      <ChevronDown size={10} className={`transition-transform ${showHealthy ? 'rotate-180' : ''}`} />
                    </button>
                    {showHealthy && (
                      <div className="space-y-1 mt-1.5">
                        {healthy.map(([key, s]) => (
                          <div key={key} className="flex items-center justify-between">
                            <span className="text-[10px] text-[#6B7280]">{translateSignalName(t, key)}</span>
                            <span className="text-[9px] text-[#10B981] font-medium">{s.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
      {/* Fallback: key signal pills when detailed signals unavailable */}
      {!member.signals && signals.length > 0 && (
        <div className="px-4 py-2.5 border-b border-white/6">
          <div className="flex flex-wrap gap-1">
            {signals.map((sig, i) => (
              <span key={i} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/5 text-[#9CA3AF] border border-white/8">
                {translateSignal(t, sig)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Contact History */}
      <div className="px-4 py-2.5 border-b border-white/6">
        <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-1.5">{t('admin.churn.contactHistory', 'Contact History')}</p>
        {memberContactLogs.length === 0 && memberWinBacks.length === 0 ? (
          <p className="text-[11px] text-[#4B5563] italic">{t('admin.churn.noContactHistory', 'No contact history')}</p>
        ) : (
          <div className="space-y-1">
            {memberContactLogs.map(log => {
              const parts = log.note?.split('\n---\n');
              const subject = parts?.[0] || null;
              const body = parts?.[1] || null;
              return (
                <details key={log.id} className="group">
                  <summary className="flex items-center gap-2 text-[11px] cursor-pointer list-none">
                    <div className="w-1 h-1 rounded-full bg-[#D4AF37] flex-shrink-0" />
                    <span className="font-medium text-[#E5E7EB]">{METHOD_I18N[log.method] ? t(METHOD_I18N[log.method]) : log.method}</span>
                    {subject && <span className="text-[#6B7280] truncate flex-1 min-w-0">— {subject}</span>}
                    <span className="text-[#4B5563] ml-auto flex-shrink-0">{format(new Date(log.created_at), 'MMM d', dateFnsLocaleOpt)}</span>
                  </summary>
                  {body && (
                    <div className="ml-3 mt-1 mb-1.5 pl-2 border-l border-white/6">
                      <p className="text-[10px] text-[#6B7280] whitespace-pre-line line-clamp-4">{body}</p>
                    </div>
                  )}
                </details>
              );
            })}
            {memberWinBacks.map(wb => {
              const outCfg = outcomeConfig[wb.outcome] || outcomeConfig.pending;
              return (
                <details key={wb.id} className="group">
                  <summary className="flex items-center gap-2 text-[11px] cursor-pointer list-none">
                    <div className="w-1 h-1 rounded-full bg-[#EF4444] flex-shrink-0" />
                    <span className="font-medium text-[#E5E7EB]">{t('admin.churn.winBackAttempt', 'Win-Back')}</span>
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border" style={{ color: outCfg.color, background: outCfg.bg, borderColor: `${outCfg.color}33` }}>{t(outCfg.i18nKey)}</span>
                    <span className="text-[#4B5563] ml-auto flex-shrink-0">{format(new Date(wb.created_at), 'MMM d', dateFnsLocaleOpt)}</span>
                  </summary>
                  {wb.message && (
                    <div className="ml-3 mt-1 mb-1.5 pl-2 border-l border-white/6">
                      <p className="text-[10px] text-[#6B7280] whitespace-pre-line line-clamp-4">{wb.message}</p>
                      {wb.offer && <p className="text-[10px] text-[#D4AF37] mt-0.5">{wb.offer}</p>}
                    </div>
                  )}
                </details>
              );
            })}
          </div>
        )}
      </div>

      {/* Action Buttons — compact row */}
      <div className="px-4 py-3 mt-auto">
        <div className="flex gap-2">
          <button onClick={() => onContact(member)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-semibold border transition-colors ${isContacted ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20' : 'bg-[#D4AF37]/12 text-[#D4AF37] border-[#D4AF37]/25 hover:bg-[#D4AF37]/20'}`}>
            <Phone size={12} /> {isContacted ? t('admin.churn.contacted', 'Contacted') : t('admin.churn.contact', 'Contact')}
          </button>
          {member.churnScore >= 55 && (
            <button onClick={() => onWinBack(member)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-semibold bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20 hover:bg-[#EF4444]/18 transition-colors">
              <RotateCcw size={12} /> {t('admin.churn.winBack', 'Win Back')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
