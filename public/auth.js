// public/auth.js — Google sign-in via Supabase, shared by every page.
// Exposes window.PAAuth = { client, getSession, signIn, signOut, onAuthChange }.
(function () {
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

  async function signIn() {
    await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/' },
    });
  }

  async function signOut() {
    await client.auth.signOut();
    window.location.reload();
  }

  function onAuthChange(cb) {
    client.auth.onAuthStateChange((_event, session) => cb(session));
  }

  window.PAAuth = { client, getSession, signIn, signOut, onAuthChange };

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
      btn.addEventListener('click', signIn);
      slot.replaceChildren(btn);
    }
  }
  renderAuthButton();
  onAuthChange(renderAuthButton);
})();
