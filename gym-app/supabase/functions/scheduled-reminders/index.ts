import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// APNs config (reused from send-push-user)
const APNS_KEY_ID = Deno.env.get('APNS_KEY_ID') || '';
const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID') || '';
const APNS_PRIVATE_KEY = Deno.env.get('APNS_PRIVATE_KEY') || '';
// Default to APNs PRODUCTION host. Sandbox (api.sandbox.push.apple.com) is for
// dev builds only and MUST be set explicitly via the APNS_HOST env var.
const APNS_HOST = Deno.env.get('APNS_HOST') || 'api.push.apple.com';
const APNS_BUNDLE_ID = 'com.tugympr.app';

// FCM config
const FCM_PROJECT_ID = Deno.env.get('FCM_PROJECT_ID') || '';
const FCM_CLIENT_EMAIL = Deno.env.get('FCM_CLIENT_EMAIL') || '';
const FCM_PRIVATE_KEY = Deno.env.get('FCM_PRIVATE_KEY') || '';

import { decode as base64Decode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';

// ── Timing-safe comparison (HMAC-based, no length leak) ─────
// Mirrors the helper in auto-assign-referral-rewards / compute-churn-scores.
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const keyA = await crypto.subtle.importKey('raw', enc.encode(a), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const keyB = await crypto.subtle.importKey('raw', enc.encode(b), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const msg = enc.encode('timing-safe-compare');
  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign('HMAC', keyA, msg),
    crypto.subtle.sign('HMAC', keyB, msg),
  ]);
  const bytesA = new Uint8Array(sigA);
  const bytesB = new Uint8Array(sigB);
  if (bytesA.length !== bytesB.length) return false;
  let result = 0;
  for (let i = 0; i < bytesA.length; i++) result |= bytesA[i] ^ bytesB[i];
  return result === 0;
}

// ── Local time helpers ──────────────────────────────────────
function localHour(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', hour12: false, timeZone: timezone,
    }).formatToParts(new Date());
    const hourStr = parts.find(p => p.type === 'hour')?.value ?? '0';
    let hour = parseInt(hourStr, 10);
    if (hour === 24) hour = 0;
    return hour;
  } catch {
    return new Date().getUTCHours();
  }
}

function localDayOfWeek(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', timeZone: timezone,
    }).formatToParts(new Date());
    const wd = parts.find(p => p.type === 'weekday')?.value ?? 'Sun';
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  } catch {
    return new Date().getUTCDay();
  }
}

// Apple G4.5.4 + general UX: no pushes between 10pm and 7am local time.
// Returns true if the push should be SKIPPED (in-app row still inserted).
function isQuietHours(timezone: string): boolean {
  const hour = localHour(timezone);
  return hour >= 22 || hour < 7;
}

// ── APNs JWT ────────────────────────────────────────────────
let apnsJwtCache: { jwt: string; expiresAt: number } | null = null;

