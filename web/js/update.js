/*
 * In-app updates from the GitHub releases (github.com/davood41444/maple-iptv).
 *
 * About once a day, and from Settings → Check for updates, the app asks GitHub for the
 * latest release. When it's newer, the app offers to update:
 *   Android          downloads MapleIPTV.apk; Android then asks for one tap on Install
 *   Windows          downloads the installer, which installs quietly and reopens the app
 *   Linux AppImage   replaces itself and reopens
 *   Linux .deb       the browser downloads the new .deb (installing it needs the system)
 *   Mac              downloads the .dmg and opens it: drag the app to Applications
 * Samsung TVs, iPhones and iPads (and an Android app from Google Play) are updated by
 * their stores, so there's no check there.
 *
 * Each download is checked against the SHA-256 that GitHub lists for the release file.
 */
(function () {
  'use strict';
  const App = window.App;
  const t = (key, vars) => App.t(key, vars);
  const LATEST = 'https://api.github.com/repos/davood41444/maple-iptv/releases/latest';
  const DAY = 86400000;
  const FILES = {
    android: 'MapleIPTV.apk',
    windows: 'MapleIPTV-Setup.exe',
    mac: 'MapleIPTV-Mac.dmg',
    appimage: 'MapleIPTV-Linux.AppImage',
    deb: 'MapleIPTV-Linux.deb',
  };
  // Screens where a question would interrupt watching.
  const WATCHING = ['player', 'vod-player'];

  // Which release file this installation updates from, or null.
  function kind() {
    if (App.ios) return null;
    if (App.platform === 'android') {
      const host = window.AndroidHost;
      if (!host.installUpdate || host.installedFromStore()) return null;
      return 'android';
    }
    if (App.platform === 'desktop' && window.DesktopHost.update) return window.DesktopHost.update.kind() || null;
    return null;
  }

  // True if version a is newer than b (1.10.0 is newer than 1.9.3).
  function newer(a, b) {
    const x = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const y = String(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    }
    return false;
  }

  // Android: the app downloads the file and opens Android's installer, reporting
  // { state: 'progress', percent } and then { state: 'installer' } or { state: 'error' }.
  function androidInstall(release, onProgress) {
    return new Promise((resolve, reject) => {
      const off = App.events.on('update-progress', e => {
        if (e.state === 'progress') return onProgress(e.percent);
        off();
        if (e.state === 'installer') resolve();
        else reject(new Error(e.message || 'update failed'));
      });
      window.AndroidHost.installUpdate(release.url, release.sha256);
    });
  }

  const update = App.update = {
    // { version, url, sha256 } once a newer release has been found.
    available: null,
    busy: false,

    supported() {
      return !!kind();
    },

    // The latest release's file for this installation, or null.
    async latest() {
      const release = await App.net.getJson(LATEST, { timeout: 20000 });
      const version = String(release.tag_name || '').replace(/^v/, '');
      const asset = (release.assets || []).find(a => a.name === FILES[kind()]);
      if (!version || !asset) return null;
      const digest = String(asset.digest || '');
      return {
        version: version,
        url: asset.browser_download_url,
        sha256: digest.startsWith('sha256:') ? digest.slice(7) : '',
      };
    },

    // manual: from Settings (says so when there's nothing new, or the check failed).
    async check(manual) {
      if (!this.supported() || this.busy) return;
      let release;
      try {
        release = await this.latest();
      } catch (e) {
        if (manual) App.ui.toast(t('update.checkFailed'), 'error');
        return;
      }
      App.store.set('updateChecked', Date.now());
      if (!release || !newer(release.version, App.version)) {
        this.available = null;
        if (manual) App.ui.toast(t('update.latest'));
        return;
      }
      this.available = release;
      App.events.emit('update');
      // "Later" means: ask again at tomorrow's check.
      if (await App.ui.confirm(t('update.available', { v: App.localDigits(release.version) }), t('update.now'), t('update.later'))) {
        this.install(release);
      }
    },

    async install(release) {
      const k = kind();
      const desktop = window.DesktopHost && window.DesktopHost.update;
      if (k === 'deb') {
        // Installing a .deb needs the system's installer: the browser downloads it.
        await App.ui.confirm(t('update.browser'), t('common.ok'), t('common.cancel')) && desktop.open(release.url);
        return;
      }
      this.busy = true;
      const progress = percent => App.ui.loading(t('update.downloading', { p: App.fmtNum(Math.round(percent)) }));
      progress(0);
      try {
        if (k === 'android') {
          await androidInstall(release, progress);
          return;
        }
        await desktop.download(release.url, release.sha256, progress);
        if (k === 'mac') {
          App.ui.loading(false);
          // The .dmg opens and the app closes, so the new version can replace it.
          if (await App.ui.confirm(t('update.mac'), t('common.ok'), t('update.later'))) await desktop.install();
          return;
        }
        App.ui.loading(t('update.installing'));
        await desktop.install(); // the app closes and the new version starts
      } catch (e) {
        console.warn('Update failed', e);
        App.ui.toast(t('update.failed'), 'error');
        // An AppImage in a folder it can't write to: download it in the browser instead.
        if (k === 'appimage') desktop.open(release.url);
      } finally {
        this.busy = false;
        App.ui.loading(false);
      }
    },

    // A check about once a day, a little after start-up, never while something plays.
    start() {
      if (!this.supported()) return;
      const due = () => Date.now() - App.store.get('updateChecked', 0) > DAY;
      const run = () => {
        if (!due()) return;
        const screen = App.router.current && App.router.current.name;
        if (WATCHING.includes(screen) || document.querySelector('#overlays .modal-backdrop')) {
          clearTimeout(this.retry);
          this.retry = setTimeout(run, 60000);
          return;
        }
        this.check(false);
      };
      setTimeout(run, 20000);
      setInterval(run, DAY / 6); // TVs and computers that stay on for days
    },
  };
})();
