/**
 * Quick-template catalog for admin outreach modals.
 *
 * Today these are consumed by ContactPanel (per-member email + SMS). The
 * module is structured so future surfaces (broadcast composer, scheduled
 * campaigns, WinBackModal preset picker) can read the same set without
 * duplicating the i18n keys + default copy.
 *
 * Categories (`missYou`, `checkIn`, `newClasses`) share their label across
 * channels — the email and SMS variants are paired by `key`. To add a new
 * template:
 *   1. Add the entry to both `getEmailTemplates` and `getSmsTemplates`
 *      (and any new channel helpers) keyed the same way.
 *   2. Add the i18n keys to `admin.churn.tpl*` and `admin.churn.smsTpl*`
 *      in en/pages.json + es/pages.json.
 *
 * If/when we move templates into a `message_templates` DB table editable
 * from AdminEmailTemplates, this module becomes the seed source.
 */

export const TEMPLATE_CATEGORIES = ['missYou', 'checkIn', 'newClasses'];

/**
 * Build the email template list for a recipient. The caller passes
 * the i18n `t` function (pages namespace) so labels stay locale-aware,
 * and the recipient's first name for personalization.
 */
export function getEmailTemplates(t, firstName) {
  return [
    {
      key: 'missYou',
      label: t('admin.churn.tplMissYou', 'We miss you'),
      subject: t('admin.churn.tplMissYouSubject', { name: firstName, defaultValue: `${firstName}, we miss you!` }),
      body: t('admin.churn.tplMissYouBody', { name: firstName, defaultValue: `We noticed you haven't been in for a while and we genuinely miss seeing you.\n\nWhatever got in the way — busy schedule, motivation dip, or just life — we get it. But your progress matters, and we'd love to help you pick up where you left off.\n\nCome back anytime, we're here for you.` }),
    },
    {
      key: 'checkIn',
      label: t('admin.churn.tplCheckIn', 'Quick check-in'),
      subject: t('admin.churn.tplCheckInSubject', { defaultValue: 'How are you doing?' }),
      body: t('admin.churn.tplCheckInBody', { name: firstName, defaultValue: `Just wanted to check in and see how things are going.\n\nIf anything is keeping you away — schedule issues, needing a new program, questions about your goals — let us know. We're happy to adjust things to make it work for you.\n\nHope to see you soon!` }),
    },
    {
      key: 'newClasses',
      label: t('admin.churn.tplNewClasses', 'New classes/programs'),
      subject: t('admin.churn.tplNewClassesSubject', { defaultValue: 'New things happening at the gym' }),
      body: t('admin.churn.tplNewClassesBody', { name: firstName, defaultValue: `We've been adding some exciting new classes and programs that we think you'd enjoy.\n\nWhether you're looking to try something different or get back into a routine, there's something here for you.\n\nCome check it out — your first class back is on us!` }),
    },
  ];
}

/**
 * Build the SMS template list for a recipient. SMS templates omit the
 * subject and have shorter bodies (designed to fit one segment when
 * possible, but the second segment still costs the gym).
 */
export function getSmsTemplates(t, firstName) {
  return [
    {
      key: 'missYou',
      label: t('admin.churn.tplMissYou', 'We miss you'),
      body: t('admin.churn.smsTplMissYou', { name: firstName, defaultValue: `Hey ${firstName}, we miss you at the gym! Come in this week, your spot is waiting.` }),
    },
    {
      key: 'checkIn',
      label: t('admin.churn.tplCheckIn', 'Quick check-in'),
      body: t('admin.churn.smsTplCheckIn', { name: firstName, defaultValue: `Hey ${firstName}, just checking in. Need a new routine or schedule change? Let us know!` }),
    },
    {
      key: 'newClasses',
      label: t('admin.churn.tplNewClasses', 'New classes/programs'),
      body: t('admin.churn.smsTplNewClasses', { name: firstName, defaultValue: `Hey ${firstName}, we've added new classes you'd love. Come check them out!` }),
    },
  ];
}