async function getAPNsJWT(): Promise<string> {
  if (apnsJwtCache && Date.now() < apnsJwtCache.expiresAt) return apnsJwtCache.jwt;
  const header = { alg: 'ES256', kid: APNS_KEY_ID };
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: APNS_TEAM_ID, iat: now };
  const b64url = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const unsigned = `${b64url(header)}.${b64url(claims)}`;
  const pemBody = APNS_PRIVATE_KEY.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
  const keyData = base64Decode(pemBody);
  const cryptoKey = await crypto.subtle.importKey('pkcs8', keyData, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, new TextEncoder().encode(unsigned));
  const sigBytes = new Uint8Array(sig);
  let sigB64: string;
  if (sigBytes.length > 64) {
    let offset = 2;
    if (sigBytes[1] > 0x80) offset += (sigBytes[1] - 0x80);
    offset++;
    const rLen = sigBytes[offset++];
    const r = sigBytes.slice(offset, offset + rLen);
    offset += rLen; offset++;
    const sLen = sigBytes[offset++];
    const s = sigBytes.slice(offset, offset + sLen);
    const pad32 = (buf: Uint8Array) => { if (buf.length === 32) return buf; if (buf.length > 32) return buf.slice(buf.length - 32); const p = new Uint8Array(32); p.set(buf, 32 - buf.length); return p; };
    const raw = new Uint8Array(64); raw.set(pad32(r), 0); raw.set(pad32(s), 32);
    sigB64 = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } else {
    sigB64 = btoa(String.fromCharCode(...sigBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  const jwt = `${unsigned}.${sigB64}`;
  apnsJwtCache = { jwt, expiresAt: Date.now() + 50 * 60 * 1000 };
  return jwt;
}

// ── FCM OAuth ───────────────────────────────────────────────
let fcmTokenCache: { token: string; expiresAt: number } | null = null;

async function getFCMAccessToken(): Promise<string> {
  if (fcmTokenCache && Date.now() < fcmTokenCache.expiresAt) return fcmTokenCache.token;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: FCM_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const b64url = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const unsigned = `${b64url(header)}.${b64url(claims)}`;
  const pemBody = FCM_PRIVATE_KEY.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
  const keyData = base64Decode(pemBody);
  const key = await crypto.subtle.importKey('pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const jwt = `${unsigned}.${sigB64}`;
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` });
  if (!res.ok) throw new Error(`FCM OAuth failed: ${res.status}`);
  const { access_token, expires_in } = await res.json();
  fcmTokenCache = { token: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

// ── Send push to a user's devices ───────────────────────────
// `skipPush` — when true, no push is sent (caller has already decided this
// based on quiet hours / per-user opt-out). The DB notification row is still
// written by the caller, mirroring the client-side quiet-hours pattern.
async function sendPush(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
  title: string,
  body: string,
  data: Record<string, string> = {},
  skipPush = false,
) {
  if (skipPush) return;
  const { data: tokens } = await supabase.from('push_tokens').select('token, platform').eq('profile_id', profileId);
  if (!tokens?.length) return;

  const iosTokens = tokens.filter(t => t.platform === 'ios').map(t => t.token);
  const androidTokens = tokens.filter(t => t.platform === 'android').map(t => t.token);

  // iOS — try the configured APNs host first; on an environment-mismatch
  // error (BadDeviceToken / BadEnvironmentKeyInToken) retry the OTHER host.
  // Dev/Xcode builds register *sandbox* tokens, TestFlight/App Store builds
  // register *production* tokens. APNs is the source of truth for which is
  // which, so we let it tell us instead of guessing per build channel —
  // one function serves dev testers and TestFlight users alike.
  if (iosTokens.length > 0 && APNS_KEY_ID && APNS_TEAM_ID && APNS_PRIVATE_KEY) {
    let jwt: string;
    try {
      jwt = await getAPNsJWT();
    } catch (e) {
      // Don't swallow this — a signing failure means ZERO iOS pushes go out.
      console.error('sendPush: getAPNsJWT failed:', e instanceof Error ? e.message : String(e));
      return;
    }
    const otherHost = APNS_HOST === 'api.sandbox.push.apple.com'
      ? 'api.push.apple.com'
      : 'api.sandbox.push.apple.com';
    const hostsToTry = [APNS_HOST, otherHost];
    const payload = JSON.stringify({ aps: { alert: { title, body }, sound: 'default', badge: 1, 'mutable-content': 1 }, ...data });
    for (const token of iosTokens) {
      let lastStatus = 0;
      let lastReason = '';
      for (let i = 0; i < hostsToTry.length; i++) {
        try {
          const res = await fetch(`https://${hostsToTry[i]}/3/device/${token}`, {
            method: 'POST',
            headers: { 'authorization': `bearer ${jwt}`, 'apns-topic': APNS_BUNDLE_ID, 'apns-push-type': 'alert', 'apns-priority': '10', 'content-type': 'application/json' },
            body: payload,
          });
          lastStatus = res.status;
          if (res.status === 200) break; // delivered — done with this token
          const respBody = await res.text();
          try { lastReason = JSON.parse(respBody)?.reason || ''; } catch { lastReason = respBody; }
          // An environment mismatch is the only thing worth retrying on the
          // other host — and only if another host is left to try.
          const envMismatch = lastReason === 'BadDeviceToken' || lastReason === 'BadEnvironmentKeyInToken';
          if (envMismatch && i < hostsToTry.length - 1) continue;
          // Non-env error, or env error after all hosts exhausted → stop.
          break;
        } catch (e) {
          console.error('sendPush: APNs fetch threw:', e instanceof Error ? e.message : String(e));
          lastStatus = -1;
          break; // network error — don't hammer the other host
        }
      }
      // Prune genuinely dead tokens. 410 = the app was uninstalled
      // (environment-agnostic). A BadDeviceToken that failed on BOTH hosts
      // is invalid everywhere. Transient errors (429/500/network) are left
      // alone so we don't drop a token over a blip.
      if (lastStatus === 410 || (lastStatus === 400 && lastReason === 'BadDeviceToken')) {
        await supabase.from('push_tokens').delete().eq('token', token);
      }
    }
  }

  // Android (FCM) — no sandbox/production split, single endpoint.
  if (androidTokens.length > 0 && FCM_PROJECT_ID && FCM_CLIENT_EMAIL && FCM_PRIVATE_KEY) {
    let accessToken: string;
    try {
      accessToken = await getFCMAccessToken();
    } catch (e) {
      console.error('sendPush: getFCMAccessToken failed:', e instanceof Error ? e.message : String(e));
      return;
    }
    for (const token of androidTokens) {
      try {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: { token, notification: { title, body }, data, android: { priority: 'high' } } }),
        });
        // 404 = token no longer registered, 400 = invalid — prune either.
        if (res.status === 404 || res.status === 400) {
          await supabase.from('push_tokens').delete().eq('token', token);
        } else if (res.status !== 200) {
          console.warn(`sendPush: FCM ${res.status} for token ${token.slice(0, 10)}…`);
        }
      } catch (e) {
        console.error('sendPush: FCM fetch threw:', e instanceof Error ? e.message : String(e));
      }
    }
  }
}

