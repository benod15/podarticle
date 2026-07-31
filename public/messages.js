// public/messages.js — the only place failure copy is written.
//
// The API's error codes (AUTH_REQUIRED, LIMIT_REACHED, NO_TRANSCRIPT, …) are an internal
// contract for branching logic. They must never reach a reader, and neither must the
// `error` strings the API sends alongside them — those are diagnostic text for logs.
// Every surface renders from this map instead, so each failure says what happened in
// plain English and what to do next.
(function () {
  var SUPPORT_EMAIL = 'podarticle@gmail.com';

  // action: { type: 'signin' } | { type: 'link', href, label }
  var COPY = {
    AUTH_REQUIRED: {
      title: 'Sign in to map an episode',
      body: 'Mapping a new episode needs a free account so your podarticles are saved and waiting next time. Sign in with Google — your first 5 maps are free, and reading the library never needs an account.',
      action: { type: 'signin' },
    },
    // Same AUTH_REQUIRED code from the API, but on the pricing page the reason is money,
    // not episode limits — so the checkout surface asks for this variant by name.
    AUTH_REQUIRED_CHECKOUT: {
      title: 'Sign in before you subscribe',
      body: 'A subscription is tied to your Google account, so we need you signed in first — paying while signed out would not unlock anything. We are opening Google sign-in now; choose your plan again once you land back here.',
    },
    AUTH_EXPIRED: {
      title: 'Your sign-in has expired',
      body: 'We sign everyone out after a while for security. Sign out from the top of this page, sign back in with Google, then try again.',
    },
    AUTH_UNAVAILABLE: {
      title: 'Sign-in is not working right now',
      body: 'This one is on us, not you — nothing is wrong with your account. Wait a minute and try signing in again.',
      support: true,
    },
    LIMIT_REACHED: {
      title: 'You have used your 5 free podarticles',
      body: 'Everything already in the library stays free to read, forever. To keep mapping new episodes, pick a plan: $5 a month billed yearly, or $10 month to month. Cancel whenever you like.',
      action: { type: 'link', href: 'pricing.html', label: 'See the plans' },
    },
    NO_TRANSCRIPT: {
      title: 'We could not find a transcript for this video',
      body: 'PodArticle builds its maps from the episode’s captions, and YouTube does not have captions for this video yet. Brand new uploads usually get them within a few hours, so try again later — or paste a different episode.',
      support: true,
    },
    BAD_URL: {
      title: 'That does not look like a YouTube link',
      body: 'Open the episode on YouTube, copy the address from your browser’s address bar, and paste the whole thing here. It should look like youtube.com/watch?v=… or youtu.be/… — playlist and channel pages will not work.',
      support: true,
    },
    EMPTY_URL: {
      title: 'Paste a YouTube link first',
      body: 'Copy the address of the podcast episode on YouTube, paste it into the box above, then press Analyze.',
    },
    UNAVAILABLE: {
      title: 'Episode mapping is paused right now',
      body: 'We have temporarily switched mapping off while we fix something on our side. There is nothing wrong with your link — please try again in a few minutes.',
      support: true,
    },
    ANALYSIS_FAILED: {
      title: 'We could not finish mapping that episode',
      body: 'Something broke on our side partway through. Press Analyze to try it once more — some episodes go through fine on a second attempt.',
      support: true,
    },
    NOT_FOUND: {
      title: 'We could not find that episode',
      body: 'The link may be mistyped, or the map may have been taken down. Search the library for the show, or paste the episode’s YouTube link again and we will build a fresh map.',
      action: { type: 'link', href: 'index.html#feed', label: 'Browse the library' },
    },
    NETWORK: {
      title: 'We could not reach PodArticle',
      body: 'That usually means the connection dropped. Check your internet and try again — nothing you did was lost.',
    },
    PAYMENTS_UNAVAILABLE: {
      title: 'Subscriptions are not switched on yet',
      body: 'Your 5 free podarticles still work in the meantime. Email us and we will tell you the moment plans go live.',
      support: true,
    },
    BAD_PLAN: {
      title: 'We could not tell which plan you picked',
      body: 'Reload this page and choose a plan again. If the same thing happens, email us and we will set the subscription up for you by hand.',
      support: true,
    },
    CHECKOUT_FAILED: {
      title: 'We could not open the checkout page',
      body: 'You have not been charged anything. Try the button once more in a moment — if it still will not open, email us and we will send you a direct payment link.',
      support: true,
    },
    NO_SUBSCRIPTION: {
      title: 'No subscription on this account',
      body: 'You may be signed in with a different Google account than the one you paid with. Sign out, sign back in with the right account, and try again.',
      support: true,
    },
    PORTAL_FAILED: {
      title: 'We could not open your subscription settings',
      body: 'Try the link again in a moment. If you want to cancel or switch plans right now, email us and we will take care of it for you.',
      support: true,
    },
  };

  // Anything unrecognised — an unmapped code, a blank response, an HTML error page from
  // the edge — is still a failure the reader can act on, so it gets real copy too.
  var FALLBACK = {
    title: 'Something went wrong on our side',
    body: 'That is all we know — it was not caused by anything you did. Please try again in a moment.',
    support: true,
  };

  function get(code) {
    return (code && COPY[code]) || FALLBACK;
  }

  // One-line version for tight spaces (inline notices under a button).
  function line(code) {
    var c = get(code);
    return c.title + '. ' + c.body;
  }

  window.PAMessages = { SUPPORT_EMAIL: SUPPORT_EMAIL, get: get, line: line };
})();
