import { useState, useMemo, useEffect } from 'react';
import posthogClient from 'posthog-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { es as esLocale } from 'date-fns/locale/es';
import { supabase } from '../../../lib/supabase';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import { Skeleton, ErrorCard } from '../../../components/admin';
import { postTypeBadge, relativeTime, dataPreview } from './moderationHelpers';
import { fetchPosts } from '../../../lib/admin/moderationQueries';
import { TK, FK, Ico, Card, MIC, Av, FilterPills, TypeBadge, IconBtn, postTypeVisual } from './moderationKit';
import AdminPagination from '../../../components/admin/AdminPagination';

const POSTS_PAGE_SIZE = 10;

/**
 * "Posts" tab on AdminModeration — last 50 activity-feed items for the
 * gym, with a filter chip (All / Active / Deleted) and inline expand for
 * the data-preview line. Soft-delete is reversible (toggles `is_deleted`)
 * and both transitions log to admin_audit_log. Restyled onto moderationKit.
 */
export default function PostsTab({ gymId }) {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('pages');
  const dateFnsOpts = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;
  const [filter, setFilter] = useState('all');
  const [acting, setActing] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [filter]);

  const { data: posts = [], isLoading, error, refetch } = useQuery({
    queryKey: [...adminKeys.moderation(gymId), 'posts'],
    queryFn: () => fetchPosts(gymId),
    enabled: !!gymId,
  });

  const handleToggleDelete = async (post) => {
    setActing(post.id);
    const nextDeleted = !post.is_deleted;
    await supabase
      .from('activity_feed_items')
      .update({ is_deleted: nextDeleted })
      .eq('id', post.id)
      .eq('gym_id', gymId); // defense-in-depth: scope to this gym, not RLS alone
    logAdminAction('moderation', 'activity_feed_item', post.id, {
      action: nextDeleted ? 'soft_delete' : 'restore',
      post_type: post.type,
      author_id: post.actor_id,
    });
    queryClient.setQueryData([...adminKeys.moderation(gymId), 'posts'], (old) =>
      (old || []).map(p => p.id === post.id ? { ...p, is_deleted: !p.is_deleted } : p)
    );
    posthogClient?.capture('admin_content_moderated', { action: nextDeleted ? 'delete' : 'restore', type: 'post' });
    setActing(null);
  };

  const total   = posts.length;
  const active  = posts.filter(p => !p.is_deleted).length;
  const deleted = posts.filter(p =>  p.is_deleted).length;

  const filtered = useMemo(() => {
    if (filter === 'active')  return posts.filter(p => !p.is_deleted);
    if (filter === 'deleted') return posts.filter(p =>  p.is_deleted);
    return posts;
  }, [posts, filter]);

  if (isLoading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-[60px] rounded-[14px]" />)}</div>;
  if (error) return <ErrorCard message={t('admin.moderation.postsFailed', { defaultValue: 'Failed to load posts' })} onRetry={refetch} />;

  const filterItems = [
    { id: 'all',     label: t('admin.moderation.all', { defaultValue: 'All' }),     count: total },
    { id: 'active',  label: t('admin.moderation.active', { defaultValue: 'Active' }),  count: active },
    { id: 'deleted', label: t('admin.moderation.deleted', { defaultValue: 'Deleted' }), count: deleted },
  ];
  const pageCount = Math.max(1, Math.ceil(filtered.length / POSTS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * POSTS_PAGE_SIZE, safePage * POSTS_PAGE_SIZE + POSTS_PAGE_SIZE);

  return (
    <div>
      <FilterPills items={filterItems} active={filter} onPick={setFilter} />
      <Card style={{ overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '46px 20px' }}>
            <span style={{ width: 46, height: 46, borderRadius: 13, display: 'grid', placeItems: 'center', background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
              <Ico ch={MIC.pulse} size={21} color={TK.textFaint} stroke={1.7} />
            </span>
            <span style={{ fontFamily: FK.body, fontSize: 14, fontWeight: 600, color: TK.textSub }}>{t('admin.moderation.noPosts', { defaultValue: 'No posts match this filter' })}</span>
          </div>
        ) : (
          <>
            {visible.map((row, i) => {
              const profile = row.profiles;
              const vis = postTypeVisual(row.type);
              const label = postTypeBadge(row.type, t).label;
              const isExpanded = expandedRow === row.id;
              const preview = dataPreview(row.type, row.data, t);
              const name = profile?.full_name ?? t('admin.moderation.unknownUser', { defaultValue: 'Unknown' });
              const busy = acting === row.id;
              return (
                <div key={row.id} style={{ borderTop: i > 0 ? `1px solid ${TK.divider}` : 'none' }}>
                  <div
                    onClick={() => setExpandedRow(isExpanded ? null : row.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer' }}
                  >
                    <Av name={name} sm />
                    {/* Flexible middle column — shrinks/wraps so the chevron + trash
                        button on the right are NEVER pushed off-screen on mobile. */}
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ flex: 1, minWidth: 0, fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                        <span style={{ flexShrink: 0, fontFamily: FK.mono, fontSize: 12, color: TK.textFaint, whiteSpace: 'nowrap' }}>{relativeTime(row.created_at, dateFnsOpts)}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        <TypeBadge tone={vis.tone} icon={vis.icon} label={label} />
                        {row.is_deleted && <TypeBadge tone="hot" label={t('admin.moderation.deleted', { defaultValue: 'Deleted' })} />}
                      </div>
                    </div>
                    <span style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <Ico ch={MIC.chevR} size={16} color={TK.textFaint} stroke={2.2} style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                    </span>
                    <span onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
                      <IconBtn
                        icon={row.is_deleted ? MIC.restore : MIC.trash}
                        tone={row.is_deleted ? 'good' : 'neutral'}
                        iconColor={row.is_deleted ? undefined : 'var(--color-danger)'}
                        disabled={busy}
                        onClick={() => handleToggleDelete(row)}
                        title={row.is_deleted ? t('admin.moderation.restore', { defaultValue: 'Restore' }) : t('admin.moderation.delete', { defaultValue: 'Delete' })}
                      />
                    </span>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: '0 16px 14px 58px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <span style={{ fontFamily: FK.mono, fontSize: 11.5, color: TK.textFaint }}>@{profile?.username ?? '—'}</span>
                      {preview && <span style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute }}>{preview}</span>}
                      <span style={{ fontFamily: FK.body, fontSize: 12, color: TK.textFaint }}>
                        {t('admin.moderation.visibility', { defaultValue: 'Visibility' })}: {row.is_public ? t('admin.moderation.public', { defaultValue: 'Public' }) : t('admin.moderation.private', { defaultValue: 'Private' })}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ padding: '0 22px' }}>
              <AdminPagination page={safePage + 1} pageSize={POSTS_PAGE_SIZE} total={filtered.length} onPageChange={(n) => setPage(n - 1)} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
