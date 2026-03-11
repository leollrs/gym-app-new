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
      <div className="rounded-2xl p-4 border-l-4 border-amber-400 bg-amber-50/60 dark:bg-amber-900/30 dark:border-amber-500">
        <p className="font-bold text-[16px] leading-tight mb-3 text-[#0F172A] dark:text-slate-100">
          {data.routine_name ?? 'Workout'}
        </p>
        <div className="flex flex-wrap gap-4">
          {data.duration_seconds > 0 && (
            <span className="flex items-center gap-1.5 text-[12px] text-[#64748B] dark:text-slate-400">
              <Clock size={12} /> {fmtDuration(data.duration_seconds)}
            </span>
          )}
          {data.total_volume_lbs > 0 && (
            <span className="flex items-center gap-1.5 text-[12px] text-[#64748B] dark:text-slate-400">
              <Zap size={12} /> {fmtVolume(data.total_volume_lbs)}
            </span>
          )}
          {data.exercise_count > 0 && (
            <span className="flex items-center gap-1.5 text-[12px] text-[#64748B] dark:text-slate-400">
              <Dumbbell size={12} /> {data.exercise_count} exercise{data.exercise_count !== 1 ? 's' : ''}
            </span>
          )}
          {data.set_count > 0 && (
            <span className="text-[12px] text-[#64748B] dark:text-slate-400">{data.set_count} sets</span>
          )}
        </div>
      </div>
    );
  }

  if (type === 'pr_hit') {
    return (
      <div className="rounded-2xl p-4 border-l-4 border-amber-400 bg-amber-50/80 dark:bg-amber-900/30 dark:border-amber-500">
        <div className="flex items-center gap-2 mb-1">
          <Trophy size={14} className="text-amber-500 dark:text-amber-400 flex-shrink-0" />
          <p className="font-bold text-[13px] text-amber-700 dark:text-amber-300">New Personal Record</p>
        </div>
        <p className="font-black text-[20px] text-[#0F172A] dark:text-slate-100">{data.exercise_name}</p>
        <p className="text-[15px] font-semibold mt-1 text-amber-700 dark:text-amber-300">
          {data.weight_lbs} lbs × {data.reps}{' '}
          {data.estimated_1rm > 0 && (
            <span className="font-normal text-[13px] text-[#64748B] dark:text-slate-400">· e1RM {Math.round(data.estimated_1rm)} lbs</span>
          )}
        </p>
      </div>
    );
  }

  if (type === 'achievement_unlocked') {
    return (
      <div className="rounded-2xl p-4 border-l-4 border-purple-400 bg-purple-50/80 dark:bg-purple-900/30 dark:border-purple-500">
        <p className="font-bold text-[13px] text-purple-600 dark:text-purple-300 mb-1">Achievement Unlocked 🎖️</p>
        <p className="font-bold text-[16px] text-[#0F172A] dark:text-slate-100">{data.achievement_name ?? 'New Achievement'}</p>
        {data.achievement_desc && (
          <p className="text-[13px] mt-0.5 text-[#64748B] dark:text-slate-400">{data.achievement_desc}</p>
        )}
      </div>
    );
  }

  if (type === 'check_in') {
    return (
      <div className="rounded-2xl p-4 border-l-4 border-emerald-400 bg-emerald-50/80 dark:bg-emerald-900/30 dark:border-emerald-500">
        <p className="font-semibold text-[15px] text-[#0F172A] dark:text-slate-100">
          ✅ Checked in at the gym{data.gym_name ? ` — ${data.gym_name}` : ''}
        </p>
      </div>
    );
  }

  if (type === 'program_started') {
    return (
      <div className="rounded-2xl p-4 border-l-4 border-blue-400 bg-blue-50/80 dark:bg-blue-900/30 dark:border-blue-500">
        <p className="font-semibold text-[15px] text-[#0F172A] dark:text-slate-100">
          🚀 Started <span className="font-bold">{data.program_name ?? 'a new program'}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-4 bg-slate-100/80 dark:bg-slate-700/50">
      <p className="text-[14px] text-[#475569] dark:text-slate-400">{type.replace(/_/g, ' ')}</p>
    </div>
  );
};

