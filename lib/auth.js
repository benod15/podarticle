// lib/auth.js — session verification + free-5 gate + plan lookup.
import { createClient } from '@supabase/supabase-js';

function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export const FREE_LIMIT = 5;

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

// Record one analysis against the user's free allowance.
export async function recordUsage(userId, videoId) {
  const sb = adminClient();
  if (!sb) return;
  await sb.from('usage').insert({ user_id: userId, video_id: videoId });
}
