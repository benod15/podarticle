// api/portal.js — POST {} → Stripe customer portal URL (manage/cancel subscription)
import Stripe from 'stripe';
import { getUser } from '../lib/auth.js';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error, status } = await getUser(req);
  if (error) return res.status(status).json({ error });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: plan } = await sb
    .from('plans').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();

  if (!plan?.stripe_customer_id) {
    return res.status(404).json({ error: 'No subscription found for this account.' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const base = `https://${req.headers.host}`;
  const session = await stripe.billingPortal.sessions.create({
    customer: plan.stripe_customer_id,
    return_url: `${base}/pricing.html`,
  });
  return res.status(200).json({ url: session.url });
}
