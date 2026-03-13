import React, { useState, useEffect } from 'react';
import { X, Bell, Flame, BarChart3, Users, Target } from 'lucide-react';

const PREFS_CONFIG = [
  {
    key: 'workout_reminders',
    label: 'Workout Reminders',
    description: 'Get reminded on your training days',
    icon: Bell,
  },
  {
    key: 'streak_alerts',
    label: 'Streak Alerts',
    description: 'Warnings when your streak is at risk',
    icon: Flame,
  },
  {
    key: 'weekly_summary',
    label: 'Weekly Summary',
    description: 'Sunday recap of your training week',
    icon: BarChart3,
  },
  {
    key: 'friend_activity',
    label: 'Friend Activity',
    description: 'When friends complete workouts',
    icon: Users,
  },
  {
    key: 'milestone_alerts',
    label: 'Milestone Alerts',
    description: 'Approaching workout and streak milestones',
    icon: Target,
  },
];

const DEFAULTS = {
  workout_reminders: true,
  streak_alerts: true,
  weekly_summary: true,
  friend_activity: true,
  milestone_alerts: true,
};

function loadPrefs(userId) {
  try {
    const stored = localStorage.getItem(`notification_prefs_${userId}`);
    return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function savePrefs(userId, prefs) {
  localStorage.setItem(`notification_prefs_${userId}`, JSON.stringify(prefs));
}

const NotificationPreferences = ({ isOpen, onClose, userId }) => {
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isOpen && userId) {
      setPrefs(loadPrefs(userId));
      setSaved(false);
    }
  }, [isOpen, userId]);

  if (!isOpen) return null;

  const handleToggle = (key) => {
    setPrefs(prev => ({ ...prev, [key]: !prev[key] }));
    setSaved(false);
  };

  const handleSave = () => {
    savePrefs(userId, prefs);
    setSaved(true);
    setTimeout(() => onClose(), 600);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="notif-prefs-title"
        className="bg-[#0F172A] border border-white/8 rounded-[14px] w-full max-w-md overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/8">
          <div className="flex items-center gap-2.5">
            <Bell size={20} className="text-[#D4AF37]" />
            <h2 id="notif-prefs-title" className="text-[17px] font-bold text-[#E5E7EB]">
              Notification Preferences
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
          >
            <X size={18} className="text-[#6B7280]" />
          </button>
        </div>

        {/* Toggles */}
        <div className="p-5 space-y-1">
          {PREFS_CONFIG.map(({ key, label, description, icon: Icon }) => (
            <div
              key={key}
              className="flex items-center justify-between py-3.5 px-1 rounded-lg"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 ${
                  prefs[key] ? 'bg-[#D4AF37]/15' : 'bg-white/5'
                } transition-colors`}>
                  <Icon size={18} className={prefs[key] ? 'text-[#D4AF37]' : 'text-[#6B7280]'} />
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-[#E5E7EB]">{label}</p>
                  <p className="text-[12px] text-[#6B7280] leading-tight">{description}</p>
                </div>
              </div>

              {/* Toggle switch */}
              <button
                onClick={() => handleToggle(key)}
                className={`relative w-11 h-6 rounded-full flex-shrink-0 ml-3 transition-colors duration-200 ${
                  prefs[key] ? 'bg-[#D4AF37]' : 'bg-white/10'
                }`}
                aria-label={`Toggle ${label}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    prefs[key] ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-1">
          <button
            onClick={handleSave}
            className={`w-full py-3 rounded-xl font-semibold text-[15px] transition-all duration-200 ${
              saved
                ? 'bg-[#10B981] text-white'
                : 'bg-[#D4AF37] text-[#05070B] hover:bg-[#C9A430] active:scale-[0.98]'
            }`}
          >
            {saved ? 'Saved!' : 'Save Preferences'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotificationPreferences;
