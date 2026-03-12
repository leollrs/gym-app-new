// ── PointsBadge — compact inline points + tier indicator ─────────────────────
// Place in Navigation or Profile. Clicking navigates to /rewards.
// Props: { points, tier } — or fetches internally if not provided.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coins } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUserPoints, getRewardTier } from '../lib/rewardsEngine';

export default function PointsBadge({ points: propPoints, tier: propTier }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [pts, setPts] = useState(propPoints ?? null);
  const [tierInfo, setTierInfo] = useState(propTier ?? null);

  useEffect(() => {
    if (propPoints !== undefined && propPoints !== null) {
      setPts(propPoints);
      setTierInfo(propTier ?? getRewardTier(propPoints));
      return;
    }
    if (!user?.id) return;

    getUserPoints(user.id).then((data) => {
      const total = data?.total_points ?? 0;
      setPts(total);
      setTierInfo(getRewardTier(total));
    });
  }, [user?.id, propPoints, propTier]);

  if (pts === null) return null;

  const color = tierInfo?.color ?? '#CD7F32';

  return (
    <button
      type="button"
      onClick={() => navigate('/rewards')}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/8 transition-colors"
      aria-label="View rewards"
    >
      <Coins size={14} className="text-[#D4AF37] flex-shrink-0" />
      <span className="text-[12px] font-bold text-[#E5E7EB] tabular-nums">
        {pts.toLocaleString()}
      </span>
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
      />
    </button>
  );
}
