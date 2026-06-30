import { useState, useEffect, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import SwipeableTabView from '../components/SwipeableTabView';
import UnderlineTabs from '../components/UnderlineTabs';
import ProgressOverview from './progress/ProgressOverview';
import ProgressBody from './progress/ProgressBody';
import Skeleton from '../components/Skeleton';

// Preload sub-tab chunks so switching tabs is instant
const personalRecordsImport = () => import('./PersonalRecords');
const nutritionImport = () => import('./Nutrition');
if (typeof window !== 'undefined') {
  setTimeout(() => { personalRecordsImport(); nutritionImport(); }, 1000);
}
const PersonalRecords = lazy(personalRecordsImport);
const Nutrition = lazy(nutritionImport);

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

  useEffect(() => {
    const prev = document.title;
    document.title = `${t('progress.title', 'Progress')} | ${window.__APP_NAME || 'TuGymPR'}`;
    return () => { document.title = prev; };
  }, [t]);

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
      <div className="sticky top-0 z-30 backdrop-blur-2xl" style={{ backgroundColor: 'color-mix(in srgb, var(--color-bg-primary) 95%, transparent)' }}>
        <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 md:px-6 pt-3" data-tour="tour-progress-page">
          <h1
            className="mb-3 truncate"
            style={{ fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontSize: 28, fontWeight: 800, letterSpacing: -1, lineHeight: 1.2, paddingBottom: 2, color: 'var(--color-text-primary)' }}
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
      <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 md:px-6 pt-5 pb-28 md:pb-12">
        <SwipeableTabView activeIndex={tabIndex} onChangeIndex={handleSwipe} tabKeys={TAB_KEYS}>
          {/*
            Each tab, once loaded, stays mounted for the lifetime of the Progress
            page. Keeping them mounted preserves their React state + in-flight
            queries so switching tabs doesn't re-trigger loading skeletons.
            SwipeableTabView already hides inactive panels via visibility:hidden,
            so there's no visual bleed.
          */}
          <div>{loadedTabs.has('overview') ? <ProgressOverview /> : null}</div>
          <div>{loadedTabs.has('body') ? <ProgressBody /> : null}</div>
          <div>{loadedTabs.has('records') ? <Suspense fallback={<Skeleton variant="card" count={4} />}><PersonalRecords embedded /></Suspense> : null}</div>
          <div>{loadedTabs.has('nutrition') ? <Suspense fallback={<Skeleton variant="card" count={4} />}><Nutrition embedded /></Suspense> : null}</div>
        </SwipeableTabView>
      </div>
    </div>
  );
}
