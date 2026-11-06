// The owner's admin panel (/admin): installs, licenses, and setup. Cloudflare
// Access puts a login in front of /maple-iptv/admin; we check its signed token
// on every request as well, so nothing here is reachable without it.
import { json, html, readJson, field, newCode, normalizeCode, DAY, esc } from './util.js';
import { isValid } from './licenses.js';
import { setUpPlans, plans } from './paypal.js';

let certs = null;

function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

// The signed-in admin's email, or null.
export async function adminUser(request, env) {
  // `wrangler dev` only (.dev.vars), and only from this computer.
  if (env.DEV_ADMIN === '1' && /^(127\.0\.0\.1|::1)$/.test(request.headers.get('cf-connecting-ip') || '')) return 'dev@localhost';
  const jwt = request.headers.get('cf-access-jwt-assertion');
  if (!jwt || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  try {
    const [head, body, sig] = jwt.split('.');
    const header = JSON.parse(new TextDecoder().decode(b64urlBytes(head)));
    const claims = JSON.parse(new TextDecoder().decode(b64urlBytes(body)));
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(env.ACCESS_AUD) || claims.exp * 1000 < Date.now() || claims.iss !== 'https://' + env.ACCESS_TEAM_DOMAIN) return null;
    if (!certs || certs.until < Date.now() || !certs.keys.some(k => k.kid === header.kid)) {
      const res = await fetch('https://' + env.ACCESS_TEAM_DOMAIN + '/cdn-cgi/access/certs');
      certs = { keys: (await res.json()).keys, until: Date.now() + 3600 * 1000 };
    }
    const jwk = certs.keys.find(k => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(sig), new TextEncoder().encode(head + '.' + body));
    return ok ? (claims.email || 'admin') : null;
  } catch (e) {
    return null;
  }
}

async function all(env, sql, ...args) {
  return (await env.DB.prepare(sql).bind(...args).all()).results;
}

async function summary(env) {
  const now = Date.now();
  const count = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).first()).n;
  const licenses = await all(env, 'SELECT plan, provider, status, period_end FROM licenses');
  const valid = licenses.filter(l => isValid(l, now));
  const monthly = valid.filter(l => l.plan === 'monthly').length;
  const yearly = valid.filter(l => l.plan === 'yearly').length;
  return {
    installs: await count('SELECT COUNT(*) AS n FROM installs'),
    active7: await count('SELECT COUNT(*) AS n FROM installs WHERE last_seen > ?', now - 7 * DAY),
    active30: await count('SELECT COUNT(*) AS n FROM installs WHERE last_seen > ?', now - 30 * DAY),
    new7: await count('SELECT COUNT(*) AS n FROM installs WHERE first_seen > ?', now - 7 * DAY),
    byPlatform: await all(env, 'SELECT platform AS k, COUNT(*) AS n FROM installs GROUP BY platform ORDER BY n DESC'),
    byStatus: await all(env, 'SELECT status AS k, COUNT(*) AS n FROM installs WHERE last_seen > ? GROUP BY status ORDER BY n DESC', now - 30 * DAY),
    byCountry: await all(env, 'SELECT country AS k, COUNT(*) AS n FROM installs GROUP BY country ORDER BY n DESC LIMIT 12'),
    byVersion: await all(env, 'SELECT app_version AS k, COUNT(*) AS n FROM installs WHERE last_seen > ? GROUP BY app_version ORDER BY n DESC LIMIT 8', now - 30 * DAY),
    coupons: await all(env, 'SELECT coupon AS k, COUNT(*) AS n FROM installs WHERE coupon IS NOT NULL GROUP BY coupon ORDER BY n DESC'),
    licenses: { total: licenses.length, valid: valid.length, monthly: monthly, yearly: yearly,
      stripe: valid.filter(l => l.provider === 'stripe').length, paypal: valid.filter(l => l.provider === 'paypal').length },
    mrr: (monthly * Number(env.PRICE_MONTHLY) + yearly * Number(env.PRICE_YEARLY) / 12) / 100,
    currency: env.CURRENCY,
    setup: {
      stripe: !!env.STRIPE_SECRET_KEY, stripeWebhook: !!env.STRIPE_WEBHOOK_SECRET,
      paypal: !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET), paypalMode: env.PAYPAL_MODE,
      paypalPlans: !!(await plans(env)), paypalWebhook: !!env.PAYPAL_WEBHOOK_ID,
    },
  };
}

