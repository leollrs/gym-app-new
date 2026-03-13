import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageCircle, Trophy, Dumbbell, Zap, Send, Clock,
  Search, UserPlus, Check, X, Users, Share2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import ReactionPicker from '../components/ReactionPicker';
import SwipeableTabView from '../components/SwipeableTabView';

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
      <div className="rounded-[14px] p-4 border-l-4 border-[#D4AF37] bg-amber-900/20">
        <p className="font-bold text-[16px] leading-tight mb-3 text-[#E5E7EB]">
          {data.routine_name ?? 'Workout'}
        </p>
        <div className="flex flex-wrap gap-4">
          {data.duration_seconds > 0 && (
            <span className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF]">
              <Clock size={12} /> {fmtDuration(data.duration_seconds)}
            </span>
          )}
          {data.total_volume_lbs > 0 && (
            <span className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF]">
              <Zap size={12} /> {fmtVolume(data.total_volume_lbs)}
            </span>
          )}
          {data.exercise_count > 0 && (
            <span className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF]">
              <Dumbbell size={12} /> {data.exercise_count} exercise{data.exercise_count !== 1 ? 's' : ''}
            </span>
          )}
          {data.set_count > 0 && (
            <span className="text-[12px] text-[#9CA3AF]">{data.set_count} sets</span>
          )}
        </div>
      </div>
    );
  }

  if (type === 'pr_hit') {
    return (
      <div className="rounded-[14px] p-4 border-l-4 border-[#D4AF37] bg-amber-900/20">
        <div className="flex items-center gap-2 mb-1">
          <Trophy size={14} className="text-[#D4AF37] flex-shrink-0" />
          <p className="font-bold text-[13px] text-[#D4AF37]">New Personal Record</p>
        </div>
        <p className="font-black text-[20px] text-[#E5E7EB]">{data.exercise_name}</p>
        <p className="text-[15px] font-semibold mt-1 text-[#D4AF37]">
          {data.weight_lbs} lbs × {data.reps}{' '}
          {data.estimated_1rm > 0 && (
            <span className="font-normal text-[13px] text-[#9CA3AF]">· e1RM {Math.round(data.estimated_1rm)} lbs</span>
          )}
        </p>
      </div>
    );
  }

  if (type === 'achievement_unlocked') {
    return (
      <div className="rounded-[14px] p-4 border-l-4 border-purple-500 bg-purple-900/20">
        <p className="font-bold text-[13px] text-purple-300 mb-1">Achievement Unlocked 🎖️</p>
        <p className="font-bold text-[16px] text-[#E5E7EB]">{data.achievement_name ?? 'New Achievement'}</p>
        {data.achievement_desc && (
          <p className="text-[13px] mt-0.5 text-[#9CA3AF]">{data.achievement_desc}</p>
        )}
      </div>
    );
  }

  if (type === 'check_in') {
    return (
      <div className="rounded-[14px] p-4 border-l-4 border-emerald-500 bg-emerald-900/20">
        <p className="font-semibold text-[15px] text-[#E5E7EB]">
          ✅ Checked in at the gym{data.gym_name ? ` — ${data.gym_name}` : ''}
        </p>
      </div>
    );
  }

  if (type === 'program_started') {
    return (
      <div className="rounded-[14px] p-4 border-l-4 border-blue-500 bg-blue-900/20">
        <p className="font-semibold text-[15px] text-[#E5E7EB]">
          🚀 Started <span className="font-bold">{data.program_name ?? 'a new program'}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] p-4 bg-[#111827]">
      <p className="text-[14px] text-[#9CA3AF]">{type.replace(/_/g, ' ')}</p>
    </div>
  );
};

