// public/episode.js — episode page renderer. Loaded by episode.html and by the
// pretty share URLs (/e/<videoId>, served with crawler-readable meta by
// api/episode-page.js). The video id comes from ?v= or the /e/ path.
(function () {
  var root = document.getElementById('episode-root');
  var params = new URLSearchParams(window.location.search);
  var pathMatch = /\/e\/([A-Za-z0-9_-]{11})/.exec(window.location.pathname);
  var vid = params.get('v') || (pathMatch && pathMatch[1]);
  var SUPPORT_EMAIL = window.PAMessages.SUPPORT_EMAIL;

  // Renders a friendly, self-explanatory state. Never surfaces raw API or parser output.
  function showNotice(heading, body, actions) {
    var wrap = document.createElement('div');
    wrap.className = 'ep-notice';
    var h = document.createElement('h1');
    h.textContent = heading;
    var p = document.createElement('p');
    p.textContent = body;
    wrap.append(h, p);
    var row = document.createElement('div');
    row.className = 'ep-notice-actions';
    (actions || []).forEach(function (el) { row.appendChild(el); });
    var home = document.createElement('a');
    home.className = 'btn-secondary';
    home.href = 'index.html';
    home.textContent = 'Back to PodArticle';
    row.appendChild(home);
    wrap.appendChild(row);
    var help = document.createElement('p');
    help.className = 'ep-notice-help';
    help.innerHTML = 'Still stuck? Email <a href="mailto:' + SUPPORT_EMAIL + '">' + SUPPORT_EMAIL + '</a> and we will take a look.';
    wrap.appendChild(help);
    root.replaceChildren(wrap);
  }

  function signInButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'auth-btn auth-btn-lg';
    btn.textContent = 'Continue with Google';
    btn.addEventListener('click', function () {
      if (window.PAAuth) window.PAAuth.signIn();
    });
    return btn;
  }

  function linkButton(href, text, cls) {
    var a = document.createElement('a');
    a.className = cls;
    a.href = href;
    a.textContent = text;
    return a;
  }

  if (!vid) {
    showNotice(
      'No episode loaded',
      'Paste a YouTube link on the homepage and we will build the section map for you.',
      []
    );
    return;
  }

  var attempts = 0;

  // Fresh result handed over from the analyzer — render instantly.
  var stored = null;
  try { stored = JSON.parse(sessionStorage.getItem('pa_result_' + vid) || 'null'); } catch (e) {}
  if (stored && stored.analysis) {
    sessionStorage.removeItem('pa_result_' + vid);
    render(stored);
    return;
  }

  // The API's `code` picks the copy; neither the code nor the API's `error` text is
  // ever rendered. An unmapped or missing code falls back to plain "our side" copy.
  function handleFailure(status, data) {
    if (status >= 500 && attempts < 2) {
      setTimeout(loadEpisode, 3000);
      return;
    }
    var copy = window.PAMessages.get(data.code);
    var actions = [];
    if (copy.action && copy.action.type === 'signin') actions.push(signInButton());
    if (copy.action && copy.action.type === 'link') {
      actions.push(linkButton(copy.action.href, copy.action.label, 'btn-primary'));
    }
    showNotice(copy.title, copy.body, actions);
  }

  function loadEpisode() {
    attempts++;
    var headers = { 'Content-Type': 'application/json' };
    var authP = window.PAAuth && window.PAAuth.getSession ? window.PAAuth.getSession() : Promise.resolve(null);
    authP.then(function (session) {
      if (session && session.access_token) headers.Authorization = 'Bearer ' + session.access_token;
      return fetch('/api/analyze', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=' + vid })
      });
    })
      .then(function (r) {
        // An edge/proxy error page is HTML, not JSON — parsing it must not become the
        // error the reader sees ("Unexpected token '<' ...").
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (r.ok && data.analysis) return render(data);
          handleFailure(r.status, data);
        });
      })
      .catch(function () {
        if (attempts < 2) {
          setTimeout(loadEpisode, 3000);
          return;
        }
        var copy = window.PAMessages.get('NETWORK');
        showNotice(copy.title, copy.body, []);
      });
  }
  loadEpisode();

  function render(data) {

  var meta = data.metadata || {};
  var analysis = data.analysis;
  var vid = data.video_id;
  var ytBase = 'https://www.youtube.com/watch?v=' + vid;

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function yt(sec) { return ytBase + '&t=' + Math.floor(sec || 0) + 's'; }
  function fmtTs(sec) {
    sec = Math.floor(sec || 0);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
  }

  var thumb = window.PAThumb.url(vid);
  var top5 = analysis.top5 || [];
  var chapters = analysis.chapters || [];
  var allVerified = top5.length > 0 && top5.every(function (t) { return t.verified !== false; });

  document.title = (meta.title || 'Episode') + ' — PodArticle';
  if (window.PAShare) window.PAShare.injectMeta(data);

  var SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v13"/><polyline points="7,8 12,3 17,8"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
  function shareBtn(sec, title) {
    return '<button type="button" class="share-btn" data-share data-share-sec="' + Math.floor(sec || 0) +
      '" data-share-title="' + esc(title) + '" aria-label="Share this moment" title="Share this moment">' + SHARE_ICON + '</button>';
  }

  var html = '';

  // Hero
  html += '<a class="ep-hero" href="' + yt(0) + '" target="_blank" rel="noopener" aria-label="Watch original on YouTube">' +
    '<img src="' + thumb + '" alt="' + esc(meta.title) + '">' +
    '<div class="ep-hero-play"><span class="ep-hero-play-btn">' +
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6,4 20,12 6,20"/></svg>' +
    '</span></div></a>';

  html += '<article class="ep-main">';
  html += '<a class="back-link" href="index.html#feed">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>' +
    'Back to all episodes</a>';
  html += '<p class="ep-kicker">Episode map &middot; ' + esc(meta.author || 'YouTube') + '</p>';
  html += '<h1 class="ep-title">' + esc(meta.title || 'Untitled episode') + '</h1>';
  html += '<p class="ep-intro">' + esc(analysis.summary || '') + '</p>';
  html += '<div class="ep-share-row"><button type="button" class="share-btn share-btn-text" data-share>' + SHARE_ICON + '<span>Share this map</span></button></div>';

  // Verified badge
  if (allVerified && data.chapters_found > 0) {
    html += '<div class="verified-badge">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>' +
      'Every timestamp below is pulled from the episode\'s actual transcript, aligned to the show\'s own YouTube chapters.</div>';
  } else if (data.chapters_found === 0) {
    html += '<div class="verified-badge" style="border-color:#c9a86a;color:#8a7a5a;">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>' +
      'This video has no official chapters — timestamps are pulled from the episode\'s actual transcript.</div>';
  }

  // Top 5
  if (top5.length) {
    html += '<section aria-labelledby="top5-heading"><div class="top5-head">' +
      '<p class="eyebrow">Top ' + top5.length + ' for this episode</p>' +
      '<h2 id="top5-heading">If you only watch ' + (top5.length === 5 ? 'five' : top5.length) + ' moments</h2>' +
      '<p>Ranked by what listeners tend to care about most — start anywhere, no scrubbing required.</p></div>' +
      '<div class="top5-list">';
    top5.forEach(function (t) {
      html += '<a class="top5-card" href="' + yt(t.seconds) + '" target="_blank" rel="noopener">' +
        '<span class="top5-rank">' + esc(t.rank) + '</span>' +
        '<div class="top5-body"><div class="top5-top-row">' +
        '<span class="top5-title">' + esc(t.title) + '</span>' +
        '<span class="top5-time">' + esc(fmtTs(t.seconds != null ? t.seconds : t.timestamp)) + '</span>' +
        shareBtn(t.seconds, t.title) + '</div>' +
        '<p class="top5-desc">' + esc(t.description) + '</p></div>' +
        '<span class="top5-play"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6,4 20,12 6,20"/></svg></span></a>';
    });
    html += '</div></section>';
  }

  // Full section map
  if (chapters.length) {
    html += '<section aria-labelledby="map-heading"><div class="map-head">' +
      '<h2 id="map-heading">Full section map</h2>' +
      '<p>Jump straight to the part you want — every section plays right here, from that exact moment.</p></div>';
    chapters.forEach(function (c, i) {
      html += '<details class="chapter-group"' + (i === 0 ? ' open' : '') + '>' +
        '<summary class="chapter-summary"><span class="chapter-summary-left">' +
        '<span class="chapter-time">' + esc(fmtTs(c.seconds != null ? c.seconds : c.timestamp)) + '</span>' +
        '<span class="chapter-name">' + esc(c.title) + '</span>' +
        shareBtn(c.seconds, c.title) + '</span>' +
        '<svg class="chapter-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6,9 12,15 18,9"/></svg>' +
        '</summary><div class="chapter-items"><div class="chapter-item">' +
        '<a class="chapter-item-time" href="' + yt(c.seconds) + '" target="_blank" rel="noopener">' + esc(fmtTs(c.seconds != null ? c.seconds : c.timestamp)) + '</a>' +
        '<div class="chapter-item-text"><strong>' + esc(c.title) + '</strong><p>' + esc(c.description) + '</p></div>' +
        '</div></div></details>';
    });
    html += '</section>';
  }

  // Bottom actions
  html += '<div class="ep-bottom">' +
    '<a class="btn-primary" href="' + yt(0) + '" target="_blank" rel="noopener">' +
    '<svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6,4 20,12 6,20"/></svg>' +
    'Watch full episode</a>' +
    '<a class="btn-secondary" href="index.html">' +
    '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>' +
    'Analyze another episode</a></div>';

  html += '</article>';
  root.innerHTML = html;
  // Mount the player before honoring a deep link — a shared ?t= starts playing.
  if (window.PAYouTube) window.PAYouTube.mount();
  if (window.PAShare) { window.PAShare.attach(root, data); window.PAShare.honorDeepLink(data); }
  }
})();
