// What the app talks to: install reports (ping) and license checks.
import { json, readJson, field, normalizeCode, CORS } from './util.js';
import { byCode, isValid } from './licenses.js';

const ID = /^[A-Za-z0-9-]{8,64}$/;

// POST /api/ping — the app reports in at start and twice a day (only after the user
// accepted the privacy notice). Location comes from Cloudflare, by IP.
export async function ping(request, env) {
  const body = await readJson(request);
  if (!body || !ID.test(body.install || '')) return json({ ok: false }, 400, CORS);
  const cf = request.cf || {};
  const now = Date.now();
  const iptv = body.iptv || {};
  const row = [
    body.install,
    field(body.platform, 30), field(body.device, 120), field(body.os, 80), field(body.version, 30), field(body.lang, 8),
    field(body.status, 20), Number.isFinite(body.trialDays) ? body.trialDays : null,
    field(body.coupon, 60), field(normalizeCode(body.license) || null, 40),
    field(iptv.type, 10), field(iptv.user, 120), field(iptv.host, 120),
    request.headers.get('cf-connecting-ip'), field(cf.country, 8), field(cf.region, 80), field(cf.city, 80), field(cf.timezone, 60),
    now, now,
  ];
  await env.DB.prepare(
    `INSERT INTO installs (id, platform, device, os, app_version, lang, status, trial_days, coupon, license_code,
       iptv_type, iptv_user, iptv_host, ip, country, region, city, timezone, first_seen, last_seen, pings)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT (id) DO UPDATE SET platform = excluded.platform, device = excluded.device, os = excluded.os,
       app_version = excluded.app_version, lang = excluded.lang, status = excluded.status, trial_days = excluded.trial_days,
       coupon = excluded.coupon, license_code = excluded.license_code, iptv_type = excluded.iptv_type,
       iptv_user = excluded.iptv_user, iptv_host = excluded.iptv_host, ip = excluded.ip, country = excluded.country,
       region = excluded.region, city = excluded.city, timezone = excluded.timezone, last_seen = excluded.last_seen,
       pings = installs.pings + 1`
  ).bind(...row).run();
  return json({ ok: true }, 200, CORS);
}

// POST /api/license { code } — is this website license valid, and until when?
// The app asks when the code is entered and then about once a day.
export async function license(request, env) {
  const body = await readJson(request);
  const code = normalizeCode(body && body.code);
  if (!/^MPL-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return json({ valid: false, reason: 'unknown' }, 200, CORS);
  const row = await byCode(env, code);
  if (!row) return json({ valid: false, reason: 'unknown' }, 200, CORS);
  const valid = isValid(row);
  return json({
    valid: valid,
    reason: valid ? null : (row.status === 'revoked' ? 'revoked' : 'expired'),
    plan: row.plan,
    provider: row.provider,
    status: row.status,
    expires: row.period_end,
  }, 200, CORS);
}
