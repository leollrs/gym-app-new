import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { es as esLocale } from 'date-fns/locale/es';
import { Activity, ChevronRight, Trash2, RotateCcw } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import { AdminCard, FilterBar, Skeleton, ErrorCard, Avatar } from '../../../components/admin';
import { postTypeBadge, relativeTime, dataPreview } from './moderationHelpers';
import { fetchPosts } from '../../../lib/admin/moderationQueries';
import usePagedVisible from '../../../hooks/usePagedVisible';
import PaginationFooter from '../../../components/admin/PaginationFooter';

/**
 * "Posts" tab on AdminModeration — last 50 activity-feed items for the
 * gym, with a filter chip (All / Active / Deleted) and inline expand for
 * the data-preview line.
 *
 * Soft-delete is reversible via the same button (toggles `is_deleted` on
 * `activity_feed_items`). Both transitions log to admin_audit_log so the
 * platform-level audit page can replay what happened.
 */
export default function PostsTab({ gymId }) {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('pages');
  const dateFnsOpts = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;
  const [filter, setFilter] = useState('all');
  const [acting, setActing] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const pager = usePagedVisible({ initial: 10, step: 10 });

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

  if (isLoading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-[14px]" />)}</div>;
  if (error) return <ErrorCard message={t('admin.moderation.postsFailed', { defaultValue: 'Failed to load posts' })} onRetry={refetch} />;

  const filterOptions = [
    { key: 'all',     label: t('admin.moderation.all', { defaultValue: 'All' }),     count: total },
    { key: 'active',  label: t('admin.moderation.active', { defaultValue: 'Active' }),  count: active },
    { key: 'deleted', label: t('admin.moderation.deleted', { defaultValue: 'Deleted' }), count: deleted },
  ];

  return (
    <div className="space-y-4">
      <FilterBar options={filterOptions} active={filter} onChange={setFilter} />
      <AdminCard className="overflow-hidden !p-0">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <Activity size={28} className="text-[#4B5563] mx-auto mb-2" />
            <p className="text-[13px] text-[#6B7280]">{t('admin.moderation.noPosts', { defaultValue: 'No posts match this filter' })}</p>
          </div>
        ) : (
          <div className="divide-y divide-white/4">
            {filtered.slice(0, pager.visibleCount).map(row => {
              const profile = row.profiles;
              const badge = postTypeBadge(row.type, t);
              const preview = dataPreview(row.type, row.data, t);
              const isExpanded = expandedRow === row.id;
              return (
                <div key={row.id}>
                  <div
                    className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors cursor-pointer"
                    onClick={() => setExpandedRow(isExpanded ? null : row.id)}
                  >
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full capitalize flex-shrink-0 ${badge.color}`}>
                      {badge.label}
                    </span>
                    {row.is_deleted && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-red-400 bg-red-500/10 flex-shrink-0">
                        {t('admin.moderation.deleted', { defaultValue: 'Del' })}
                      </span>
                    )}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Avatar name={profile?.full_name} size="sm" variant="accent" />
                      <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">{profile?.full_name ?? t('admin.moderation.unknownUser', { defaultValue: 'Unknown' })}</p>
                    </div>
                    <span className="text-[12px] text-[#6B7280] flex-shrink-0 hidden sm:block">{relativeTime(row.created_at, dateFnsOpts)}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <ChevronRight size={14} className={`text-[#4B5563] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleDelete(row); }}
                        disabled={acting === row.id}
                        title={row.is_deleted ? t('admin.moderation.restore', { defaultValue: 'Restore' }) : t('admin.moderation.delete', { defaultValue: 'Delete' })}
                        className={`p-2 rounded-lg transition-all disabled:opacity-40 ${
                          row.is_deleted
                            ? 'text-emerald-500 hover:bg-emerald-500/10'
                            : 'text-[#6B7280] hover:text-red-400 hover:bg-red-500/10'
                        }`}
                      >
                        {row.is_deleted ? <RotateCcw size={15} /> : <Trash2 size={15} />}
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="px-5 pb-3 pt-0 ml-[52px] space-y-1.5">
                      <p className="text-[11px] text-[#6B7280]">
                        @{profile?.username ?? '—'} · {relativeTime(row.created_at, dateFnsOpts)}
                      </p>
                      {preview && (
                        <p className="text-[12px] text-[#9CA3AF]">{preview}</p>
                      )}
                      <p className="text-[11px] text-[#4B5563]">
                        {t('admin.moderation.visibility', { defaultValue: 'Visibility' })}: {row.is_public ? t('admin.moderation.public', { defaultValue: 'Public' }) : t('admin.moderation.private', { defaultValue: 'Private' })}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
            <PaginationFooter pager={pager} total={filtered.length} className="px-5 pb-3" />
          </div>
        )}
      </AdminCard>
    </div>
  );
}
