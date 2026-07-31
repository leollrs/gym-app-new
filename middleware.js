// Vercel Edge Middleware — per-topic, per-gym link previews.
//
// THE PROBLEM
// app.tugympr.com is a SPA: vercel.json rewrites /(.*) to /index.html, so every
// shared URL — a class, a challenge, a referral — returns the one static Open
// Graph block baked into index.html. Every link a member shares unfurls as
// "TuGymPR — Train. Compete. Progress." regardless of what they shared.
//
// Crawlers do not run JavaScript, so react-helmet or setting document.title
// client-side changes nothing. The tags must be in the HTML the server returns.
//
// THE SHAPE
// Whoever owns the link's DOMAIN answers the crawler's "what card do I show?".
// That is why these links stay on app.tugympr.com even when their destination
// is the gym's own website: control of the card is the entire feature.
//
//   bot   → we answer with a gym-branded card, right here
//   human → we get out of the way and the SPA serves as always
//
// SAFETY
// This sits in the request path of a production domain, so it is built to fail
// open. The matcher covers only the seven shareable route families — a total
// failure here cannot touch /, /login, /workouts or anything else. Every branch is
// wrapped: on ANY error we return undefined, which hands the request straight
// back to the normal SPA rewrite. The worst case is the old generic card, never
// a broken page.
//
// Data comes from get_share_preview (0653, extended to every link kind in
// 0655) — an anon-callable RPC that returns only title/subtitle/image
// material. No session, no service key.

export const config = {
  matcher: [
    '/referral/:path*',
    '/class/:path*',
    '/challenge/:path*',
    '/g/:path*',
    '/invite/:path*',   // both /invite/:code and /invite/t/:id — see routing below
    '/t/:path*',
    '/add-friend/:path*',
  ],
};

// Link-preview fetchers. Deliberately broad: a missed bot just gets the old
// generic card (harmless), while a false positive would show a human a bare
// meta-tag document (bad). Apple's iMessage fetcher reports as facebookexternalhit
// on many iOS versions, which is why that one matters most.
const BOT_UA = /facebookexternalhit|facebookcatalog|Twitterbot|Slackbot|Slack-ImgProxy|WhatsApp|Discordbot|LinkedInBot|TelegramBot|Applebot|redditbot|Pinterest|SkypeUriPreview|vkShare|embedly|Iframely|quora link preview|nuzzel|outbrain|bitlybot|Google-InspectionTool|Googlebot|bingbot|DuckDuckBot|Bluesky|Mastodon|opengraph|Snapchat|Viber|Line-Podcast/i;

