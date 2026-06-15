import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MessageSquare, ChevronRight, CalendarClock } from 'lucide-react';
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
 * Self-contained: own queries, scoped by RLS (members may read their own
 * trainer_clients row, the trainer's same-gym profile, and their own sessions).
 */
export default function MyTrainerCard() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');
  const dateLocale = i18n.language?.startsWith('es') ? es : enUS;

  const [trainer, setTrainer] = useState(null);
  const [nextSession, setNextSession] = useState(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    (async () => {
      // Most-recent active trainer assignment for this member.
      const { data: tc, error } = await supabase
        .from('trainer_clients')
        .select('trainer_id, assigned_at')
        .eq('client_id', user.id)
        .eq('is_active', true)
        .order('assigned_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !tc?.trainer_id || !alive) return;

      const [profRes, sessRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url, avatar_type, avatar_value, bio, trainer_tagline')
          .eq('id', tc.trainer_id)
          .maybeSingle(),
        supabase
          .from('trainer_sessions')
          .select('scheduled_at, title, status')
          .eq('client_id', user.id)
          .eq('trainer_id', tc.trainer_id)
          .in('status', ['scheduled', 'confirmed'])
          .gte('scheduled_at', new Date().toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);
      if (!alive) return;
      if (profRes.data) setTrainer(profRes.data);
      if (sessRes.data) setNextSession(sessRes.data);
    })();
    return () => { alive = false; };
  }, [user?.id]);

  if (!trainer) return null;

  const trainerName = trainer.full_name || trainer.username || t('profile.myTrainer', 'My trainer');
  const tagline = (trainer.trainer_tagline || trainer.bio || '').trim();

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

  const goProfile = () => navigate(`/trainers/${trainer.id}`);
  return (
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
      <ChevronRight size={18} className="flex-shrink-0" style={{ color: 'color-mix(in srgb, var(--color-accent) 55%, transparent)' }} />
    </div>
  );
}
