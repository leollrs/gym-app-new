import { useEffect, useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { es as esLocale } from 'date-fns/locale/es';
import { supabase } from '../../../lib/supabase';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import { Skeleton, ErrorCard } from '../../../components/admin';
import {
  relativeTime, getReportStatus, getContentTypeChip, getReasonLabel,
} from './moderationHelpers';
import ReportDetailModal from './ReportDetailModal';
import { fetchReports } from '../../../lib/admin/moderationQueries';
import {
  TK, FK, Ico, Card, MIC, Av, FilterPills, TypeBadge, StatusDot, TH, IconBtn,
  contentTypeVisual, reportStatusTone,
} from './moderationKit';
import AdminPagination from '../../../components/admin/AdminPagination';

const COLS = '1.3fr 1fr 1.4fr 1fr 0.9fr auto';
const PAGE_SIZE = 10;

/**
 * "Reports" tab on AdminModeration — last 50 content_reports with realtime
 * updates. Actioning a pending report soft-deletes the underlying content
 * (activity / comment) and logs to admin_audit_log. Restyled onto
 * moderationKit (desktop grid + mobile cards); the row opens ReportDetailModal.
 */
export default function ReportsTab({ gymId }) {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('pages');
  const dateFnsOpts = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;
  const [filter, setFilter] = useState('all');
  const [acting, setActing] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [filter]);

  const { data: reports = [], isLoading, error, refetch } = useQuery({
    queryKey: [...adminKeys.moderation(gymId), 'reports'],
    queryFn: () => fetchReports(gymId),
    enabled: !!gymId,
  });

  // Realtime: refetch whenever a content_report lands or is reviewed.
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
      .eq('id', report.id)
      .eq('gym_id', gymId); // defense-in-depth: scope to this gym, not RLS alone

    // If actioned, soft-delete the underlying content based on its type.
    if (newStatus === 'actioned') {
      const ct = report.content_type || 'activity';
      if (ct === 'activity' && report.feed_item_id) {
        await supabase
          .from('activity_feed_items')
          .update({ is_deleted: true })
          .eq('id', report.feed_item_id)
          .eq('gym_id', gymId); // defense-in-depth
      } else if (ct === 'comment' && report.content_id) {
        await supabase
          .from('feed_comments')
          .update({ is_deleted: true })
          .eq('id', report.content_id);
      }
      // message / profile : no automatic delete.
    }

    // Audit trail — fire-and-forget.
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

  if (isLoading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-[60px] rounded-[14px]" />)}</div>;
  if (error) return <ErrorCard message={t('admin.moderation.reportsFailed', { defaultValue: 'Failed to load reports' })} onRetry={refetch} />;

  const filterItems = [
    { id: 'all',      label: t('admin.moderation.all', { defaultValue: 'All' }),      count: total },
    { id: 'pending',  label: t('admin.moderation.pending', { defaultValue: 'Pending' }),  count: pending },
    { id: 'resolved', label: t('admin.moderation.resolved', { defaultValue: 'Resolved' }), count: resolved },
  ];
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const isAuto = (row) => typeof row.details === 'string' && row.details.startsWith('Auto-flagged by content filter:');
  const reportedAuthor = (row) =>
    row.activity_feed_items?.profiles ?? row.reported_comment?.profiles ?? row.reported_profile ?? null;

  const AutoPill = () => (
    <span style={{ fontFamily: FK.body, fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999, color: 'var(--color-warning-ink, var(--color-warning))', background: 'var(--color-warning-soft)', border: '1px solid color-mix(in srgb, var(--color-warning) 28%, transparent)', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {t('admin.moderation.autoFlagged', { defaultValue: '🤖 Auto' })}
    </span>
  );

  // Row action cell: pending → remove + dismiss; resolved → view.
  const RowActions = ({ row, stop = false }) => {
    const isPending = row.status === 'pending';
    const busy = acting === row.id;
    const wrap = (fn) => (e) => { if (stop) e.stopPropagation(); fn(); };
    return isPending ? (
      <div style={{ display: 'flex', gap: 7 }}>
        <IconBtn icon={MIC.xCircle} iconColor="var(--color-danger)" disabled={busy} onClick={wrap(() => handleUpdateStatus(row, 'actioned'))} title={t('admin.moderation.actionRemove', { defaultValue: 'Remove Content' })} />
        <IconBtn icon={MIC.check} iconColor="var(--color-success)" disabled={busy} onClick={wrap(() => handleUpdateStatus(row, 'dismissed'))} title={t('admin.moderation.dismiss', { defaultValue: 'Dismiss' })} />
      </div>
    ) : (
      <IconBtn icon={MIC.eye} onClick={wrap(() => setSelectedReport(row))} title={t('admin.moderation.viewReport', { defaultValue: 'View report' })} />
    );
  };

  const emptyState = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '44px 20px' }}>
      <span style={{ width: 46, height: 46, borderRadius: 13, display: 'grid', placeItems: 'center', background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
        <Ico ch={MIC.flag} size={21} color={TK.textFaint} stroke={1.7} />
      </span>
      <span style={{ fontFamily: FK.body, fontSize: 14, fontWeight: 600, color: TK.textSub }}>{t('admin.moderation.noReports', { defaultValue: 'No reports match this filter' })}</span>
    </div>
  );

  return (
    <div>
      <FilterPills items={filterItems} active={filter} onPick={setFilter} />

      {/* Desktop grid table */}
      <div className="hidden md:block">
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '15px 24px', background: TK.surface2 }}>
            <TH>{t('admin.moderation.reporter', { defaultValue: 'Reporter' })}</TH>
            <TH>{t('admin.moderation.reason', { defaultValue: 'Reason' })}</TH>
            <TH>{t('admin.moderation.reportedContent', { defaultValue: 'Reported Content' })}</TH>
            <TH>{t('admin.moderation.status', { defaultValue: 'Status' })}</TH>
            <TH>{t('admin.moderation.date', { defaultValue: 'Date' })}</TH>
            <span />
          </div>
          {filtered.length === 0 ? emptyState : visible.map((row) => {
            const reporter = row.profiles;
            const ct = row.content_type || 'activity';
            const cv = contentTypeVisual(ct);
            const author = reportedAuthor(row);
            const st = getReportStatus(row.status, t);
            const name = reporter?.full_name ?? t('admin.moderation.unknownUser', { defaultValue: 'Unknown' });
            return (
              <div
                key={row.id}
                onClick={() => setSelectedReport(row)}
                style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '16px 24px', borderTop: `1px solid ${TK.divider}`, alignItems: 'center', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <Av name={name} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                    <div style={{ fontFamily: FK.mono, fontSize: 12, color: TK.textFaint, whiteSpace: 'nowrap' }}>@{reporter?.username ?? '—'}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <span style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getReasonLabel(row.reason, t)}</span>
                  {isAuto(row) && <AutoPill />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <TypeBadge tone={cv.tone} icon={cv.icon} label={getContentTypeChip(ct, t).label} />
                  {author && <span style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{author.full_name ?? `@${author.username ?? ''}`}</span>}
                </div>
                <StatusDot tone={reportStatusTone(row.status)} label={st.label} />
                <span style={{ fontFamily: FK.mono, fontSize: 12.5, color: TK.textFaint, whiteSpace: 'nowrap' }}>{relativeTime(row.created_at, dateFnsOpts)}</span>
                <span onClick={(e) => e.stopPropagation()}><RowActions row={row} stop /></span>
              </div>
            );
          })}
          {filtered.length > 0 && (
            <AdminPagination page={safePage + 1} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={(n) => setPage(n - 1)} />
          )}
        </Card>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden flex flex-col gap-2.5">
        {filtered.length === 0 ? <Card>{emptyState}</Card> : visible.map((row) => {
          const reporter = row.profiles;
          const ct = row.content_type || 'activity';
          const cv = contentTypeVisual(ct);
          const st = getReportStatus(row.status, t);
          const name = reporter?.full_name ?? t('admin.moderation.unknownUser', { defaultValue: 'Unknown' });
          return (
            <Card key={row.id} style={{ padding: 14, cursor: 'pointer' }} onClick={() => setSelectedReport(row)}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                <Av name={name} sm />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: FK.body, fontSize: 14, fontWeight: 700, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                  <div style={{ fontFamily: FK.mono, fontSize: 11.5, color: TK.textFaint }}>{relativeTime(row.created_at, dateFnsOpts)}</div>
                </div>
                <StatusDot tone={reportStatusTone(row.status)} label={st.label} />
              </div>
              <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textSub, margin: '0 0 10px' }}>{getReasonLabel(row.reason, t)}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: row.status === 'pending' ? 12 : 0 }}>
                <TypeBadge tone={cv.tone} icon={cv.icon} label={getContentTypeChip(ct, t).label} />
                {isAuto(row) && <AutoPill />}
              </div>
              {row.status === 'pending' && (
                <div onClick={(e) => e.stopPropagation()}><RowActions row={row} stop /></div>
              )}
            </Card>
          );
        })}
        {filtered.length > 0 && (
          <AdminPagination page={safePage + 1} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={(n) => setPage(n - 1)} />
        )}
      </div>

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