// ── Insert notification with dedup ──────────────────────────
async function insertNotif(supabase: ReturnType<typeof createClient>, profileId: string, gymId: string, type: string, title: string, body: string, dedupKey: string) {
  const { error } = await supabase.from('notifications').insert({
    profile_id: profileId, gym_id: gymId, type, title, body, dedup_key: dedupKey,
  });
  if (error && error.code !== '23505') console.warn('Notification insert failed:', profileId, error.message);
  return !error || error.code === '23505'; // true if inserted or already exists
}

// ── Language helper ─────────────────────────────────────────
function msg(lang: string, en: string, es: string) { return lang === 'es' ? es : en; }

// ═══════════════════════════════════════════════════════════════
//  REMINDER CHECKS
// ═══════════════════════════════════════════════════════════════

const MS_PER_DAY = 86400000;

interface Member {
  id: string;
  gym_id: string;
  full_name: string;
  language: string | null;
  // English day names: ['Monday','Wednesday','Friday'] — see migration 0059.
  preferred_training_days: string[] | null;
  last_active_at: string | null;
  created_at: string;
  // Resolved timezone for quiet-hours computation. Pulled from
  // profiles.timezone if/when that column exists, otherwise gyms.timezone,
  // otherwise 'America/New_York'.
  timezone: string;
  // notif_reengagement opt-in for re-engagement / "we miss you" pushes
  // (Apple G4.5.4 — re-engagement requires explicit opt-in). The column
  // does not exist yet — `null` (legacy) is treated as enabled. The
  // upcoming migration will add this column DEFAULT FALSE so new accounts
  // must opt in explicitly. Flag for the migration agent.
  notif_reengagement: boolean | null;
  // Per-category opt-out columns (migration 0097)
  notif_workout_reminders: boolean | null;
  notif_streak_alerts: boolean | null;
  notif_friend_activity: boolean | null;
  notif_push_enabled: boolean | null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function checkWorkoutReminder(supabase: ReturnType<typeof createClient>, member: Member, today: string, dayOfWeek: number) {
  if (member.notif_workout_reminders === false) return;

  // Only on their preferred training days (English day names — see migration 0059)
  const todayName = DAY_NAMES[dayOfWeek];
  const trainingDays = member.preferred_training_days || [];
  if (trainingDays.length > 0 && !trainingDays.includes(todayName)) return;

  const lang = member.language || 'en';
  const dedupKey = `sched_workout_${member.id}_${today}`;
  const firstName = member.full_name?.split(' ')[0] || '';

  // Check if already sent today
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true })
    .eq('profile_id', member.id).like('dedup_key', `sched_workout_${member.id}_${today}%`);
  if ((count ?? 0) >= 2) return; // max 2 per day

  // Check if they already worked out today
  const { count: sessionsToday } = await supabase.from('workout_sessions').select('id', { count: 'exact', head: true })
    .eq('profile_id', member.id).eq('status', 'completed').gte('started_at', today);
  if ((sessionsToday ?? 0) > 0) return;

  // Try to find a matching routine for variety (rotate by day index in their training schedule)
  let routineName: string | null = null;
  const dayIdx = trainingDays.indexOf(todayName);
  if (dayIdx >= 0) {
    const { data: routines } = await supabase.from('routines')
      .select('id, name')
      .eq('created_by', member.id)
      .eq('is_template', false)
      .order('created_at', { ascending: true });
    if (routines?.length) routineName = routines[dayIdx % routines.length]?.name || null;
  }

  let title: string, body: string;
  if (routineName) {
    title = msg(lang,
      firstName ? `${firstName}, it's ${routineName} day` : `It's ${routineName} day`,
      firstName ? `${firstName}, hoy toca ${routineName}` : `Hoy toca ${routineName}`,
    );
    body = msg(lang,
      `Your ${routineName} session is waiting. Hit it before the day gets away from you.`,
      `Tu sesión de ${routineName} te espera. Dale antes de que se te pase el día.`,
    );
  } else {
    title = msg(lang,
      firstName ? `${firstName}, gym time` : 'Gym time',
      firstName ? `${firstName}, hora de entrenar` : 'Hora de entrenar',
    );
    body = msg(lang,
      `Today's a training day. ${todayName} is on the schedule — own it.`,
      `Hoy toca entrenar. Está en tu plan — a por ello.`,
    );
  }

  const suffix = (count ?? 0) === 0 ? '' : '_2';
  await insertNotif(supabase, member.id, member.gym_id, 'workout_reminder', title, body, dedupKey + suffix);
  await sendPush(supabase, member.id, title, body, { route: '/workouts', type: 'workout_reminder' }, isQuietHours(member.timezone));
}

