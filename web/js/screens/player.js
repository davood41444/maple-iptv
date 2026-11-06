/*
 * Full-screen playback with an on-screen banner (channel, programme, picture
 * quality) and a channel list that slides in over the video.
 */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const t = App.t;
  const BANNER_MS = 5000;
  const ZAP_DELAY_MS = 400;

  function quality(video) {
    if (!video || !video.height) return '';
    if (video.height >= 2000) return '4K';
    if (video.height >= 1000) return 'FHD';
    if (video.height >= 700) return 'HD';
    return 'SD';
  }

  App.router.register({
    name: 'player',
    videoMode: true,

    build() {
      const el = this.el;
      this.logo = h('div', { class: 'osd-logo' });
      this.num = h('span', { class: 'osd-num' });
      this.nameEl = h('span', { class: 'osd-name' });
      this.sub = h('div', { class: 'osd-sub' });
      this.epg = h('div', { class: 'osd-epg' });
      this.clock = h('div', { class: 'clock osd-clock' });
      this.banner = h('div', { class: 'osd-banner' }, [
        this.logo,
        h('div', { class: 'osd-main' }, [h('div', { class: 'osd-title' }, [this.num, this.nameEl]), this.sub, this.epg]),
        this.clock,
      ]);

      this.status = h('div', { class: 'osd-status hidden' });
      this.numberEl = h('div', { class: 'number-entry hidden' });
      this.numbers = new App.NumberEntry(this.numberEl, n => this.playNumber(n));

      this.list = new App.VirtualList({
        rowHeight: 84,
        className: 'channels compact',
        renderRow: c => App.ui.channelRow(c, App.lists.isFavorite(App.state.source.id, c.id)),
        onRender: () => App.ui.loadRowGuide(this.list),
        onSelect: (c, i) => {
          this.closeList();
          if (!App.premium.check(App.premium.canPlayChannel(c))) return;
          if (i !== this.index) this.tune(i, true);
        },
      });
      this.listPanel = h('div', { class: 'osd-list' }, [h('div', { class: 'panel-title', text: t('player.channels') }), this.list.el]);

      el.appendChild(this.banner);
      el.appendChild(this.status);
      el.appendChild(this.listPanel);
      el.appendChild(this.numberEl);

      // Windows/Mac: buttons for the mouse in the banner.
      if (App.desktop) {
        const d = App.desktop;
        this.playButton = d.button('pause', t('player.pause'), () => App.player.togglePause());
        this.banner.appendChild(h('div', { class: 'mc-bar' }, [
          d.button('prev', t('player.prevChannel'), () => this.zap(-1)),
          this.playButton,
          d.button('next', t('player.nextChannel'), () => this.zap(1)),
          d.volumeControl(),
          d.button('list', t('player.channels'), () => (this.listOpen ? this.closeList() : this.openList())),
          d.button('fullscreen', t('player.fullscreen'), d.toggleFullScreen),
        ]));
      }

      // Touch: tap shows/hides the banner, swipe up/down changes channel, sideways opens the list.
      App.gestures(this.el, {
        ignore: target => !!target.closest('.osd-list, button, .mc-bar'),
        tap: () => {
          if (this.listOpen) this.closeList();
          else this.toggleBanner();
        },
        swipe: dir => {
          if (dir === 'Up') this.zap(1);
          else if (dir === 'Down') this.zap(-1);
          else if (this.listOpen) this.closeList();
          else this.openList();
        },
      });

      App.player.on((state, data) => {
        if (App.router.current === this) this.onPlayerState(state, data);
      });
    },

    show(params) {
      this.items = params.list;
      this.groupId = params.groupId;
      this.from = params.from || 'live';
      this.index = null;
      this.previousIndex = null;
      this.closeList();
      App.player.setVideoRect(null);
      this.tune(params.index, true);
    },

    hide() {
      clearTimeout(this.zapTimer);
      clearTimeout(this.bannerTimer);
      this.numbers.cancel();
      this.closeList();
      // Back to the channel list keeps the channel playing in its preview.
      if (!this.keepPlaying) App.player.stop();
      this.keepPlaying = false;
    },

    // Switch channel. While zapping quickly only the banner updates; the
    // stream starts once the remote has been still for a moment.
    tune(index, immediate) {
      const n = this.items.length;
      if (!n) return;
      if (this.index != null && this.index !== index) this.previousIndex = this.index;
      this.index = ((index % n) + n) % n;
      const channel = this.items[this.index];
      this.video = null;
      this.renderBanner(channel);
      this.showBanner();
      this.setStatus(null);
      clearTimeout(this.zapTimer);
      const start = () => {
        const sourceId = App.state.source.id;
        // Coming from the preview, the stream is already running.
        if (App.player.isPlaying(channel)) {
          this.onPlayerState(App.player.state, {});
          if (App.player.videoSize) this.onPlayerState('video', App.player.videoSize);
        } else {
          App.player.play(channel);
        }
        App.lists.pushRecent(sourceId, channel.id);
        App.lists.setLast(sourceId, channel.id);
        this.loadEpg(channel);
      };
      if (immediate) start();
      else this.zapTimer = setTimeout(start, ZAP_DELAY_MS);
    },

    // Channel up/down skips channels that need Premium.
    zap(delta) {
      const n = this.items.length;
      for (let step = 1; step < n; step++) {
        const index = this.index + delta * step;
        if (App.premium.canPlayChannel(this.items[((index % n) + n) % n])) {
          this.tune(index, false);
          return;
        }
      }
    },

    playNumber(n) {
      const all = App.state.playlist.channels;
      if (n > all.length) {
        App.ui.toast(t('player.notFound', { num: App.fmtNum(n) }));
        return;
      }
      if (!App.premium.check(App.premium.canPlayChannel(all[n - 1]))) return;
      if (this.items !== all) {
        this.items = all;
        this.groupId = 'all';
      }
      this.tune(n - 1, true);
    },

    renderBanner(channel) {
      this.logo.innerHTML = '<span class="ch-initials">' + App.esc(App.initials(channel.name)) + '</span>' +
        (channel.logo ? '<img src="' + App.esc(channel.logo) + '" alt="" onerror="this.remove()">' : '');
      this.num.textContent = App.fmtNum(channel.num);
      this.nameEl.textContent = channel.name;
      this.renderSub(channel);
      this.epg.innerHTML = '';
      this.clock.textContent = App.fmtTime(new Date());
    },

    renderSub(channel) {
      const parts = [];
      if (channel.group) parts.push('<span>' + App.esc(channel.group) + '</span>');
      const q = quality(this.video);
      if (q) parts.push('<span class="badge">' + q + '</span>');
      if (App.lists.isFavorite(App.state.source.id, channel.id)) parts.push('<span class="osd-fav">' + App.icons.star + '</span>');
      this.sub.innerHTML = parts.join('');
    },

    loadEpg(channel) {
      App.sources.nowNext(App.state.source, channel).then(items => {
        if (this.items[this.index] === channel) this.epg.innerHTML = App.ui.epgHtml(items);
      }).catch(() => { /* programme info is optional */ });
    },

    showBanner(sticky) {
      this.banner.classList.add('show');
      clearTimeout(this.bannerTimer);
      if (!sticky) this.bannerTimer = setTimeout(() => this.banner.classList.remove('show'), BANNER_MS);
    },

    toggleBanner() {
      if (this.banner.classList.contains('show')) {
        clearTimeout(this.bannerTimer);
        this.banner.classList.remove('show');
      } else {
        this.clock.textContent = App.fmtTime(new Date());
        this.showBanner();
      }
    },

    setStatus(html, kind) {
      this.status.className = 'osd-status ' + (kind || '') + (html ? '' : ' hidden');
      this.status.innerHTML = html || '';
    },

    // Mouse movement shows the banner; it stays while the pointer is on it.
    onPointerMove(e) {
      if (this.listOpen) return;
      this.clock.textContent = App.fmtTime(new Date());
      this.showBanner(!!e.target.closest('.osd-banner'));
    },

    onPlayerState(state, data) {
      const channel = this.items[this.index];
      if (this.playButton && (state === 'playing' || state === 'paused')) {
        this.playButton.innerHTML = App.icons[state === 'paused' ? 'play' : 'pause'];
        this.playButton.title = t(state === 'paused' ? 'player.play' : 'player.pause');
      }
      switch (state) {
        case 'buffering':
          this.setStatus('<div class="spinner"></div>');
          break;
        case 'playing':
        case 'idle':
          this.setStatus(null);
          break;
        case 'paused':
          this.setStatus('<div class="osd-pause"></div><div>' + t('player.paused') + '</div>');
          break;
        case 'retrying':
          this.setStatus('<div class="spinner"></div><div>' + t('player.retrying', { n: App.fmtNum(data.attempt), max: App.fmtNum(data.max) }) + '</div>');
          break;
        case 'error':
          this.setStatus('<div class="osd-error-title">' + t('player.error') + '</div><div class="osd-error-hint">' +
            t('player.errorHint') + '</div>' + (data.message ? '<div class="osd-error-code">' + App.esc(data.message) + '</div>' : ''), 'error');
          this.showBanner(true);
          break;
        case 'video':
          this.video = data;
          if (channel) this.renderSub(channel);
          break;
      }
    },

    openList() {
      this.listOpen = true;
      this.banner.classList.remove('show');
      this.listPanel.classList.add('show');
      this.list.setItems(this.items, this.index);
      App.focus.set(this.list.el);
    },

    closeList() {
      this.listOpen = false;
      this.listPanel.classList.remove('show');
      App.focus.set(null);
    },

    exit() {
      const channel = this.items[this.index];
      this.keepPlaying = this.from === 'live' && App.player.state !== 'error';
      App.router.go(this.from, { channelId: channel && channel.id, groupId: this.groupId });
    },

    onKey(name) {
      if (this.listOpen) {
        if (name === 'Back' || name === App.i18n.forwardKey()) {
          this.closeList();
          return true;
        }
        return false;
      }
      if (/^Digit/.test(name)) {
        this.numbers.push(name.slice(5));
        return true;
      }
      if (this.numbers.active && (name === 'Enter' || name === 'Back')) {
        if (name === 'Enter') this.numbers.commit();
        else this.numbers.cancel();
        return true;
      }
      const upStep = App.settings.get('upIsNext') ? 1 : -1;
      switch (name) {
        case 'ChannelUp':
        case 'PageUp':
          this.zap(1);
          break;
        case 'ChannelDown':
        case 'PageDown':
          this.zap(-1);
          break;
        case 'Up':
          this.zap(upStep);
          break;
        case 'Down':
          this.zap(-upStep);
          break;
        case 'Enter':
          if (App.player.state === 'error') App.player.retry();
          else this.openList();
          break;
        case 'Left':
        case 'Right':
          if (name === App.i18n.backwardKey()) this.openList();
          else this.toggleBanner();
          break;
        case 'Info':
        case 'Guide':
          this.toggleBanner();
          break;
        case 'PlayPause':
        case 'Play':
        case 'Pause':
          App.player.togglePause();
          break;
        case 'LastChannel':
          if (this.previousIndex != null) this.tune(this.previousIndex, true);
          break;
        case 'Yellow':
        case 'Menu': {
          const channel = this.items[this.index];
          App.toggleFavorite(channel);
          this.renderSub(channel);
          this.showBanner();
          break;
        }
        case 'Back':
        case 'Stop':
          this.exit();
          break;
      }
      // Nothing else should move focus around while watching.
      return true;
    },
  });
})();
