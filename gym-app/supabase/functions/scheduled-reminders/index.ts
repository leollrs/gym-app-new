import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// APNs config (reused from send-push-user)
const APNS_KEY_ID = Deno.env.get('APNS_KEY_ID') || '';
const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID') || '';
const APNS_PRIVATE_KEY = Deno.env.get('APNS_PRIVATE_KEY') || '';
const APNS_HOST = Deno.env.get('APNS_HOST') || 'api.sandbox.push.apple.com';
const APNS_BUNDLE_ID = 'com.tugympr.app';

// FCM config
const FCM_PROJECT_ID = Deno.env.get('FCM_PROJECT_ID') || '';
const FCM_CLIENT_EMAIL = Deno.env.get('FCM_CLIENT_EMAIL') || '';
const FCM_PRIVATE_KEY = Deno.env.get('FCM_PRIVATE_KEY') || '';

import { decode as base64Decode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';

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
async function sendPush(supabase: ReturnType<typeof createClient>, profileId: string, title: string, body: string, data: Record<string, string> = {}) {
  const { data: tokens } = await supabase.from('push_tokens').select('token, platform').eq('profile_id', profileId);
  if (!tokens?.length) return;

  const iosTokens = tokens.filter(t => t.platform === 'ios').map(t => t.token);
  const androidTokens = tokens.filter(t => t.platform === 'android').map(t => t.token);

  // iOS
  if (iosTokens.length > 0 && APNS_KEY_ID && APNS_TEAM_ID && APNS_PRIVATE_KEY) {
    const jwt = await getAPNsJWT();
    const payload = JSON.stringify({ aps: { alert: { title, body }, sound: 'default', badge: 1, 'mutable-content': 1 }, ...data });
    for (const token of iosTokens) {
      try {
        const res = await fetch(`https://${APNS_HOST}/3/device/${token}`, {
          method: 'POST',
          headers: { 'authorization': `bearer ${jwt}`, 'apns-topic': APNS_BUNDLE_ID, 'apns-push-type': 'alert', 'apns-priority': '10', 'content-type': 'application/json' },
          body: payload,
        });
        if (res.status === 410 || res.status === 400) await supabase.from('push_tokens').delete().eq('token', token);
      } catch {}
    }
  }

  // Android
  if (androidTokens.length > 0 && FCM_PROJECT_ID && FCM_CLIENT_EMAIL && FCM_PRIVATE_KEY) {
    const accessToken = await getFCMAccessToken();
    for (const token of androidTokens) {
      try {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: { token, notification: { title, body }, data, android: { priority: 'high' } } }),
        });
        if (res.status === 404 || res.status === 400) await supabase.from('push_tokens').delete().eq('token', token);
      } catch {}
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
  training_days: number[] | null;
  last_active_at: string | null;
  created_at: string;
}

async function checkWorkoutReminder(supabase: ReturnType<typeof createClient>, member: Member, today: string, dayOfWeek: number) {
  // Only on their training days
  if (member.training_days && !member.training_days.includes(dayOfWeek)) return;

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

  const title = msg(lang, `Time to train, ${firstName}!`, `¡Hora de entrenar, ${firstName}!`);
  const body = msg(lang, "Your workout is waiting. Let's make today count!", '¡Tu entreno te espera. Haz que hoy cuente!');

  const suffix = (count ?? 0) === 0 ? '' : '_2';
  await insertNotif(supabase, member.id, member.gym_id, 'workout_reminder', title, body, dedupKey + suffix);
  await sendPush(supabase, member.id, title, body, { route: '/workouts', type: 'workout_reminder' });
}

async function checkStreakAtRisk(supabase: ReturnType<typeof createClient>, member: Member, today: string) {
  const { data: streakData } = await supabase.from('streak_cache')
    .select('current_streak, last_activity_date')
    .eq('profile_id', member.id).maybeSingle();

  if (!streakData || (streakData.current_streak || 0) < 3) return;

  // Check if last activity was yesterday
  const lastDate = new Date(streakData.last_activity_date);
  const todayDate = new Date(today);
  const diffDays = Math.floor((todayDate.getTime() - lastDate.getTime()) / MS_PER_DAY);
  if (diffDays !== 1) return; // only if exactly yesterday

  const dedupKey = `sched_streak_${member.id}_${today}`;
  const lang = member.language || 'en';
  const streak = streakData.current_streak;

  const title = msg(lang, '🔥 Your streak is at risk!', '🔥 ¡Tu racha está en riesgo!');
  const body = msg(lang,
    `Your ${streak}-day streak breaks at midnight. One workout keeps it alive!`,
    `¡Tu racha de ${streak} días se rompe a medianoche. Un entreno la mantiene viva!`
  );

  await insertNotif(supabase, member.id, member.gym_id, 'streak_warning', title, body, dedupKey);
  await sendPush(supabase, member.id, title, body, { route: '/', type: 'streak_warning' });
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
    title = msg(lang, `${firstName}, your gym misses you!`, `¡${firstName}, tu gym te extraña!`);
    body = msg(lang, "It's been a while. Come back and crush your goals — we're here for you.", 'Ha pasado un tiempo. Vuelve y cumple tus metas — estamos aquí para ti.');
  } else if (daysInactive >= 7) {
    title = msg(lang, `Hey ${firstName}, time to get back!`, `¡Hey ${firstName}, hora de volver!`);
    body = msg(lang, "A week without training? Let's fix that today.", '¿Una semana sin entrenar? Arreglemos eso hoy.');
  } else {
    title = msg(lang, `${firstName}, don't lose momentum!`, `¡${firstName}, no pierdas el impulso!`);
    body = msg(lang, `${daysInactive} days without a workout. Today is the day to come back!`, `${daysInactive} días sin entrenar. ¡Hoy es el día de volver!`);
  }

  await insertNotif(supabase, member.id, member.gym_id, 'churn_followup', title, body, dedupKey);
  await sendPush(supabase, member.id, title, body, { route: '/', type: 'churn_followup' });
}

