import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Mail, Plus, Pencil, Trash2, Copy, Send, Save, ArrowLeft, Eye,
  Image, Type, MousePointerClick, FileText, Sparkles, Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { adminKeys } from '../../lib/adminQueryKeys';
import { PageHeader, AdminCard, FadeIn, AdminModal } from '../../components/admin';

// ── Constants ──────────────────────────────────────────────────
const TEMPLATE_TYPES = [
  { key: 'welcome', icon: '\u{1F44B}' },
  { key: 'digest', icon: '\u{1F4CA}' },
  { key: 'winback', icon: '\u{1F4AA}' },
  { key: 'announcement', icon: '\u{1F4E2}' },
  { key: 'classReminder', icon: '\u{1F514}' },
  { key: 'custom', icon: '\u{270F}\u{FE0F}' },
];

const TEMPLATE_VARIABLES = [
  { key: 'member_name', token: '{{member_name}}' },
  { key: 'gym_name', token: '{{gym_name}}' },
  { key: 'streak_count', token: '{{streak_count}}' },
  { key: 'workout_count', token: '{{workout_count}}' },
  { key: 'days_inactive', token: '{{days_inactive}}' },
];

const defaultTemplate = (gymName, primaryColor) => ({
  id: crypto.randomUUID(),
  name: '',
  type: 'custom',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  header: { enabled: true, showLogo: true, text: '' },
  hero: { enabled: false, imageUrl: '', headline: '', subtitle: '' },
  body: { text: '' },
  cta: { enabled: false, text: '', url: '', color: primaryColor || '#D4AF37' },
  footer: { enabled: true, text: `\u00A9 ${new Date().getFullYear()} ${gymName || 'Your Gym'}`, unsubscribeText: 'Unsubscribe' },
  colors: { primary: primaryColor || '#D4AF37', background: '#ffffff', text: '#333333' },
});

