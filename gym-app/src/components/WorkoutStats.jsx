import React from 'react';
import { Zap, Clock, Flame } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const stats = [
  { icon: Zap, color: '#FBBF24', key: 'exercises' },
  { icon: Clock, color: '#60A5FA', key: 'duration' },
  { icon: Flame, color: '#F97316', key: 'calories' },
];

const WorkoutStats = ({ exerciseCount = 0, durationMin = 0, calories = 0 }) => {
  const { t } = useTranslation('pages');
  const values = {
    exercises: t('workoutStats.exercises', { count: exerciseCount, defaultValue: '{{count}} Exercise', defaultValue_plural: '{{count}} Exercises' }),
    duration: t('workoutStats.duration', { count: durationMin, defaultValue: '{{count}} Min' }),
    calories: t('workoutStats.calories', { count: calories, defaultValue: '{{count}} Cal' }),
  };

  return (
    <div className="flex items-center gap-3">
      {stats.map(({ icon: Icon, color, key }) => (
        <div
          key={key}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06]"
        >
          <Icon size={14} style={{ color }} strokeWidth={2.5} />
          <span className="text-[12px] font-semibold text-[#CBD5E1]">
            {values[key]}
          </span>
        </div>
      ))}
    </div>
  );
};

export default WorkoutStats;
