import { useState, useEffect, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import SwipeableTabView from '../components/SwipeableTabView';
import UnderlineTabs from '../components/UnderlineTabs';
import ProgressOverview from './progress/ProgressOverview';
import ProgressBody from './progress/ProgressBody';
import Skeleton from '../components/Skeleton';

const PersonalRecords = lazy(() => import('./PersonalRecords'));
const Nutrition = lazy(() => import('./Nutrition'));

const TAB_KEYS = ['overview', 'body', 'records', 'nutrition'];

// Map URL ?tab= values to internal tab keys
const TAB_ALIAS = {
  overview: 'overview',
  strength: 'records',
  body: 'body',
  records: 'records',
  'personal-records': 'records',
  metrics: 'body',
  nutrition: 'nutrition',
};

export default function Progress() {
  const { t } = useTranslation('pages');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');

  const initialTab = (tabParam && TAB_ALIAS[tabParam.toLowerCase()]) || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [loadedTabs, setLoadedTabs] = useState(new Set([initialTab]));

  // Sync tab from URL changes (e.g. redirect navigations)
  useEffect(() => {
    if (tabParam) {
      const mapped = TAB_ALIAS[tabParam.toLowerCase()];
      if (mapped && mapped !== activeTab) {
        handleTabChange(mapped);
      }
    }
  }, [tabParam]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setLoadedTabs(prev => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
    // Update URL without adding to history
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', tab);
    setSearchParams(newParams, { replace: true });
  };

  const tabIndex = TAB_KEYS.indexOf(activeTab);
  const handleSwipe = (i) => handleTabChange(TAB_KEYS[i]);

  return (
    <div className="bg-[var(--color-bg-primary)]">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 backdrop-blur-2xl bg-[var(--color-bg-primary)]/95 border-b border-white/6">
        <div className="max-w-[480px] md:max-w-4xl mx-auto px-4 md:px-6 pt-3 pb-3" data-tour="tour-progress-page">
          <h1
            className="text-[22px] font-black text-[var(--color-text-primary)] mb-3 truncate"
            style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
          >
            {t('progress.title')}
          </h1>

          {/* Tab bar */}
          <UnderlineTabs
            tabs={TAB_KEYS.map(key => ({ key, label: t(`progress.tabs.${key}`) }))}
            activeIndex={tabIndex}
            onChange={handleSwipe}
          />
        </div>
      </div>

      {/* Tab content (swipeable) */}
      <div className="max-w-[480px] md:max-w-4xl mx-auto px-4 md:px-6 pt-5 pb-28 md:pb-12">
        <SwipeableTabView activeIndex={tabIndex} onChangeIndex={handleSwipe} tabKeys={TAB_KEYS}>
          <div>{loadedTabs.has('overview') && <ProgressOverview />}</div>
          <div>{loadedTabs.has('body') && <ProgressBody />}</div>
          <div>{loadedTabs.has('records') && <Suspense fallback={<Skeleton variant="card" count={4} />}><PersonalRecords embedded /></Suspense>}</div>
          <div>{loadedTabs.has('nutrition') && <Suspense fallback={<Skeleton variant="card" count={4} />}><Nutrition embedded /></Suspense>}</div>
        </SwipeableTabView>
      </div>
    </div>
  );
}
