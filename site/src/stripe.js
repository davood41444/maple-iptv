// Stripe subscriptions: Checkout to pay, webhooks to follow renewals and
// cancellations, and the customer portal to manage or cancel.
import { json, readJson, hmacHex, safeEqual, normalizeCode } from './util.js';
import { upsertSubscription, updateByRef, byCode } from './licenses.js';

const API = 'https://api.stripe.com/v1/';

// Stripe's form encoding, nested objects included: a[b][c]=…
function form(params, prefix, out) {
  out = out || new URLSearchParams();
  Object.keys(params).forEach(key => {
    const value = params[key];
    const name = prefix ? prefix + '[' + key + ']' : key;
    if (value == null) return;
    if (typeof value === 'object') form(value, name, out);
    else out.append(name, String(value));
  });
  return out;
}

async function call(env, method, path, params) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('Stripe is not set up');
  const res = await fetch(API + path + (method === 'GET' && params ? '?' + form(params) : ''), {
    method: method,
    headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : form(params || {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || 'Stripe error ' + res.status);
  return data;
}

// Newer Stripe API versions keep the period end on the subscription item.
function periodEnd(sub) {
  const end = sub.current_period_end || (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end);
  return end ? end * 1000 : 0;
}

function status(sub) {
  if (sub.status === 'active' || sub.status === 'trialing') return 'active';
  if (sub.status === 'past_due' || sub.status === 'unpaid') return 'past_due';
  return 'canceled';
}

async function saveSubscription(env, subscriptionId, extra) {
  const sub = await call(env, 'GET', 'subscriptions/' + subscriptionId);
  return upsertSubscription(env, Object.assign({
    provider: 'stripe', ref: sub.id, customer: sub.customer, status: status(sub), periodEnd: periodEnd(sub),
    plan: sub.metadata && sub.metadata.plan,
  }, extra || {}));
}

// POST /api/stripe/checkout { plan } → { url } of Stripe's payment page.
export async function checkout(request, env) {
  const body = await readJson(request);
  const plan = body && body.plan === 'yearly' ? 'yearly' : 'monthly';
  const lang = body && body.lang === 'fa' ? 'fa' : 'en';
  const session = await call(env, 'POST', 'checkout/sessions', {
    mode: 'subscription',
    locale: 'auto',
    line_items: { 0: {
      quantity: 1,
      price_data: {
        currency: env.CURRENCY,
        unit_amount: plan === 'yearly' ? env.PRICE_YEARLY : env.PRICE_MONTHLY,
        recurring: { interval: plan === 'yearly' ? 'year' : 'month' },
        product_data: { name: 'Maple IPTV Premium (' + plan + ')' },
      },
    } },
    metadata: { plan: plan },
    subscription_data: { metadata: { plan: plan, app: 'maple-iptv' } },
    allow_promotion_codes: 'true',
    success_url: env.SITE_URL + '/success?lang=' + lang + '&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: env.SITE_URL + '/buy?canceled=1&plan=' + plan + '&lang=' + lang,
  });
  return json({ url: session.url });
}

// The success page: the paid Checkout session → its license code (null if not paid).
export async function codeForSession(env, sessionId) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId || '')) return null;
  const session = await call(env, 'GET', 'checkout/sessions/' + sessionId);
  if (session.status !== 'complete' || !session.subscription) return null;
  return saveSubscription(env, session.subscription, {
    email: session.customer_details && session.customer_details.email,
    plan: session.metadata && session.metadata.plan,
  });
}

// POST /api/stripe/webhook — Stripe tells us about payments, renewals and cancellations.
export async function webhook(request, env) {
  const payload = await request.text();
  const header = request.headers.get('stripe-signature') || '';
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  const t = Number(parts.t);
  if (!env.STRIPE_WEBHOOK_SECRET || !parts.v1 || !t || Math.abs(Date.now() / 1000 - t) > 300) return json({ ok: false }, 400);
  const expected = await hmacHex(env.STRIPE_WEBHOOK_SECRET, t + '.' + payload);
  if (!safeEqual(expected, parts.v1)) return json({ ok: false }, 400);

  const event = JSON.parse(payload);
  const object = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
      if (object.subscription) {
        await saveSubscription(env, object.subscription, {
          email: object.customer_details && object.customer_details.email,
          plan: object.metadata && object.metadata.plan,
        });
      }
      break;
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await updateByRef(env, object.id, event.type.endsWith('deleted') ? 'canceled' : status(object), periodEnd(object));
      break;
    case 'invoice.paid': {
      const subscription = object.subscription || (object.parent && object.parent.subscription_details && object.parent.subscription_details.subscription);
      if (subscription) await saveSubscription(env, subscription);
      break;
    }
  }
  return json({ received: true });
}

// POST /api/stripe/portal { code } → { url } where the customer can change card or cancel.
export async function portal(request, env) {
  const body = await readJson(request);
  const license = await byCode(env, normalizeCode(body && body.code));
  if (!license || license.provider !== 'stripe' || !license.customer_ref) return json({ error: 'not-found' }, 404);
  const session = await call(env, 'POST', 'billing_portal/sessions', { customer: license.customer_ref, return_url: env.SITE_URL + '/manage' });
  return json({ url: session.url });
}
