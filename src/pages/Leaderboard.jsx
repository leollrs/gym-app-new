import React from 'react';
import { Link } from 'react-router-dom';
import { Trophy, ArrowLeft, Hammer } from 'lucide-react';

const Leaderboard = () => (
  <div className="mx-auto w-full max-w-[1200px] px-5 md:px-8 pt-8 md:pt-12 pb-28 md:pb-12 animate-fade-in">

    <header className="mb-8">
      <h1 className="text-[24px] font-bold" style={{ color: 'var(--text-primary)', fontFamily: "'Barlow Condensed', sans-serif" }}>
        Leaderboard
      </h1>
    </header>

    <div className="max-w-[480px] mx-auto text-center py-20">
      <div className="relative inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-6"
        style={{ background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.2)' }}>
        <Trophy size={36} style={{ color: 'var(--accent-gold)', opacity: 0.5 }} />
        <span className="absolute -bottom-2 -right-2 text-[20px]">🔨</span>
      </div>

      <h2 className="text-[22px] font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
        Coming Soon
      </h2>
      <p className="text-[14px] leading-relaxed mb-8" style={{ color: 'var(--text-muted)' }}>
        Leaderboards are in development. Soon you'll be able to compete with your gym on volume, streaks, PRs, and more.
      </p>

      <Link
        to="/"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] font-semibold active:scale-95 transition-all"
        style={{ background: 'var(--accent-gold)', color: '#000' }}
      >
        <ArrowLeft size={15} /> Back to Dashboard
      </Link>
    </div>
  </div>
);

export default Leaderboard;