async function installs(env, url) {
  const q = (url.searchParams.get('q') || '').trim();
  const status = url.searchParams.get('status') || '';
  const platform = url.searchParams.get('platform') || '';
  const limit = Math.min(200, Number(url.searchParams.get('limit')) || 50);
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const where = [];
  const args = [];
  if (q) {
    where.push('(id LIKE ? OR iptv_user LIKE ? OR iptv_host LIKE ? OR ip LIKE ? OR city LIKE ? OR country LIKE ? OR device LIKE ? OR coupon LIKE ? OR license_code LIKE ?)');
    for (let i = 0; i < 9; i++) args.push('%' + q + '%');
  }
  if (status) { where.push('status = ?'); args.push(status); }
  if (platform) { where.push('platform = ?'); args.push(platform); }
  const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
  return {
    total: (await env.DB.prepare('SELECT COUNT(*) AS n FROM installs' + clause).bind(...args).first()).n,
    rows: await all(env, 'SELECT * FROM installs' + clause + ' ORDER BY last_seen DESC LIMIT ? OFFSET ?', ...args, limit, offset),
  };
}

async function licenses(env, url) {
  const q = (url.searchParams.get('q') || '').trim();
  const rows = q
    ? await all(env, 'SELECT * FROM licenses WHERE code LIKE ? OR email LIKE ? OR provider_ref LIKE ? ORDER BY created_at DESC LIMIT 200', '%' + q + '%', '%' + q + '%', '%' + q + '%')
    : await all(env, 'SELECT * FROM licenses ORDER BY created_at DESC LIMIT 200');
  const used = await all(env, 'SELECT license_code AS code, COUNT(*) AS n FROM installs WHERE license_code IS NOT NULL GROUP BY license_code');
  const devices = Object.fromEntries(used.map(u => [u.code, u.n]));
  return { rows: rows.map(r => Object.assign(r, { valid: isValid(r), devices: devices[r.code] || 0 })) };
}