async function checkStreakAtRisk(supabase: ReturnType<typeof createClient>, member: Member, today: string) {
  if (member.notif_streak_alerts === false) return;

  const { data: streakData } = await supabase.from('streak_cache')
    .select('current_streak_days, last_activity_date')
    .eq('profile_id', member.id).maybeSingle();

  // Column was renamed in migration 0352 — old `current_streak` no longer exists.
  const streak = streakData?.current_streak_days || 0;
  if (!streakData || streak < 3) return;

  // Check if last activity was yesterday
  const lastDate = new Date(streakData.last_activity_date);
  const todayDate = new Date(today);
  const diffDays = Math.floor((todayDate.getTime() - lastDate.getTime()) / MS_PER_DAY);
  if (diffDays !== 1) return; // only if exactly yesterday

  const dedupKey = `sched_streak_${member.id}_${today}`;
  const lang = member.language || 'en';
  const firstName = member.full_name?.split(' ')[0] || '';

  const title = msg(lang,
    firstName ? `${firstName}, your streak ends at midnight 🔥` : 'Your streak ends at midnight 🔥',
    firstName ? `${firstName}, tu racha termina a medianoche 🔥` : 'Tu racha termina a medianoche 🔥',
  );
  const body = msg(lang,
    `Your ${streak}-day streak ends at midnight. 30 minutes today and it survives.`,
    `Tu racha de ${streak} días termina a medianoche. 30 minutos hoy y la salvas.`
  );

  await insertNotif(supabase, member.id, member.gym_id, 'streak_warning', title, body, dedupKey);
  await sendPush(supabase, member.id, title, body, { route: '/', type: 'streak_warning' }, isQuietHours(member.timezone));
}

