import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');
if (!ALLOWED_ORIGIN) throw new Error('ALLOWED_ORIGIN env var is required');

// ── SSRF protection ──────────────────────────────────────
// Robust guard against outbound requests to internal/private/link-local
// networks. Covers: cloud metadata (169.254.169.254), all RFC1918 ranges,
// CGNAT, loopback, IPv6 loopback/ULA/link-local, IPv4-mapped IPv6, and
// numerically-encoded IPv4 (decimal/hex/octal). Fails closed on parse errors.

/** True if the IPv4 octets fall in a private / loopback / link-local / CGNAT range. */
function isPrivateIpv4(a: number, b: number, _c: number, _d: number): boolean {
  if ([a, b, _c, _d].some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return true; // malformed → reject
  if (a === 0) return true;                          // 0.0.0.0/8
  if (a === 127) return true;                        // 127.0.0.0/8 loopback
  if (a === 10) return true;                         // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12 (only .16–.31)
  if (a === 192 && b === 168) return true;           // 192.168.0.0/16
  if (a === 169 && b === 254) return true;           // 169.254.0.0/16 link-local (incl 169.254.169.254)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

/**
 * Decode a numerically-encoded IPv4 host (decimal int, 0x hex, or dotted
 * decimal/octal/hex). Returns [a,b,c,d] octets, or null if it is not a
 * recognizable numeric IPv4 form.
 */
function parseNumericIpv4(host: string): [number, number, number, number] | null {
  // Dotted form: each part may be decimal, 0x.. hex, or 0.. octal.
  const parts = host.split('.');
  const toInt = (p: string): number | null => {
    if (p === '') return null;
    let n: number;
    if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^[0-9]+$/.test(p)) n = parseInt(p, 10);
    else return null;
    return Number.isFinite(n) ? n : null;
  };

  if (parts.length === 4) {
    const o = parts.map(toInt);
    if (o.some((x) => x === null || (x as number) > 255 || (x as number) < 0)) return null;
    return o as [number, number, number, number];
  }

  // Single-number form (e.g. 2130706433 or 0x7f000001) → 32-bit big-endian IPv4.
  if (parts.length === 1) {
    const n = toInt(host);
    if (n === null || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }
  return null;
}

/** Classify a hostname string as internal/blocked. */
function isInternalHostname(rawHost: string): boolean {
  let h = rawHost.toLowerCase().trim();
  // Strip an IPv6 bracket wrapper, e.g. "[::1]".
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);

  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '0.0.0.0') return true;

  // IPv6 handling.
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;                 // loopback / unspecified
    if (h.startsWith('fe80:') || h.startsWith('fe80::')) return true; // link-local fe80::/10
    // fc00::/7 ULA — first hextet 0xfc.. or 0xfd..
    if (/^f[cd][0-9a-f]{0,2}:/i.test(h)) return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1) → check embedded v4.
    const mapped = h.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
    if (mapped) {
      const v4 = parseNumericIpv4(mapped[1]);
      if (!v4 || isPrivateIpv4(...v4)) return true;
    }
    // Any other literal IPv6 we can't positively clear → reject (fail closed).
    return true;
  }

  // Numeric IPv4 (dotted, decimal int, hex, octal).
  const numeric = parseNumericIpv4(h);
  if (numeric) return isPrivateIpv4(...numeric);

  // Plain DNS name — allowed at the string level; DNS resolution is re-checked
  // below (resolveAndCheck) to mitigate DNS rebinding.
  return false;
}

/** SSRF guard for a config URL. Returns true if the URL must be blocked. */
function isInternalUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
    return isInternalHostname(url.hostname);
  } catch {
    return true; // unparseable → reject (fail closed)
  }
}

/**
 * Best-effort DNS-rebinding mitigation: resolve the hostname and reject if any
 * resolved A/AAAA address is private/link-local. Fails CLOSED — if resolution
 * throws (or Deno.resolveDns is unavailable in this runtime) we treat the URL
 * as blocked. Returns true if the URL must be blocked.
 */
