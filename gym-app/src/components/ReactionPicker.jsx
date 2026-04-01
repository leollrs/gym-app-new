import { useState } from 'react';
import { Heart } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const LikeButton = ({ feedItemId, currentUserId, currentReaction, reactionCounts, onReact }) => {
  const { t } = useTranslation('pages');
  const isLiked = !!currentReaction;
  const totalCount = Object.values(reactionCounts ?? {}).reduce((s, n) => s + n, 0);

  const handleToggle = () => {
    onReact(feedItemId, 'strong'); // Use existing 'strong' type as the like
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={`flex items-center gap-1.5 text-[13px] font-semibold transition-colors select-none ${
        isLiked ? 'text-red-500' : 'text-[var(--color-text-muted,#6B7280)] hover:text-red-400'
      }`}
    >
      <Heart size={18} fill={isLiked ? 'currentColor' : 'none'} strokeWidth={isLiked ? 0 : 2} />
      {totalCount > 0 && <span className="tabular-nums">{totalCount}</span>}
    </button>
  );
};

export default LikeButton;
export const REACTIONS = [{ type: 'strong', emoji: '❤️', key: 'strong' }];
export const EMOJI_MAP = { strong: '❤️' };
export const DEFAULT_REACTION = 'strong';
