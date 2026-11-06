// PayPal subscriptions: the buy page's PayPal button creates the subscription in
// the browser; we check it with PayPal, issue the license, and follow webhooks.
// The monthly and yearly plans are created once from the admin panel.
import { json, readJson } from './util.js';
import { upsertSubscription, updateByRef } from './licenses.js';

function base(env) {
  return env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

let cachedToken = null;

async function token(env) {
  if (cachedToken && cachedToken.mode === env.PAYPAL_MODE && cachedToken.until > Date.now()) return cachedToken.value;
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new Error('PayPal is not set up');
  const res = await fetch(base(env) + '/v1/oauth2/token', {
    method: 'POST',
    headers: { authorization: 'Basic ' + btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET), 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || 'PayPal login failed');
  cachedToken = { mode: env.PAYPAL_MODE, value: data.access_token, until: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

async function call(env, method, path, body) {
  const res = await fetch(base(env) + path, {
    method: method,
    headers: { authorization: 'Bearer ' + await token(env), 'content-type': 'application/json', prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? {} : await res.json();
  if (!res.ok) throw new Error(data.message || 'PayPal error ' + res.status);
  return data;
}

// The plan ids we created, per mode: { monthly, yearly } or null.
export async function plans(env) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('paypal_plans_' + env.PAYPAL_MODE).first();
  return row ? JSON.parse(row.value) : null;
}

// Admin: create the product and the monthly/yearly plans at our prices (once per mode).
export async function setUpPlans(env) {
  const existing = await plans(env);
  if (existing) return existing;
  const product = await call(env, 'POST', '/v1/catalogs/products', {
    name: 'Maple IPTV Premium', type: 'SERVICE', category: 'SOFTWARE', home_url: env.SITE_URL,
  });
  const plan = async (name, unit, cents) => (await call(env, 'POST', '/v1/billing/plans', {
    product_id: product.id,
    name: name,
    billing_cycles: [{
      frequency: { interval_unit: unit, interval_count: 1 },
      tenure_type: 'REGULAR', sequence: 1, total_cycles: 0,
      pricing_scheme: { fixed_price: { value: (Number(cents) / 100).toFixed(2), currency_code: env.CURRENCY.toUpperCase() } },
    }],
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 },
  })).id;
  const ids = {
    monthly: await plan('Maple IPTV Premium – Monthly', 'MONTH', env.PRICE_MONTHLY),
    yearly: await plan('Maple IPTV Premium – Yearly', 'YEAR', env.PRICE_YEARLY),
  };
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('paypal_plans_' + env.PAYPAL_MODE, JSON.stringify(ids)).run();
  return ids;
}

function status(sub) {
  if (sub.status === 'ACTIVE') return 'active';
  if (sub.status === 'SUSPENDED') return 'past_due';
  return 'canceled';
}

// Paid until the next billing date (or the last payment's cycle when cancelled).
function periodEnd(sub, planIds) {
  const info = sub.billing_info || {};
  if (info.next_billing_time) return Date.parse(info.next_billing_time);
  if (info.last_payment && info.last_payment.time) {
    const last = new Date(info.last_payment.time);
    if (planIds && sub.plan_id === planIds.yearly) last.setFullYear(last.getFullYear() + 1);
    else last.setMonth(last.getMonth() + 1);
    return last.getTime();
  }
  return 0;
}

async function saveSubscription(env, id) {
  const sub = await call(env, 'GET', '/v1/billing/subscriptions/' + encodeURIComponent(id));
  const planIds = await plans(env);
  if (!planIds || (sub.plan_id !== planIds.monthly && sub.plan_id !== planIds.yearly)) throw new Error('Not one of our plans');
  return {
    sub: sub,
    code: await upsertSubscription(env, {
      provider: 'paypal', ref: sub.id, status: status(sub), periodEnd: periodEnd(sub, planIds),
      email: sub.subscriber && sub.subscriber.email_address,
      plan: sub.plan_id === planIds.yearly ? 'yearly' : 'monthly',
    }),
  };
}

// POST /api/paypal/activate { subscriptionId } — after the buyer approved in PayPal's window.
export async function activate(request, env) {
  const body = await readJson(request);
  const id = body && body.subscriptionId;
  if (!/^I-[A-Z0-9]+$/.test(id || '')) return json({ error: 'bad-id' }, 400);
  const result = await saveSubscription(env, id);
  if (result.sub.status !== 'ACTIVE' && result.sub.status !== 'APPROVED') return json({ error: 'not-active' }, 402);
  return json({ code: result.code });
}

// POST /api/paypal/webhook — renewals, cancellations, suspensions.
export async function webhook(request, env) {
  const payload = await request.text();
  const event = JSON.parse(payload);
  const h = name => request.headers.get(name);
  const check = await call(env, 'POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'),
    transmission_sig: h('paypal-transmission-sig'), transmission_time: h('paypal-transmission-time'),
    webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: event,
  });
  if (check.verification_status !== 'SUCCESS') return json({ ok: false }, 400);

  const resource = event.resource || {};
  if (/^BILLING\.SUBSCRIPTION\./.test(event.event_type) && resource.id) {
    if (event.event_type === 'BILLING.SUBSCRIPTION.ACTIVATED' || event.event_type === 'BILLING.SUBSCRIPTION.RE-ACTIVATED') {
      await saveSubscription(env, resource.id);
    } else {
      await updateByRef(env, resource.id, status(resource), periodEnd(resource, await plans(env)));
    }
  } else if (event.event_type === 'PAYMENT.SALE.COMPLETED' && resource.billing_agreement_id) {
    await saveSubscription(env, resource.billing_agreement_id);
  }
  return json({ received: true });
}
