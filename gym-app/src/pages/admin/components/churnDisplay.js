/**
 * Display-config maps shared across the churn admin surfaces
 * (AdminChurn page + MemberDetailPanel + any future churn views).
 *
 * Kept separate from `lib/churn/` because these are UI labels + colors,
 * not domain logic. If the churn engine ever changes its outcome/method
 * enums, update this file in tandem.
 */

export const outcomeConfig = {
  returned:       { i18nKey: 'admin.churn.outcomeReturned', color: 'var(--color-success, #10B981)', bg: 'color-mix(in srgb, var(--color-success, #10B981) 12%, transparent)' },
  no_response:    { i18nKey: 'admin.churn.outcomeNoResponse', color: 'var(--color-text-secondary)', bg: 'color-mix(in srgb, var(--color-text-secondary) 8%, transparent)' },
  still_inactive: { i18nKey: 'admin.churn.outcomeStillInactive', color: 'var(--color-warning)', bg: 'var(--color-warning-soft)' },
  pending:        { i18nKey: 'admin.churn.outcomePending', color: 'var(--color-text-muted)', bg: 'color-mix(in srgb, var(--color-text-muted) 8%, transparent)' },
};

export const METHOD_I18N = {
  in_app_message: 'admin.churn.methodMessage',
  email: 'admin.churn.methodEmail',
  push: 'admin.churn.methodPush',
  win_back: 'admin.churn.methodWinBack',
  manual: 'admin.churn.methodManual',
};
