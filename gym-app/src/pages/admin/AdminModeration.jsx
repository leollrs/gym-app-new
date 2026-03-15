import { useEffect, useState, useMemo } from 'react';
import { Trash2, RotateCcw, MessageSquare, Activity, ShieldAlert, Flag, CheckCircle, XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import { sanitize } from '../../lib/sanitize';

// ── Helpers ────────────────────────────────────────────────────────────────

const POST_TYPE_STYLES = {
  workout_completed:   { label: 'Workout',     color: 'text-emerald-400 bg-emerald-500/10' },
  pr_hit:              { label: 'PR Hit',       color: 'text-[#D4AF37] bg-[#D4AF37]/10' },
  challenge_joined:    { label: 'Challenge',    color: 'text-blue-400 bg-blue-500/10' },
  challenge_won:       { label: 'Won',          color: 'text-purple-400 bg-purple-500/10' },
  achievement_unlocked:{ label: 'Achievement',  color: 'text-pink-400 bg-pink-500/10' },
  check_in:            { label: 'Check-in',     color: 'text-cyan-400 bg-cyan-500/10' },
  program_started:     { label: 'Program',      color: 'text-indigo-400 bg-indigo-500/10' },
};

const postTypeBadge = (type) => {
  const t = POST_TYPE_STYLES[type];
  if (!t) return { label: type ?? 'Unknown', color: 'text-[#9CA3AF] bg-white/6' };
  return t;
};

const relativeTime = (ts) => {
  if (!ts) return '—';
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }); }
  catch { return '—'; }
};

const dataPreview = (type, data) => {
  if (!data || typeof data !== 'object') return null;
  switch (type) {
    case 'workout_completed':
      return [
        data.workout_name && `"${sanitize(data.workout_name)}"`,
        data.duration_min != null && `${data.duration_min} min`,
        data.total_volume_lbs != null && `${Math.round(data.total_volume_lbs).toLocaleString()} lbs`,
      ].filter(Boolean).join(' · ') || null;
    case 'pr_hit':
      return [
        data.exercise_name && sanitize(data.exercise_name),
        data.weight_lbs != null && data.reps != null && `${data.weight_lbs} lbs × ${data.reps}`,
        data.estimated_1rm != null && `est. 1RM ${Math.round(data.estimated_1rm)} lbs`,
      ].filter(Boolean).join(' · ') || null;
    case 'challenge_joined':
    case 'challenge_won':
      return data.challenge_name ? `"${sanitize(data.challenge_name)}"` : null;
    case 'achievement_unlocked':
      return data.achievement_name ? `"${sanitize(data.achievement_name)}"` : null;
    case 'check_in':
      return data.method ? `Via ${sanitize(data.method)}` : null;
    case 'program_started':
      return data.program_name ? `"${sanitize(data.program_name)}"` : null;
    default:
      return null;
  }
};

// ── InitialAvatar ──────────────────────────────────────────────────────────

const InitialAvatar = ({ name, size = 9 }) => (
  <div
    className={`w-${size} h-${size} rounded-full bg-[#D4AF37]/15 border border-[#D4AF37]/25 flex items-center justify-center flex-shrink-0`}
  >
    <span className="text-[13px] font-bold text-[#D4AF37]">
      {(name || '?')[0].toUpperCase()}
    </span>
  </div>
);

// ── FILTER BAR ─────────────────────────────────────────────────────────────

