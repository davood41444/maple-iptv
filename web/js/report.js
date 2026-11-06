/*
 * Install reports for Maple Online Solutions' admin panel (site/src/api.js).
 * With the user's permission (asked once, changeable in Settings) the app
 * tells the website about this installation when a playlist opens and twice a
 * day: device, app version, language, Premium status, and the IPTV username and
 * server name. The website sees the IP address and derives the approximate
 * location from it. The IPTV password and what is watched are never sent.
 */
(function () {
  'use strict';
  const App = window.App;
  const SITE = App.premium.SITE;
  const EVERY = 12 * 3600 * 1000;

  const report = App.report = {
    timer: 0,

    // A random id for this installation, made on the first start.
    installId() {
      let id = App.store.get('installId', null);
      if (!id) {
        const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => ('0' + b.toString(16)).slice(-2)).join('');
        id = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
        App.store.set('installId', id);
      }
      return id;
    },

    allowed() {
      return App.settings.get('reporting') === true;
    },

    // Asked once: on the first start, or the first start after the update that added it.
    async askOnce() {
      if (App.settings.get('reporting') != null) return;
      const ok = await App.ui.confirm(App.t('consent.text'), App.t('consent.allow'), App.t('consent.deny'));
      App.settings.set('reporting', ok);
      if (ok) this.send();
    },

    device() {
      if (App.platform === 'android') {
        try {
          const d = JSON.parse(window.AndroidHost.deviceInfo());
          return { platform: d.platform || (d.tv ? 'android-tv' : 'android'), device: d.maker + ' ' + d.model, os: d.os };
        } catch (e) { // an app from before deviceInfo()
          return { platform: App.touch ? 'android' : 'android-tv', device: null, os: 'Android' };
        }
      }
      if (App.platform === 'desktop') {
        const host = window.DesktopHost;
        const name = { win32: 'windows', darwin: 'mac' }[host.os] || host.os;
        const os = { windows: 'Windows', mac: 'macOS' }[name] || 'Linux';
        let version = host.osVersion || '';
        // Windows 11 still calls itself 10.0; its builds start at 22000.
        const build = Number(version.split('.')[2]);
        if (name === 'windows' && build) version = (build >= 22000 ? '11' : '10') + ' (' + build + ')';
        return { platform: name, device: (name === 'mac' ? 'Mac' : 'PC') + (host.arch ? ' (' + host.arch + ')' : ''), os: os + ' ' + version };
      }
      if (App.platform === 'tizen') {
        const capability = key => {
          try { return tizen.systeminfo.getCapability(key); } catch (e) { return ''; }
        };
        return { platform: 'tizen', device: 'Samsung ' + capability('http://tizen.org/system/model_name'), os: 'Tizen ' + capability('http://tizen.org/feature/platform.version') };
      }
      return { platform: 'browser', device: null, os: navigator.platform || null };
    },

    // The playlist's username and server name, never its password.
    iptv() {
      const source = App.state.source;
      if (!source) return null;
      const host = url => {
        try { return new URL(url).host; } catch (e) { return null; }
      };
      if (source.type === 'xtream') return { type: 'xtream', user: source.username, host: host(source.server) };
      let user = null;
      try { user = new URL(source.url).searchParams.get('username'); } catch (e) { /* not a web address */ }
      return { type: 'm3u', user: user, host: host(source.url) };
    },

    send() {
      if (!this.allowed()) return;
      const premium = App.premium;
      const status = premium.status();
      const coupon = premium.coupon();
      const license = premium.license();
      const body = Object.assign({
        install: this.installId(),
        version: App.version,
        lang: App.settings.get('lang'),
        status: status.kind,
        trialDays: status.kind === 'trial' ? status.days : null,
        coupon: coupon ? coupon.code || 'hash ' + coupon.h.slice(0, 10) : null,
        license: license ? license.code : null,
        iptv: this.iptv(),
      }, this.device());
      // text/plain: no CORS preflight.
      fetch(SITE + '/api/ping', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) })
        .catch(() => { /* offline: next time */ });
    },

    // Several changes at once (start-up, Premium answers) make one report.
    queue() {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.send(), 3000);
    },

    start() {
      this.askOnce();
      App.events.on('premium', () => this.queue());
      setInterval(() => this.send(), EVERY);
    },
  };
})();