// ── Pre-built starter templates (12) ──────────────────────────
function getPrebuiltTemplates(gymName, primaryColor) {
  const yr = new Date().getFullYear();
  const gn = gymName || 'Our Gym';
  const pc = primaryColor || '#D4AF37';
  const base = (overrides) => ({ ...defaultTemplate(gymName, primaryColor), ...overrides });

  return [
    // 1. Welcome Email
    base({
      id: 'prebuilt-welcome',
      name: 'Welcome Email',
      type: 'welcome',
      header: { enabled: true, showLogo: true, text: `Welcome to ${gn}` },
      hero: { enabled: true, imageUrl: '', headline: 'Your fitness journey starts here', subtitle: `We\u2019re thrilled to have you join the ${gn} community.` },
      body: { text: `Hi {{member_name}},\n\nWelcome to the team. We built this app to help you train smarter, stay consistent, and celebrate every win along the way.\n\nHere\u2019s what\u2019s waiting for you:\n- Personalised workout tracking with progressive overload\n- Challenges and leaderboards to keep you motivated\n- Achievement badges and rewards for consistency\n\nYour first workout is the hardest. After that, it\u2019s just momentum.` },
      cta: { enabled: true, text: 'Open the App', url: '#', color: pc },
      footer: { enabled: true, text: `\u00A9 ${yr} ${gn}`, unsubscribeText: 'Unsubscribe' },
      colors: { primary: pc, background: '#ffffff', text: '#2D3142' },
    }),

    // 2. Weekly Digest
    base({
      id: 'prebuilt-digest',
      name: 'Weekly Digest',
      type: 'digest',
      header: { enabled: true, showLogo: true, text: 'Your Weekly Recap' },
      hero: { enabled: false, imageUrl: '', headline: '', subtitle: '' },
      body: { text: `Hi {{member_name}},\n\nHere\u2019s your week at {{gym_name}} at a glance:\n\n--- This Week\u2019s Stats ---\n\u{1F3CB}\u{FE0F} Workouts completed: {{workout_count}}\n\u{1F525} Current streak: {{streak_count}} days\n\n--- Coming Up ---\nCheck the app for this week\u2019s class schedule and new challenges.\n\nConsistency compounds. Every session you log is building something.` },
      cta: { enabled: true, text: 'View Dashboard', url: '#', color: pc },
      footer: { enabled: true, text: `\u00A9 ${yr} ${gn}`, unsubscribeText: 'Unsubscribe' },
      colors: { primary: pc, background: '#F8F9FA', text: '#2D3142' },
    }),

    // 3. Win-Back
    base({
      id: 'prebuilt-winback',
      name: 'Win-Back',
      type: 'winback',
      header: { enabled: true, showLogo: true, text: '' },
      hero: { enabled: true, imageUrl: '', headline: 'We miss you', subtitle: `It\u2019s been {{days_inactive}} days since your last session at {{gym_name}}.` },
      body: { text: `Hey {{member_name}},\n\nYour {{streak_count}}-day streak is still on the books \u2014 waiting to be reignited.\n\nWe know life gets in the way. No guilt, no pressure. But your goals are still there, and so are we.\n\nSometimes all it takes is showing up once. Let\u2019s make it happen.` },
      cta: { enabled: true, text: 'Come Back Today', url: '#', color: pc },
      footer: { enabled: true, text: `\u00A9 ${yr} ${gn}`, unsubscribeText: 'Unsubscribe' },
      colors: { primary: '#6C63FF', background: '#ffffff', text: '#2D3142' },
    }),

    // 4. Class Reminder
    base({
      id: 'prebuilt-classReminder',
      name: 'Class Reminder',
      type: 'classReminder',
      header: { enabled: true, showLogo: true, text: 'Class Reminder' },
      hero: { enabled: false, imageUrl: '', headline: '', subtitle: '' },
      body: { text: `Hi {{member_name}},\n\nJust a heads-up \u2014 your class is coming up soon.\n\n--- Class Details ---\n\u{1F4CB} Class: [Class Name]\n\u{1F464} Instructor: [Instructor Name]\n\u{1F552} Time: [Class Time]\n\u{1F4CD} Location: {{gym_name}}\n\nArrive a few minutes early to warm up. Don\u2019t forget to check in when you get there!` },
      cta: { enabled: true, text: 'Check In', url: '#', color: pc },
      footer: { enabled: true, text: `\u00A9 ${yr} ${gn}`, unsubscribeText: 'Unsubscribe' },
      colors: { primary: pc, background: '#ffffff', text: '#2D3142' },
    }),

    // 5. New Member Onboarding Series
    base({
      id: 'prebuilt-onboarding',
      name: 'New Member Onboarding',
      type: 'welcome',
      header: { enabled: true, showLogo: true, text: '' },
      hero: { enabled: true, imageUrl: '', headline: 'Your journey starts now', subtitle: `Everything you need to get the most out of ${gn}.` },
      body: { text: `Hi {{member_name}},\n\nWelcome aboard. Here\u2019s a quick guide to get you started:\n\n--- Track Your Workouts ---\n- Log every set, rep, and weight \u2014 the app handles progressive overload for you\n- Watch your estimated 1RM climb over time\n\n--- Stay Accountable ---\n- Check in at the gym to build your streak\n- Join challenges and compete with other members\n\n--- Earn Rewards ---\n- Every workout earns you points toward real rewards\n- Unlock achievement badges as you hit milestones\n\n--- Connect ---\n- Add friends, share PRs, and stay motivated together\n\nThe best time to start was yesterday. The second best time is right now.` },
      cta: { enabled: true, text: 'Open App', url: '#', color: '#10B981' },
      footer: { enabled: true, text: `\u00A9 ${yr} ${gn}`, unsubscribeText: 'Unsubscribe' },
      colors: { primary: '#10B981', background: '#ffffff', text: '#1F2937' },
    }),

    // 6. Milestone Celebration
    base({
      id: 'prebuilt-milestone',
      name: 'Milestone Celebration',
      type: 'custom',
      header: { enabled: true, showLogo: true, text: '' },
      hero: { enabled: true, imageUrl: '', headline: '\u{1F389} Milestone unlocked!', subtitle: 'You just did something incredible.' },
      body: { text: `Hey {{member_name}},\n\nYou just hit {{workout_count}} workouts at {{gym_name}}. That\u2019s not luck \u2014 that\u2019s dedication.\n\nMost people never get this far. You did. And every single session has been building a stronger version of yourself.\n\nKeep that momentum going. The next milestone is closer than you think.` },
      cta: { enabled: true, text: 'See Your Stats', url: '#', color: '#F59E0B' },
      footer: { enabled: true, text: `\u00A9 ${yr} ${gn}`, unsubscribeText: 'Unsubscribe' },
      colors: { primary: '#F59E0B', background: '#FFFBEB', text: '#1F2937' },
    }),

    // 7. Challenge Invitation
    base({
      id: 'prebuilt-challenge',
      name: 'Challenge Invitation',
      type: 'announcement',
      header: { enabled: true, showLogo: true, text: '' },
      hero: { enabled: true, imageUrl: '', headline: 'A new challenge awaits', subtitle: 'Starts this week. Are you in?' },
      body: { text: `Hi {{member_name}},\n\nWe\u2019re launching a brand new challenge at {{gym_name}}, and we want you on the leaderboard.\n\n--- Challenge Details ---\n\u{1F3C6} Name: [Challenge Name]\n\u{1F4C5} Dates: [Start Date] \u2013 [End Date]\n\u{1F3AF} Goal: [Challenge Goal]\n\u{1F381} Prizes: [Prize Details]\n\nChallenges are where ordinary members become legends. Top performers earn rewards, badges, and serious bragging rights.\n\nSpots are filling up. Don\u2019t miss out.` },
      cta: { enabled: true, text: 'Join Challenge', url: '#', color: '#8B5CF6' },
      footer: { enabled: true, text: `\u00A9 ${yr} ${gn}`, unsubscribeText: 'Unsubscribe' },
      colors: { primary: '#8B5CF6', background: '#FAF5FF', text: '#1F2937' },
    }),

    // 8. Monthly Report
    base({
      id: 'prebuilt-monthly-report',
      name: 'Monthly Report',
      type: 'digest',
      header: { enabled: true, showLogo: true, text: 'Your Monthly Report' },
      hero: { enabled: false, imageUrl: '', headline: '', subtitle: '' },
      body: { text: `Hi {{member_name}},\n\nYour monthly report for {{gym_name}} is ready. Here\u2019s how you performed:\n\n--- Workouts ---\n\u{1F4AA} Total sessions: {{workout_count}}\n\u{1F525} Longest streak: {{streak_count}} days\n\n--- Personal Records ---\nYou crushed new PRs this month. Check the app for the full breakdown.\n\n--- Attendance ---\nYour check-in consistency was strong. Keep showing up \u2014 it\u2019s the single best predictor of results.\n\n--- What\u2019s Next ---\nSet a new goal for next month. Small targets lead to big transformations.` },
      cta: { enabled: true, text: 'View Full Report', url: '#', color: '#0EA5E9' },
      footer: { enabled: true, text: `\u00A9 ${yr} ${gn}`, unsubscribeText: 'Unsubscribe' },
      colors: { primary: '#0EA5E9', background: '#F0F9FF', text: '#1E293B' },
    }),

    // 9. Special Offer / Promotion
    base({
      id: 'prebuilt-promo',
      name: 'Special Offer',
      type: 'announcement',
      header: { enabled: true, showLogo: true, text: '' },
      hero: { enabled: true, imageUrl: '', headline: 'Exclusive member offer', subtitle: 'For a limited time only.' },
      body: { text: `Hi {{member_name}},\n\nAs a valued member of {{gym_name}}, we have something special just for you.\n\n--- The Offer ---\n[Describe your offer here \u2014 discount, free sessions, merchandise, etc.]\n\n\u{23F3} Valid until: [Expiry Date]\n\nThis is our way of saying thank you for being part of the community. Don\u2019t let it expire.` },
      cta: { enabled: true, text: 'Claim Offer', url: '#', color: '#EF4444' },
      footer: { enabled: true, text: `\u00A9 ${yr} ${gn}`, unsubscribeText: 'Unsubscribe' },
      colors: { primary: '#EF4444', background: '#FFF1F2', text: '#1F2937' },
    }),

    // 10. Referral Reward
    base({
      id: 'prebuilt-referral',
      name: 'Referral Reward',
      type: 'custom',
      header: { enabled: true, showLogo: true, text: '' },
      hero: { enabled: true, imageUrl: '', headline: 'You earned a reward!', subtitle: 'Your referral just signed up.' },
      body: { text: `Hey {{member_name}},\n\nGreat news \u2014 someone you referred just joined {{gym_name}}, and you\u2019ve earned a reward.\n\nYour generosity helps our community grow, and we don\u2019t take that for granted. Here\u2019s what you\u2019ve unlocked:\n\n\u{1F381} [Reward Details]\n\nKeep sharing your referral code \u2014 the more friends you bring, the more you earn.` },
      cta: { enabled: true, text: 'See Your Rewards', url: '#', color: '#14B8A6' },
      footer: { enabled: true, text: `\u00A9 ${yr} ${gn}`, unsubscribeText: 'Unsubscribe' },
      colors: { primary: '#14B8A6', background: '#F0FDFA', text: '#1F2937' },
    }),

    // 11. Re-engagement (Gentle)
    base({
      id: 'prebuilt-gentle-reengagement',
      name: 'Re-engagement (Gentle)',
      type: 'winback',
      header: { enabled: true, showLogo: true, text: '' },
      hero: { enabled: false, imageUrl: '', headline: '', subtitle: '' },
      body: { text: `Hey {{member_name}},\n\nIt\u2019s been a while since we\u2019ve seen you at {{gym_name}}, and we just wanted to check in.\n\nNo sales pitch, no pressure. Life happens, and we get it.\n\nBut if you\u2019re ready to come back \u2014 even for just one session \u2014 we\u2019re here. Your data is saved, your progress is waiting, and the community would love to see you again.\n\nSometimes the hardest part is just walking through the door.` },
      cta: { enabled: true, text: 'Come Back', url: '#', color: '#6366F1' },
      footer: { enabled: true, text: `\u00A9 ${yr} ${gn}`, unsubscribeText: 'Unsubscribe' },
      colors: { primary: '#6366F1', background: '#ffffff', text: '#374151' },
    }),

    // 12. Event Announcement
    base({
      id: 'prebuilt-event',
      name: 'Event Announcement',
      type: 'announcement',
      header: { enabled: true, showLogo: true, text: '' },
      hero: { enabled: true, imageUrl: '', headline: 'You\u2019re invited!', subtitle: 'An event you won\u2019t want to miss.' },
      body: { text: `Hi {{member_name}},\n\nWe\u2019re hosting something special at {{gym_name}}, and you\u2019re on the list.\n\n--- Event Details ---\n\u{1F389} Event: [Event Name]\n\u{1F4C5} Date: [Event Date]\n\u{1F552} Time: [Event Time]\n\u{1F4CD} Location: [Event Location]\n\nWhether you\u2019re a regular or haven\u2019t been in a while, this is a perfect reason to come through. Bring a friend \u2014 everyone\u2019s welcome.\n\nSpaces are limited. Reserve yours now.` },
      cta: { enabled: true, text: 'RSVP Now', url: '#', color: '#EC4899' },
      footer: { enabled: true, text: `\u00A9 ${yr} ${gn}`, unsubscribeText: 'Unsubscribe' },
      colors: { primary: '#EC4899', background: '#FDF2F8', text: '#1F2937' },
    }),
  ];
}

