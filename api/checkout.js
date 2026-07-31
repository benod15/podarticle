// api/checkout.js — POST {plan: 'annual'|'monthly'} → Stripe Checkout URL
// Wired when Stripe connector is connected; safe no-op until env vars exist.
// Failure responses carry a `code`; the reader-facing copy for it is in public/messages.js.
import Stripe from 'stripe';
import { getUser } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'CHECKOUT_FAILED' });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return res.status(501).json({ error: 'STRIPE_SECRET_KEY not set', code: 'PAYMENTS_UNAVAILABLE' });
  }

  // Vercel leaves the body as a string when the content-type header is missing.
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { plan } = body;
  if (plan !== 'annual' && plan !== 'monthly') {
    return res.status(422).json({ error: `Unknown plan: ${plan}`, code: 'BAD_PLAN' });
  }
  // A valid plan with no price configured is our misconfiguration, not the reader's mistake.
  const price = plan === 'annual' ? process.env.STRIPE_PRICE_ANNUAL : process.env.STRIPE_PRICE_MONTHLY;
  if (!price) {
    console.error('checkout: missing Stripe price ID for plan', plan);
    return res.status(501).json({ error: 'Stripe price ID not set', code: 'PAYMENTS_UNAVAILABLE' });
  }

  // An account is required before paying: the subscription is keyed to the Supabase user,
  // so checking out signed-out would take someone's money and grant them nothing.
  const { user, error: authError, status: authStatus, code: authCode } = await getUser(req);
  if (authError) {
    return res.status(authStatus).json({ error: authError, code: authCode });
  }

  try {
    const stripe = new Stripe(key);
    const base = `https://${req.headers.host}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      customer_email: user.email || undefined,
      success_url: `${base}/?subscribed=1`,
      cancel_url: `${base}/pricing.html`,
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('checkout failed', err);
    return res.status(502).json({ error: 'Stripe checkout session failed', code: 'CHECKOUT_FAILED' });
  }
}
