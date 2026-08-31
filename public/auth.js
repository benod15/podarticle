// public/auth.js — Google + email/password sign-in via Supabase, shared by every page.
// Exposes window.PAAuth = { client, getSession, signIn, signUpWithEmail, signInWithEmail,
//                           resetPassword, signOut, onAuthChange }.
(function () {
  // The one place the Supabase endpoint is named. Everything else — sign-in, the OAuth
  // round trip, the `plans` lookups — goes through the client built from it.
  //
  // This is the custom domain rather than the generated project ref because Google's
  // consent screen shows the host to the reader. Supabase keeps serving the original
  // *.supabase.co host, so reverting this one line is a complete rollback.
  // Steps: docs/brand-ops.md.
  const SUPABASE_URL = 'https://agmajezadtqkrnuwlmyk.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_eZBBoI-WqjJV0pGwBPVjSw_0V1fGKyn';

  if (!window.supabase) {
    console.warn('Supabase JS not loaded');
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  async function getSession() {
    const { data } = await client.auth.getSession();
    return data.session;
  }

  // A YouTube link the reader pasted before being sent to Google. Kept in localStorage
  // because the OAuth round trip leaves the origin, and restored on the way back so
  // nobody has to paste the same link twice.
  const PENDING_KEY = 'pa_pending_url';
  const PENDING_TTL_MS = 30 * 60 * 1000;

  function setPendingUrl(url) {
    try {
      if (url) localStorage.setItem(PENDING_KEY, JSON.stringify({ url, at: Date.now() }));
    } catch {}
  }

  // Reads and clears the pending link. Stale entries are dropped so an abandoned
  // sign-in from last week does not resurface a link out of nowhere.
  function takePendingUrl() {
    let raw = null;
    try {
      raw = localStorage.getItem(PENDING_KEY);
      localStorage.removeItem(PENDING_KEY);
    } catch {}
    if (!raw) return null;
    try {
      const { url, at } = JSON.parse(raw);
      return at && Date.now() - at < PENDING_TTL_MS ? url : null;
    } catch {
      return null;
    }
  }

  async function signIn(options) {
    const opts = options || {};
    if (opts.pendingUrl) setPendingUrl(opts.pendingUrl);
    await client.auth.signInWithOAuth({
      provider: 'google',
      // Come back to the page they left, not always the homepage.
      options: { redirectTo: opts.returnTo || window.location.href },
    });
  }

  // ---------- Email + password ----------
  // For readers without a Google account. Supabase emails a confirmation link on
  // sign-up; the session starts when they click through it.
  async function signUpWithEmail(email, password, pendingUrl) {
    if (pendingUrl) setPendingUrl(pendingUrl);
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin + '/index.html' },
    });
    if (error) throw error;
    return data;
  }

  async function signInWithEmail(email, password, pendingUrl) {
    if (pendingUrl) setPendingUrl(pendingUrl);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function resetPassword(email) {
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/index.html',
    });
    if (error) throw error;
  }

  async function signOut() {
    await client.auth.signOut();
    window.location.reload();
  }

  function onAuthChange(cb) {
    client.auth.onAuthStateChange((_event, session) => cb(session));
  }

  window.PAAuth = { client, getSession, signIn, signUpWithEmail, signInWithEmail, resetPassword, signOut, onAuthChange, setPendingUrl, takePendingUrl };

  // Render the header auth button on pages that include the slot.
  async function renderAuthButton() {
    const slot = document.querySelector('[data-auth-slot]');
    if (!slot) return;
    const session = await getSession();
    if (session) {
      // Paid users get an Unlimited badge alongside Sign out
      let isActive = false;
      try {
        const { data } = await client.from('plans').select('status').eq('user_id', session.user.id).maybeSingle();
        isActive = data?.status === 'active';
      } catch {}
      const btn = document.createElement('button');
      btn.className = 'auth-btn';
      btn.textContent = 'Sign out';
      btn.addEventListener('click', signOut);
      if (isActive) {
        const badge = document.createElement('span');
        badge.className = 'plan-badge';
        badge.textContent = 'Unlimited';
        slot.replaceChildren(badge, btn);
      } else {
        slot.replaceChildren(btn);
      }
    } else {
      const btn = document.createElement('button');
      btn.className = 'auth-btn';
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z"/></svg> Sign in';
      // Sign in ≠ Google: open the full prompt (Google + email/password). Pages
      // without the prompt slot send the reader to the homepage's sign-in state.
      btn.addEventListener('click', () => {
        if (document.querySelector('[data-auth-prompt]')) {
          document.dispatchEvent(new CustomEvent('pa:signin-request'));
        } else {
          window.location.href = '/index.html#signin';
        }
      });
      slot.replaceChildren(btn);
    }
  }
  renderAuthButton();
  onAuthChange(renderAuthButton);
})();
