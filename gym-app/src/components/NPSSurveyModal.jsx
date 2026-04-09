import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const SCORE_LABELS = {
  detractor: [1, 2],
  passive: [3],
  promoter: [4, 5],
};

const getScoreStyle = (score, selected) => {
  if (selected === null) return {};
  if (score !== selected) return { opacity: 0.4 };
  if (SCORE_LABELS.detractor.includes(score)) return {};
  if (SCORE_LABELS.passive.includes(score)) return {};
  return { background: 'color-mix(in srgb, var(--color-accent) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--color-accent) 40%, transparent)', color: 'var(--color-accent)' };
};

const getScoreColor = (score, selected) => {
  if (selected === null) return 'border-white/10';
  if (score !== selected) return 'border-white/5';
  if (SCORE_LABELS.detractor.includes(score)) return 'bg-red-500/20 border-red-500/40 text-red-300';
  if (SCORE_LABELS.passive.includes(score)) return 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300';
  return '';
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
    // NOTE: requires ALTER TABLE nps_responses DROP CONSTRAINT ..., ADD CHECK (score >= -1 AND score <= 5)
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
          className="fixed inset-0 z-[9999] flex items-center justify-center px-4"
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
            className="relative w-full max-w-md rounded-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}
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
                  <X size={16} style={{ color: 'var(--color-text-muted)' }} />
                </button>

                {/* Title */}
                <p className="text-[13px] font-semibold uppercase tracking-[0.1em] mb-1" style={{ color: 'var(--color-accent)' }}>
                  {t('nps.survey.label')}
                </p>
                <h2 className="text-[18px] font-bold leading-snug pr-8" style={{ color: 'var(--color-text-primary)' }}>
                  {t('nps.survey.question')}
                </h2>

                {/* Score selector */}
                <div className="mt-5">
                  <div className="flex gap-3 justify-between">
                    {[1, 2, 3, 4, 5].map(i => (
                      <button
                        key={i}
                        onClick={() => setScore(i)}
                        className={`
                          w-full aspect-square min-w-[52px] min-h-[52px] rounded-2xl border text-[16px] font-bold
                          flex items-center justify-center transition-all duration-150
                          hover:scale-110 active:scale-95
                          ${getScoreColor(i, score)}
                        `}
                        style={getScoreStyle(i, score)}
                        aria-label={`${i}${i === 1 ? ' - Not at all likely' : i === 3 ? ' - Neutral' : i === 5 ? ' - Extremely likely' : ''}`}
                      >
                        {i}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between mt-2 px-0.5">
                    <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                      {t('nps.survey.notLikely')}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                      {t('nps.survey.veryLikely')}
                    </span>
                  </div>
                </div>

                {/* Feedback textarea */}
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder={t('nps.survey.feedbackPlaceholder')}
                  aria-label={t('nps.survey.feedbackPlaceholder')}
                  rows={2}
                  className="w-full mt-4 rounded-xl bg-white/[0.04] border border-white/[0.08] text-[13px] placeholder-white/25 px-3.5 py-2.5 resize-none focus:outline-none transition-colors"
                  style={{ color: 'var(--color-text-primary)' }}
                />

                {/* Action buttons */}
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={handleDismiss}
                    className="flex-1 h-11 rounded-xl border border-white/[0.1] text-[13px] font-medium hover:bg-white/[0.04] transition-colors"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {t('nps.survey.noThanks')}
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={score === null || submitting}
                    className="flex-1 h-11 rounded-xl text-[13px] font-semibold transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: score !== null ? 'var(--color-accent)' : 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
                      color: score !== null ? 'var(--color-bg-deep)' : 'var(--color-accent)',
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
                <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                  <CheckCircle2 size={32} style={{ color: 'var(--color-accent)' }} />
                </div>
                <h2 className="text-[18px] font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                  {t('nps.survey.thankYouTitle')}
                </h2>
                <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
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
