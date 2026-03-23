import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Dumbbell, MinusCircle } from 'lucide-react';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const RoutinePickerModal = ({ open, onClose, dayOfWeek, routines = [], currentRoutineId, onSelect, onClear }) => {
  if (!open) return null;

  const dayName = DAY_NAMES[dayOfWeek] ?? '';

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Bottom sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-[61] max-h-[75vh] flex flex-col rounded-t-3xl bg-[#0F172A] border-t border-white/[0.08]"
            style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/[0.15]" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-wider">
                  Assign Workout
                </p>
                <p className="text-[18px] font-bold text-[#E5E7EB] mt-0.5">
                  {dayName}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center"
                aria-label="Close"
              >
                <X size={16} className="text-[#6B7280]" />
              </button>
            </div>

            {/* Routine list */}
            <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2">
              {routines.length === 0 ? (
                <div className="text-center py-8">
                  <Dumbbell size={32} className="mx-auto text-[#4B5563] mb-3" />
                  <p className="text-[14px] font-semibold text-[#E5E7EB]">No routines available</p>
                  <p className="text-[12px] text-[#6B7280] mt-1">
                    Generate a program or create a routine first.
                  </p>
                </div>
              ) : (
                <>
                  {routines.map(r => {
                    const isSelected = r.id === currentRoutineId;
                    const label = r.name.replace('Auto: ', '').replace(/ [AB]$/, '');
                    const exerciseCount = r.routine_exercises?.length ?? r.exerciseCount ?? 0;

                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => { onSelect(r.id); onClose(); }}
                        className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition-all text-left active:scale-[0.98] ${
                          isSelected
                            ? 'bg-[#D4AF37]/[0.08] border-[#D4AF37]/25'
                            : 'bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]'
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          isSelected ? 'bg-[#D4AF37]/15' : 'bg-white/[0.04]'
                        }`}>
                          <Dumbbell size={16} className={isSelected ? 'text-[#D4AF37]' : 'text-[#6B7280]'} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[14px] font-semibold truncate ${
                            isSelected ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'
                          }`}>
                            {label}
                          </p>
                          <p className="text-[11px] text-[#6B7280]">
                            {exerciseCount} exercises
                          </p>
                        </div>
                        {isSelected && (
                          <span className="text-[10px] font-bold text-[#D4AF37] uppercase tracking-wider shrink-0">
                            Current
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {/* Clear / rest day option */}
                  {currentRoutineId && (
                    <button
                      type="button"
                      onClick={() => { onClear(); onClose(); }}
                      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:border-red-500/20 transition-all text-left active:scale-[0.98] mt-1"
                    >
                      <div className="w-10 h-10 rounded-xl bg-red-500/[0.08] flex items-center justify-center shrink-0">
                        <MinusCircle size={16} className="text-red-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-red-400">
                          Rest Day
                        </p>
                        <p className="text-[11px] text-[#6B7280]">
                          Remove workout from {dayName}
                        </p>
                      </div>
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default RoutinePickerModal;
