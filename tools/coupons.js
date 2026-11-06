/*
 * Premium codes for friends.
 *
 *   node tools/coupons.js init                        once: creates the signing key
 *   node tools/coupons.js add --days 365 --note Ali   new random code, Premium for 365 days from use
 *   node tools/coupons.js add --until 2027-12-31      valid until a date
 *   node tools/coupons.js add --forever               never expires
 *   node tools/coupons.js add MYCODE2026 --days 30    choose the code yourself (long codes are safer)
 *   node tools/coupons.js remove CODE                 withdraw a code (devices that used it lose Premium)
 *   node tools/coupons.js list
 *
 * Every change rewrites web/coupons.json (shipped inside the app) — upload
 * that same file to the address in web/js/premium.js (COUPONS_URL) so the
 * app sees new and withdrawn codes without an update.
 *
 * The list only holds slow hashes of the codes, signed with the private key
 * in tools/coupons/ — keep that folder private and backed up: without the key
 * no new codes can be made, and anyone with it can make codes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'coupons');
const KEY_FILE = path.join(DIR, 'private-key.pem');
const CODES_FILE = path.join(DIR, 'codes.json');
const ROOT = path.join(__dirname, '..');
const PUBLIC_LIST = path.join(ROOT, 'web', 'coupons.json');
const PUBLIC_KEY_JS = path.join(ROOT, 'web', 'js', 'coupon-key.js');

// Must match web/js/premium.js.
const SALT = 'maple-iptv-coupons-v1';
const ITERATIONS = 20000;
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const normalize = code => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
const hash = code => crypto.pbkdf2Sync(normalize(code), SALT, ITERATIONS, 32, 'sha256').toString('hex');

function randomCode() {
  const pick = () => ALPHABET[crypto.randomInt(ALPHABET.length)];
  const group = () => Array.from({ length: 4 }, pick).join('');
  return 'MAPLE-' + group() + '-' + group();
}

function load() {
  return fs.existsSync(CODES_FILE) ? JSON.parse(fs.readFileSync(CODES_FILE, 'utf8')) : [];
}

function privateKey() {
  if (!fs.existsSync(KEY_FILE)) throw new Error('No signing key yet. Run: node tools/coupons.js init');
  return crypto.createPrivateKey(fs.readFileSync(KEY_FILE));
}

// The app checks the signature of `payload` (a JSON string) with the public key.
function publish(codes) {
  fs.writeFileSync(CODES_FILE, JSON.stringify(codes, null, 2));
  const payload = JSON.stringify({
    issued: Date.now(),
    codes: codes.map(c => ({ h: c.hash, days: c.days || undefined, until: c.until || undefined, forever: c.forever || undefined })),
  });
  const sig = crypto.sign('sha256', Buffer.from(payload), { key: privateKey(), dsaEncoding: 'ieee-p1363' }).toString('base64');
  fs.writeFileSync(PUBLIC_LIST, JSON.stringify({ payload: payload, sig: sig }) + '\n');
  console.log('Updated web/coupons.json (' + codes.length + ' codes). Upload it to the website so the app sees the change.');
}

function option(args, name) {
  const i = args.indexOf('--' + name);
  return i < 0 ? undefined : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'init') {
    if (fs.existsSync(KEY_FILE)) throw new Error('A key already exists in ' + KEY_FILE + ' — refusing to replace it.');
    fs.mkdirSync(DIR, { recursive: true });
    const { privateKey: key, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    fs.writeFileSync(KEY_FILE, key.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const jwk = publicKey.export({ format: 'jwk' });
    fs.writeFileSync(PUBLIC_KEY_JS, '// Public half of the key in tools/coupons/ (made by tools/coupons.js init).\n' +
      'window.App.couponKey = ' + JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }) + ';\n');
    console.log('Signing key created in tools/coupons/ — back it up and keep it private.');
    publish(load());
  } else if (command === 'add') {
    const code = args[0] && !args[0].startsWith('--') ? args[0] : randomCode();
    if (normalize(code).length < 6) throw new Error('Codes need at least 6 letters or digits.');
    const days = option(args, 'days');
    const until = option(args, 'until');
    const forever = option(args, 'forever') === true;
    if (!days && !until && !forever) throw new Error('Say how long: --days N, --until YYYY-MM-DD or --forever');
    const codes = load();
    if (codes.some(c => c.hash === hash(code))) throw new Error('That code already exists.');
    codes.push({
      code: code,
      hash: hash(code),
      days: days ? Number(days) : undefined,
      until: until ? Date.parse(until + 'T23:59:59Z') : undefined,
      forever: forever || undefined,
      note: option(args, 'note') || '',
      created: new Date().toISOString().slice(0, 10),
    });
    publish(codes);
    console.log('\nNew code: ' + code + '\n');
  } else if (command === 'remove') {
    const codes = load();
    const left = codes.filter(c => c.hash !== hash(args[0] || ''));
    if (left.length === codes.length) throw new Error('No such code.');
    publish(left);
  } else if (command === 'list') {
    load().forEach(c => console.log([c.code, c.forever ? 'forever' : c.days ? c.days + ' days' : 'until ' + new Date(c.until).toISOString().slice(0, 10), c.note, c.created].join('  |  ')));
  } else {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
  }
}

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
