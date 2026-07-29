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
// open. The matcher covers only four route families — a total failure here
// cannot touch /, /login, /workouts or anything else. And every branch is
// wrapped: on ANY error we return undefined, which hands the request straight
// back to the normal SPA rewrite. The worst case is the old generic card, never
// a broken page.
//
// Data comes from get_share_preview (migration 0653) — an anon-callable RPC
// that returns only title/subtitle/image material. No session, no service key.

export const config = {
  matcher: ['/referral/:path*', '/class/:path*', '/challenge/:path*', '/g/:path*'],
};

// Link-preview fetchers. Deliberately broad: a missed bot just gets the old
// generic card (harmless), while a false positive would show a human a bare
// meta-tag document (bad). Apple's iMessage fetcher reports as facebookexternalhit
// on many iOS versions, which is why that one matters most.
const BOT_UA = /facebookexternalhit|facebookcatalog|Twitterbot|Slackbot|Slack-ImgProxy|WhatsApp|Discordbot|LinkedInBot|TelegramBot|Applebot|redditbot|Pinterest|SkypeUriPreview|vkShare|embedly|Iframely|quora link preview|nuzzel|outbrain|bitlybot|Google-InspectionTool|Googlebot|bingbot|DuckDuckBot|Bluesky|Mastodon|opengraph|Snapchat|Viber|Line-Podcast/i;

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

async function getPreview(kind, id) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_share_preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({ p_kind: kind, p_id: id }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.found ? data : null;
}

const DAYS_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

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
      title: `${name} — ${gymName}`,
      description: [when, c.instructor_name && `con ${c.instructor_name}`, c.description_es || c.description]
        .filter(Boolean).join(' · '),
      // The class photo is a photo — crop it properly.
      image: cardImage('class-images', c.image_path) || publicStorage('gym-logos', gym.logo_url),
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
      image: publicStorage('gym-logos', gym.logo_url),
    };
  }

  // kind === 'gym' — the destination for expressive shares (recaps, runs, PRs).
  return {
    title: gymName,
    description: gym.address ? `${gym.address}` : `Entrena en ${gymName}`,
    image: publicStorage('gym-logos', gym.logo_url),
  };
}

function cardHtml({ title, description, image, url, siteName }) {
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
<!-- A crawler stops here. A human who somehow lands on this document (a bot UA
     in a real browser, a debugger) gets bounced into the real app instead of
     staring at a blank page. -->
<meta http-equiv="refresh" content="0; url=${esc(url)}">
</head>
<body><p><a href="${esc(url)}">${esc(title)}</a></p></body>
</html>`;
}

export default async function middleware(request) {
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const ua = request.headers.get('user-agent') || '';
    const isBot = BOT_UA.test(ua);

    let kind = null;
    let id = null;
    if (path.startsWith('/referral/'))      { kind = 'referral';  id = path.slice('/referral/'.length); }
    else if (path.startsWith('/class/'))    { kind = 'class';     id = path.slice('/class/'.length); }
    else if (path.startsWith('/challenge/')){ kind = 'challenge'; id = path.slice('/challenge/'.length); }
    else if (path.startsWith('/g/'))        { kind = 'gym';       id = path.slice('/g/'.length); }

    id = decodeURIComponent((id || '').split('/')[0].split('?')[0]);
    if (!kind || !id) return undefined;

    // /g/:slug is a pass-through by design: the card is ours, the visit is the
    // gym's. A human never sees a page here — they are forwarded to the gym's
    // own website. That one hop is also the only way to count the traffic a
    // gym's own members send them.
    if (kind === 'gym' && !isBot) {
      const preview = await getPreview('gym', id);
      const site = preview?.gym?.website_url;
      // No website configured yet → the download landing, never a dead end.
      return Response.redirect(site || `${url.origin}/get?c=gym`, 302);
    }

    // Everyone else who isn't a crawler gets the real app, untouched.
    if (!isBot) return undefined;

    // `challenge` has no branch in get_share_preview yet (0653 covers referral /
    // class / gym). Falling through leaves it on the generic card — the same
    // thing it shows today, so nothing regresses.
    if (kind === 'challenge') return undefined;

    const preview = await getPreview(kind, id);
    if (!preview) return undefined;

    const canonical = `${url.origin}${path}`;
    const card = cardFor(preview, canonical);
    const html = cardHtml({
      ...card,
      url: canonical,
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
        'x-robots-tag': 'noindex',
      },
    });
  } catch {
    // Fail open — ALWAYS. A thrown middleware must never cost a real user their
    // page; the worst outcome allowed here is the old generic preview.
    return undefined;
  }
}
