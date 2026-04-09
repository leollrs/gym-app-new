import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Trash2, RotateCcw, MessageSquare, Activity, ShieldAlert, Flag,
  CheckCircle, XCircle, AlertTriangle, Eye, ChevronRight,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { sanitize } from '../../lib/sanitize';
import { adminKeys } from '../../lib/adminQueryKeys';
import { logAdminAction } from '../../lib/adminAudit';
import {
  PageHeader, FilterBar, Avatar, StatCard, AdminCard,
  AdminPageShell, AdminModal, AdminTable, FadeIn, SectionLabel,
  Skeleton, ErrorCard, AdminTabs,
} from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';

// ── Helpers ────────────────────────────────────────────────────────────────

const POST_TYPE_COLORS = {
  workout_completed:   'text-emerald-400 bg-emerald-500/10',
  pr_hit:              'text-[#D4AF37] bg-[#D4AF37]/10',
  challenge_joined:    'text-blue-400 bg-blue-500/10',
  challenge_won:       'text-purple-400 bg-purple-500/10',
  achievement_unlocked:'text-pink-400 bg-pink-500/10',
  check_in:            'text-cyan-400 bg-cyan-500/10',
  program_started:     'text-indigo-400 bg-indigo-500/10',
};

const POST_TYPE_KEYS = {
  workout_completed:   'workout',
  pr_hit:              'prHit',
  challenge_joined:    'challenge',
  challenge_won:       'won',
  achievement_unlocked:'achievement',
  check_in:            'checkIn',
  program_started:     'program',
};

const postTypeBadge = (type, t) => {
  const color = POST_TYPE_COLORS[type];
  const key = POST_TYPE_KEYS[type];
  if (!color || !key) return { label: t ? t(`admin.moderation.postTypes.unknown`, { defaultValue: type ?? 'Unknown' }) : (type ?? 'Unknown'), color: 'text-[#9CA3AF] bg-white/6' };
  const label = t ? t(`admin.moderation.postTypes.${key}`, { defaultValue: key }) : key;
  return { label, color };
};

const relativeTime = (ts, dateFnsOpts) => {
  if (!ts) return '\u2014';
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true, ...dateFnsOpts }); }
  catch { return '\u2014'; }
};

const dataPreview = (type, data, t) => {
  if (!data || typeof data !== 'object') return null;
  switch (type) {
    case 'workout_completed':
      return [
        data.workout_name && `"${sanitize(data.workout_name)}"`,
        data.duration_min != null && `${data.duration_min} min`,
        data.total_volume_lbs != null && `${Math.round(data.total_volume_lbs).toLocaleString()} lbs`,
      ].filter(Boolean).join(' \u00b7 ') || null;
    case 'pr_hit':
      return [
        data.exercise_name && sanitize(data.exercise_name),
        data.weight_lbs != null && data.reps != null && `${data.weight_lbs} lbs \u00d7 ${data.reps}`,
        data.estimated_1rm != null && `est. 1RM ${Math.round(data.estimated_1rm)} lbs`,
      ].filter(Boolean).join(' \u00b7 ') || null;
    case 'challenge_joined':
    case 'challenge_won':
      return data.challenge_name ? `"${sanitize(data.challenge_name)}"` : null;
    case 'achievement_unlocked':
      return data.achievement_name ? `"${sanitize(data.achievement_name)}"` : null;
    case 'check_in':
      return data.method ? (t ? t('admin.moderation.viaMethod', { defaultValue: 'Via {{method}}', method: sanitize(data.method) }) : `Via ${sanitize(data.method)}`) : null;
    case 'program_started':
      return data.program_name ? `"${sanitize(data.program_name)}"` : null;
    default:
      return null;
  }
};

const REPORT_STATUS_COLORS = {
  pending:   { color: 'text-amber-400 bg-amber-500/10', dot: 'bg-amber-400' },
  reviewed:  { color: 'text-blue-400 bg-blue-500/10', dot: 'bg-blue-400' },
  dismissed: { color: 'text-[#9CA3AF] bg-white/6', dot: 'bg-[#9CA3AF]' },
  actioned:  { color: 'text-emerald-400 bg-emerald-500/10', dot: 'bg-emerald-400' },
};

