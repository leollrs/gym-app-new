import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const SCORE_LABELS = {
  detractor: [0, 1, 2, 3, 4, 5, 6],
  passive: [7, 8],
  promoter: [9, 10],
};

const getScoreColor = (score, selected) => {
  if (selected === null) return 'bg-white/[0.06] border-white/10';
  if (score !== selected) return 'bg-white/[0.03] border-white/5 opacity-40';
  if (SCORE_LABELS.detractor.includes(score)) return 'bg-red-500/20 border-red-500/40 text-red-300';
  if (SCORE_LABELS.passive.includes(score)) return 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300';
  return 'bg-[#D4AF37]/20 border-[#D4AF37]/40 text-[#D4AF37]';
};

const NPSSurveyModal = () => {
  const { user, profile } = useAuth();
  const { t } = useTranslation('pages');
  const [score, setScore] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const gymId = profile?.gym_id;
  const userId = user?.id;

  // Query for active NPS survey the user hasn't responded to
  const { data: survey } = useQuery({
    queryKey: ['nps-survey', gymId, userId],
    queryFn: async () => {
      if (!gymId || !userId) return null;

      // Find active surveys for this gym
      const { data: surveys, error: sErr } = await supabase
        .from('nps_surveys')
        .select('id, title')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1);

      if (sErr || !surveys?.length) return null;
      const activeSurvey = surveys[0];

      // Check if user already responded
      const { data: existing } = await supabase
        .from('nps_responses')
        .select('id')
        .eq('survey_id', activeSurvey.id)
        .eq('profile_id', userId)
        .limit(1);

      if (existing?.length) return null;

      return activeSurvey;
    },
    enabled: !!gymId && !!userId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Check localStorage for dismissal
  const surveyId = survey?.id;
  const isDismissedLocally = surveyId
    ? localStorage.getItem(`nps_dismissed_${surveyId}`) === 'true'
    : false;

  const visible = !!survey && !isDismissedLocally && !dismissed && !submitted;

  // Lock body scroll when modal is visible
  useEffect(() => {
    if (visible) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [visible]);

  const handleSubmit = useCallback(async () => {
    if (score === null || !surveyId || !userId || !gymId) return;
    setSubmitting(true);
    try {
      await supabase.from('nps_responses').insert({
        survey_id: surveyId,
        profile_id: userId,
        gym_id: gymId,
        score,
        feedback: feedback.trim() || null,
      });
      localStorage.setItem(`nps_dismissed_${surveyId}`, 'true');
      setSubmitted(true);
    } catch {
      // Silently fail - non-critical feature
    } finally {
      setSubmitting(false);
    }
  }, [score, feedback, surveyId, userId, gymId]);

  const handleDismiss = useCallback(async () => {
    if (!surveyId || !userId || !gymId) return;
    localStorage.setItem(`nps_dismissed_${surveyId}`, 'true');
    // Record dismissal with score -1 so admin can track dismissal rate
    // NOTE: requires ALTER TABLE nps_responses DROP CONSTRAINT ..., ADD CHECK (score >= -1 AND score <= 10)
    try {
      await supabase.from('nps_responses').insert({
        survey_id: surveyId,
        profile_id: userId,
        gym_id: gymId,
        score: -1,
        feedback: null,
      });
    } catch {
      // Silently fail — constraint may reject score -1 until migration is updated
    }
    setDismissed(true);
  }, [surveyId, userId, gymId]);

  // Auto-close thank-you state after 2.5s
  useEffect(() => {
    if (submitted) {
      const timer = setTimeout(() => setDismissed(true), 2500);
      return () => clearTimeout(timer);
    }
  }, [submitted]);

  return (
    <AnimatePresence>
      {(visible || submitted) && !dismissed && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={!submitted ? handleDismiss : undefined}
          />

          {/* Modal */}
          <motion.div
            className="relative w-full max-w-md mx-4 mb-4 sm:mb-0 rounded-2xl border border-white/[0.08] overflow-hidden"
            style={{ backgroundColor: '#0F172A' }}
            initial={{ y: 40, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', damping: 28, stiffness: 350 }}
          >
            {!submitted ? (
              /* ── Survey Form ── */
              <div className="p-5 pb-6">
                {/* Close button */}
                <button
                  onClick={handleDismiss}
                  className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/[0.08] transition-colors"
                  aria-label="Close"
                >
                  <X size={16} className="text-white/40" />
                </button>

                {/* Title */}
                <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[#D4AF37] mb-1">
                  {t('nps.survey.label')}
                </p>
                <h2 className="text-[18px] font-bold text-white leading-snug pr-8">
                  {t('nps.survey.question')}
                </h2>

                {/* Score selector */}
                <div className="mt-5">
                  <div className="flex gap-[6px] justify-between">
                    {Array.from({ length: 11 }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setScore(i)}
                        className={`
                          w-full aspect-square max-w-[36px] rounded-xl border text-[13px] font-semibold
                          flex items-center justify-center transition-all duration-150
                          hover:scale-110 active:scale-95
                          ${getScoreColor(i, score)}
                        `}
                        aria-label={`${i}`}
                      >
                        {i}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between mt-2 px-0.5">
                    <span className="text-[10px] text-white/30">
                      {t('nps.survey.notLikely')}
                    </span>
                    <span className="text-[10px] text-white/30">
                      {t('nps.survey.veryLikely')}
                    </span>
                  </div>
                </div>

                {/* Feedback textarea */}
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder={t('nps.survey.feedbackPlaceholder')}
                  rows={2}
                  className="w-full mt-4 rounded-xl bg-white/[0.04] border border-white/[0.08] text-[13px] text-white placeholder-white/25 px-3.5 py-2.5 resize-none focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
                />

                {/* Action buttons */}
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={handleDismiss}
                    className="flex-1 h-11 rounded-xl border border-white/[0.1] text-[13px] font-medium text-white/50 hover:bg-white/[0.04] transition-colors"
                  >
                    {t('nps.survey.noThanks')}
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={score === null || submitting}
                    className="flex-1 h-11 rounded-xl text-[13px] font-semibold transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: score !== null ? '#D4AF37' : 'rgba(212,175,55,0.15)',
                      color: score !== null ? '#0F172A' : '#D4AF37',
                    }}
                  >
                    {submitting ? '...' : t('nps.survey.submit')}
                  </button>
                </div>
              </div>
            ) : (
              /* ── Thank-you state ── */
              <motion.div
                className="p-8 text-center"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              >
                <div className="w-16 h-16 rounded-full bg-[#D4AF37]/15 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 size={32} className="text-[#D4AF37]" />
                </div>
                <h2 className="text-[18px] font-bold text-white mb-1">
                  {t('nps.survey.thankYouTitle')}
                </h2>
                <p className="text-[13px] text-white/50">
                  {t('nps.survey.thankYouMessage')}
                </p>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default NPSSurveyModal;
