import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Heart, MessageCircle, Trophy, Dumbbell, Zap, Send, Clock,
  Search, UserPlus, Check, X, Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ── Helpers ───────────────────────────────────────────────────────────────────
const timeAgo = (iso) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const fmtDuration = (s) => {
  if (!s) return '';
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

const fmtVolume = (lbs) => {
  if (!lbs) return '0 lbs';
  return lbs >= 1000 ? `${(lbs / 1000).toFixed(1)}k lbs` : `${Math.round(lbs)} lbs`;
};

// ── Feed item content ─────────────────────────────────────────────────────────
const FeedContent = ({ type, data }) => {
  if (type === 'workout_completed') {
    return (
      <div className="rounded-xl p-4 border-l-[3px]"
        style={{ background: 'rgba(0,0,0,0.03)', borderLeftColor: 'var(--accent-gold)' }}>
        <p className="font-bold text-[16px] leading-tight mb-3" style={{ color: 'var(--text-primary)' }}>
          {data.routine_name ?? 'Workout'}
        </p>
        <div className="flex flex-wrap gap-4">
          {data.duration_seconds > 0 && (
            <span className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              <Clock size={12} /> {fmtDuration(data.duration_seconds)}
            </span>
          )}
          {data.total_volume_lbs > 0 && (
            <span className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              <Zap size={12} /> {fmtVolume(data.total_volume_lbs)}
            </span>
          )}
          {data.exercise_count > 0 && (
            <span className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              <Dumbbell size={12} /> {data.exercise_count} exercise{data.exercise_count !== 1 ? 's' : ''}
            </span>
          )}
          {data.set_count > 0 && (
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {data.set_count} sets
            </span>
          )}
        </div>
      </div>
    );
  }

  if (type === 'pr_hit') {
    return (
      <div className="rounded-xl p-4 border-l-[3px] border-l-amber-400"
        style={{ background: 'rgba(245,158,11,0.06)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Trophy size={14} className="text-amber-500 flex-shrink-0" />
          <p className="font-bold text-[13px] text-amber-700">New Personal Record</p>
        </div>
        <p className="font-black text-[20px]" style={{ color: 'var(--text-primary)' }}>
          {data.exercise_name}
        </p>
        <p className="text-[15px] font-semibold mt-1" style={{ color: 'var(--accent-gold)' }}>
          {data.weight_lbs} lbs × {data.reps}{' '}
          {data.estimated_1rm > 0 && (
            <span className="font-normal text-[13px]" style={{ color: 'var(--text-muted)' }}>
              · e1RM {Math.round(data.estimated_1rm)} lbs
            </span>
          )}
        </p>
      </div>
    );
  }

  if (type === 'achievement_unlocked') {
    return (
      <div className="rounded-xl p-4 border-l-[3px] border-l-purple-400"
        style={{ background: 'rgba(167,139,250,0.06)' }}>
        <p className="font-bold text-[13px] text-purple-600 mb-1">Achievement Unlocked 🎖️</p>
        <p className="font-bold text-[16px]" style={{ color: 'var(--text-primary)' }}>
          {data.achievement_name ?? 'New Achievement'}
        </p>
        {data.achievement_desc && (
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {data.achievement_desc}
          </p>
        )}
      </div>
    );
  }

  if (type === 'check_in') {
    return (
      <div className="rounded-xl p-4 border-l-[3px] border-l-emerald-400"
        style={{ background: 'rgba(16,185,129,0.06)' }}>
        <p className="font-semibold text-[15px]" style={{ color: 'var(--text-primary)' }}>
          ✅ Checked in at the gym{data.gym_name ? ` — ${data.gym_name}` : ''}
        </p>
      </div>
    );
  }

  if (type === 'program_started') {
    return (
      <div className="rounded-xl p-4 border-l-[3px]"
        style={{ background: 'rgba(59,130,246,0.06)', borderLeftColor: '#3B82F6' }}>
        <p className="font-semibold text-[15px]" style={{ color: 'var(--text-primary)' }}>
          🚀 Started <span className="font-bold">{data.program_name ?? 'a new program'}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-4" style={{ background: 'rgba(0,0,0,0.03)' }}>
      <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
        {type.replace(/_/g, ' ')}
      </p>
    </div>
  );
};

// ── Avatar ────────────────────────────────────────────────────────────────────
const Avatar = ({ src, name, size = 44 }) => {
  const initial = (name ?? '?')[0].toUpperCase();
  return src ? (
    <img src={src} alt={name} className="rounded-full object-cover flex-shrink-0"
      style={{ width: size, height: size, border: '1.5px solid var(--border-subtle)' }} />
  ) : (
    <div className="rounded-full flex items-center justify-center flex-shrink-0 font-bold"
      style={{
        width: size, height: size,
        background: 'rgba(212,175,55,0.12)',
        border: '1.5px solid rgba(212,175,55,0.25)',
        color: 'var(--accent-gold)',
        fontSize: size * 0.38,
      }}>
      {initial}
    </div>
  );
};

// ── Friend status badge ───────────────────────────────────────────────────────
const FriendButton = ({ status, onAdd, onAccept }) => {
  if (status === 'accepted') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium flex-shrink-0"
        style={{ color: '#10B981' }}>
        <Check size={11} /> Friends
      </span>
    );
  }
  if (status === 'pending_sent') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium flex-shrink-0"
        style={{ color: 'var(--text-muted)' }}>
        <Clock size={11} /> Pending
      </span>
    );
  }
  if (status === 'pending_received' && onAccept) {
    return (
      <button onClick={onAccept}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold active:scale-95 transition-all flex-shrink-0"
        style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10B981' }}>
        <Check size={11} /> Accept
      </button>
    );
  }
  // 'none'
  return (
    <button onClick={onAdd}
      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold active:scale-95 transition-all flex-shrink-0"
      style={{ background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.3)', color: 'var(--accent-gold)' }}>
      <UserPlus size={11} /> Add
    </button>
  );
};

// ── Comment Item ──────────────────────────────────────────────────────────────
const CommentRow = ({ comment }) => (
  <div className="flex gap-2.5 py-2">
    <Avatar src={comment.profiles?.avatar_url} name={comment.profiles?.full_name ?? '?'} size={30} />
    <div className="flex-1 rounded-xl px-3 py-2" style={{ background: 'var(--bg-elevated)' }}>
      <span className="font-semibold text-[13px]" style={{ color: 'var(--text-primary)' }}>
        {comment.profiles?.full_name ?? 'Member'}{' '}
      </span>
      <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
        {comment.content}
      </span>
    </div>
  </div>
);

// ── Feed Card ─────────────────────────────────────────────────────────────────
const FeedCard = ({ item, currentUserId, onToggleLike }) => {
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments]         = useState(null);
  const [commentText, setCommentText]   = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const inputRef = useRef(null);

  const loadComments = async () => {
    if (comments !== null) return;
    const { data } = await supabase
      .from('feed_comments')
      .select('id, content, created_at, profiles(full_name, avatar_url)')
      .eq('feed_item_id', item.id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });
    setComments(data ?? []);
  };

  const handleToggleComments = () => {
    if (!showComments) loadComments();
    setShowComments(s => !s);
    setTimeout(() => inputRef.current?.focus(), 150);
  };

  const handleSubmitComment = async () => {
    if (!commentText.trim() || submitting) return;
    setSubmitting(true);
    const content = commentText.trim();
    setCommentText('');
    const { data: newComment, error } = await supabase
      .from('feed_comments')
      .insert({ feed_item_id: item.id, profile_id: currentUserId, content })
      .select('id, content, created_at, profiles(full_name, avatar_url)')
      .single();
    if (!error && newComment) setComments(prev => [...(prev ?? []), newComment]);
    setSubmitting(false);
  };

  return (
    <div className="rounded-[14px] overflow-hidden transition-all"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>

      {/* Header */}
      <div className="flex items-center gap-3 p-4 pb-3">
        <Avatar src={item.profiles?.avatar_url} name={item.profiles?.full_name ?? '?'} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[14px] leading-snug" style={{ color: 'var(--text-primary)' }}>
            {item.profiles?.full_name ?? 'Gym Member'}
          </p>
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            @{item.profiles?.username ?? '—'} · {timeAgo(item.created_at)}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-3">
        <FeedContent type={item.type} data={item.data ?? {}} />
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-5 px-4 py-3"
        style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => onToggleLike(item.id, item.hasLiked)}
          className="flex items-center gap-1.5 text-[13px] font-medium transition-colors"
          style={{ color: item.hasLiked ? '#EF4444' : 'var(--text-muted)' }}
        >
          <Heart size={15} fill={item.hasLiked ? 'currentColor' : 'none'} />
          {item.likeCount > 0 ? item.likeCount : ''}
        </button>

        <button
          onClick={handleToggleComments}
          className="flex items-center gap-1.5 text-[13px] font-medium transition-colors hover:opacity-70"
          style={{ color: showComments ? '#3B82F6' : 'var(--text-muted)' }}
        >
          <MessageCircle size={15} />
          {item.commentCount > 0 ? item.commentCount : ''}
        </button>
      </div>

      {/* Comments section */}
      {showComments && (
        <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="pt-3 flex flex-col">
            {comments === null ? (
              <p className="text-[12px] py-3 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</p>
            ) : comments.length === 0 ? (
              <p className="text-[12px] py-2" style={{ color: 'var(--text-muted)' }}>No comments yet. Be the first!</p>
            ) : (
              comments.map(c => <CommentRow key={c.id} comment={c} />)
            )}
          </div>
          <div className="flex gap-2 mt-2">
            <input
              ref={inputRef}
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSubmitComment()}
              placeholder="Write a comment…"
              className="flex-1 rounded-xl px-3 py-2 text-[13px] focus:outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <button
              onClick={handleSubmitComment}
              disabled={!commentText.trim() || submitting}
              className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-40 active:scale-95 transition-all"
              style={{ background: 'var(--accent-gold)' }}
            >
              <Send size={14} className="text-black" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Find Friends Panel ────────────────────────────────────────────────────────
const FindFriendsPanel = ({ userId, gymId, friendships, onFriendshipsChange, onClose }) => {
  const [query, setQuery]             = useState('');
  const [results, setResults]         = useState([]);
  const [searching, setSearching]     = useState(false);
  const [friendProfiles, setFriendProfiles] = useState({}); // { [profileId]: profile }
  const timerRef = useRef(null);

  // Load profiles for all accepted friends so we can display them
  useEffect(() => {
    const acceptedIds = friendships
      .filter(f => f.status === 'accepted')
      .map(f => f.requester_id === userId ? f.addressee_id : f.requester_id)
      .filter(id => !friendProfiles[id]);

    if (!acceptedIds.length) return;

    supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url')
      .in('id', acceptedIds)
      .then(({ data }) => {
        if (!data) return;
        setFriendProfiles(prev => {
          const next = { ...prev };
          data.forEach(p => { next[p.id] = p; });
          return next;
        });
      });
  }, [friendships, userId]);

  // Derive status for any profile ID
  const statusFor = (profileId) => {
    const f = friendships.find(
      f => f.requester_id === profileId || f.addressee_id === profileId
    );
    if (!f) return 'none';
    if (f.status === 'accepted') return 'accepted';
    if (f.requester_id === userId) return 'pending_sent';
    return 'pending_received';
  };

  const handleSearch = useCallback((q) => {
    clearTimeout(timerRef.current);
    if (!q.trim()) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      const term = q.trim();
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .neq('id', userId)
        .or(`username.ilike.%${term}%,full_name.ilike.%${term}%`)
        .limit(10);
      if (error) console.error('Friend search error:', error);
      setResults(data ?? []);
      setSearching(false);
    }, 300);
  }, [userId]);

  const handleAddFriend = async (profileId) => {
    const { data, error } = await supabase
      .from('friendships')
      .insert({ gym_id: gymId, requester_id: userId, addressee_id: profileId })
      .select('id, requester_id, addressee_id, status')
      .single();
    if (!error && data) onFriendshipsChange(prev => [...prev, data]);
  };

  const handleAccept = async (friendship) => {
    const { error } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendship.id);
    if (!error) {
      onFriendshipsChange(prev =>
        prev.map(f => f.id === friendship.id ? { ...f, status: 'accepted' } : f)
      );
    }
  };

  // Incoming requests from others
  const incomingRequests = friendships.filter(
    f => f.addressee_id === userId && f.status === 'pending'
  );

  return (
    <div className="rounded-[14px] overflow-hidden mb-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>

      {/* Search input */}
      <div className="p-4 pb-3 flex items-center gap-3">
        <div className="flex-1 flex items-center gap-2 rounded-xl px-3 py-2.5"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          <Search size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            autoFocus
            value={query}
            onChange={e => { setQuery(e.target.value); handleSearch(e.target.value); }}
            placeholder="Search by username…"
            className="flex-1 bg-transparent text-[13px] focus:outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          {query && (
            <button onClick={() => { setQuery(''); setResults([]); }} className="hover:opacity-60">
              <X size={12} style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
          style={{ color: 'var(--text-muted)' }}>
          <X size={16} />
        </button>
      </div>

      {/* Incoming requests */}
      {incomingRequests.length > 0 && !query && (
        <div className="px-4 pb-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-muted)' }}>
            Friend Requests
          </p>
          {incomingRequests.map(f => (
            <IncomingRequestRow
              key={f.id}
              friendship={f}
              onAccept={() => handleAccept(f)}
            />
          ))}
        </div>
      )}

      {/* Search results */}
      {query.trim() && (
        <div className="px-4 pb-4" style={{ borderTop: incomingRequests.length && !query ? '1px solid var(--border-subtle)' : 'none' }}>
          {searching && (
            <p className="text-[12px] py-3 text-center" style={{ color: 'var(--text-muted)' }}>Searching…</p>
          )}
          {!searching && results.length === 0 && (
            <p className="text-[12px] py-3 text-center" style={{ color: 'var(--text-muted)' }}>
              No members found for "{query}"
            </p>
          )}
          {!searching && results.map((p, i) => {
            const status = statusFor(p.id);
            const f = friendships.find(f => f.requester_id === p.id || f.addressee_id === p.id);
            return (
              <div key={p.id} className="flex items-center gap-3 py-3"
                style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)' }}>
                <Avatar src={p.avatar_url} name={p.full_name} size={36} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[13px] truncate" style={{ color: 'var(--text-primary)' }}>
                    {p.full_name}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>@{p.username}</p>
                </div>
                <FriendButton
                  status={status}
                  onAdd={() => handleAddFriend(p.id)}
                  onAccept={f ? () => handleAccept(f) : undefined}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Friends list (no search active) */}
      {!query.trim() && (() => {
        const accepted = friendships.filter(f => f.status === 'accepted');
        if (!accepted.length && !incomingRequests.length) {
          return (
            <p className="text-[12px] px-4 pb-4" style={{ color: 'var(--text-muted)' }}>
              Search for gym members by username to send a friend request.
            </p>
          );
        }
        if (!accepted.length) return null;
        return (
          <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wider mt-3 mb-2"
              style={{ color: 'var(--text-muted)' }}>
              Friends · {accepted.length}
            </p>
            {accepted.map(f => {
              const otherId = f.requester_id === userId ? f.addressee_id : f.requester_id;
              const p = friendProfiles[otherId];
              if (!p) return null;
              return (
                <div key={f.id} className="flex items-center gap-3 py-2.5">
                  <Avatar src={p.avatar_url} name={p.full_name} size={36} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[13px] truncate" style={{ color: 'var(--text-primary)' }}>
                      {p.full_name}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>@{p.username}</p>
                  </div>
                  <FriendButton status="accepted" />
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
};

// ── Incoming Request Row (loads profile) ──────────────────────────────────────
const IncomingRequestRow = ({ friendship, onAccept }) => {
  const [requesterProfile, setRequesterProfile] = useState(null);

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url')
      .eq('id', friendship.requester_id)
      .single()
      .then(({ data }) => setRequesterProfile(data));
  }, [friendship.requester_id]);

  if (!requesterProfile) return null;

  return (
    <div className="flex items-center gap-3 py-2.5">
      <Avatar src={requesterProfile.avatar_url} name={requesterProfile.full_name} size={36} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[13px] truncate" style={{ color: 'var(--text-primary)' }}>
          {requesterProfile.full_name}
        </p>
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>@{requesterProfile.username}</p>
      </div>
      <FriendButton status="pending_received" onAccept={onAccept} />
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
const SocialFeed = () => {
  const { user, profile } = useAuth();
  const [feed, setFeed]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [friendships, setFriendships] = useState([]);
  const [showSearch, setShowSearch]   = useState(false);
  const [tab, setTab]                 = useState('friends');

  // Load friendships for current user
  const loadFriendships = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('friendships')
      .select('id, requester_id, addressee_id, status')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
    setFriendships(data ?? []);
  }, [user]);

  // Load feed — only from accepted friends + self
  const loadFeed = useCallback(async (fships) => {
    if (!user || !profile) return;

    const acceptedIds = fships
      .filter(f => f.status === 'accepted')
      .map(f => f.requester_id === user.id ? f.addressee_id : f.requester_id);

    const actorIds = [user.id, ...acceptedIds];

    const { data: items } = await supabase
      .from('activity_feed_items')
      .select('*, profiles!actor_id(full_name, username, avatar_url)')
      .in('actor_id', actorIds)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!items?.length) { setFeed([]); setLoading(false); return; }

    const itemIds = items.map(i => i.id);

    const [{ data: allLikes }, { data: commentCounts }] = await Promise.all([
      supabase.from('feed_likes').select('feed_item_id, profile_id').in('feed_item_id', itemIds),
      supabase.from('feed_comments').select('feed_item_id').in('feed_item_id', itemIds).eq('is_deleted', false),
    ]);

    const likeCountMap    = {};
    const myLikedSet      = new Set();
    const commentCountMap = {};

    allLikes?.forEach(l => {
      likeCountMap[l.feed_item_id] = (likeCountMap[l.feed_item_id] ?? 0) + 1;
      if (l.profile_id === user.id) myLikedSet.add(l.feed_item_id);
    });
    commentCounts?.forEach(c => {
      commentCountMap[c.feed_item_id] = (commentCountMap[c.feed_item_id] ?? 0) + 1;
    });

    setFeed(items.map(item => ({
      ...item,
      likeCount:    likeCountMap[item.id]    ?? 0,
      commentCount: commentCountMap[item.id] ?? 0,
      hasLiked:     myLikedSet.has(item.id),
    })));
    setLoading(false);
  }, [user, profile]);

  useEffect(() => {
    if (!user || !profile) return;
    const init = async () => {
      setLoading(true);
      const { data: fships } = await supabase
        .from('friendships')
        .select('id, requester_id, addressee_id, status')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
      const resolved = fships ?? [];
      setFriendships(resolved);
      await loadFeed(resolved);
    };
    init();
  }, [user, profile]);

  // When friendships change (accept/add), reload feed
  const handleFriendshipsChange = (updater) => {
    setFriendships(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      // Reload feed if new accepted friendship was added
      loadFeed(next);
      return next;
    });
  };

  const handleToggleLike = async (itemId, currentlyLiked) => {
    setFeed(prev => prev.map(item =>
      item.id === itemId
        ? { ...item, hasLiked: !currentlyLiked, likeCount: currentlyLiked ? item.likeCount - 1 : item.likeCount + 1 }
        : item
    ));
    if (currentlyLiked) {
      await supabase.from('feed_likes').delete().eq('feed_item_id', itemId).eq('profile_id', user.id);
    } else {
      await supabase.from('feed_likes').insert({ feed_item_id: itemId, profile_id: user.id });
    }
  };

  const pendingIncoming = friendships.filter(
    f => f.addressee_id === user?.id && f.status === 'pending'
  ).length;

  const friendsFeed = feed.filter(item => item.actor_id !== user?.id);
  const myFeed      = feed.filter(item => item.actor_id === user?.id);
  const activeFeed  = tab === 'friends' ? friendsFeed : myFeed;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 md:px-8 pt-8 md:pt-12 pb-28 md:pb-12 animate-fade-in">

      {/* Header */}
      <header className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-[24px] font-bold" style={{ color: 'var(--text-primary)', fontFamily: "'Barlow Condensed', sans-serif" }}>
          Social
        </h1>
        <button
          onClick={() => setShowSearch(s => !s)}
          className="relative flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold active:scale-95 transition-all mt-1"
          style={{
            background: showSearch ? 'var(--accent-gold)' : 'rgba(212,175,55,0.1)',
            color: showSearch ? '#000' : 'var(--accent-gold)',
            border: '1px solid rgba(212,175,55,0.3)',
          }}
        >
          <Users size={14} />
          Friends
          {pendingIncoming > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
              style={{ background: '#EF4444' }}>
              {pendingIncoming}
            </span>
          )}
        </button>
      </header>

      <div className="max-w-[680px] mx-auto">

        {/* Find Friends panel */}
        {showSearch && (
          <FindFriendsPanel
            userId={user.id}
            gymId={profile.gym_id}
            friendships={friendships}
            onFriendshipsChange={handleFriendshipsChange}
            onClose={() => setShowSearch(false)}
          />
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-5 rounded-xl p-1"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          {[
            { key: 'friends', label: 'Friends' },
            { key: 'mine',    label: 'My Posts' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all"
              style={{
                background: tab === t.key ? 'var(--bg-card)' : 'transparent',
                color: tab === t.key ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Loading skeletons */}
        {loading && (
          <div className="flex flex-col gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-[14px] h-36 animate-pulse"
                style={{ background: 'var(--bg-elevated)' }} />
            ))}
          </div>
        )}

        {/* Empty states */}
        {!loading && activeFeed.length === 0 && tab === 'friends' && (
          <div className="text-center py-20">
            <Users size={40} className="mx-auto mb-4" style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
            <p className="font-semibold text-[16px]" style={{ color: 'var(--text-secondary)' }}>
              No friend activity yet
            </p>
            <p className="text-[13px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Add friends to see their workouts and PRs here.
            </p>
            <button
              onClick={() => setShowSearch(true)}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold active:scale-95 transition-all"
              style={{ background: 'var(--accent-gold)', color: '#000' }}
            >
              <UserPlus size={14} /> Find Friends
            </button>
          </div>
        )}

        {!loading && activeFeed.length === 0 && tab === 'mine' && (
          <div className="text-center py-20">
            <Dumbbell size={40} className="mx-auto mb-4" style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
            <p className="font-semibold text-[16px]" style={{ color: 'var(--text-secondary)' }}>
              No posts yet
            </p>
            <p className="text-[13px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Finish a workout to post your first activity.
            </p>
          </div>
        )}

        {/* Feed items */}
        {!loading && activeFeed.length > 0 && (
          <div className="flex flex-col gap-4">
            {activeFeed.map(item => (
              <FeedCard
                key={item.id}
                item={item}
                currentUserId={user.id}
                onToggleLike={handleToggleLike}
              />
            ))}
            <p className="text-center text-[12px] py-6 tracking-wide" style={{ color: 'var(--text-muted)' }}>
              — You're all caught up —
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SocialFeed;