// Appended to the card's escape-hatch link so a human who bounces off this
// middleware is recognised on the way back in. See cardHtml.
const ESCAPE_PARAM = '_p';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Public URL for an object in a public bucket. gym-logos went public in 0654. */
function publicStorage(bucket, path) {
  if (!path || !SUPABASE_URL) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path.replace(/^\/+/, '')}`;
}

/**
 * Same object through Supabase's image transform, sized for a link card.
 * 1200x630 is what every platform crops to; letting them crop a 3000px photo
 * wastes the crawler's patience and sometimes gets the image dropped entirely.
 * Only worth it for photos — a logo cropped to 1.91:1 loses its edges, so
 * logos are served untransformed and render as a square/small card instead.
 */
function cardImage(bucket, path) {
  const base = publicStorage(bucket, path);
  if (!base) return null;
  return base.replace('/object/public/', '/render/image/public/') + '?width=1200&height=630&resize=cover&quality=80';
}

/**
 * First candidate that actually resolves.
 *
 * The old code did `cardImage(classPhoto) || logo`, which falls back when there
 * is no PATH — never when the path is DEAD. A class whose image_path pointed at
 * a deleted file produced a perfectly-formed URL that 404s, and the fallback
 * never fired. That is not a cosmetic loss: when og:image fails to load,
 * iMessage collapses the whole card to a bare title and drops the description
 * too. One dead row cost the entire preview.
 *
 * A crawler cannot be told "try the next one", so the check happens here. HEAD,
 * with a short timeout, and any failure just moves to the next candidate.
 * Crawler traffic is rare, so this costs approximately nothing.
 */
async function firstLiveImage(candidates) {
  for (const url of candidates) {
    if (!url) continue;
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(2500) });
      if (res.ok) return url;
    } catch { /* unreachable or too slow — next candidate */ }
  }
  return null;
}

async function getPreview(kind, id) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_share_preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ p_kind: kind, p_id: id }),
      // Unbounded, this sat on the HUMAN path for /g/:slug — the link behind every
      // expressive share. One Supabase latency spike and those links hang until the
      // edge kills the invocation, which surfaces as a platform 500 the catch below
      // can never turn back into a fail-open.
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.found ? data : null;
  } catch {
    return null;
  }
}

/** A gym's website_url is free text an admin typed. Response.redirect THROWS on
 *  anything it can't parse ("casa-hierro.com", "//evil.com"), and that throw
 *  escapes to the outer catch → the SPA → ProtectedRoute → the login screen, for
 *  a visitor who may not even have an account. Anything not plainly http(s) is
 *  dropped rather than trusted: this host is shared by every gym, so an
 *  unvalidated hop would make app.tugympr.com an open redirect. */
function safeSiteUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.toString() : null;
  } catch {
    return null;
  }
}

const DAYS_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                   'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** 'YYYY-MM-DD' → '30 de agosto'. Parsed by hand: `new Date('2026-08-30')` is
 *  read as UTC midnight and renders the day BEFORE for anyone west of GMT. */
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  const month = MONTHS_ES[Number(m[2]) - 1];
  return month ? `${Number(m[3])} de ${month}` : '';
}

/** Build title / description / image for a preview payload. */
function cardFor(preview, canonicalUrl) {
  const gym = preview.gym || {};
  const gymName = gym.name || 'TuGymPR';

  if (preview.kind === 'class') {
    const c = preview.class || {};
    const name = c.name_es || c.name || 'Clase';
    const when = c.day_of_week != null && c.start_time
      ? `${DAYS_ES[c.day_of_week] || ''} ${c.start_time}`.trim()
      : '';
    return {
      // Lead with the invitation, not the noun. "Prueba — TuGymPR" told the
      // reader the class is CALLED Prueba and nothing about what to do with it.
      title: `Únete a ${name} en ${gymName}`,
      description: [when, c.instructor_name && `con ${c.instructor_name}`, c.description_es || c.description]
        .filter(Boolean).join(' · '),
      // The class photo is a photo — crop it properly. The gym mark is the
      // fallback for a class with no image, or one whose image_path is stale.
      images: [cardImage('class-images', c.image_path), publicStorage('gym-logos', gym.logo_url)],
    };
  }

  if (preview.kind === 'referral') {
    const offer = preview.offer || {};
    const who = preview.referrer_first_name;
    return {
      title: who ? `${who} te invita a ${gymName}` : `Te invitaron a ${gymName}`,
      // The offer is the reason a stranger keeps reading, so it leads.
      description: (offer.enabled && offer.headline)
        ? offer.headline
        : `Entrena en ${gymName}${gym.address ? ` · ${gym.address}` : ''}`,
      images: [publicStorage('gym-logos', gym.logo_url)],
    };
  }

  if (preview.kind === 'challenge') {
    const c = preview.challenge || {};
    const ends = c.end_date ? fmtDate(c.end_date) : '';
    return {
      title: `Únete al reto ${c.name || ''} en ${gymName}`.replace('  ', ' '),
      description: [c.description, ends && `Hasta el ${ends}`, c.reward && `Premio: ${c.reward}`]
        .filter(Boolean).join(' · '),
      images: [publicStorage('gym-logos', gym.logo_url)],
    };
  }

  if (preview.kind === 'invite') {
    return {
      title: `Te invitaron a ${gymName}`,
      description: gym.address
        ? `Crea tu cuenta y entrena en ${gymName} · ${gym.address}`
        : `Crea tu cuenta y entrena en ${gymName}`,
      images: [publicStorage('gym-logos', gym.logo_url)],
    };
  }

  if (preview.kind === 'trainer') {
    const tr = preview.trainer || {};
    const name = tr.full_name || 'Entrenador';
    return {
      // The trainer leads, the gym is the context — this link is their business
      // card, not the gym's.
      title: `Entrena con ${name} en ${gymName}`,
      description: tr.tagline || `Entrenador en ${gymName}`,
      // avatar_url is already an absolute URL on profiles (rendered straight
      // into <img src>), so it is used as-is. Falls back to the gym mark when
      // the trainer hid their photo (0655 returns null) OR when the avatar
      // itself no longer resolves.
      images: [tr.avatar_url, publicStorage('gym-logos', gym.logo_url)],
    };
  }

  if (preview.kind === 'friend') {
    const who = preview.friend_first_name;
    return {
      title: who ? `${who} te quiere agregar en ${gymName}` : `Te quieren agregar en ${gymName}`,
      description: `Entrenen juntos en ${gymName}`,
      images: [publicStorage('gym-logos', gym.logo_url)],
    };
  }

  // kind === 'gym' — the destination for expressive shares (recaps, runs, PRs).
  return {
    title: gymName,
    description: gym.address ? `${gym.address}` : `Entrena en ${gymName}`,
    images: [publicStorage('gym-logos', gym.logo_url)],
  };
}

function cardHtml({ title, description, image, url, escapeUrl, siteName }) {
  const img = image
    ? `<meta property="og:image" content="${esc(image)}">
    <meta property="og:image:alt" content="${esc(title)}">
    <meta name="twitter:image" content="${esc(image)}">`
    : '';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(siteName)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:locale" content="es_PR">
${img}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<!-- A crawler stops here. A human who somehow lands on this document gets
     bounced onward. This is NOT og:url: pointing the refresh at the canonical
     sent the visitor straight back into the same UA check, which produced the
     same document — an infinite reload, not a rescue. Several apps (Snapchat,
     Pinterest, Viber) put their name in their in-app BROWSER's user-agent, not
     just their crawler's, so real people did land here. -->
<meta http-equiv="refresh" content="0; url=${esc(escapeUrl || url)}">
</head>
<body><p><a href="${esc(escapeUrl || url)}">${esc(title)}</a></p></body>
</html>`;
}

