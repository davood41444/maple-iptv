/*
 * Premium: a 7-day free trial, then a Google Play subscription (monthly or
 * yearly), a subscription bought on the website (an MPL-XXXX-XXXX-XXXX code,
 * checked with site/src/api.js) or a code from tools/coupons.js. Without
 * Premium only the first FREE_CHANNELS live channels play; movies and series
 * need Premium.
 *
 * The Samsung (Tizen) build has no store billing yet, so it is unrestricted.
 */
(function () {
  'use strict';
  const App = window.App;
  const DAY = 86400000;
  const TRIAL_DAYS = 7;
  const FREE_CHANNELS = 10;
  const SITE = 'https://mapleonlinesolutions.com/maple-iptv';
  // The signed code list (web/coupons.json) is also published here, so codes
  // can be added or withdrawn without an app update.
  const COUPONS_URL = SITE + '/coupons.json';
  // A website subscription keeps working this long past its paid date when the
  // website can't be reached (the website allows the same for late renewals).
  const LICENSE_GRACE = 3 * DAY;
  // Must match tools/coupons.js.
  const SALT = 'maple-iptv-coupons-v1';
  const ITERATIONS = 20000;

  const encoder = new TextEncoder();
  const store = () => App.store;

  function base64ToBytes(s) {
    const binary = atob(s);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function verify(doc) {
    try {
      if (!doc || !doc.payload || !doc.sig || !App.couponKey) return null;
      const key = await crypto.subtle.importKey('jwk', App.couponKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, base64ToBytes(doc.sig), encoder.encode(doc.payload));
      return ok ? JSON.parse(doc.payload) : null;
    } catch (e) {
      return null;
    }
  }

  // The newest correctly signed list: from the website, else the copy saved last time, else the one in the app.
  async function codeList() {
    const candidates = [];
    try {
      candidates.push(await App.net.getJson(COUPONS_URL + '?t=' + Date.now(), { timeout: 10000 }));
    } catch (e) { /* offline, or not published yet */ }
    candidates.push(store().get('couponList', null));
    try {
      candidates.push(await (await fetch('coupons.json', { cache: 'no-store' })).json());
    } catch (e) { /* not bundled */ }
    let best = null;
    for (const doc of candidates) {
      const list = await verify(doc);
      if (list && (!best || list.issued > best.list.issued)) best = { doc: doc, list: list };
    }
    if (!best) return null;
    store().set('couponList', best.doc);
    return best.list;
  }

  async function codeHash(code) {
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const base = await crypto.subtle.importKey('raw', encoder.encode(normalized), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(SALT), iterations: ITERATIONS }, base, 256);
    return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
  }

  // A website code as MPL-XXXX-XXXX-XXXX, or null for any other code.
  function licenseCode(code) {
    const s = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /^MPL[A-Z0-9]{12}$/.test(s) ? 'MPL-' + s.slice(3, 7) + '-' + s.slice(7, 11) + '-' + s.slice(11) : null;
  }

  // The website's answer: { valid, reason: 'unknown'|'expired'|'revoked'|'devices'|null, expires }.
  // A code works on a few devices at once, so this installation's random id and its
  // device type go along ('devices': the code is already in use on as many as allowed).
  async function askWebsite(code) {
    const d = App.report.device();
    const body = { code: code, install: App.report.installId(), platform: d.platform, device: d.device || d.os };
    const res = await fetch(SITE + '/api/license', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  const premium = App.premium = {
    FREE_CHANNELS: FREE_CHANNELS,
    SITE: SITE,
    unlimited: false,
    subscribed: false,
    plans: [],
    billing: 'loading', // 'loading' | 'ready' | 'unavailable'

    init() {
      if (App.platform === 'tizen') {
        this.unlimited = true;
        return;
      }
      if (App.platform === 'android') {
        this.trialStart = window.AndroidHost.trialStart();
      } else {
        this.trialStart = store().get('trialStart', 0);
        if (!this.trialStart) store().set('trialStart', this.trialStart = Date.now());
      }
      // Last known answer from Google Play until it answers again.
      this.subscribed = !!store().get('subscribed', false);
      App.events.on('billing', e => this.onBilling(e));
      if (App.platform === 'android') window.AndroidHost.billingStart();
      else this.billing = 'unavailable';
      this.recheckCoupon();
      this.recheckLicense();
      setInterval(() => this.recheckLicense(), DAY / 4);
    },

    trialDaysLeft() {
      return Math.max(0, Math.ceil((this.trialStart + TRIAL_DAYS * DAY - Date.now()) / DAY));
    },

    coupon() {
      const c = store().get('coupon', null);
      return c && (c.expires == null || c.expires > Date.now()) ? c : null;
    },

    // The website subscription: { code, expires, checked }.
    license() {
      const l = store().get('license', null);
      return l && l.expires + LICENSE_GRACE > Date.now() ? l : null;
    },

    isPremium() {
      return this.unlimited || this.subscribed || !!this.license() || !!this.coupon() || this.trialDaysLeft() > 0;
    },

    // What to tell the user: { kind: 'unlimited'|'subscription'|'license'|'coupon'|'trial'|'free', days?, expires? }
    status() {
      if (this.unlimited) return { kind: 'unlimited' };
      if (this.subscribed) return { kind: 'subscription' };
      const l = this.license();
      if (l) return { kind: 'license', expires: l.expires };
      const c = this.coupon();
      if (c) return { kind: 'coupon', expires: c.expires };
      if (this.trialDaysLeft() > 0) return { kind: 'trial', days: this.trialDaysLeft() };
      return { kind: 'free' };
    },

    canPlayChannel(channel) {
      return this.isPremium() || channel.num <= FREE_CHANNELS;
    },

    canWatchVod() {
      return this.isPremium();
    },

    // Guard for a premium action: true if allowed, otherwise opens the Premium screen.
    check(allowed) {
      if (allowed) return true;
      App.router.go('premium', { back: App.router.current.name, backParams: App.router.params });
      return false;
    },

    buy(planId) {
      if (App.platform === 'android') window.AndroidHost.billingBuy(planId);
    },

    // iPhone/iPad: "Restore purchases" asks the App Store for this Apple ID's subscription.
    restore() {
      if (window.AndroidHost && window.AndroidHost.billingRestore) window.AndroidHost.billingRestore();
    },

    onBilling(e) {
      if (e.event === 'plans') {
        this.plans = e.plans;
        this.billing = e.plans.length ? 'ready' : 'unavailable';
      } else if (e.event === 'unavailable') {
        this.billing = 'unavailable';
      } else if (e.event === 'status') {
        const was = this.subscribed;
        this.subscribed = e.active;
        store().set('subscribed', e.active);
        if (e.active && !was) App.ui.toast(App.t('premium.thanks'));
      } else if (e.event === 'error') {
        console.warn('Billing error', e);
      }
      App.events.emit('premium');
    },

    // Resolves to 'ok', 'invalid', 'expired', 'devices' or 'offline'.
    async redeem(code) {
      const license = licenseCode(code);
      if (license) return this.redeemLicense(license);
      const list = await codeList();
      if (!list) return 'offline';
      const h = await codeHash(code);
      const entry = list.codes.find(c => c.h === h);
      if (!entry) return 'invalid';
      const now = Date.now();
      if (entry.until && entry.until < now) return 'expired';
      const expires = entry.forever ? null : entry.days ? now + entry.days * DAY : entry.until;
      store().set('coupon', { h: h, code: code.trim().toUpperCase(), expires: expires, redeemed: now });
      App.events.emit('premium');
      return 'ok';
    },

    async redeemLicense(code) {
      let answer;
      try {
        answer = await askWebsite(code);
      } catch (e) {
        return 'offline';
      }
      if (!answer.valid) return answer.reason === 'unknown' ? 'invalid' : answer.reason === 'devices' ? 'devices' : 'expired';
      store().set('license', { code: code, expires: answer.expires, checked: Date.now() });
      App.events.emit('premium');
      return 'ok';
    },

    // About once a day: a renewal moves the date on; a cancelled, refunded or
    // withdrawn code stops. Offline, the saved date (plus grace) still counts.
    async recheckLicense() {
      const l = store().get('license', null);
      if (!l || Date.now() - (l.checked || 0) < DAY) return;
      let answer;
      try {
        answer = await askWebsite(l.code);
      } catch (e) {
        return;
      }
      if (answer.valid) {
        store().set('license', { code: l.code, expires: answer.expires, checked: Date.now() });
      } else {
        store().remove('license');
        // The places were freed on the website and other devices took them.
        if (answer.reason === 'devices') App.ui.toast(App.t('premium.devices'), 'error');
      }
      App.events.emit('premium');
    },

    // A withdrawn code (removed from the newest list) stops working.
    async recheckCoupon() {
      const c = store().get('coupon', null);
      if (!c) return;
      const list = await codeList();
      if (list && !list.codes.some(entry => entry.h === c.h)) {
        store().remove('coupon');
        App.events.emit('premium');
      }
    },
  };
})();
