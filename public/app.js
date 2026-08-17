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

  // One honest status line, not a checklist: the bar creeps forward and the
  // sentence says what is happening right now. Jumps to 100% when the map lands.
  const statusEl = document.querySelector('[data-analysis-status]');
  const STAGES = [
    { at: 0, pct: 8, msg: 'Finding the episode…' },
    { at: 4, pct: 30, msg: 'Pulling the full transcript…' },
    { at: 20, pct: 70, msg: 'Mapping the sections…' },
    { at: 75, pct: 92, msg: 'Finishing your podarticle…' },
  ];
  const MAX_WAIT = 240; // cap the crawl at 94% after 4 minutes

  let timers = [];

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function setStage(stage) {
    if (statusEl) statusEl.textContent = stage.msg;
    if (progressBar) progressBar.style.width = stage.pct + '%';
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
      ? 'We saved your link. Sign in and we will pick up right where you left off — mapping is free, with no limit.'
      : 'Sign in to map an episode. Mapping is free with no limit right now, and browsing the library never needs an account.';

    const btn = document.createElement('button');
    btn.className = 'auth-btn auth-btn-lg';
    btn.type = 'button';
    btn.textContent = 'Continue with Google';
    btn.addEventListener('click', () => window.PAAuth.signIn({ pendingUrl }));

    const divider = document.createElement('p');
    divider.className = 'auth-divider';
    divider.textContent = 'or with email';

    const form = document.createElement('form');
    form.className = 'auth-email-form';
    form.innerHTML = `
      <input type="email" autocomplete="email" required placeholder="Email address" aria-label="Email address">
      <input type="password" autocomplete="current-password" required minlength="6" placeholder="Password (6+ characters)" aria-label="Password">
      <div class="auth-email-actions">
        <button type="submit" class="auth-btn auth-btn-lg" data-mode="in">Sign in</button>
        <button type="submit" class="auth-btn auth-btn-lg auth-btn-alt" data-mode="up">Create account</button>
      </div>
      <p class="auth-email-msg" hidden></p>
      <button type="button" class="auth-forgot">Forgot password?</button>`;

    const [emailEl, passEl] = form.querySelectorAll('input');
    const msg = form.querySelector('.auth-email-msg');

    function say(text, ok) {
      msg.hidden = false;
      msg.textContent = text;
      msg.classList.toggle('ok', !!ok);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const mode = e.submitter?.dataset.mode || 'in';
      const email = emailEl.value.trim();
      const password = passEl.value;
      try {
        if (mode === 'up') {
          const data = await window.PAAuth.signUpWithEmail(email, password, pendingUrl);
          // No session yet = Supabase sent a confirmation email.
          say(data.session ? 'Account created — you are signed in.' : 'Check your email for a confirmation link, then sign in.', true);
        } else {
          await window.PAAuth.signInWithEmail(email, password, pendingUrl);
          hideAuthPrompt();
          if (pendingUrl) runAnalysis(pendingUrl);
        }
      } catch (err) {
        say(err.message === 'Invalid login credentials'
          ? 'That email and password don\'t match. New here? Hit Create account instead.'
          : (err.message || 'Something went wrong — try again.'));
      }
    });

    form.querySelector('.auth-forgot').addEventListener('click', async () => {
      const email = emailEl.value.trim();
      if (!email) return say('Enter your email above first, then hit Forgot password.');
      try {
        await window.PAAuth.resetPassword(email);
        say('Password reset email sent — check your inbox.', true);
      } catch (err) {
        say(err.message || 'Could not send the reset email — try again.');
      }
    });

    slot.append(note, btn, divider, form);
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
    if (statusEl) statusEl.textContent = 'Done — opening your podarticle…';
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
    for (const s of STAGES) {
      timers.push(setTimeout(() => setStage(s), s.at * 1000));
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

  // Rewrite the box in place so the reader can see exactly what we are about to analyze.
  function tidyLinkInput() {
    if (!urlInput) return;
    const before = urlInput.value.trim();
    const after = normalizeYouTubeUrl(before);
    if (after === before) return;
    urlInput.value = after;
  }

  urlInput?.addEventListener('paste', () => setTimeout(tidyLinkInput, 0));
  urlInput?.addEventListener('blur', tidyLinkInput);

  // ---------- In-site YouTube search ----------
  // YouTube/Google-style: typing shows SEARCH SUGGESTIONS (topics, shows, popular
  // searches). Picking one — or pressing Enter — shows the matching episodes.
  // Picking an episode starts the same analysis a pasted link would.
  const resultsBox = document.querySelector('[data-yt-results]');

  function hideResults() {
    if (resultsBox) {
      resultsBox.hidden = true;
      resultsBox.replaceChildren();
    }
  }

  function renderSuggestions(items, typed) {
    if (!resultsBox) return;
    resultsBox.replaceChildren();
    const list = [];
    // Always offer the literal query first — suggestions can lag behind reality.
    if (typed && !items.some((s) => s.toLowerCase() === typed.toLowerCase())) list.push(typed);
    for (const s of items) if (!list.includes(s)) list.push(s);
    if (!list.length) return hideResults();
    for (const s of list.slice(0, 8)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'yt-suggestion';
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z"/></svg><span></span>';
      btn.querySelector('span').textContent = s;
      btn.addEventListener('click', () => {
        if (urlInput) urlInput.value = s;
        searchYouTube(s);
      });
      resultsBox.appendChild(btn);
    }
    resultsBox.hidden = false;
  }

  function renderResults(items, query) {
    if (!resultsBox) return;
    resultsBox.replaceChildren();
    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'yt-results-empty';
      p.textContent = `No long episodes found for “${query}” — try a show or guest name, or paste the YouTube link.`;
      resultsBox.appendChild(p);
      resultsBox.hidden = false;
      return;
    }
    for (const v of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'yt-result';
      const mins = v.duration_sec ? Math.round(v.duration_sec / 60) : null;
      // `uploaded` arrives as display-ready text ("3 days ago") — never re-parse it.
      btn.innerHTML = `
        <img loading="lazy" alt="">
        <span class="yt-result-body">
          <span class="yt-result-title"></span>
          <span class="yt-result-meta"></span>
          ${v.channel ? '<span class="yt-result-channel"></span>' : ''}
        </span>`;
      window.PAThumb.bind(btn.querySelector('img')).src = v.thumbnail;
      btn.querySelector('.yt-result-title').textContent = v.title;
      btn.querySelector('.yt-result-meta').textContent =
        [mins ? `${mins} min` : null, v.uploaded || null].filter(Boolean).join(' · ');
      const chanEl = btn.querySelector('.yt-result-channel');
      if (chanEl) {
        chanEl.textContent = `More from ${v.channel} →`;
        chanEl.addEventListener('click', (e) => {
          e.stopPropagation();
          browseChannel(v.channel);
        });
      }
      btn.addEventListener('click', () => {
        hideResults();
        if (urlInput) urlInput.value = `https://www.youtube.com/watch?v=${v.video_id}`;
        runAnalysis(`https://www.youtube.com/watch?v=${v.video_id}`);
      });
      resultsBox.appendChild(btn);
    }
    resultsBox.hidden = false;
  }

  // Clicking a channel name swaps the dropdown to that show's recent episodes.
  // Supadata resolves channel names as well as IDs, so no extra lookup is needed.
  async function browseChannel(name) {
    if (!resultsBox || !name) return;
    resultsBox.replaceChildren();
    const p = document.createElement('p');
    p.className = 'yt-results-empty';
    p.textContent = `Loading recent episodes from ${name}…`;
    resultsBox.appendChild(p);
    resultsBox.hidden = false;
    const seq = ++searchSeq;
    try {
      const r = await fetch(`/api/channel-videos?id=${encodeURIComponent(name)}`);
      const data = await r.json().catch(() => ({}));
      if (seq !== searchSeq) return;
      renderResults(r.ok ? data.results || [] : [], name);
    } catch {
      if (seq === searchSeq) renderResults([], name);
    }
  }

  let searchTimer = null;
  let searchSeq = 0;

  async function fetchSuggestions(query) {
    const seq = ++searchSeq;
    try {
      const r = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`);
      const data = await r.json().catch(() => ({}));
      if (seq !== searchSeq) return; // a newer keystroke owns the box
      renderSuggestions(data.suggestions || [], query);
    } catch {
      if (seq === searchSeq) renderSuggestions([], query);
    }
  }

  async function searchYouTube(query) {
    const seq = ++searchSeq;
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await r.json().catch(() => ({}));
      if (seq !== searchSeq) return; // a newer keystroke owns the box
      renderResults(r.ok ? data.results || [] : [], query);
    } catch {
      if (seq === searchSeq) renderResults([], query);
    }
  }

  urlInput?.addEventListener('input', () => {
    const val = urlInput.value.trim();
    clearTimeout(searchTimer);
    // Links stay on the paste path — no dropdown while a URL is in the box.
    if (val.length < 3 || /youtu/i.test(val)) {
      hideResults();
      return;
    }
    searchTimer = setTimeout(() => fetchSuggestions(val), 250);
  });

  // Keyboard + dismissal, like a real search box: arrows walk the rows, Enter
  // picks the highlighted one (plain Enter still searches the typed text), Esc
  // or clicking anywhere else closes the dropdown.
  let activeRow = -1;

  function rows() {
    return resultsBox && !resultsBox.hidden
      ? Array.from(resultsBox.querySelectorAll('.yt-suggestion, .yt-result'))
      : [];
  }

  function highlight(i) {
    const list = rows();
    activeRow = i;
    list.forEach((el, j) => el.classList.toggle('active', j === i));
    if (list[i]) list[i].scrollIntoView({ block: 'nearest' });
  }

  urlInput?.addEventListener('keydown', (e) => {
    const list = rows();
    if (e.key === 'Escape') {
      hideResults();
      activeRow = -1;
      return;
    }
    if (!list.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlight((activeRow + 1) % list.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight((activeRow - 1 + list.length) % list.length);
    } else if (e.key === 'Enter' && activeRow >= 0) {
      e.preventDefault();
      list[activeRow].click();
      activeRow = -1;
    }
  });

  document.addEventListener('click', (e) => {
    if (resultsBox && !resultsBox.hidden && !resultsBox.contains(e.target) && e.target !== urlInput) {
      hideResults();
      activeRow = -1;
    }
  });

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
      try {
        sessionStorage.setItem('pa_result_' + data.video_id, JSON.stringify(data));
        // Tells the homepage to come back spotless: no leftover link in the box,
        // no half-lit progress state.
        sessionStorage.setItem('pa_reset_home', '1');
      } catch {}
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
      // Not a YouTube address → treat the box as a search and show episodes to pick.
      if (!/youtu/i.test(url)) {
        searchSeq++;
        searchYouTube(url);
        return;
      }
      hideResults();
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

  // ---------- Reset after a completed analysis ----------
  // Coming back from an episode map should feel like a fresh visit, not the
  // aftermath of the last one.
  try {
    if (sessionStorage.getItem('pa_reset_home')) {
      sessionStorage.removeItem('pa_reset_home');
      if (urlInput) urlInput.value = '';
      hideProgress();
      hideAuthPrompt();
      if (progressBar) {
        progressBar.style.width = '0%';
        progressBar.classList.remove('failed');
      }
      hideResults();
    }
  } catch {}

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

  // Seed cards are DOM nodes reused across renders, so ownership has to come back off
  // again when the reader signs out — not just go on when they sign in.
  function markMine(card, mine) {
    card.classList.toggle('is-mine', !!mine);
    const badge = card.querySelector('.card-badge');
    if (mine && !badge) {
      const el = document.createElement('span');
      el.className = 'card-badge';
      el.textContent = 'Yours';
      card.querySelector('.article-card-thumb').appendChild(el);
    } else if (!mine && badge) {
      badge.remove();
    }
  }

  function renderCard(item) {
    if (item.el) {
      markMine(item.el, item.mine);
      return item.el;
    }
    const a = document.createElement('a');
    a.className = 'article-card';
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
    markMine(a, item.mine);
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
