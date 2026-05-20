import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Palette, Clock, Shield, Mail, Building2, ChevronRight,
} from 'lucide-react';
import { FadeIn } from '../../../components/admin';

/**
 * Settings hub: 6 cards, one per focused sub-page. Earlier we had 9 cards but
 * three of them (Theme & colors, Holiday closures, Class booking) deep-linked
 * to the SAME sub-page as their siblings — the user reported feeling
 * duplicated. Now each card points to a distinct destination:
 *  - Same-app sub-page (`/admin/settings/<slug>`)
 *  - Or a peer admin page (Notifications preferences tab)
 */
export default function SettingsHubGrid() {
  const { t } = useTranslation('pages');
  const navigate = useNavigate();

  const cards = [
    {
      icon: Building2,
      label: t('admin.settingsHub.gymInfo', 'Gym info'),
      desc: t('admin.settingsHub.gymInfoDesc', 'Name, slug, language'),
      onClick: () => navigate('/admin/settings/gym-info'),
    },
    {
      icon: Palette,
      label: t('admin.settingsHub.branding', 'Branding'),
      desc: t('admin.settingsHub.brandingDesc', 'Logo, welcome, palette, colors'),
      onClick: () => navigate('/admin/settings/branding'),
      accent: 'var(--color-accent)',
    },
    {
      icon: Clock,
      label: t('admin.settingsHub.hours', 'Gym hours'),
      desc: t('admin.settingsHub.hoursDesc', 'Daily hours + holiday closures'),
      onClick: () => navigate('/admin/settings/hours'),
    },
    {
      icon: Shield,
      label: t('admin.settingsHub.registration', 'Registration & classes'),
      desc: t('admin.settingsHub.registrationDesc', 'How members join, class booking, birthdays'),
      onClick: () => navigate('/admin/settings/registration'),
    },
    {
      icon: Mail,
      label: t('admin.settingsHub.digest', 'Email digest'),
      desc: t('admin.settingsHub.digestDesc', 'Weekly summary sent to you'),
      onClick: () => navigate('/admin/settings/digest'),
    },
  ];

  return (
    <FadeIn>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 md:gap-3 mb-6">
        {cards.map((c, i) => {
          const Icon = c.icon;
          return (
            <button
              key={i}
              type="button"
              onClick={c.onClick}
              className="group flex items-start gap-3 p-3.5 rounded-2xl text-left transition-all border hover:-translate-y-px active:translate-y-0 hover:brightness-110"
              style={{
                background: 'var(--color-bg-card)',
                borderColor: 'var(--color-border-subtle)',
              }}
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: c.accent
                  ? `color-mix(in srgb, ${c.accent} 16%, transparent)`
                  : 'var(--color-bg-hover)' }}
              >
                <Icon size={15} style={{ color: c.accent || 'var(--color-text-muted)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {c.label}
                </p>
                <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>
                  {c.desc}
                </p>
              </div>
              <ChevronRight size={12} className="opacity-50 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" style={{ color: 'var(--color-text-muted)' }} />
            </button>
          );
        })}
      </div>
    </FadeIn>
  );
}