async function checkNutritionReminder(supabase: ReturnType<typeof createClient>, member: Member, today: string) {
  // Only if member has logged food before
  const { count: foodLogs } = await supabase.from('food_log').select('id', { count: 'exact', head: true })
    .eq('profile_id', member.id).limit(1);
  if ((foodLogs ?? 0) === 0) return;

  // Only if they haven't logged food today
  const { count: todayLogs } = await supabase.from('food_log').select('id', { count: 'exact', head: true })
    .eq('profile_id', member.id).gte('logged_at', today);
  if ((todayLogs ?? 0) > 0) return;

  // Max 1 per day
  const dedupKey = `sched_nutrition_${member.id}_${today}`;
  const lang = member.language || 'en';

  const title = msg(lang, "Don't forget your meals!", '¡No olvides tus comidas!');
  const body = msg(lang, 'Log your meals to stay on track with your nutrition goals.', 'Registra tus comidas para cumplir tus metas de nutrición.');

  await insertNotif(supabase, member.id, member.gym_id, 'workout_reminder', title, body, dedupKey);
  await sendPush(supabase, member.id, title, body, { route: '/nutrition', type: 'workout_reminder' });
}

async function checkWeightLogReminder(supabase: ReturnType<typeof createClient>, member: Member, today: string, nowMs: number) {
  // Check last weight log
  const { data: lastLog } = await supabase.from('body_metrics')
    .select('logged_at').eq('profile_id', member.id).eq('metric_type', 'weight')
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

  const title = msg(lang, 'Time to log your weight!', '¡Hora de registrar tu peso!');
  const body = msg(lang, 'Tracking weekly keeps you on target. Quick log takes 10 seconds.', 'Registrar semanalmente te mantiene en objetivo. Solo toma 10 segundos.');

  await insertNotif(supabase, member.id, member.gym_id, 'workout_reminder', title, body, dedupKey);
  await sendPush(supabase, member.id, title, body, { route: '/progress', type: 'workout_reminder' });
}

// ═══════════════════════════════════════════════════════════════
//  MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  const startTime = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const now = new Date();
    const hour = now.getUTCHours();

    // Quiet hours: skip push between 10 PM and 7 AM local
    // Since we don't know each user's timezone, use a broad window
    // UTC 3-12 covers 10PM-7AM for most Americas timezones
    if (hour >= 3 && hour <= 12) {
      // It's nighttime in the Americas — skip
      // (We still insert DB notifications, just skip push)
    }

    const today = now.toISOString().slice(0, 10);
    const dayOfWeek = now.getDay(); // 0=Sun
    const nowMs = now.getTime();

    // Fetch all active members across all active gyms
    const { data: gyms } = await supabase.from('gyms').select('id').eq('is_active', true);
    if (!gyms?.length) return new Response(JSON.stringify({ message: 'No active gyms' }), { status: 200 });

    let totalProcessed = 0;
    let totalPushed = 0;

    for (const gym of gyms) {
      const { data: members } = await supabase
        .from('profiles')
        .select('id, gym_id, full_name, language, training_days, last_active_at, created_at')
        .eq('gym_id', gym.id)
        .eq('role', 'member')
        .eq('membership_status', 'active');

      if (!members?.length) continue;

      for (const member of members) {
        try {
          // Run time-appropriate checks
          // Morning run (6-10 AM UTC = ~1-5 AM EST, 8 AM-12 PM CET): workout reminder
          if (hour >= 13 && hour <= 17) {
            await checkWorkoutReminder(supabase, member, today, dayOfWeek);
          }

          // Afternoon run (17-21 UTC = ~12-4 PM EST): streak + nutrition
          if (hour >= 17 && hour <= 23) {
            await checkStreakAtRisk(supabase, member, today);
            await checkNutritionReminder(supabase, member, today);
          }

          // Any run: reengagement (3+ days inactive) + weight log (weekly)
          await checkReengagement(supabase, member, today, nowMs);
          await checkWeightLogReminder(supabase, member, today, nowMs);

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
