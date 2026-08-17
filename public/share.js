// public/share.js — quiet moment-sharing for episode pages.
//
// Three pieces:
//   1. injectMeta  — hidden OG/Twitter tags so a pasted link unfurls with the
//                    episode's thumbnail + title in X, iMessage, Slack, etc.
//                    Nothing visible changes on the page.
//   2. attach      — small share icon on each Top 5 moment and section; opens a
//                    tiny menu: copy a deep link, post on X, or text it.
//   3. deep links  — ...episode.html?v=ID&t=SEC scrolls to and highlights that
//                    moment for the person opening the shared link. No autoplay.
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

  function openMenu(btn, payload) {
    closeMenu();
    menu = document.createElement('div');
    menu.className = 'share-menu';
    menu.setAttribute('role', 'menu');

    var link = payload.link;
    var text = payload.text;

    var copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'share-menu-item';
    copy.textContent = 'Copy link';
    copy.addEventListener('click', function () { copyLink(link, copy); });

    var x = document.createElement('a');
    x.className = 'share-menu-item';
    x.href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text + '\n' + link);
    x.target = '_blank';
    x.rel = 'noopener';
    x.textContent = 'Post on X';

    var sms = document.createElement('a');
    sms.className = 'share-menu-item';
    sms.href = 'sms:?&body=' + encodeURIComponent(text + ' ' + link);
    sms.textContent = 'Text it';

    menu.append(copy, x, sms);
    document.body.appendChild(menu);

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
      };
    }
    return {
      link: pageUrl(data.video_id),
      text: epTitle + ' — section-by-section map, so you can skip to what matters:',
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
  // Land the reader on the shared moment: open its section, scroll, brief highlight.
  // Deliberately no autoplay — the play button is right there if they want it.
  function honorDeepLink(data) {
    var t = parseInt(new URLSearchParams(window.location.search).get('t') || '', 10);
    if (!t || isNaN(t)) return;
    var chapters = (data.analysis && data.analysis.chapters) || [];
    var best = null;
    chapters.forEach(function (c, i) {
      var s = c.seconds != null ? c.seconds : 0;
      if (s <= t && (best == null || s > best.s)) best = { s: s, i: i };
    });
    var groups = document.querySelectorAll('.chapter-group');
    if (best != null && groups[best.i]) {
      groups[best.i].open = true;
      var target = groups[best.i];
      target.classList.add('share-target');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function () { target.classList.remove('share-target'); }, 4000);
    }
  }

  window.PAShare = { injectMeta: injectMeta, attach: attach, honorDeepLink: honorDeepLink, fmtTs: fmtTs };
})();
