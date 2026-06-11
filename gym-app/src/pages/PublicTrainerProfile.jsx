import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft, Heart, Share2, Calendar, MessageSquare, Phone,
  Dumbbell, BadgeCheck, Star, X, Loader2, Send,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import { PROD_WEB_URL } from '../lib/appUrls';
import UserAvatar from '../components/UserAvatar';
import ContentActionMenu from '../components/ContentActionMenu';
import { TT, TFont, avatarIdx } from './trainer/components/designTokens';
import { TCard, TAvatar } from './trainer/components/designPrimitives';

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────
const FAV_KEY = 'trainer_favorites';

function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function saveFavorites(set) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(set)));
  } catch { /* ignore */ }
}

// Relative time string (very compact: "2w ago", "3d ago", "just now").
// Localised label is appended by the caller.
function relativeShort(date, t) {
  if (!date) return '';
  const ms = Date.now() - new Date(date).getTime();
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return t('publicTrainerProfile.justNow', 'just now');
  const min = Math.floor(sec / 60);
  if (min < 60) return t('publicTrainerProfile.relMin', '{{n}}m ago', { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('publicTrainerProfile.relHr', '{{n}}h ago', { n: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t('publicTrainerProfile.relDay', '{{n}}d ago', { n: day });
  const wk = Math.floor(day / 7);
  if (wk < 5) return t('publicTrainerProfile.relWk', '{{n}}w ago', { n: wk });
  const mo = Math.floor(day / 30);
  if (mo < 12) return t('publicTrainerProfile.relMo', '{{n}}mo ago', { n: mo });
  const yr = Math.floor(day / 365);
  return t('publicTrainerProfile.relYr', '{{n}}y ago', { n: yr });
}

// ────────────────────────────────────────────────────────────────────
// ContactPickerModal — soft "intro to messages" dialog
// ────────────────────────────────────────────────────────────────────
function ContactPickerModal({ open, onClose, trainerName, isClient, onOpenMessages }) {
  const { t } = useTranslation('pages');
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(11,15,18,0.55)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 380, background: TT.surface, borderRadius: 20,
          border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg, padding: 22,
          fontFamily: TFont.body,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: TT.accentSoft, color: TT.accentInk,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Calendar size={20} strokeWidth={2.2} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common:close', 'Close')}
            style={{
              width: 32, height: 32, borderRadius: 10, border: 'none',
              background: TT.surface2, color: TT.textSub, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div style={{
          fontFamily: TFont.display, fontSize: 18, fontWeight: 800, color: TT.text, letterSpacing: -0.4, lineHeight: 1.2,
          marginTop: 4, marginBottom: 6,
        }}>
          {isClient
            ? t('publicTrainerProfile.bookCta.alreadyClient', { name: trainerName, defaultValue: "You're already coaching with {{name}}." })
            : t('publicTrainerProfile.bookCta.intro', { name: trainerName, defaultValue: 'Want to start training with {{name}}?' })}
        </div>
        <div style={{ fontSize: 13.5, color: TT.textSub, lineHeight: 1.5, marginBottom: 16 }}>
          {isClient
            ? t('publicTrainerProfile.bookCta.alreadyClientBody', 'Open your messages to schedule your next session.')
            : t('publicTrainerProfile.bookCta.introBody', 'Send a message to introduce yourself and discuss session options.')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            onClick={onOpenMessages}
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 12, border: 'none',
              background: TT.text, color: '#fff', fontFamily: TFont.display,
              fontWeight: 800, fontSize: 14, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              minHeight: 44,
            }}
          >
            <Send size={14} strokeWidth={2.4} />
            {isClient
              ? t('publicTrainerProfile.bookCta.openMessages', 'Open messages')
              : t('publicTrainerProfile.bookCta.sendMessage', 'Send message')}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 12,
              background: 'transparent', border: 'none', color: TT.textSub,
              fontSize: 13, fontWeight: 700, cursor: 'pointer', minHeight: 44,
            }}
          >
            {t('common:cancel', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// ReviewModal — leave a 1-5 rating + body
// ────────────────────────────────────────────────────────────────────
function ReviewModal({ open, onClose, trainerName, onSubmit, submitting }) {
  const { t } = useTranslation('pages');
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');

  const handleClose = useCallback(() => {
    setRating(0);
    setBody('');
    onClose?.();
  }, [onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(11,15,18,0.55)' }}
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 380, background: TT.surface, borderRadius: 20,
          border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg, padding: 22,
          fontFamily: TFont.body,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{
              fontFamily: TFont.display, fontSize: 18, fontWeight: 800,
              color: TT.text, letterSpacing: -0.4, lineHeight: 1.2,
            }}>
              {t('publicTrainerProfile.leaveReview', 'Leave a review')}
            </div>
            <div style={{ fontSize: 12.5, color: TT.textSub, marginTop: 4 }}>
              {trainerName}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('common:close', 'Close')}
            style={{
              width: 32, height: 32, borderRadius: 10, border: 'none',
              background: TT.surface2, color: TT.textSub, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '10px 0 14px' }}>
          {[1, 2, 3, 4, 5].map((star) => {
            const filled = star <= rating;
            return (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                aria-label={t('publicTrainerProfile.starN', '{{n}} star', { n: star })}
                style={{
                  width: 44, height: 44, borderRadius: 12, border: 'none',
                  background: 'transparent', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Star
                  size={28}
                  fill={filled ? '#E8C547' : 'transparent'}
                  stroke={filled ? '#E8C547' : TT.textMute}
                  strokeWidth={1.6}
                />
              </button>
            );
          })}
        </div>
        <textarea
          value={body}
          onChange={(e) => { if (e.target.value.length <= 1000) setBody(e.target.value); }}
          rows={4}
          maxLength={1000}
          placeholder={t('publicTrainerProfile.reviewPlaceholder', 'Share what your sessions are like…')}
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 12, fontSize: 13.5,
            border: `1px solid ${TT.borderSolid}`, background: TT.surface2, color: TT.text,
            outline: 'none', resize: 'none', fontFamily: 'inherit', marginBottom: 12,
          }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={handleClose}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 12, border: 'none',
              background: TT.surface2, color: TT.textSub, fontSize: 13, fontWeight: 700,
              cursor: 'pointer', minHeight: 44,
            }}
          >
            {t('common:cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() => onSubmit({ rating, body: body.trim() })}
            disabled={rating === 0 || submitting}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 12, border: 'none',
              background: TT.accent, color: '#06363B',
              fontFamily: TFont.display, fontSize: 13.5, fontWeight: 800,
              cursor: rating === 0 || submitting ? 'not-allowed' : 'pointer',
              opacity: rating === 0 || submitting ? 0.55 : 1,
              minHeight: 44,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {t('common:save', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────
export default function PublicTrainerProfile() {
  const navigate = useNavigate();
  const { trainerId } = useParams();
  const { user, profile, activeView } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation(['pages', 'common']);

  const [loading, setLoading] = useState(true);
  const [trainer, setTrainer] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [reviewSummary, setReviewSummary] = useState({ review_count: 0, avg_rating: 0, five_pct: 0 });
  const [reviews, setReviews] = useState([]);
  const [clientCount, setClientCount] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  // False until get_trainer_public_stats resolves — when the RPC isn't
  // deployed (or errors) we hide the client/session tiles entirely rather
  // than showing a misleading 0 on an upsell page.
  const [statsAvailable, setStatsAvailable] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [hasEverBeenClient, setHasEverBeenClient] = useState(false);
  const [nextSessionAt, setNextSessionAt] = useState(null);
  const [favorites, setFavorites] = useState(loadFavorites);
  const [contactOpen, setContactOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);

  const isFavorite = favorites.has(trainerId);

  // ── Data fetch ─────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!trainerId || !profile?.id) return;
    setLoading(true);

    // 1) Trainer profile — via the get_trainer_public_profile RPC.
    // Reading `profiles` directly from the client fails the same way the
    // MyGym list did: RLS hides other people's profile rows, and
    // `.eq('role','trainer')` misses multi-role users (member primary +
    // 'trainer' in additional_roles). The SECURITY DEFINER RPC does the
    // role check server-side and enforces "same gym as caller" — it
    // returns null for a cross-gym id, a non-trainer, or a bad id.
    // See migration 0391.
    const { data: tdata, error: terr } = await supabase
      .rpc('get_trainer_public_profile', { p_trainer_id: trainerId });

    if (terr || !tdata || tdata.gym_id !== profile.gym_id) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setTrainer(tdata);

    // 2) Aggregate review summary, recent reviews, stats, and rel — in parallel
    const [
      summaryRes,
      reviewsRes,
      statsRes,
      relRes,
      anyRelRes,
      nextSessionRes,
    ] = await Promise.all([
      supabase.rpc('get_trainer_review_summary', { p_trainer_id: trainerId }),
      // Reviews are fetched bare — the `reviewer:profiles!reviewer_id(...)`
      // embed is RLS-nulled for non-friends, so every reviewer rendered as
      // "Member". Reviewer display data is resolved below through the
      // same-gym gym_member_profiles_safe view instead.
      supabase
        .from('trainer_reviews')
        .select('id, rating, body, created_at, reviewer_id')
        .eq('trainer_id', trainerId)
        .order('created_at', { ascending: false })
        .limit(3),
      // Client/session counts via SECURITY DEFINER RPC — counting
      // trainer_clients / trainer_sessions directly returns 0 for members
      // because RLS hides rows that aren't their own.
      supabase.rpc('get_trainer_public_stats', { p_trainer_id: trainerId }),
      supabase
        .from('trainer_clients')
        .select('id, is_active')
        .eq('trainer_id', trainerId)
        .eq('client_id', profile.id)
        .eq('is_active', true)
        .maybeSingle(),
      supabase
        .from('trainer_clients')
        .select('id, is_active')
        .eq('trainer_id', trainerId)
        .eq('client_id', profile.id)
        .maybeSingle(),
      supabase
        .from('trainer_sessions')
        .select('scheduled_at')
        .eq('trainer_id', trainerId)
        .eq('status', 'scheduled')
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    // RPC returns array
    const summaryRow = Array.isArray(summaryRes.data) ? summaryRes.data[0] : summaryRes.data;
    setReviewSummary(summaryRow || { review_count: 0, avg_rating: 0, five_pct: 0 });

    // Resolve reviewer names/avatars via the safe view and reattach them
    // under the `reviewer` key the render already expects.
    const reviewRows = reviewsRes.data || [];
    const reviewerIds = [...new Set(reviewRows.map((r) => r.reviewer_id).filter(Boolean))];
    const reviewerById = {};
    if (reviewerIds.length) {
      const { data: reviewerProfs } = await supabase
        .from('gym_member_profiles_safe')
        .select('id, full_name, avatar_url, avatar_type, avatar_value')
        .in('id', reviewerIds);
      (reviewerProfs || []).forEach((p) => { reviewerById[p.id] = p; });
    }
    setReviews(reviewRows.map((r) => ({ ...r, reviewer: reviewerById[r.reviewer_id] ?? null })));

    const statsRow = Array.isArray(statsRes.data) ? statsRes.data[0] : statsRes.data;
    if (!statsRes.error && statsRow) {
      setClientCount(Number(statsRow.client_count) || 0);
      setSessionCount(Number(statsRow.completed_sessions) || 0);
      setStatsAvailable(true);
    } else {
      // RPC missing (migration not applied yet) or failed — hide the tiles.
      setStatsAvailable(false);
    }
    setIsClient(!!relRes.data);
    setHasEverBeenClient(!!anyRelRes.data);
    setNextSessionAt(nextSessionRes.data?.scheduled_at || null);

    // Directory opt-out: if the trainer has flipped the visibility toggle
    // off, hide the profile unless the viewer has a client relationship
    // (active or historical) or is the trainer themselves. This matches
    // the MyGym directory filter so a hidden trainer can't be reached
    // even by guessing the URL.
    const viewerIsTrainer = tdata.id === profile.id;
    const viewerIsClient = !!relRes.data || !!anyRelRes.data;
    if (tdata.trainer_directory_visible === false && !viewerIsTrainer && !viewerIsClient) {
      setNotFound(true);
    }

    setLoading(false);
  }, [trainerId, profile]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Favorite toggle ─────────────────────────────────────
  const toggleFavorite = useCallback(() => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(trainerId)) next.delete(trainerId);
      else next.add(trainerId);
      saveFavorites(next);
      return next;
    });
  }, [trainerId]);

  // ── Share ──────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    // PROD_WEB_URL, not window.location.origin — on Capacitor the origin is
    // capacitor://localhost, which is dead for recipients.
    const url = `${PROD_WEB_URL}/trainers/${trainerId}`;
    const title = trainer?.full_name || t('publicTrainerProfile.title', 'Trainer profile');
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ title, url }); return; } catch { /* user cancelled */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(t('publicTrainerProfile.linkCopied', 'Link copied'), 'success');
    } catch {
      showToast(t('publicTrainerProfile.shareFailed', 'Could not share'), 'error');
    }
  }, [trainerId, trainer, showToast, t]);

  // ── Open messages w/ trainer ────────────────────────────
  const openMessages = useCallback(async () => {
    if (!user?.id || !trainer?.id) return;
    setContactOpen(false);
    const { data: convId, error } = await supabase
      .rpc('get_or_create_conversation', { p_other_user: trainer.id });
    if (error || !convId) {
      showToast(t('publicTrainerProfile.messageFailed', 'Could not open messages'), 'error');
      return;
    }
    // This page is reachable from every role. A viewer in trainer view gets
    // bounced off the member /messages route by ProtectedRoute, so send them
    // to the trainer chat instead (same conversation table underneath).
    navigate(activeView === 'trainer' ? `/trainer/messages/${convId}` : `/messages/${convId}`);
  }, [user, trainer, navigate, showToast, t, activeView]);

  // ── Tap-to-call when the trainer has shared their phone ──
  // Falls back to a "coming soon" toast if no number is on file so the
  // button stays useful when calling isn't wired up yet.
  const handleCallTap = useCallback(() => {
    const phone = trainer?.phone_number;
    if (!phone) {
      showToast(t('publicTrainerProfile.callComingSoon', 'Calling coming soon'), 'info');
      return;
    }
    window.location.href = `tel:${phone.replace(/[^+\d]/g, '')}`;
  }, [trainer?.phone_number, showToast, t]);

  // ── Submit review ──────────────────────────────────────
  const handleSubmitReview = useCallback(async ({ rating, body }) => {
    if (!user?.id || !trainer?.id || !profile?.gym_id) return;
    if (rating < 1 || rating > 5) return;
    setSubmittingReview(true);
    const { error } = await supabase
      .from('trainer_reviews')
      .upsert(
        {
          trainer_id: trainer.id,
          reviewer_id: user.id,
          gym_id: profile.gym_id,
          rating,
          body: body || null,
        },
        { onConflict: 'trainer_id,reviewer_id' },
      );
    setSubmittingReview(false);
    if (error) {
      // Keep the raw error for debugging, but never surface it to the member.
      console.error('[PublicTrainerProfile] review submit failed:', error);
      showToast(t('publicTrainerProfile.reviewFailed', "Couldn't submit your review. Try again."), 'error');
      return;
    }
    setReviewOpen(false);
    showToast(t('publicTrainerProfile.reviewSaved', 'Review saved'), 'success');
    loadAll();
  }, [user, trainer, profile, showToast, t, loadAll]);

  // ── Derived display values ──────────────────────────────
  const displayName = trainer?.full_name || trainer?.username || t('publicTrainerProfile.trainerLabel', 'Trainer');
  const credentialsArr = Array.isArray(trainer?.trainer_credentials) ? trainer.trainer_credentials : [];
  const specialtiesArr = Array.isArray(trainer?.trainer_specialties) ? trainer.trainer_specialties : [];
  const servicesArr = useMemo(
    () => (Array.isArray(trainer?.trainer_services) ? trainer.trainer_services : []),
    [trainer],
  );
  const topCredential = credentialsArr[0]?.name || credentialsArr[0]?.issuer || '';
  const yearsExp = typeof trainer?.trainer_years_exp === 'number' ? trainer.trainer_years_exp : null;
  const tagline = trainer?.trainer_tagline || trainer?.bio || '';
  const ratingValue = Number(reviewSummary?.avg_rating || 0);
  const reviewCount = Number(reviewSummary?.review_count || 0);
  const fivePct = Number(reviewSummary?.five_pct || 0);

  const cheapestService = useMemo(() => {
    if (!Array.isArray(servicesArr) || servicesArr.length === 0) return null;
    return servicesArr.reduce((acc, s) => {
      const cents = typeof s?.price_cents === 'number' ? s.price_cents : Infinity;
      const accCents = typeof acc?.price_cents === 'number' ? acc.price_cents : Infinity;
      return cents < accCents ? s : acc;
    }, servicesArr[0]);
  }, [servicesArr]);

  const headlinePriceLabel = useMemo(() => {
    const cents = cheapestService?.price_cents;
    if (typeof cents !== 'number') return null;
    return `$${Math.round(cents / 100)}`;
  }, [cheapestService]);

  // ── Render: loading / not found ─────────────────────────
  if (loading) {
    return (
      <div style={{
        minHeight: '100%', background: TT.bg, paddingTop: 120,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Loader2 size={28} className="animate-spin" style={{ color: TT.accent }} />
      </div>
    );
  }
  if (notFound) {
    return (
      <div style={{ minHeight: '100%', background: TT.bg, padding: '60px 20px' }}>
        <div style={{ maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
          <div style={{
            fontFamily: TFont.display, fontSize: 22, fontWeight: 800,
            color: TT.text, letterSpacing: -0.4, marginBottom: 8,
          }}>
            {t('publicTrainerProfile.notFound', 'Trainer not found')}
          </div>
          <div style={{ fontSize: 13.5, color: TT.textSub, marginBottom: 18 }}>
            {t('publicTrainerProfile.notFoundBody', 'This trainer is not part of your gym.')}
          </div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{
              padding: '10px 18px', borderRadius: 12, border: 'none',
              background: TT.text, color: '#fff', fontFamily: TFont.display,
              fontWeight: 800, fontSize: 13.5, cursor: 'pointer', minHeight: 44,
            }}
          >
            {t('common:back', 'Back')}
          </button>
        </div>
      </div>
    );
  }

  // ── Render: page ────────────────────────────────────────
  return (
    <div style={{
      background: TT.bg, minHeight: '100%',
      paddingBottom: `calc(120px + env(safe-area-inset-bottom, 0px))`,
      fontFamily: TFont.body,
    }}>
      {/* ── Cover ─────────────────────────────────── */}
      <div style={{ position: 'relative', height: 180 }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: trainer?.trainer_cover_url
            ? `url("${trainer.trainer_cover_url}") center/cover no-repeat`
            : 'linear-gradient(135deg, #FFB86B 0%, #FF7A3D 60%, #FF5A2E 100%)',
        }} />
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(circle at 80% 20%, rgba(255,255,255,0.18), transparent 50%)',
        }} />
        {/* Top bar */}
        <div style={{
          position: 'absolute', top: 'calc(12px + env(safe-area-inset-top, 0px))', left: 16, right: 16,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 2,
        }}>
          <button
            type="button"
            aria-label={t('common:back', 'Back')}
            onClick={() => navigate(-1)}
            style={{
              width: 44, height: 44, borderRadius: 12, border: 'none',
              background: 'rgba(255,255,255,0.22)', color: '#fff',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', backdropFilter: 'blur(6px)',
            }}
          >
            <ChevronLeft size={20} strokeWidth={2.4} />
          </button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              aria-label={t('publicTrainerProfile.favorite', 'Favorite')}
              aria-pressed={isFavorite}
              onClick={toggleFavorite}
              style={{
                width: 44, height: 44, borderRadius: 12, border: 'none',
                background: 'rgba(255,255,255,0.22)', color: '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', backdropFilter: 'blur(6px)',
              }}
            >
              <Heart
                size={18}
                strokeWidth={2.2}
                fill={isFavorite ? '#fff' : 'transparent'}
              />
            </button>
            <button
              type="button"
              aria-label={t('publicTrainerProfile.share', 'Share')}
              onClick={handleShare}
              style={{
                width: 44, height: 44, borderRadius: 12, border: 'none',
                background: 'rgba(255,255,255,0.22)', color: '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', backdropFilter: 'blur(6px)',
              }}
            >
              <Share2 size={18} strokeWidth={2.2} />
            </button>
            {/* Apple G1.2 — Report / Block on profile surfaces. Wrapped to
                visually match the favorite/share buttons on the cover. The
                inner trigger is 32px; the wrapper provides the 44px target. */}
            {trainer?.id && (
              <div
                style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: 'rgba(255,255,255,0.22)', color: '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  backdropFilter: 'blur(6px)',
                }}
              >
                <ContentActionMenu
                  contentType="profile"
                  contentId={trainer.id}
                  authorId={trainer.id}
                  authorUsername={trainer.username}
                  authorFullName={trainer.full_name}
                  currentUserId={user?.id}
                  iconSize={18}
                  buttonClassName="!text-white"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Identity card ─────────────────────────── */}
      <div style={{ padding: '0 16px', marginTop: -50, position: 'relative', zIndex: 2 }}>
        <TCard padded={16}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ flexShrink: 0 }}>
              <UserAvatar user={trainer} size={72} rounded="2xl" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <div style={{
                  fontFamily: TFont.display, fontSize: 20, fontWeight: 800,
                  color: TT.text, letterSpacing: -0.6, lineHeight: 1.1,
                }}>
                  {displayName}
                </div>
                {trainer?.trainer_verified && (
                  <BadgeCheck size={16} strokeWidth={3} color={TT.goodInk} aria-label={t('publicTrainerProfile.verified', 'Verified')} />
                )}
              </div>
              {(topCredential || yearsExp != null) && (
                <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 2 }}>
                  {topCredential}
                  {topCredential && yearsExp != null ? ' · ' : ''}
                  {yearsExp != null
                    ? t('publicTrainerProfile.yrsExp', '{{n}} yrs', { n: yearsExp })
                    : ''}
                </div>
              )}
              {reviewCount > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
                  <span style={{ color: '#E8C547', fontSize: 13 }}>★</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: TT.text }}>
                    {ratingValue.toFixed(1)}
                  </span>
                  <span style={{ fontSize: 11, color: TT.textMute }}>
                    ({reviewCount}) ·{' '}
                    {t('publicTrainerProfile.recommend_pct', '{{pct}}% recommend', { pct: Math.round(fivePct) })}
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: TT.textMute, marginTop: 6 }}>
                  {t('publicTrainerProfile.noReviewsYet', 'No reviews yet')}
                </div>
              )}
            </div>
          </div>
          {tagline && (
            <div style={{
              fontSize: 13, color: TT.text, lineHeight: 1.45, marginTop: 12,
              fontFamily: TFont.body,
            }}>
              {tagline}
            </div>
          )}
        </TCard>
      </div>

      {/* ── Big book CTA + secondary actions ─── */}
      <div style={{ padding: '14px 16px' }}>
        <button
          type="button"
          onClick={() => setContactOpen(true)}
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 14,
            border: 'none', background: TT.text, color: '#fff',
            fontFamily: TFont.display, fontSize: 15, fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: '0 6px 16px rgba(20,22,26,0.2)', cursor: 'pointer',
            minHeight: 48,
          }}
        >
          <Calendar size={16} strokeWidth={2.4} />
          {t('publicTrainerProfile.book', 'Book a session')}
        </button>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={openMessages}
            style={{
              flex: 1, padding: '10px', borderRadius: 12,
              border: `1px solid ${TT.borderSolid}`, background: TT.surface,
              fontSize: 12.5, fontWeight: 700, color: TT.text,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              cursor: 'pointer', minHeight: 44,
            }}
          >
            <MessageSquare size={14} strokeWidth={2.2} />
            {t('publicTrainerProfile.message', 'Message')}
          </button>
          {/* Show Call when the trainer has published a phone number. The
              `tel:` link triggers the native dialer; on desktop it opens
              FaceTime / a default handler if one is registered. */}
          {trainer?.phone_number && (
            <button
              type="button"
              onClick={handleCallTap}
              style={{
                flex: 1, padding: '10px', borderRadius: 12,
                border: `1px solid ${TT.borderSolid}`, background: TT.surface,
                fontSize: 12.5, fontWeight: 700, color: TT.text,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                cursor: 'pointer', minHeight: 44,
              }}
            >
              <Phone size={14} strokeWidth={2.2} />
              {t('publicTrainerProfile.call', 'Call')}
            </button>
          )}
        </div>
      </div>

      {/* ── Stats strip ──────────────────────────── */}
      {/* Client/session tiles only render when get_trainer_public_stats
          resolved — a hidden tile beats a misleading "0" on an upsell page. */}
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${statsAvailable ? 3 : 1}, 1fr)`, gap: 6 }}>
          {[
            ...(statsAvailable
              ? [{ v: String(clientCount), l: t('publicTrainerProfile.activeClients', 'Active clients'), tone: TT.accent }]
              : []),
            {
              v: yearsExp != null
                ? t('publicTrainerProfile.yrsExp', '{{n}} yrs', { n: yearsExp })
                : '—',
              l: t('publicTrainerProfile.coaching', 'Coaching'),
              tone: TT.coach,
            },
            ...(statsAvailable
              ? [{ v: String(sessionCount), l: t('publicTrainerProfile.sessionsLabel', 'Sessions'), tone: TT.hot }]
              : []),
          ].map((s, i) => (
            <div key={i} style={{
              padding: '10px 6px', borderRadius: 10,
              background: TT.surface, border: `1px solid ${TT.border}`,
              textAlign: 'center',
            }}>
              <div style={{
                fontFamily: TFont.display, fontSize: 18, fontWeight: 800,
                color: s.tone, letterSpacing: -0.5, lineHeight: 1,
              }}>{s.v}</div>
              <div style={{
                fontSize: 9.5, color: TT.textSub, fontWeight: 700,
                marginTop: 5, letterSpacing: 0.4, textTransform: 'uppercase',
              }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Services ────────────────────────────── */}
      {servicesArr.length > 0 && (
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{
            fontFamily: TFont.display, fontSize: 16, fontWeight: 800,
            color: TT.text, letterSpacing: -0.3, marginBottom: 8,
          }}>
            {t('publicTrainerProfile.chooseSession', 'Choose a session')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {servicesArr.map((s, i) => {
              const tones = [
                { tone: TT.accent, soft: TT.accentSoft },
                { tone: TT.coach,  soft: TT.coachSoft },
                { tone: TT.hot,    soft: TT.hotSoft },
              ];
              const { tone, soft } = tones[i % tones.length];
              const dur = typeof s?.duration_min === 'number'
                ? t('publicTrainerProfile.minutes', '{{n}} min', { n: s.duration_min })
                : '';
              const priceLabel = typeof s?.price_cents === 'number'
                ? `$${Math.round(s.price_cents / 100)}`
                : '—';
              return (
                <TCard key={s?.id || i} padded={14} style={{ position: 'relative' }}>
                  {s?.popular && (
                    <div style={{
                      position: 'absolute', top: -8, left: 12,
                      padding: '2px 8px', borderRadius: 999,
                      background: TT.accent, color: '#06363B',
                      fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
                      textTransform: 'uppercase',
                    }}>
                      {t('publicTrainerProfile.popular', 'Popular')}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 11, background: soft,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <Dumbbell size={18} strokeWidth={2.2} color={tone} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: TT.text }}>
                        {s?.name || t('publicTrainerProfile.untitledService', 'Session')}
                      </div>
                      {dur && (
                        <div style={{ fontSize: 11, color: TT.textSub, marginTop: 1 }}>
                          {dur}
                          {s?.description ? ` · ${s.description}` : ''}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{
                        fontFamily: TFont.display, fontSize: 18, fontWeight: 800,
                        color: TT.text, letterSpacing: -0.4, lineHeight: 1,
                      }}>{priceLabel}</div>
                      <div style={{
                        fontSize: 9.5, color: TT.textMute, marginTop: 4,
                        fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
                      }}>
                        {t('publicTrainerProfile.perSession', 'Per session')}
                      </div>
                    </div>
                  </div>
                </TCard>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Specialties chips ─────────────────────── */}
      {specialtiesArr.length > 0 && (
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{
            fontFamily: TFont.display, fontSize: 14, fontWeight: 800,
            color: TT.text, letterSpacing: -0.2, marginBottom: 8,
          }}>
            {t('publicTrainerProfile.specializesIn', 'Specializes in')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {specialtiesArr.map((s, i) => (
              <div key={i} style={{
                padding: '6px 10px', borderRadius: 999,
                background: TT.surface, border: `1px solid ${TT.borderSolid}`,
                fontSize: 11.5, fontWeight: 700, color: TT.text,
              }}>{s}</div>
            ))}
          </div>
        </div>
      )}

      {/* ── Reviews ────────────────────────────── */}
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'baseline', marginBottom: 8,
        }}>
          <div style={{
            fontFamily: TFont.display, fontSize: 14, fontWeight: 800,
            color: TT.text, letterSpacing: -0.2,
          }}>
            {reviewCount === 1
              ? t('publicTrainerProfile.reviewsCount_one', 'Review · 1')
              : t('publicTrainerProfile.reviewsCount_other', 'Reviews · {{count}}', { count: reviewCount })}
          </div>
          {reviewCount > 0 && (
            <div style={{ fontSize: 11.5, color: TT.accent, fontWeight: 700 }}>
              {t('publicTrainerProfile.seeAll', 'See all')} →
            </div>
          )}
        </div>
        {reviews.length === 0 ? (
          <TCard padded={14}>
            <div style={{ fontSize: 12.5, color: TT.textSub, textAlign: 'center', padding: '6px 0' }}>
              {t('publicTrainerProfile.noReviewsYet', 'No reviews yet')}
            </div>
          </TCard>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {reviews.map((r) => {
              const reviewer = r.reviewer || {};
              return (
                <TCard key={r.id} padded={14}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    {reviewer.avatar_url ? (
                      <UserAvatar user={reviewer} size={28} />
                    ) : (
                      <TAvatar
                        name={reviewer.full_name || '?'}
                        size={28}
                        idx={avatarIdx(reviewer.id || r.id)}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 800, color: TT.text,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {reviewer.full_name || t('publicTrainerProfile.member', 'Member')}
                      </div>
                      <div style={{ fontSize: 10, color: TT.textMute }}>
                        {relativeShort(r.created_at, t)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 1 }}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <span
                          key={j}
                          aria-hidden="true"
                          style={{
                            color: j < (r.rating || 0) ? '#E8C547' : TT.textFaint,
                            fontSize: 11,
                          }}
                        >★</span>
                      ))}
                    </div>
                  </div>
                  {r.body && (
                    <div style={{
                      fontSize: 12, color: TT.text, lineHeight: 1.45,
                      fontStyle: 'italic',
                    }}>
                      &ldquo;{r.body}&rdquo;
                    </div>
                  )}
                </TCard>
              );
            })}
          </div>
        )}

        {/* Leave a review CTA — only past/current clients */}
        {hasEverBeenClient && (
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            style={{
              width: '100%', marginTop: 12,
              padding: '10px 14px', borderRadius: 12,
              border: `1px solid ${TT.borderSolid}`, background: TT.surface,
              fontSize: 12.5, fontWeight: 700, color: TT.text,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              cursor: 'pointer', minHeight: 44,
            }}
          >
            <Star size={14} strokeWidth={2.2} fill={TT.accent} stroke={TT.accent} />
            {t('publicTrainerProfile.leaveReview', 'Leave a review')}
          </button>
        )}
      </div>

      {/* ── Sticky bottom book bar ──────────────── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: `12px 16px calc(12px + env(safe-area-inset-bottom, 0px))`,
        // Theme-aware translucent bar — the old hardcoded cream rgba glowed
        // in dark mode. color-mix keeps the 95% opacity on top of --tt-bg.
        background: 'color-mix(in srgb, var(--tt-bg) 95%, transparent)',
        borderTop: `1px solid ${TT.border}`,
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 720, margin: '0 auto' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {headlinePriceLabel ? (
              <div style={{
                fontFamily: TFont.display, fontSize: 18, fontWeight: 800,
                color: TT.text, letterSpacing: -0.4, lineHeight: 1,
              }}>
                {headlinePriceLabel}{' '}
                <span style={{ fontSize: 11, color: TT.textMute, fontWeight: 600 }}>
                  {t('publicTrainerProfile.perSession', 'Per session').toLowerCase()}
                </span>
              </div>
            ) : (
              <div style={{
                fontFamily: TFont.display, fontSize: 16, fontWeight: 800,
                color: TT.text, letterSpacing: -0.3, lineHeight: 1,
              }}>
                {displayName}
              </div>
            )}
            {nextSessionAt && (
              <div style={{ fontSize: 10.5, color: TT.textSub, marginTop: 2, fontWeight: 700 }}>
                {t('publicTrainerProfile.nextLabel', 'Next:')}{' '}
                {new Date(nextSessionAt).toLocaleString(undefined, {
                  month: 'short', day: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                })}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setContactOpen(true)}
            style={{
              padding: '12px 20px', borderRadius: 12, border: 'none',
              background: TT.accent, color: '#06363B',
              fontFamily: TFont.display, fontSize: 14, fontWeight: 800,
              cursor: 'pointer', minHeight: 44,
            }}
          >
            {t('publicTrainerProfile.bookNow', 'Book now')}
          </button>
        </div>
      </div>

      {/* ── Modals ─────────────────────────────── */}
      <ContactPickerModal
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        trainerName={displayName}
        isClient={isClient}
        onOpenMessages={openMessages}
      />
      <ReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        trainerName={displayName}
        onSubmit={handleSubmitReview}
        submitting={submittingReview}
      />
    </div>
  );
}
