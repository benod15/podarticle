// api/stripe-webhook.js — Stripe events → mark users paid in Supabase.
// Events handled: checkout.session.completed (activate), customer.subscription.deleted (revoke).
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function adminClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

async function setPlan(sb, { email, customerId, subscriptionId, status }) {
  // Find the auth user by email
  const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = data?.users?.find((u) => u.email === email);
  if (!user) return null;
  await sb.from('plans').upsert({
    user_id: user.id,
    status,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    updated_at: new Date().toISOString(),
  });
  return user.id;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    const body = await rawBody(req);
    event = secret
      ? stripe.webhooks.constructEvent(body, sig, secret)
      : JSON.parse(body.toString());
  } catch (err) {
    return res.status(400).json({ error: `Webhook verification failed: ${err.message}` });
  }

  const sb = adminClient();

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email || session.customer_email;
    if (email) {
      await setPlan(sb, {
        email,
        customerId: session.customer,
        subscriptionId: session.subscription,
        status: 'active',
      });
    }
  } else if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const customer = await stripe.customers.retrieve(sub.customer);
    if (customer?.email) {
      await setPlan(sb, {
        email: customer.email,
        customerId: sub.customer,
        subscriptionId: sub.id,
        status: 'free',
      });
    }
  }

  return res.status(200).json({ received: true });
}