// ── Avatar ────────────────────────────────────────────────────────────────────
const Avatar = ({ src, name, size = 44 }) => {
  const initial = (name ?? '?')[0].toUpperCase();
  return src ? (
    <img src={src} alt={name} className="rounded-full object-cover flex-shrink-0 border-2 border-slate-200 dark:border-white/20"
      style={{ width: size, height: size }} />
  ) : (
    <div
      className="rounded-full flex items-center justify-center flex-shrink-0 font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-2 border-amber-200 dark:border-amber-700"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initial}
    </div>
  );
};

// ── Friend status badge ───────────────────────────────────────────────────────
const FriendButton = ({ status, onAdd, onAccept }) => {
  if (status === 'accepted') {
    return (
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600 dark:text-emerald-400 flex-shrink-0 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/40">
        <Check size={12} strokeWidth={2.5} /> Friends
      </span>
    );
  }
  if (status === 'pending_sent') {
    return (
      <span className="flex items-center gap-1 text-[12px] font-medium text-[#64748B] dark:text-slate-400 flex-shrink-0">
        <Clock size={12} /> Pending
      </span>
    );
  }
  if (status === 'pending_received' && onAccept) {
    return (
      <button
        type="button"
        onClick={onAccept}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold active:scale-95 transition-all flex-shrink-0 bg-emerald-500 text-white hover:bg-emerald-600"
      >
        <Check size={12} strokeWidth={2.5} /> Accept
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onAdd}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold active:scale-95 transition-all flex-shrink-0 bg-amber-500 text-black hover:bg-amber-600"
    >
      <UserPlus size={12} strokeWidth={2} /> Add
    </button>
  );
};