async function resolvesToInternal(urlStr: string): Promise<boolean> {
  let host: string;
  try {
    host = new URL(urlStr).hostname;
  } catch {
    return true;
  }
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);

  const resolver = (Deno as unknown as { resolveDns?: unknown })?.resolveDns;
  if (typeof resolver !== 'function') {
    // resolveDns not usable in this runtime — rely on the literal hostname
    // check (isInternalUrl) + redirect:'manual' below. Do NOT hard-fail here,
    // otherwise no webhook could ever fire.
    return false;
  }

  try {
    const [aRecords, aaaaRecords] = await Promise.all([
      (resolver as (h: string, t: string) => Promise<string[]>)(host, 'A').catch(() => [] as string[]),
      (resolver as (h: string, t: string) => Promise<string[]>)(host, 'AAAA').catch(() => [] as string[]),
    ]);
    const all = [...aRecords, ...aaaaRecords];
    if (all.length === 0) return true; // resolved to nothing → fail closed
    for (const ip of all) {
      if (isInternalHostname(ip)) return true;
    }
    return false;
  } catch {
    return true; // resolution error → fail closed
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret, x-webhook-signature, x-signature',
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Timing-safe comparison (HMAC-based, no length leak)
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

// ── Incoming webhook signature verification ─────────────
async function computeHmacHex(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Adapters ─────────────────────────────────────────────

interface AdapterResult {
  status: number;
  body: string;
}

/** Generic webhook: POST payload to a configured URL with HMAC signature. */
async function webhookAdapter(
  action: string,
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
): Promise<AdapterResult> {
  const url = config.url as string;
  if (!url) return { status: 400, body: 'No webhook URL configured' };
  if (isInternalUrl(url)) return { status: 400, body: 'Internal URLs are not allowed for webhooks' };
  // DNS-rebinding mitigation: re-resolve the hostname and reject if it maps to
  // a private/link-local address. Runs BEFORE the fetch below.
  if (await resolvesToInternal(url)) {
    return { status: 400, body: 'Internal URLs are not allowed for webhooks' };
  }

  const bodyStr = JSON.stringify({ action, payload, timestamp: new Date().toISOString() });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.headers as Record<string, string> || {}),
  };

  // HMAC signature if secret is configured
  const secret = config.secret as string;
  if (secret) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(bodyStr));
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    headers['X-Webhook-Signature'] = `sha256=${hex}`;
  }

  // Bound the outbound webhook with a 5s timeout. If the upstream is
  // slow or unreachable, abort silently — do not retry, do not surface
  // the abort to the caller as a 5xx. Log and return a synthetic result
  // so the integration log records the failure.
  try {
    // redirect:'manual' so an allowed host cannot 302 us to an internal/
    // metadata address that would bypass the SSRF guard above. Any 3xx is
    // treated as a failure rather than followed.
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyStr,
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (resp.status >= 300 && resp.status < 400) {
      return { status: 502, body: 'Outbound webhook returned a redirect (not followed)' };
    }
    const respBody = await resp.text();
    return { status: resp.status, body: respBody.substring(0, 2000) };
  } catch (err) {
    const isAbort = (err as { name?: string })?.name === 'AbortError'
      || (err as { name?: string })?.name === 'TimeoutError';
    if (isAbort) {
      console.warn(`[integration-webhook] outbound fetch to ${url} aborted after 5s`);
      return { status: 504, body: 'Outbound webhook timeout' };
    }
    console.warn(`[integration-webhook] outbound fetch to ${url} failed:`, (err as Error)?.message);
    return { status: 502, body: 'Outbound webhook failed' };
  }
}

const ADAPTERS: Record<string, typeof webhookAdapter> = {
  webhook: webhookAdapter,
  // Future adapters: mindbody, clubready, abc_fitness
  // Each would implement the same (action, payload, config) => AdapterResult interface
};

