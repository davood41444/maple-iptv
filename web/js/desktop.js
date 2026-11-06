/*
 * The Windows/Mac app's shell around the shared screens (App.platform 'desktop'
 * only): a side menu that is always there except during playback, Back
 * buttons for the mouse, player controls (volume, full screen…), keyboard
 * shortcuts and the window's own title bar area.
 */
(function () {
  'use strict';
  const App = window.App;
  if (App.platform !== 'desktop') return;
  const h = App.h;
  const t = App.t;
  const host = window.DesktopHost;
  const VOLUME_STEP = 0.05;

  // Which side-menu entry a screen belongs to.
  function sectionOf(name, params) {
    const kind = params.kind || (params.back && params.back.kind);
    switch (name) {
      case 'home': return 'home';
      case 'live': case 'player': return 'live';
      case 'library': case 'details': case 'vodPlayer': return kind === 'series' ? 'series' : 'movies';
      case 'search': return 'search';
      case 'downloads': return 'downloads';
      case 'sources': case 'sourceForm': case 'phone': return 'playlists';
      case 'settings': case 'premium': return 'settings';
    }
    return null;
  }

  const ITEMS = [
    { key: 'home', icon: 'home', label: 'nav.home', go: () => App.router.go('home') },
    { key: 'live', icon: 'tv', label: 'home.live', go: () => App.router.go('live') },
    { key: 'movies', icon: 'film', label: 'home.movies', go: () => App.router.go('library', { kind: 'movies', fresh: true }) },
    { key: 'series', icon: 'series', label: 'home.series', go: () => App.router.go('library', { kind: 'series', fresh: true }) },
    { key: 'search', icon: 'search', label: 'live.search', go: () => App.router.go('search', { from: 'home' }) },
    { key: 'downloads', icon: 'download', label: 'downloads.title', go: () => App.router.go('downloads') },
    { key: 'playlists', icon: 'list', label: 'settings.playlists', bottom: true,
      go: () => App.router.go('sources', { focusId: App.state.source && App.state.source.id }) },
    { key: 'settings', icon: 'settings', label: 'live.settings', bottom: true, go: () => App.router.go('settings') },
  ];
  const NEEDS_PLAYLIST = ['home', 'live', 'movies', 'series', 'search'];

  let nav = null;
  let navLang = null;

  function buildNav() {
    const stage = document.getElementById('stage');
    if (nav) nav.remove();
    navLang = App.i18n.lang;
    const item = i => h('button', {
      class: 'side-item', 'data-key': i.key, title: t(i.label),
      html: App.icons[i.icon] + '<span>' + App.esc(t(i.label)) + '</span>',
      onclick: () => {
        if (App.router.topOverlay()) return;
        i.go();
      },
    });
    nav = h('nav', { class: 'side-nav' }, [
      h('div', { class: 'side-brand' }, [
        h('span', { class: 'brand-mark' }, [h('img', { src: 'img/logo-mark.png', alt: '' })]),
        h('span', { class: 'brand-name', text: t('app.name') }),
      ]),
      h('div', { class: 'side-items' }, ITEMS.filter(i => !i.bottom).map(item)),
      h('div', { class: 'side-spacer' }),
      h('div', { class: 'side-items' }, ITEMS.filter(i => i.bottom).map(item)),
      h('div', { class: 'side-version', text: 'v' + App.version }),
    ]);
    stage.insertBefore(nav, document.getElementById('screens'));
  }

  function updateNav() {
    if (!nav || navLang !== App.i18n.lang) buildNav();
    const section = sectionOf(App.router.current.name, App.router.params || {});
    Array.prototype.forEach.call(nav.querySelectorAll('.side-item'), el => {
      el.classList.toggle('active', el.dataset.key === section);
      el.disabled = !App.state.source && NEEDS_PLAYLIST.indexOf(el.dataset.key) >= 0;
    });
  }

  function toggleFullScreen() {
    host.setFullScreen(!host.isFullScreen());
  }

  function changeVolume(delta) {
    const base = App.player.muted ? 0 : App.player.volume;
    App.player.setVolume(base + delta);
    showVolume();
  }

  function showVolume() {
    const v = App.player.muted ? 0 : App.player.volume;
    App.ui.toast((v ? '🔊 ' : '🔇 ') + App.fmtNum(Math.round(v * 100)) + '%');
  }

  App.desktop = {
    toggleFullScreen: toggleFullScreen,

    init() {
      document.documentElement.classList.add('os-' + host.os);
      App.events.on('screen', updateNav);
      if (App.downloads) App.downloads.init();

      // Back for screens without a top bar (details, actor pages, players).
      document.getElementById('stage').appendChild(h('button', {
        class: 'float-back', title: t('nav.back'), html: App.icons.back, onclick: () => App.keys.press('Back'),
      }));

      // Screens may follow the mouse (the players show their controls).
      document.addEventListener('mousemove', e => {
        const screen = App.router.current;
        if (screen && screen.onPointerMove) screen.onPointerMove(e);
      });
      // Over a playing video: double-click for full screen, the wheel for the volume.
      const onVideo = e => App.router.current && App.router.current.videoMode && !App.router.topOverlay() &&
        !e.target.closest('button, .osd-list, .vod-bar, .mc-volume, .next-card');
      document.addEventListener('dblclick', e => { if (onVideo(e)) toggleFullScreen(); });
      document.addEventListener('wheel', e => { if (onVideo(e)) changeVolume(e.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP); }, { passive: true });
      // The mouse's own Back button, and Alt+Left.
      document.addEventListener('mouseup', e => { if (e.button === 3) App.keys.press('Back'); });
      window.addEventListener('keydown', e => {
        if (e.altKey && e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          App.keys.press('Back');
        }
      }, true);
    },

    // Keyboard shortcuts, before the screens see the key. True when handled.
    handleKey(name, ctx) {
      if (ctx.editing) return false;
      const screen = App.router.current;
      switch (name) {
        case 'KeyF':
          toggleFullScreen();
          return true;
        case 'KeyM':
          App.player.toggleMute();
          showVolume();
          return true;
        case 'Plus':
        case 'Minus':
          changeVolume(name === 'Plus' ? VOLUME_STEP : -VOLUME_STEP);
          return true;
        case 'Space':
          if (!App.player.channel || App.router.topOverlay()) return false;
          App.player.togglePause();
          if (screen.showOsd) screen.showOsd();
          return true;
        case 'Back':
          // Esc leaves full screen first, like other programs.
          if (host.isFullScreen() && !App.router.topOverlay()) {
            host.setFullScreen(false);
            return true;
          }
          return false;
        case 'Up':
        case 'Down':
          // In a movie, Up/Down are the volume (unless on its control buttons).
          if (screen.name === 'vodPlayer' && !App.router.topOverlay() && !screen.osd.contains(App.focus.current)) {
            changeVolume(name === 'Up' ? VOLUME_STEP : -VOLUME_STEP);
            return true;
          }
          return false;
      }
      return false;
    },

    // An icon button for the players' control bars.
    button(icon, title, onclick) {
      return h('button', { class: 'mc-btn', title: title, html: App.icons[icon], onclick: onclick });
    },

    // Mute button and a volume slider (click, drag or wheel).
    volumeControl() {
      const mute = h('button', { class: 'mc-btn', title: t('player.volume'), onclick: () => App.player.toggleMute() });
      const fill = h('i');
      const knob = h('b');
      const track = h('div', { class: 'mc-track' }, [fill, knob]);
      const render = (volume, muted) => {
        const v = muted ? 0 : volume;
        fill.style.width = knob.style.left = (v * 100) + '%';
        mute.innerHTML = App.icons[v ? 'volume' : 'mute'];
      };
      const setFrom = e => {
        const r = track.getBoundingClientRect();
        App.player.setVolume((e.clientX - r.left) / r.width);
      };
      track.addEventListener('pointerdown', e => {
        track.setPointerCapture(e.pointerId);
        setFrom(e);
        track.onpointermove = setFrom;
      });
      track.addEventListener('pointerup', () => { track.onpointermove = null; });
      track.addEventListener('wheel', e => {
        e.stopPropagation();
        changeVolume(e.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP);
      }, { passive: true });
      App.player.onVolume(render);
      render(App.player.volume, App.player.muted);
      return h('div', { class: 'mc-volume' }, [mute, track]);
    },
  };
})();