export default async function middleware(request) {
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    // The marker the card's own escape hatch adds. Its presence means a human
    // already bounced off this middleware once, so classification is skipped
    // entirely and they go straight to the app. Without it the UA test would
    // reach the same verdict forever.
    if (url.searchParams.has(ESCAPE_PARAM)) return undefined;

    const ua = request.headers.get('user-agent') || '';
    const isBot = BOT_UA.test(ua);

    let kind = null;
    let id = null;
    // ORDER MATTERS. `/invite/t/:id` (a trainer profile) and `/invite/:code`
    // (a gym's member invite) share a prefix, so the two-segment shape has to
    // be tested first or every trainer link would be read as an invite with
    // the code "t". Same reason `/invite/go/` is checked and skipped: it is a
    // marketing deep link to an app screen, not an entity to preview.
    if (path.startsWith('/invite/go/'))       { return undefined; }
    else if (path.startsWith('/invite/t/'))   { kind = 'trainer';   id = path.slice('/invite/t/'.length); }
    else if (path.startsWith('/t/'))          { kind = 'trainer';   id = path.slice('/t/'.length); }
    else if (path.startsWith('/invite/'))     { kind = 'invite';    id = path.slice('/invite/'.length); }
    else if (path.startsWith('/referral/'))   { kind = 'referral';  id = path.slice('/referral/'.length); }
    else if (path.startsWith('/class/'))      { kind = 'class';     id = path.slice('/class/'.length); }
    else if (path.startsWith('/challenge/'))  { kind = 'challenge'; id = path.slice('/challenge/'.length); }
    else if (path.startsWith('/add-friend/')) { kind = 'friend';    id = path.slice('/add-friend/'.length); }
    else if (path.startsWith('/g/'))          { kind = 'gym';       id = path.slice('/g/'.length); }

    const rawId = (id || '').split('/')[0].split('?')[0];
    // decodeURIComponent throws on a malformed % sequence; an id is not worth
    // costing someone their page.
    try { id = decodeURIComponent(rawId); } catch { id = rawId; }
    if (!kind || !id) return undefined;

    // /g/:slug is a pass-through by design: the card is ours, the visit is the
    // gym's. A human never sees a page here — they are forwarded to the gym's
    // own website. That one hop is also the only way to count the traffic a
    // gym's own members send them.
    if (kind === 'gym' && !isBot) {
      const preview = await getPreview('gym', id);
      // No website configured, or one that doesn't parse → the download landing,
      // never a dead end and never an unvalidated hop off our own domain.
      const site = safeSiteUrl(preview?.gym?.website_url);
      return Response.redirect(site || `${url.origin}/get?c=gym`, 302);
    }

    // Everyone else who isn't a crawler gets the real app, untouched.
    if (!isBot) return undefined;

    const preview = await getPreview(kind, id);
    if (!preview) return undefined;

    // Keep the query string: /class/:id?d=YYYY-MM-DD carries which OCCURRENCE
    // was shared, and dropping it sent everyone to the next one instead.
    const canonical = `${url.origin}${path}${url.search}`;
    const card = cardFor(preview, canonical);
    const image = await firstLiveImage(card.images || []);
    // Where a HUMAN goes if this document ever renders. For a gym card that is
    // the gym's own site — the same destination the 302 above would have given
    // them. For everything else it's this URL with the marker appended, which
    // this middleware now waves straight through to the app.
    const escapeUrl = kind === 'gym'
      ? (safeSiteUrl(preview.gym?.website_url) || `${url.origin}/get?c=gym`)
      : `${canonical}${url.search ? '&' : '?'}${ESCAPE_PARAM}=1`;
    const html = cardHtml({
      ...card,
      image,
      url: canonical,
      escapeUrl,
      siteName: preview.gym?.name || 'TuGymPR',
    });

    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Crawlers refetch rarely and cache hard on their side anyway. A short
        // shared cache keeps a viral link from hammering the RPC, while
        // stale-while-revalidate means an offer edit shows up quickly.
        'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',
        // This response is chosen by user-agent. Vercel's CDN doesn't cache
        // middleware output, but any shared proxy in between could — and would
        // otherwise serve a human the crawler's near-blank meta document.
        vary: 'User-Agent',
        'x-robots-tag': 'noindex',
      },
    });
  } catch {
    // Fail open — ALWAYS. A thrown middleware must never cost a real user their
    // page; the worst outcome allowed here is the old generic preview.
    return undefined;
  }
}
