import React, { useEffect, useState } from 'react';
import { X, Info, Loader } from 'lucide-react';

const EXERCISEDB_BASE = 'https://www.exercisedb.dev/api/v1';

export default function ExerciseVideoModal({ exerciseName, instructions, onClose }) {
  const [gifUrl, setGifUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    if (!exerciseName) return;
    setLoading(true);
    setError(false);
    setGifUrl(null);

    fetch(`${EXERCISEDB_BASE}/exercises/search?q=${encodeURIComponent(exerciseName)}&limit=1`)
      .then(r => r.json())
      .then(data => {
        const exercise = Array.isArray(data) ? data[0] : data?.exercises?.[0] ?? data?.data?.[0];
        if (exercise?.gifUrl) {
          setGifUrl(exercise.gifUrl);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [exerciseName]);

  return (
    <div
      className="fixed inset-0 z-[160] flex items-end justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-t-3xl bg-[#0F172A] border-t border-x border-white/8 shadow-2xl animate-fade-in">

        {/* Drag handle */}
        <div className="w-10 h-1 rounded-full mx-auto mt-3 mb-0 bg-white/20" />

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-4 pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[#6B7280] mb-0.5">
              Exercise Demo
            </p>
            <h3 className="font-bold text-[18px] leading-tight text-[#E5E7EB]">
              {exerciseName}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center mt-0.5 bg-white/8 hover:bg-white/12 transition-colors text-[#9CA3AF]"
          >
            <X size={16} />
          </button>
        </div>

        {/* GIF area */}
        <div className="mx-5 mb-4 rounded-2xl overflow-hidden bg-[#0A0D14] flex items-center justify-center" style={{ aspectRatio: '1/1', maxHeight: 300 }}>
          {loading && (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader size={28} className="text-[#D4AF37] animate-spin" />
              <span className="text-[12px] text-[#6B7280]">Loading demo…</span>
            </div>
          )}
          {!loading && gifUrl && (
            <img
              src={gifUrl}
              alt={`${exerciseName} demonstration`}
              className="w-full h-full object-contain"
            />
          )}
          {!loading && error && (
            <div className="flex flex-col items-center gap-2 py-12 px-6 text-center">
              <span className="text-[13px] text-[#6B7280]">No demo available for this exercise</span>
            </div>
          )}
        </div>

        {/* Form cues */}
        {instructions && (
          <div className="px-5 pb-8">
            <div className="bg-[#111827] rounded-[14px] border border-white/8 p-4">
              <div className="flex items-center gap-2 mb-2.5">
                <div
                  className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(212,175,55,0.15)' }}
                >
                  <Info size={11} style={{ color: '#D4AF37' }} />
                </div>
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#D4AF37]">
                  Form Cues
                </span>
              </div>
              <p className="text-[13px] leading-relaxed text-[#9CA3AF]">
                {instructions}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
