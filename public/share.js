// public/share.js — quiet moment-sharing for episode pages.
//
// Three pieces:
//   1. injectMeta  — hidden OG/Twitter tags so a pasted link unfurls with the
//                    episode's thumbnail + title in X, iMessage, Slack, etc.
//                    Nothing visible changes on the page.
//   2. attach      — small share icon on each Top 5 moment and section; opens a
//                    menu with a compelling pre-written post (editable before it
//                    goes to X), copy link, and text it.
//   3. deep links  — ...episode.html?v=ID&t=SEC scrolls to the shared moment and
//                    starts it playing right there in the page (muted — the only
//                    way browsers allow autoplay; one tap unmutes).
(function () {
  'use strict';

  function fmtTs(sec) {
    sec = Math.floor(sec || 0);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
  }

  function pageUrl(vid, sec) {
    var u = 'https://podarticle.com/episode.html?v=' + vid;
    return sec ? u + '&t=' + Math.floor(sec) : u;
  }

  // ---------- 1. link preview metadata ----------
  function setMeta(attr, key, content) {
    if (!content) return;
    var sel = 'meta[' + attr + '="' + key + '"]';
    var el = document.head.querySelector(sel);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }

  function injectMeta(data) {
    var meta = data.metadata || {};
    var analysis = data.analysis || {};
    var title = (meta.title || 'Episode') + ' — PodArticle';
    var desc = (analysis.summary || 'Every section, timestamped. Watch only what matters to you.').slice(0, 200);
    var img = 'https://i.ytimg.com/vi/' + data.video_id + '/maxresdefault.jpg';
    var url = pageUrl(data.video_id);

    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', desc);
    setMeta('property', 'og:image', img);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:type', 'article');
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', desc);
    setMeta('name', 'twitter:image', img);
  }

  // ---------- 2. share menu ----------
  var menu = null;

  function closeMenu() {
    if (menu) { menu.remove(); menu = null; }
    document.removeEventListener('click', onDocClick, true);
  }

  function onDocClick(e) {
    if (menu && !menu.contains(e.target)) closeMenu();
  }

  function copyLink(link, item) {
    function done() {
      item.textContent = 'Copied';
      setTimeout(closeMenu, 700);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, done);
    } else {
      var ta = document.createElement('textarea');
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      ta.remove();
      done();
    }
  }

  // ---------- the post itself ----------
  // What makes a podcast post travel on X: a hook (the moment, quoted like a
  // takeaway — not a title), the timestamp as a promise ("this exact second"),
  // and a reason to click. The episode thumbnail rides the link as the big card.
  // Everything is pre-written but editable before it posts.
  function hookText(name) {
    var clean = String(name || '').replace(/\s+/g, ' ').trim();
    return clean.length > 170 ? clean.slice(0, 167).trim() + '…' : clean;
  }

  function buildPost(payload) {
    if (payload.sec != null && payload.name) {
      return (
        '\u201C' + hookText(payload.name) + '\u201D\n\n' +
        'This moment at ' + fmtTs(payload.sec) + ' \u25B6\n' +
        payload.link + '\n\n' +
        '(full episode map: ' + pageUrl(payload.vid) + ')'
      );
    }
    return (
      'Every section of this episode, mapped and timestamped \u2014 watch only what matters:\n\n' +
      payload.link
    );
  }

  function openMenu(btn, payload) {
    closeMenu();
    menu = document.createElement('div');
    menu.className = 'share-menu share-menu-compose';
    menu.setAttribute('role', 'menu');

    var link = payload.link;
    var text = payload.text;

    // Editable preview: what you see is what posts. The card (thumbnail + title)
    // is attached by X automatically from the link inside the text.
    var label = document.createElement('p');
    label.className = 'share-menu-label';
    label.textContent = payload.sec != null ? 'Your post — edit it however you like:' : 'Share this map:';

    var ta = document.createElement('textarea');
    ta.className = 'share-compose';
    ta.rows = payload.sec != null ? 6 : 4;
    ta.value = buildPost(payload);

    var actions = document.createElement('div');
    actions.className = 'share-menu-actions';

    var x = document.createElement('a');
    x.className = 'share-menu-item share-menu-primary';
    x.href = '#'; // real href set from the textarea on every edit
    x.target = '_blank';
    x.rel = 'noopener';
    x.textContent = 'Post on X';

    var copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'share-menu-item';
    copy.textContent = 'Copy link';
    copy.addEventListener('click', function () { copyLink(link, copy); });

    var sms = document.createElement('a');
    sms.className = 'share-menu-item';
    sms.href = 'sms:?&body=' + encodeURIComponent(text + ' ' + link);
    sms.textContent = 'Text it';

    function syncX() {
      x.href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(ta.value);
    }
    ta.addEventListener('input', syncX);
    syncX();

    actions.append(x, copy, sms);
    menu.append(label, ta, actions);
    document.body.appendChild(menu);
    // Keep the menu open while editing — the outside-click closer ignores the box.
    ta.addEventListener('click', function (e) { e.stopPropagation(); });

    // Position under the button, clamped to the viewport edge.
    var r = btn.getBoundingClientRect();
    var mw = menu.offsetWidth;
    var left = Math.min(window.scrollX + r.left, window.scrollX + window.innerWidth - mw - 12);
    menu.style.left = Math.max(12, left) + 'px';
    menu.style.top = (window.scrollY + r.bottom + 6) + 'px';

    setTimeout(function () { document.addEventListener('click', onDocClick, true); }, 0);
  }

  function sharePayload(data, btn) {
    var meta = data.metadata || {};
    var epTitle = meta.title || 'this episode';
    var sec = btn.getAttribute('data-share-sec');
    var name = btn.getAttribute('data-share-title');
    if (sec != null && name) {
      return {
        link: pageUrl(data.video_id, +sec),
        text: '"' + name + '" at ' + fmtTs(+sec) + ' — ' + epTitle,
        sec: +sec,
        name: name,
        vid: data.video_id,
      };
    }
    return {
      link: pageUrl(data.video_id),
      text: epTitle + ' — section-by-section map, so you can skip to what matters:',
      vid: data.video_id,
    };
  }

  function attach(rootEl, data) {
    rootEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-share]') : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      openMenu(btn, sharePayload(data, btn));
    });
  }

  // ---------- 3. deep links ----------
  // Someone opening a shared link should land IN the moment, not near it: the
  // in-page player starts at the shared second (muted — the only autoplay every
  // browser allows; one tap on the player unmutes), and the matching section
  // opens + highlights below so the map is one scroll away.
  function honorDeepLink(data) {
    var t = parseInt(new URLSearchParams(window.location.search).get('t') || '', 10);
    if (!t || isNaN(t)) return;
    var chapters = (data.analysis && data.analysis.chapters) || [];
    var best = null;
    chapters.forEach(function (c, i) {
      var s = c.seconds != null ? c.seconds : 0;
      if (s <= t && (best == null || s > best.s)) best = { s: s, i: i };
    });
    // Start the moment. The player mounts over the hero at the top of the page,
    // which is exactly where a fresh visitor lands — no scroll fight.
    var playing =
      window.PAYouTube && typeof window.PAYouTube.seek === 'function'
        ? window.PAYouTube.seek(t, { muted: true })
        : false;

    var groups = document.querySelectorAll('.chapter-group');
    if (best != null && groups[best.i]) {
      groups[best.i].open = true;
      var target = groups[best.i];
      target.classList.add('share-target');
      // Only scroll to the section when the player couldn't start — otherwise
      // the visitor should stay on the playing video.
      if (!playing) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function () { target.classList.remove('share-target'); }, 4000);
    }
  }

  window.PAShare = { injectMeta: injectMeta, attach: attach, honorDeepLink: honorDeepLink, fmtTs: fmtTs };
})();
