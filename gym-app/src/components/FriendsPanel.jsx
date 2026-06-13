// FriendsPanel — a MODAL (overlays the page, doesn't push it) for: sharing your
// own add-me link, searching + adding same-gym members, accepting incoming
// requests, and listing friends. Extracted from SocialFeed so it can be reused
// (Social feed AND the Messages page, which is friends-only and benefits from
// an add-friends entry).
//
// Prop-driven: the caller owns `friendships` + `loadFriendships` (so the panel
// reflects/refreshes the same friendship state the host already tracks).
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Check, Clock, UserPlus, Users, Share2, ChevronDown } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabase';
import UserAvatar from './UserAvatar';
import { PROD_WEB_URL } from '../lib/appUrls';
import posthogClient from 'posthog-js';

// Friendship status toward another profile.
export const getFriendStatus = (friendships, userId, otherId) => {
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

function IncomingRequestRow({ friendship, onAccept, isAccepting, t }) {
  const p = friendship.requester;
  if (!p) return null;
  return (
    <div className="flex items-center gap-4 py-3 px-3 rounded-2xl hover:bg-white/[0.06] transition-colors">
      <UserAvatar user={{ avatar_url: p.avatar_url, full_name: p.full_name, avatar_type: p.avatar_type, avatar_value: p.avatar_value }} size={40} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[14px] truncate" style={{ color: 'var(--color-text-primary)' }}>{p.full_name}</p>
        <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>@{p.username}</p>
      </div>
      <button
        type="button"
        onClick={onAccept}
        disabled={isAccepting}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold active:scale-95 transition-all flex-shrink-0 disabled:opacity-50 bg-emerald-500 text-white hover:bg-emerald-600"
      >
        <Check size={12} strokeWidth={2.5} /> {isAccepting ? '…' : t('social.friendStatus.accept')}
      </button>
    </div>
  );
}

export default function FriendsPanel({ userId, gymId, gymName, friendships, loadFriendships, onClose, t }) {
  const [profiles, setProfiles] = useState({});
  const [requesters, setRequesters] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const [acceptingId, setAcceptingId] = useState(null);
  // Ids the viewer has blocked OR who blocked the viewer — excluded from search.
  const [hiddenIds, setHiddenIds] = useState(() => new Set());
  // The viewer's own friend code (for the "share my code so a friend can add
  // me" affordance). Generated on first use if the profile doesn't have one.
  const [friendCode, setFriendCode] = useState('');
  const [codeShared, setCodeShared] = useState(false);
  // Outgoing (pending) requests you've sent — collapsed behind a toggle.
  const [outgoingProfiles, setOutgoingProfiles] = useState({});
  const [showSent, setShowSent] = useState(false);
  const [cancelingId, setCancelingId] = useState(null);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const [outgoing, incoming, me] = await Promise.all([
        supabase.from('blocked_users').select('blocked_id').eq('blocker_id', userId),
        supabase.from('blocked_users').select('blocker_id').eq('blocked_id', userId),
        supabase.from('profiles').select('friend_code').eq('id', userId).maybeSingle(),
      ]);
      if (cancelled) return;
      const ids = new Set();
      (outgoing.data || []).forEach((r) => r.blocked_id && ids.add(r.blocked_id));
      (incoming.data || []).forEach((r) => r.blocker_id && ids.add(r.blocker_id));
      setHiddenIds(ids);

      // Friend code: use the existing one, otherwise mint + persist a fresh one
      // (same 8-char base36 format Profile uses, so the /add-friend/:code route
      // resolves it the same way).
      if (me.data?.friend_code) {
        setFriendCode(me.data.friend_code);
      } else {
        const arr = new Uint8Array(5);
        crypto.getRandomValues(arr);
        const code = Array.from(arr, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
        const { error } = await supabase.from('profiles').update({ friend_code: code }).eq('id', userId);
        if (!cancelled && !error) setFriendCode(code);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const accepted = friendships.filter((f) => f.status === 'accepted');
  const incoming = friendships.filter((f) => f.addressee_id === userId && f.status === 'pending');
  const outgoing = friendships.filter((f) => f.requester_id === userId && f.status === 'pending');

  useEffect(() => {
    if (!accepted.length) return;
    const ids = accepted.map((f) => (f.requester_id === userId ? f.addressee_id : f.requester_id));
    supabase
      .from('gym_member_profiles_safe')
      .select('id, full_name, username, avatar_url, avatar_type, avatar_value')
      .in('id', ids)
      .limit(200)
      .then(({ data, error }) => {
        if (error) return;
        const map = {};
        (data || []).forEach((p) => { map[p.id] = p; });
        setProfiles(map);
      });
  }, [accepted, userId]);

  useEffect(() => {
    if (!incoming.length) return;
    const ids = incoming.map((f) => f.requester_id);
    supabase
      .from('gym_member_profiles_safe')
      .select('id, full_name, username, avatar_url, avatar_type, avatar_value')
      .in('id', ids)
      .limit(100)
      .then(({ data, error }) => {
        if (error) return;
        const map = {};
        (data || []).forEach((p) => { map[p.id] = p; });
        setRequesters(map);
      });
  }, [incoming]);

  // Profiles for the people you've sent (still-pending) requests to.
  useEffect(() => {
    const ids = friendships
      .filter((f) => f.requester_id === userId && f.status === 'pending')
      .map((f) => f.addressee_id);
    if (!ids.length) return;
    supabase
      .from('gym_member_profiles_safe')
      .select('id, full_name, username, avatar_url, avatar_type, avatar_value')
      .in('id', ids)
      .limit(100)
      .then(({ data, error }) => {
        if (error) return;
        const map = {};
        (data || []).forEach((p) => { map[p.id] = p; });
        setOutgoingProfiles(map);
      });
  }, [friendships, userId]);

  // Search gym members — debounced 300ms, block-filtered both directions.
  useEffect(() => {
    if (!gymId || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      const raw = searchQuery.trim();
      const clean = raw.replace(/[%_\\,()."']/g, '');
      const pattern = `%${clean}%`;
      supabase
        .from('gym_member_profiles_safe')
        .select('id, full_name, username, avatar_url, avatar_type, avatar_value')
        .neq('id', userId)
        .in('role', ['member', 'trainer'])
        .or(`full_name.ilike.${pattern},username.ilike.${pattern}`)
        .limit(20)
        .then(({ data, error }) => {
          setSearching(false);
          if (error) return;
          const filtered = (data ?? []).filter((p) => !hiddenIds.has(p.id));
          setSearchResults(filtered);
        })
        .catch(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [gymId, userId, searchQuery, hiddenIds]);

  const handleAccept = async (friendshipId) => {
    setAcceptingId(friendshipId);
    const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
    if (!error) posthogClient?.capture('friend_request_accepted');
    await loadFriendships();
    setAcceptingId(null);
  };

  // Withdraw a pending request you sent (RLS allows the requester to delete it).
  const handleCancelRequest = async (friendshipId) => {
    setCancelingId(friendshipId);
    const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
    if (!error) posthogClient?.capture('friend_request_cancelled');
    await loadFriendships();
    setCancelingId(null);
  };

  const handleAddFriend = async (addresseeId) => {
    if (!gymId) return;
    setAddingId(addresseeId);
    const { error } = await supabase.from('friendships').insert({
      requester_id: userId,
      addressee_id: addresseeId,
      gym_id: gymId,
      status: 'pending',
    });
    if (!error) posthogClient?.capture('friend_request_sent', { source: 'friends_panel' });
    await loadFriendships();
    setAddingId(null);
  };

  // Share your add-me link so a friend can add you back. The friend opens the
  // link → /add-friend/:code in the app → a request lands in their inbox.
  const handleShareMyCode = async () => {
    if (!friendCode) return;
    const link = `${PROD_WEB_URL}/add-friend/${friendCode}`;
    const text = t('social.shareFriendText', { gym: gymName || 'TuGymPR', defaultValue: 'Add me on {{gym}}!' });
    try {
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: text, text, url: link });
        posthogClient?.capture('friend_code_shared', { method: 'native_share' });
      } else if (navigator.share) {
        await navigator.share({ title: text, text, url: link });
        posthogClient?.capture('friend_code_shared', { method: 'native_share' });
      } else {
        await navigator.clipboard?.writeText(link);
        setCodeShared(true);
        setTimeout(() => setCodeShared(false), 2000);
        posthogClient?.capture('friend_code_shared', { method: 'copy' });
      }
    } catch { /* user cancelled */ }
  };

  const incomingWithRequester = incoming.map((f) => ({ ...f, requester: requesters[f.requester_id] }));

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={t('social.friendsButton')}>
      {/* Scrim — covers the page; tap to close */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel — bottom sheet on mobile, centered on desktop */}
      <div
        className="relative w-full sm:max-w-[480px] max-h-[90dvh] sm:max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--color-bg-primary)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <p className="font-semibold text-[18px] truncate" style={{ color: 'var(--color-text-primary)' }}>
            {t('social.friendsButton')}
            {accepted.length > 0 && (
              <span className="font-normal ml-1.5" style={{ color: 'var(--color-text-subtle)' }}>· {accepted.length}</span>
            )}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('social.closeFriendsPanel', 'Close friends panel')}
            className="w-11 h-11 rounded-xl hover:bg-white/[0.06] transition-colors duration-200 flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Add Friends — search same-gym members; share-me link sits beside the bar */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-subtle)' }}>{t('social.addFriends')}</p>
            <p className="text-[12px] mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('social.searchMembers')}</p>
            {!gymId ? (
              <div className="rounded-2xl bg-white/[0.05] border border-[#D4AF37]/30 px-4 py-3 text-[13px] text-[#D4AF37]">
                {t('social.noGymForFriends')}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-subtle)' }} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t('social.searchPlaceholder')}
                      aria-label={t('social.addFriends')}
                      className="w-full rounded-xl border border-white/[0.06] pl-11 pr-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                      style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
                    />
                  </div>
                  {/* Share your add-me link — compact, beside the bar. No code is shown
                      because there's nowhere to type one in; the link/QR is the entry point. */}
                  <button
                    type="button"
                    onClick={handleShareMyCode}
                    disabled={!friendCode}
                    aria-label={t('social.shareMyCodeDesc', 'Send a friend your link so they can add you back')}
                    className="flex items-center gap-1.5 px-3.5 py-3 rounded-xl text-[13px] font-bold active:scale-95 transition-all flex-shrink-0 disabled:opacity-40 bg-[#D4AF37] text-[var(--color-text-on-accent,#000)] hover:opacity-90"
                  >
                    <Share2 size={15} strokeWidth={2.4} /> {codeShared ? t('social.linkCopied', 'Link copied!') : t('social.shareMyCode', 'Share')}
                  </button>
                </div>
                {searching && (
                  <div className="mt-3 flex justify-center py-4" role="status" aria-busy={true} aria-label={t('social.searching', 'Searching')}>
                    <div className="w-5 h-5 border-2 border-[#D4AF37]/20 border-t-[#D4AF37] rounded-full animate-spin" />
                  </div>
                )}
                {!searching && searchQuery.trim() && (
                  <div className="mt-3 space-y-1 max-h-[240px] overflow-y-auto">
                    {searchResults.length === 0 ? (
                      <p className="text-[13px] py-4 text-center" style={{ color: 'var(--color-text-muted)' }}>{t('social.noSearchResults')}</p>
                    ) : (
                      searchResults.map((p) => {
                        const status = getFriendStatus(friendships, userId, p.id);
                        const isAdding = addingId === p.id;
                        return (
                          <div key={p.id} className="flex items-center gap-4 py-3 px-3 rounded-2xl hover:bg-white/[0.06] transition-colors">
                            <UserAvatar user={{ avatar_url: p.avatar_url, full_name: p.full_name, avatar_type: p.avatar_type, avatar_value: p.avatar_value }} size={40} />
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-[14px] truncate" style={{ color: 'var(--color-text-primary)' }}>{p.full_name}</p>
                              {p.username && (
                                <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>@{p.username}</p>
                              )}
                            </div>
                            {status === 'accepted' ? (
                              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-400 flex-shrink-0 px-3 py-1.5 rounded-full bg-emerald-900/40">
                                <Check size={12} strokeWidth={2.5} /> {t('social.friendStatus.friends')}
                              </span>
                            ) : status === 'pending_sent' ? (
                              <span className="flex items-center gap-1 text-[12px] font-medium flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }}>
                                <Clock size={12} /> {t('social.friendStatus.pending')}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleAddFriend(p.id)}
                                disabled={isAdding}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold active:scale-95 transition-all flex-shrink-0 disabled:opacity-50 bg-[#D4AF37] text-[var(--color-text-on-accent,#000)] hover:opacity-90"
                              >
                                <UserPlus size={12} strokeWidth={2} /> {isAdding ? '…' : t('social.friendStatus.add')}
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
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-subtle)' }}>{t('social.requests')}</p>
              <div className="space-y-1">
                {incomingWithRequester.map((f) => (
                  <IncomingRequestRow
                    key={f.id}
                    friendship={f}
                    onAccept={() => handleAccept(f.id)}
                    isAccepting={acceptingId === f.id}
                    t={t}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Requests you've sent — collapsed behind a button */}
          {outgoing.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowSent((s) => !s)}
                aria-expanded={showSent}
                className="w-full flex items-center justify-between py-1 focus:outline-none"
              >
                <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('social.requestsSent', 'Requests sent')}
                  <span style={{ color: 'var(--color-text-muted)' }}> · {outgoing.length}</span>
                </span>
                <ChevronDown size={16} className={`transition-transform duration-200 ${showSent ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-subtle)' }} />
              </button>
              {showSent && (
                <div className="space-y-1 mt-2">
                  {outgoing.map((f) => {
                    const p = outgoingProfiles[f.addressee_id];
                    return (
                      <div key={f.id} className="flex items-center gap-4 py-3 px-3 rounded-2xl hover:bg-white/[0.06] transition-colors">
                        <UserAvatar user={{ avatar_url: p?.avatar_url, full_name: p?.full_name ?? '?', avatar_type: p?.avatar_type, avatar_value: p?.avatar_value }} size={40} />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[14px] truncate" style={{ color: 'var(--color-text-primary)' }}>
                            {p?.full_name ?? <span style={{ color: 'var(--color-text-subtle)' }}>…</span>}
                          </p>
                          {p?.username && (
                            <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>@{p.username}</p>
                          )}
                        </div>
                        <span className="flex items-center gap-1 text-[12px] font-medium flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }}>
                          <Clock size={12} /> {t('social.friendStatus.pending')}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCancelRequest(f.id)}
                          disabled={cancelingId === f.id}
                          className="text-[12px] font-semibold flex-shrink-0 disabled:opacity-50 px-2.5 py-1.5 rounded-full hover:bg-white/[0.06] transition-colors"
                          style={{ color: 'var(--color-danger, #EF4444)' }}
                        >
                          {cancelingId === f.id ? '…' : t('social.cancel', 'Cancel')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Your friends list */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-subtle)' }}>{t('social.yourFriends')}</p>
            {accepted.length === 0 ? (
              <div className="py-8 text-center rounded-2xl" style={{ background: 'var(--color-bg-card)' }}>
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--color-bg-card)' }}>
                  <Users size={24} style={{ color: 'var(--color-text-subtle)' }} />
                </div>
                <p className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('social.noFriendsYet')}</p>
                <p className="text-[13px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('social.noFriendsHint')}</p>
              </div>
            ) : (
              <div className="space-y-1">
                {accepted.map((f) => {
                  const otherId = f.requester_id === userId ? f.addressee_id : f.requester_id;
                  const p = profiles[otherId];
                  return (
                    <div key={f.id} className="flex items-center gap-4 py-3 px-3 rounded-2xl hover:bg-white/[0.06] transition-colors">
                      <UserAvatar user={{ avatar_url: p?.avatar_url, full_name: p?.full_name ?? '?', avatar_type: p?.avatar_type, avatar_value: p?.avatar_value }} size={44} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[15px] truncate" style={{ color: 'var(--color-text-primary)' }}>
                          {p?.full_name ?? <span style={{ color: 'var(--color-text-subtle)' }}>Loading…</span>}
                        </p>
                        {p?.username && (
                          <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>@{p.username}</p>
                        )}
                      </div>
                      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-400 flex-shrink-0 px-3 py-1.5 rounded-full bg-emerald-900/40">
                        <Check size={12} strokeWidth={2.5} /> {t('social.friendStatus.friends')}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
