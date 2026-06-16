import { useState, useMemo, useEffect } from 'react';
import posthogClient from 'posthog-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { es as esLocale } from 'date-fns/locale/es';
import { supabase } from '../../../lib/supabase';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import { sanitize } from '../../../lib/sanitize';
import { Skeleton, ErrorCard } from '../../../components/admin';
import { postTypeBadge, relativeTime } from './moderationHelpers';
import { fetchComments } from '../../../lib/admin/moderationQueries';
import { TK, FK, Ico, Card, MIC, Av, FilterPills, TypeBadge, StatusDot, TH, IconBtn, postTypeVisual } from './moderationKit';
import AdminPagination from '../../../components/admin/AdminPagination';

const COLS = '1.3fr 1fr 1fr 0.9fr 0.9fr 44px';
const PAGE_SIZE = 10;

/**
 * "Comments" tab on AdminModeration — comments on this gym's activity feed,
 * filterable by status. Soft-delete toggles `is_deleted` on feed_comments and
 * logs to admin_audit_log. Restyled onto moderationKit (desktop grid + mobile cards).
 */
export default function CommentsTab({ gymId }) {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('pages');
  const dateFnsOpts = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;
  const [filter, setFilter] = useState('all');
  const [acting, setActing] = useState(null);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [filter]);

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
    posthogClient?.capture('admin_content_moderated', { action: nextDeleted ? 'delete' : 'restore', type: 'comment' });
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

  if (isLoading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-[60px] rounded-[14px]" />)}</div>;
  if (error) return <ErrorCard message={t('admin.moderation.commentsFailed', { defaultValue: 'Failed to load comments' })} onRetry={refetch} />;

  const filterItems = [
    { id: 'all',     label: t('admin.moderation.all', { defaultValue: 'All' }),     count: total },
    { id: 'active',  label: t('admin.moderation.active', { defaultValue: 'Active' }),  count: active },
    { id: 'deleted', label: t('admin.moderation.deleted', { defaultValue: 'Deleted' }), count: deleted },
  ];
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const emptyState = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '44px 20px' }}>
      <span style={{ width: 46, height: 46, borderRadius: 13, display: 'grid', placeItems: 'center', background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
        <Ico ch={MIC.chat} size={21} color={TK.textFaint} stroke={1.7} />
      </span>
      <span style={{ fontFamily: FK.body, fontSize: 14, fontWeight: 600, color: TK.textSub }}>
        {filter === 'deleted' ? t('admin.moderation.noDeletedComments', { defaultValue: 'No deleted comments' }) : t('admin.moderation.noComments', { defaultValue: 'No comments match this filter' })}
      </span>
    </div>
  );

  const statusFor = (row) => row.is_deleted
    ? { tone: 'hot', label: t('admin.moderation.deleted', { defaultValue: 'Deleted' }) }
    : { tone: 'good', label: t('admin.moderation.live', { defaultValue: 'Live' }) };

  return (
    <div>
      <FilterPills items={filterItems} active={filter} onPick={setFilter} />

      {/* Desktop grid table */}
      <div className="hidden md:block">
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '15px 24px', background: TK.surface2 }}>
            <TH>{t('admin.moderation.user', { defaultValue: 'User' })}</TH>
            <TH>{t('admin.moderation.comment', { defaultValue: 'Comment' })}</TH>
            <TH>{t('admin.moderation.onPost', { defaultValue: 'On Post' })}</TH>
            <TH>{t('admin.moderation.status', { defaultValue: 'Status' })}</TH>
            <TH>{t('admin.moderation.date', { defaultValue: 'Date' })}</TH>
            <span />
          </div>
          {filtered.length === 0 ? emptyState : visible.map((row, i) => {
            const profile = row.profiles;
            const feedItem = row.activity_feed_items;
            const st = statusFor(row);
            const busy = acting === row.id;
            const name = profile?.full_name ?? t('admin.moderation.unknownUser', { defaultValue: 'Unknown' });
            return (
              <div key={row.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '16px 24px', borderTop: `1px solid ${TK.divider}`, alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <Av name={name} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                    <div style={{ fontFamily: FK.mono, fontSize: 12, color: TK.textFaint, whiteSpace: 'nowrap' }}>@{profile?.username ?? '—'}</div>
                  </div>
                </div>
                <span style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sanitize(row.content)}</span>
                <div style={{ minWidth: 0 }}>
                  {feedItem
                    ? <TypeBadge {...postTypeVisual(feedItem.type)} label={postTypeBadge(feedItem.type, t).label} />
                    : <span style={{ fontFamily: FK.body, fontSize: 13, color: TK.textFaint }}>—</span>}
                </div>
                <StatusDot tone={st.tone} label={st.label} />
                <span style={{ fontFamily: FK.mono, fontSize: 12.5, color: TK.textFaint, whiteSpace: 'nowrap' }}>{relativeTime(row.created_at, dateFnsOpts)}</span>
                <IconBtn
                  icon={row.is_deleted ? MIC.restore : MIC.trash}
                  tone={row.is_deleted ? 'good' : 'neutral'}
                  iconColor={row.is_deleted ? undefined : 'var(--color-danger)'}
                  disabled={busy}
                  onClick={() => handleToggleDelete(row)}
                  title={row.is_deleted ? t('admin.moderation.restore', { defaultValue: 'Restore' }) : t('admin.moderation.delete', { defaultValue: 'Delete' })}
                />
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
          const profile = row.profiles;
          const feedItem = row.activity_feed_items;
          const st = statusFor(row);
          const busy = acting === row.id;
          const name = profile?.full_name ?? t('admin.moderation.unknownUser', { defaultValue: 'Unknown' });
          return (
            <Card key={row.id} style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                <Av name={name} sm />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: FK.body, fontSize: 14, fontWeight: 700, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                  <div style={{ fontFamily: FK.mono, fontSize: 11.5, color: TK.textFaint }}>{relativeTime(row.created_at, dateFnsOpts)}</div>
                </div>
                <IconBtn
                  icon={row.is_deleted ? MIC.restore : MIC.trash}
                  tone={row.is_deleted ? 'good' : 'neutral'}
                  iconColor={row.is_deleted ? undefined : 'var(--color-danger)'}
                  disabled={busy}
                  onClick={() => handleToggleDelete(row)}
                  title={row.is_deleted ? t('admin.moderation.restore', { defaultValue: 'Restore' }) : t('admin.moderation.delete', { defaultValue: 'Delete' })}
                  size={30}
                />
              </div>
              <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textSub, margin: '0 0 10px' }}>{sanitize(row.content)}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {feedItem && <TypeBadge {...postTypeVisual(feedItem.type)} label={postTypeBadge(feedItem.type, t).label} />}
                <StatusDot tone={st.tone} label={st.label} />
              </div>
            </Card>
          );
        })}
        {filtered.length > 0 && (
          <AdminPagination page={safePage + 1} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={(n) => setPage(n - 1)} />
        )}
      </div>
    </div>
  );
}
