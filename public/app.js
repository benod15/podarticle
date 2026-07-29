// app.js — PodArticle production frontend
// 1. Analyzer: submit → staged progress wheel → redirect to podarticle page
// 2. Episode library: fetched from /api/episodes, with sort + instant search
(() => {
  'use strict';

  // ---------- Analyzer + progress wheel ----------
  const form = document.querySelector('[data-link-form]');
  const progress = document.querySelector('[data-progress]');
  const progressBar = document.querySelector('[data-progress-bar]');
  const errorEl = document.querySelector('[data-analysis-error]');

  // Stage timing estimates (seconds) — mirrors real backend stage durations.
  // The wheel advances on a timer; it jumps to 100% when the response lands.
  const STAGES = [
    { key: 'metadata', at: 0, pct: 12 },
    { key: 'transcript', at: 4, pct: 38 },
    { key: 'analysis', at: 20, pct: 78 },
    { key: 'save', at: 75, pct: 94 },
  ];
  const MAX_WAIT = 240; // cap the crawl at 94% after 4 minutes

  let timers = [];

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function setStage(key, pct) {
    document.querySelectorAll('.analysis-stages li').forEach((li) => {
      const k = li.dataset.stage;
      const order = STAGES.map((s) => s.key);
      li.classList.toggle('done', order.indexOf(k) < order.indexOf(key));
      li.classList.toggle('active', k === key);
    });
    if (progressBar) progressBar.style.width = pct + '%';
  }

  function finishProgress() {
    clearTimers();
    document.querySelectorAll('.analysis-stages li').forEach((li) => {
      li.classList.add('done');
      li.classList.remove('active');
    });
    if (progressBar) progressBar.style.width = '100%';
  }

  function failProgress(msg) {
    clearTimers();
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    }
    if (progressBar) progressBar.classList.add('failed');
  }

  function startProgress() {
    if (!progress) return;
    progress.hidden = false;
    if (errorEl) errorEl.hidden = true;
    if (progressBar) {
      progressBar.classList.remove('failed');
      progressBar.style.width = '4%';
    }
    document.querySelectorAll('.analysis-stages li').forEach((li) => li.classList.remove('done', 'active'));
    for (const s of STAGES) {
      timers.push(setTimeout(() => setStage(s.key, s.pct), s.at * 1000));
    }
    // Slow crawl after last stage so the bar never looks dead
    timers.push(
      setTimeout(() => {
        const t0 = Date.now();
        const crawl = setInterval(() => {
          const w = parseFloat(progressBar.style.width) || 0;
          if (w >= 94 || Date.now() - t0 > MAX_WAIT * 1000) return clearInterval(crawl);
          progressBar.style.width = Math.min(94, w + 0.4) + '%';
        }, 1000);
        timers.push(crawl);
      }, (STAGES[STAGES.length - 1].at + 2) * 1000)
    );
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input[type="url"]');
      const url = (input?.value || '').trim();
      if (!url) return;
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      startProgress();
      try {
        const r = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          failProgress(data.error || 'Something went wrong analyzing that episode. Please try again.');
          return;
        }
        finishProgress();
        // Go to the podarticle
        window.location.href = data.slug ? `/episodes/${encodeURIComponent(data.slug)}` : `/episode.html?v=${data.video_id}`;
      } catch {
        failProgress('Network error — check your connection and try again.');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  // ---------- Episode library: sort + search ----------
  const grid = document.querySelector('[data-library-grid]');
  const searchInput = document.querySelector('[data-library-search]');
  const sortSelect = document.querySelector('[data-library-sort]');
  if (!grid) return;

  // Cards currently on the page (static seed library) become the initial dataset.
  const staticCards = Array.from(grid.querySelectorAll('.article-card')).map((a) => ({
    el: a,
    href: a.getAttribute('href'),
    show: (a.querySelector('.article-card-eyebrow')?.textContent || '').trim(),
    title: (a.querySelector('h3')?.textContent || '').trim(),
    summary: (a.querySelector('p')?.textContent || '').trim(),
    published_at: null, // static cards: unknown date, sort last in "newest"
    video_id: (a.querySelector('img')?.src.match(/vi\/([A-Za-z0-9_-]{11})\//) || [])[1] || '',
  }));

  let library = staticCards.slice();

  function matchesQuery(item, q) {
    if (!q) return true;
    const hay = `${item.show} ${item.title} ${item.summary}`.toLowerCase();
    return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  }

  function sortLibrary(items, mode) {
    const arr = items.slice();
    if (mode === 'az') {
      arr.sort((a, b) => a.show.localeCompare(b.show) || a.title.localeCompare(b.title));
    } else {
      // newest first; unknown dates (static seeds) go last
      arr.sort((a, b) => {
        if (!a.published_at && !b.published_at) return 0;
        if (!a.published_at) return 1;
        if (!b.published_at) return -1;
        return new Date(b.published_at) - new Date(a.published_at);
      });
    }
    return arr;
  }

  function renderCard(item) {
    if (item.el) return item.el;
    const a = document.createElement('a');
    a.className = 'article-card';
    a.href = `/episodes/${item.slug}`;
    a.innerHTML = `
      <div class="article-card-thumb">
        <img src="https://i.ytimg.com/vi/${item.video_id}/maxresdefault.jpg" alt="" loading="lazy">
      </div>
      <div class="article-card-body">
        <span class="article-card-eyebrow"></span>
        <h3></h3>
        <p></p>
      </div>`;
    a.querySelector('img').alt = item.title;
    a.querySelector('.article-card-eyebrow').textContent = item.show_name || '';
    a.querySelector('h3').textContent = item.title || '';
    a.querySelector('p').textContent = (item.summary || '').slice(0, 120);
    return a;
  }

  function render() {
    const q = searchInput?.value || '';
    const mode = sortSelect?.value || 'newest';
    const visible = sortLibrary(library.filter((i) => matchesQuery(i, q)), mode);
    grid.innerHTML = '';
    for (const item of visible) grid.appendChild(renderCard(item));
    if (!visible.length) {
      const p = document.createElement('p');
      p.className = 'library-empty';
      p.textContent = 'No episodes match that search yet.';
      grid.appendChild(p);
    }
  }

  searchInput?.addEventListener('input', render);
  sortSelect?.addEventListener('change', render);

  // Merge in the live library from the DB (dedupes against static seeds by video_id)
  fetch('/api/episodes')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data?.episodes?.length) return;
      const seen = new Set(library.map((i) => i.video_id));
      for (const ep of data.episodes) {
        if (seen.has(ep.video_id)) continue;
        library.push({ ...ep, show: ep.show_name || '' });
      }
      render();
    })
    .catch(() => {/* DB not configured yet — static library still works */});

  render();
})();