async function checkReengagement(supabase: ReturnType<typeof createClient>, member: Member, today: string, nowMs: number) {
  const lastActive = member.last_active_at ? new Date(member.last_active_at).getTime() : new Date(member.created_at).getTime();
  const daysInactive = Math.floor((nowMs - lastActive) / MS_PER_DAY);

  if (daysInactive < 3) return;

  // Max 1 reengagement per 3 days
  const threeDaysAgo = new Date(nowMs - 3 * MS_PER_DAY).toISOString();
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true })
    .eq('profile_id', member.id).like('dedup_key', 'sched_reengage_%').gte('created_at', threeDaysAgo);
  if ((count ?? 0) > 0) return;

  const lang = member.language || 'en';
  const firstName = member.full_name?.split(' ')[0] || '';
  const dedupKey = `sched_reengage_${member.id}_${today}`;

  let title: string, body: string;
  if (daysInactive >= 14) {
    title = msg(lang,
      firstName ? `${firstName}, ready to come back?` : 'Ready to come back?',
      firstName ? `${firstName}, ¿listo para volver?` : '¿Listo para volver?',
    );
    body = msg(lang,
      "It's been a while. One light session today and you're back in motion — we're not keeping score.",
      'Ha pasado un tiempo. Una sesión ligera hoy y vuelves a moverte — no llevamos la cuenta.',
    );
  } else if (daysInactive >= 7) {
    title = msg(lang,
      firstName ? `${firstName}, ready to come back?` : 'Ready to come back?',
      firstName ? `${firstName}, ¿listo para volver?` : '¿Listo para volver?',
    );
    body = msg(lang,
      `Over a week off. ${firstName ? firstName + ', ' : ''}your body's ready — even a light session puts you back on track.`,
      `Más de una semana fuera. ${firstName ? firstName + ', ' : ''}tu cuerpo está listo — incluso una sesión ligera te devuelve al ritmo.`,
    );
  } else if (daysInactive >= 5) {
    title = msg(lang,
      firstName ? `${firstName}, don't lose momentum` : "Don't lose momentum",
      firstName ? `${firstName}, no pierdas el impulso` : 'No pierdas el impulso',
    );
    body = msg(lang,
      `${firstName ? firstName + ', ' : ''}you're 5 days out. Don't lose the progress you built.`,
      `${firstName ? firstName + ', ' : ''}llevas 5 días sin entrenar. No pierdas lo que has construido.`,
    );
  } else {
    title = msg(lang,
      firstName ? `${firstName}, don't lose momentum` : "Don't lose momentum",
      firstName ? `${firstName}, no pierdas el impulso` : 'No pierdas el impulso',
    );
    body = msg(lang,
      `${firstName ? firstName + ', ' : ''}${daysInactive} days off. Ten minutes today rebuilds the habit.`,
      `${firstName ? firstName + ', ' : ''}${daysInactive} días sin entrenar. Diez minutos hoy reconstruyen el hábito.`,
    );
  }

  // Apple G4.5.4: re-engagement / "we miss you" pushes require explicit opt-in.
  // Gate the PUSH on notif_reengagement (treat null/legacy as opt-in for
  // backward compatibility — the upcoming migration will add this column
  // DEFAULT FALSE so new accounts must opt in explicitly). The in-app
  // notification row is always written regardless, since other lifecycle
  // automation (admin dashboards, in-app surfacing) still depends on it.
  await insertNotif(supabase, member.id, member.gym_id, 'churn_followup', title, body, dedupKey);
  const reengagementOptedIn = member.notif_reengagement !== false; // null/true → allow
  const skipPush = !reengagementOptedIn || isQuietHours(member.timezone);
  await sendPush(supabase, member.id, title, body, { route: '/', type: 'churn_followup' }, skipPush);
}

