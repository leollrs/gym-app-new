import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { FadeIn } from '../../../components/admin';
import { TK, FK, TONE, Ico, Card } from './retosKit';

/**
 * Settings hub: 6 cards, one per focused sub-page. Each card routes to a
 * distinct destination (`/admin/settings/<slug>`). Restyled onto retosKit
 * per the "Configuración Restyle" design (2-col grid of icon-box cards).
 */

const CIC = {
  building: <><path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 21V9h5a1 1 0 0 1 1 1v11M3 21h18M7 8h3M7 12h3M7 16h3" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2 0-1.5 1-2 2-2h2a3 3 0 0 0 3-3 9 9 0 0 0-9-9Z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>,
  shield: <><path d="M12 3 5 6v5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6 8.5-6" /></>,
  printer: <><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M6 14h12v7H6v-7Z" /></>,
  qr: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M20 17v4M17 20h4" /></>,
  chevR: <path d="m9 18 6-6-6-6" />,
};

function SettingCard({ icon, tone = 'neutral', title, desc, onClick }) {
  const c = TONE[tone] || TONE.neutral;
  const active = tone !== 'neutral';
  return (
    <Card onClick={onClick} style={{ padding: '20px 22px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 15 }}>
      <span style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, display: 'grid', placeItems: 'center', background: active ? c.bg : TK.surface2, border: `1px solid ${active ? c.line : TK.borderSolid}` }}>
        <Ico ch={icon} size={21} color={active ? c.ink : TK.textSub} stroke={1.9} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FK.display, fontSize: 17, fontWeight: 800, color: TK.text, letterSpacing: -0.3 }}>{title}</div>
        <div style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, marginTop: 5, lineHeight: 1.45 }}>{desc}</div>
      </div>
      <Ico ch={CIC.chevR} size={17} color={TK.textFaint} stroke={2.2} style={{ marginTop: 4 }} />
    </Card>
  );
}

export default function SettingsHubGrid() {
  const { t } = useTranslation('pages');
  const navigate = useNavigate();

  const cards = [
    { icon: CIC.building, tone: 'neutral', title: t('admin.settingsHub.gymInfo', 'Gym info'), desc: t('admin.settingsHub.gymInfoDesc', 'Name, slug, language'), onClick: () => navigate('/admin/settings/gym-info') },
    { icon: CIC.palette, tone: 'accent', title: t('admin.settingsHub.branding', 'Branding'), desc: t('admin.settingsHub.brandingDesc', 'Logo, welcome, palette, colors'), onClick: () => navigate('/admin/settings/branding') },
    { icon: CIC.clock, tone: 'neutral', title: t('admin.settingsHub.hours', 'Gym hours'), desc: t('admin.settingsHub.hoursDesc', 'Daily hours + holiday closures'), onClick: () => navigate('/admin/settings/hours') },
    { icon: CIC.shield, tone: 'neutral', title: t('admin.settingsHub.registration', 'Registration & classes'), desc: t('admin.settingsHub.registrationDesc', 'How members join, class booking, birthdays'), onClick: () => navigate('/admin/settings/registration') },
    { icon: CIC.mail, tone: 'neutral', title: t('admin.settingsHub.digest', 'Email digest'), desc: t('admin.settingsHub.digestDesc', 'Weekly summary sent to you'), onClick: () => navigate('/admin/settings/digest') },
    { icon: CIC.printer, tone: 'neutral', title: t('admin.settingsHub.cards', 'Print cards'), desc: t('admin.settingsHub.cardsDesc', 'Tune what fires, when, and default rewards'), onClick: () => navigate('/admin/settings/cards') },
  ];

  return (
    <FadeIn>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6" style={{ marginTop: 18 }}>
        {cards.map((c, i) => <SettingCard key={i} {...c} />)}
      </div>
    </FadeIn>
  );
}
