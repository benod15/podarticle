// api/checkout.js — POST {plan: 'annual'|'monthly'} → Stripe Checkout URL
// Wired when Stripe connector is connected; safe no-op until env vars exist.
import Stripe from 'stripe';
import { getUser } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return res.status(501).json({ error: 'Payments are not live yet — subscribe is coming soon.' });
  }

  const { plan } = req.body || {};
  const price =
    plan === 'annual' ? process.env.STRIPE_PRICE_ANNUAL :
    plan === 'monthly' ? process.env.STRIPE_PRICE_MONTHLY : null;
  if (!price) {
    return res.status(422).json({ error: 'Unknown plan' });
  }

  // Signed-in user's email links the Stripe customer to their Supabase account
  const { user } = await getUser(req);

  const stripe = new Stripe(key);
  const base = `https://${req.headers.host}`;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    customer_email: user?.email || undefined,
    success_url: `${base}/?subscribed=1`,
    cancel_url: `${base}/pricing.html`,
  });
  return res.status(200).json({ url: session.url });
}
