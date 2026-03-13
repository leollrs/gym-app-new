import { useState } from 'react';
import SwipeableTabView from '../components/SwipeableTabView';
import UnderlineTabs from '../components/UnderlineTabs';
import ProgressOverview from './progress/ProgressOverview';
import ProgressHistory from './progress/ProgressHistory';
import ProgressStrength from './progress/ProgressStrength';
import ProgressBody from './progress/ProgressBody';

const TABS = ['Overview', 'History', 'Strength', 'Body'];

export default function Progress() {
  const [activeTab, setActiveTab] = useState('Overview');
  const [loadedTabs, setLoadedTabs] = useState(new Set(['Overview']));

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setLoadedTabs(prev => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  };

  const tabIndex = TABS.indexOf(activeTab);
  const handleSwipe = (i) => handleTabChange(TABS[i]);

  return (
    <div className="min-h-screen bg-[#05070B]">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 backdrop-blur-2xl bg-[#05070B]/95 border-b border-white/6">
        <div className="max-w-[720px] md:max-w-5xl mx-auto px-4 md:px-6 pt-3 pb-3">
          <h1
            className="text-[22px] font-black text-[#E5E7EB] mb-3"
            style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
          >
            Progress
          </h1>

          {/* Tab bar */}
          <UnderlineTabs
            tabs={TABS.map(t => ({ key: t, label: t }))}
            activeIndex={tabIndex}
            onChange={handleSwipe}
          />
        </div>
      </div>

      {/* Tab content (swipeable) */}
      <div className="max-w-[720px] md:max-w-5xl mx-auto px-4 md:px-6 pt-5 pb-28 md:pb-12">
        <SwipeableTabView activeIndex={tabIndex} onChangeIndex={handleSwipe} tabKeys={TABS}>
          <div>{loadedTabs.has('Overview') && <ProgressOverview />}</div>
          <div>{loadedTabs.has('History') && <ProgressHistory />}</div>
          <div>{loadedTabs.has('Strength') && <ProgressStrength />}</div>
          <div>{loadedTabs.has('Body') && <ProgressBody />}</div>
        </SwipeableTabView>
      </div>
    </div>
  );
}
