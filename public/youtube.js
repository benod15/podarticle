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
  var targetSec = 0;
  var apiFailed = false;
  var engaged = false;
  var lastOrigin = null;

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
  // Replaces the hero thumbnail link with a poster, and creates the player right away,
  // CUED behind it. Phones block autoplay without a tap, so a lazily-created player
  // left the first timestamp click dead (the video just sat cued behind a red YouTube
  // play button). With the player already alive, the first click seeks + plays inside
  // the tap gesture itself — which every browser allows, with sound.
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
    // The API replaces its target element with the iframe, so it gets a disposable child
    // rather than .ep-player-frame itself — the frame keeps stretching the iframe to 16:9.
    shell.innerHTML =
      '<div class="ep-player-frame"><div data-yt-frame></div></div>' +
      '<button type="button" class="ep-player-poster" data-yt-poster aria-label="Play episode">' +
      '<img alt="" loading="lazy">' +
      '<span class="ep-hero-play"><span class="ep-hero-play-btn">' +
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6,4 20,12 6,20"/></svg>' +
      '</span></span></button>';

    var posterImg = window.PAThumb.bind(shell.querySelector('img'));
    posterImg.src = img ? img.src : window.PAThumb.url(id);
    posterImg.alt = img ? img.alt : '';

    // The poster plays whatever the visitor came for — the shared moment on a
    // deep link, the start of the episode otherwise.
    shell.querySelector('[data-yt-poster]').addEventListener('click', function () { seek(targetSec || 0); });

    hero.replaceWith(shell);
    mount = shell;
    addBackButton();

    var deepT = parseInt(new URLSearchParams(window.location.search).get('t') || '', 10);
    var hasDeep = Number.isFinite(deepT) && deepT > 0;
    if (hasDeep) {
      targetSec = deepT;
      pendingSeek = deepT;
    }
    // Deep links: muted autoplay (the only kind allowed without a tap) + sound pill.
    // Normal visits: cued unmuted, waiting for the first real tap.
    createPlayer(hasDeep ? deepT : 0, hasDeep);
  }

  // ---------- Tap for sound ----------
  // Muted autoplay is the only kind browsers allow from a cold link. So a deep
  // link starts muted and arms this: a pulsing pill over the video, and the
  // first tap ANYWHERE on the page unmutes. One tap to sound — the closest the
  // browser autoplay policies let anyone get to unmuted-off-the-rip.
  var soundPill = null;
  var soundPoll = null;

  function armTapForSound() {
    if (!mount || soundPill) return;
    soundPill = document.createElement('button');
    soundPill.type = 'button';
    soundPill.className = 'tap-for-sound';
    soundPill.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19" fill="currentColor" stroke="none"/>' +
      '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9.5 9.5 0 0 1 0 13"/></svg>' +
      '<span>Tap for sound</span>';
    mount.appendChild(soundPill);

    function disarm() {
      if (soundPill) { soundPill.remove(); soundPill = null; }
      document.removeEventListener('pointerdown', onFirstTap, true);
      if (soundPoll) { clearInterval(soundPoll); soundPoll = null; }
    }
    function unmuteNow() {
      if (player && typeof player.unMute === 'function') {
        player.unMute();
        if (typeof player.setVolume === 'function') player.setVolume(100);
      }
      disarm();
    }
    // The first tap unmutes in the capture phase but does NOT consume the
    // gesture — a tap on a timestamp also seeks, so nobody ever needs two
    // taps to get what they pressed. The pill itself must swallow its taps:
    // it sits over YouTube's title bar, and a pass-through tap there follows
    // the embed's link out to youtube.com.
    function onFirstTap() { unmuteNow(); }
    soundPill.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      unmuteNow();
    });
    soundPill.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener('pointerdown', onFirstTap, true);
    // Unmuted via YouTube's own controls instead — drop the pill.
    soundPoll = setInterval(function () {
      if (player && typeof player.isMuted === 'function' && !player.isMuted()) disarm();
    }, 800);
  }

  function createPlayer(startSeconds, muted) {
    var frame = mount && mount.querySelector('[data-yt-frame]');
    if (!frame || player) return;
    player = true; // claim the slot so concurrent clicks do not build two players
    loadApi().then(
      function (YT) {
        player = new YT.Player(frame, {
          videoId: videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            start: startSeconds || 0,
            // Browsers only allow autoplay when muted (or after a user gesture).
            // Deep links arrive without a gesture, so they autoplay muted — one tap
            // unmutes. Normal visits cue silently and wait for a tap, which then
            // plays with sound inside the gesture.
            autoplay: muted ? 1 : 0,
            mute: muted ? 1 : 0,
            rel: 0,
            playsinline: 1,
            modestbranding: 1,
          },
          events: {
            onReady: function (e) {
              playerReady = true;
              // playerVars.start is unreliable alongside autoplay — the player often
              // ignores it and plays from 0:00, which made the first timestamp click
              // on a fresh page appear to do nothing. Always seek explicitly; a
              // same-spot seek when start DID work is harmless.
              if (pendingSeek != null) {
                e.target.seekTo(pendingSeek, true);
                pendingSeek = null;
                if (muted) e.target.playVideo();
              }
              if (muted) armTapForSound();
            },
            onStateChange: function (e) {
              // The poster stays until the video is genuinely playing — a cued or
              // blocked player never shows YouTube's red-button dead state.
              if (e.data === 1) mount.classList.add('is-playing');
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

  // Seek the in-page player to `seconds`. The player is created at page load, so a
  // timestamp click is a gesture acting on a live player — seek + play just works.
  // Returns false when no player is available, so callers can fall back to YouTube.
  function seek(seconds, opts) {
    if (!mount || apiFailed) return false;
    seconds = Math.max(0, Math.floor(seconds || 0));
    engaged = true;
    targetSec = seconds;
    if (playerReady && player && typeof player.seekTo === 'function') {
      player.seekTo(seconds, true);
      player.playVideo();
    } else {
      pendingSeek = seconds;
      createPlayer(seconds, !!(opts && opts.muted)); // safety net; mount already did
    }
    reveal();
    updateBackButton();
    return true;
  }

  function reveal() {
    if (!mount) return;
    var box = mount.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) {
      mount.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ---------- Back to sections ----------
  // Playing a section scrolls the page up to the player, which used to leave the browser
  // back arrow as the only way back to the list. This is the in-page return trip: a pill
  // that appears once someone is actually watching and the player fills the screen, and
  // takes them back to the section they came from.
  var backBtn = null;

  function playerVisibleRatio() {
    if (!mount) return 0;
    var box = mount.getBoundingClientRect();
    if (!box.height) return 0;
    var shown = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
    return Math.max(0, shown) / box.height;
  }

  function updateBackButton() {
    if (!backBtn) return;
    backBtn.hidden = !(engaged && playerVisibleRatio() > 0.5);
  }

  function addBackButton() {
    if (backBtn || !document.querySelector('.ep-main')) return;
    backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'ep-back-to-sections';
    backBtn.hidden = true;
    backBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<path d="M12 5v14M5 12l7 7 7-7"/></svg>Back to sections';
    backBtn.addEventListener('click', function () {
      var target = lastOrigin && document.contains(lastOrigin) ? lastOrigin : document.querySelector('.ep-main');
      if (!target) return;
      // The pill hides itself as soon as the sections come back into view, so hand focus
      // to the destination first — otherwise a keyboard user is left with nothing focused.
      if (!target.hasAttribute('tabindex') && target.tabIndex < 0) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: 'smooth', block: target === lastOrigin ? 'center' : 'start' });
    });
    document.body.appendChild(backBtn);

    var queued = false;
    window.addEventListener(
      'scroll',
      function () {
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () {
          queued = false;
          updateBackButton();
        });
      },
      { passive: true }
    );
    window.addEventListener('resize', updateBackButton, { passive: true });
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

    // Remember where the click came from so "Back to sections" lands on that same card.
    lastOrigin = link.closest('.top5-card, .chapter-group') || link;

    if (seek(seconds)) e.preventDefault();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountPlayer);
  } else {
    mountPlayer();
  }

  window.PAYouTube = { mount: mountPlayer, seek: seek };
})();