// ── Avatar ────────────────────────────────────────────────────────────────────
const Avatar = ({ src, name, size = 44 }) => {
  const initial = (name ?? '?')[0].toUpperCase();
  return src ? (
    <img src={src} alt={name} className="rounded-full object-cover flex-shrink-0 border-2 border-white/10"
      style={{ width: size, height: size }} />
  ) : (
    <div
      className="rounded-full flex items-center justify-center flex-shrink-0 font-bold bg-amber-900/40 text-[#D4AF37] border-2 border-[#D4AF37]/20"
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
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-400 flex-shrink-0 px-3 py-1.5 rounded-full bg-emerald-900/40">
        <Check size={12} strokeWidth={2.5} /> Friends
      </span>
    );
  }
  if (status === 'pending_sent') {
    return (
      <span className="flex items-center gap-1 text-[12px] font-medium text-[#6B7280] flex-shrink-0">
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
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold active:scale-95 transition-all flex-shrink-0 bg-[#D4AF37] text-black hover:opacity-90"
    >
      <UserPlus size={12} strokeWidth={2} /> Add
    </button>
  );
};

// ── Comment Item ──────────────────────────────────────────────────────────────
const CommentRow = ({ comment }) => (
  <div className="flex gap-3 py-2">
    <Avatar src={comment.profiles?.avatar_url} name={comment.profiles?.full_name ?? '?'} size={32} />
    <div className="flex-1 rounded-[14px] px-4 py-2.5 bg-[#111827] border border-white/6">
      <span className="font-semibold text-[13px] text-[#E5E7EB]">
        {comment.profiles?.full_name ?? 'Member'}{' '}
      </span>
      <span className="text-[13px] text-[#9CA3AF]">{comment.content}</span>
    </div>
  </div>
);

// ── Feed Card ─────────────────────────────────────────────────────────────────
const FeedCard = ({ item, currentUserId, onToggleLike, onReact }) => {
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
    <div className="rounded-[14px] overflow-hidden bg-[#0F172A] border border-white/8 transition-colors">

      {/* Header */}
      <div className="flex items-center gap-4 p-5 pb-4">
        <Avatar src={item.profiles?.avatar_url} name={item.profiles?.full_name ?? '?'} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] leading-snug text-[#E5E7EB]">
            {item.profiles?.full_name ?? 'Gym Member'}
          </p>
          <p className="text-[12px] text-[#9CA3AF] mt-0.5">
            @{item.profiles?.username ?? '—'} · {timeAgo(item.created_at)}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="px-5 pb-4">
        <FeedContent type={item.type} data={item.data ?? {}} />
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-6 px-5 py-3 border-t border-white/8">
        <ReactionPicker
          feedItemId={item.id}
          currentUserId={currentUserId}
          currentReaction={item.currentReaction ?? null}
          reactionCounts={item.reactionCounts ?? {}}
          onReact={onReact}
        />
        <button
          type="button"
          onClick={handleToggleComments}
          className={`flex items-center gap-2 text-[13px] font-semibold transition-colors ${showComments ? 'text-blue-400' : 'text-[#6B7280] hover:text-[#9CA3AF]'}`}
        >
          <MessageCircle size={16} />
          {item.commentCount > 0 ? item.commentCount : 'Comment'}
        </button>
        <button
          type="button"
          onClick={() => {
            const name = item.profiles?.full_name ?? 'Someone';
            const workoutName = item.data?.routine_name ?? 'a workout';
            const volume = fmtVolume(item.data?.total_volume_lbs);
            const text = `${name} just crushed ${workoutName} — ${volume} total volume! 💪`;
            if (navigator.share) {
              navigator.share({ text }).catch(() => {});
            } else {
              navigator.clipboard.writeText(text).catch(() => {});
            }
          }}
          className="flex items-center gap-2 text-[13px] font-semibold text-[#6B7280] hover:text-[#9CA3AF] transition-colors"
        >
          <Share2 size={16} />
          Share
        </button>
      </div>

      {/* Comments section */}
      {showComments && (
        <div className="px-5 pb-5 pt-1 border-t border-white/8 bg-[#111827]/50">
          <div className="pt-3 flex flex-col">
            {comments === null ? (
              <p className="text-[13px] py-3 text-center text-[#9CA3AF]">Loading…</p>
            ) : comments.length === 0 ? (
              <p className="text-[13px] py-2 text-[#9CA3AF]">No comments yet. Be the first!</p>
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
              className="flex-1 rounded-xl px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 bg-[#111827] border border-white/6 text-[#E5E7EB] placeholder-[#4B5563]"
            />
            <button
              type="button"
              onClick={handleSubmitComment}
              disabled={!commentText.trim() || submitting}
              className="w-10 h-10 rounded-xl flex items-center justify-center disabled:opacity-40 active:scale-95 transition-all bg-[#D4AF37] text-black font-semibold"
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
    <div className="rounded-[14px] overflow-hidden mb-6 bg-[#0F172A] border border-white/8">

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <p className="font-bold text-[17px] text-[#E5E7EB]">
          Friends
          {accepted.length > 0 && (
            <span className="font-normal ml-1.5 text-[#6B7280]">· {accepted.length}</span>
          )}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-xl hover:bg-white/8 text-[#6B7280] transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="px-5 pb-5 space-y-6">
        {/* Add Friends — search same-gym members only */}
        <div>
          <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-2">Add Friends</p>
          <p className="text-[12px] text-[#9CA3AF] mb-2">Search for members at your gym by name or username.</p>
          {!gymId ? (
            <div className="rounded-[14px] bg-amber-900/20 border border-[#D4AF37]/30 px-4 py-3 text-[13px] text-[#D4AF37]">
              You need to be in a gym to add friends. Join or select a gym in your profile.
            </div>
          ) : (
            <>
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search members at your gym…"
              className="w-full rounded-xl border border-white/6 bg-[#111827] pl-11 pr-4 py-3 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37]/40"
            />
          </div>
          {searching && (
            <div className="mt-3 flex justify-center py-4">
              <div className="w-5 h-5 border-2 border-[#D4AF37]/20 border-t-[#D4AF37] rounded-full animate-spin" />
            </div>
          )}
          {!searching && searchQuery.trim() && (
            <div className="mt-3 space-y-1 max-h-[240px] overflow-y-auto">
              {searchResults.length === 0 ? (
                <p className="text-[13px] text-[#9CA3AF] py-4 text-center">No one found at your gym. Try a different name or username.</p>
              ) : (
                searchResults.map((p) => {
                  const status = getFriendStatus(friendships, userId, p.id);
                  const isAdding = addingId === p.id;
                  return (
                    <div key={p.id} className="flex items-center gap-4 py-3 px-3 rounded-[14px] hover:bg-white/5 transition-colors">
                      <Avatar src={p.avatar_url} name={p.full_name} size={40} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[14px] truncate text-[#E5E7EB]">{p.full_name}</p>
                        {p.username && (
                          <p className="text-[12px] text-[#9CA3AF]">@{p.username}</p>
                        )}
                      </div>
                      {status === 'accepted' ? (
                        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-400 flex-shrink-0 px-3 py-1.5 rounded-full bg-emerald-900/40">
                          <Check size={12} strokeWidth={2.5} /> Friends
                        </span>
                      ) : status === 'pending_sent' ? (
                        <span className="flex items-center gap-1 text-[12px] font-medium text-[#6B7280] flex-shrink-0">
                          <Clock size={12} /> Pending
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleAddFriend(p.id)}
                          disabled={isAdding}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold active:scale-95 transition-all flex-shrink-0 disabled:opacity-50 bg-[#D4AF37] text-black hover:opacity-90"
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
            <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-2">Requests</p>
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
          <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-2">Your friends</p>
          {accepted.length === 0 ? (
            <div className="py-8 text-center rounded-[14px] bg-[#111827]">
              <div className="w-12 h-12 rounded-[14px] bg-[#0F172A] flex items-center justify-center mx-auto mb-3">
                <Users size={24} className="text-[#6B7280]" />
              </div>
              <p className="text-[14px] font-semibold text-[#E5E7EB]">No friends yet</p>
              <p className="text-[13px] text-[#9CA3AF] mt-1">Search above to add friends from your gym</p>
            </div>
          ) : (
            <div className="space-y-1">
              {accepted.map((f) => {
                const otherId = f.requester_id === userId ? f.addressee_id : f.requester_id;
                const p = profiles[otherId];
                return (
                  <div key={f.id} className="flex items-center gap-4 py-3 px-3 rounded-[14px] hover:bg-white/5 transition-colors">
                    <Avatar src={p?.avatar_url} name={p?.full_name ?? '?'} size={44} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[15px] truncate text-[#E5E7EB]">
                        {p?.full_name ?? <span className="text-[#6B7280]">Loading…</span>}
                      </p>
                      {p?.username && (
                        <p className="text-[12px] text-[#9CA3AF]">@{p.username}</p>
                      )}
                    </div>
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-400 flex-shrink-0 px-3 py-1.5 rounded-full bg-emerald-900/40">
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
    <div className="flex items-center gap-4 py-3 px-3 rounded-[14px] hover:bg-white/5 transition-colors">
      <Avatar src={p.avatar_url} name={p.full_name} size={40} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[14px] truncate text-[#E5E7EB]">{p.full_name}</p>
        <p className="text-[12px] text-[#9CA3AF]">@{p.username}</p>
      </div>
      <button
        type="button"
        onClick={onAccept}
        disabled={isAccepting}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold active:scale-95 transition-all flex-shrink-0 disabled:opacity-50 bg-emerald-500 text-white hover:bg-emerald-600"
      >
        <Check size={12} strokeWidth={2.5} /> {isAccepting ? '…' : 'Accept'}
      </button>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
const SocialFeed = ({ embedded = false }) => {
  const { user, profile } = useAuth();
  const [feed, setFeed]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [friendships, setFriendships] = useState([]);
  const [showFriends, setShowFriends]   = useState(false);
  const FEED_TABS = ['friends', 'mine'];
  const [tab, setTab]                 = useState('friends');
  const [friendStreaks, setFriendStreaks] = useState([]);
  const feedTabIndex = FEED_TABS.indexOf(tab);
  const handleFeedSwipe = (i) => setTab(FEED_TABS[i]);

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

    // Only fetch today's posts to reduce DB load
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Fetch feed items and friend streaks in parallel
    const [{ data: items }, streakData] = await Promise.all([
      supabase
        .from('activity_feed_items')
        .select('*, profiles!actor_id(full_name, username, avatar_url)')
        .in('actor_id', actorIds)
        .gte('created_at', todayStart.toISOString())
        .order('created_at', { ascending: false })
        .limit(50),
      // Fetch recent sessions for friends to compute streaks
      acceptedIds.length > 0
        ? supabase
            .from('workout_sessions')
            .select('user_id, completed_at')
            .in('user_id', acceptedIds)
            .not('completed_at', 'is', null)
            .order('completed_at', { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [] }),
    ]);

    // Compute friend streaks
    if (streakData.data?.length && acceptedIds.length > 0) {
      // Group sessions by user
      const sessionsByUser = {};
      streakData.data.forEach(s => {
        if (!sessionsByUser[s.user_id]) sessionsByUser[s.user_id] = [];
        sessionsByUser[s.user_id].push(s.completed_at);
      });

      // Fetch friend profiles
      const { data: friendProfiles } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', acceptedIds);

      const profileMap = {};
      (friendProfiles ?? []).forEach(p => { profileMap[p.id] = p; });

      // Calculate streak per friend (consecutive days working out, counting from today backwards)
      const streaks = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const friendId of acceptedIds) {
        const dates = sessionsByUser[friendId];
        if (!dates?.length) continue;

        // Get unique workout dates (local date strings)
        const uniqueDays = [...new Set(dates.map(d => {
          const dt = new Date(d);
          return `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
        }))].sort().reverse();

        // Count consecutive days from today or yesterday
        let streak = 0;
        const checkDate = new Date(today);

        // Allow starting from today or yesterday
        const firstDayKey = `${checkDate.getFullYear()}-${checkDate.getMonth()}-${checkDate.getDate()}`;
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;

        if (!uniqueDays.includes(firstDayKey) && !uniqueDays.includes(yesterdayKey)) continue;

        // Start from today if they trained today, else from yesterday
        if (!uniqueDays.includes(firstDayKey)) {
          checkDate.setDate(checkDate.getDate() - 1);
        }

        for (let i = 0; i < 365; i++) {
          const key = `${checkDate.getFullYear()}-${checkDate.getMonth()}-${checkDate.getDate()}`;
          if (uniqueDays.includes(key)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
          } else {
            break;
          }
        }

        if (streak >= 1) {
          const p = profileMap[friendId];
          streaks.push({
            id: friendId,
            name: p?.full_name ?? 'Friend',
            avatar_url: p?.avatar_url ?? null,
            streak,
          });
        }
      }

      // Sort by highest streak first
      streaks.sort((a, b) => b.streak - a.streak);
      setFriendStreaks(streaks);
    } else {
      setFriendStreaks([]);
    }

    if (!items?.length) { setFeed([]); setLoading(false); return; }

    const itemIds = items.map(i => i.id);

    const [{ data: allReactions }, { data: commentCounts }] = await Promise.all([
      supabase.from('feed_reactions').select('feed_item_id, profile_id, reaction_type').in('feed_item_id', itemIds),
      supabase.from('feed_comments').select('feed_item_id').in('feed_item_id', itemIds).eq('is_deleted', false),
    ]);

    const reactionCountsMap = {};
    const myReactionMap     = {};
    const commentCountMap   = {};

    (allReactions ?? []).forEach(r => {
      if (!reactionCountsMap[r.feed_item_id]) reactionCountsMap[r.feed_item_id] = {};
      reactionCountsMap[r.feed_item_id][r.reaction_type] = (reactionCountsMap[r.feed_item_id][r.reaction_type] ?? 0) + 1;
      if (r.profile_id === user.id) myReactionMap[r.feed_item_id] = r.reaction_type;
    });
    commentCounts?.forEach(c => {
      commentCountMap[c.feed_item_id] = (commentCountMap[c.feed_item_id] ?? 0) + 1;
    });

    setFeed(items.map(item => ({
      ...item,
      reactionCounts:  reactionCountsMap[item.id] ?? {},
      currentReaction: myReactionMap[item.id] ?? null,
      commentCount:    commentCountMap[item.id] ?? 0,
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

  const handleReact = async (feedItemId, reactionType) => {
    setFeed(prev => prev.map(item => {
      if (item.id !== feedItemId) return item;
      const counts = { ...(item.reactionCounts ?? {}) };
      const prev_reaction = item.currentReaction;

      if (prev_reaction === reactionType) {
        // Remove reaction (toggle off)
        counts[reactionType] = Math.max((counts[reactionType] ?? 1) - 1, 0);
        if (counts[reactionType] === 0) delete counts[reactionType];
        return { ...item, currentReaction: null, reactionCounts: counts };
      }
      // Remove old reaction if any
      if (prev_reaction) {
        counts[prev_reaction] = Math.max((counts[prev_reaction] ?? 1) - 1, 0);
        if (counts[prev_reaction] === 0) delete counts[prev_reaction];
      }
      // Add new reaction
      counts[reactionType] = (counts[reactionType] ?? 0) + 1;
      return { ...item, currentReaction: reactionType, reactionCounts: counts };
    }));

    // Find the current reaction before this action
    const currentItem = feed.find(i => i.id === feedItemId);
    const prevReaction = currentItem?.currentReaction;

    if (prevReaction === reactionType) {
      // Toggle off — delete
      await supabase.from('feed_reactions').delete()
        .eq('feed_item_id', feedItemId)
        .eq('profile_id', user.id);
    } else {
      // Upsert reaction
      if (prevReaction) {
        await supabase.from('feed_reactions').delete()
          .eq('feed_item_id', feedItemId)
          .eq('profile_id', user.id);
      }
      await supabase.from('feed_reactions').insert({
        feed_item_id: feedItemId,
        profile_id: user.id,
        reaction_type: reactionType,
      });
    }
  };

  const pendingIncoming = friendships.filter(
    f => f.addressee_id === user?.id && f.status === 'pending'
  ).length;

  const friendsFeed = feed.filter(item => item.actor_id !== user?.id);
  const myFeed      = feed.filter(item => item.actor_id === user?.id);
  const activeFeed  = tab === 'friends' ? friendsFeed : myFeed;

  return (
    <div className={`${embedded ? '' : 'min-h-screen bg-[#05070B] pb-28 md:pb-12'}`}>
      <div className={`${embedded ? '' : 'max-w-[680px] mx-auto px-4 pt-6 pb-8'}`}>

        {/* Header */}
        {!embedded && (
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-[14px] bg-amber-900/40 flex items-center justify-center">
              <Users size={24} className="text-[#D4AF37]" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-[22px] font-bold text-[#E5E7EB] tracking-tight">Social</h1>
              <p className="text-[13px] text-[#9CA3AF] mt-0.5">Activity from you and friends</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowFriends(s => !s)}
            className={`relative flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-semibold active:scale-95 transition-all ${
              showFriends
                ? 'bg-[#D4AF37] text-black'
                : 'bg-[#111827] border border-white/8 text-[#E5E7EB] hover:bg-[#0F172A]'
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
        )}

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
        <div className="flex gap-1 mb-6 bg-[#111827] p-1 rounded-xl">
          {[
            { key: 'friends', label: 'Friends' },
            { key: 'mine', label: 'My Posts' },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${
                tab === t.key
                  ? 'bg-[#D4AF37] text-black font-semibold'
                  : 'text-[#6B7280] hover:text-[#9CA3AF]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Friends Streaks (shared, above swipeable area) */}
        {friendStreaks.length > 0 && (
          <div className="mb-6">
            <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Friends Streaks</p>
            <div className="flex overflow-x-auto gap-3 pb-2 scrollbar-hide">
              {friendStreaks.map(f => (
                <div key={f.id} className="flex flex-col items-center flex-shrink-0" style={{ width: 64 }}>
                  {f.avatar_url ? (
                    <img
                      src={f.avatar_url}
                      alt={f.name}
                      className="rounded-full object-cover border-2 border-[#D4AF37]/30"
                      style={{ width: 40, height: 40 }}
                    />
                  ) : (
                    <div
                      className="rounded-full flex items-center justify-center font-bold bg-amber-900/40 text-[#D4AF37] border-2 border-[#D4AF37]/20"
                      style={{ width: 40, height: 40, fontSize: 15 }}
                    >
                      {(f.name ?? '?')[0].toUpperCase()}
                    </div>
                  )}
                  <p className="text-[11px] text-[#9CA3AF] mt-1.5 truncate w-full text-center">{f.name.split(' ')[0]}</p>
                  <p className="text-[11px] font-semibold text-[#D4AF37]">{f.streak} 🔥</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div className="flex flex-col gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-[14px] h-40 bg-[#0F172A] border border-white/8 animate-pulse" />
            ))}
          </div>
        )}

        {/* Swipeable feed panels */}
        {!loading && (
          <SwipeableTabView activeIndex={feedTabIndex} onChangeIndex={handleFeedSwipe}>
            {/* Friends tab */}
            <div>
              {friendsFeed.length === 0 ? (
                <div className="text-center py-20 px-4">
                  <div className="w-16 h-16 rounded-[14px] bg-[#111827] flex items-center justify-center mx-auto mb-4">
                    <Users size={32} className="text-[#6B7280]" />
                  </div>
                  <p className="text-[16px] font-semibold text-[#E5E7EB]">No friend activity yet</p>
                  <p className="text-[14px] text-[#9CA3AF] mt-2">Add friends to see their workouts and PRs here.</p>
                  <button
                    type="button"
                    onClick={() => setShowFriends(true)}
                    className="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-xl text-[14px] font-bold active:scale-95 transition-all bg-[#D4AF37] text-black"
                  >
                    <UserPlus size={16} /> Find Friends
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  {friendsFeed.map((item) => (
                    <FeedCard
                      key={item.id}
                      item={item}
                      currentUserId={user.id}
                      onToggleLike={handleReact}
                      onReact={handleReact}
                    />
                  ))}
                  <p className="text-center text-[13px] py-8 text-[#6B7280] font-medium">— You're all caught up —</p>
                </div>
              )}
            </div>

            {/* My Posts tab */}
            <div>
              {myFeed.length === 0 ? (
                <div className="text-center py-20 px-4">
                  <div className="w-16 h-16 rounded-[14px] bg-[#111827] flex items-center justify-center mx-auto mb-4">
                    <Dumbbell size={32} className="text-[#6B7280]" />
                  </div>
                  <p className="text-[16px] font-semibold text-[#E5E7EB]">No posts yet</p>
                  <p className="text-[14px] text-[#9CA3AF] mt-2">Finish a workout to post your first activity.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  {myFeed.map((item) => (
                    <FeedCard
                      key={item.id}
                      item={item}
                      currentUserId={user.id}
                      onToggleLike={handleReact}
                      onReact={handleReact}
                    />
                  ))}
                  <p className="text-center text-[13px] py-8 text-[#6B7280] font-medium">— You're all caught up —</p>
                </div>
              )}
            </div>
          </SwipeableTabView>
        )}
      </div>
    </div>
  );
};

export default SocialFeed;
