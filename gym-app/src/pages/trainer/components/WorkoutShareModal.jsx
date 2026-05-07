import React, { useEffect, useMemo, useState } from 'react';
import { X, Dumbbell, Search, Send } from 'lucide-react';
// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { supabase } from '../../../lib/supabase';
import logger from '../../../lib/logger';
import useFocusTrap from '../../../hooks/useFocusTrap';

/**
 * Picker that lists the trainer's `trainer_workout_plans` so they can drop a
 * workout reference token into the chat. The send token format is:
 *
 *     [workout:{plan_id}:{day_index}]
 *
 * which the chat bubble renderer parses back into a card.
 *
 * Props:
 *   open, onClose
 *   trainerId      — trainer profile id (used to query their plans)
 *   onShare(text)  — fired with the token + a friendly preface
 *   t              — translation fn (pages namespace)
 */
export default function WorkoutShareModal({ open, onClose, trainerId, onShare, t }) {
  const focusRef = useFocusTrap(open, onClose);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null); // { plan, dayIndex }

  useEffect(() => {
    if (!open || !trainerId) return undefined;
    let cancelled = false;
    setLoading(true);
    setSelected(null);
    setQuery('');

    (async () => {
      try {
        const { data, error } = await supabase
          .from('trainer_workout_plans')
          .select('id, name, description, duration_weeks, weeks, client_id')
          .eq('trainer_id', trainerId)
          .eq('is_active', true)
          .order('updated_at', { ascending: false });
        if (error) throw error;
        if (!cancelled) setPlans(data || []);
      } catch (err) {
        logger.error('WorkoutShareModal: failed to load plans', err);
        if (!cancelled) setPlans([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, trainerId]);

  // Lock scroll
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return plans;
    return plans.filter(p => (p.name || '').toLowerCase().includes(q));
  }, [plans, query]);

  if (!open) return null;

  const planDayCount = (plan) => {
    try {
      const wk = plan?.weeks?.['1'];
      if (Array.isArray(wk)) return wk.length;
    } catch { /* ignore */ }
    return plan?.duration_weeks ? null : 0;
  };

  const dayLabel = (plan, idx) => {
    try {
      const day = plan?.weeks?.['1']?.[idx];
      if (day?.name) return day.name;
    } catch { /* ignore */ }
    return t('trainerMessages.share.dayN', { n: idx + 1, defaultValue: 'Day {{n}}' });
  };

  const handleSend = () => {
    if (!selected) return;
    const { plan, dayIndex } = selected;
    const planName = plan.name || t('trainerMessages.share.untitledPlan', 'Untitled plan');
    const dName = dayLabel(plan, dayIndex);
    const preface = t('trainerMessages.share.sentPreface', { plan: planName, day: dName, defaultValue: 'Shared:' });
    const token = `[workout:${plan.id}:${dayIndex}]`;
    onShare(`${preface}\n${token}`);
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-0 sm:px-4 backdrop-blur-sm"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <motion.div
        ref={focusRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workout-share-title"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[90vh] flex flex-col overflow-hidden rounded-3xl sm:rounded-3xl"
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}
            >
              <Dumbbell size={16} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div>
              <h3 id="workout-share-title" className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {t('trainerMessages.share.title', 'Share workout')}
              </h3>
              <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{t('trainerMessages.share.subtitle', 'Pick a plan to share with your client')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label={t('trainerMessages.share.close', 'Close')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-3">
          <div
            className="flex items-center gap-2 px-3 rounded-xl"
            style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))', border: '1px solid var(--color-border-subtle)' }}
          >
            <Search size={14} style={{ color: 'var(--color-text-muted)' }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('trainerMessages.share.searchPlaceholder', 'Search plans…')}
              maxLength={100}
              className="flex-1 bg-transparent outline-none text-[13px] py-2.5"
              style={{ color: 'var(--color-text-primary)' }}
            />
          </div>
        </div>

        {/* Plan list */}
        <div className="overflow-y-auto px-3 py-3 flex-1">
          {loading && (
            <div className="space-y-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }} />
              ))}
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <p className="text-center text-[13px] py-8" style={{ color: 'var(--color-text-muted)' }}>
              {t('trainerMessages.share.empty', 'No plans yet')}
            </p>
          )}
          {!loading && filtered.map((plan) => {
            const dayCount = planDayCount(plan);
            const days = plan?.weeks?.['1'];
            const isExpanded = selected?.plan?.id === plan.id;
            return (
              <div
                key={plan.id}
                className="rounded-xl mb-2 overflow-hidden"
                style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))', border: '1px solid var(--color-border-subtle)' }}
              >
                <button
                  type="button"
                  onClick={() => setSelected(isExpanded ? null : { plan, dayIndex: 0 })}
                  className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 min-h-[56px]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{plan.name}</p>
                    <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {plan.duration_weeks
                        ? t('trainerMessages.share.weeksAndDays', { weeks: plan.duration_weeks, days: dayCount || 0, defaultValue: '{{weeks}} weeks · {{days}} days/week' })
                        : t('trainerMessages.share.daysOnly', { days: dayCount || 0, defaultValue: '{{days}} days' })}
                    </p>
                  </div>
                  <span className="text-[11px] font-bold" style={{ color: 'var(--color-accent)' }}>
                    {isExpanded ? t('trainerMessages.share.collapse', 'Collapse') : t('trainerMessages.share.pickDay', 'Pick a day')}
                  </span>
                </button>
                {isExpanded && Array.isArray(days) && days.length > 0 && (
                  <div className="px-3 pb-3 grid grid-cols-2 gap-2">
                    {days.map((d, idx) => {
                      const isPicked = selected?.plan?.id === plan.id && selected?.dayIndex === idx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setSelected({ plan, dayIndex: idx })}
                          className="min-h-[44px] rounded-lg px-3 py-2 text-left transition-colors"
                          style={{
                            background: isPicked
                              ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)'
                              : 'var(--color-bg-card)',
                            border: '1px solid',
                            borderColor: isPicked ? 'var(--color-accent)' : 'var(--color-border-subtle)',
                            color: 'var(--color-text-primary)',
                          }}
                        >
                          <p className="text-[12px] font-bold truncate">{dayLabel(plan, idx)}</p>
                          <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                            {t('trainerMessages.share.exerciseCount', { count: Array.isArray(d?.exercises) ? d.exercises.length : 0, defaultValue: '{{count}} exercises' })}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Send footer */}
        <div className="px-3 py-3" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
          <button
            type="button"
            onClick={handleSend}
            disabled={!selected}
            className="w-full min-h-[48px] rounded-xl flex items-center justify-center gap-2 text-[14px] font-bold disabled:opacity-50"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
          >
            <Send size={15} />
            {t('trainerMessages.share.sendBtn', 'Send')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
