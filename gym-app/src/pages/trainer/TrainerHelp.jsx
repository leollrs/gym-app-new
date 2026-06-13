import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft, ChevronDown, Mail, MessageSquare,
  Search,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { TT, TFont } from './components/designTokens';
import { TCard, TEyebrow, TPageTitle, TIconButton, TPrimaryButton } from './components/designPrimitives';

const SUPPORT_EMAIL = 'support@tugympr.com';

export default function TrainerHelp() {
  const { t } = useTranslation(['pages', 'common']);
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [search, setSearch] = useState('');
  const [openFaq, setOpenFaq] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [sending, setSending] = useState(false);

  // Static FAQ list — i18n keys with embedded fallbacks. Easy to extend later.
  const FAQS = [
    {
      q: t('pages:trainerHelp.faq.client.q', 'How do I add a new client?'),
      a: t('pages:trainerHelp.faq.client.a', 'Go to Clients → tap + Add Client and search for the member by name. When you add them, they get a notification letting them know you\'re now their trainer.'),
    },
    {
      q: t('pages:trainerHelp.faq.plan.q', 'How do I assign a plan to a client?'),
      a: t('pages:trainerHelp.faq.plan.a', 'Open the client\'s profile, tap "Assign plan" on the Plan tab, and pick from your library or build a new one. The client sees the plan in their app under Workouts.'),
    },
    {
      q: t('pages:trainerHelp.faq.live.q', 'Can I see clients\' workouts in real time?'),
      a: t('pages:trainerHelp.faq.live.a', 'Yes — when a client starts a workout, a "Watch live" pill appears in their card on your Home page. Tap it to see set-by-set progress as they log it.'),
    },
    {
      q: t('pages:trainerHelp.faq.review.q', 'How do client reviews work?'),
      a: t('pages:trainerHelp.faq.review.a', 'Active clients can leave one review with a 1–5 star rating + optional comment from your public profile. Reviews are visible to other gym members.'),
    },
    {
      q: t('pages:trainerHelp.faq.payments.q', 'How do payments work?'),
      a: t('pages:trainerHelp.faq.payments.a', 'Clients pay you directly (cash, ATH Móvil, etc.) — the app never processes money. Use the Payments page to track each client\'s monthly fee and mark who has paid and who\'s pending.'),
    },
    {
      q: t('pages:trainerHelp.faq.cover.q', 'How do I change my cover image?'),
      a: t('pages:trainerHelp.faq.cover.a', 'On your profile page, tap "Edit cover" at the bottom-right of the orange header. Choose a photo from your library — it\'s shown to anyone who views your profile.'),
    },
    {
      q: t('pages:trainerHelp.faq.delete.q', 'How do I delete my account?'),
      a: t('pages:trainerHelp.faq.delete.a', 'Settings → Danger zone → Delete account. You\'ll be asked to type DELETE to confirm. This is permanent and removes all your data.'),
    },
  ];

  const filteredFaqs = FAQS.filter(({ q, a }) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return q.toLowerCase().includes(term) || a.toLowerCase().includes(term);
  });

  const sendFeedback = async () => {
    const body = feedback.trim();
    if (body.length < 10) {
      showToast(t('pages:trainerHelp.feedback.tooShort', 'Please write at least a sentence.'), 'error');
      return;
    }
    setSending(true);
    try {
      const subject = encodeURIComponent(`[Trainer feedback] ${profile?.full_name || profile?.username || 'Trainer'}`);
      const mailBody = encodeURIComponent(`From: ${profile?.full_name || ''} (${profile?.username || ''})\nGym: ${profile?.gym_id || ''}\n\n${body}`);
      // Handing off to the mail app — we can't know whether the draft was
      // actually sent, so keep the textarea intact and don't claim success.
      window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${mailBody}`;
      showToast(t('pages:trainerHelp.feedback.opening', 'Opening your email app…'), 'info');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ background: TT.bg, minHeight: '100%', paddingBottom: 100 }}>
      {/* Header */}
      <div className="max-w-3xl mx-auto" style={{ padding: '12px 16px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <TIconButton ariaLabel={t('common:back', 'Back')} onClick={() => navigate(-1)} size={36}>
          <ChevronLeft size={18} style={{ color: TT.text }} />
        </TIconButton>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TEyebrow>{t('pages:trainerSettings.title', 'Settings')}</TEyebrow>
          <TPageTitle style={{ fontSize: 24 }}>
            {t('pages:trainerHelp.title', 'Help & support')}
          </TPageTitle>
        </div>
      </div>

      {/* Search */}
      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: TT.surface, border: `1px solid ${TT.borderSolid}`,
          borderRadius: 12, padding: '0 12px',
        }}>
          <Search size={15} color={TT.textMute} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('pages:trainerHelp.searchPlaceholder', 'Search help articles…')}
            style={{
              flex: 1, padding: '12px 0', background: 'transparent',
              border: 'none', outline: 'none', fontSize: 13, color: TT.text,
            }}
          />
        </div>
      </div>

      {/* Quick contact */}
      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
        <div style={{
          fontFamily: TFont.display, fontSize: 13, fontWeight: 800,
          color: TT.textSub, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
        }}>
          {t('pages:trainerHelp.contact', 'Get in touch')}
        </div>
        {/* Documentation card removed — docs.tugympr.com doesn't exist (404). */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
          <button
            type="button"
            onClick={() => { window.location.href = `mailto:${SUPPORT_EMAIL}`; }}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
              padding: 14, borderRadius: 14,
              background: TT.surface, border: `1px solid ${TT.border}`,
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: TT.accentSoft, color: TT.accentInk,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Mail size={16} />
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: TT.text }}>
              {t('pages:trainerHelp.email', 'Email support')}
            </div>
            <div style={{ fontSize: 10.5, color: TT.textSub }}>{SUPPORT_EMAIL}</div>
          </button>
        </div>
      </div>

      {/* FAQs */}
      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
        <div style={{
          fontFamily: TFont.display, fontSize: 13, fontWeight: 800,
          color: TT.textSub, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
        }}>
          {t('pages:trainerHelp.faqs', 'Frequently asked')}
        </div>
        {filteredFaqs.length === 0 ? (
          <TCard padded={20} style={{ textAlign: 'center', color: TT.textSub, fontSize: 13 }}>
            {t('pages:trainerHelp.noResults', 'No matching articles. Try different keywords or email support.')}
          </TCard>
        ) : (
          <TCard padded={0}>
            {filteredFaqs.map((faq, i) => {
              const open = openFaq === i;
              return (
                <div key={i} style={{ borderTop: i > 0 ? `1px solid ${TT.border}` : 'none' }}>
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : i)}
                    style={{
                      width: '100%', padding: '14px',
                      background: 'transparent', border: 'none',
                      display: 'flex', alignItems: 'center', gap: 10,
                      textAlign: 'left', cursor: 'pointer', minHeight: 56,
                    }}
                    aria-expanded={open}
                  >
                    <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: TT.text }}>
                      {faq.q}
                    </div>
                    <ChevronDown
                      size={16}
                      style={{
                        color: TT.textMute, flexShrink: 0,
                        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 160ms ease',
                      }}
                    />
                  </button>
                  {open && (
                    <div style={{
                      padding: '0 14px 14px', fontSize: 12.5, color: TT.textSub,
                      lineHeight: 1.5, fontFamily: TFont.body,
                    }}>
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </TCard>
        )}
      </div>

      {/* Send feedback */}
      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 24px' }}>
        <div style={{
          fontFamily: TFont.display, fontSize: 13, fontWeight: 800,
          color: TT.textSub, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
        }}>
          {t('pages:trainerHelp.feedback.title', 'Send feedback')}
        </div>
        <TCard padded={14}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: TT.warnSoft, color: TT.warnInk || '#9A6C10',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <MessageSquare size={16} />
            </div>
            <div style={{ fontSize: 12.5, color: TT.textSub, lineHeight: 1.5 }}>
              {t('pages:trainerHelp.feedback.intro', 'Found a bug, have an idea, or stuck on something? Tell us — we read every message.')}
            </div>
          </div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value.slice(0, 1500))}
            rows={4}
            placeholder={t('pages:trainerHelp.feedback.placeholder', 'Tell us what happened…')}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 10,
              fontSize: 13, color: TT.text, background: TT.surface,
              border: `1px solid ${TT.borderSolid}`, outline: 'none',
              resize: 'none', fontFamily: TFont.body,
              marginBottom: 10,
            }}
          />
          <TPrimaryButton onClick={sendFeedback} disabled={sending || feedback.trim().length < 10} style={{ width: '100%' }}>
            <Mail size={14} strokeWidth={2.4} />
            {sending
              ? t('common:sending', 'Sending…')
              : t('pages:trainerHelp.feedback.send', 'Send via email')}
          </TPrimaryButton>
        </TCard>
      </div>
    </div>
  );
}
