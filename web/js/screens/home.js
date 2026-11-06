/* Start screen: big Live TV / Movies / Series tiles, like IPTV Smarters. */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const t = App.t;

  App.router.register({
    name: 'home',
    focusKey: 'live',

    build() {
      App.events.on('library', () => {
        if (App.router.current === this) this.updateCounts();
      });
      App.events.on('premium', () => {
        if (App.router.current === this) this.show();
      });
    },

    show() {
      const el = this.el;
      const source = App.state.source;
      el.innerHTML = '';
      el.appendChild(App.ui.header(source.name));

      const vodLocked = !App.premium.canWatchVod();
      // A big tile, and under it an Update button with when the list was last downloaded.
      const section = (key, icon, label, onclick) => h('div', { class: 'home-section' }, [
        h('button', { class: 'home-tile tile-' + key + ' focusable', 'data-key': key, onclick: () => { this.focusKey = key; onclick(); } }, [
          h('span', { class: 'tile-art', html: App.icons[icon] }),
          h('span', { class: 'tile-icon', html: App.icons[icon] }),
          vodLocked && key !== 'live' ? h('span', { class: 'tile-badge', html: App.icons.lock + '<span>' + App.esc(t('premium.badge')) + '</span>' }) : null,
          h('span', { class: 'tile-label', text: label }),
          h('span', { class: 'tile-count' }),
        ]),
        h('div', { class: 'tile-foot' }, [
          h('button', {
            class: 'tile-update focusable', 'data-key': 'update-' + key,
            onclick: () => { this.focusKey = 'update-' + key; App.refresh(key); },
            html: App.icons.refresh + '<span>' + App.esc(t('home.update')) + '</span>',
          }),
          h('span', { class: 'tile-updated', 'data-for': key }),
        ]),
      ]);
      const small = (key, icon, label, onclick) => h('button', {
        class: 'home-small focusable', 'data-key': key, onclick: () => { this.focusKey = key; onclick(); },
        html: App.icons[icon] + '<span>' + App.esc(label) + '</span>',
      });

      const body = h('div', { class: 'home-body' }, [
        h('div', { class: 'home-tiles' }, [
          section('live', 'tv', t('home.live'), () => App.router.go('live')),
          section('movies', 'film', t('home.movies'), () => App.router.go('library', { kind: 'movies', fresh: true })),
          section('series', 'series', t('home.series'), () => App.router.go('library', { kind: 'series', fresh: true })),
        ]),
        h('div', { class: 'home-row' }, [
          small('search', 'search', t('live.search'), () => App.router.go('search', { from: 'home' })),
          small('playlists', 'list', t('settings.playlists'), () => App.router.go('sources', { focusId: source.id })),
          small('settings', 'settings', t('live.settings'), () => App.router.go('settings')),
        ]),
      ]);
      el.appendChild(body);
      // Windows/Mac: what you were watching, under the tiles (the side menu has Search etc.).
      this.rows = null;
      this.rowsKey = null;
      if (App.platform === 'desktop') {
        this.rows = h('div', { class: 'home-rows' });
        body.appendChild(this.rows);
        this.renderRows();
      }

      const account = [source.name];
      if (source.type === 'xtream') account.push(t('home.user', { name: source.username }));
      if (source.expires) account.push(t('sources.expires', { date: App.fmtDate(source.expires) }));
      const plan = App.premium.status();
      if (plan.kind === 'trial') account.push(t('premium.trialLeft', { days: App.fmtNum(plan.days) }));
      else if (plan.kind === 'free') account.push(t('premium.trialEnded'));
      el.appendChild(h('footer', { class: 'home-footer', html: account.map(s => '<bdi>' + App.esc(s) + '</bdi>').join('<span class="footer-sep">·</span>') }));

      this.updateCounts();
      App.focus.set(el.querySelector('[data-key="' + this.focusKey + '"]') || el.querySelector('.home-tile'));
      clearInterval(this.agoTimer);
      this.agoTimer = setInterval(() => this.updateCounts(), 30000);

      // Fetch the movie and series lists in the background so they open instantly.
      App.vod.load('movies').then(() => App.vod.load('series')).catch(e => console.warn('Could not load movies/series', e));
    },

    hide() {
      clearInterval(this.agoTimer);
    },

    updateCounts() {
      const show = (key, n, savedAt) => {
        const count = this.el.querySelector('.tile-' + key + ' .tile-count');
        if (count) count.textContent = n == null ? '…' : t(key === 'live' ? 'live.channelCount' : 'home.titles', { count: App.fmtNum(n) });
        const updated = this.el.querySelector('.tile-updated[data-for="' + key + '"]');
        if (updated) updated.textContent = savedAt ? t('home.updated', { time: App.fmtAgo(savedAt) }) : '';
      };
      show('live', App.state.playlist.channels.length, App.state.playlist.savedAt);
      ['movies', 'series'].forEach(kind => {
        const library = App.vod.loaded(kind);
        show(kind, library ? library.items.length : null, library && library.savedAt);
      });
      this.renderRows();
    },

    // "Continue watching" posters and "Recently watched" channels (Windows/Mac only).
    renderRows() {
      if (!this.rows) return;
      const sourceId = App.state.source.id;
      const watching = [];
      ['movies', 'series'].forEach(kind => {
        const library = App.vod.loaded(kind);
        if (!library) return;
        App.progress.recent(sourceId, kind === 'movies' ? 'm' : 's').forEach(id => {
          const item = library.byId.get(id);
          const p = App.progress.get(sourceId, id);
          if (item && (kind === 'series' || (!p.done && p.pos > 0)) && App.parental.filter([item]).length) {
            watching.push({ kind: kind, item: item, progress: p });
          }
        });
      });
      watching.sort((a, b) => b.progress.at - a.progress.at);
      const titles = watching.slice(0, 9);
      const channels = App.lists.recent(sourceId).map(id => App.state.playlist.byId.get(id)).filter(Boolean).slice(0, 8);
      // Redraw only when something changed, so the highlight isn't lost.
      const key = titles.map(x => x.item.id).join() + '|' + channels.map(c => c.id).join();
      if (key === this.rowsKey) return;
      this.rowsKey = key;

      const poster = x => {
        const p = x.progress;
        const percent = x.kind === 'movies' && p.dur > 0 ? Math.min(100, p.pos / p.dur * 100) : 0;
        return h('button', {
          class: 'home-card focusable', title: x.item.name,
          onclick: () => App.router.go('details', { kind: x.kind, item: x.item, from: 'home' }),
          html: '<span class="poster"><span class="poster-fallback">' + App.esc(x.item.name) + '</span>' +
            (x.item.poster ? '<img src="' + App.esc(x.item.poster) + '" alt="" onerror="this.remove()">' : '') +
            (percent ? '<span class="poster-progress"><i style="width:' + percent.toFixed(1) + '%"></i></span>' : '') + '</span>',
        });
      };
      const channel = c => h('button', {
        class: 'home-channel focusable', title: c.name,
        onclick: () => {
          if (!App.premium.check(App.premium.canPlayChannel(c))) return;
          App.router.go('player', { list: App.state.playlist.channels, index: c.num - 1, groupId: 'all', from: 'home' });
        },
        html: '<span class="ch-logo"><span class="ch-initials">' + App.esc(App.initials(c.name)) + '</span>' +
          (c.logo ? '<img src="' + App.esc(c.logo) + '" alt="" onerror="this.remove()">' : '') + '</span>' +
          '<span class="home-channel-name">' + App.esc(c.name) + '</span>',
      });
      const strip = (title, items) => h('div', { class: 'home-strip' }, [
        h('div', { class: 'home-strip-title', text: title }),
        h('div', { class: 'home-strip-items' }, items),
      ]);
      this.rows.innerHTML = '';
      if (titles.length) this.rows.appendChild(strip(t('lib.continue'), titles.map(poster)));
      if (channels.length) this.rows.appendChild(strip(t('live.recent'), channels.map(channel)));
      this.el.classList.toggle('has-rows', !!(titles.length || channels.length));
    },

    onKey(name) {
      if (name !== 'Back') return false;
      App.backToExit();
      return true;
    },
  });
})();