// POST /admin/api/license { action: create|revoke|restore|extend, code, days, email, note }
async function changeLicense(env, request) {
  const body = await readJson(request) || {};
  const now = Date.now();
  const days = Math.max(1, Math.min(36500, Number(body.days) || 30));
  if (body.action === 'create') {
    const code = newCode();
    await env.DB.prepare('INSERT INTO licenses (code, email, plan, provider, provider_ref, status, period_end, created_at, updated_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(code, field(body.email, 120), 'manual', 'manual', 'manual-' + code, 'active', now + days * DAY, now, now, field(body.note, 200)).run();
    return { code: code };
  }
  const code = normalizeCode(body.code);
  if (body.action === 'revoke') await env.DB.prepare('UPDATE licenses SET status = ?, updated_at = ? WHERE code = ?').bind('revoked', now, code).run();
  else if (body.action === 'restore') await env.DB.prepare('UPDATE licenses SET status = ?, updated_at = ? WHERE code = ?').bind('active', now, code).run();
  else if (body.action === 'extend') {
    await env.DB.prepare('UPDATE licenses SET period_end = MAX(period_end, ?) + ?, updated_at = ? WHERE code = ?').bind(now, days * DAY, now, code).run();
  } else return { error: 'bad-action' };
  return { ok: true };
}

// Everything under /admin.
export async function handle(request, env, path, url) {
  const user = await adminUser(request, env);
  if (!user) return html('<!doctype html><meta charset="utf-8"><title>Maple IPTV</title><p style="font-family:sans-serif">Not signed in.</p>', 403);
  try {
    if (path === '/admin' || path === '/admin/') return html(page(env, user));
    if (path === '/admin/api/summary') return json(await summary(env));
    if (path === '/admin/api/installs') return json(await installs(env, url));
    if (path === '/admin/api/licenses') return json(await licenses(env, url));
    if (request.method === 'POST' && path === '/admin/api/license') return json(await changeLicense(env, request));
    if (request.method === 'POST' && path === '/admin/api/paypal-setup') return json({ plans: await setUpPlans(env) });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
  return json({ error: 'not-found' }, 404);
}

function page(env, user) {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Maple IPTV — پنل مدیریت</title>
<link rel="icon" href="/maple-iptv/assets/logo.png">
<link rel="stylesheet" href="/maple-iptv/assets/admin.css">
</head>
<body>
<header class="bar">
  <img src="/maple-iptv/assets/logo.png" alt="">
  <h1>Maple IPTV <span>پنل مدیریت</span></h1>
  <div class="who">${esc(user)}</div>
</header>
<main>
  <section class="cards" id="cards"></section>
  <section class="grid">
    <div class="box"><h2>دستگاه‌ها</h2><div id="byPlatform" class="bars"></div></div>
    <div class="box"><h2>وضعیت (۳۰ روز اخیر)</h2><div id="byStatus" class="bars"></div></div>
    <div class="box"><h2>کشورها</h2><div id="byCountry" class="bars"></div></div>
    <div class="box"><h2>کوپن‌ها</h2><div id="coupons" class="bars"></div></div>
  </section>

  <section class="box">
    <div class="head">
      <h2>نصب‌ها <small id="installsTotal"></small></h2>
      <div class="filters">
        <input id="q" type="search" placeholder="جستجو: یوزر، IP، شهر، دستگاه، کوپن، کد…">
        <select id="status"><option value="">همه وضعیت‌ها</option><option value="trial">تریال</option><option value="coupon">کوپن</option><option value="license">لایسنس سایت</option><option value="subscription">اشتراک گوگل‌پلی</option><option value="free">رایگان</option><option value="unlimited">نامحدود</option></select>
        <select id="platform"><option value="">همه دستگاه‌ها</option><option>android-tv</option><option>android</option><option>tizen</option><option>windows</option><option>mac</option></select>
      </div>
    </div>
    <div class="table-wrap"><table id="installs"><thead><tr>
      <th>آخرین بار</th><th>دستگاه</th><th>نسخه</th><th>وضعیت</th><th>کاربر IPTV</th><th>IP</th><th>مکان</th><th>اولین بار</th>
    </tr></thead><tbody></tbody></table></div>
    <div class="pager"><button id="prev">قبلی</button><span id="page"></span><button id="next">بعدی</button></div>
  </section>

  <section class="box">
    <div class="head">
      <h2>لایسنس‌های سایت</h2>
      <div class="filters"><input id="lq" type="search" placeholder="جستجو: کد، ایمیل…"></div>
    </div>
    <div class="table-wrap"><table id="licenses"><thead><tr>
      <th>کد</th><th>ایمیل</th><th>پلن</th><th>پرداخت</th><th>وضعیت</th><th>تا تاریخ</th><th>دستگاه‌ها</th><th></th>
    </tr></thead><tbody></tbody></table></div>
    <form id="newLicense" class="inline">
      <strong>لایسنس دستی (هدیه):</strong>
      <input name="email" type="email" placeholder="ایمیل (اختیاری)">
      <input name="days" type="number" min="1" value="365" title="روز">
      <input name="note" placeholder="یادداشت">
      <button>ساخت کد</button>
      <span id="newCode" class="code"></span>
    </form>
  </section>

  <section class="box">
    <h2>راه‌اندازی پرداخت</h2>
    <ul id="setup" class="setup"></ul>
    <button id="paypalSetup">ساخت پلن‌های ماهانه و سالانه در PayPal</button>
    <span id="paypalResult"></span>
  </section>
</main>
<script src="/maple-iptv/assets/admin.js"></script>
</body>
</html>`;
}
