import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import SocialFeed from './SocialFeed';
import Challenges from './Challenges';
import Leaderboard from './Leaderboard';
import PageHeader from '../components/PageHeader';
import UnderlineTabs from '../components/UnderlineTabs';

const TAB_KEYS = ['feed', 'challenges', 'leaderboard'];

const TAB_ALIAS = {
  feed: 'feed',
  challenges: 'challenges',
  leaderboard: 'leaderboard',
};

export default function Community({ defaultTab = 'feed' }) {
  const { t } = useTranslation('pages');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialTab = (tabParam && TAB_ALIAS[tabParam.toLowerCase()]) || defaultTab;
  const [tab, setTab] = useState(initialTab);

  const TABS = TAB_KEYS.map(key => ({ key, label: t(`community.tabs.${key}`) }));

  // Sync tab from URL changes
  useEffect(() => {
    if (tabParam) {
      const mapped = TAB_ALIAS[tabParam.toLowerCase()];
      if (mapped && mapped !== tab) {
        setTab(mapped);
      }
    }
  }, [tabParam]);

  const handleTabChange = (i) => {
    const newTab = TABS[i].key;
    setTab(newTab);
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', newTab);
    setSearchParams(newParams, { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#05070B] pb-28 md:pb-12" data-tour="tour-community-page">
      <PageHeader title={t('community.title')}>
        <UnderlineTabs
          tabs={TABS.map(tb => ({ key: tb.key, label: tb.label }))}
          activeIndex={TABS.findIndex(tb => tb.key === tab)}
          onChange={handleTabChange}
        />
      </PageHeader>

      {/* Tab content */}
      <div className="max-w-[680px] md:max-w-4xl mx-auto px-4 sm:px-6 pt-4">
        {tab === 'feed' && <SocialFeed embedded />}
        {tab === 'challenges' && <Challenges embedded />}
        {tab === 'leaderboard' && <Leaderboard embedded />}
      </div>
    </div>
  );
}
