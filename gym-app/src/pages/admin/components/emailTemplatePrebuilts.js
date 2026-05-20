/**
 * Pre-built starter templates + the template-type / variable-token
 * catalogs surfaced by AdminEmailTemplates.
 *
 * The 12 prebuilt templates are seeded into the gym's email_templates
 * table the first time the admin clicks "Use this template" — until
 * then they exist only as in-memory examples. Each one is built off
 * `defaultTemplate` so the shape stays aligned with what the editor
 * expects and what the renderer in `emailTemplateRenderer.js` reads.
 */

export const TEMPLATE_TYPES = [
  { key: 'welcome', icon: '\u{1F44B}' },
  { key: 'digest', icon: '\u{1F4CA}' },
  { key: 'winback', icon: '\u{1F4AA}' },
  { key: 'announcement', icon: '\u{1F4E2}' },
  { key: 'classReminder', icon: '\u{1F514}' },
  { key: 'custom', icon: '\u{270F}\u{FE0F}' },
];

export const TEMPLATE_VARIABLES = [
  { key: 'member_name', token: '{{member_name}}' },
  { key: 'gym_name', token: '{{gym_name}}' },
  { key: 'streak_count', token: '{{streak_count}}' },
  { key: 'workout_count', token: '{{workout_count}}' },
  { key: 'days_inactive', token: '{{days_inactive}}' },
];

export const defaultTemplate = (gymName, primaryColor, t) => ({
  id: crypto.randomUUID(),
  name: '',
  type: 'custom',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  header: { enabled: true, showLogo: true, text: '' },
  hero: { enabled: false, imageUrl: '', headline: '', subtitle: '' },
  body: { text: '' },
  cta: { enabled: false, text: '', url: '', color: primaryColor || '#D4AF37' },
  footer: { enabled: true, text: `© ${new Date().getFullYear()} ${gymName || t?.('admin.emailTemplates.yourGym', 'Your Gym') || 'Your Gym'}`, unsubscribeText: t?.('admin.emailTemplates.unsubscribe', 'Unsubscribe') || 'Unsubscribe' },
  colors: { primary: primaryColor || '#D4AF37', background: '#ffffff', text: '#333333' },
});

