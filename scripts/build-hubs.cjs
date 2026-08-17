// scripts/build-hubs.js — generate the four category hub pages
// (public/sports.html, tech.html, finance.html, politics.html).
// Each is a static SEO shell; the grid fills from /api/episodes via app.js,
// pinned to its category by data-fixed-category.
const fs = require('fs');
const path = require('path');

const HUBS = {
  sports: {
    title: 'Sports Podcast Episode Maps',
    heading: 'Sports episodes, mapped',
    blurb:
      'NFL, fantasy football, NBA, college ball and more — every episode broken into timestamped sections that play right here. Skip the filler, keep the takes.',
  },
  tech: {
    title: 'Tech & AI Podcast Episode Maps',
    heading: 'Tech episodes, mapped',
    blurb:
      'AI launches, startup stories, big-tech strategy — the long interviews, mapped into the sections worth your time. Every timestamp verified against the transcript.',
  },
  finance: {
    title: 'Finance & Crypto Podcast Episode Maps',
    heading: 'Finance episodes, mapped',
    blurb:
      'Markets, macro, crypto and investing conversations — section-by-section maps so you can jump straight to the thesis, not the small talk.',
  },
  politics: {
    title: 'Politics Podcast Episode Maps',
    heading: 'Politics episodes, mapped',
    blurb:
      'The long political conversations everyone references but nobody finishes — mapped and timestamped so you can hear the exact moment yourself.',
  },
};

function template(slug, hub) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${hub.title} — PodArticle</title>
  <meta name="description" content="${hub.blurb}">
  <link rel="canonical" href="https://podarticle.com/${slug}.html">
  <meta property="og:title" content="${hub.title} — PodArticle">
  <meta property="og:description" content="${hub.blurb}">
  <meta property="og:url" content="https://podarticle.com/${slug}.html">
  <meta property="og:type" content="website">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="style.css">
  <script src="thumb.js"></script>
</head>
<body>

  <header class="site-header">
    <div class="site-header-inner">
      <a class="brand-mark" href="index.html" aria-label="PodArticle home">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/>
        </svg>
        <span>PodArticle</span>
      </a>
      <nav class="site-nav" aria-label="Main navigation">
        <a href="index.html#feed">Episode library</a>
        <a href="how-it-works.html">How it works</a>
        <span data-auth-slot></span>
        <button class="theme-toggle" data-theme-toggle aria-label="Switch to dark mode"></button>
      </nav>
    </div>
  </header>

  <main>
    <section class="feed wrap-wide" style="padding-top:3rem;">
      <div class="section-head" style="display:block;max-width:720px;">
        <p class="eyebrow">Category</p>
        <h1 style="margin:0 0 0.5rem;">${hub.heading}</h1>
        <p style="color:var(--color-text-faint);margin:0 0 1.5rem;">${hub.blurb}</p>
      </div>
      <div class="article-grid" data-library-grid data-fixed-category="${slug}"></div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="wrap-wide footer-inner">
      <a class="brand-mark" href="index.html">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/>
        </svg>
        <span>PodArticle</span>
      </a>
      <nav class="footer-links" aria-label="Footer">
        <a href="index.html#feed">Episode library</a>
        <a href="pricing.html">Pricing</a>
        <a href="mailto:support@podarticle.com">Contact</a>
      </nav>
      <p class="footer-copy">&copy; 2026 PodArticle.</p>
    </div>
  </footer>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="messages.js"></script>
  <script src="theme.js" defer></script>
  <script src="auth.js" defer></script>
  <script src="app.js" defer></script>
</body>
</html>
`;
}

for (const [slug, hub] of Object.entries(HUBS)) {
  const file = path.join(__dirname, '..', 'public', `${slug}.html`);
  fs.writeFileSync(file, template(slug, hub));
  console.log('wrote', file);
}
