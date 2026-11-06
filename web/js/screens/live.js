/*
 * Live TV: categories, the channels in the chosen category, and a preview.
 * OK on a channel plays it in the preview; OK again opens it full screen.
 */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const t = App.t;

  function quality(video) {
    if (!video || !video.height) return '';
    return video.height >= 2000 ? '4K' : video.height >= 1000 ? 'FHD' : video.height >= 700 ? 'HD' : 'SD';
  }

  App.router.register({
    name: 'live',
    holeMode: true,
    groupId: 'all',
    channelIndex: 0,
    sourceId: null,
    previewChannel: null,

    build() {
      const el = this.el;
      this.groups = new App.VirtualList({
        rowHeight: 66,
        className: 'groups',
        renderRow: App.groupRow,
        onChange: g => {
          // Wait until the highlight settles so holding Up/Down stays smooth.
          clearTimeout(this.groupTimer);
          this.groupTimer = setTimeout(() => this.showGroup(g), 180);
        },
        onSelect: g => {
          if (g.locked) {
            App.parental.unlock().then(ok => { if (ok) this.show({ groupId: g.id }); });
            return;
          }
          this.showGroup(g);
          if (this.channels.items.length) App.focus.set(this.channels.el);
        },
      });
      this.channels = new App.VirtualList({
        rowHeight: 78,
        columns: 2,
        className: 'channels',
        renderRow: c => App.ui.channelRow(c, App.lists.isFavorite(App.state.source.id, c.id)),
        onRender: () => App.ui.loadRowGuide(this.channels),
        isPlaying: c => c === this.previewChannel,
        onChange: (c, i) => { this.channelIndex = i; },
        onSelect: (c, i, column) => {
          if (column === 1) this.toggleFavorite(c, i);
          else if (c === this.previewChannel) this.play(i);
          else this.preview(c);
        },
      });

      this.subtitle = h('div', { class: 'topbar-title' });
      const header = App.ui.header(null, [
        App.ui.iconButton('search', t('live.search'), () => App.router.go('search', { from: 'live' })),
        App.ui.iconButton('settings', t('live.settings'), () => App.router.go('settings')),
      ]);
      header.insertBefore(this.subtitle, header.querySelector('.topbar-spacer'));
      el.appendChild(header);

      this.channelsTitle = h('div', { class: 'panel-title' });

      // The preview is a see-through window onto the video player behind the page.
      this.previewIdle = h('div', { class: 'preview-idle' }, [
        h('span', { class: 'preview-idle-icon', html: App.icons.tv }),
        h('span', { text: t(App.platform === 'desktop' ? 'live.previewHintMouse' : 'live.previewHint') }),
      ]);
      this.previewStatus = h('div', { class: 'preview-status hidden' });
      this.hole = h('div', { class: 'preview-video' }, [this.previewIdle, this.previewStatus]);
      this.previewName = h('div', { class: 'preview-name' });
      this.previewSub = h('div', { class: 'preview-sub' });
      this.previewEpg = h('div', { class: 'preview-epg' });
      this.previewInfo = h('div', { class: 'preview-info hidden' }, [
        this.previewName,
        this.previewSub,
        this.previewEpg,
        h('div', { class: 'preview-hint', text: t('live.previewFull') }),
      ]);

      el.appendChild(h('div', { class: 'live-body' }, [
        h('div', { class: 'panel groups-panel' }, [h('div', { class: 'panel-title', text: t('live.categories') }), this.groups.el]),
        h('div', { class: 'panel channels-panel' }, [this.channelsTitle, this.channels.el]),
        h('div', { class: 'preview' }, [this.hole, this.previewInfo]),
      ]));

      App.player.on((state, data) => {
        if (App.router.current === this && this.previewChannel) this.onPlayerState(state, data);
      });

      const key = label => '<span class="key">' + label + '</span>';
      const forwardArrow = App.i18n.isRtl() ? '◄' : '►';
      el.appendChild(h('footer', { class: 'hintbar', html: [
        key('OK') + t('live.hintPlay'),
        key(forwardArrow) + t('live.hintFavorite'),
        key(App.localDigits('0-9')) + t('live.hintNumber'),
      ].map(s => '<span>' + s + '</span>').join('') }));

      this.numberEl = h('div', { class: 'number-entry hidden' });
      el.appendChild(this.numberEl);
      this.numbers = new App.NumberEntry(this.numberEl, n => this.playNumber(n));
    },

    show(params) {
      const playlist = App.state.playlist;
      const source = App.state.source;
      if (source.id !== this.sourceId) {
        this.sourceId = source.id;
        this.groupId = 'all';
        this.channelIndex = 0;
      }
      if (params.groupId) this.groupId = params.groupId;
      // <bdi> keeps a Latin playlist name from scrambling the Persian text around it.
      this.subtitle.innerHTML = '<bdi>' + App.esc(source.name) + '</bdi>  ·  ' +
        App.esc(t('live.channelCount', { count: App.fmtNum(playlist.channels.length) }));

      this.groupItems = [
        { id: 'all', label: t('live.all') },
        { id: 'fav', label: t('live.favorites') },
        { id: 'recent', label: t('live.recent') },
      ].concat(playlist.groups.map(g => ({
        id: g.id,
        label: g.name || t('live.ungrouped'),
        locked: App.parental.locked() && App.parental.isAdultGroup(g.name),
      })));
      this.groupItems.forEach(g => { g.count = this.channelsFor(g.id).length; });

      // Back from full screen: the channel is still playing, so it continues in the preview.
      const playing = App.player.channel;
      this.previewChannel = playing && !App.player.isVod() ? playlist.byId.get(playing.id) || null : null;

      const groupIndex = Math.max(0, this.groupItems.findIndex(g => g.id === this.groupId));
      this.groups.setItems(this.groupItems, groupIndex);
      this.showGroup(this.groupItems[groupIndex], params.channelId);
      App.focus.set(this.channels.items.length ? this.channels.el : this.groups.el);
      this.renderPreview();
      if (this.previewChannel) App.player.setVideoRect(this.hole);
    },

    hide() {
      clearTimeout(this.groupTimer);
      this.numbers.cancel();
      // Going full screen keeps the stream; anywhere else stops the preview.
      if (!this.toFullscreen) {
        this.previewChannel = null;
        App.player.stop();
      }
      this.toFullscreen = false;
      App.player.setVideoRect(null);
    },

    preview(channel) {
      if (!App.premium.check(App.premium.canPlayChannel(channel))) return;
      const sourceId = App.state.source.id;
      this.previewChannel = channel;
      this.video = null;
      this.channels.render();
      this.renderPreview();
      App.player.setVideoRect(this.hole);
      App.player.play(channel);
      App.lists.pushRecent(sourceId, channel.id);
      App.lists.setLast(sourceId, channel.id);
      App.sources.nowNext(App.state.source, channel).then(items => {
        if (this.previewChannel === channel) this.previewEpg.innerHTML = App.ui.epgHtml(items);
        // The row may have been drawn before the guide arrived.
        const i = this.channels.items.indexOf(channel);
        if (i >= 0) this.channels.refreshRow(i);
      }).catch(() => { /* programme info is optional */ });
    },

    renderPreview() {
      const channel = this.previewChannel;
      this.previewIdle.classList.toggle('hidden', !!channel);
      this.previewInfo.classList.toggle('hidden', !channel);
      if (!channel) {
        this.previewStatus.className = 'preview-status hidden';
        return;
      }
      this.previewName.textContent = channel.name;
      this.renderPreviewSub();
      this.previewEpg.innerHTML = '';
      this.onPlayerState(App.player.state, {});
    },

    renderPreviewSub() {
      const channel = this.previewChannel;
      const q = quality(this.video);
      this.previewSub.innerHTML = (channel.group ? '<span>' + App.esc(channel.group) + '</span>' : '') +
        (q ? '<span class="badge">' + q + '</span>' : '');
    },

    onPlayerState(state, data) {
      const status = this.previewStatus;
      const show = html => {
        status.className = 'preview-status' + (html ? '' : ' hidden');
        status.innerHTML = html || '';
      };
      if (state === 'buffering' || state === 'retrying') show('<div class="spinner small"></div>');
      else if (state === 'error') show('<div>' + App.esc(t('player.error')) + '</div>');
      else if (state === 'video') {
        this.video = data;
        this.renderPreviewSub();
      } else if (state === 'playing' || state === 'idle') show(null);
    },

    channelsFor(groupId) {
      const playlist = App.state.playlist;
      const sourceId = App.state.source.id;
      const byIds = ids => ids.map(id => playlist.byId.get(id)).filter(Boolean);
      if (groupId === 'all') return App.parental.filter(playlist.channels);
      if (groupId === 'fav') return App.parental.filter(byIds(App.lists.favorites(sourceId)));
      if (groupId === 'recent') return App.parental.filter(byIds(App.lists.recent(sourceId)));
      const group = playlist.groups.find(g => g.id === groupId);
      if (!group || (App.parental.locked() && App.parental.isAdultGroup(group.name))) return [];
      return group.channels;
    },

    showGroup(group, channelId) {
      clearTimeout(this.groupTimer);
      const sameGroup = group.id === this.groupId;
      this.groupId = group.id;
      const list = this.channelsFor(group.id);
      let index = sameGroup ? this.channelIndex : 0;
      if (channelId) index = Math.max(0, list.findIndex(c => c.id === channelId));
      const empty = group.locked ? t('pin.lockedGroup') : {
        fav: t('live.emptyFavorites', { key: App.i18n.isRtl() ? '◄' : '►' }),
        recent: t('live.emptyRecent'),
      }[group.id] || t('live.emptyGroup');
      this.channels.setItems(list, index, App.esc(empty));
      this.channelIndex = this.channels.index;
      this.channelsTitle.textContent = group.label;
    },

    play(index) {
      if (!App.premium.check(App.premium.canPlayChannel(this.channels.items[index]))) return;
      this.toFullscreen = true;
      App.router.go('player', { list: this.channels.items, index: index, groupId: this.groupId, from: 'live' });
    },

    playNumber(n) {
      const playlist = App.state.playlist;
      if (n > playlist.channels.length) {
        App.ui.toast(t('player.notFound', { num: App.fmtNum(n) }));
        return;
      }
      if (!App.premium.check(App.premium.canPlayChannel(playlist.channels[n - 1]))) return;
      this.toFullscreen = true;
      App.router.go('player', { list: playlist.channels, index: n - 1, groupId: 'all', from: 'live' });
    },

    toggleFavorite(channel, index) {
      App.toggleFavorite(channel);
      const fav = this.groupItems[1];
      fav.count = this.channelsFor('fav').length;
      this.groups.refreshRow(1);
      if (this.groupId === 'fav') this.showGroup(fav);
      else this.channels.refreshRow(index);
    },

    onKey(name) {
      if (/^Digit/.test(name)) {
        this.numbers.push(name.slice(5));
        return true;
      }
      if (this.numbers.active && name === 'Enter') {
        this.numbers.commit();
        return true;
      }
      if (name === 'Back') {
        if (this.numbers.active) this.numbers.cancel();
        else if (App.focus.current !== this.channels.el && this.channels.items.length) App.focus.set(this.channels.el);
        else App.router.go('home');
        return true;
      }
      if ((name === 'Yellow' || name === 'Menu' || name === 'Info') && App.focus.current === this.channels.el) {
        const channel = this.channels.current();
        if (channel) this.toggleFavorite(channel, this.channels.index);
        return true;
      }
      return false;
    },
  });
})();