export function getPrebuiltTemplates(gymName, primaryColor, t) {
  const yr = new Date().getFullYear();
  const gn = gymName || t?.('admin.emailTemplates.ourGym', 'Our Gym') || 'Our Gym';
  const pc = primaryColor || '#D4AF37';
  const unsub = t?.('admin.emailTemplates.unsubscribe', 'Unsubscribe') || 'Unsubscribe';
  const base = (overrides) => ({ ...defaultTemplate(gymName, primaryColor, t), ...overrides });

  return [
    // 1. Welcome Email
    base({
      id: 'prebuilt-welcome',
      name: t?.('admin.emailTemplates.prebuilt.welcomeName', 'Welcome Email') || 'Welcome Email',
      type: 'welcome',
      header: { enabled: true, showLogo: true, text: t?.('admin.emailTemplates.prebuilt.welcomeHeader', { gn, defaultValue: `Welcome to ${gn}` }) || `Welcome to ${gn}` },
      hero: { enabled: true, imageUrl: '', headline: t?.('admin.emailTemplates.prebuilt.welcomeHeadline', 'Your fitness journey starts here') || 'Your fitness journey starts here', subtitle: t?.('admin.emailTemplates.prebuilt.welcomeSubtitle', { gn, defaultValue: `We’re thrilled to have you join the ${gn} community.` }) || `We’re thrilled to have you join the ${gn} community.` },
      body: { text: t?.('admin.emailTemplates.prebuilt.welcomeBody', `Hi {{member_name}},\n\nWelcome to the team. We built this app to help you train smarter, stay consistent, and celebrate every win along the way.\n\nHere’s what’s waiting for you:\n- Personalised workout tracking with progressive overload\n- Challenges and leaderboards to keep you motivated\n- Achievement badges and rewards for consistency\n\nYour first workout is the hardest. After that, it’s just momentum.`) },
      cta: { enabled: true, text: t?.('admin.emailTemplates.prebuilt.welcomeCta', 'Open the App') || 'Open the App', url: '#', color: pc },
      footer: { enabled: true, text: `© ${yr} ${gn}`, unsubscribeText: unsub },
      colors: { primary: pc, background: '#ffffff', text: 'var(--color-bg-inset)' },
    }),

    // 2. Weekly Digest
    base({
      id: 'prebuilt-digest',
      name: t?.('admin.emailTemplates.prebuilt.digestName', 'Weekly Digest') || 'Weekly Digest',
      type: 'digest',
      header: { enabled: true, showLogo: true, text: t?.('admin.emailTemplates.prebuilt.digestHeader', 'Your Weekly Recap') || 'Your Weekly Recap' },
      hero: { enabled: false, imageUrl: '', headline: '', subtitle: '' },
      body: { text: t?.('admin.emailTemplates.prebuilt.digestBody', `Hi {{member_name}},\n\nHere’s your week at {{gym_name}} at a glance:\n\n--- This Week’s Stats ---\n\u{1F3CB}\u{FE0F} Workouts completed: {{workout_count}}\n\u{1F525} Current streak: {{streak_count}} days\n\n--- Coming Up ---\nCheck the app for this week’s class schedule and new challenges.\n\nConsistency compounds. Every session you log is building something.`) },
      cta: { enabled: true, text: t?.('admin.emailTemplates.prebuilt.digestCta', 'View Dashboard') || 'View Dashboard', url: '#', color: pc },
      footer: { enabled: true, text: `© ${yr} ${gn}`, unsubscribeText: unsub },
      colors: { primary: pc, background: '#F8F9FA', text: 'var(--color-bg-inset)' },
    }),

    // 3. Win-Back
    base({
      id: 'prebuilt-winback',
      name: t?.('admin.emailTemplates.prebuilt.winbackName', 'Win-Back') || 'Win-Back',
      type: 'winback',
      header: { enabled: true, showLogo: true, text: '' },
      hero: { enabled: true, imageUrl: '', headline: t?.('admin.emailTemplates.prebuilt.winbackHeadline', 'We miss you') || 'We miss you', subtitle: t?.('admin.emailTemplates.prebuilt.winbackSubtitle', `It’s been {{days_inactive}} days since your last session at {{gym_name}}.`) },
      body: { text: t?.('admin.emailTemplates.prebuilt.winbackBody', `Hey {{member_name}},\n\nYour {{streak_count}}-day streak is still on the books — waiting to be reignited.\n\nWe know life gets in the way. No guilt, no pressure. But your goals are still there, and so are we.\n\nSometimes all it takes is showing up once. Let’s make it happen.`) },
      cta: { enabled: true, text: t?.('admin.emailTemplates.prebuilt.winbackCta', 'Come Back Today') || 'Come Back Today', url: '#', color: pc },
      footer: { enabled: true, text: `© ${yr} ${gn}`, unsubscribeText: unsub },
      colors: { primary: '#6C63FF', background: '#ffffff', text: 'var(--color-bg-inset)' },
    }),

    // 4. Class Reminder
    base({
      id: 'prebuilt-classReminder',
      name: t?.('admin.emailTemplates.prebuilt.classReminderName', 'Class Reminder') || 'Class Reminder',
      type: 'classReminder',
      header: { enabled: true, showLogo: true, text: t?.('admin.emailTemplates.prebuilt.classReminderHeader', 'Class Reminder') || 'Class Reminder' },
      hero: { enabled: false, imageUrl: '', headline: '', subtitle: '' },
      body: { text: t?.('admin.emailTemplates.prebuilt.classReminderBody', `Hi {{member_name}},\n\nJust a heads-up — your class is coming up soon.\n\n--- Class Details ---\n\u{1F4CB} Class: [Class Name]\n\u{1F464} Instructor: [Instructor Name]\n\u{1F552} Time: [Class Time]\n\u{1F4CD} Location: {{gym_name}}\n\nArrive a few minutes early to warm up. Don’t forget to check in when you get there!`) },
      cta: { enabled: true, text: t?.('admin.emailTemplates.prebuilt.classReminderCta', 'Check In') || 'Check In', url: '#', color: pc },
      footer: { enabled: true, text: `© ${yr} ${gn}`, unsubscribeText: unsub },
      colors: { primary: pc, background: '#ffffff', text: 'var(--color-bg-inset)' },
    }),

    // 5. New Member Onboarding Series
    base({
      id: 'prebuilt-onboarding',
      name: t?.('admin.emailTemplates.prebuilt.onboardingName', 'New Member Onboarding') || 'New Member Onboarding',
      type: 'welcome',
      header: { enabled: true, showLogo: true, text: '' },
      hero: { enabled: true, imageUrl: '', headline: t?.('admin.emailTemplates.prebuilt.onboardingHeadline', 'Your journey starts now') || 'Your journey starts now', subtitle: t?.('admin.emailTemplates.prebuilt.onboardingSubtitle', { gn, defaultValue: `Everything you need to get the most out of ${gn}.` }) || `Everything you need to get the most out of ${gn}.` },
      body: { text: t?.('admin.emailTemplates.prebuilt.onboardingBody', `Hi {{member_name}},\n\nWelcome aboard. Here’s a quick guide to get you started:\n\n--- Track Your Workouts ---\n- Log every set, rep, and weight — the app handles progressive overload for you\n- Watch your estimated 1RM climb over time\n\n--- Stay Accountable ---\n- Check in at the gym to build your streak\n- Join challenges and compete with other members\n\n--- Earn Rewards ---\n- Every workout earns you points toward real rewards\n- Unlock achievement badges as you hit milestones\n\n--- Connect ---\n- Add friends, share PRs, and stay motivated together\n\nThe best time to start was yesterday. The second best time is right now.`) },
      cta: { enabled: true, text: t?.('admin.emailTemplates.prebuilt.onboardingCta', 'Open App') || 'Open App', url: '#', color: '#10B981' },
      footer: { enabled: true, text: `© ${yr} ${gn}`, unsubscribeText: unsub },
      colors: { primary: '#10B981', background: '#ffffff', text: 'var(--color-bg-card)' },
    }),

    // 6. Milestone Celebration
    base({
      id: 'prebuilt-milestone',
      name: t?.('admin.emailTemplates.prebuilt.milestoneName', 'Milestone Celebration') || 'Milestone Celebration',
      type: 'custom',
      header: { enabled: true, showLogo: true, text: '' },
      hero: { enabled: true, imageUrl: '', headline: t?.('admin.emailTemplates.prebuilt.milestoneHeadline', '\u{1F389} Milestone unlocked!') || '\u{1F389} Milestone unlocked!', subtitle: t?.('admin.emailTemplates.prebuilt.milestoneSubtitle', 'You just did something incredible.') || 'You just did something incredible.' },
      body: { text: t?.('admin.emailTemplates.prebuilt.milestoneBody', `Hey {{member_name}},\n\nYou just hit {{workout_count}} workouts at {{gym_name}}. That’s not luck — that’s dedication.\n\nMost people never get this far. You did. And every single session has been building a stronger version of yourself.\n\nKeep that momentum going. The next milestone is closer than you think.`) },
      cta: { enabled: true, text: t?.('admin.emailTemplates.prebuilt.milestoneCta', 'See Your Stats') || 'See Your Stats', url: '#', color: 'var(--color-warning)' },
      footer: { enabled: true, text: `© ${yr} ${gn}`, unsubscribeText: unsub },
      colors: { primary: 'var(--color-warning)', background: '#FFFBEB', text: 'var(--color-bg-card)' },
    }),

    // 7. Challenge Invitation
    base({
      id: 'prebuilt-challenge',
      name: t?.('admin.emailTemplates.prebuilt.challengeName', 'Challenge Invitation') || 'Challenge Invitation',
      type: 'announcement',
      header: { enabled: true, showLogo: true, text: '' },
      hero: { enabled: true, imageUrl: '', headline: t?.('admin.emailTemplates.prebuilt.challengeHeadline', 'A new challenge awaits') || 'A new challenge awaits', subtitle: t?.('admin.emailTemplates.prebuilt.challengeSubtitle', 'Starts this week. Are you in?') || 'Starts this week. Are you in?' },
      body: { text: t?.('admin.emailTemplates.prebuilt.challengeBody', `Hi {{member_name}},\n\nWe’re launching a brand new challenge at {{gym_name}}, and we want you on the leaderboard.\n\n--- Challenge Details ---\n\u{1F3C6} Name: [Challenge Name]\n\u{1F4C5} Dates: [Start Date] – [End Date]\n\u{1F3AF} Goal: [Challenge Goal]\n\u{1F381} Prizes: [Prize Details]\n\nChallenges are where ordinary members become legends. Top performers earn rewards, badges, and serious bragging rights.\n\nSpots are filling up. Don’t miss out.`) },
      cta: { enabled: true, text: t?.('admin.emailTemplates.prebuilt.challengeCta', 'Join Challenge') || 'Join Challenge', url: '#', color: 'var(--color-coach)' },
      footer: { enabled: true, text: `© ${yr} ${gn}`, unsubscribeText: unsub },
      colors: { primary: 'var(--color-coach)', background: '#FAF5FF', text: 'var(--color-bg-card)' },
    }),

    // 8. Monthly Report
    base({
      id: 'prebuilt-monthly-report',
      name: t?.('admin.emailTemplates.prebuilt.monthlyReportName', 'Monthly Report') || 'Monthly Report',
      type: 'digest',
      header: { enabled: true, showLogo: true, text: t?.('admin.emailTemplates.prebuilt.monthlyReportHeader', 'Your Monthly Report') || 'Your Monthly Report' },
      hero: { enabled: false, imageUrl: '', headline: '', subtitle: '' },
      body: { text: t?.('admin.emailTemplates.prebuilt.monthlyReportBody', `Hi {{member_name}},\n\nYour monthly report for {{gym_name}} is ready. Here’s how you performed:\n\n--- Workouts ---\n\u{1F4AA} Total sessions: {{workout_count}}\n\u{1F525} Longest streak: {{streak_count}} days\n\n--- Personal Records ---\nYou crushed new PRs this month. Check the app for the full breakdown.\n\n--- Attendance ---\nYour check-in consistency was strong. Keep showing up — it’s the single best predictor of results.\n\n--- What’s Next ---\nSet a new goal for next month. Small targets lead to big transformations.`) },
      cta: { enabled: true, text: t?.('admin.emailTemplates.prebuilt.monthlyReportCta', 'View Full Report') || 'View Full Report', url: '#', color: 'var(--color-info)' },
      footer: { enabled: true, text: `© ${yr} ${gn}`, unsubscribeText: unsub },
      colors: { primary: 'var(--color-info)', background: '#F0F9FF', text: 'var(--color-bg-inset)' },
    }),

    // 9. Special Offer / Promotion
    base({
      id: 'prebuilt-promo',
      name: t?.('admin.emailTemplates.prebuilt.promoName', 'Special Offer') || 'Special Offer',
      type: 'announcement',
      header: { enabled: true, showLogo: true, text: '' },
      hero: { enabled: true, imageUrl: '', headline: t?.('admin.emailTemplates.prebuilt.promoHeadline', 'Exclusive member offer') || 'Exclusive member offer', subtitle: t?.('admin.emailTemplates.prebuilt.promoSubtitle', 'For a limited time only.') || 'For a limited time only.' },
      body: { text: t?.('admin.emailTemplates.prebuilt.promoBody', `Hi {{member_name}},\n\nAs a valued member of {{gym_name}}, we have something special just for you.\n\n--- The Offer ---\n[Describe your offer here — discount, free sessions, merchandise, etc.]\n\n\u{23F3} Valid until: [Expiry Date]\n\nThis is our way of saying thank you for being part of the community. Don’t let it expire.`) },
      cta: { enabled: true, text: t?.('admin.emailTemplates.prebuilt.promoCta', 'Claim Offer') || 'Claim Offer', url: '#', color: 'var(--color-danger)' },
      footer: { enabled: true, text: `© ${yr} ${gn}`, unsubscribeText: unsub },
      colors: { primary: 'var(--color-danger)', background: '#FFF1F2', text: 'var(--color-bg-card)' },
    }),

    // 10. Referral Reward
    base({
      id: 'prebuilt-referral',
      name: t?.('admin.emailTemplates.prebuilt.referralName', 'Referral Reward') || 'Referral Reward',
      type: 'custom',
      header: { enabled: true, showLogo: true, text: '' },
      hero: { enabled: true, imageUrl: '', headline: t?.('admin.emailTemplates.prebuilt.referralHeadline', 'You earned a reward!') || 'You earned a reward!', subtitle: t?.('admin.emailTemplates.prebuilt.referralSubtitle', 'Your referral just signed up.') || 'Your referral just signed up.' },
      body: { text: t?.('admin.emailTemplates.prebuilt.referralBody', `Hey {{member_name}},\n\nGreat news — someone you referred just joined {{gym_name}}, and you’ve earned a reward.\n\nYour generosity helps our community grow, and we don’t take that for granted. Here’s what you’ve unlocked:\n\n\u{1F381} [Reward Details]\n\nKeep sharing your referral code — the more friends you bring, the more you earn.`) },
      cta: { enabled: true, text: t?.('admin.emailTemplates.prebuilt.referralCta', 'See Your Rewards') || 'See Your Rewards', url: '#', color: 'var(--color-info)' },
      footer: { enabled: true, text: `© ${yr} ${gn}`, unsubscribeText: unsub },
      colors: { primary: 'var(--color-info)', background: '#F0FDFA', text: 'var(--color-bg-card)' },
    }),

    // 11. Re-engagement (Gentle)
    base({
      id: 'prebuilt-gentle-reengagement',
      name: t?.('admin.emailTemplates.prebuilt.reengagementName', 'Re-engagement (Gentle)') || 'Re-engagement (Gentle)',
      type: 'winback',
      header: { enabled: true, showLogo: true, text: '' },
      hero: { enabled: false, imageUrl: '', headline: '', subtitle: '' },
      body: { text: t?.('admin.emailTemplates.prebuilt.reengagementBody', `Hey {{member_name}},\n\nIt’s been a while since we’ve seen you at {{gym_name}}, and we just wanted to check in.\n\nNo sales pitch, no pressure. Life happens, and we get it.\n\nBut if you’re ready to come back — even for just one session — we’re here. Your data is saved, your progress is waiting, and the community would love to see you again.\n\nSometimes the hardest part is just walking through the door.`) },
      cta: { enabled: true, text: t?.('admin.emailTemplates.prebuilt.reengagementCta', 'Come Back') || 'Come Back', url: '#', color: 'var(--color-coach)' },
      footer: { enabled: true, text: `© ${yr} ${gn}`, unsubscribeText: unsub },
      colors: { primary: 'var(--color-coach)', background: '#ffffff', text: 'var(--color-bg-input)' },
    }),

    // 12. Event Announcement
    base({
      id: 'prebuilt-event',
      name: t?.('admin.emailTemplates.prebuilt.eventName', 'Event Announcement') || 'Event Announcement',
      type: 'announcement',
      header: { enabled: true, showLogo: true, text: '' },
      hero: { enabled: true, imageUrl: '', headline: t?.('admin.emailTemplates.prebuilt.eventHeadline', 'You’re invited!') || 'You’re invited!', subtitle: t?.('admin.emailTemplates.prebuilt.eventSubtitle', 'An event you won’t want to miss.') || 'An event you won’t want to miss.' },
      body: { text: t?.('admin.emailTemplates.prebuilt.eventBody', `Hi {{member_name}},\n\nWe’re hosting something special at {{gym_name}}, and you’re on the list.\n\n--- Event Details ---\n\u{1F389} Event: [Event Name]\n\u{1F4C5} Date: [Event Date]\n\u{1F552} Time: [Event Time]\n\u{1F4CD} Location: [Event Location]\n\nWhether you’re a regular or haven’t been in a while, this is a perfect reason to come through. Bring a friend — everyone’s welcome.\n\nSpaces are limited. Reserve yours now.`) },
      cta: { enabled: true, text: t?.('admin.emailTemplates.prebuilt.eventCta', 'RSVP Now') || 'RSVP Now', url: '#', color: 'var(--color-coach)' },
      footer: { enabled: true, text: `© ${yr} ${gn}`, unsubscribeText: unsub },
      colors: { primary: 'var(--color-coach)', background: '#FDF2F8', text: 'var(--color-bg-card)' },
    }),
  ];
}
