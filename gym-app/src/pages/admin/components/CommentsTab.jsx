import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { es as esLocale } from 'date-fns/locale/es';
import { MessageSquare, Trash2, RotateCcw } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import { sanitize } from '../../../lib/sanitize';
import { AdminCard, AdminTable, FilterBar, Skeleton, ErrorCard, Avatar } from '../../../components/admin';
import { postTypeBadge, relativeTime } from './moderationHelpers';
import { fetchComments } from '../../../lib/admin/moderationQueries';
import usePagedVisible from '../../../hooks/usePagedVisible';
import PaginationFooter from '../../../components/admin/PaginationFooter';

/**
 * "Comments" tab on AdminModeration — comments belonging to this gym's
 * activity feed, filterable by status. Desktop view uses AdminTable;
 * mobile view drops down to a card list with the same actions.
 *
 * Soft-delete via the same toggle pattern as PostsTab — flips
 * `is_deleted` on `feed_comments` and logs to admin_audit_log.
 */
export default function CommentsTab({ gymId }) {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('pages');
  const dateFnsOpts = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;
  const [filter, setFilter] = useState('all');
  const [acting, setActing] = useState(null);
  const pager = usePagedVisible({ initial: 10, step: 10 });

  const { data: comments = [], isLoading, error, refetch } = useQuery({
    queryKey: [...adminKeys.moderation(gymId), 'comments'],
    queryFn: () => fetchComments(gymId),
    enabled: !!gymId,
  });

  const handleToggleDelete = async (comment) => {
    setActing(comment.id);
    const nextDeleted = !comment.is_deleted;
    await supabase
      .from('feed_comments')
      .update({ is_deleted: nextDeleted })
      .eq('id', comment.id);
    logAdminAction('moderation', 'feed_comment', comment.id, {
      action: nextDeleted ? 'soft_delete' : 'restore',
      author_id: comment.profile_id,
      feed_item_id: comment.feed_item_id || null,
    });
    queryClient.setQueryData([...adminKeys.moderation(gymId), 'comments'], (old) =>
      (old || []).map(c => c.id === comment.id ? { ...c, is_deleted: !c.is_deleted } : c)
    );
    setActing(null);
  };

  const total   = comments.length;
  const active  = comments.filter(c => !c.is_deleted).length;
  const deleted = comments.filter(c =>  c.is_deleted).length;

  const filtered = useMemo(() => {
    if (filter === 'active')  return comments.filter(c => !c.is_deleted);
    if (filter === 'deleted') return comments.filter(c =>  c.is_deleted);
    return comments;
  }, [comments, filter]);

  if (isLoading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-[14px]" />)}</div>;
  if (error) return <ErrorCard message={t('admin.moderation.commentsFailed', { defaultValue: 'Failed to load comments' })} onRetry={refetch} />;

  const filterOptions = [
    { key: 'all',     label: t('admin.moderation.all', { defaultValue: 'All' }),     count: total },
    { key: 'active',  label: t('admin.moderation.active', { defaultValue: 'Active' }),  count: active },
    { key: 'deleted', label: t('admin.moderation.deleted', { defaultValue: 'Deleted' }), count: deleted },
  ];

  const columns = [
    {
      key: 'user',
      label: t('admin.moderation.user', { defaultValue: 'User' }),
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
      key: 'content',
      label: t('admin.moderation.comment', { defaultValue: 'Comment' }),
      render: (row) => (
        <p className="text-[12px] text-[#E5E7EB] truncate max-w-[280px]">{sanitize(row.content)}</p>
      ),
    },
    {
      key: 'context',
      label: t('admin.moderation.onPost', { defaultValue: 'On Post' }),
      headerClassName: 'hidden md:table-cell',
      className: 'hidden md:table-cell text-[#E5E7EB]',
      render: (row) => {
        const feedItem = row.activity_feed_items;
        const badge = postTypeBadge(feedItem?.type, t);
        return feedItem ? (
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full capitalize ${badge.color}`}>
            {badge.label}
          </span>
        ) : <span className="text-[11px] text-[#6B7280]">—</span>;
      },
    },
    {
      key: 'status',
      label: t('admin.moderation.status', { defaultValue: 'Status' }),
      render: (row) => row.is_deleted ? (
        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full text-red-400 bg-red-500/10">
          {t('admin.moderation.deleted', { defaultValue: 'Deleted' })}
        </span>
      ) : (
        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full text-emerald-400 bg-emerald-500/10">
          {t('admin.moderation.live', { defaultValue: 'Live' })}
        </span>
      ),
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
      headerClassName: 'w-12 hidden md:table-cell',
      className: 'hidden md:table-cell text-[#E5E7EB]',
      render: (row) => {
        const busy = acting === row.id;
        return (
          <button
            onClick={(e) => { e.stopPropagation(); handleToggleDelete(row); }}
            disabled={busy}
            title={row.is_deleted ? t('admin.moderation.restore', { defaultValue: 'Restore' }) : t('admin.moderation.delete', { defaultValue: 'Delete' })}
            className={`p-2 rounded-lg transition-all disabled:opacity-40 ${
              row.is_deleted
                ? 'text-emerald-500 hover:bg-emerald-500/10'
                : 'text-[#6B7280] hover:text-red-400 hover:bg-red-500/10'
            }`}
          >
            {row.is_deleted ? <RotateCcw size={15} /> : <Trash2 size={15} />}
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
          emptyState={
            <div className="text-center py-12">
              <MessageSquare size={28} className="text-[#4B5563] mx-auto mb-2" />
              <p className="text-[13px] text-[#6B7280]">{t('admin.moderation.noComments', { defaultValue: 'No comments match this filter' })}</p>
            </div>
          }
        />
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {filtered.length === 0 ? (
          <AdminCard>
            <div className="text-center py-10">
              <MessageSquare size={28} className="text-[#4B5563] mx-auto mb-2" />
              <p className="text-[13px] text-[#6B7280]">{t('admin.moderation.noComments', { defaultValue: 'No comments match this filter' })}</p>
            </div>
          </AdminCard>
        ) : filtered.slice(0, pager.visibleCount).map(row => {
          const profile = row.profiles;
          const feedItem = row.activity_feed_items;
          const badge = postTypeBadge(feedItem?.type, t);
          const busy = acting === row.id;
          return (
            <div key={row.id} className="admin-card p-3">
              <div className="flex items-start gap-2.5 mb-2">
                <Avatar name={profile?.full_name} size="sm" variant="accent" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">{profile?.full_name ?? t('admin.moderation.unknownUser', { defaultValue: 'Unknown' })}</p>
                  <p className="text-[11px] text-[#6B7280]">{relativeTime(row.created_at, dateFnsOpts)}</p>
                </div>
                <button
                  onClick={() => handleToggleDelete(row)}
                  disabled={busy}
                  className={`p-1.5 rounded-lg transition-all disabled:opacity-40 flex-shrink-0 ${
                    row.is_deleted ? 'text-emerald-500 bg-emerald-500/10' : 'text-[#6B7280] bg-white/[0.04]'
                  }`}
                >
                  {row.is_deleted ? <RotateCcw size={14} /> : <Trash2 size={14} />}
                </button>
              </div>
              <p className="text-[12px] text-[#E5E7EB] mb-2 line-clamp-3">{sanitize(row.content)}</p>
              <div className="flex items-center gap-2 flex-wrap">
                {feedItem && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${badge.color}`}>{badge.label}</span>
                )}
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${row.is_deleted ? 'text-red-400 bg-red-500/10' : 'text-emerald-400 bg-emerald-500/10'}`}>
                  {row.is_deleted ? t('admin.moderation.deleted', { defaultValue: 'Deleted' }) : t('admin.moderation.live', { defaultValue: 'Live' })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <PaginationFooter pager={pager} total={filtered.length} />
    </div>
  );
}
