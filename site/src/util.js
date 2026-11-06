// Small helpers shared by the site's modules.

export const BASE = '/maple-iptv';
export const DAY = 24 * 3600 * 1000;

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

// The app calls the API from its own pages (other origins), without cookies.
export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

export function json(data, status, extra) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, SECURITY_HEADERS, extra),
  });
}

export function html(body, status, extra) {
  return new Response(body, {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' }, SECURITY_HEADERS, extra),
  });
}

export function redirect(location, status) {
  return new Response(null, { status: status || 302, headers: { location: location } });
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Body as JSON whatever the content type (the app posts text/plain to skip CORS preflights).
export async function readJson(request) {
  try {
    return JSON.parse(await request.text());
  } catch (e) {
    return null;
  }
}

// A string field from a client, trimmed to a sane length.
export function field(value, max) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max || 120) : null;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

// A new license code: MPL-XXXX-XXXX-XXXX.
export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, b => CODE_CHARS[b % CODE_CHARS.length]);
  return 'MPL-' + chars.slice(0, 4).join('') + '-' + chars.slice(4, 8).join('') + '-' + chars.slice(8).join('');
}

export function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

export function money(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

// Compares without leaking where two strings differ.
export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
