import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const STORAGE_KEY = 'gym_coach_marks_seen';

function getSeenMarks() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function markAsSeen(id) {
  const seen = getSeenMarks();
  if (!seen.includes(id)) {
    seen.push(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
  }
}

export default function CoachMark({ id, title, description, position = 'bottom', delay = 500, children }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const seen = getSeenMarks();
    if (seen.includes(id)) return;
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [id, delay]);

  const dismiss = () => {
    setVisible(false);
    markAsSeen(id);
  };

  const positionClasses = {
    top: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-2 left-1/2 -translate-x-1/2',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2',
    right: 'left-full ml-2 top-1/2 -translate-y-1/2',
  };

  const arrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#D4AF37]',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-[#D4AF37]',
    left: 'left-full top-1/2 -translate-y-1/2 border-t-[6px] border-b-[6px] border-l-[6px] border-t-transparent border-b-transparent border-l-[#D4AF37]',
    right: 'right-full top-1/2 -translate-y-1/2 border-t-[6px] border-b-[6px] border-r-[6px] border-t-transparent border-b-transparent border-r-[#D4AF37]',
  };

  return (
    <div className="relative w-full">
      {children}
      {visible && (
        <div className={`absolute z-[100] ${positionClasses[position]}`}>
          <div className="relative bg-[var(--color-bg-card)] border border-[#D4AF37]/30 rounded-xl px-4 py-3 shadow-xl shadow-black/40 w-[220px]">
            <div className={`absolute w-0 h-0 ${arrowClasses[position]}`} />
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                {title && <p className="text-[13px] font-bold text-[#D4AF37] mb-1">{title}</p>}
                <p className="text-[12px] text-[var(--color-text-muted)] leading-relaxed">{description}</p>
              </div>
              <button
                onClick={dismiss}
                className="flex-shrink-0 w-5 h-5 rounded-full bg-white/5 flex items-center justify-center text-[var(--color-text-subtle)] hover:text-white transition-colors"
                aria-label="Dismiss tip"
              >
                <X size={10} />
              </button>
            </div>
            <button
              onClick={dismiss}
              className="mt-2 text-[11px] font-semibold text-[#D4AF37] hover:text-[#f2d36b] transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