const getReportStatus = (statusKey, t) => {
  const style = REPORT_STATUS_COLORS[statusKey] || REPORT_STATUS_COLORS.pending;
  const label = t ? t(`admin.moderation.reportStatus.${statusKey}`, { defaultValue: statusKey }) : statusKey;
  return { label, ...style };
};

// ── Fetch functions ───────────────────────────────────────────────────────

const fetchPosts = async (gymId) => {
  const { data, error } = await supabase
    .from('activity_feed_items')
    .select(`
      id,
      type,
      data,
      is_public,
      is_deleted,
      created_at,
      actor_id,
      profiles!activity_feed_items_actor_id_fkey (
        full_name,
        username,
        gym_id
      )
    `)
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
};

const fetchComments = async (gymId) => {
  const { data, error } = await supabase
    .from('feed_comments')
    .select(`
      id,
      content,
      is_deleted,
      created_at,
      profile_id,
      feed_item_id,
      profiles!feed_comments_profile_id_fkey (
        full_name,
        username,
        gym_id
      ),
      activity_feed_items!feed_comments_feed_item_id_fkey (
        type,
        created_at,
        gym_id
      )
    `)
    .eq('activity_feed_items.gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []).filter(c => c.activity_feed_items !== null);
};

const fetchReports = async (gymId) => {
  const { data, error } = await supabase
    .from('content_reports')
    .select(`
      id,
      reason,
      status,
      created_at,
      reviewed_at,
      reporter_id,
      feed_item_id,
      profiles!content_reports_reporter_id_fkey (
        full_name,
        username
      ),
      activity_feed_items!content_reports_feed_item_id_fkey (
        id,
        type,
        data,
        is_deleted,
        created_at,
        actor_id,
        profiles:profiles!activity_feed_items_actor_id_fkey (
          full_name,
          username
        )
      )
    `)
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
};

// ── Report Detail Modal ───────────────────────────────────────────────────

function ReportDetailModal({ report, isOpen, onClose, onAction, acting }) {
  const { t, i18n } = useTranslation('pages');
  const dateFnsOpts = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;
  if (!report) return null;

  const reporter = report.profiles;
  const feedItem = report.activity_feed_items ?? null;
  const author   = feedItem?.profiles ?? null;
  const badge    = postTypeBadge(feedItem?.type, t);
  const status   = getReportStatus(report.status, t);
  const isPending = report.status === 'pending';

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
            {t('admin.moderation.actionRemove', { defaultValue: 'Remove Content' })}
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

        {/* Reporter */}
        <div>
          <SectionLabel>{t('admin.moderation.reportedBy', { defaultValue: 'Reported By' })}</SectionLabel>
          <div className="flex items-center gap-3 mt-2">
            <Avatar name={reporter?.full_name} size="md" variant="accent" />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{reporter?.full_name ?? t('admin.moderation.unknownUser', { defaultValue: 'Unknown' })}</p>
              <p className="text-[12px] text-[#6B7280]">@{reporter?.username ?? '\u2014'}</p>
            </div>
            <span className="ml-auto text-[11px] text-[#6B7280]">{relativeTime(report.created_at, dateFnsOpts)}</span>
          </div>
        </div>

        {/* Reason */}
        <div>
          <SectionLabel>{t('admin.moderation.reason', { defaultValue: 'Reason' })}</SectionLabel>
          <p className="mt-2 text-[13px] text-[#E5E7EB] leading-relaxed bg-white/[0.03] rounded-xl p-3 border border-white/6">
            {sanitize(report.reason)}
          </p>
        </div>

        {/* Reported content */}
        {feedItem && (
          <div>
            <SectionLabel>{t('admin.moderation.reportedContent', { defaultValue: 'Reported Content' })}</SectionLabel>
            <div className="mt-2 bg-white/[0.03] rounded-xl p-4 border border-white/6">
              <div className="flex items-center gap-2 mb-2">
                {author && (
                  <>
                    <Avatar name={author.full_name} size="sm" variant="accent" />
                    <span className="text-[13px] font-semibold text-[#E5E7EB]">{author.full_name ?? t('admin.moderation.unknownUser', { defaultValue: 'Unknown' })}</span>
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
                <p className="text-[12px] text-[#9CA3AF]">{dataPreview(feedItem.type, feedItem.data, t)}</p>
              )}
              <p className="text-[11px] text-[#6B7280] mt-1">{relativeTime(feedItem.created_at, dateFnsOpts)}</p>
            </div>
          </div>
        )}
      </div>
    </AdminModal>
  );
}

