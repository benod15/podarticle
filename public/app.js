// app.js — PodArticle production frontend
// 1. Analyzer: submit → staged progress wheel → redirect to podarticle page
// 2. Episode library: fetched from /api/episodes, with sort + instant search
(() => {
  'use strict';

  // ---------- Welcome-back banner after checkout ----------
  if (new URLSearchParams(window.location.search).get('subscribed') === '1') {
    const banner = document.createElement('div');
    banner.className = 'subscribed-banner';
    banner.innerHTML = '<strong>Welcome to unlimited.</strong> Every podcast you paste is now mapped — no caps.' +
      '<button type="button" aria-label="Dismiss">&times;</button>';
    banner.querySelector('button').addEventListener('click', () => banner.remove());
    const header = document.querySelector('.site-header');
    if (header) header.after(banner);
    // Clean the URL
    history.replaceState(null, '', window.location.pathname);
  }

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

  // Swap the analyzer CTA for a Google sign-in prompt, carrying the pasted link across
  // the OAuth round trip so it is waiting in the box when the reader lands back here.
  function showAuthPrompt(pendingUrl) {
    const slot = document.querySelector('[data-auth-prompt]');
    if (!slot || !window.PAAuth) return;
    slot.hidden = false;
    slot.replaceChildren();

    const note = document.createElement('p');
    note.className = 'auth-prompt-note';
    note.textContent = pendingUrl
      ? 'We saved your link. Sign in with Google and we will pick up right where you left off — mapping is free, with no limit.'
      : 'Sign in with Google to map an episode. Mapping is free with no limit right now, and browsing the library never needs an account.';

    const btn = document.createElement('button');
    btn.className = 'auth-btn auth-btn-lg';
    btn.type = 'button';
    btn.textContent = 'Continue with Google';
    btn.addEventListener('click', () => window.PAAuth.signIn({ pendingUrl }));

    slot.append(note, btn);
  }

  function hideAuthPrompt() {
    const slot = document.querySelector('[data-auth-prompt]');
    if (slot) {
      slot.hidden = true;
      slot.replaceChildren();
    }
  }

  function finishProgress() {
    clearTimers();
    document.querySelectorAll('.analysis-stages li').forEach((li) => {
      li.classList.add('done');
      li.classList.remove('active');
    });
    if (progressBar) progressBar.style.width = '100%';
  }

  // Renders the reader-facing copy for a failure code: what happened, then what to do
  // about it. The code itself and the API's `error` string never reach the page.
  // `stalled` marks a failure caught before any work began — the stage list and bar
  // would be lying, so the panel shows the message alone.
  function failProgress(code, stalled) {
    clearTimers();
    if (progress) {
      progress.hidden = false;
      progress.classList.toggle('error-only', !!stalled);
    }
    if (errorEl) {
      const copy = window.PAMessages.get(code);
      errorEl.replaceChildren();

      const title = document.createElement('strong');
      title.textContent = copy.title;
      const body = document.createElement('span');
      body.textContent = copy.body;
      errorEl.append(title, body);

      if (copy.action?.type === 'link') {
        const a = document.createElement('a');
        a.className = 'analysis-error-action';
        a.href = copy.action.href;
        a.textContent = copy.action.label;
        errorEl.appendChild(a);
      }
      if (copy.support) {
        const help = document.createElement('span');
        help.className = 'analysis-error-help';
        help.append('Still stuck? Email ');
        const mail = document.createElement('a');
        mail.href = 'mailto:' + window.PAMessages.SUPPORT_EMAIL;
        mail.textContent = window.PAMessages.SUPPORT_EMAIL;
        help.append(mail, ' with the link and we will map it for you.');
        errorEl.appendChild(help);
      }
      errorEl.hidden = false;
    }
    if (progressBar) progressBar.classList.add('failed');
  }

  function hideProgress() {
    clearTimers();
    if (progress) {
      progress.hidden = true;
      progress.classList.remove('error-only');
    }
    if (errorEl) errorEl.hidden = true;
  }

  function startProgress() {
    if (!progress) return;
    progress.hidden = false;
    progress.classList.remove('error-only');
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

  // Plain text, not type="url": an unrecognised paste should get our own plain-English
  // "that does not look like a YouTube link" copy, not the browser's terse validation bubble.
  const urlInput = form?.querySelector('[data-link-input]');

  // ---------- Tidying pasted links ----------
  // YouTube's "Copy link" hangs tracking on the end (?si=…, &feature=share, &pp=…), the
  // mobile share sheet wraps the link in a sentence, and a link copied from a playlist
  // carries someone else's list. All of that either breaks the URL field or muddies the
  // request, so any link we recognise is reduced to the plain watch URL plus its start
  // time. A link we do not recognise is left exactly as pasted — better to send it on and
  // let the reader see the "that does not look like a YouTube link" copy than to mangle
  // something that would have worked.
  const YT_ID_RE =
    /(?:youtube\.com\/(?:watch\?[^\s]*?\bv=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

  function startSeconds(text) {
    const m = /[?&#](?:t|start)=([0-9hms]+)/i.exec(text);
    if (!m) return 0;
    const raw = m[1];
    if (/^\d+s?$/.test(raw)) return parseInt(raw, 10);
    const h = /(\d+)h/i.exec(raw);
    const mi = /(\d+)m/i.exec(raw);
    const s = /(\d+)s/i.exec(raw);
    return (h ? +h[1] * 3600 : 0) + (mi ? +mi[1] * 60 : 0) + (s ? +s[1] : 0);
  }

  function normalizeYouTubeUrl(raw) {
    const text = String(raw || '').trim().replace(/^[<"']+|[>"']+$/g, '');
    const m = YT_ID_RE.exec(text);
    if (!m) return text;
    const t = startSeconds(text);
    return `https://www.youtube.com/watch?v=${m[1]}` + (t > 0 ? `&t=${t}s` : '');
  }

  const tipEl = document.querySelector('[data-link-tip]');
  const defaultTip = tipEl?.innerHTML;

  function resetTip() {
    if (tipEl && tipEl.classList.contains('is-tidied')) {
      tipEl.innerHTML = defaultTip;
      tipEl.classList.remove('is-tidied');
    }
  }

  // Rewrite the box in place so the reader can see exactly what we are about to analyze.
  function tidyLinkInput() {
    if (!urlInput) return;
    const before = urlInput.value.trim();
    const after = normalizeYouTubeUrl(before);
    if (after === before) return;
    urlInput.value = after;
    if (tipEl) {
      tipEl.textContent = 'We tidied that link up — the extra tracking bits are gone. Press Analyze when you are ready.';
      tipEl.classList.add('is-tidied');
    }
  }

  urlInput?.addEventListener('input', resetTip);
  urlInput?.addEventListener('paste', () => setTimeout(tidyLinkInput, 0));
  urlInput?.addEventListener('blur', tidyLinkInput);

  async function runAnalysis(url) {
    const btn = form?.querySelector('button[type="submit"]');
    const session = await window.PAAuth?.getSession();

    // Ask for sign-in before spending a minute on an analysis that will be rejected.
    if (!session?.access_token) {
      hideProgress();
      showAuthPrompt(url);
      return;
    }

    hideAuthPrompt();
    if (btn) btn.disabled = true;
    startProgress();
    try {
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ url }),
      });
      // An edge error page is HTML, not JSON — never let the parse failure become the message.
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.analysis) {
        if (data.code === 'AUTH_REQUIRED') {
          hideProgress();
          showAuthPrompt(url);
          return;
        }
        // Every code renders its own explanation plus the button that resolves it —
        // including LIMIT_REACHED, which links to the plans instead of yanking the
        // page away mid-sentence.
        failProgress(data.code);
        return;
      }
      finishProgress();
      // Hand the result to the renderer directly — the slug page is only for
      // library browsing (seed static pages); new analyses render dynamically.
      try { sessionStorage.setItem('pa_result_' + data.video_id, JSON.stringify(data)); } catch {}
      window.location.href = `/episode.html?v=${data.video_id}`;
    } catch {
      failProgress('NETWORK');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      tidyLinkInput();
      const url = (urlInput?.value || '').trim();
      if (!url) {
        failProgress('EMPTY_URL', true);
        urlInput?.focus();
        return;
      }
      // Nothing resembling a YouTube address: say so here rather than asking someone to
      // sign in first, only to reject the link a moment later.
      if (!/youtu/i.test(url)) {
        failProgress('BAD_URL', true);
        urlInput?.focus();
        return;
      }
      runAnalysis(url);
    });

    // Back from Google: put the saved link back in the box and, if sign-in worked,
    // carry on without making anyone paste it a second time.
    (async () => {
      const pending = window.PAAuth?.takePendingUrl?.();
      if (!pending) return;
      if (urlInput) urlInput.value = pending;
      const session = await window.PAAuth?.getSession();
      if (session?.access_token) runAnalysis(pending);
      else showAuthPrompt(pending);
    })();
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
    if (mode === 'mine') {
      arr.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    } else if (mode === 'az') {
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
    a.className = item.mine ? 'article-card is-mine' : 'article-card';
    // DB episodes have no static slug page — use the dynamic renderer.
    a.href = `/episode.html?v=${item.video_id}`;
    a.innerHTML = `
      <div class="article-card-thumb">
        <img src="${window.PAThumb.url(item.video_id)}" alt="" loading="lazy">
      </div>
      <div class="article-card-body">
        <span class="article-card-eyebrow"></span>
        <h3></h3>
        <p></p>
      </div>`;
    window.PAThumb.bind(a.querySelector('img')).alt = item.title;
    a.querySelector('.article-card-eyebrow').textContent = item.show_name || '';
    a.querySelector('h3').textContent = item.title || '';
    a.querySelector('p').textContent = (item.summary || '').slice(0, 120);
    if (item.mine) {
      const badge = document.createElement('span');
      badge.className = 'card-badge';
      badge.textContent = 'Yours';
      a.querySelector('.article-card-thumb').appendChild(badge);
    }
    return a;
  }

  function render() {
    const q = searchInput?.value || '';
    const mode = sortSelect?.value || 'newest';
    const pool = mode === 'mine' ? library.filter((i) => i.mine) : library;
    const visible = sortLibrary(pool.filter((i) => matchesQuery(i, q)), mode);
    grid.innerHTML = '';
    for (const item of visible) grid.appendChild(renderCard(item));
    if (!visible.length) {
      const p = document.createElement('p');
      p.className = 'library-empty';
      p.textContent =
        mode === 'mine'
          ? 'Nothing here yet — paste a podcast link above and your episode maps will collect here.'
          : 'No episodes match that search yet.';
      grid.appendChild(p);
    }
  }

  searchInput?.addEventListener('input', render);
  sortSelect?.addEventListener('change', render);

  // The "Your library" sort option exists only while the reader has personal maps.
  function syncMineOption(hasMine) {
    if (!sortSelect) return;
    const opt = sortSelect.querySelector('option[value="mine"]');
    if (hasMine && !opt) {
      const el = document.createElement('option');
      el.value = 'mine';
      el.textContent = 'Your library';
      sortSelect.appendChild(el);
    } else if (!hasMine && opt) {
      if (sortSelect.value === 'mine') sortSelect.value = 'newest';
      opt.remove();
    }
  }

  // The curated library merges with the reader's own analyses (dedup by video_id): the
  // homepage stays the curated seed for everyone, personal maps sit on top for their owner.
  // Rebuilt from the static seed each time so signing out drops the personal half.
  async function loadLibrary() {
    const session = await window.PAAuth?.getSession().catch(() => null);
    const headers = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
    const r = await fetch('/api/episodes', { headers });
    if (!r.ok) return;
    const data = await r.json();

    library = staticCards.slice();
    const byId = new Map(library.map((i) => [i.video_id, i]));
    const merge = (list, mine) => {
      for (const ep of list || []) {
        const existing = byId.get(ep.video_id);
        if (existing) {
          if (mine) existing.mine = true;
          continue;
        }
        const item = { ...ep, show: ep.show_name || '', mine };
        byId.set(ep.video_id, item);
        library.push(item);
      }
    };
    merge(data.episodes, false);
    merge(data.mine, true);

    syncMineOption(library.some((i) => i.mine));
    render();
  }

  // DB not configured or unreachable — the curated static library still renders.
  let loadedFor;
  function refreshLibrary(session) {
    const userId = session?.user?.id || null;
    if (loadedFor === userId) return;
    loadedFor = userId;
    loadLibrary().catch(() => {});
  }
  if (window.PAAuth) {
    window.PAAuth.getSession().then(refreshLibrary, () => refreshLibrary(null));
    window.PAAuth.onAuthChange(refreshLibrary);
  } else {
    refreshLibrary(null);
  }

  render();
})();