const FilterBar = ({ active, onChange, counts, labels }) => {
  const l = labels || { all: 'All', active: 'Active', deleted: 'Deleted' };
  const opts = [
    { key: 'all',     label: `${l.all} (${counts.all})` },
    { key: 'active',  label: `${l.active} (${counts.active})` },
    { key: 'deleted', label: `${l.deleted} (${counts.deleted})` },
  ];
  return (
    <div className="flex gap-1.5 flex-wrap">
      {opts.map(f => (
        <button
          key={f.key}
          onClick={() => onChange(f.key)}
          className={`px-3 py-2 rounded-xl text-[12px] font-medium transition-colors ${
            active === f.key
              ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
              : 'bg-[#0F172A] border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB]'
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
};

// ── SPINNER ────────────────────────────────────────────────────────────────

const Spinner = () => (
  <div className="flex justify-center py-20">
    <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
  </div>
);

// ── EMPTY ──────────────────────────────────────────────────────────────────

const Empty = ({ label }) => (
  <div className="text-center py-20">
    <ShieldAlert size={32} className="text-[#4B5563] mx-auto mb-3" />
    <p className="text-[14px] text-[#6B7280]">{label}</p>
  </div>
);

// ── POSTS TAB ──────────────────────────────────────────────────────────────

const PostsTab = ({ gymId }) => {
  const [posts,   setPosts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('all');
  const [acting,  setActing]  = useState(null); // id of row being mutated

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
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
    setPosts(data || []);
    setLoading(false);
  };

  useEffect(() => { if (gymId) load(); }, [gymId]);

  const handleToggleDelete = async (post) => {
    setActing(post.id);
    await supabase
      .from('activity_feed_items')
      .update({ is_deleted: !post.is_deleted })
      .eq('id', post.id);
    setPosts(prev =>
      prev.map(p => p.id === post.id ? { ...p, is_deleted: !p.is_deleted } : p)
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

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-1">
        {[
          { label: 'Total Posts',   value: total,   color: 'text-[#E5E7EB]' },
          { label: 'Active Posts',  value: active,  color: 'text-emerald-400' },
          { label: 'Deleted Posts', value: deleted, color: 'text-red-400' },
        ].map(s => (
          <div key={s.label} className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4 text-center">
            <p className={`text-[22px] font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-[#6B7280] mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <FilterBar
        active={filter}
        onChange={setFilter}
        counts={{ all: total, active, deleted }}
      />

      {filtered.length === 0 ? (
        <Empty label="No posts match this filter" />
      ) : (
        <div className="space-y-2.5">
          {filtered.map(post => {
            const profile = post.profiles;
            const badge   = postTypeBadge(post.type);
            const preview = dataPreview(post.type, post.data);
            const busy    = acting === post.id;
            return (
              <div
                key={post.id}
                className={`bg-[#0F172A] border rounded-[14px] p-4 transition-all group ${
                  post.is_deleted ? 'border-red-500/15 opacity-60' : 'border-white/6 hover:border-white/20 hover:bg-white/[0.03]'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <InitialAvatar name={profile?.full_name} size={9} />

                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">
                        {profile?.full_name ?? 'Unknown'}
                      </p>
                      <p className="text-[12px] text-[#6B7280]">
                        @{profile?.username ?? '—'}
                      </p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${badge.color}`}>
                        {badge.label}
                      </span>
                      {post.is_deleted && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-red-400 bg-red-500/10">
                          Deleted
                        </span>
                      )}
                    </div>

                    {preview && (
                      <p className="text-[13px] text-[#9CA3AF] leading-relaxed mb-1 truncate">
                        {preview}
                      </p>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="text-[11px] text-[#4B5563]">
                        {relativeTime(post.created_at)}
                      </p>
                      <span className="hidden md:inline text-[11px] text-[#4B5563]">
                        {post.is_public ? 'Public' : 'Private'}
                      </span>
                    </div>
                  </div>

                  {/* Action */}
                  <button
                    onClick={() => handleToggleDelete(post)}
                    disabled={busy}
                    title={post.is_deleted ? 'Restore post' : 'Delete post'}
                    className={`flex-shrink-0 p-2 rounded-lg transition-all disabled:opacity-40 md:opacity-0 md:group-hover:opacity-100 ${
                      post.is_deleted
                        ? 'text-emerald-500 hover:bg-emerald-500/10 md:opacity-100'
                        : 'text-[#4B5563] hover:text-red-400 hover:bg-red-500/10'
                    }`}
                  >
                    {post.is_deleted
                      ? <RotateCcw size={15} />
                      : <Trash2 size={15} />
                    }
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── COMMENTS TAB ───────────────────────────────────────────────────────────

const CommentsTab = ({ gymId }) => {
  const [comments, setComments] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState('all');
  const [acting,   setActing]   = useState(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
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
    // filter to only this gym's comments (the join filter above handles it,
    // but rows with null parent are excluded too)
    setComments((data || []).filter(c => c.activity_feed_items !== null));
    setLoading(false);
  };

  useEffect(() => { if (gymId) load(); }, [gymId]);

  const handleToggleDelete = async (comment) => {
    setActing(comment.id);
    await supabase
      .from('feed_comments')
      .update({ is_deleted: !comment.is_deleted })
      .eq('id', comment.id);
    setComments(prev =>
      prev.map(c => c.id === comment.id ? { ...c, is_deleted: !c.is_deleted } : c)
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

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-1">
        {[
          { label: 'Total Comments',   value: total,   color: 'text-[#E5E7EB]' },
          { label: 'Active Comments',  value: active,  color: 'text-emerald-400' },
          { label: 'Deleted Comments', value: deleted, color: 'text-red-400' },
        ].map(s => (
          <div key={s.label} className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4 text-center">
            <p className={`text-[22px] font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-[#6B7280] mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <FilterBar
        active={filter}
        onChange={setFilter}
        counts={{ all: total, active, deleted }}
      />

      {filtered.length === 0 ? (
        <Empty label="No comments match this filter" />
      ) : (
        <div className="space-y-2.5">
          {filtered.map(comment => {
            const profile  = comment.profiles;
            const feedItem = comment.activity_feed_items;
            const badge    = postTypeBadge(feedItem?.type);
            const busy     = acting === comment.id;
            return (
              <div
                key={comment.id}
                className={`bg-[#0F172A] border rounded-[14px] p-4 transition-all group ${
                  comment.is_deleted ? 'border-red-500/15 opacity-60' : 'border-white/6 hover:border-white/20 hover:bg-white/[0.03]'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <InitialAvatar name={profile?.full_name} size={9} />

                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">
                        {profile?.full_name ?? 'Unknown'}
                      </p>
                      <p className="text-[12px] text-[#6B7280]">
                        @{profile?.username ?? '—'}
                      </p>
                      {comment.is_deleted && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-red-400 bg-red-500/10">
                          Deleted
                        </span>
                      )}
                    </div>

                    <p className="text-[13px] text-[#E5E7EB] leading-relaxed mb-1.5 break-words">
                      {sanitize(comment.content)}
                    </p>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-[#6B7280]">
                        On:
                      </span>
                      {feedItem && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${badge.color}`}>
                          {badge.label}
                        </span>
                      )}
                      {feedItem?.created_at && (
                        <span className="text-[11px] text-[#4B5563]">
                          {relativeTime(feedItem.created_at)}
                        </span>
                      )}
                      <span className="text-[#4B5563]">·</span>
                      <span className="text-[11px] text-[#4B5563]">
                        {relativeTime(comment.created_at)}
                      </span>
                    </div>
                  </div>

                  {/* Action */}
                  <button
                    onClick={() => handleToggleDelete(comment)}
                    disabled={busy}
                    title={comment.is_deleted ? 'Restore comment' : 'Delete comment'}
                    className={`flex-shrink-0 p-2 rounded-lg transition-all disabled:opacity-40 md:opacity-0 md:group-hover:opacity-100 ${
                      comment.is_deleted
                        ? 'text-emerald-500 hover:bg-emerald-500/10 md:opacity-100'
                        : 'text-[#4B5563] hover:text-red-400 hover:bg-red-500/10'
                    }`}
                  >
                    {comment.is_deleted
                      ? <RotateCcw size={15} />
                      : <Trash2 size={15} />
                    }
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── REPORTS TAB ─────────────────────────────────────────────────────────────

const REPORT_STATUS_STYLES = {
  pending:   { label: 'Pending',   color: 'text-amber-400 bg-amber-500/10' },
  reviewed:  { label: 'Reviewed',  color: 'text-blue-400 bg-blue-500/10' },
  dismissed: { label: 'Dismissed', color: 'text-[#9CA3AF] bg-white/6' },
  actioned:  { label: 'Actioned',  color: 'text-emerald-400 bg-emerald-500/10' },
};

const ReportsTab = ({ gymId }) => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('all');
  const [acting,  setActing]  = useState(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
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
    setReports(data || []);
    setLoading(false);
  };

  useEffect(() => { if (gymId) load(); }, [gymId]);

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

    setReports(prev =>
      prev.map(r => r.id === report.id ? { ...r, status: newStatus, reviewed_at: new Date().toISOString() } : r)
    );
    setActing(null);
  };

  const total    = reports.length;
  const pending  = reports.filter(r => r.status === 'pending').length;
  const resolved = reports.filter(r => r.status !== 'pending').length;

  const filtered = useMemo(() => {
    if (filter === 'active')  return reports.filter(r => r.status === 'pending');
    if (filter === 'deleted') return reports.filter(r => r.status !== 'pending');
    return reports;
  }, [reports, filter]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-1">
        {[
          { label: 'Total Reports',    value: total,    color: 'text-[#E5E7EB]' },
          { label: 'Pending Review',   value: pending,  color: 'text-amber-400' },
          { label: 'Resolved',         value: resolved, color: 'text-emerald-400' },
        ].map(s => (
          <div key={s.label} className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4 text-center">
            <p className={`text-[22px] font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-[#6B7280] mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <FilterBar
        active={filter}
        onChange={setFilter}
        counts={{ all: total, active: pending, deleted: resolved }}
        labels={{ all: 'All', active: 'Pending', deleted: 'Resolved' }}
      />

      {filtered.length === 0 ? (
        <Empty label="No reports match this filter" />
      ) : (
        <div className="space-y-2.5">
          {filtered.map(report => {
            const reporter = report.profiles;
            const feedItem = report.activity_feed_items;
            const author   = feedItem?.profiles;
            const badge    = postTypeBadge(feedItem?.type);
            const status   = REPORT_STATUS_STYLES[report.status] || REPORT_STATUS_STYLES.pending;
            const busy     = acting === report.id;
            const isPending = report.status === 'pending';
            return (
              <div
                key={report.id}
                className={`bg-[#0F172A] border rounded-[14px] p-4 transition-all group ${
                  isPending ? 'border-amber-500/20 hover:border-amber-500/40' : 'border-white/6 opacity-70'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <InitialAvatar name={reporter?.full_name} size={9} />

                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">
                        {reporter?.full_name ?? 'Unknown'}
                      </p>
                      <p className="text-[12px] text-[#6B7280]">
                        @{reporter?.username ?? '—'}
                      </p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status.color}`}>
                        {status.label}
                      </span>
                    </div>

                    {/* Reason */}
                    <p className="text-[13px] text-[#E5E7EB] leading-relaxed mb-1.5">
                      <span className="text-[#6B7280]">Reason:</span>{' '}
                      {sanitize(report.reason)}
                    </p>

                    {/* Reported content info */}
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[11px] text-[#6B7280]">Reported post:</span>
                      {feedItem && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${badge.color}`}>
                          {badge.label}
                        </span>
                      )}
                      {author && (
                        <span className="text-[11px] text-[#9CA3AF]">
                          by {author.full_name ?? author.username ?? 'Unknown'}
                        </span>
                      )}
                      {feedItem?.is_deleted && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-red-400 bg-red-500/10">
                          Deleted
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="text-[11px] text-[#4B5563]">
                        Reported {relativeTime(report.created_at)}
                      </p>
                      {report.reviewed_at && (
                        <>
                          <span className="text-[#4B5563]">·</span>
                          <p className="text-[11px] text-[#4B5563]">
                            Reviewed {relativeTime(report.reviewed_at)}
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  {isPending && (
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => handleUpdateStatus(report, 'actioned')}
                        disabled={busy}
                        title="Take action (removes reported post)"
                        className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-40"
                      >
                        <XCircle size={15} />
                      </button>
                      <button
                        onClick={() => handleUpdateStatus(report, 'dismissed')}
                        disabled={busy}
                        title="Dismiss report"
                        className="p-2 rounded-lg text-[#4B5563] hover:text-emerald-400 hover:bg-emerald-500/10 transition-all disabled:opacity-40"
                      >
                        <CheckCircle size={15} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── MAIN ───────────────────────────────────────────────────────────────────

export default function AdminModeration() {
  const { profile } = useAuth();
  const [tab, setTab] = useState('posts');

  useEffect(() => { document.title = 'Admin - Moderation | IronForge'; }, []);

  const gymId = profile?.gym_id;

  const tabs = [
    { key: 'posts',    label: 'Feed Posts',  icon: Activity },
    { key: 'comments', label: 'Comments',    icon: MessageSquare },
    { key: 'reports',  label: 'Reports',     icon: Flag },
  ];

  return (
    <div className="px-4 md:px-8 py-6 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#E5E7EB]">Content Moderation</h1>
        <p className="text-[13px] text-[#6B7280] mt-0.5">
          Review and moderate feed posts, comments, and member reports across your gym
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-white/6 mb-5">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                tab === t.key
                  ? 'text-[#D4AF37] border-b-2 border-[#D4AF37] -mb-px'
                  : 'text-[#6B7280] hover:text-[#9CA3AF]'
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {!gymId ? (
        <div className="text-center py-20">
          <p className="text-[14px] text-[#6B7280]">No gym associated with your account.</p>
        </div>
      ) : tab === 'posts' ? (
        <PostsTab gymId={gymId} />
      ) : tab === 'comments' ? (
        <CommentsTab gymId={gymId} />
      ) : (
        <ReportsTab gymId={gymId} />
      )}
    </div>
  );
}
