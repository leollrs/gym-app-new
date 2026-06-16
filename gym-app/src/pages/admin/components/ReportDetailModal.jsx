import { useTranslation } from 'react-i18next';
import { es as esLocale } from 'date-fns/locale/es';
import { Flag, CheckCircle, XCircle, Lock } from 'lucide-react';
import { AdminModal, Avatar, SectionLabel } from '../../../components/admin';
import { sanitize } from '../../../lib/sanitize';
import {
  postTypeBadge, getContentTypeChip, getReportStatus, getReasonLabel,
  relativeTime, dataPreview,
} from './moderationHelpers';

/**
 * Detail view for a `content_reports` row — used by the Reports tab on
 * AdminModeration to drill into a flagged piece of content.
 *
 * Renders differently per `content_type`:
 *   - `activity` → embedded post card with type badge + data summary
 *   - `comment`  → comment body with author + parent-feed-item ref
 *   - `message`  → privacy-respecting placeholder (DMs are encrypted)
 *   - `profile`  → reported user card with a pointer to Members admin
 *
 * Action buttons appear only when status is 'pending': "Remove Content"
 * (for activity/comment — soft-deletes the row) or "Mark Actioned" (for
 * message/profile — admin follows up manually) plus "Dismiss Report".
 */
export default function ReportDetailModal({ report, isOpen, onClose, onAction, acting }) {
  const { t, i18n } = useTranslation('pages');
  const dateFnsOpts = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;
  if (!report) return null;

  const reporter = report.profiles;
  const contentType = report.content_type || 'activity';
  const feedItem  = report.activity_feed_items ?? null;
  const comment   = report.reported_comment ?? null;
  const targetUser = report.reported_profile ?? null;
  const author    = feedItem?.profiles ?? null;
  const badge     = postTypeBadge(feedItem?.type, t);
  const typeChip  = getContentTypeChip(contentType, t);
  const TypeIcon  = typeChip.icon;
  const status    = getReportStatus(report.status, t);
  const isPending = report.status === 'pending';

  // Whether "Remove Content" makes sense for this report type.
  // - activity / comment : we can soft-delete the row directly.
  // - message / profile  : DM bodies are encrypted, profiles aren't deletable
  //   from this surface. Admin marks Actioned and follows up manually.
  const canRemoveContent = contentType === 'activity' || contentType === 'comment';

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={onClose}
      title={t('admin.moderation.reportDetail', { defaultValue: 'Report Detail' })}
      titleIcon={Flag}
      size="md"
      footer={isPending ? (
        <>
          <button
            onClick={() => onAction(report, 'actioned')}
            disabled={acting}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-[13px] bg-red-500/15 text-red-400 border border-red-500/20 hover:bg-red-500/25 transition-colors disabled:opacity-40"
          >
            <XCircle size={15} />
            {canRemoveContent
              ? t('admin.moderation.actionRemove', { defaultValue: 'Remove Content' })
              : t('admin.moderation.markActioned', { defaultValue: 'Mark Actioned' })}
          </button>
          <button
            onClick={() => onAction(report, 'dismissed')}
            disabled={acting}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-[13px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors disabled:opacity-40"
          >
            <CheckCircle size={15} />
            {t('admin.moderation.dismiss', { defaultValue: 'Dismiss Report' })}
          </button>
        </>
      ) : null}
    >
      <div className="space-y-5">
        {/* Status banner */}
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${status.color}`}>
          <span className={`w-2 h-2 rounded-full ${status.dot}`} />
          <span className="text-[13px] font-semibold">{status.label}</span>
          {report.reviewed_at && (
            <span className="text-[11px] opacity-70 ml-auto">
              {t('admin.moderation.reviewed', { defaultValue: 'Reviewed' })} {relativeTime(report.reviewed_at, dateFnsOpts)}
            </span>
          )}
        </div>

        {/* Reporter + content-type chip */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <SectionLabel>{t('admin.moderation.reportedBy', { defaultValue: 'Reported By' })}</SectionLabel>
            <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-0.5 rounded-full ${typeChip.color}`}>
              <TypeIcon size={10} />
              {typeChip.label}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <Avatar name={reporter?.full_name} size="md" variant="accent" />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-admin-text)' }}>{reporter?.full_name ?? t('admin.moderation.unknownUser', { defaultValue: 'Unknown' })}</p>
              <p className="text-[12px]" style={{ color: 'var(--color-admin-text-faint)' }}>@{reporter?.username ?? '—'}</p>
            </div>
            <span className="ml-auto text-[11px]" style={{ color: 'var(--color-admin-text-faint)' }}>{relativeTime(report.created_at, dateFnsOpts)}</span>
          </div>
        </div>

        {/* Reason */}
        <div>
          <SectionLabel>{t('admin.moderation.reason', { defaultValue: 'Reason' })}</SectionLabel>
          <p className="mt-2 text-[13px] leading-relaxed bg-white/[0.03] rounded-xl p-3 border border-white/6" style={{ color: 'var(--color-admin-text)' }}>
            {getReasonLabel(report.reason, t)}
          </p>
        </div>

        {/* Reported content — varies by content_type */}
        {contentType === 'activity' && feedItem && (
          <div>
            <SectionLabel>{t('admin.moderation.reportedContent', { defaultValue: 'Reported Content' })}</SectionLabel>
            <div className="mt-2 bg-white/[0.03] rounded-xl p-4 border border-white/6">
              <div className="flex items-center gap-2 mb-2">
                {author && (
                  <>
                    <Avatar name={author.full_name} size="sm" variant="accent" />
                    <span className="text-[13px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>{author.full_name ?? t('admin.moderation.unknownUser', { defaultValue: 'Unknown' })}</span>
                  </>
                )}
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${badge.color}`}>
                  {badge.label}
                </span>
                {feedItem.is_deleted && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-red-400 bg-red-500/10">
                    {t('admin.moderation.deleted', { defaultValue: 'Deleted' })}
                  </span>
                )}
              </div>
              {dataPreview(feedItem.type, feedItem.data, t) && (
                <p className="text-[12px]" style={{ color: 'var(--color-admin-text-muted)' }}>{dataPreview(feedItem.type, feedItem.data, t)}</p>
              )}
              <p className="text-[11px] mt-1" style={{ color: 'var(--color-admin-text-faint)' }}>{relativeTime(feedItem.created_at, dateFnsOpts)}</p>
            </div>
          </div>
        )}

        {contentType === 'comment' && (
          <div>
            <SectionLabel>{t('admin.moderation.reportedComment', { defaultValue: 'Reported Comment' })}</SectionLabel>
            {comment ? (
              <div className="mt-2 bg-white/[0.03] rounded-xl p-4 border border-white/6">
                <div className="flex items-center gap-2 mb-2">
                  <Avatar
                    name={comment.profiles?.full_name}
                    src={comment.profiles?.avatar_url}
                    size="sm"
                    variant="accent"
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-admin-text)' }}>
                      {comment.profiles?.full_name ?? t('admin.moderation.unknownUser', { defaultValue: 'Unknown' })}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--color-admin-text-faint)' }}>@{comment.profiles?.username ?? '—'}</p>
                  </div>
                  {comment.is_deleted && (
                    <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full text-red-400 bg-red-500/10">
                      {t('admin.moderation.deleted', { defaultValue: 'Deleted' })}
                    </span>
                  )}
                </div>
                <p className="text-[12.5px] leading-relaxed line-clamp-5 break-words" style={{ color: 'var(--color-admin-text)' }}>
                  {sanitize(comment.content)}
                </p>
                {comment.feed_item_id && (
                  <p className="text-[11px] mt-2" style={{ color: 'var(--color-admin-text-faint)' }}>
                    {t('admin.moderation.postedIn', { defaultValue: 'Posted in activity' })}: {comment.feed_item_id.slice(0, 8)}…
                  </p>
                )}
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-admin-text-faint)' }}>{relativeTime(comment.created_at, dateFnsOpts)}</p>
              </div>
            ) : (
              <p className="mt-2 text-[12px] italic" style={{ color: 'var(--color-admin-text-faint)' }}>
                {t('admin.moderation.commentMissing', { defaultValue: 'Comment no longer exists.' })}
              </p>
            )}
          </div>
        )}

        {contentType === 'message' && (
          <div>
            <SectionLabel>{t('admin.moderation.reportedMessage', { defaultValue: 'Reported Message' })}</SectionLabel>
            <div className="mt-2 bg-white/[0.03] rounded-xl p-4 border border-white/6">
              <div className="flex items-center gap-2" style={{ color: 'var(--color-admin-text-muted)' }}>
                <Lock size={13} />
                <span className="text-[12px] font-semibold">
                  {t('admin.moderation.messagePrivate', { defaultValue: 'Direct message — content private (encrypted).' })}
                </span>
              </div>
              <p className="text-[11.5px] mt-2 leading-relaxed" style={{ color: 'var(--color-admin-text-faint)' }}>
                {t('admin.moderation.messageGuidance', { defaultValue: 'DM bodies are encrypted at rest and aren\'t shown here. Use the reporter and reason below to decide whether to suspend the sender or block them via member management.' })}
              </p>
            </div>
          </div>
        )}

        {contentType === 'profile' && (
          <div>
            <SectionLabel>{t('admin.moderation.reportedProfile', { defaultValue: 'Reported Profile' })}</SectionLabel>
            {targetUser ? (
              <div className="mt-2 bg-white/[0.03] rounded-xl p-4 border border-white/6">
                <div className="flex items-center gap-3">
                  <Avatar
                    name={targetUser.full_name}
                    src={targetUser.avatar_url}
                    size="md"
                    variant="accent"
                  />
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--color-admin-text)' }}>
                      {targetUser.full_name ?? t('admin.moderation.unknownUser', { defaultValue: 'Unknown' })}
                    </p>
                    <p className="text-[11.5px]" style={{ color: 'var(--color-admin-text-faint)' }}>@{targetUser.username ?? '—'}</p>
                  </div>
                </div>
                <p className="text-[11px] mt-3" style={{ color: 'var(--color-admin-text-faint)' }}>
                  {t('admin.moderation.profileGuidance', { defaultValue: 'Review the member in the Members admin page to suspend, message, or remove their access.' })}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-[12px] italic" style={{ color: 'var(--color-admin-text-faint)' }}>
                {t('admin.moderation.profileMissing', { defaultValue: 'Profile no longer exists.' })}
              </p>
            )}
          </div>
        )}
      </div>
    </AdminModal>
  );
}
