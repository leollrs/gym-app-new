import { useState } from 'react';
import { Users, Trophy } from 'lucide-react';
import SocialFeed from './SocialFeed';
import Challenges from './Challenges';
const TABS = [
  { key: 'feed', label: 'Feed', icon: Users },
  { key: 'challenges', label: 'Challenges', icon: Trophy },
];

export default function Community({ defaultTab = 'feed' }) {
  const [tab, setTab] = useState(defaultTab);
  return (
    <div className="min-h-screen bg-[#05070B] pb-28 md:pb-12">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-[#05070B]/95 backdrop-blur-2xl border-b border-white/6">
        <div className="max-w-2xl mx-auto px-4 pt-3 pb-3">
          {/* Title */}
          <h1 className="text-[22px] font-bold text-[#E5E7EB] tracking-tight mb-3">
            Community
          </h1>

          {/* Pill tabs */}
          <div className="flex gap-1 bg-[#111827] p-1 rounded-xl">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                  tab === t.key
                    ? 'bg-[#D4AF37] text-black'
                    : 'text-[#6B7280] hover:text-[#9CA3AF]'
                }`}
              >
                <t.icon size={15} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        {tab === 'feed' && <SocialFeed embedded />}
        {tab === 'challenges' && <Challenges embedded />}
      </div>
    </div>
  );
}