// ── POSTS TAB ──────────────────────────────────────────────────────────────

const PostsTab = ({ gymId }) => {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('pages');
  const dateFnsOpts = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;
  const [filter, setFilter] = useState('all');
  const [acting, setActing] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);

  const { data: posts = [], isLoading, error, refetch } = useQuery({
    queryKey: [...adminKeys.moderation(gymId), 'posts'],
    queryFn: () => fetchPosts(gymId),
    enabled: !!gymId,
  });

  const handleToggleDelete = async (post) => {
    setActing(post.id);
    await supabase
      .from('activity_feed_items')
      .update({ is_deleted: !post.is_deleted })
      .eq('id', post.id);
    logAdminAction('moderate_post', 'post', post.id, { action: post.is_deleted ? 'restore' : 'delete' });
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

  const columns = [
    {
      key: 'type',
      label: t('admin.moderation.type', { defaultValue: 'Type' }),
      sortable: true,
      render: (row) => {
        const badge = postTypeBadge(row.type, t);
        return (
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full capitalize ${badge.color}`}>
              {badge.label}
            </span>
            {row.is_deleted && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-red-400 bg-red-500/10">
                {t('admin.moderation.deleted', { defaultValue: 'Deleted' })}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'user',
      label: t('admin.moderation.user', { defaultValue: 'Author' }),
      render: (row) => {
        const profile = row.profiles;
        return (
          <div className="flex items-center gap-2.5">
            <Avatar name={profile?.full_name} size="sm" variant="accent" />
            <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">{profile?.full_name ?? t('admin.moderation.unknownUser', { defaultValue: 'Unknown' })}</p>
          </div>
        );
      },
    },
    {
      key: 'created_at',
      label: t('admin.moderation.date', { defaultValue: 'Date' }),
      sortable: true,
      sortValue: (row) => new Date(row.created_at).getTime(),
      render: (row) => (
        <span className="text-[12px] text-[#6B7280]">{relativeTime(row.created_at, dateFnsOpts)}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      headerClassName: 'w-20',
      render: (row) => {
        const busy = acting === row.id;
        return (
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); setExpandedRow(expandedRow === row.id ? null : row.id); }}
              className="p-2 rounded-lg text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/[0.04] transition-all"
              title={t('admin.moderation.details', { defaultValue: 'Details' })}
            >
              <ChevronRight size={15} className={`transition-transform ${expandedRow === row.id ? 'rotate-90' : ''}`} />
            </button>
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
          </div>
        );
      },
    },
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
            {filtered.map(row => {
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
                        @{profile?.username ?? '\u2014'} · {relativeTime(row.created_at, dateFnsOpts)}
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
          </div>
        )}
      </AdminCard>
    </div>
  );
};

// ── COMMENTS TAB ───────────────────────────────────────────────────────────

const CommentsTab = ({ gymId }) => {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('pages');
  const dateFnsOpts = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;
  const [filter, setFilter] = useState('all');
  const [acting, setActing] = useState(null);

  const { data: comments = [], isLoading, error, refetch } = useQuery({
    queryKey: [...adminKeys.moderation(gymId), 'comments'],
    queryFn: () => fetchComments(gymId),
    enabled: !!gymId,
  });

  const handleToggleDelete = async (comment) => {
    setActing(comment.id);
    await supabase
      .from('feed_comments')
      .update({ is_deleted: !comment.is_deleted })
      .eq('id', comment.id);
    logAdminAction('moderate_comment', 'comment', comment.id, { action: comment.is_deleted ? 'restore' : 'delete' });
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
              <p className="text-[11px] text-[#6B7280]">@{profile?.username ?? '\u2014'}</p>
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
        ) : <span className="text-[11px] text-[#6B7280]">\u2014</span>;
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
      <AdminTable
        columns={columns}
        data={filtered}
        loading={false}
        emptyState={
          <div className="text-center py-12">
            <MessageSquare size={28} className="text-[#4B5563] mx-auto mb-2" />
            <p className="text-[13px] text-[#6B7280]">{t('admin.moderation.noComments', { defaultValue: 'No comments match this filter' })}</p>
          </div>
        }
      />
    </div>
  );
};

// ── REPORTS TAB ────────────────────────────────────────────────────────────

const ReportsTab = ({ gymId }) => {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('pages');
  const dateFnsOpts = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;
  const [filter, setFilter] = useState('all');
  const [acting, setActing] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);

  const { data: reports = [], isLoading, error, refetch } = useQuery({
    queryKey: [...adminKeys.moderation(gymId), 'reports'],
    queryFn: () => fetchReports(gymId),
    enabled: !!gymId,
  });

  const handleUpdateStatus = async (report, newStatus) => {
    setActing(report.id);
    await supabase
      .from('content_reports')
      .update({ status: newStatus, reviewed_at: new Date().toISOString() })
      .eq('id', report.id);

    // If actioned, also soft-delete the reported feed item
    if (newStatus === 'actioned' && report.feed_item_id) {
      await supabase
        .from('activity_feed_items')
        .update({ is_deleted: true })
        .eq('id', report.feed_item_id);
    }

    logAdminAction('action_report', 'report', report.id, { status: newStatus });
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
              <p className="text-[11px] text-[#6B7280]">@{profile?.username ?? '\u2014'}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: 'reason',
      label: t('admin.moderation.reason', { defaultValue: 'Reason' }),
      render: (row) => (
        <p className="text-[12px] text-[#E5E7EB] truncate max-w-[200px]">{sanitize(row.reason)}</p>
      ),
    },
    {
      key: 'reported_post',
      label: t('admin.moderation.reportedPost', { defaultValue: 'Reported Post' }),
      headerClassName: 'hidden md:table-cell',
      className: 'hidden md:table-cell text-[#E5E7EB]',
      render: (row) => {
        const feedItem = row.activity_feed_items;
        const badge = postTypeBadge(feedItem?.type, t);
        const author = feedItem?.profiles;
        return feedItem ? (
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${badge.color}`}>{badge.label}</span>
            {author && <span className="text-[11px] text-[#9CA3AF] truncate">{author.full_name}</span>}
          </div>
        ) : <span className="text-[11px] text-[#6B7280]">\u2014</span>;
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
              className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-40"
            >
              <XCircle size={15} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleUpdateStatus(row, 'dismissed'); }}
              disabled={busy}
              title={t('admin.moderation.dismiss', { defaultValue: 'Dismiss' })}
              className="p-2 rounded-lg text-[#6B7280] hover:text-emerald-400 hover:bg-emerald-500/10 transition-all disabled:opacity-40"
            >
              <CheckCircle size={15} />
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setSelectedReport(row); }}
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
      <AdminTable
        columns={columns}
        data={filtered}
        loading={false}
        onRowClick={(row) => setSelectedReport(row)}
        emptyState={
          <div className="text-center py-12">
            <Flag size={28} className="text-[#4B5563] mx-auto mb-2" />
            <p className="text-[13px] text-[#6B7280]">{t('admin.moderation.noReports', { defaultValue: 'No reports match this filter' })}</p>
          </div>
        }
      />

      <ReportDetailModal
        report={selectedReport}
        isOpen={!!selectedReport}
        onClose={() => setSelectedReport(null)}
        onAction={handleUpdateStatus}
        acting={!!acting}
      />
    </div>
  );
};

