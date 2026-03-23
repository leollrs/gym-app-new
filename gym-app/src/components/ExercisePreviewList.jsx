import React from 'react';
import { motion } from 'framer-motion';
import { Dumbbell } from 'lucide-react';

const ExercisePreviewList = ({ exercises = [], maxVisible = 3 }) => {
  const visible = exercises.slice(0, maxVisible);
  const remaining = exercises.length - maxVisible;

  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider px-1">
        Up Next
      </p>
      <div className="space-y-1.5">
        {visible.map((ex, i) => (
          <motion.div
            key={ex.id || i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.3 }}
            className="flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-[#0F172A] border border-white/[0.06] hover:border-white/[0.1] transition-colors"
          >
            {/* Thumbnail: video > image > icon fallback */}
            <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0 overflow-hidden">
              {ex.thumbnail ? (
                <video
                  src={ex.thumbnail}
                  muted
                  playsInline
                  autoPlay
                  loop
                  className="w-full h-full object-cover"
                />
              ) : (
                <Dumbbell size={16} className="text-[#4B5563]" />
              )}
            </div>

            {/* Exercise info */}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">
                {ex.name}
              </p>
              <p className="text-[11px] text-[#6B7280]">
                {ex.sets} x {ex.reps}
                {ex.weight ? ` · ${ex.weight} lbs` : ''}
              </p>
            </div>

            {/* Position number */}
            <span className="text-[11px] font-bold text-[#4B5563] w-5 text-center shrink-0">
              {i + 2}
            </span>
          </motion.div>
        ))}
      </div>

      {remaining > 0 && (
        <p className="text-[11px] text-[#4B5563] text-center pt-1">
          +{remaining} more exercise{remaining !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
};

export default ExercisePreviewList;