// ── Helpers ─────────────────────────────────────────────────────
function replaceVariables(text, gymName) {
  if (!text) return '';
  return text
    .replace(/\{\{member_name\}\}/g, 'John Doe')
    .replace(/\{\{gym_name\}\}/g, gymName || 'Your Gym')
    .replace(/\{\{streak_count\}\}/g, '14')
    .replace(/\{\{workout_count\}\}/g, '47')
    .replace(/\{\{days_inactive\}\}/g, '7');
}

function generateEmailHtml(template, gymName, logoUrl) {
  const c = template.colors;
  const header = template.header;
  const hero = template.hero;
  const body = template.body;
  const cta = template.cta;
  const footer = template.footer;

  const bodyHtml = replaceVariables(body.text, gymName)
    .split('\n')
    .map(line => {
      if (line.startsWith('---') && line.endsWith('---')) {
        const inner = line.replace(/^-+\s*/, '').replace(/\s*-+$/, '');
        return `<h3 style="font-size:15px;font-weight:700;color:${c.primary};margin:28px 0 10px;letter-spacing:-0.01em;">${inner}</h3>`;
      }
      if (line.startsWith('- ')) return `<li style="margin:6px 0;color:${c.text};font-size:15px;line-height:1.7;padding-left:4px;">${line.slice(2)}</li>`;
      if (!line.trim()) return '<div style="height:12px;"></div>';
      return `<p style="margin:0 0 10px;line-height:1.75;color:${c.text};font-size:15px;letter-spacing:0.01em;">${line}</p>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
  img{-ms-interpolation-mode:bicubic;border:0;height:auto;line-height:100%;outline:none;text-decoration:none;}
  body{margin:0;padding:0;width:100%!important;}
  @media only screen and (max-width:620px){
    .email-container{width:100%!important;max-width:100%!important;}
    .stack-column{display:block!important;width:100%!important;}
    .hero-pad{padding:40px 24px!important;}
    .body-pad{padding:28px 24px!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${c.background};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.background};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06),0 1px 4px rgba(0,0,0,0.04);">

${header.enabled ? `<!-- Header -->
<tr><td style="padding:28px 40px 24px;text-align:center;">
${header.showLogo && logoUrl ? `<img src="${logoUrl}" alt="${gymName}" style="max-height:44px;margin-bottom:14px;display:block;margin-left:auto;margin-right:auto;" />` : ''}
${header.text ? `<h1 style="margin:0;font-size:22px;font-weight:700;color:${c.primary};letter-spacing:-0.02em;line-height:1.3;">${replaceVariables(header.text, gymName)}</h1>` : ''}
</td></tr>
<tr><td style="padding:0 40px;"><div style="height:1px;background:linear-gradient(90deg,transparent,${c.primary}40,transparent);"></div></td></tr>` : ''}

${hero.enabled ? `<!-- Hero -->
<tr><td style="padding:0;">
${hero.imageUrl
  ? `<img src="${hero.imageUrl}" alt="" style="width:100%;display:block;max-height:280px;object-fit:cover;" />`
  : `<div class="hero-pad" style="background:linear-gradient(135deg,${c.primary} 0%,${c.primary}cc 50%,${c.primary}99 100%);padding:56px 40px;text-align:center;">
<h2 style="margin:0 0 10px;font-size:32px;font-weight:800;color:#ffffff;letter-spacing:-0.03em;line-height:1.15;">${replaceVariables(hero.headline, gymName)}</h2>
${hero.subtitle ? `<p style="margin:0;font-size:17px;color:rgba(255,255,255,0.88);line-height:1.5;font-weight:400;">${replaceVariables(hero.subtitle, gymName)}</p>` : ''}
</div>`}
</td></tr>` : ''}

<!-- Body -->
<tr><td class="body-pad" style="padding:36px 40px 20px;">
${bodyHtml}
</td></tr>

${cta.enabled ? `<!-- CTA -->
<tr><td style="padding:8px 40px 40px;text-align:center;">
<a href="${cta.url || '#'}" style="display:inline-block;padding:16px 40px;background:${cta.color};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:50px;letter-spacing:0.02em;box-shadow:0 4px 14px ${cta.color}44,0 2px 6px rgba(0,0,0,0.08);mso-padding-alt:0;text-align:center;">
<!--[if mso]><i style="letter-spacing:40px;mso-font-width:-100%;mso-text-raise:30pt">&nbsp;</i><![endif]-->
<span style="mso-text-raise:15pt;">${replaceVariables(cta.text, gymName)}</span>
<!--[if mso]><i style="letter-spacing:40px;mso-font-width:-100%">&nbsp;</i><![endif]-->
</a>
</td></tr>` : ''}

${footer.enabled ? `<!-- Footer -->
<tr><td style="padding:0 40px;"><div style="height:1px;background:#f0f0f0;"></div></td></tr>
<tr><td style="padding:24px 40px 28px;text-align:center;">
<p style="margin:0 0 6px;font-size:12px;color:#9CA3AF;line-height:1.5;letter-spacing:0.01em;">${replaceVariables(footer.text, gymName)}</p>
${footer.unsubscribeText ? `<a href="#" style="font-size:11px;color:#D1D5DB;text-decoration:underline;">${footer.unsubscribeText}</a>` : ''}
</td></tr>` : ''}

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Toggle Component ─────────────────────────────────────────────
function Toggle({ value, onChange, label }) {
  return (
    <button
      onClick={() => onChange(!value)}
      aria-label={label}
      className="w-9 h-5 rounded-full relative flex-shrink-0 transition-colors"
      style={{ backgroundColor: value ? 'var(--color-accent)' : '#6B7280' }}
    >
      <span
        className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
        style={{ left: value ? 'calc(100% - 18px)' : '2px' }}
      />
    </button>
  );
}

// ── Variable Pill ────────────────────────────────────────────────
function VariablePill({ token, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/20 transition-colors"
    >
      <span>{label}</span>
    </button>
  );
}

// ── Section Editor Block ─────────────────────────────────────────
function SectionBlock({ title, icon: Icon, enabled, onToggle, children }) {
  const { t } = useTranslation('pages');
  return (
    <div className="border border-white/6 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-white/[0.02]">
        <div className="flex items-center gap-2.5">
          <Icon size={15} className="text-[var(--color-accent)]" />
          <span className="text-[13px] font-semibold text-[#E5E7EB]">{title}</span>
        </div>
        {onToggle && <Toggle value={enabled} onChange={onToggle} label={`Toggle ${title}`} />}
      </div>
      {enabled && <div className="px-4 py-4 space-y-3">{children}</div>}
    </div>
  );
}

// ── Field Component ──────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputClass = 'w-full bg-[#111827] border border-white/8 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[var(--color-accent)]/40 transition-colors';

// ── Live Preview Panel ───────────────────────────────────────────
function LivePreview({ template, gymName, gymLogoUrl }) {
  const c = template.colors;
  const { t } = useTranslation('pages');

  const renderBody = (text) => {
    if (!text) return null;
    const resolved = replaceVariables(text, gymName);
    return resolved.split('\n').map((line, i) => {
      if (line.startsWith('---') && line.endsWith('---')) {
        const inner = line.replace(/^-+\s*/, '').replace(/\s*-+$/, '');
        return <h3 key={i} style={{ fontSize: 14, fontWeight: 700, color: c.primary, margin: '20px 0 8px', letterSpacing: '-0.01em' }}>{inner}</h3>;
      }
      if (line.startsWith('- ')) return <li key={i} style={{ margin: '4px 0', color: c.text, fontSize: 13, lineHeight: 1.7, paddingLeft: 4 }}>{line.slice(2)}</li>;
      if (!line.trim()) return <div key={i} style={{ height: 10 }} />;
      return <p key={i} style={{ margin: '0 0 8px', lineHeight: 1.7, color: c.text, fontSize: 13, letterSpacing: '0.01em' }}>{line}</p>;
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/6">
        <Eye size={14} className="text-[var(--color-accent)]" />
        <span className="text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
          {t('admin.emailTemplates.preview')}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-4" style={{ background: '#1a1a2e' }}>
        <div
          style={{
            maxWidth: 600,
            margin: '0 auto',
            background: '#ffffff',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06)',
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
          }}
        >
          {/* Header */}
          {template.header.enabled && (
            <>
              <div style={{ padding: '24px 32px 20px', textAlign: 'center' }}>
                {template.header.showLogo && gymLogoUrl && (
                  <img src={gymLogoUrl} alt={gymName} style={{ maxHeight: 40, marginBottom: 12, display: 'block', marginLeft: 'auto', marginRight: 'auto' }} />
                )}
                {template.header.text && (
                  <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: c.primary, letterSpacing: '-0.02em' }}>
                    {replaceVariables(template.header.text, gymName)}
                  </h1>
                )}
              </div>
              <div style={{ margin: '0 32px', height: 1, background: `linear-gradient(90deg, transparent, ${c.primary}40, transparent)` }} />
            </>
          )}

          {/* Hero */}
          {template.hero.enabled && (
            template.hero.imageUrl ? (
              <img src={template.hero.imageUrl} alt="" style={{ width: '100%', display: 'block', maxHeight: 240, objectFit: 'cover' }} />
            ) : (
              <div style={{ background: `linear-gradient(135deg, ${c.primary}, ${c.primary}cc, ${c.primary}99)`, padding: '48px 32px', textAlign: 'center' }}>
                <h2 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1.15 }}>
                  {replaceVariables(template.hero.headline, gymName)}
                </h2>
                {template.hero.subtitle && (
                  <p style={{ margin: 0, fontSize: 15, color: 'rgba(255,255,255,0.88)', lineHeight: 1.5, fontWeight: 400 }}>
                    {replaceVariables(template.hero.subtitle, gymName)}
                  </p>
                )}
              </div>
            )
          )}

          {/* Body */}
          <div style={{ padding: '28px 32px 16px' }}>
            {renderBody(template.body.text)}
          </div>

          {/* CTA */}
          {template.cta.enabled && template.cta.text && (
            <div style={{ padding: '4px 32px 32px', textAlign: 'center' }}>
              <span
                style={{
                  display: 'inline-block',
                  padding: '14px 36px',
                  background: template.cta.color,
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 700,
                  borderRadius: 50,
                  textDecoration: 'none',
                  letterSpacing: '0.02em',
                  boxShadow: `0 4px 14px ${template.cta.color}44, 0 2px 6px rgba(0,0,0,0.08)`,
                }}
              >
                {replaceVariables(template.cta.text, gymName)}
              </span>
            </div>
          )}

          {/* Footer */}
          {template.footer.enabled && (
            <>
              <div style={{ margin: '0 32px', height: 1, background: '#f0f0f0' }} />
              <div style={{ padding: '20px 32px 24px', textAlign: 'center' }}>
                <p style={{ margin: '0 0 4px', fontSize: 11, color: '#9CA3AF', lineHeight: 1.5 }}>
                  {replaceVariables(template.footer.text, gymName)}
                </p>
                {template.footer.unsubscribeText && (
                  <span style={{ fontSize: 10, color: '#D1D5DB', textDecoration: 'underline' }}>
                    {template.footer.unsubscribeText}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Template Editor ──────────────────────────────────────────────
function TemplateEditor({ initial, onSave, onCancel, gymName, gymLogoUrl, primaryColor, saving }) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const { user, profile } = useAuth();
  const [template, setTemplate] = useState(initial);
  const bodyRef = useRef(null);
  const [testEmail, setTestEmail] = useState(user?.email || '');
  const [sendingTest, setSendingTest] = useState(false);

  const set = useCallback((path, value) => {
    setTemplate(prev => {
      const parts = path.split('.');
      const copy = JSON.parse(JSON.stringify(prev));
      let obj = copy;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = value;
      copy.updatedAt = new Date().toISOString();
      return copy;
    });
  }, []);

  const insertVariable = useCallback((token) => {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = template.body.text;
    const newText = text.substring(0, start) + token + text.substring(end);
    set('body.text', newText);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  }, [template.body.text, set]);

  const handleSave = () => {
    if (!template.name.trim()) {
      showToast(t('admin.emailTemplates.nameRequired'), 'error');
      return;
    }
    onSave(template);
  };

  const handleExportHtml = async () => {
    const html = generateEmailHtml(template, gymName, gymLogoUrl);
    try {
      await navigator.clipboard.writeText(html);
      showToast(t('admin.emailTemplates.htmlCopied'), 'success');
    } catch {
      showToast(t('admin.emailTemplates.htmlCopyFailed'), 'error');
    }
  };

  const handleSendTest = async () => {
    if (!testEmail.trim()) {
      showToast(t('admin.emailTemplates.enterEmail'), 'error');
      return;
    }
    setSendingTest(true);
    try {
      const html = generateEmailHtml(template, gymName, gymLogoUrl);
      const { error } = await supabase.functions.invoke('send-admin-email', {
        body: {
          to: testEmail.trim(),
          subject: `[Test] ${template.name || 'Email Template'}`,
          html,
          gym_id: profile?.gym_id,
        },
      });
      if (error) throw error;
      showToast(t('admin.emailTemplates.testSent'), 'success');
    } catch (err) {
      showToast(t('admin.emailTemplates.testFailed'), 'error');
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-0 h-full min-h-[calc(100vh-120px)]">
      {/* Left: Editor */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {/* Top bar */}
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={onCancel}
            className="p-2 rounded-lg text-[#6B7280] hover:text-[#E5E7EB] hover:bg-white/[0.04] transition-colors"
            aria-label={t('admin.emailTemplates.back')}
          >
            <ArrowLeft size={18} />
          </button>
          <h2 className="text-[16px] font-bold text-[#E5E7EB] flex-1">
            {initial.name ? t('admin.emailTemplates.editTemplate') : t('admin.emailTemplates.newTemplate')}
          </h2>
        </div>

        {/* Name & Type */}
        <AdminCard>
          <div className="space-y-3">
            <Field label={t('admin.emailTemplates.templateName')}>
              <input
                value={template.name}
                onChange={e => set('name', e.target.value)}
                placeholder={t('admin.emailTemplates.templateNamePlaceholder')}
                className={inputClass}
              />
            </Field>
            <Field label={t('admin.emailTemplates.templateType')}>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_TYPES.map(({ key, icon }) => (
                  <button
                    key={key}
                    onClick={() => set('type', key)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                      template.type === key
                        ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/25'
                        : 'bg-[#111827] text-[#6B7280] border border-white/6'
                    }`}
                  >
                    {icon} {t(`admin.emailTemplates.types.${key}`)}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </AdminCard>

        {/* Header Section */}
        <SectionBlock
          title={t('admin.emailTemplates.headerSection')}
          icon={Type}
          enabled={template.header.enabled}
          onToggle={v => set('header.enabled', v)}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[#9CA3AF]">{t('admin.emailTemplates.showLogo')}</span>
            <Toggle value={template.header.showLogo} onChange={v => set('header.showLogo', v)} label="Show logo" />
          </div>
          <Field label={t('admin.emailTemplates.headerText')}>
            <input
              value={template.header.text}
              onChange={e => set('header.text', e.target.value)}
              placeholder={t('admin.emailTemplates.headerTextPlaceholder')}
              className={inputClass}
            />
          </Field>
        </SectionBlock>

        {/* Hero Section */}
        <SectionBlock
          title={t('admin.emailTemplates.heroSection')}
          icon={Image}
          enabled={template.hero.enabled}
          onToggle={v => set('hero.enabled', v)}
        >
          <Field label={t('admin.emailTemplates.heroImageUrl')}>
            <input
              value={template.hero.imageUrl}
              onChange={e => set('hero.imageUrl', e.target.value)}
              placeholder="https://..."
              className={inputClass}
            />
          </Field>
          <Field label={t('admin.emailTemplates.heroHeadline')}>
            <input
              value={template.hero.headline}
              onChange={e => set('hero.headline', e.target.value)}
              placeholder={t('admin.emailTemplates.heroHeadlinePlaceholder')}
              className={inputClass}
            />
          </Field>
          <Field label={t('admin.emailTemplates.heroSubtitle')}>
            <input
              value={template.hero.subtitle}
              onChange={e => set('hero.subtitle', e.target.value)}
              placeholder={t('admin.emailTemplates.heroSubtitlePlaceholder')}
              className={inputClass}
            />
          </Field>
        </SectionBlock>

        {/* Body Section */}
        <SectionBlock title={t('admin.emailTemplates.bodySection')} icon={FileText} enabled={true}>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <span className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider mr-1 self-center">
              {t('admin.emailTemplates.insertVariable')}
            </span>
            {TEMPLATE_VARIABLES.map(v => (
              <VariablePill
                key={v.key}
                token={v.token}
                label={t(`admin.emailTemplates.variables.${v.key}`)}
                onClick={() => insertVariable(v.token)}
              />
            ))}
          </div>
          <textarea
            ref={bodyRef}
            value={template.body.text}
            onChange={e => set('body.text', e.target.value)}
            rows={10}
            placeholder={t('admin.emailTemplates.bodyPlaceholder')}
            className={`${inputClass} resize-y min-h-[160px]`}
          />
          <p className="text-[10px] text-[#6B7280]">{t('admin.emailTemplates.bodyHint')}</p>
        </SectionBlock>

        {/* CTA Section */}
        <SectionBlock
          title={t('admin.emailTemplates.ctaSection')}
          icon={MousePointerClick}
          enabled={template.cta.enabled}
          onToggle={v => set('cta.enabled', v)}
        >
          <Field label={t('admin.emailTemplates.ctaText')}>
            <input
              value={template.cta.text}
              onChange={e => set('cta.text', e.target.value)}
              placeholder={t('admin.emailTemplates.ctaTextPlaceholder')}
              className={inputClass}
            />
          </Field>
          <Field label={t('admin.emailTemplates.ctaUrl')}>
            <input
              value={template.cta.url}
              onChange={e => set('cta.url', e.target.value)}
              placeholder="https://..."
              className={inputClass}
            />
          </Field>
          <Field label={t('admin.emailTemplates.ctaColor')}>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={template.cta.color}
                onChange={e => set('cta.color', e.target.value)}
                className="w-8 h-8 rounded-lg border border-white/8 cursor-pointer bg-transparent"
              />
              <input
                value={template.cta.color}
                onChange={e => set('cta.color', e.target.value)}
                className={`${inputClass} flex-1`}
              />
            </div>
          </Field>
        </SectionBlock>

        {/* Footer Section */}
        <SectionBlock
          title={t('admin.emailTemplates.footerSection')}
          icon={FileText}
          enabled={template.footer.enabled}
          onToggle={v => set('footer.enabled', v)}
        >
          <Field label={t('admin.emailTemplates.footerText')}>
            <input
              value={template.footer.text}
              onChange={e => set('footer.text', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={t('admin.emailTemplates.unsubscribeText')}>
            <input
              value={template.footer.unsubscribeText}
              onChange={e => set('footer.unsubscribeText', e.target.value)}
              className={inputClass}
            />
          </Field>
        </SectionBlock>

        {/* Color Scheme */}
        <AdminCard>
          <p className="text-[12px] font-semibold text-[#6B7280] uppercase tracking-wider mb-3">
            {t('admin.emailTemplates.colorScheme')}
          </p>
          <div className="grid grid-cols-3 gap-3">
            {['primary', 'background', 'text'].map(key => (
              <Field key={key} label={t(`admin.emailTemplates.colors.${key}`)}>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={template.colors[key]}
                    onChange={e => set(`colors.${key}`, e.target.value)}
                    className="w-7 h-7 rounded border border-white/8 cursor-pointer bg-transparent flex-shrink-0"
                  />
                  <input
                    value={template.colors[key]}
                    onChange={e => set(`colors.${key}`, e.target.value)}
                    className={`${inputClass} text-[11px]`}
                  />
                </div>
              </Field>
            ))}
          </div>
        </AdminCard>

        {/* Send Test Email */}
        <AdminCard>
          <p className="text-[12px] font-semibold text-[#6B7280] uppercase tracking-wider mb-3">
            {t('admin.emailTemplates.sendTestTitle')}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={testEmail}
              onChange={e => setTestEmail(e.target.value)}
              placeholder={t('admin.emailTemplates.testEmailPlaceholder')}
              className={`${inputClass} flex-1`}
            />
            <button
              onClick={handleSendTest}
              disabled={sendingTest}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-[13px] text-[#E5E7EB] bg-white/[0.04] border border-white/8 hover:bg-white/[0.08] transition-colors disabled:opacity-50"
            >
              {sendingTest ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {t('admin.emailTemplates.sendTest')}
            </button>
          </div>
        </AdminCard>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pb-8">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-[13px] text-black bg-[var(--color-accent)] hover:brightness-90 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {t('admin.emailTemplates.save')}
          </button>
          <button
            onClick={handleExportHtml}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-[13px] text-[#E5E7EB] bg-white/[0.04] border border-white/8 hover:bg-white/[0.08] transition-colors"
          >
            <Copy size={15} /> {t('admin.emailTemplates.exportHtml')}
          </button>
        </div>
      </div>

      {/* Right: Live Preview */}
      <div className="hidden lg:flex flex-col w-[480px] flex-shrink-0 border-l border-white/6 bg-[#0a0a1a]">
        <LivePreview template={template} gymName={gymName} gymLogoUrl={gymLogoUrl} />
      </div>
    </div>
  );
}

// ── Template Card ────────────────────────────────────────────────
function TemplateCard({ template, onEdit, onDelete, onDuplicate, t }) {
  const typeInfo = TEMPLATE_TYPES.find(tt => tt.key === template.type) || TEMPLATE_TYPES[5];
  const updated = new Date(template.updatedAt || template.updated_at);
  const dateStr = updated.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <AdminCard className="group hover:border-[var(--color-accent)]/20 transition-colors cursor-pointer" onClick={() => onEdit(template)}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--color-accent)]/10 flex items-center justify-center flex-shrink-0 text-lg">
          {typeInfo.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{template.name}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] font-medium text-[var(--color-accent)]/80 bg-[var(--color-accent)]/8 px-2 py-0.5 rounded-full">
              {t(`admin.emailTemplates.types.${template.type}`)}
            </span>
            <span className="text-[11px] text-[#6B7280]">{dateStr}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={e => { e.stopPropagation(); onDuplicate(template); }}
            className="p-1.5 rounded-lg text-[#6B7280] hover:text-[var(--color-accent)] hover:bg-white/[0.04] transition-colors"
            aria-label={t('admin.emailTemplates.duplicate')}
            title={t('admin.emailTemplates.duplicate')}
          >
            <Copy size={14} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onEdit(template); }}
            className="p-1.5 rounded-lg text-[#6B7280] hover:text-[var(--color-accent)] hover:bg-white/[0.04] transition-colors"
            aria-label={t('admin.emailTemplates.edit')}
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(template.id); }}
            className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#EF4444] hover:bg-red-500/5 transition-colors"
            aria-label={t('admin.emailTemplates.delete')}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </AdminCard>
  );
}

