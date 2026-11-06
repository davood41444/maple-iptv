// Website licenses: one per Stripe/PayPal subscription (or given by hand in the admin panel).
import { DAY, newCode } from './util.js';

// A lapsed payment keeps Premium a few more days (cards get retried).
export const GRACE = 3 * DAY;

export async function byCode(env, code) {
  return env.DB.prepare('SELECT * FROM licenses WHERE code = ?').bind(code).first();
}

export async function byRef(env, ref) {
  return env.DB.prepare('SELECT * FROM licenses WHERE provider_ref = ?').bind(ref).first();
}

// Valid while paid for (or within the grace period) and not revoked.
export function isValid(license, now) {
  return !!license && license.status !== 'revoked' && (license.period_end || 0) + GRACE > (now || Date.now());
}

// Creates the license for a subscription, or updates it; returns its code.
// sub: { provider, ref, customer, email, plan, status, periodEnd }
export async function upsertSubscription(env, sub) {
  const now = Date.now();
  const existing = await byRef(env, sub.ref);
  if (existing) {
    await env.DB.prepare(
      'UPDATE licenses SET status = ?, period_end = MAX(COALESCE(period_end, 0), ?), email = COALESCE(?, email), customer_ref = COALESCE(?, customer_ref), plan = COALESCE(?, plan), updated_at = ? WHERE code = ?'
    ).bind(sub.status, sub.periodEnd || 0, sub.email || null, sub.customer || null, sub.plan || null, now, existing.code).run();
    return existing.code;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newCode();
    try {
      await env.DB.prepare(
        'INSERT INTO licenses (code, email, plan, provider, provider_ref, customer_ref, status, period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(code, sub.email || null, sub.plan || null, sub.provider, sub.ref, sub.customer || null, sub.status, sub.periodEnd || 0, now, now).run();
      return code;
    } catch (e) {
      // The same subscription arrived twice at once (success page and webhook): use that row.
      const raced = await byRef(env, sub.ref);
      if (raced) return raced.code;
      if (!/UNIQUE/i.test(String(e.message))) throw e;
    }
  }
  throw new Error('Could not create a license');
}

// Status changes by the payment service (cancelled, renewed…).
export async function updateByRef(env, ref, status, periodEnd) {
  await env.DB.prepare('UPDATE licenses SET status = ?, period_end = MAX(COALESCE(period_end, 0), ?), updated_at = ? WHERE provider_ref = ?')
    .bind(status, periodEnd || 0, Date.now(), ref).run();
}