// ── Comment Item ──────────────────────────────────────────────────────────────
const CommentRow = ({ comment }) => (
  <div className="flex gap-3 py-2">
    <Avatar src={comment.profiles?.avatar_url} name={comment.profiles?.full_name ?? '?'} size={32} />
    <div className="flex-1 rounded-2xl px-4 py-2.5 bg-slate-100 dark:bg-slate-700/60 border border-slate-200/80 dark:border-white/10">
      <span className="font-semibold text-[13px] text-[#0F172A] dark:text-slate-100">
        {comment.profiles?.full_name ?? 'Member'}{' '}
      </span>
      <span className="text-[13px] text-[#475569] dark:text-slate-400">{comment.content}</span>
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
    <div className="rounded-2xl overflow-hidden bg-white dark:bg-slate-800 border border-black/5 dark:border-white/10 shadow-sm hover:shadow-md transition-shadow">

      {/* Header */}
      <div className="flex items-center gap-4 p-5 pb-4">
        <Avatar src={item.profiles?.avatar_url} name={item.profiles?.full_name ?? '?'} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] leading-snug text-[#0F172A] dark:text-slate-100">
            {item.profiles?.full_name ?? 'Gym Member'}
          </p>
          <p className="text-[12px] text-[#64748B] dark:text-slate-400 mt-0.5">
            @{item.profiles?.username ?? '—'} · {timeAgo(item.created_at)}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="px-5 pb-4">
        <FeedContent type={item.type} data={item.data ?? {}} />
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-6 px-5 py-3 border-t border-slate-100 dark:border-white/10">
        <button
          type="button"
          onClick={() => onToggleLike(item.id, item.hasLiked)}
          className={`flex items-center gap-2 text-[13px] font-semibold transition-colors ${item.hasLiked ? 'text-red-500 dark:text-red-400' : 'text-[#64748B] dark:text-slate-400 hover:text-[#475569] dark:hover:text-slate-300'}`}
        >
          <Heart size={16} fill={item.hasLiked ? 'currentColor' : 'none'} />
          {item.likeCount > 0 ? item.likeCount : 'Like'}
        </button>
        <button
          type="button"
          onClick={handleToggleComments}
          className={`flex items-center gap-2 text-[13px] font-semibold transition-colors ${showComments ? 'text-blue-500 dark:text-blue-400' : 'text-[#64748B] dark:text-slate-400 hover:text-[#475569] dark:hover:text-slate-300'}`}
        >
          <MessageCircle size={16} />
          {item.commentCount > 0 ? item.commentCount : 'Comment'}
        </button>
      </div>

      {/* Comments section */}
      {showComments && (
        <div className="px-5 pb-5 pt-1 border-t border-slate-100 dark:border-white/10 bg-slate-50/50 dark:bg-white/5">
          <div className="pt-3 flex flex-col">
            {comments === null ? (
              <p className="text-[13px] py-3 text-center text-[#64748B] dark:text-slate-400">Loading…</p>
            ) : comments.length === 0 ? (
              <p className="text-[13px] py-2 text-[#64748B] dark:text-slate-400">No comments yet. Be the first!</p>
            ) : (
              comments.map(c => <CommentRow key={c.id} comment={c} />)
            )}
          </div>
          <div className="flex gap-2 mt-3">
            <input
              ref={inputRef}
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSubmitComment()}
              placeholder="Write a comment…"
              className="flex-1 rounded-2xl px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-amber-200 dark:focus:ring-amber-500/50 border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-700 text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={handleSubmitComment}
              disabled={!commentText.trim() || submitting}
              className="w-10 h-10 rounded-xl flex items-center justify-center disabled:opacity-40 active:scale-95 transition-all bg-amber-500 dark:bg-amber-500 text-black font-semibold"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Helper: get friendship status toward another profile ─────────────────────
const getFriendStatus = (friendships, userId, otherId) => {
  const f = friendships.find(
    (x) =>
      (x.requester_id === userId && x.addressee_id === otherId) ||
      (x.addressee_id === userId && x.requester_id === otherId)
  );
  if (!f) return 'none';
  if (f.status === 'accepted') return 'accepted';
  if (f.requester_id === userId) return 'pending_sent';
  return 'pending_received';
};

// ── Friends Panel ─────────────────────────────────────────────────────────────
const FriendsPanel = ({ userId, gymId, friendships, loadFriendships, onClose }) => {
  const [profiles, setProfiles] = useState({});
  const [requesters, setRequesters] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const [acceptingId, setAcceptingId] = useState(null);

  const accepted = friendships.filter((f) => f.status === 'accepted');
  const incoming = friendships.filter((f) => f.addressee_id === userId && f.status === 'pending');

  // Load profiles for accepted friends
  useEffect(() => {
    if (!accepted.length) return;
    const ids = accepted.map((f) => (f.requester_id === userId ? f.addressee_id : f.requester_id));
    supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url')
      .in('id', ids)
      .then(({ data, error }) => {
        if (error) return;
        const map = {};
        (data || []).forEach((p) => { map[p.id] = p; });
        setProfiles(map);
      });
  }, [accepted, userId]);

  // Load requester profiles for incoming
  useEffect(() => {
    if (!incoming.length) return;
    const ids = incoming.map((f) => f.requester_id);
    supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url')
      .in('id', ids)
      .then(({ data, error }) => {
        if (error) return;
        const map = {};
        (data || []).forEach((p) => { map[p.id] = p; });
        setRequesters(map);
      });
  }, [incoming]);

  // Search gym members — same gym only; merge results from name and username to avoid .or() issues
  useEffect(() => {
    if (!gymId || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const raw = searchQuery.trim();
    const pattern = `%${raw.replace(/'/g, "''")}%`; // escape single quotes for filter
    setSearching(true);
    Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .eq('gym_id', gymId)
        .neq('id', userId)
        .ilike('full_name', pattern)
        .limit(15),
      supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .eq('gym_id', gymId)
        .neq('id', userId)
        .ilike('username', pattern)
        .limit(15),
    ])
      .then(([byName, byUsername]) => {
        setSearching(false);
        const byNameData = byName.data ?? [];
        const byUsernameData = byUsername.data ?? [];
        const seen = new Set();
        const merged = [];
        for (const p of [...byNameData, ...byUsernameData]) {
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          merged.push(p);
        }
        setSearchResults(merged.slice(0, 20));
      })
      .catch(() => setSearching(false));
  }, [gymId, userId, searchQuery]);

  const handleAccept = async (friendshipId) => {
    setAcceptingId(friendshipId);
    await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
    await loadFriendships();
    setAcceptingId(null);
  };

  const handleAddFriend = async (addresseeId) => {
    if (!gymId) return;
    setAddingId(addresseeId);
    await supabase.from('friendships').insert({
      requester_id: userId,
      addressee_id: addresseeId,
      gym_id: gymId,
      status: 'pending',
    });
    await loadFriendships();
    setAddingId(null);
  };

  const incomingWithRequester = incoming.map((f) => ({ ...f, requester: requesters[f.requester_id] }));

  return (
    <div className="rounded-2xl overflow-hidden mb-6 bg-white dark:bg-slate-800 border border-black/5 dark:border-white/10 shadow-sm">

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <p className="font-bold text-[17px] text-[#0F172A] dark:text-slate-100">
          Friends
          {accepted.length > 0 && (
            <span className="font-normal ml-1.5 text-[#64748B] dark:text-slate-400">· {accepted.length}</span>
          )}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-[#64748B] dark:text-slate-400 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="px-5 pb-5 space-y-6">
        {/* Add Friends — search same-gym members only */}
        <div>
          <p className="text-[11px] font-semibold text-[#64748B] dark:text-slate-400 uppercase tracking-widest mb-2">Add Friends</p>
          <p className="text-[12px] text-[#64748B] dark:text-slate-400 mb-2">Search for members at your gym by name or username.</p>
          {!gymId ? (
            <div className="rounded-2xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200/80 dark:border-amber-700 px-4 py-3 text-[13px] text-amber-800 dark:text-amber-200">
              You need to be in a gym to add friends. Join or select a gym in your profile.
            </div>
          ) : (
            <>
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#94A3B8] dark:text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search members at your gym…"
              className="w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-slate-700/80 pl-11 pr-4 py-3 text-[14px] text-[#0F172A] dark:text-slate-100 placeholder:text-[#94A3B8] dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-200 dark:focus:ring-amber-500/50 focus:border-amber-300 dark:focus:border-amber-500/50"
            />
          </div>
          {searching && (
            <div className="mt-3 flex justify-center py-4">
              <div className="w-5 h-5 border-2 border-amber-200 dark:border-amber-800 border-t-amber-500 dark:border-t-amber-400 rounded-full animate-spin" />
            </div>
          )}
          {!searching && searchQuery.trim() && (
            <div className="mt-3 space-y-1 max-h-[240px] overflow-y-auto">
              {searchResults.length === 0 ? (
                <p className="text-[13px] text-[#64748B] dark:text-slate-400 py-4 text-center">No one found at your gym. Try a different name or username.</p>
              ) : (
                searchResults.map((p) => {
                  const status = getFriendStatus(friendships, userId, p.id);
                  const isAdding = addingId === p.id;
                  return (
                    <div key={p.id} className="flex items-center gap-4 py-3 px-3 rounded-2xl hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                      <Avatar src={p.avatar_url} name={p.full_name} size={40} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[14px] truncate text-[#0F172A] dark:text-slate-100">{p.full_name}</p>
                        {p.username && (
                          <p className="text-[12px] text-[#64748B] dark:text-slate-400">@{p.username}</p>
                        )}
                      </div>
                      {status === 'accepted' ? (
                        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600 dark:text-emerald-400 flex-shrink-0 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/40">
                          <Check size={12} strokeWidth={2.5} /> Friends
                        </span>
                      ) : status === 'pending_sent' ? (
                        <span className="flex items-center gap-1 text-[12px] font-medium text-[#64748B] dark:text-slate-400 flex-shrink-0">
                          <Clock size={12} /> Pending
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleAddFriend(p.id)}
                          disabled={isAdding}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold active:scale-95 transition-all flex-shrink-0 disabled:opacity-50 bg-amber-500 dark:!bg-amber-400 text-black hover:bg-amber-600 dark:hover:!bg-amber-300"
                        >
                          <UserPlus size={12} strokeWidth={2} /> {isAdding ? '…' : 'Add'}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
            </>
          )}
        </div>

        {/* Incoming requests */}
        {incomingWithRequester.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-[#64748B] dark:text-slate-400 uppercase tracking-widest mb-2">Requests</p>
            <div className="space-y-1">
              {incomingWithRequester.map((f) => (
                <IncomingRequestRow
                  key={f.id}
                  friendship={f}
                  onAccept={() => handleAccept(f.id)}
                  isAccepting={acceptingId === f.id}
                />
              ))}
            </div>
          </div>
        )}

        {/* Your friends list */}
        <div>
          <p className="text-[11px] font-semibold text-[#64748B] dark:text-slate-400 uppercase tracking-widest mb-2">Your friends</p>
          {accepted.length === 0 ? (
            <div className="py-8 text-center rounded-2xl bg-slate-50/80 dark:bg-white/5">
              <div className="w-12 h-12 rounded-2xl bg-slate-200/80 dark:bg-slate-600 flex items-center justify-center mx-auto mb-3">
                <Users size={24} className="text-slate-400 dark:text-slate-500" />
              </div>
              <p className="text-[14px] font-semibold text-[#475569] dark:text-slate-300">No friends yet</p>
              <p className="text-[13px] text-[#64748B] dark:text-slate-400 mt-1">Search above to add friends from your gym</p>
            </div>
          ) : (
            <div className="space-y-1">
              {accepted.map((f) => {
                const otherId = f.requester_id === userId ? f.addressee_id : f.requester_id;
                const p = profiles[otherId];
                return (
                  <div key={f.id} className="flex items-center gap-4 py-3 px-3 rounded-2xl hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                    <Avatar src={p?.avatar_url} name={p?.full_name ?? '?'} size={44} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[15px] truncate text-[#0F172A] dark:text-slate-100">
                        {p?.full_name ?? <span className="text-[#64748B] dark:text-slate-400">Loading…</span>}
                      </p>
                      {p?.username && (
                        <p className="text-[12px] text-[#64748B] dark:text-slate-400">@{p.username}</p>
                      )}
                    </div>
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600 dark:text-emerald-400 flex-shrink-0 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/40">
                      <Check size={12} strokeWidth={2.5} /> Friends
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Incoming Request Row ───────────────────────────────────────────────────────
const IncomingRequestRow = ({ friendship, onAccept, isAccepting }) => {
  const p = friendship.requester;
  if (!p) return null;

  return (
    <div className="flex items-center gap-4 py-3 px-3 rounded-2xl hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
      <Avatar src={p.avatar_url} name={p.full_name} size={40} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[14px] truncate text-[#0F172A] dark:text-slate-100">{p.full_name}</p>
        <p className="text-[12px] text-[#64748B] dark:text-slate-400">@{p.username}</p>
      </div>
      <button
        type="button"
        onClick={onAccept}
        disabled={isAccepting}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold active:scale-95 transition-all flex-shrink-0 disabled:opacity-50 bg-emerald-500 dark:bg-emerald-500 text-white hover:bg-emerald-600 dark:hover:bg-emerald-400"
      >
        <Check size={12} strokeWidth={2.5} /> {isAccepting ? '…' : 'Accept'}
      </button>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
const SocialFeed = () => {
  const { user, profile } = useAuth();
  const [feed, setFeed]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [friendships, setFriendships] = useState([]);
  const [showFriends, setShowFriends]   = useState(false);
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
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0F172A] pb-24 md:pb-10 transition-colors">
      <div className="max-w-[680px] mx-auto px-4 pt-6 pb-8">

        {/* Header */}
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center shadow-sm">
              <Users size={24} className="text-amber-600" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-[22px] font-bold text-[#0F172A] dark:text-slate-100 tracking-tight">Social</h1>
              <p className="text-[13px] text-[#64748B] dark:text-slate-400 mt-0.5">Activity from you and friends</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowFriends(s => !s)}
            className={`relative flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-semibold active:scale-95 transition-all ${
              showFriends ? 'bg-amber-500 text-black shadow-sm' : 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-white/10 text-[#0F172A] dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-600'
            }`}
          >
            <Users size={16} />
            Friends
            {pendingIncoming > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center text-white bg-red-500">
                {pendingIncoming}
              </span>
            )}
          </button>
        </header>

        {/* Find Friends panel */}
        {showFriends && (
          <FriendsPanel
            userId={user.id}
            gymId={profile?.gym_id}
            friendships={friendships}
            loadFriendships={loadFriendships}
            onClose={() => setShowFriends(false)}
          />
        )}

        {/* Pill tabs */}
        <div className="flex gap-1.5 mb-6 bg-slate-200/60 dark:bg-white/10 p-1.5 rounded-full">
          {[
            { key: 'friends', label: 'Friends' },
            { key: 'mine', label: 'My Posts' },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 rounded-full text-[13px] font-semibold transition-all ${
                tab === t.key ? 'bg-white dark:bg-slate-700 text-[#0F172A] dark:text-slate-100 shadow-sm' : 'text-[#64748B] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Loading skeletons */}
        {loading && (
          <div className="flex flex-col gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-2xl h-40 bg-white dark:bg-slate-800 border border-black/5 dark:border-white/10 shadow-sm animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty states */}
        {!loading && activeFeed.length === 0 && tab === 'friends' && (
          <div className="text-center py-20 px-4">
            <div className="w-16 h-16 rounded-3xl bg-slate-200/80 flex items-center justify-center mx-auto mb-4">
              <Users size={32} className="text-slate-400" />
            </div>
            <p className="text-[16px] font-semibold text-[#334155]">No friend activity yet</p>
            <p className="text-[14px] text-[#64748B] mt-2">Add friends to see their workouts and PRs here.</p>
            <button
              type="button"
              onClick={() => setShowFriends(true)}
              className="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-xl text-[14px] font-semibold active:scale-95 transition-all bg-amber-500 text-black"
            >
              <UserPlus size={16} /> Find Friends
            </button>
          </div>
        )}

        {!loading && activeFeed.length === 0 && tab === 'mine' && (
          <div className="text-center py-20 px-4">
            <div className="w-16 h-16 rounded-3xl bg-slate-200/80 dark:bg-white/10 flex items-center justify-center mx-auto mb-4">
              <Dumbbell size={32} className="text-slate-400 dark:text-slate-500" />
            </div>
            <p className="text-[16px] font-semibold text-[#334155] dark:text-slate-200">No posts yet</p>
            <p className="text-[14px] text-[#64748B] dark:text-slate-400 mt-2">Finish a workout to post your first activity.</p>
          </div>
        )}

        {/* Feed items */}
        {!loading && activeFeed.length > 0 && (
          <div className="flex flex-col gap-5">
            {activeFeed.map((item) => (
              <FeedCard
                key={item.id}
                item={item}
                currentUserId={user.id}
                onToggleLike={handleToggleLike}
              />
            ))}
            <p className="text-center text-[13px] py-8 text-[#94A3B8] dark:text-slate-500 font-medium">— You're all caught up —</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SocialFeed;
