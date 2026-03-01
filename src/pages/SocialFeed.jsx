import React, { useState } from 'react';
import { recentActivity, currentUser } from '../mockDb';
import { Heart, MessageCircle, Share2, UserPlus } from 'lucide-react';

const SocialFeed = () => {
  const [activities, setActivities] = useState(
    recentActivity.map(a => ({ ...a, hasLiked: a.hasLiked ?? false }))
  );

  const handleToggleLike = (id) => {
    setActivities(prev =>
      prev.map(a => a.id === id
        ? { ...a, hasLiked: !a.hasLiked, likes: a.hasLiked ? a.likes - 1 : a.likes + 1 }
        : a
      )
    );
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 md:px-8 pt-8 md:pt-12 pb-28 md:pb-12 animate-fade-in">

      {/* Page header */}
      <header className="flex justify-between items-center mb-10">
        <div>
          <h1 className="text-[24px] font-bold text-[#E5E7EB]">Social</h1>
          <p className="text-[13px] text-[#6B7280] mt-1">What your gym is lifting.</p>
        </div>
        <button className="flex items-center gap-2 text-[13px] font-semibold text-[#E5E7EB] btn-secondary px-4 py-2.5 rounded-xl transition-colors cursor-pointer">
          <UserPlus size={14} /> Add Friend
        </button>
      </header>

      {/* Feed — narrower column for readability */}
      <div className="max-w-[680px] mx-auto flex flex-col gap-5">

        {/* Post composer */}
        <div className="bg-[#0F172A] rounded-[14px] border border-white/6 flex gap-4 items-center p-5">
          <img
            src={currentUser.avatarUrl}
            alt={currentUser.username}
            className="w-11 h-11 rounded-full flex-shrink-0 border border-white/8"
          />
          <div className="flex-1 bg-[#05070B] rounded-xl px-4 py-3 text-[14px] text-[#4B5563] cursor-text select-none border border-white/6">
            Share a PR, workout, or photo…
          </div>
        </div>

        {/* Activity posts */}
        {activities.map(activity => (
          <div
            key={activity.id}
            className="bg-[#0F172A] rounded-[14px] border border-white/6 hover:border-white/10 transition-colors overflow-hidden"
          >
            {/* Post header */}
            <div className="flex items-center gap-3.5 p-5 pb-4">
              <img
                src={activity.avatarUrl}
                alt={activity.username}
                className="w-11 h-11 rounded-full flex-shrink-0 border border-white/8"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-[#E5E7EB] leading-snug">
                  {activity.username}{' '}
                  <span className="text-[#9CA3AF] font-normal">{activity.action}</span>
                </p>
                <p className="text-[12px] text-[#6B7280] mt-0.5">{activity.time}</p>
              </div>
            </div>

            {/* Post body */}
            <div className="mx-5 mb-4 bg-[#05070B]/60 rounded-xl px-5 py-4 border-l-[3px] border-l-[#D4AF37]">
              <p
                className="text-[17px] font-bold text-[#E5E7EB] leading-snug"
                dangerouslySetInnerHTML={{
                  __html: activity.detail.replace(
                    /(\d+\s*lbs?(?:\s*x\s*\d+)?|\d+\s*x\s*\d+)/gi,
                    '<span style="color:#D4AF37">$1</span>'
                  )
                }}
              />
            </div>

            {/* Interaction footer */}
            <div className="flex items-center gap-5 px-5 py-3.5 border-t border-white/5">
              <button
                onClick={() => handleToggleLike(activity.id)}
                className={`flex items-center gap-1.5 text-[13px] font-medium transition-colors cursor-pointer ${
                  activity.hasLiked ? 'text-red-400' : 'text-[#6B7280] hover:text-[#E5E7EB]'
                }`}
              >
                <Heart size={15} fill={activity.hasLiked ? 'currentColor' : 'none'} />
                {activity.likes}
              </button>
              <button className="flex items-center gap-1.5 text-[13px] font-medium text-[#6B7280] hover:text-[#E5E7EB] transition-colors cursor-pointer">
                <MessageCircle size={15} />
                {activity.comments}
              </button>
              <button className="flex items-center gap-1.5 text-[13px] font-medium text-[#6B7280] hover:text-[#E5E7EB] transition-colors cursor-pointer ml-auto">
                <Share2 size={15} />
              </button>
            </div>
          </div>
        ))}

        <p className="text-center text-[12px] text-[#4B5563] py-6 tracking-wide">
          — You're all caught up —
        </p>
      </div>

    </div>
  );
};

export default SocialFeed;
