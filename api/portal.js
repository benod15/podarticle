// api/portal.js — POST {} → Stripe customer portal URL (manage/cancel subscription)
// Failure responses carry a `code`; the reader-facing copy for it is in public/messages.js.
import Stripe from 'stripe';
import { getUser } from '../lib/auth.js';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'PORTAL_FAILED' });
  }

  const { user, error, status, code } = await getUser(req);
  if (error) return res.status(status).json({ error, code });

  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const { data: plan } = await sb
      .from('plans').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();

    if (!plan?.stripe_customer_id) {
      return res.status(404).json({ error: 'No Stripe customer for user', code: 'NO_SUBSCRIPTION' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.billingPortal.sessions.create({
      customer: plan.stripe_customer_id,
      return_url: `https://${req.headers.host}/pricing.html`,
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('portal failed', err);
    return res.status(502).json({ error: 'Stripe billing portal failed', code: 'PORTAL_FAILED' });
  }
}
