/**
 * Structured query key factory for admin data.
 * Ensures consistent cache keys across all admin pages.
 */
export const adminKeys = {
  all: ['admin'],

  overview: (gymId) => ['admin', 'overview', gymId],

  members: {
    all: (gymId) => ['admin', 'members', gymId],
    list: (gymId, filters) => ['admin', 'members', gymId, 'list', filters],
    detail: (gymId, memberId) => ['admin', 'members', gymId, 'detail', memberId],
  },

  churn: {
    all: (gymId) => ['admin', 'churn', gymId],
    scores: (gymId) => ['admin', 'churn', gymId, 'scores'],
    campaigns: (gymId) => ['admin', 'churn', gymId, 'campaigns'],
  },

  analytics: {
    all: (gymId) => ['admin', 'analytics', gymId],
    growth: (gymId) => ['admin', 'analytics', gymId, 'growth'],
    retention: (gymId) => ['admin', 'analytics', gymId, 'retention'],
    activity: (gymId) => ['admin', 'analytics', gymId, 'activity'],
    cohort: (gymId) => ['admin', 'analytics', gymId, 'cohort'],
    challenges: (gymId) => ['admin', 'analytics', gymId, 'challenges'],
    onboarding: (gymId) => ['admin', 'analytics', gymId, 'onboarding'],
    lifecycle: (gymId) => ['admin', 'analytics', gymId, 'lifecycle'],
    trainers: (gymId) => ['admin', 'analytics', gymId, 'trainers'],
    summary: (gymId, month) => ['admin', 'analytics', gymId, 'summary', month],
  },

  attendance: (gymId) => ['admin', 'attendance', gymId],
  challenges: (gymId) => ['admin', 'challenges', gymId],
  trainers: (gymId) => ['admin', 'trainers', gymId],
  programs: (gymId) => ['admin', 'programs', gymId],
  leaderboard: (gymId) => ['admin', 'leaderboard', gymId],
  announcements: (gymId) => ['admin', 'announcements', gymId],
  moderation: (gymId) => ['admin', 'moderation', gymId],
  settings: (gymId) => ['admin', 'settings', gymId],
  followUpSettings: (gymId) => ['admin', 'follow-up-settings', gymId],
};
