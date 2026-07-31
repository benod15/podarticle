// public/youtube.js — in-page YouTube player + timestamp seeking, shared by every episode page.
//
// Timestamps used to be plain target="_blank" links to youtube.com/watch?...&t=N. The first
// click opened a YouTube tab; every later click was routed to that same already-open tab,
// where YouTube's SPA ignores a new t= param for the video it is already playing — so the
// playhead never moved. The player now lives on this page and every click seeks it directly.
(function () {
  'use strict';

  var API_SRC = 'https://www.youtube.com/iframe_api';
  var API_TIMEOUT_MS = 8000;

  var videoId = null;
  var mount = null;
  var player = null;
  var playerReady = false;
  var pendingSeek = null;
  var apiFailed = false;

  // ---------- Thumbnail fallback ----------
  // YouTube only generates maxresdefault.jpg for some uploads; hqdefault always exists.
  // Capture phase, because resource error events do not bubble.
  document.addEventListener(
    'error',
    function (e) {
      var img = e.target;
      if (!img || img.tagName !== 'IMG' || img.dataset.ytThumbFallback) return;
      var m = /^https:\/\/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\//.exec(img.src || '');
      if (!m) return;
      img.dataset.ytThumbFallback = '1';
      img.src = 'https://i.ytimg.com/vi/' + m[1] + '/hqdefault.jpg';
    },
    true
  );

  // ---------- Parsing ----------
  function videoFromHref(href) {
    var m = /[?&]v=([A-Za-z0-9_-]{11})/.exec(href) || /youtu\.be\/([A-Za-z0-9_-]{11})/.exec(href);
    return m ? m[1] : null;
  }

  function secondsFromHref(href) {
    var m = /[?&#]t=([0-9hms]+)/i.exec(href);
    if (!m) return null;
    var raw = m[1];
    if (/^\d+s?$/.test(raw)) return parseInt(raw, 10);
    var h = /(\d+)h/i.exec(raw);
    var mi = /(\d+)m/i.exec(raw);
    var s = /(\d+)s/i.exec(raw);
    if (!h && !mi && !s) return null;
    return (h ? +h[1] * 3600 : 0) + (mi ? +mi[1] * 60 : 0) + (s ? +s[1] : 0);
  }

  // ---------- IFrame API ----------
  var apiPromise = null;
  function loadApi() {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise(function (resolve, reject) {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prev === 'function') prev();
        resolve(window.YT);
      };
      var s = document.createElement('script');
      s.src = API_SRC;
      s.async = true;
      s.onerror = function () { reject(new Error('YouTube IFrame API failed to load')); };
      document.head.appendChild(s);
      setTimeout(function () {
        if (!(window.YT && window.YT.Player)) reject(new Error('YouTube IFrame API timed out'));
      }, API_TIMEOUT_MS);
    });
    apiPromise.catch(function () { apiFailed = true; });
    return apiPromise;
  }

  // ---------- Mounting ----------
  // Replaces the hero thumbnail link with a poster that upgrades into a real player on
  // first play. The poster keeps the page light until someone actually wants to watch.
  function mountPlayer() {
    var hero = document.querySelector('.ep-hero');
    if (!hero || hero.dataset.ytMounted) return;

    var id = videoFromHref(hero.getAttribute('href') || '');
    if (!id) return;
    hero.dataset.ytMounted = '1';
    videoId = id;

    var img = hero.querySelector('img');
    var shell = document.createElement('div');
    shell.className = 'ep-player';
    shell.innerHTML =
      '<div class="ep-player-frame" data-yt-frame></div>' +
      '<button type="button" class="ep-player-poster" data-yt-poster aria-label="Play episode">' +
      '<img alt="" loading="lazy">' +
      '<span class="ep-hero-play"><span class="ep-hero-play-btn">' +
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6,4 20,12 6,20"/></svg>' +
      '</span></span></button>';

    var posterImg = shell.querySelector('img');
    posterImg.src = img ? img.src : 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg';
    posterImg.alt = img ? img.alt : '';

    shell.querySelector('[data-yt-poster]').addEventListener('click', function () { seek(0); });

    hero.replaceWith(shell);
    mount = shell;
    loadApi();
  }

  function createPlayer(startSeconds) {
    var frame = mount && mount.querySelector('[data-yt-frame]');
    if (!frame || player) return;
    player = true; // claim the slot so concurrent clicks do not build two players
    loadApi().then(
      function (YT) {
        player = new YT.Player(frame, {
          videoId: videoId,
          playerVars: {
            start: startSeconds || 0,
            autoplay: 1,
            rel: 0,
            playsinline: 1,
            modestbranding: 1,
          },
          events: {
            onReady: function (e) {
              playerReady = true;
              mount.classList.add('is-playing');
              // A click may have landed while the API was still loading.
              if (pendingSeek != null && pendingSeek !== startSeconds) e.target.seekTo(pendingSeek, true);
              pendingSeek = null;
              e.target.playVideo();
            },
          },
        });
      },
      function () {
        player = null;
        apiFailed = true;
      }
    );
  }

  // Seek the in-page player to `seconds`, creating it on first use.
  // Returns false when no player is available, so callers can fall back to YouTube.
  function seek(seconds) {
    if (!mount || apiFailed) return false;
    seconds = Math.max(0, Math.floor(seconds || 0));
    if (playerReady && player && typeof player.seekTo === 'function') {
      player.seekTo(seconds, true);
      player.playVideo();
    } else {
      pendingSeek = seconds;
      createPlayer(seconds);
    }
    reveal();
    return true;
  }

  function reveal() {
    if (!mount) return;
    var box = mount.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) {
      mount.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ---------- Click handling ----------
  // Delegated so it covers server-rendered seed pages and the dynamic renderer alike,
  // and so every click is handled independently — no first-click-only state.
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var link = e.target.closest && e.target.closest('a[href*="youtu"]');
    if (!link) return;

    var href = link.getAttribute('href') || '';
    if (videoFromHref(href) !== videoId) return; // a different video: let it open on YouTube

    var seconds = secondsFromHref(href);
    if (seconds == null) return; // "watch full episode": let it open on YouTube

    if (seek(seconds)) e.preventDefault();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountPlayer);
  } else {
    mountPlayer();
  }

  window.PAYouTube = { mount: mountPlayer, seek: seek };
})();