// ── Pre-built Template Card ──────────────────────────────────────
function PrebuiltCard({ template, onUse, t }) {
  const typeInfo = TEMPLATE_TYPES.find(tt => tt.key === template.type) || TEMPLATE_TYPES[5];
  return (
    <AdminCard className="hover:border-[var(--color-accent)]/20 transition-colors">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--color-accent)]/10 flex items-center justify-center flex-shrink-0 text-lg">
          {typeInfo.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-[#E5E7EB]">{template.name}</p>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            {t(`admin.emailTemplates.types.${template.type}`)}
          </p>
        </div>
        <button
          onClick={() => onUse(template)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-[var(--color-accent)] bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/20 transition-colors"
        >
          <Sparkles size={13} /> {t('admin.emailTemplates.useTemplate')}
        </button>
      </div>
    </AdminCard>
  );
}

// ── Helper: Convert between DB row and local template shape ──────
function dbRowToTemplate(row) {
  const d = row.template_data || {};
  return {
    id: row.id,
    name: row.name,
    type: row.template_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    is_prebuilt: row.is_prebuilt,
    header: d.header || { enabled: true, showLogo: true, text: '' },
    hero: d.hero || { enabled: false, imageUrl: '', headline: '', subtitle: '' },
    body: d.body || { text: '' },
    cta: d.cta || { enabled: false, text: '', url: '', color: '#D4AF37' },
    footer: d.footer || { enabled: true, text: '', unsubscribeText: 'Unsubscribe' },
    colors: d.colors || { primary: '#D4AF37', background: '#ffffff', text: '#333333' },
  };
}

function templateToDbPayload(tpl, gymId) {
  return {
    ...(tpl.id && !tpl.id.startsWith('prebuilt-') ? { id: tpl.id } : {}),
    gym_id: gymId,
    name: tpl.name,
    template_type: tpl.type,
    is_prebuilt: false,
    template_data: {
      header: tpl.header,
      hero: tpl.hero,
      body: tpl.body,
      cta: tpl.cta,
      footer: tpl.footer,
      colors: tpl.colors,
    },
  };
}

// ── Main Page Component ──────────────────────────────────────────
export default function AdminEmailTemplates() {
  const { gymName, gymLogoUrl, profile } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation('pages');
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  const primaryColor = useMemo(() => {
    if (typeof document === 'undefined') return '#D4AF37';
    const val = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
    return val || '#D4AF37';
  }, []);

  const [editing, setEditing] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => { document.title = 'Admin - Email Templates | TuGymPR'; }, []);

  // ── Supabase query ─────────────────────────────────────────
  const { data: dbTemplates = [], isLoading } = useQuery({
    queryKey: adminKeys.emailTemplates(gymId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_email_templates')
        .select('*')
        .eq('gym_id', gymId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(dbRowToTemplate);
    },
    enabled: !!gymId,
  });

  const templates = dbTemplates;

  // ── Save mutation (insert or update) ────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (tpl) => {
      const payload = templateToDbPayload(tpl, gymId);
      // If template already exists in DB (has a real UUID), update it
      const isExisting = tpl.id && !tpl.id.startsWith('prebuilt-') && templates.some(t => t.id === tpl.id);
      if (isExisting) {
        const { error } = await supabase
          .from('gym_email_templates')
          .update({
            name: payload.name,
            template_type: payload.template_type,
            template_data: payload.template_data,
          })
          .eq('id', tpl.id)
          .eq('gym_id', gymId);
        if (error) throw error;
      } else {
        delete payload.id; // let DB generate UUID
        const { error } = await supabase
          .from('gym_email_templates')
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.emailTemplates(gymId) });
      setEditing(null);
      showToast(t('admin.emailTemplates.templateSaved'), 'success');
    },
    onError: () => {
      showToast(t('admin.emailTemplates.saveFailed'), 'error');
    },
  });

  // ── Delete mutation ─────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('gym_email_templates')
        .delete()
        .eq('id', id)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.emailTemplates(gymId) });
      setDeleteConfirm(null);
      showToast(t('admin.emailTemplates.templateDeleted'), 'success');
    },
    onError: () => {
      showToast(t('admin.emailTemplates.deleteFailed'), 'error');
    },
  });

  const prebuiltTemplates = useMemo(
    () => getPrebuiltTemplates(gymName, primaryColor),
    [gymName, primaryColor]
  );

  const handleSave = useCallback((tpl) => {
    saveMutation.mutate(tpl);
  }, [saveMutation]);

  const handleDelete = useCallback((id) => {
    deleteMutation.mutate(id);
  }, [deleteMutation]);

  const handleUsePrebuilt = useCallback((prebuilt) => {
    const tpl = {
      ...prebuilt,
      id: 'prebuilt-' + crypto.randomUUID(), // mark as new
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEditing(tpl);
  }, []);

  const handleDuplicate = useCallback((tpl) => {
    const dup = {
      ...JSON.parse(JSON.stringify(tpl)),
      id: 'prebuilt-' + crypto.randomUUID(), // mark as new so insert happens
      name: `${tpl.name} (copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEditing(dup);
  }, []);

  const handleNewTemplate = useCallback(() => {
    setEditing(defaultTemplate(gymName, primaryColor));
  }, [gymName, primaryColor]);

  // ── Editor view ──────────────────────────────────────────────
  if (editing) {
    return (
      <div className="min-h-screen">
        <TemplateEditor
          initial={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          gymName={gymName}
          gymLogoUrl={gymLogoUrl}
          primaryColor={primaryColor}
          saving={saveMutation.isPending}
        />
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────
  return (
    <div className="px-4 md:px-8 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto">
      <PageHeader
        title={t('admin.emailTemplates.title')}
        subtitle={t('admin.emailTemplates.subtitle')}
        className="mb-6"
      />

      {/* Actions */}
      <FadeIn>
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={handleNewTemplate}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-[13px] text-black bg-[var(--color-accent)] hover:brightness-90 transition-colors"
          >
            <Plus size={16} /> {t('admin.emailTemplates.createNew')}
          </button>
        </div>
      </FadeIn>

      {/* Saved Templates */}
      <FadeIn delay={60}>
        <div className="mb-8">
          <p className="text-[12px] font-semibold text-[#6B7280] uppercase tracking-wider mb-3">
            {t('admin.emailTemplates.savedTemplates')} ({templates.length})
          </p>
          {isLoading ? (
            <AdminCard>
              <div className="flex items-center justify-center py-8">
                <Loader2 size={24} className="animate-spin text-[#6B7280]" />
              </div>
            </AdminCard>
          ) : templates.length === 0 ? (
            <AdminCard>
              <div className="text-center py-8">
                <Mail size={32} className="mx-auto text-[#6B7280] mb-3" />
                <p className="text-[14px] text-[#9CA3AF]">{t('admin.emailTemplates.noTemplates')}</p>
                <p className="text-[12px] text-[#6B7280] mt-1">{t('admin.emailTemplates.noTemplatesHint')}</p>
              </div>
            </AdminCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {templates.map(tpl => (
                <TemplateCard
                  key={tpl.id}
                  template={tpl}
                  onEdit={setEditing}
                  onDelete={id => setDeleteConfirm(id)}
                  onDuplicate={handleDuplicate}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      </FadeIn>

      {/* Pre-built Templates */}
      <FadeIn delay={120}>
        <div>
          <p className="text-[12px] font-semibold text-[#6B7280] uppercase tracking-wider mb-3">
            {t('admin.emailTemplates.starterTemplates')} ({prebuiltTemplates.length})
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {prebuiltTemplates.map(tpl => (
              <PrebuiltCard
                key={tpl.id}
                template={tpl}
                onUse={handleUsePrebuilt}
                t={t}
              />
            ))}
          </div>
        </div>
      </FadeIn>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <AdminModal onClose={() => setDeleteConfirm(null)}>
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-[#EF4444]" />
            </div>
            <h3 className="text-[16px] font-bold text-[#E5E7EB] mb-2">
              {t('admin.emailTemplates.confirmDelete')}
            </h3>
            <p className="text-[13px] text-[#9CA3AF] mb-6">
              {t('admin.emailTemplates.confirmDeleteDesc')}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-[#9CA3AF] bg-white/[0.04] border border-white/8 hover:bg-white/[0.08] transition-colors"
              >
                {t('admin.emailTemplates.cancel')}
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 rounded-xl text-[13px] font-bold text-white bg-[#EF4444] hover:bg-[#DC2626] transition-colors disabled:opacity-50"
              >
                {deleteMutation.isPending ? <Loader2 size={15} className="animate-spin inline mr-1" /> : null}
                {t('admin.emailTemplates.deleteConfirm')}
              </button>
            </div>
          </div>
        </AdminModal>
      )}
    </div>
  );
}