async function checkNutritionReminder(supabase: ReturnType<typeof createClient>, member: Member, today: string) {
  // Only if member has logged food before (correct table is `food_logs` plural — see migration 0048)
  const { count: foodLogs } = await supabase.from('food_logs').select('id', { count: 'exact', head: true })
    .eq('profile_id', member.id).limit(1);
  if ((foodLogs ?? 0) === 0) return;

  // Only if they haven't logged food today (column is `log_date` DATE — not `logged_at`)
  const { count: todayLogs } = await supabase.from('food_logs').select('id', { count: 'exact', head: true })
    .eq('profile_id', member.id).eq('log_date', today);
  if ((todayLogs ?? 0) > 0) return;

  // Max 1 per day
  const dedupKey = `sched_nutrition_${member.id}_${today}`;
  const lang = member.language || 'en';
  const firstName = member.full_name?.split(' ')[0] || '';

  const title = msg(lang,
    firstName ? `${firstName}, log today's food` : "Log today's food",
    firstName ? `${firstName}, registra la comida de hoy` : 'Registra la comida de hoy',
  );
  const body = msg(lang,
    'Nothing tracked yet. Even a quick estimate keeps you on target.',
    'Aún no has registrado nada. Una estimación rápida te mantiene en tus números.',
  );

  await insertNotif(supabase, member.id, member.gym_id, 'workout_reminder', title, body, dedupKey);
  await sendPush(supabase, member.id, title, body, { route: '/nutrition', type: 'workout_reminder' }, isQuietHours(member.timezone));
}

async function checkRestDay(supabase: ReturnType<typeof createClient>, member: Member, today: string, dayOfWeek: number) {
  if (member.notif_workout_reminders === false) return;

  const trainingDays = member.preferred_training_days || [];
  if (!trainingDays.length) return;

  const todayName = DAY_NAMES[dayOfWeek];
  if (trainingDays.includes(todayName)) return; // training day — different notif fires

  const dedupKey = `sched_rest_${member.id}_${today}`;
  // Already sent today?
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true })
    .eq('profile_id', member.id).eq('dedup_key', dedupKey);
  if ((count ?? 0) > 0) return;

  // Only acknowledge for members training in the last 7 days — don't congratulate ghost users
  const weekAgo = new Date(Date.now() - 7 * MS_PER_DAY).toISOString();
  const { count: recent } = await supabase.from('workout_sessions').select('id', { count: 'exact', head: true })
    .eq('profile_id', member.id).eq('status', 'completed').gte('started_at', weekAgo);
  if ((recent ?? 0) === 0) return;

  // Find next training day + matching routine
  let nextTrainingDay: string | null = null;
  for (let offset = 1; offset <= 7; offset++) {
    const candidate = DAY_NAMES[(dayOfWeek + offset) % 7];
    if (trainingDays.includes(candidate)) { nextTrainingDay = candidate; break; }
  }

  let nextRoutineName: string | null = null;
  if (nextTrainingDay) {
    const { data: routines } = await supabase.from('routines')
      .select('id, name')
      .eq('created_by', member.id)
      .eq('is_template', false)
      .order('created_at', { ascending: true });
    if (routines?.length) {
      const dayIdx = trainingDays.indexOf(nextTrainingDay);
      nextRoutineName = routines[dayIdx % routines.length]?.name || null;
    }
  }

  const lang = member.language || 'en';
  const firstName = member.full_name?.split(' ')[0] || '';

  const title = msg(lang,
    firstName ? `Rest day, ${firstName} 🛌` : 'Rest day 🛌',
    firstName ? `Día de descanso, ${firstName} 🛌` : 'Día de descanso 🛌',
  );

  let body: string;
  if (nextRoutineName && nextTrainingDay) {
    body = msg(lang,
      `${nextTrainingDay} is ${nextRoutineName} day — eat well, sleep deep.`,
      `${nextTrainingDay} toca ${nextRoutineName} — come bien, duerme profundo.`,
    );
  } else {
    body = msg(lang,
      'Recovery is where the gains lock in. Be ready tomorrow.',
      'La recuperación es donde se consolidan las ganancias. Mañana lo das todo.',
    );
  }

  await insertNotif(supabase, member.id, member.gym_id, 'workout_reminder', title, body, dedupKey);
  await sendPush(supabase, member.id, title, body, { route: '/', type: 'rest_day' }, isQuietHours(member.timezone));
}

