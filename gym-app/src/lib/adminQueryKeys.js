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
  notificationPrefs: (gymId) => ['admin', 'notification-prefs', gymId],
  followUpSettings: (gymId) => ['admin', 'follow-up-settings', gymId],

  revenue: {
    all: (gymId) => ['admin', 'revenue', gymId],
    points: (gymId, period) => ['admin', 'revenue', gymId, 'points', period],
    purchases: (gymId, period) => ['admin', 'revenue', gymId, 'purchases', period],
    products: (gymId) => ['admin', 'revenue', gymId, 'products'],
  },

  auditLog: {
    all: (gymId) => ['admin', 'auditLog', gymId],
    list: (gymId, action, preset, from, to) => ['admin', 'auditLog', gymId, 'list', action, preset, from, to],
  },

  reports: {
    all: (gymId) => ['admin', 'reports', gymId],
    history: (gymId) => ['admin', 'reports', gymId, 'history'],
  },

  segments: {
    all: (gymId) => ['admin', 'segments', gymId],
    detail: (gymId, segmentId) => ['admin', 'segments', gymId, 'detail', segmentId],
    members: (gymId, segmentId) => ['admin', 'segments', gymId, 'members', segmentId],
  },

  referrals: {
    all: (gymId) => ['admin', 'referrals', gymId],
    stats: (gymId) => ['admin', 'referrals', gymId, 'stats'],
    leaderboard: (gymId, period) => ['admin', 'referrals', gymId, 'leaderboard', period],
    member: (gymId, memberId) => ['admin', 'referrals', gymId, 'member', memberId],
    config: (gymId) => ['admin', 'referrals', gymId, 'config'],
  },

  nps: {
    all: (gymId) => ['admin', 'nps', gymId],
    stats: (gymId, days) => ['admin', 'nps', gymId, 'stats', days],
    responses: (gymId, days) => ['admin', 'nps', gymId, 'responses', days],
    surveys: (gymId) => ['admin', 'nps', gymId, 'surveys'],
  },

  kpiTargets: (gymId, month) => ['admin', 'kpi-targets', gymId, month],

  digest: (gymId) => ['admin', 'digest-config', gymId],

  messaging: {
    all: (gymId) => ['admin', 'messaging', gymId],
    scheduled: (gymId) => ['admin', 'messaging', 'scheduled', gymId],
    broadcastHistory: (gymId) => ['admin', 'messaging', 'broadcast-history', gymId],
  },

  store: {
    all: (gymId) => ['admin', 'store', gymId],
    products: (gymId) => ['admin', 'store', gymId, 'products'],
    purchases: (gymId, filters) => ['admin', 'store', gymId, 'purchases', filters],
    members: (gymId) => ['admin', 'store', gymId, 'members'],
  },

  classes: {
    all: (gymId) => ['admin', 'classes', gymId],
    detail: (classId) => ['admin', 'class-analytics', classId],
    bookings: (classId, date) => ['admin', 'class-bookings', classId, date],
    bookingsTab: (classId, dateFilter) => ['admin', 'class-bookings-tab', classId, dateFilter],
    routines: (gymId) => ['admin', 'routines-for-classes', gymId],
    trainers: (gymId) => ['admin', 'trainers-for-classes', gymId],
  },

  abTesting: {
    all: (gymId) => ['admin', 'ab-testing', gymId],
    experiments: (gymId) => ['admin', 'ab-testing', gymId, 'experiments'],
  },

  rewards: {
    all: (gymId) => ['admin', 'rewards', gymId],
    milestones: (gymId) => ['admin', 'rewards', gymId, 'milestones'],
  },

  emailTemplates: (gymId) => ['admin', 'email-templates', gymId],

  profile: (gymId, profileId) => ['admin', 'profile', gymId, profileId],
};
