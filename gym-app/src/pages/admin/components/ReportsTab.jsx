import { useEffect, useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { es as esLocale } from 'date-fns/locale/es';
import { Flag, XCircle, CheckCircle, Eye } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import { AdminCard, AdminTable, FilterBar, Skeleton, ErrorCard, Avatar } from '../../../components/admin';
import {
  postTypeBadge, relativeTime, getReportStatus, getContentTypeChip, getReasonLabel,
} from './moderationHelpers';
import ReportDetailModal from './ReportDetailModal';
import { fetchReports } from '../../../lib/admin/moderationQueries';
import usePagedVisible from '../../../hooks/usePagedVisible';
import PaginationFooter from '../../../components/admin/PaginationFooter';

/**
 * "Reports" tab on AdminModeration — last 50 `content_reports` rows with
 * realtime updates (postgres_changes) so the inbox stays current
 * without a manual refresh.
 *
 * On `actioned` status:
 *   - activity → soft-delete the feed item
 *   - comment  → soft-delete the comment
 *   - message  → no auto-delete (DMs are encrypted; admin handles via Members)
 *   - profile  → no auto-delete (use Members admin for suspend/ban)
 *
 * The row-action buttons are inline on desktop. Clicking anywhere on a
 * row opens the ReportDetailModal which has the same actions plus
 * richer context for non-pending entries.
 */
export default function ReportsTab({ gymId }) {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('pages');
  const dateFnsOpts = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;
  const [filter, setFilter] = useState('all');
  const [acting, setActing] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const pager = usePagedVisible({ initial: 10, step: 10 });

  const { data: reports = [], isLoading, error, refetch } = useQuery({
    queryKey: [...adminKeys.moderation(gymId), 'reports'],
    queryFn: () => fetchReports(gymId),
    enabled: !!gymId,
  });

  // Realtime: refetch the reports list whenever a new content_report lands or
  // an existing one is reviewed. Without this, admin had to manually refresh.
  useEffect(() => {
    if (!gymId) return;
    const channel = supabase.channel(`mod-reports-${gymId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'content_reports', filter: `gym_id=eq.${gymId}` },
        () => refetch()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [gymId, refetch]);

  const handleUpdateStatus = async (report, newStatus) => {
    setActing(report.id);
    await supabase
      .from('content_reports')
      .update({ status: newStatus, reviewed_at: new Date().toISOString() })
      .eq('id', report.id);

    // If actioned, soft-delete the underlying content based on its type.
    // - activity : soft-delete the feed item (existing behavior).
    // - comment  : soft-delete the comment row (matches StrataFeedCard pattern).
    // - message  : NOT auto-deletable. `direct_messages` has no `is_deleted`
    //              column today (see migration 0161). Admin must remove the
    //              DM by blocking the user via Members admin, which severs
    //              the conversation via RLS. Adding column is a multi-table
    //              change (RLS + every SELECT + encryption layer) — defer.
    // - profile  : NOT auto-deletable. Profile-level moderation should go
    //              through Members admin (suspend / ban / remove) so the
    //              admin can pick the right severity rather than auto-delete.
    if (newStatus === 'actioned') {
      const ct = report.content_type || 'activity';
      if (ct === 'activity' && report.feed_item_id) {
        await supabase
          .from('activity_feed_items')
          .update({ is_deleted: true })
          .eq('id', report.feed_item_id);
      } else if (ct === 'comment' && report.content_id) {
        await supabase
          .from('feed_comments')
          .update({ is_deleted: true })
          .eq('id', report.content_id);
      }
      // message / profile : no automatic delete.
    }

    // Audit trail — fire-and-forget. Records who reviewed which report,
    // the new status, the reason, and the underlying content type/id so
    // moderation decisions are reviewable in the platform-level audit log.
    logAdminAction('moderation', 'content_report', report.id, {
      report_id: report.id,
      content_type: report.content_type || 'activity',
      content_id: report.content_id || report.feed_item_id || null,
      previous_status: report.status,
      new_status: newStatus,
      reason: report.reason || null,
    });

    queryClient.setQueryData([...adminKeys.moderation(gymId), 'reports'], (old) =>
      (old || []).map(r => r.id === report.id ? { ...r, status: newStatus, reviewed_at: new Date().toISOString() } : r)
    );
    setActing(null);
    setSelectedReport(null);
  };

  const total    = reports.length;
  const pending  = reports.filter(r => r.status === 'pending').length;
  const resolved = reports.filter(r => r.status !== 'pending').length;

  const filtered = useMemo(() => {
    if (filter === 'pending')  return reports.filter(r => r.status === 'pending');
    if (filter === 'resolved') return reports.filter(r => r.status !== 'pending');
    return reports;
  }, [reports, filter]);

  if (isLoading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-[14px]" />)}</div>;
  if (error) return <ErrorCard message={t('admin.moderation.reportsFailed', { defaultValue: 'Failed to load reports' })} onRetry={refetch} />;

  const filterOptions = [
    { key: 'all',      label: t('admin.moderation.all', { defaultValue: 'All' }),      count: total },
    { key: 'pending',  label: t('admin.moderation.pending', { defaultValue: 'Pending' }),  count: pending },
    { key: 'resolved', label: t('admin.moderation.resolved', { defaultValue: 'Resolved' }), count: resolved },
  ];

  const columns = [
    {
      key: 'reporter',
      label: t('admin.moderation.reporter', { defaultValue: 'Reporter' }),
      render: (row) => {
        const profile = row.profiles;
        return (
          <div className="flex items-center gap-2.5">
            <Avatar name={profile?.full_name} size="sm" variant="accent" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">{profile?.full_name ?? t('admin.moderation.unknownUser', { defaultValue: 'Unknown' })}</p>
              <p className="text-[11px] text-[#6B7280]">@{profile?.username ?? '—'}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: 'reason',
      label: t('admin.moderation.reason', { defaultValue: 'Reason' }),
      render: (row) => {
        const isAutoFlagged = typeof row.details === 'string' && row.details.startsWith('Auto-flagged by content filter:');
        return (
          <div className="flex items-center gap-1.5 max-w-[260px]">
            <p className="text-[12px] text-[#E5E7EB] truncate">{getReasonLabel(row.reason, t)}</p>
            {isAutoFlagged && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-amber-300 bg-amber-500/10 border border-amber-500/20 flex-shrink-0">
                {t('admin.moderation.autoFlagged', { defaultValue: '🤖 Auto' })}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'reported_post',
      label: t('admin.moderation.reportedContent', { defaultValue: 'Reported Content' }),
      headerClassName: 'hidden md:table-cell',
      className: 'hidden md:table-cell text-[#E5E7EB]',
      render: (row) => {
        const ct = row.content_type || 'activity';
        const typeChip = getContentTypeChip(ct, t);
        const TypeIcon = typeChip.icon;
        const feedItem = row.activity_feed_items;
        const author = feedItem?.profiles
          ?? row.reported_comment?.profiles
          ?? row.reported_profile
          ?? null;
        return (
          <div className="flex items-center gap-2 min-w-0">
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${typeChip.color}`}>
              <TypeIcon size={10} />
              {typeChip.label}
            </span>
            {author && (
              <span className="text-[11px] text-[#9CA3AF] truncate">{author.full_name ?? `@${author.username ?? ''}`}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      label: t('admin.moderation.status', { defaultValue: 'Status' }),
      sortable: true,
      render: (row) => {
        const status = getReportStatus(row.status, t);
        return (
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
            <span className={`text-[11px] font-bold ${status.color.split(' ')[0]}`}>{status.label}</span>
          </div>
        );
      },
    },
    {
      key: 'created_at',
      label: t('admin.moderation.date', { defaultValue: 'Date' }),
      sortable: true,
      headerClassName: 'hidden md:table-cell',
      className: 'hidden md:table-cell text-[#E5E7EB]',
      sortValue: (row) => new Date(row.created_at).getTime(),
      render: (row) => (
        <span className="text-[12px] text-[#6B7280]">{relativeTime(row.created_at, dateFnsOpts)}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      headerClassName: 'w-28 hidden md:table-cell',
      className: 'hidden md:table-cell text-[#E5E7EB]',
      render: (row) => {
        const isPending = row.status === 'pending';
        const busy = acting === row.id;
        return isPending ? (
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); handleUpdateStatus(row, 'actioned'); }}
              disabled={busy}
              title={t('admin.moderation.actionRemove', { defaultValue: 'Remove Content' })}
              aria-label={t('admin.moderation.actionRemove', { defaultValue: 'Remove Content' })}
              className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-40"
            >
              <XCircle size={15} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleUpdateStatus(row, 'dismissed'); }}
              disabled={busy}
              title={t('admin.moderation.dismiss', { defaultValue: 'Dismiss' })}
              aria-label={t('admin.moderation.dismiss', { defaultValue: 'Dismiss' })}
              className="p-2 rounded-lg text-[#6B7280] hover:text-emerald-400 hover:bg-emerald-500/10 transition-all disabled:opacity-40"
            >
              <CheckCircle size={15} />
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setSelectedReport(row); }}
            aria-label={t('admin.moderation.viewReport', { defaultValue: 'View report' })}
            className="p-2 rounded-lg text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/[0.04] transition-all"
          >
            <Eye size={15} />
          </button>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <FilterBar options={filterOptions} active={filter} onChange={setFilter} />

      {/* Desktop table */}
      <div className="hidden md:block">
        <AdminTable
          columns={columns}
          data={filtered.slice(0, pager.visibleCount)}
          loading={false}
          onRowClick={(row) => setSelectedReport(row)}
          emptyState={
            <div className="text-center py-12">
              <Flag size={28} className="text-[#4B5563] mx-auto mb-2" />
              <p className="text-[13px] text-[#6B7280]">{t('admin.moderation.noReports', { defaultValue: 'No reports match this filter' })}</p>
            </div>
          }
        />
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {filtered.length === 0 ? (
          <AdminCard>
            <div className="text-center py-10">
              <Flag size={28} className="text-[#4B5563] mx-auto mb-2" />
              <p className="text-[13px] text-[#6B7280]">{t('admin.moderation.noReports', { defaultValue: 'No reports match this filter' })}</p>
            </div>
          </AdminCard>
        ) : filtered.slice(0, pager.visibleCount).map(row => {
          const reporter = row.profiles;
          const ct = row.content_type || 'activity';
          const typeChip = getContentTypeChip(ct, t);
          const TypeIcon = typeChip.icon;
          const feedItem = row.activity_feed_items;
          const badge = postTypeBadge(feedItem?.type, t);
          const status = getReportStatus(row.status, t);
          const isPending = row.status === 'pending';
          const busy = acting === row.id;
          return (
            <div
              key={row.id}
              onClick={() => setSelectedReport(row)}
              className="admin-card p-3 cursor-pointer"
            >
              <div className="flex items-start gap-2.5 mb-2">
                <Avatar name={reporter?.full_name} size="sm" variant="accent" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">{reporter?.full_name ?? t('admin.moderation.unknownUser', { defaultValue: 'Unknown' })}</p>
                  <p className="text-[11px] text-[#6B7280]">{relativeTime(row.created_at, dateFnsOpts)}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                  <span className={`text-[10.5px] font-bold ${status.color.split(' ')[0]}`}>{status.label}</span>
                </div>
              </div>
              <p className="text-[12px] text-[#E5E7EB] mb-2 line-clamp-2">{getReasonLabel(row.reason, t)}</p>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${typeChip.color}`}>
                  <TypeIcon size={10} />
                  {typeChip.label}
                </span>
                {feedItem && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${badge.color}`}>{badge.label}</span>
                )}
                {typeof row.details === 'string' && row.details.startsWith('Auto-flagged by content filter:') && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-amber-300 bg-amber-500/10 border border-amber-500/20">
                    {t('admin.moderation.autoFlagged', { defaultValue: '🤖 Auto-flagged' })}
                  </span>
                )}
              </div>
              {isPending && (
                <div className="flex items-center gap-1.5 mt-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleUpdateStatus(row, 'actioned'); }}
                    disabled={busy}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11.5px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 disabled:opacity-40"
                  >
                    <XCircle size={13} />
                    {t('admin.moderation.actionRemove', { defaultValue: 'Remove' })}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleUpdateStatus(row, 'dismissed'); }}
                    disabled={busy}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11.5px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 disabled:opacity-40"
                  >
                    <CheckCircle size={13} />
                    {t('admin.moderation.dismiss', { defaultValue: 'Dismiss' })}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <PaginationFooter pager={pager} total={filtered.length} />

      <ReportDetailModal
        report={selectedReport}
        isOpen={!!selectedReport}
        onClose={() => setSelectedReport(null)}
        onAction={handleUpdateStatus}
        acting={!!acting}
      />
    </div>
  );
}
