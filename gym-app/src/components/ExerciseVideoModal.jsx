import React, { useEffect, useState } from 'react';
import { X, Info, ExternalLink, Play } from 'lucide-react';

function getYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/[?&]v=([^&]+)/);
  return match ? match[1] : null;
}

export default function ExerciseVideoModal({ exerciseName, demoUrl, instructions, onClose }) {
  const [loaded, setLoaded] = useState(false);
  const videoId = getYouTubeId(demoUrl);
  const embedUrl = videoId
    ? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`
    : null;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

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

        {/* Video embed */}
        {embedUrl ? (
          <div className="mx-5 mb-4 rounded-2xl overflow-hidden bg-black relative" style={{ aspectRatio: '16/9' }}>
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#0A0D14]">
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(212,175,55,0.15)' }}>
                  <Play size={20} fill="#D4AF37" strokeWidth={0} style={{ color: '#D4AF37' }} />
                </div>
              </div>
            )}
            <iframe
              src={embedUrl}
              title={`${exerciseName} demo`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              onLoad={() => setLoaded(true)}
              className="w-full h-full border-0"
            />
          </div>
        ) : (
          /* Fallback: open YouTube search if no direct video ID */
          <div className="px-5 pb-4">
            <a
              href={demoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 w-full py-4 rounded-2xl font-bold text-[15px] transition-all active:scale-95"
              style={{
                background: 'linear-gradient(135deg, #FF0000 0%, #CC0000 100%)',
                color: '#fff',
                boxShadow: '0 4px 20px rgba(255, 0, 0, 0.3)',
              }}
            >
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                <Play size={16} fill="white" strokeWidth={0} />
              </div>
              Watch on YouTube
              <ExternalLink size={14} className="opacity-70" />
            </a>
          </div>
        )}

        {/* Open in YouTube link (when embedded) */}
        {embedUrl && (
          <div className="px-5 pb-3 flex justify-end">
            <a
              href={demoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] text-[#6B7280] hover:text-[#9CA3AF] transition-colors"
            >
              <ExternalLink size={11} />
              Open in YouTube
            </a>
          </div>
        )}

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
