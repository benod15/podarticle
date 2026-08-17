// api/episode-page.js — GET /e/<videoId> → the episode page with link-preview
// meta tags baked into the HTML at the server.
//
// Why this exists: X/iMessage/Slack crawlers don't run JavaScript, so the meta
// tags share.js injects client-side were invisible to them — shared links
// unfurled with no thumbnail. Here the tags are in the very first byte of HTML.
// The page body is the same shell as episode.html; episode.js renders the map
// client-side from the cached (instant) analyze path.
import { getEpisodeByVideoId } from '../lib/db.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page({ vid, title, description, image, url }) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <base href="/">
  <title>${esc(title)}</title>
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${esc(image)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:type" content="article">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(image)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
  <script src="/thumb.js"></script>
  <script src="/share.js"></script>
</head>
<body>
  <header class="site-header">
    <div class="site-header-inner">
      <a class="brand-mark" href="/index.html" aria-label="PodArticle home">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/>
        </svg>
        <span>PodArticle</span>
      </a>
      <nav class="site-nav" aria-label="Main navigation">
        <a href="/index.html#feed">Episode library</a>
        <button class="theme-toggle" data-theme-toggle aria-label="Switch to dark mode"></button>
      </nav>
    </div>
  </header>

  <main id="episode-root">
    <div class="ep-loading" style="max-width:720px;margin:6rem auto;text-align:center;padding:0 1.5rem;">
      <p style="font-family:'Instrument Serif',serif;font-size:1.5rem;font-style:italic;">Loading your episode map…</p>
    </div>
  </main>

  <footer class="site-footer">
    <div class="wrap-wide footer-inner">
      <a class="brand-mark" href="/index.html">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/>
        </svg>
        <span>PodArticle</span>
      </a>
      <nav class="footer-links" aria-label="Footer">
        <a href="/index.html#feed">Episode library</a>
        <a href="/pricing.html">Pricing</a>
        <a href="mailto:support@podarticle.com">Contact</a>
      </nav>
      <p class="footer-bug">Found a bug? Email <a href="mailto:support@podarticle.com">support@podarticle.com</a></p>
      <p class="footer-copy">Chapters sourced from the show's own YouTube description; descriptions checked against the spoken transcript. &copy; 2026 PodArticle.</p>
    </div>
  </footer>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="/messages.js"></script>
  <script src="/theme.js" defer></script>
  <script src="/auth.js" defer></script>
  <script src="/youtube.js" defer></script>
  <script src="/episode.js" defer></script>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'UNAVAILABLE' });
  }

  const vid = String(req.query?.vid || '').trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(vid)) {
    return res.redirect(302, '/index.html');
  }

  let ep = null;
  try {
    ep = await getEpisodeByVideoId(vid);
  } catch (err) {
    console.error('episode-page: lookup failed', err);
  }

  // Not mapped yet → the dynamic page handles sign-in / fresh analysis.
  if (!ep) {
    const t = req.query?.t ? `&t=${encodeURIComponent(String(req.query.t).replace(/[^0-9]/g, ''))}` : '';
    return res.redirect(302, `/episode.html?v=${encodeURIComponent(vid)}${t}`);
  }

  const title = `${ep.title || 'Episode'} — PodArticle`;
  const description = String(ep.analysis?.summary || 'Every section, timestamped. Watch only what matters to you.').slice(0, 200);
  // Served from our own domain (api/og-image.js) — X's image proxy failing to
  // fetch a third-party host once means a broken card cached against the URL.
  const image = `https://podarticle.com/api/og-image?vid=${vid}`;
  const url = `https://podarticle.com/e/${vid}`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(page({ vid, title, description, image, url }));
}
