import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MessageSquare, ChevronRight, CalendarClock, UserMinus, Check } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { enUS } from 'date-fns/locale/en-US';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import logger from '../lib/logger';
import UserAvatar from './UserAvatar';

/**
 * "My Trainer" card for the member Profile page. Renders only when the member
 * has an active assigned trainer (trainer_clients). Shows the trainer's
 * identity + next upcoming session, a quick Message action, and taps through to
 * the full trainer profile (/trainers/:id) where the member can book, message,
 * and see everything the coach manages.
 *
 * Also the member's CONSENT surface (migration 0657). A trainer adding you no
 * longer grants them anything — the link starts 'pending' and they can read
 * nothing until you accept here. An accepted one can be ended from here too,
 * which is the half that was missing entirely: every write policy on
 * trainer_clients is trainer- or admin-scoped, so before this the member could
 * neither approve nor undo.
 *
 * Self-contained: own queries, scoped by RLS (members may read their own
 * trainer_clients row, the trainer's same-gym profile, and their own sessions).
 */
export default function MyTrainerCard() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');
  const dateLocale = i18n.language?.startsWith('es') ? es : enUS;

  const [trainer, setTrainer] = useState(null);
  const [pending, setPending] = useState(null);   // { id, full_name, ... } awaiting an answer
  const [nextSession, setNextSession] = useState(null);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => {
    const memberId = profile?.id;
    if (!memberId) return;
    let alive = true;
    (async () => {
      // Most-recent active trainer assignment for this member. Use limit(1) +
      // [0] (not maybeSingle) so a member with >1 active trainer never 406s.
      const { data: tcRows, error } = await supabase
        .from('trainer_clients')
        .select('trainer_id, assigned_at, status')
        .eq('client_id', memberId)
        .eq('is_active', true)
        .in('status', ['pending', 'active'])
        .order('assigned_at', { ascending: false })
        .limit(10);
      if (error) { logger.error('MyTrainerCard: trainer lookup failed:', error); return; }
      if (!alive) return;

      const rows = tcRows || [];
      const tc = rows.find(r => r.status === 'active') || null;
      const req = rows.find(r => r.status === 'pending') || null;

      // A pending request is resolved independently of the active card — a
      // member can be coached by one trainer while another is asking.
      if (req) {
        const { data: rp } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url, avatar_type, avatar_value, trainer_tagline')
          .eq('id', req.trainer_id)
          .maybeSingle();
        if (alive) setPending(rp || { id: req.trainer_id });
      }

      if (!tc?.trainer_id) return;

      const [profRes, sessRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url, avatar_type, avatar_value, bio, trainer_tagline')
          .eq('id', tc.trainer_id)
          .maybeSingle(),
        supabase
          .from('trainer_sessions')
          .select('scheduled_at, title, status')
          .eq('client_id', memberId)
          .eq('trainer_id', tc.trainer_id)
          .in('status', ['scheduled', 'confirmed'])
          .gte('scheduled_at', new Date().toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(1),
      ]);
      if (!alive) return;
      // Fall back to a minimal record so the card still shows even if the
      // trainer's profile row can't be read for any reason.
      setTrainer(profRes.data || { id: tc.trainer_id });
      if (sessRes.data?.[0]) setNextSession(sessRes.data[0]);
    })();
    return () => { alive = false; };
  }, [profile?.id]);

  if (!trainer && !pending) return null;

  const trainerName = trainer ? (trainer.full_name || trainer.username || t('profile.myTrainer', 'My trainer')) : '';
  const tagline = trainer ? (trainer.trainer_tagline || trainer.bio || '').trim() : '';
  const pendingName = pending ? (pending.full_name || pending.username || t('profile.aTrainer', 'A trainer')) : '';

  const answer = async (accept) => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('respond_to_trainer_request', {
        p_trainer_id: pending.id, p_accept: accept,
      });
      if (error) throw error;
      showToast(accept
        ? t('profile.trainerAccepted', 'Accepted — {{name}} is now your trainer', { name: pendingName })
        : t('profile.trainerDeclined', 'Request declined'), accept ? 'success' : 'info');
      setPending(null);
      // Accepting promotes them to the active card; refetch rather than guess.
      if (accept) setTimeout(() => window.dispatchEvent(new Event('tugympr:trainer-changed')), 0);
    } catch (err) {
      logger.error('MyTrainerCard: respond failed:', err);
      showToast(t('common.somethingWentWrong', 'Something went wrong'), 'error');
    } finally { setBusy(false); }
  };

  const endRelationship = async () => {
    if (!trainer || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('end_trainer_relationship', { p_trainer_id: trainer.id });
      if (error) throw error;
      showToast(t('profile.trainerRemoved', 'They no longer have access to your data'), 'success');
      setTrainer(null); setConfirmEnd(false);
    } catch (err) {
      logger.error('MyTrainerCard: end failed:', err);
      showToast(t('common.somethingWentWrong', 'Something went wrong'), 'error');
    } finally { setBusy(false); }
  };

  const openChat = async (e) => {
    e.stopPropagation();
    if (opening) return;
    setOpening(true);
    try {
      const { data: convId, error } = await supabase.rpc('get_or_create_conversation', { p_other_user: trainer.id });
      if (error || !convId) throw error || new Error('no conversation');
      navigate(`/messages/${convId}`);
    } catch (err) {
      logger.error('MyTrainerCard: open chat failed:', err);
      showToast(t('profile.openChatFailed', 'Could not open the chat. Try again.'), 'error');
    } finally {
      setOpening(false);
    }
  };

  const goProfile = () => { if (trainer) navigate(`/trainers/${trainer.id}`); };
  return (
    <>
    {/* Consent request. Deliberately NOT tappable-through to the profile: the
        only two things to do here are answer it. */}
    {pending && (
      <div className="w-full p-4 mb-4 rounded-2xl"
        style={{ border: '1px solid color-mix(in srgb, var(--color-accent) 32%, transparent)',
                 background: 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-card))' }}>
        <div className="flex items-center gap-3.5">
          <UserAvatar user={pending} size={44} />
          <div className="flex-1 min-w-0 text-left">
            <p className="text-[14px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
              {t('profile.trainerRequestTitle', '{{name}} wants to be your trainer', { name: pendingName })}
            </p>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('profile.trainerRequestBody', "They can't see any of your data unless you accept.")}
            </p>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button type="button" disabled={busy} onClick={() => answer(true)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-bold min-h-[44px] active:scale-[0.98] transition-all disabled:opacity-50"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #001512)' }}>
            <Check size={15} /> {t('profile.trainerAccept', 'Accept')}
          </button>
          <button type="button" disabled={busy} onClick={() => answer(false)}
            className="px-4 py-2.5 rounded-xl text-[13px] font-bold min-h-[44px] active:scale-[0.98] transition-all disabled:opacity-50"
            style={{ background: 'transparent', color: 'var(--color-text-muted)',
                     border: '1px solid var(--color-border-subtle)' }}>
            {t('profile.trainerDecline', 'Decline')}
          </button>
        </div>
      </div>
    )}

    {trainer && (confirmEnd ? (
      /* Inline confirm rather than a portal — a portal here would need route
         gating, and this is a two-tap decision that fits in the card. */
      <div className="w-full p-4 mb-4 rounded-2xl"
        style={{ border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-card)' }}>
        <p className="text-[13.5px] font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
          {t('profile.trainerRemoveConfirm', 'Remove {{name}} as your trainer?', { name: trainerName })}
        </p>
        <p className="text-[12px] mb-3" style={{ color: 'var(--color-text-muted)' }}>
          {t('profile.trainerRemoveBody', 'They lose access to your training data right away. Your own history stays.')}
        </p>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={endRelationship}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-bold min-h-[44px] active:scale-[0.98] transition-all disabled:opacity-50"
            style={{ background: 'var(--color-danger, #EF4444)', color: '#fff' }}>
            {t('profile.trainerRemoveYes', 'Remove')}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirmEnd(false)}
            className="px-4 py-2.5 rounded-xl text-[13px] font-bold min-h-[44px] active:scale-[0.98] transition-all"
            style={{ background: 'transparent', color: 'var(--color-text-muted)',
                     border: '1px solid var(--color-border-subtle)' }}>
            {t('common.cancel', 'Cancel')}
          </button>
        </div>
      </div>
    ) : (
    <div
      role="button"
      tabIndex={0}
      onClick={goProfile}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goProfile(); } }}
      className="w-full flex items-center gap-3.5 p-4 mb-4 rounded-2xl border border-[var(--color-accent)]/25 bg-gradient-to-r from-[var(--color-accent)]/10 to-[var(--color-accent)]/5 hover:from-[var(--color-accent)]/15 hover:to-[var(--color-accent)]/[0.08] transition-all duration-200 active:scale-[0.98] cursor-pointer"
    >
      <UserAvatar user={trainer} size={44} />
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2">
          <p className="text-[14px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{trainerName}</p>
          <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)', color: 'var(--color-accent)' }}>
            {t('messages.trainer', 'Trainer')}
          </span>
        </div>
        {nextSession ? (
          <p className="text-[12px] mt-0.5 flex items-center gap-1.5 font-medium" style={{ color: 'var(--color-accent)' }}>
            <CalendarClock size={12} />
            {t('profile.trainerNext', 'Next: {{when}}', { when: format(new Date(nextSession.scheduled_at), 'EEE p', { locale: dateLocale }) })}
          </p>
        ) : (
          <p className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
            {tagline || t('profile.myTrainerSubtitle', 'View your coach')}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={openChat}
        aria-label={t('profile.messageTrainer', 'Message')}
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform"
        style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', color: 'var(--color-accent)', opacity: opening ? 0.5 : 1 }}
      >
        <MessageSquare size={18} />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setConfirmEnd(true); }}
        aria-label={t('profile.trainerRemove', 'Remove trainer')}
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform"
        style={{ background: 'color-mix(in srgb, var(--color-text-muted) 12%, transparent)', color: 'var(--color-text-muted)' }}
      >
        <UserMinus size={17} />
      </button>
      <ChevronRight size={18} className="flex-shrink-0" style={{ color: 'color-mix(in srgb, var(--color-accent) 55%, transparent)' }} />
    </div>
    ))}
    </>
  );
}