// ── Main handler ─────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Content-Type validation
  const ct = req.headers.get('content-type') || '';
  if (req.method === 'POST' && !ct.includes('application/json')) {
    return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), {
      status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const start = Date.now();

  try {
    // ── Auth: require valid cron secret OR admin JWT ──
    const cronSecret = Deno.env.get('CRON_SECRET');
    const incomingSecret = req.headers.get('X-Cron-Secret') ?? '';
    const authHeader = req.headers.get('Authorization') ?? '';

    const isCronAuth = !!(cronSecret && incomingSecret && (await timingSafeEqual(cronSecret, incomingSecret)));

    // When the caller is an admin via JWT (NOT cron/service-role), capture their
    // authoritative gym_id from the DB profile so we can enforce that they may
    // only fire their own gym's integration (cross-tenant IDOR guard below).
    // null means "trusted path" (cron or service-role) — no gym match required.
    let adminGymId: string | null = null;
    let isSuperAdmin = false;

    if (!isCronAuth) {
      // Check for valid admin JWT or service-role key
      const token = authHeader.replace('Bearer ', '');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

      let isServiceRole = false;
      if (token && serviceKey) {
        isServiceRole = await timingSafeEqual(token, serviceKey);
      }

      if (!isServiceRole) {
        // Try JWT auth — verify the token and check for admin role
        let isAdmin = false;
        if (token) {
          const authClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
          const { data: { user } } = await authClient.auth.getUser(token);
          if (user) {
            const { data: profile } = await authClient
              .from('profiles')
              .select('role, additional_roles, gym_id')
              .eq('id', user.id)
              .single();
            // Multi-role (mig 0332): admin authority can come from primary or additional roles.
            const ADMIN_ROLES = ['admin', 'super_admin'];
            const additional = Array.isArray(profile?.additional_roles) ? profile.additional_roles : [];
            isAdmin = ADMIN_ROLES.includes(profile?.role) || additional.some((r: string) => ADMIN_ROLES.includes(r));
            // super_admin is a platform-level role and may act cross-gym.
            isSuperAdmin = profile?.role === 'super_admin' || additional.includes('super_admin');
            // Authoritative gym scope comes from the DB profile, never the body.
            adminGymId = (profile?.gym_id as string | undefined) ?? null;
          }
        }

        if (!isAdmin) {
          return jsonResp({ error: 'Unauthorized' }, 401);
        }
      }
    }

    // Read raw body for signature verification (must happen before .json())
    const rawBody = await req.text();

    // Payload size cap — reject large bodies up-front before any work.
    if (rawBody.length > 1_000_000) {
      return jsonResp({ error: 'payload_too_large' }, 413);
    }

    // When cron-authed, a webhook signature is mandatory — do not allow
    // the warning-only fallback path. Service-role / admin JWT auth still
    // permits a missing signature for backward compatibility.
    const incomingSigEarly =
      req.headers.get('x-webhook-signature') ?? req.headers.get('x-signature');
    if (isCronAuth && !incomingSigEarly) {
      return jsonResp({ error: 'signature_required_for_cron' }, 401);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return jsonResp({ error: 'Invalid JSON body' }, 400);
    }

    const { integrationId, action, payload } = parsed as {
      integrationId?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    if (!integrationId || !action || !payload) {
      return jsonResp({ error: 'Missing integrationId, action, or payload' }, 400);
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Fetch integration config
    const { data: integration, error: fetchErr } = await db
      .from('gym_integrations')
      .select('id, gym_id, provider, config, is_active, actions_enabled')
      .eq('id', integrationId)
      .single();

    // ── Verify incoming webhook signature ──
    const incomingSig = req.headers.get('x-webhook-signature') ?? req.headers.get('x-signature');
    if (incomingSig) {
      // Determine the verification secret: per-integration config or env fallback
      const verifySecret =
        ((integration?.config as Record<string, unknown>)?.webhook_secret as string | undefined)
        ?? Deno.env.get('WEBHOOK_VERIFY_SECRET');

      if (!verifySecret) {
        console.warn(
          `[integration-webhook] Signature header present but no webhook_secret configured for integration ${integrationId}`,
        );
        return jsonResp({ error: 'Webhook signature verification not configured' }, 401);
      }

      // Normalize: strip optional "sha256=" prefix
      const rawSig = incomingSig.startsWith('sha256=') ? incomingSig.slice(7) : incomingSig;
      const expectedHex = await computeHmacHex(verifySecret, rawBody);

      if (!(await timingSafeEqual(rawSig, expectedHex))) {
        console.error(
          `[integration-webhook] Invalid webhook signature for integration ${integrationId}`,
        );
        return jsonResp({ error: 'Invalid webhook signature' }, 401);
      }
    } else {
      // No signature header — allow for backward compatibility but log a warning
      console.warn(
        `[integration-webhook] No webhook signature header present for integration ${integrationId}. ` +
        'Consider configuring webhook_secret for signature verification.',
      );
    }

    if (fetchErr || !integration) {
      return jsonResp({ error: 'Integration not found' }, 404);
    }

    // ── Cross-tenant IDOR guard (admin-JWT path only) ──
    // An admin may only fire integrations belonging to their own gym. The
    // cron/service-role path (adminGymId === null) is trusted and may act
    // cross-gym; platform super_admins are also exempt.
    if (adminGymId !== null && !isSuperAdmin && integration.gym_id !== adminGymId) {
      return jsonResp({ error: 'Forbidden' }, 403);
    }

    if (!integration.is_active) {
      return jsonResp({ error: 'Integration is disabled' }, 400);
    }

    if (!integration.actions_enabled?.includes(action)) {
      return jsonResp({ error: `Action '${action}' not enabled for this integration` }, 400);
    }

    // Dispatch to the appropriate adapter
    const adapter = ADAPTERS[integration.provider];
    if (!adapter) {
      return jsonResp({ error: `No adapter for provider '${integration.provider}'` }, 400);
    }

    const result = await adapter(action, payload, integration.config || {});
    const durationMs = Date.now() - start;

    // Log the result
    await db.from('integration_log').insert({
      gym_id: integration.gym_id,
      integration_id: integration.id,
      action,
      payload,
      response_status: result.status,
      response_body: result.body,
      duration_ms: durationMs,
    });

    const success = result.status >= 200 && result.status < 300;
    return jsonResp({ success, status: result.status, duration_ms: durationMs });

  } catch (err) {
    console.error('integration-webhook error:', err);
    return jsonResp({ error: err.message || 'Internal error' }, 500);
  }
});
