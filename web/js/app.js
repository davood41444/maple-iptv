/* Start-up, key routing, and actions shared by several screens. */
(function () {
  'use strict';
  const App = window.App;
  const t = App.t;

  App.state = { source: null, playlist: null };
  App.company = { name: 'Maple Online Solutions', email: 'info@mapleonlinesolutions.com' };
  App.version = (window.AndroidHost && window.AndroidHost.appVersion()) || (window.DesktopHost && window.DesktopHost.appVersion()) ||
    (window.tizen && tizen.application.getAppInfo().version) || '0.1.0';
  // Phones and tablets get touch controls; TVs keep the remote layout (the Android app knows which it is),
  // and so do computers, touch screen or not.
  const host = window.AndroidHost;
  App.touch = host && host.hasTouchscreen ? host.hasTouchscreen() : App.platform !== 'desktop' &&
    (navigator.maxTouchPoints > 0 || (App.platform === 'browser' && 'ontouchstart' in window));

  // Load a playlist and show its channels. Resolves to false if it couldn't be loaded.
  App.openSource = async function (source, opts) {
    opts = opts || {};
    App.ui.loading(opts.loadingText || t('loading.channels'));
    let playlist;
    try {
      playlist = await App.sources.load(source, {
        force: opts.force,
        onProgress: bytes => App.ui.loading(t('loading.progress', { size: App.fmtBytes(bytes) })),
      });
    } catch (e) {
      console.warn('Could not load playlist', e);
      App.ui.loading(false);
      App.ui.toast(e.kind ? e.message : t('err.parse'), 'error');
      return false;
    }
    App.ui.loading(false);
    if (playlist.info && playlist.info.expires) source.expires = playlist.info.expires;
    App.sourcesStore.save(source);
    App.settings.set('activeSource', source.id);
    App.state.source = source;
    App.state.playlist = playlist;
    App.vod.reset();
    App.report.queue();
    App.router.go('home');

    if (opts.autoplay) {
      const last = playlist.byId.get(App.lists.last(source.id));
      if (last && App.premium.canPlayChannel(last)) {
        App.router.go('player', { list: playlist.channels, index: last.num - 1, groupId: 'all', from: 'live' });
      }
    }
    return true;
  };

  // A newer channel list arrived in the background (see App.sources.load).
  App.events.on('playlist', e => {
    if (!App.state.source || App.state.source.id !== e.sourceId) return;
    App.state.playlist = e.playlist;
    if (App.router.current === App.router.screens.home) App.router.screens.home.updateCounts();
  });

  // Download lists again now: 'live', 'movies', 'series' or 'all'.
  // An M3U playlist holds its movies and series too, so it is always reloaded whole.
  App.refresh = async function (what) {
    const source = App.state.source;
    if (!source) return;
    const label = t(what === 'all' ? 'refresh.updating' : what === 'live' ? 'loading.channels' : what === 'movies' ? 'lib.loadingMovies' : 'lib.loadingSeries');
    const progress = bytes => App.ui.loading(label + '  ' + App.fmtBytes(bytes));
    App.ui.loading(label);
    try {
      if (what === 'live' || what === 'all' || source.type !== 'xtream') {
        const playlist = await App.sources.load(source, { force: true, onProgress: progress });
        App.state.playlist = playlist;
        if (playlist.info && playlist.info.expires) {
          source.expires = playlist.info.expires;
          App.sourcesStore.save(source);
        }
        if (source.type !== 'xtream' || what === 'all') App.vod.reset();
      }
      if (source.type === 'xtream' && (what === 'movies' || what === 'all')) await App.vod.load('movies', { force: true, onProgress: progress });
      if (source.type === 'xtream' && (what === 'series' || what === 'all')) await App.vod.load('series', { force: true, onProgress: progress });
      App.ui.toast(t('refresh.done'));
    } catch (e) {
      console.warn('Refresh failed', e);
      App.ui.toast(e.kind ? e.message : t('err.parse'), 'error');
    }
    App.ui.loading(false);
    if (App.router.current === App.router.screens.home) App.router.go('home');
  };
  App.refreshAll = () => App.refresh('all');

  App.toggleFavorite = function (channel) {
    const on = App.lists.toggleFavorite(App.state.source.id, channel.id);
    App.ui.toast(t(on ? 'fav.added' : 'fav.removed'));
    return on;
  };

  App.chooseLanguage = async function (focusSelector) {
    const code = await App.ui.choose(t('settings.language'),
      App.i18n.languages.map(l => ({ value: l.code, label: l.name })), App.i18n.lang);
    if (!code || code === App.i18n.lang) return;
    App.settings.set('lang', code);
    App.i18n.setLang(code);
    App.router.rebuildAll(Object.assign({}, App.router.params, { focus: focusSelector }));
    const el = App.router.current.el.querySelector(focusSelector);
    if (el) App.focus.set(el);
  };

  App.exitApp = function () {
    if (App.platform === 'android') window.AndroidHost.exitApp();
    else if (App.platform === 'tizen') tizen.application.getCurrentApplication().exit();
    else if (App.platform === 'desktop') window.DesktopHost.quit();
  };

  // Back on the start screen: the first press shows a hint, a second one within 2.5 s closes the app.
  // On a computer (closed with its window's ×), Esc there only leaves full screen.
  let lastBack = 0;
  App.backToExit = function () {
    if (App.platform === 'desktop') {
      if (window.DesktopHost.isFullScreen()) window.DesktopHost.setFullScreen(false);
      return;
    }
    if (Date.now() - lastBack < 2500) {
      App.exitApp();
      return;
    }
    lastBack = Date.now();
    App.ui.toast(t('exit.again'));
  };

  // ---- Text fields ----
  // Arrow keys move the virtual focus onto a field; OK starts typing (which
  // opens the TV's keyboard), and OK/Done/Back/Up/Down finish.
  App.startEditing = function (input) {
    input.focus();
    if (window.AndroidHost) window.AndroidHost.showKeyboard();
  };

  function stopEditing(input) {
    input.blur();
    if (window.AndroidHost) window.AndroidHost.hideKeyboard();
  }

  // ---- Key routing ----
  // Order: the open dialog (or else the current screen) gets first say, then
  // the focused component (e.g. a list), then arrow-key navigation / OK.
  function handleKey(name, ctx) {
    const router = App.router;
    if (ctx.editing) {
      const input = document.activeElement;
      if (['Enter', 'Done', 'Back', 'Cancel', 'Up', 'Down'].indexOf(name) < 0) return false;
      stopEditing(input);
      if ((name === 'Enter' || name === 'Done') && input._onSubmit) input._onSubmit();
      if (name === 'Up' || name === 'Down') App.focus.move(name, router.scope());
      return true;
    }
    if (!router.current || name === 'Done' || name === 'Cancel') return true;
    // Holding OK must not press things over and over (or the option a long press just opened).
    if (name === 'Enter' && ctx.repeat) return true;
    if (App.desktop && App.desktop.handleKey(name, ctx)) return true;

    const overlay = router.topOverlay();
    const owner = overlay || router.current;
    if (owner.onKey && owner.onKey(name, ctx)) return true;

    const focused = App.focus.current;
    if (focused && focused._onKey && focused._onKey(name, ctx)) return true;

    if (name === 'Up' || name === 'Down' || name === 'Left' || name === 'Right') {
      App.focus.move(name, router.scope());
      return true;
    }
    if (name === 'Enter' && focused) {
      if (focused.tagName === 'INPUT') App.startEditing(focused);
      else focused.click();
      return true;
    }
    return true;
  }

  // Lay out on a stage at least 1920 wide and scale it to the screen. TVs get
  // 1920x1080; other shapes get a wider or taller stage instead of black bars.
  // Touch screens are held close, so they get a shorter stage (bigger UI);
  // computers are read up close too, so they get a taller one (more on screen).
  // (clientWidth, not innerWidth: Android's WebView widens innerWidth to fit the unscaled stage.)
  function fitStage() {
    const root = document.documentElement;
    const stage = document.getElementById('stage');
    const aspect = root.clientWidth / root.clientHeight;
    const desktop = App.platform === 'desktop';
    const baseHeight = App.touch ? 860 : desktop ? 1200 : 1080;
    const maxHeight = App.touch ? 1200 : desktop ? 1500 : 1080;
    const width = Math.round(Math.min(2600, Math.max(1920, baseHeight * aspect)));
    const height = Math.round(Math.min(maxHeight, Math.max(baseHeight, width / aspect)));
    const scale = Math.min(root.clientWidth / width, root.clientHeight / height);
    stage.style.width = width + 'px';
    stage.style.height = height + 'px';
    stage.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
    // Room for the window's own buttons, drawn over the top right corner (see desktop/main.js).
    if (desktop) stage.style.setProperty('--window-buttons', Math.round(150 / scale) + 'px');
    App.stageScale = scale;
  }

  function boot() {
    App.i18n.setLang(App.settings.get('lang'));
    fitStage();
    window.addEventListener('resize', fitStage);
    setInterval(() => {
      const now = App.fmtTime(new Date());
      Array.prototype.forEach.call(document.querySelectorAll('.clock'), el => { el.textContent = now; });
    }, 15000);

    App.keys.init(handleKey);
    if (App.desktop) App.desktop.init();
    // Touch screens (phones, tablets): tapping something also moves the highlight to it,
    // and a Back button stands in for the remote's.
    if (App.touch) {
      document.documentElement.classList.add('touch');
      const stage = document.getElementById('stage');
      stage.appendChild(App.h('button', {
        class: 'touch-back', 'aria-label': 'Back', html: App.icons.back, onclick: () => App.keys.press('Back'),
      }));
      // The keyboard covers the lower half of a landscape phone and the page isn't
      // resized for it, so slide the stage up while typing in a low field.
      document.addEventListener('focusin', e => {
        if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') return;
        const lift = e.target.getBoundingClientRect().bottom - document.documentElement.clientHeight * 0.4;
        stage.style.top = lift > 0 ? 'calc(50% - ' + Math.round(lift) + 'px)' : '';
      });
      document.addEventListener('focusout', () => { stage.style.top = ''; });
    }
    document.addEventListener('pointerdown', e => {
      const el = e.target.closest && e.target.closest('.focusable');
      if (el && !el.classList.contains('vlist') && !el.classList.contains('vgrid')) App.focus.set(el);
    }, true);
    // Mouse: the pointer hides over a playing video after a few still seconds (see app.css).
    if (!App.touch) {
      let idleTimer = 0;
      document.addEventListener('mousemove', () => {
        document.documentElement.classList.remove('pointer-idle');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => document.documentElement.classList.add('pointer-idle'), 3000);
      });
    }
    App.player.init();
    App.premium.init();
    App.report.start();
    App.update.start();

    const sources = App.sourcesStore.all();
    const active = sources.find(s => s.id === App.settings.get('activeSource')) || sources[0];
    if (!active) {
      App.router.go('sources');
      return;
    }
    App.openSource(active, { autoplay: App.settings.get('resumeLast') }).then(ok => {
      if (!ok) App.router.go('sources');
    });
  }

  boot();
})();
