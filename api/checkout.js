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

  // An account is required before paying: the subscription is keyed to the Supabase user,
  // so checking out signed-out would take someone's money and grant them nothing.
  const { user, error: authError, status: authStatus, code: authCode } = await getUser(req);
  if (authError) {
    return res.status(authStatus).json({ error: 'Sign in with Google first so we can attach your subscription to your account.', code: authCode });
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
    return res.status(502).json({
      error: 'We could not open checkout just now. Please try again, or email podarticle@gmail.com.',
      code: 'CHECKOUT_FAILED',
    });
  }
}
