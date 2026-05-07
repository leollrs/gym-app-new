// MyPlanModal.jsx
// -----------------------------------------------------------------------------
// Warm-paper redesign of the "My Plan" bottom sheet / centered card that opens
// from the Dashboard "My Plan ▾" chip. Matches the onboarding / ExerciseLibrary
// aesthetic:
//   • --color-bg-card background, 24px rounded top corners
//   • Archivo 900 28px title
//   • 18px rounded tiles, colored icon chips, active chip
//   • Warm shadow, Familjen Grotesk body
//   • Lucide icons, createPortal, body scroll lock, NO framer-motion
//
// All the heavy plan/schedule computation still lives in Dashboard.jsx — this
// component just renders whatever weekly breakdown was passed in, so the
// existing schedule_map logic (week1 / normal / last-week mapping, wrapped
// programs, mid-week starts, gym closure) is preserved 1:1.
// -----------------------------------------------------------------------------

import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  X, ChevronLeft, ChevronRight, ClipboardList, Lock, Dumbbell, Moon, ChevronDown, Check,
} from 'lucide-react';

const FONT_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const FONT_BODY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';

function WarmTile({ children, style, ...rest }) {
  return (
    <div
      {...rest}
      style={{
        borderRadius: 18,
        background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
        border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
        transition: 'background 160ms',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function ActiveChip({ label }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 1.2,
        padding: '4px 8px',
        borderRadius: 999,
        background: 'color-mix(in srgb, var(--color-accent, #2EC4C4) 14%, transparent)',
        color: 'var(--color-accent, #2EC4C4)',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  );
}

export default function MyPlanModal({
  open,
  onClose,
  // Program context
  activeProgram,        // { split_type, program_start, duration_weeks, schedule_map, expires_at, ... }
  programName,          // already-localized
  totalWeeks,
  weekNum,
  progress,             // 0-100
  // Week navigator
  planWeek,
  setPlanWeek,
  canPrev,
  canNext,
  // Per-day schedule (already resolved for planWeek)
  fullWeek,             // [{ label, name, exercises, isRest, isClosed, notStarted }]
  planSelectedDay,
  setPlanSelectedDay,
  exerciseNameMap,
  // Other programs / custom routines the user can switch to
  otherPrograms = [],   // [{ id, split_type, duration_weeks, days_per_week, name, icon, color, active }]
  onSelectProgram,      // (id) => void
  // CTAs
  onManagePrograms,
  onTrainOutsideGym,
}) {
  const { t } = useTranslation('pages');

  // Lock body scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const hasProgram = !!activeProgram;

  // Memoize accent so color-mix is cheap
  const accent = 'var(--color-accent, #2EC4C4)';

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('dashboard.myPlan', 'My Plan')}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(10,13,16,0.55)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mp-card"
        style={{
          width: '100%',
          maxWidth: 560,
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-bg-card, #FAFAF7)',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          boxShadow:
            '0 -12px 44px rgba(15,20,25,0.18), 0 -2px 8px rgba(15,20,25,0.08)',
          overflow: 'hidden',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Grip */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
          <div
            style={{
              width: 44,
              height: 4,
              borderRadius: 2,
              background: 'var(--color-border-subtle, rgba(15,20,25,0.12))',
            }}
          />
        </div>

        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '14px 20px 10px',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                color: accent,
                fontFamily: FONT_BODY,
              }}
            >
              {t('dashboard.myPlan', 'My Plan')}
            </div>
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 900,
                fontSize: 28,
                letterSpacing: -0.8,
                color: 'var(--color-text-primary)',
                lineHeight: 1.05,
                marginTop: 2,
              }}
            >
              {hasProgram
                ? (programName || t('dashboard.currentProgram', 'Current program'))
                : t('dashboard.pickAProgram', 'Pick a program')}
            </div>
            {hasProgram && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--color-text-muted)',
                  fontFamily: FONT_BODY,
                }}
              >
                {t('dashboard.weekXOfY', { current: weekNum, total: totalWeeks })}
                {' · '}
                {progress}%
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', 'Close')}
            style={{
              width: 40,
              height: 40,
              borderRadius: 14,
              border: 'none',
              background: 'var(--color-surface-hover, rgba(15,20,25,0.06))',
              color: 'var(--color-text-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Progress bar */}
        {hasProgram && (
          <div style={{ padding: '0 20px 14px' }}>
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: 'var(--color-surface-hover, rgba(15,20,25,0.06))',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: accent,
                  borderRadius: 3,
                  transition: 'width 240ms',
                }}
              />
            </div>
          </div>
        )}

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 20px' }}>
          {hasProgram && (
            <>
              {/* Week navigator */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <button
                  type="button"
                  onClick={() => canPrev && setPlanWeek(w => w - 1)}
                  disabled={!canPrev}
                  aria-label={t('myPlan.previousWeek', 'Previous week')}
                  style={{
                    width: 40, height: 40, borderRadius: 14,
                    border: 'none', cursor: canPrev ? 'pointer' : 'default',
                    background: canPrev
                      ? 'var(--color-surface-hover, rgba(15,20,25,0.06))'
                      : 'transparent',
                    color: canPrev ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    opacity: canPrev ? 1 : 0.4,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <ChevronLeft size={18} />
                </button>
                <div
                  style={{
                    fontFamily: FONT_BODY,
                    fontWeight: 800,
                    fontSize: 14,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {t('dashboard.weekLabel', { week: planWeek })}{' '}
                  <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>
                    {t('dashboard.ofTotal', { total: totalWeeks })}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => canNext && setPlanWeek(w => w + 1)}
                  disabled={!canNext}
                  aria-label={t('myPlan.nextWeek', 'Next week')}
                  style={{
                    width: 40, height: 40, borderRadius: 14,
                    border: 'none', cursor: canNext ? 'pointer' : 'default',
                    background: canNext
                      ? 'var(--color-surface-hover, rgba(15,20,25,0.06))'
                      : 'transparent',
                    color: canNext ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    opacity: canNext ? 1 : 0.4,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <ChevronRight size={18} />
                </button>
              </div>

              {/* Week days */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(fullWeek || []).map((day, i) => {
                  const isExpanded = planSelectedDay === i;
                  const tileClickable = !day.isRest && !day.isClosed;
                  const isDone = !!day.completed && !day.isRest && !day.isClosed;
                  const Icon = day.isClosed ? Lock : day.isRest ? Moon : isDone ? Check : Dumbbell;
                  const iconColor = day.isClosed
                    ? '#EF4444'
                    : day.isRest
                      ? 'var(--color-text-muted)'
                      : isDone
                        ? '#10B981'
                        : accent;
                  const iconBg = day.isClosed
                    ? 'color-mix(in srgb, #EF4444 12%, transparent)'
                    : day.isRest
                      ? 'var(--color-surface-hover, rgba(15,20,25,0.04))'
                      : isDone
                        ? 'rgba(16,185,129,0.16)'
                        : 'color-mix(in srgb, var(--color-accent, #2EC4C4) 14%, transparent)';
                  return (
                    <WarmTile
                      key={i}
                      style={{
                        background: isExpanded
                          ? 'var(--color-bg-deep, rgba(15,20,25,0.03))'
                          : undefined,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => tileClickable && setPlanSelectedDay(isExpanded ? null : i)}
                        disabled={!tileClickable && !day.isClosed}
                        style={{
                          width: '100%',
                          background: 'transparent',
                          border: 'none',
                          padding: '12px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          textAlign: 'left',
                          cursor: tileClickable ? 'pointer' : 'default',
                          fontFamily: FONT_BODY,
                          color: 'inherit',
                        }}
                      >
                        <div
                          style={{
                            width: 36, height: 36, borderRadius: 12,
                            background: iconBg,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <Icon size={16} style={{ color: iconColor }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: 800,
                                color: 'var(--color-text-primary)',
                              }}
                            >
                              {day.label}
                            </span>
                            {isDone && (
                              <span
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 3,
                                  padding: '2px 6px', borderRadius: 999,
                                  background: 'rgba(16,185,129,0.16)',
                                  border: '1px solid rgba(16,185,129,0.32)',
                                  color: '#10B981',
                                  fontSize: 9, fontWeight: 800,
                                  letterSpacing: 0.6, textTransform: 'uppercase',
                                }}
                              >
                                <Check size={9} strokeWidth={3.2} />
                                {t('dashboard.completed', 'Done')}
                              </span>
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--color-text-muted)',
                              marginTop: 1,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {day.isClosed
                              ? t('dashboard.gymClosed', 'Gym Closed')
                              : day.notStarted
                                ? t('dashboard.notYetStarted', 'Program not yet started')
                                : day.isRest
                                  ? t('dashboard.restDay', 'Rest day')
                                  : `${day.name} · ${day.exercises.length} ${t('dashboard.exercises', 'exercises')}`
                            }
                          </div>
                        </div>
                        {tileClickable && (
                          <ChevronRight
                            size={16}
                            style={{
                              color: 'var(--color-text-muted)',
                              transition: 'transform 160ms',
                              transform: isExpanded ? 'rotate(90deg)' : 'none',
                              flexShrink: 0,
                            }}
                          />
                        )}
                      </button>

                      {isExpanded && day.isClosed && (
                        <div
                          style={{
                            margin: '0 14px 12px',
                            padding: '10px 12px',
                            borderRadius: 14,
                            background: 'color-mix(in srgb, #EF4444 6%, transparent)',
                            border: '1px solid color-mix(in srgb, #EF4444 20%, transparent)',
                            textAlign: 'center',
                          }}
                        >
                          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
                            {t('dashboard.gymClosedMessage', 'The gym is closed today. Rest up and come back stronger!')}
                          </p>
                          {onTrainOutsideGym && (
                            <button
                              type="button"
                              onClick={onTrainOutsideGym}
                              style={{
                                marginTop: 8,
                                background: 'transparent',
                                border: 'none',
                                fontSize: 12,
                                fontWeight: 800,
                                color: accent,
                                cursor: 'pointer',
                              }}
                            >
                              {t('dashboard.trainOutsideGym', 'Want to train outside the gym?')}
                            </button>
                          )}
                        </div>
                      )}

                      {isExpanded && !day.isRest && !day.isClosed && (
                        <div
                          style={{
                            margin: '0 14px 12px',
                            padding: '10px 12px',
                            borderRadius: 14,
                            background: 'var(--color-bg-card, #FAFAF7)',
                            border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
                          }}
                        >
                          {(day.exercises || []).map((ex, ei) => (
                            <div
                              key={ei}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                padding: '4px 0',
                                fontSize: 12,
                                color: 'var(--color-text-muted)',
                              }}
                            >
                              <span>
                                <span style={{ marginRight: 6, color: 'var(--color-text-subtle)' }}>
                                  {ei + 1}.
                                </span>
                                {exerciseNameMap?.[ex.id] || ex.id}
                              </span>
                              <span style={{ fontWeight: 700 }}>
                                {ex.sets} {t('dashboard.sets', 'sets')}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </WarmTile>
                  );
                })}
              </div>
            </>
          )}

          {/* Program picker — alternative / custom programs */}
          {otherPrograms.length > 0 && (
            <div style={{ marginTop: hasProgram ? 22 : 4 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 1.2,
                  textTransform: 'uppercase',
                  color: 'var(--color-text-muted)',
                  marginBottom: 8,
                  fontFamily: FONT_BODY,
                }}
              >
                {t('dashboard.switchProgram', 'Switch program')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {otherPrograms.map((p) => {
                  const isActive = p.active;
                  const color = p.color || accent;
                  return (
                    <WarmTile key={p.id}>
                      <button
                        type="button"
                        onClick={() => onSelectProgram?.(p.id)}
                        style={{
                          width: '100%',
                          background: 'transparent',
                          border: 'none',
                          padding: '12px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontFamily: FONT_BODY,
                        }}
                      >
                        <div
                          style={{
                            width: 40, height: 40, borderRadius: 14,
                            background: `color-mix(in srgb, ${color} 14%, transparent)`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {p.icon ? (
                            <p.icon size={18} style={{ color }} />
                          ) : (
                            <ClipboardList size={18} style={{ color }} />
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 800,
                              color: 'var(--color-text-primary)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {p.name}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--color-text-muted)',
                              marginTop: 1,
                            }}
                          >
                            {p.duration_weeks
                              ? t('dashboard.nWeeksXDays', {
                                weeks: p.duration_weeks,
                                days: p.days_per_week,
                                defaultValue: '{{weeks}} weeks · {{days}} days/week',
                              })
                              : t('dashboard.customRoutine', 'Custom routine')}
                          </div>
                        </div>
                        {isActive && <ActiveChip label={t('myPlan.active', 'Active')} />}
                      </button>
                    </WarmTile>
                  );
                })}
              </div>
            </div>
          )}

          {!hasProgram && otherPrograms.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 8px' }}>
              <ClipboardList
                size={40}
                style={{ color: 'var(--color-text-muted)', margin: '0 auto' }}
              />
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 18,
                  fontWeight: 900,
                  color: 'var(--color-text-primary)',
                  marginTop: 12,
                }}
              >
                {t('dashboard.noActiveProgram', 'No active program')}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--color-text-muted)',
                  marginTop: 4,
                  fontFamily: FONT_BODY,
                }}
              >
                {t('dashboard.startProgramHint', 'Pick a program to start training.')}
              </div>
            </div>
          )}
        </div>

        {/* Footer CTA */}
        <div
          style={{
            borderTop: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
            padding: '12px 20px 18px',
            background: 'var(--color-bg-card, #FAFAF7)',
          }}
        >
          <button
            type="button"
            onClick={onManagePrograms}
            style={{
              width: '100%',
              height: 52,
              borderRadius: 16,
              border: 'none',
              cursor: 'pointer',
              background: accent,
              color: 'var(--color-bg-card, #0A0D10)',
              fontFamily: FONT_BODY,
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: 0.1,
              boxShadow: '0 6px 18px color-mix(in srgb, var(--color-accent, #2EC4C4) 30%, transparent)',
            }}
          >
            {hasProgram
              ? t('dashboard.managePrograms', 'Manage programs')
              : t('dashboard.browsePrograms', 'Browse programs')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
