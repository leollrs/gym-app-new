import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle, Circle, X, Sparkles, ChevronRight,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { AdminCard, FadeIn } from '../../../components/admin';

/**
 * First-run setup checklist for new gym admins. Renders on AdminOverview
 * until every step is done — then it auto-dismisses. The admin can also
 * dismiss manually (localStorage flag per gym, so multiple admins on the
 * same gym don't all see it once one finishes).
 *
 * Each step is checked against existing data: branding row, gym hours,
 * sent invites, etc. — nothing new to track. When the checklist hides,
 * the page reclaims that vertical space for the normal dashboard.
 */
export default function AdminFirstRunChecklist({ gymId }) {
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
  const dismissedKey = `admin_setup_dismissed_${gymId}`;
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(dismissedKey) === '1';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setDismissed(localStorage.getItem(dismissedKey) === '1');
  }, [dismissedKey]);

  const { data: progress } = useQuery({
    queryKey: ['admin', 'first-run', gymId],
    queryFn: async () => {
      const [
        gymRes, brandingRes, hoursRes, invitesRes,
        programsRes, announcementsRes,
      ] = await Promise.all([
        supabase.from('gyms').select('name, registration_mode').eq('id', gymId).single(),
        supabase.from('gym_branding').select('primary_color, logo_url, welcome_message').eq('gym_id', gymId).maybeSingle(),
        supabase.from('gym_hours').select('id', { count: 'exact', head: true }).eq('gym_id', gymId),
        supabase.from('gym_invites').select('id', { count: 'exact', head: true }).eq('gym_id', gymId),
        supabase.from('gym_programs').select('id', { count: 'exact', head: true }).eq('gym_id', gymId),
        supabase.from('announcements').select('id', { count: 'exact', head: true }).eq('gym_id', gymId),
      ]);
      return {
        hasBranding: !!(brandingRes.data?.logo_url && brandingRes.data?.primary_color),
        hasWelcomeMessage: !!brandingRes.data?.welcome_message?.trim(),
        hasHours: (hoursRes.count ?? 0) > 0,
        hasInvites: (invitesRes.count ?? 0) > 0,
        hasPrograms: (programsRes.count ?? 0) > 0,
        hasAnnouncements: (announcementsRes.count ?? 0) > 0,
      };
    },
    enabled: !!gymId && !dismissed,
    staleTime: 60_000,
  });

  if (dismissed) return null;
  if (!progress) return null;

  const steps = [
    {
      key: 'branding',
      done: progress.hasBranding,
      label: t('admin.setup.brandingLabel', 'Add your logo and brand color'),
      desc: t('admin.setup.brandingDesc', 'Members see your branding throughout the app'),
      cta: t('admin.setup.brandingCta', 'Open branding'),
      onClick: () => navigate('/admin/settings?tab=branding'),
    },
    {
      key: 'hours',
      done: progress.hasHours,
      label: t('admin.setup.hoursLabel', 'Set your gym hours'),
      desc: t('admin.setup.hoursDesc', 'So check-ins and class scheduling work correctly'),
      cta: t('admin.setup.hoursCta', 'Set hours'),
      onClick: () => navigate('/admin/settings?tab=general'),
    },
    {
      key: 'welcome',
      done: progress.hasWelcomeMessage,
      label: t('admin.setup.welcomeLabel', 'Customize the welcome message'),
      desc: t('admin.setup.welcomeDesc', 'The first thing every new member sees'),
      cta: t('admin.setup.welcomeCta', 'Edit welcome'),
      onClick: () => navigate('/admin/settings?tab=branding'),
    },
    {
      key: 'invites',
      done: progress.hasInvites,
      label: t('admin.setup.invitesLabel', 'Send your first invite'),
      desc: t('admin.setup.invitesDesc', 'Get a member into the app to test things'),
      cta: t('admin.setup.invitesCta', 'Invite a member'),
      onClick: () => navigate('/admin/members'),
    },
    {
      key: 'programs',
      done: progress.hasPrograms,
      label: t('admin.setup.programsLabel', 'Create your first program'),
      desc: t('admin.setup.programsDesc', 'Members get assigned routines through gym programs'),
      cta: t('admin.setup.programsCta', 'Create program'),
      onClick: () => navigate('/admin/programs'),
    },
    {
      key: 'announcement',
      done: progress.hasAnnouncements,
      label: t('admin.setup.announcementLabel', 'Post a first announcement'),
      desc: t('admin.setup.announcementDesc', 'Members see announcements on their home screen'),
      cta: t('admin.setup.announcementCta', 'Post announcement'),
      onClick: () => navigate('/admin/announcements'),
    },
  ];

  const completed = steps.filter(s => s.done).length;

  // Auto-hide once everything is done — no need to manually dismiss.
  if (completed === steps.length) return null;

  const handleDismiss = () => {
    if (typeof window !== 'undefined') localStorage.setItem(dismissedKey, '1');
    setDismissed(true);
  };

  return (
    <FadeIn>
      <AdminCard className="mb-5" padding="p-0">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={14} style={{ color: 'var(--color-accent)' }} />
            <span className="text-[12px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent)', letterSpacing: '0.1em' }}>
              {t('admin.setup.title', 'Set up your gym')}
            </span>
            <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
              · {completed} / {steps.length}
            </span>
          </div>
          <button
            onClick={handleDismiss}
            className="w-7 h-7 rounded-lg grid place-items-center transition-colors hover:bg-[color:var(--color-admin-panel)]"
            aria-label={t('admin.setup.dismiss', 'Hide setup checklist')}
            title={t('admin.setup.dismiss', 'Hide setup checklist')}
          >
            <X size={13} style={{ color: 'var(--color-text-muted)' }} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1" style={{ background: 'var(--color-bg-deep)' }}>
          <div
            className="h-1 transition-all"
            style={{
              width: `${(completed / steps.length) * 100}%`,
              background: 'var(--color-accent)',
            }}
          />
        </div>

        {/* Steps */}
        <ul className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
          {steps.map(step => (
            <li key={step.key}>
              <button
                onClick={step.onClick}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[color:var(--color-admin-panel)] ${step.done ? 'opacity-60' : ''}`}
              >
                <div className="flex-shrink-0">
                  {step.done ? (
                    <CheckCircle size={18} style={{ color: 'var(--color-success)' }} />
                  ) : (
                    <Circle size={18} style={{ color: 'var(--color-text-muted)' }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-[13px] font-semibold ${step.done ? 'line-through' : ''}`}
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {step.label}
                  </p>
                  {!step.done && (
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      {step.desc}
                    </p>
                  )}
                </div>
                {!step.done && (
                  <span className="text-[11px] font-semibold flex items-center gap-0.5 flex-shrink-0" style={{ color: 'var(--color-accent)' }}>
                    {step.cta} <ChevronRight size={11} />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </AdminCard>
    </FadeIn>
  );
}