// ── MAIN ───────────────────────────────────────────────────────────────────

export default function AdminModeration() {
  const { profile } = useAuth();
  const { t } = useTranslation('pages');
  const [tab, setTab] = useState('reports');

  useEffect(() => { document.title = 'Admin - Moderation | TuGymPR'; }, []);

  const gymId = profile?.gym_id;

  // Prefetch all data for stat cards + tab counts
  const { data: reports = [] } = useQuery({
    queryKey: [...adminKeys.moderation(gymId), 'reports'],
    queryFn: () => fetchReports(gymId),
    enabled: !!gymId,
  });
  const { data: posts = [] } = useQuery({
    queryKey: [...adminKeys.moderation(gymId), 'posts'],
    queryFn: () => fetchPosts(gymId),
    enabled: !!gymId,
  });
  const { data: comments = [] } = useQuery({
    queryKey: [...adminKeys.moderation(gymId), 'comments'],
    queryFn: () => fetchComments(gymId),
    enabled: !!gymId,
  });

  const pendingReports = reports.filter(r => r.status === 'pending').length;
  const resolvedReports = reports.filter(r => r.status !== 'pending').length;
  const escalatedReports = reports.filter(r => r.status === 'actioned').length;

  const tabs = [
    { key: 'reports',  label: t('admin.moderation.reports', { defaultValue: 'Reports' }),   icon: Flag,            count: pendingReports || null },
    { key: 'posts',    label: t('admin.moderation.feedPosts', { defaultValue: 'Posts' }),    icon: Activity,        count: posts.length || null },
    { key: 'comments', label: t('admin.moderation.comments', { defaultValue: 'Comments' }),  icon: MessageSquare,   count: comments.length || null },
  ];

  return (
    <AdminPageShell>
      <PageHeader
        title={t('admin.moderation.title', { defaultValue: 'Content Moderation' })}
        subtitle={t('admin.moderation.subtitle', { defaultValue: 'Review and moderate feed posts, comments, and member reports' })}
      />

      {/* Summary stat cards */}
      <FadeIn>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 mb-6">
          <StatCard
            label={t('admin.moderation.totalReports', { defaultValue: 'Total Reports' })}
            value={reports.length}
            borderColor="#60A5FA"
            icon={Flag}
            delay={0}
          />
          <StatCard
            label={t('admin.moderation.pending', { defaultValue: 'Pending' })}
            value={pendingReports}
            borderColor="#F97316"
            icon={AlertTriangle}
            delay={0.05}
          />
          <StatCard
            label={t('admin.moderation.resolved', { defaultValue: 'Resolved' })}
            value={resolvedReports}
            borderColor="#10B981"
            icon={CheckCircle}
            delay={0.1}
          />
          <StatCard
            label={t('admin.moderation.actioned', { defaultValue: 'Actioned' })}
            value={escalatedReports}
            borderColor="#EF4444"
            icon={ShieldAlert}
            delay={0.15}
          />
        </div>
      </FadeIn>

      {/* Tab bar */}
      <AdminTabs tabs={tabs.map(t => ({ key: t.key, label: t.label, icon: t.icon, count: t.count }))} active={tab} onChange={setTab} className="mb-5" />

      {/* Tab content */}
      {!gymId ? (
        <AdminCard>
          <div className="text-center py-16">
            <ShieldAlert size={32} className="text-[#4B5563] mx-auto mb-3" />
            <p className="text-[14px] text-[#6B7280]">{t('admin.moderation.noGym', { defaultValue: 'No gym associated with your account.' })}</p>
          </div>
        </AdminCard>
      ) : (
        <SwipeableTabContent tabs={tabs.map(t => ({ key: t.key, label: t.label, icon: t.icon, count: t.count }))} active={tab} onChange={setTab}>
          {(tabKey) => {
            if (tabKey === 'reports') return <ReportsTab gymId={gymId} />;
            if (tabKey === 'posts') return <PostsTab gymId={gymId} />;
            if (tabKey === 'comments') return <CommentsTab gymId={gymId} />;
            return null;
          }}
        </SwipeableTabContent>
      )}
    </AdminPageShell>
  );
}
