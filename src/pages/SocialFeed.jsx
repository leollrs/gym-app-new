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
    <div className="container main-content animate-fade-in pb-24 md:pb-8">

      {/* Header */}
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-[26px] font-bold text-white mb-0.5">Social</h1>
          <p className="text-[14px] text-slate-400">What your gym friends are lifting.</p>
        </div>
        <button className="flex items-center gap-2 text-[13px] font-semibold text-white bg-white/6 hover:bg-white/10 border border-white/8 px-3.5 py-2 rounded-xl transition-colors cursor-pointer">
          <UserPlus size={15} /> Add Friend
        </button>
      </header>

      <div className="max-w-xl mx-auto flex flex-col gap-4">

        {/* Post composer (static preview) */}
        <div className="bg-[#1C2333]/80 backdrop-blur-md rounded-2xl border border-white/5 flex gap-3 items-center p-4">
          <img
            src={currentUser.avatarUrl}
            alt={currentUser.username}
            className="w-9 h-9 rounded-full flex-shrink-0"
          />
          <div className="flex-1 bg-black/30 rounded-xl px-4 py-2.5 text-[14px] text-slate-500 cursor-text select-none">
            Share a PR, workout, or photo…
          </div>
        </div>

        {/* Activity posts */}
        {activities.map(activity => (
          <div key={activity.id} className="bg-[#1C2333]/80 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden">

            {/* Post header */}
            <div className="flex items-center gap-3 p-4 pb-3">
              <img
                src={activity.avatarUrl}
                alt={activity.username}
                className="w-10 h-10 rounded-full flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-white">
                  {activity.username}{' '}
                  <span className="text-slate-400 font-normal">{activity.action}</span>
                </p>
                <p className="text-[12px] text-slate-500 mt-0.5">{activity.time}</p>
              </div>
            </div>

            {/* Post body */}
            <div className="mx-4 mb-3 bg-black/25 rounded-xl px-4 py-3 border-l-4 border-blue-500">
              <p className="text-[18px] font-bold text-white">{activity.detail}</p>
            </div>

            {/* Interaction footer */}
            <div className="flex items-center gap-5 px-4 py-3 border-t border-white/5">
              <button
                onClick={() => handleToggleLike(activity.id)}
                className={`flex items-center gap-1.5 text-[13px] font-medium transition-colors cursor-pointer ${
                  activity.hasLiked ? 'text-red-400' : 'text-slate-500 hover:text-white'
                }`}
              >
                <Heart size={16} fill={activity.hasLiked ? 'currentColor' : 'none'} />
                {activity.likes}
              </button>
              <button className="flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-white transition-colors cursor-pointer">
                <MessageCircle size={16} />
                {activity.comments}
              </button>
              <button className="flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-white transition-colors cursor-pointer ml-auto">
                <Share2 size={16} />
              </button>
            </div>
          </div>
        ))}

        <p className="text-center text-[13px] text-slate-600 py-6">You're all caught up!</p>
      </div>
    </div>
  );
};

export default SocialFeed;
