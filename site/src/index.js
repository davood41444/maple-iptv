// Maple IPTV website on mapleonlinesolutions.com/maple-iptv: product pages,
// payments, the API the apps talk to, and the admin panel.
// Files in public/maple-iptv/ (stylesheets, images, downloads) are served before this runs.
import { BASE, DAY, CORS, json, html, redirect, esc, normalizeCode } from './util.js';
import * as pages from './pages.js';
import * as api from './api.js';
import * as stripe from './stripe.js';
import * as paypal from './paypal.js';
import * as admin from './admin.js';
import { byRef } from './licenses.js';

const API_ROUTES = {
  '/api/ping': api.ping,
  '/api/license': api.license,
  '/api/stripe/checkout': stripe.checkout,
  '/api/stripe/webhook': stripe.webhook,
  '/api/stripe/portal': stripe.portal,
  '/api/paypal/activate': paypal.activate,
  '/api/paypal/webhook': paypal.webhook,
};

const DOWNLOADS = { android: 'DOWNLOAD_ANDROID', windows: 'DOWNLOAD_WINDOWS', mac: 'DOWNLOAD_MAC' };

async function route(request, env) {
  const url = new URL(request.url);
  if (url.pathname === BASE) return redirect(BASE + '/' + url.search, 301);
  if (!url.pathname.startsWith(BASE + '/')) return notFound('en');
  const path = url.pathname.slice(BASE.length).replace(/\/+$/, '') || '/';

  if (path.startsWith('/api/')) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const handler = API_ROUTES[path];
    if (!handler) return json({ error: 'not-found' }, 404, CORS);
    if (request.method !== 'POST') return json({ error: 'method' }, 405, CORS);
    try {
      return await handler(request, env);
    } catch (e) {
      console.error(path, e && e.stack || e);
      return json({ error: 'server' }, 500, CORS);
    }
  }
  if (path === '/admin' || path.startsWith('/admin/')) return admin.handle(request, env, path, url);

  const lang = pages.language(request, url);
  if (request.method !== 'GET' && request.method !== 'HEAD') return notFound(lang);
  switch (path) {
    case '/': return pages.home(env, lang);
    case '/buy': return pages.buy(env, lang, url);
    case '/success': return pages.success(env, lang, await paidCode(env, url));
    case '/manage': return pages.manage(env, lang);
    case '/privacy':
    case '/terms': return pages.legal(env, lang, path.slice(1));
  }
  const download = /^\/download\/(android|windows|mac)$/.exec(path);
  if (download && env[DOWNLOADS[download[1]]]) return redirect(env[DOWNLOADS[download[1]]]);
  return notFound(lang);
}

// The success page's license code: from the Stripe Checkout session, or the PayPal
// subscription that buy.js has just activated. Both ids are known only to the buyer.
async function paidCode(env, url) {
  const session = url.searchParams.get('session_id');
  if (session) return stripe.codeForSession(env, session).catch(() => null);
  const subscription = url.searchParams.get('subscription');
  if (/^I-[A-Z0-9]+$/.test(subscription || '')) {
    const license = await byRef(env, subscription);
    return license ? normalizeCode(license.code) : null;
  }
  return null;
}

function notFound(lang) {
  const fa = lang === 'fa';
  return html(`<!doctype html><html lang="${lang}" dir="${fa ? 'rtl' : 'ltr'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Maple IPTV</title><link rel="stylesheet" href="${BASE}/assets/site.css">
<body><section class="section narrow center"><h1>404</h1><p class="sub">${esc(fa ? 'این صفحه پیدا نشد.' : 'This page does not exist.')}</p>
<a class="btn" href="${BASE}/?lang=${lang}">Maple IPTV</a></section></body></html>`, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (e) {
      console.error(e && e.stack || e);
      return html('<!doctype html><meta charset="utf-8"><title>Maple IPTV</title><p style="font-family:sans-serif">Something went wrong. Please try again, or write to info@mapleonlinesolutions.com.</p>', 500);
    }
  },

  // Daily: forget installs not seen for a year (as the privacy policy says).
  async scheduled(event, env) {
    await env.DB.prepare('DELETE FROM installs WHERE last_seen < ?').bind(Date.now() - 365 * DAY).run();
  },
};
