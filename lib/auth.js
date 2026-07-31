// lib/auth.js — session verification + analysis allowance + plan lookup.
import { createClient } from '@supabase/supabase-js';

function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export const FREE_LIMIT = 5;

// PodArticle is free for everyone while we grow the first handful of regular users.
// The free-5 gate and the Stripe plumbing behind it stay in the codebase but stay shut
// off until PAYWALL_ENABLED=true is set in the environment, so re-arming the paywall is
// a dashboard toggle rather than a revert.
export const PAYWALL_ENABLED = process.env.PAYWALL_ENABLED === 'true';

// Verify the Supabase session JWT from the Authorization header.
// Returns { user } or { error, status, code }. Every error carries a code so the client
// can render a real sign-in prompt instead of echoing the message at the reader.
export async function getUser(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    return { error: 'Missing bearer token', status: 401, code: 'AUTH_REQUIRED' };
  }
  const sb = adminClient();
  if (!sb) {
    return { error: 'Supabase admin client unavailable', status: 503, code: 'AUTH_UNAVAILABLE' };
  }
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) {
    return { error: 'Invalid or expired session token', status: 401, code: 'AUTH_REQUIRED' };
  }
  return { user: data.user };
}

// Check whether the user may run an analysis.
// Returns { allowed: true, plan, used } or { allowed: false, plan, used }.
export async function checkAllowance(userId) {
  if (!PAYWALL_ENABLED) return { allowed: true, plan: 'unlimited', used: null };

  const sb = adminClient();
  if (!sb) return { allowed: true, plan: 'free', used: 0 }; // fail open if DB missing

  const { data: plan } = await sb
    .from('plans').select('status').eq('user_id', userId).maybeSingle();
  if (plan?.status === 'active') return { allowed: true, plan: 'active', used: null };

  const { count } = await sb
    .from('usage').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  const used = count || 0;
  return { allowed: used < FREE_LIMIT, plan: 'free', used };
}

// Log one analysis. Kept running while the paywall is off — it is how we count real
// usage, and it is what the allowance gate reads from if the paywall is re-armed.
export async function recordUsage(userId, videoId) {
  const sb = adminClient();
  if (!sb) return;
  await sb.from('usage').insert({ user_id: userId, video_id: videoId });
}
