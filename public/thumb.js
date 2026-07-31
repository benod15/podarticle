// public/thumb.js — YouTube thumbnail fallback, shared by every page that shows a thumbnail.
//
// YouTube only generates maxresdefault.jpg for some uploads and sddefault.jpg for most;
// mqdefault.jpg is the only size that always exists. Any <img> pointing at i.ytimg.com steps
// down the chain until it gets a real thumbnail.
//
// A missing size does NOT surface as a load error. i.ytimg.com answers with a 404 whose body
// is a decodable 120x90 grey JPEG, so the browser paints that grey block and fires `load` as
// though nothing went wrong — an `error` listener alone never runs. Every real thumbnail size
// is at least 320px wide, so width is what separates a hit from the placeholder.
//
// Load this with a blocking <script> in <head>: the document listener has to be installed
// before the parser reaches the first <img> in the body, or those images resolve unobserved.
(function () {
  'use strict';

  var CHAIN = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault'];
  var SRC_RE = /^https:\/\/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\/([a-z0-9]+)\.jpg/;
  var PLACEHOLDER_WIDTH = 120;

  function url(videoId, size) {
    return 'https://i.ytimg.com/vi/' + videoId + '/' + (size || CHAIN[0]) + '.jpg';
  }

  function handle(e) {
    if (e.paThumbHandled) return; // document and element listeners both see this event
    var img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    if (img.naturalWidth > PLACEHOLDER_WIDTH) return; // a real thumbnail; 0 on a hard failure
    var m = SRC_RE.exec(img.src || '');
    if (!m) return;
    var next = CHAIN[CHAIN.indexOf(m[2]) + 1];
    if (!next) return;
    e.paThumbHandled = true;
    img.src = url(m[1], next);
  }

  // Capture phase: resource load and error events do not bubble.
  document.addEventListener('load', handle, true);
  document.addEventListener('error', handle, true);

  // An <img> built in JS can resolve while still detached — a response already in the HTTP
  // cache lands before the element is appended, where the document listener never sees it.
  function bind(img) {
    img.addEventListener('load', handle);
    img.addEventListener('error', handle);
    return img;
  }

  window.PAThumb = { url: url, bind: bind };
})();
