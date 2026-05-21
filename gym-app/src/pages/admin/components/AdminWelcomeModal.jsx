import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Sparkles, MessageCircle, Microscope, AlertTriangle, ChevronRight, X,
} from 'lucide-react';

/**
 * AdminWelcomeModal — first-time admin "what is this app, and what do I do?"
 *
 * Shown ONCE per admin per gym (localStorage flag). Replaces the previous
 * AdminFirstRunChecklist behavior of "here are 6 setup items" with a
 * thesis-first onboarding: WHAT the app is, WHY the dashboards are
 * structured around the morning queue, and WHAT to do in the first week.
 *
 * Dismissal is intentional — the modal won't re-appear once closed. A
 * "Show me again" hook can be added to Admin Profile later if owners
 * want to revisit the explainer.
 *
 * Three panels, each ~10 seconds to read:
 *   1. What TuGymPR actually is (retention software, not gym management)
 *   2. The retention thesis (owner attention is the product)
 *   3. Your first week (3 concrete actions)
 */
export default function AdminWelcomeModal({ gymId, gymName, profileId, onClose }) {
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
  const [step, setStep] = useState(0);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem(`admin_welcome_shown_${gymId}_${profileId}`, '1');
    } catch { /* private mode / quota — accept that they'll see it again */ }
    onClose();
  };

  const next = () => {
    if (step < 2) setStep(step + 1);
    else handleDismiss();
  };

  const back = () => { if (step > 0) setStep(step - 1); };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(5,7,11,0.85)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="max-w-2xl w-full rounded-3xl overflow-hidden shadow-2xl"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border-default)',
        }}
      >
        {/* Header with skip */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div className="flex items-center gap-2">
            <Sparkles size={16} style={{ color: 'var(--color-accent)' }} />
            <p className="text-[11px] font-bold tracking-[0.2em] uppercase" style={{ color: 'var(--color-accent)' }}>
              {t('admin.welcome.eyebrow', { defaultValue: 'Welcome' })}
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="text-[11px] font-semibold transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {t('admin.welcome.skip', { defaultValue: 'Skip' })}
          </button>
        </div>

        {/* Body */}
        <div className="px-6 md:px-10 py-8 min-h-[380px] flex flex-col">
          {step === 0 && (
            <Panel
              icon={Sparkles}
              eyebrow={t('admin.welcome.s1.eyebrow', { defaultValue: 'What TuGymPR is' })}
              title={t('admin.welcome.s1.title', {
                defaultValue: '{{name}} is in.',
                name: gymName || '',
              })}
              body={t('admin.welcome.s1.body', {
                defaultValue: "This isn't a gym management app. It's retention software. While your existing system collects payments, TuGymPR answers a different question: who's about to cancel, and what do I say to them today?",
              })}
            />
          )}

          {step === 1 && (
            <Panel
              icon={MessageCircle}
              eyebrow={t('admin.welcome.s2.eyebrow', { defaultValue: 'The thesis' })}
              title={t('admin.welcome.s2.title', {
                defaultValue: 'Your attention is the product.',
              })}
              body={t('admin.welcome.s2.body', {
                defaultValue: "The gyms that retain are the ones where the owner notices when a member has gone two weeks without showing up — and reaches out. TuGymPR is the memory that tells you who, when, and what to say. It doesn't replace your touch — it scales it.",
              })}
              footnote={t('admin.welcome.s2.footnote', {
                defaultValue: "On your home screen: \"Today's conversations\" lists the 3–5 people to message this morning. That panel is the heart of the product.",
              })}
            />
          )}

          {step === 2 && (
            <FirstWeekPanel t={t} />
          )}
        </div>

        {/* Footer with steps + nav */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
          {/* Progress dots */}
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: i === step ? '24px' : '6px',
                  background: i <= step ? 'var(--color-accent)' : 'var(--color-border-default)',
                }}
              />
            ))}
          </div>

          {/* Nav buttons */}
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={back}
                className="px-4 py-2 rounded-xl text-[12px] font-semibold"
                style={{
                  background: 'var(--color-bg-hover)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {t('admin.welcome.back', { defaultValue: 'Back' })}
              </button>
            )}
            <button
              onClick={next}
              className="px-5 py-2 rounded-xl text-[12px] font-bold inline-flex items-center gap-2 transition-all"
              style={{
                background: 'var(--color-accent)',
                color: 'var(--color-text-on-accent, #000)',
              }}
            >
              {step < 2
                ? t('admin.welcome.next', { defaultValue: 'Continue' })
                : t('admin.welcome.done', { defaultValue: 'Get started' })}
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Standard panel layout ────────────────────────────────────────────────
function Panel({ icon: Icon, eyebrow, title, body, footnote }) {
  return (
    <div className="flex-1 flex flex-col justify-center">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}
      >
        <Icon size={24} style={{ color: 'var(--color-accent)' }} />
      </div>
      <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-2" style={{ color: 'var(--color-text-subtle)' }}>
        {eyebrow}
      </p>
      <h2 className="text-[28px] md:text-[32px] font-extrabold leading-tight mb-4" style={{ color: 'var(--color-text-primary)' }}>
        {title}
      </h2>
      <p className="text-[15px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
        {body}
      </p>
      {footnote && (
        <p
          className="text-[12.5px] leading-relaxed mt-5 px-4 py-3 rounded-xl border"
          style={{
            color: 'var(--color-text-muted)',
            background: 'color-mix(in srgb, var(--color-accent) 5%, transparent)',
            borderColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
          }}
        >
          {footnote}
        </p>
      )}
    </div>
  );
}

// ── Panel 3: "First week" with 3 concrete actions ────────────────────────
function FirstWeekPanel({ t }) {
  const actions = [
    {
      icon: Microscope,
      title: t('admin.welcome.s3.a1.title', { defaultValue: '1. Import or know your roster' }),
      body: t('admin.welcome.s3.a1.body', {
        defaultValue: "If you have old data in Excel or CSV, upload it through the super-admin console. I'll generate your retention curve from the last 2 years — the strongest sales argument for your own business.",
      }),
    },
    {
      icon: MessageCircle,
      title: t('admin.welcome.s3.a2.title', { defaultValue: '2. Message 3 members today' }),
      body: t('admin.welcome.s3.a2.body', {
        defaultValue: "Open \"Today's conversations\" on the overview. The first 3 are your top churn risks this week. Send them a real message — not a broadcast.",
      }),
    },
    {
      icon: AlertTriangle,
      title: t('admin.welcome.s3.a3.title', { defaultValue: '3. Check "Needs action" tomorrow' }),
      body: t('admin.welcome.s3.a3.body', {
        defaultValue: "Each morning has 5 minutes of work: pending responses, alerts, and the new daily queue. That routine is the difference between 70% and 85% annual retention.",
      }),
    },
  ];
  return (
    <div className="flex-1 flex flex-col justify-center">
      <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-2" style={{ color: 'var(--color-text-subtle)' }}>
        {t('admin.welcome.s3.eyebrow', { defaultValue: 'Your first week' })}
      </p>
      <h2 className="text-[24px] md:text-[28px] font-extrabold leading-tight mb-5" style={{ color: 'var(--color-text-primary)' }}>
        {t('admin.welcome.s3.title', { defaultValue: 'Three concrete actions to start.' })}
      </h2>
      <ul className="space-y-3">
        {actions.map((a, i) => (
          <li key={i} className="flex gap-3 items-start">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}
            >
              <a.icon size={15} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-bold mb-0.5" style={{ color: 'var(--color-text-primary)' }}>
                {a.title}
              </p>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                {a.body}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
