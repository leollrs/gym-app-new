import React from 'react';
import SimpleShareSheet from './SimpleShareSheet';
import ShareTplSticker from './ShareTplSticker';
import ShareTplBodyComp from './ShareTplBodyComp';
import { useTranslation } from 'react-i18next';
import { PROD_WEB_URL } from '../../lib/appUrls';

// Thin wrappers around SimpleShareSheet + ShareTplSticker for the share
// surfaces that aren't full workout sessions. Each one assembles its own
// `data` shape and headline string, then delegates the format / sticker /
// destination plumbing to SimpleShareSheet.
//
// The single ShareTplSticker template handles all four kinds via its `kind`
// prop — the only thing each wrapper customizes is the data and the share
// caption. Keeping all four together so they stay visually consistent and
// new kinds can be added in one place.

// ── PR (single personal record) ──────────────────────────────────────────
export function SharePRSheet({ open, onClose, pr, user, gym, gymLogo }) {
  const { t } = useTranslation('pages');
  if (!pr) return null;

  const data = {
    prValue: pr.value,
    prUnit: pr.unit || 'lbs',
    prExercise: pr.exerciseName,
    prPrevious: pr.previousBest,
    gym, gymLogo,
    user: user?.full_name || user?.username,
  };
  const caption = t(
    'share.prCaption',
    { defaultValue: 'New PR — {{ex}} · {{val}} {{unit}}', ex: pr.exerciseName, val: pr.value, unit: pr.unit || 'lbs' }
  );

  return (
    <SimpleShareSheet
      open={open}
      onClose={onClose}
      title={t('share.titlePR', 'Share PR')}
      shareLink={`${PROD_WEB_URL}/pr/${pr.id || ''}`}
      shareText={caption}
      accent="#D4AF37"
      renderCard={({ w, h, transparent, accent }) => (
        <ShareTplSticker w={w} h={h} data={data} accent={accent} kind="pr" showGym={!!gym} />
      )}
    />
  );
}

// ── Streak milestone ─────────────────────────────────────────────────────
export function ShareStreakSheet({ open, onClose, streakDays, milestone, user, gym, gymLogo }) {
  const { t } = useTranslation('pages');
  if (!streakDays) return null;

  // Milestone label drives subtitle copy. Falls back to "Day N" for any
  // non-canonical day so a user celebrating their own 23-day streak still
  // gets a clean share.
  const milestones = { 7: 'One week strong', 14: 'Two weeks deep', 30: 'A month locked in', 90: '90 days · The Quarter', 180: 'Half a year', 365: 'One full year' };
  const subtitle = milestones[milestone || streakDays] || `Day ${streakDays}`;

  const data = {
    streakDays,
    streakSubtitle: subtitle,
    gym, gymLogo,
    user: user?.full_name || user?.username,
  };
  const caption = t('share.streakCaption', {
    defaultValue: '{{n}}-day streak on TuGymPR 🔥', n: streakDays,
  });

  return (
    <SimpleShareSheet
      open={open}
      onClose={onClose}
      title={t('share.titleStreak', 'Share streak')}
      shareLink={`${PROD_WEB_URL}/streak`}
      shareText={caption}
      accent="#FF5A2E"
      renderCard={({ w, h, transparent, accent }) => (
        <ShareTplSticker w={w} h={h} data={data} accent={accent} kind="streak" showGym={!!gym} />
      )}
    />
  );
}

// ── Body composition (before / after photos) ────────────────────────────
// Different template (ShareTplBodyComp) — photos can't be a sticker on the
// user's own IG photo because the photos ARE the content. `allowSticker`
// is forced off here.
export function ShareBodyCompSheet({ open, onClose, comp, user, gym, gymLogo }) {
  const { t } = useTranslation('pages');
  if (!comp || !comp.beforeUrl || !comp.afterUrl) return null;

  const data = {
    beforeUrl: comp.beforeUrl,
    afterUrl: comp.afterUrl,
    beforeLabel: comp.beforeLabel,
    afterLabel: comp.afterLabel,
    deltaLbs: comp.deltaLbs,
    deltaPct: comp.deltaPct,
    daysApart: comp.daysApart,
    beforeBfPct: comp.beforeBfPct,
    afterBfPct: comp.afterBfPct,
    gym, gymLogo,
    user: user?.full_name || user?.username,
  };
  const direction = comp.deltaLbs < 0 ? 'lost' : 'gained';
  const caption = comp.deltaLbs != null && comp.daysApart
    ? t('share.bodyCompCaption', {
        defaultValue: '{{dir}} {{n}} lb in {{d}} days on TuGymPR',
        dir: direction,
        n: Math.abs(comp.deltaLbs).toFixed(1),
        d: comp.daysApart,
      })
    : t('share.bodyCompCaptionShort', { defaultValue: 'Progress on TuGymPR' });

  return (
    <SimpleShareSheet
      open={open}
      onClose={onClose}
      title={t('share.titleBodyComp', 'Share progress')}
      shareLink={`${PROD_WEB_URL}/progress`}
      shareText={caption}
      accent="#2EC4C4"
      allowSticker={false}
      renderCard={({ w, h, transparent, accent }) => (
        <ShareTplBodyComp w={w} h={h} data={data} accent={accent} transparent={transparent} />
      )}
    />
  );
}

// ── Monthly recap ────────────────────────────────────────────────────────
export function ShareMonthlySheet({ open, onClose, recap, user, gym, gymLogo }) {
  const { t } = useTranslation('pages');
  if (!recap) return null;

  const data = {
    monthLabel: recap.monthLabel,     // e.g. "MAY 2026"
    monthlyHeadline: recap.headline,  // e.g. "Strongest month yet"
    workoutsCount: recap.workouts,
    volume: recap.totalVolumeLbs,
    prCount: recap.prCount,
    streakDays: recap.streakDays,
    gym, gymLogo,
    user: user?.full_name || user?.username,
  };
  const caption = t('share.monthlyCaption', {
    defaultValue: '{{label}} on TuGymPR — {{n}} workouts',
    label: recap.monthLabel,
    n: recap.workouts,
  });

  return (
    <SimpleShareSheet
      open={open}
      onClose={onClose}
      title={t('share.titleMonthly', 'Share month')}
      shareLink={`${PROD_WEB_URL}/recap`}
      shareText={caption}
      accent="#2EC4C4"
      renderCard={({ w, h, transparent, accent }) => (
        <ShareTplSticker w={w} h={h} data={data} accent={accent} kind="monthly" showGym={!!gym} />
      )}
    />
  );
}