async function checkWeightLogReminder(supabase: ReturnType<typeof createClient>, member: Member, today: string, nowMs: number) {
  // Correct table is `body_weight_logs` (no `body_metrics` table) — see initial schema.
  const { data: lastLog } = await supabase.from('body_weight_logs')
    .select('logged_at').eq('profile_id', member.id)
    .order('logged_at', { ascending: false }).limit(1).maybeSingle();

  if (!lastLog) return; // never logged weight — don't nag

  const daysSinceLog = Math.floor((nowMs - new Date(lastLog.logged_at).getTime()) / MS_PER_DAY);
  if (daysSinceLog < 7) return;

  // Max 1 per week
  const weekAgo = new Date(nowMs - 7 * MS_PER_DAY).toISOString();
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true })
    .eq('profile_id', member.id).like('dedup_key', 'sched_weight_%').gte('created_at', weekAgo);
  if ((count ?? 0) > 0) return;

  const dedupKey = `sched_weight_${member.id}_${today}`;
  const lang = member.language || 'en';
  const firstName = member.full_name?.split(' ')[0] || '';

  const title = msg(lang,
    firstName ? `${firstName}, time to weigh in` : 'Time to weigh in',
    firstName ? `${firstName}, hora de pesarte` : 'Hora de pesarte',
  );
  const body = msg(lang,
    `${daysSinceLog} days since your last log. Track it now.`,
    `${daysSinceLog} días desde tu último registro. Regístralo ya.`,
  );

  await insertNotif(supabase, member.id, member.gym_id, 'workout_reminder', title, body, dedupKey);
  await sendPush(supabase, member.id, title, body, { route: '/progress', type: 'workout_reminder' }, isQuietHours(member.timezone));
}

// ═══════════════════════════════════════════════════════════════
//  MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  // ── Auth: require valid cron secret OR service-role token ──
  // Existing pg_cron job (migration 0280) sends Authorization: Bearer <service_role_key>.
  // Newer cron entries should send X-Cron-Secret. Either is accepted so the
  // existing pg_cron schedule keeps working without a forced migration.
  const cronSecret = Deno.env.get('CRON_SECRET');
  const incomingCronSecret = req.headers.get('X-Cron-Secret') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '');

  const cronOk = !!(cronSecret && incomingCronSecret && await timingSafeEqual(cronSecret, incomingCronSecret));
  const serviceRoleOk = !!(bearerToken && SUPABASE_SERVICE_KEY && await timingSafeEqual(bearerToken, SUPABASE_SERVICE_KEY));

  if (!cronOk && !serviceRoleOk) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const startTime = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const now = new Date();
    // Each per-member check derives its own local hour / day from member.timezone,
    // so the hourly cron tick simply iterates members and lets each check decide.
    const nowMs = now.getTime();

    // Fetch all active gyms with timezone (used as fallback for quiet hours).
    const { data: gyms } = await supabase
      .from('gyms')
      .select('id, timezone')
      .eq('is_active', true);
    if (!gyms?.length) return new Response(JSON.stringify({ message: 'No active gyms' }), { status: 200 });

    let totalProcessed = 0;

    for (const gym of gyms) {
      const gymTimezone = gym.timezone || 'America/New_York';

      // NOTE: profiles.timezone and profiles.notif_reengagement do not yet
      // exist as columns. Only select fields known to exist; resolve
      // timezone via gym fallback and treat notif_reengagement as null
      // (legacy = opt-in). Migration agent will add these columns and at
      // that point this select can include them.
      // FIX: was selecting `training_days` (non-existent column) — the column
      // is `preferred_training_days` (TEXT[] of English day names, migration 0059).
      // The bad select previously caused this query to error out and the
      // entire edge function to silently skip every gym.
      const { data: rawMembers, error: profErr } = await supabase
        .from('profiles')
        .select('id, gym_id, full_name, preferred_language, preferred_training_days, last_active_at, created_at, notif_workout_reminders, notif_streak_alerts, notif_friend_activity, notif_push_enabled')
        .eq('gym_id', gym.id)
        .eq('role', 'member')
        .eq('membership_status', 'active');

      if (profErr) {
        console.warn(`Profile fetch failed for gym ${gym.id}:`, profErr.message);
        continue;
      }
      if (!rawMembers?.length) continue;

      const members: Member[] = rawMembers
        .filter((m: any) => m.notif_push_enabled !== false) // master toggle
        .map((m: any) => ({
          id: m.id,
          gym_id: m.gym_id,
          full_name: m.full_name,
          // DB column is `preferred_language`; the Member interface + all
          // check functions use `language`, so alias it here once.
          language: m.preferred_language,
          preferred_training_days: m.preferred_training_days,
          last_active_at: m.last_active_at,
          created_at: m.created_at,
          // profiles.timezone → gyms.timezone → 'America/New_York'
          timezone: m.timezone || gymTimezone,
          // null = legacy opt-in (handled by checkReengagement gate)
          notif_reengagement: m.notif_reengagement ?? null,
          notif_workout_reminders: m.notif_workout_reminders ?? null,
          notif_streak_alerts: m.notif_streak_alerts ?? null,
          notif_friend_activity: m.notif_friend_activity ?? null,
          notif_push_enabled: m.notif_push_enabled ?? null,
        }));

      for (const member of members) {
        try {
          // Each check gates itself on the member's LOCAL hour / day so the
          // hourly cron only fires the right notification at the right moment.
          // Quiet hours (10pm–7am local) are enforced inside sendPush().
          const memberHour = localHour(member.timezone);
          const memberDow = localDayOfWeek(member.timezone);
          // For the date used in dedup keys, use the local date so dedup
          // resets at member-local midnight rather than UTC midnight.
          const memberToday = new Intl.DateTimeFormat('en-CA', {
            year: 'numeric', month: '2-digit', day: '2-digit', timeZone: member.timezone,
          }).format(now);

          // Morning window (8–10am local): workout reminder OR rest day
          if (memberHour >= 8 && memberHour <= 10) {
            await checkWorkoutReminder(supabase, member, memberToday, memberDow);
            await checkRestDay(supabase, member, memberToday, memberDow);
          }

          // Late morning / early afternoon (11am–1pm local): nutrition nudge if untracked
          if (memberHour >= 11 && memberHour <= 13) {
            await checkNutritionReminder(supabase, member, memberToday);
          }

          // Late afternoon (4–6pm local): second workout reminder + streak warning
          if (memberHour >= 16 && memberHour <= 18) {
            await checkWorkoutReminder(supabase, member, memberToday, memberDow);
            await checkStreakAtRisk(supabase, member, memberToday);
          }

          // Evening (7–9pm local): final streak warning + weight log
          if (memberHour >= 19 && memberHour <= 21) {
            await checkStreakAtRisk(supabase, member, memberToday);
            await checkWeightLogReminder(supabase, member, memberToday, nowMs);
          }

          // Re-engagement (3+ days inactive) — fires once mid-morning, once mid-afternoon
          if (memberHour === 9 || memberHour === 15) {
            await checkReengagement(supabase, member, memberToday, nowMs);
          }

          totalProcessed++;
        } catch (err) {
          console.warn(`Error processing member ${member.id}:`, err);
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`Processed ${totalProcessed} members in ${duration}ms`);

    return new Response(JSON.stringify({
      message: 'Reminders processed',
      members_processed: totalProcessed,
      duration_ms: duration,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('scheduled-reminders error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }
});
