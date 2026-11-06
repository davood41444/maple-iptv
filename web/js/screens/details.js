/*
 * A movie or series page: backdrop, poster, plot, cast with photos, and
 * play / resume buttons. Series also get seasons and an episode list.
 * params: { kind: 'movies' | 'series', item, from, fromParams, keep }
 */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const t = App.t;
  const RESUME_MIN_MS = 30000;
  const MAX_CAST = 10;

  App.router.register({
    name: 'details',

    build() {
      this.backdrop = h('div', { class: 'details-backdrop' });
      this.body = h('div', { class: 'details-body scroller' });
      this.el.appendChild(this.backdrop);
      this.el.appendChild(h('div', { class: 'details-shade' }));
      this.el.appendChild(this.body);
      // Windows/Mac: each episode row ends in a download button (its second column).
      this.episodes = new App.VirtualList({
        rowHeight: 150,
        className: 'episodes',
        columns: App.downloads ? 2 : 1,
        renderRow: ep => this.episodeRow(ep),
        onSelect: (ep, i, column) => {
          if (column === 1) this.downloadEpisode(ep);
          else this.playEpisode(this.seasonIndex, i);
        },
      });
      if (App.downloads) {
        App.events.on('downloads', () => {
          if (App.router.current !== this) return;
          this.updateDownloadButton();
          this.episodes.rows.forEach((row, i) => this.episodes.refreshRow(i));
        });
      }
    },

    show(params) {
      const sameItem = this.params && this.params.item === params.item && this.info;
      this.params = params;
      this.kind = params.kind;
      if (!sameItem) {
        this.info = null;
        this.seasonIndex = null;
      }
      // Until the remote is used, keep focus on the Play button as the page fills in.
      this.autoFocus = !params.focusEpisode;
      this.render();
      if (!this.info) {
        const item = params.item;
        App.vod.info(this.kind, item).then(info => {
          if (this.params.item !== item || App.router.current !== this) return;
          this.info = info;
          this.render();
        }, e => {
          console.warn('Could not load details', e);
          if (this.params.item !== item || App.router.current !== this) return;
          this.info = { failed: true, cast: [] };
          this.render();
        });
      }
    },

    render() {
      const item = this.params.item;
      const info = this.info || {};
      const focusedKey = App.focus.current && App.focus.current.getAttribute('data-key');
      this.body.innerHTML = '';

      const image = info.backdrop || info.poster || item.poster;
      this.backdrop.style.backgroundImage = image ? 'url("' + image.replace(/"/g, '%22') + '")' : 'none';

      const meta = [];
      if (info.year || item.year) meta.push(App.localDigits(info.year || item.year));
      if (info.duration) meta.push(App.fmtDuration(info.duration));
      if (info.genre) meta.push(info.genre);
      const rating = info.rating || item.rating;

      const poster = h('div', { class: 'details-poster' }, [
        h('span', { class: 'poster-fallback', text: item.name }),
        (info.poster || item.poster) ? h('img', { src: info.poster || item.poster, alt: '', onerror: e => e.target.remove() }) : null,
      ]);

      let plot;
      if (!this.info) plot = h('div', { class: 'details-plot loading' }, [h('div', { class: 'spinner small' })]);
      else plot = h('p', { class: 'details-plot', text: info.plot || t('details.noInfo') });

      this.buttons = h('div', { class: 'details-buttons' }, this.kind === 'movies' ? this.movieButtons() : this.seriesButtons());

      const main = h('div', { class: 'details-main' }, [
        h('h1', { class: 'details-title', text: info.title || item.name }),
        h('div', { class: 'details-meta' }, [
          rating ? h('span', { class: 'details-rating', text: '★ ' + App.fmtRating(rating) }) : null,
          meta.length ? h('span', { text: meta.join('  ·  ') }) : null,
        ]),
        plot,
        info.director ? h('div', { class: 'details-line' }, [h('span', { class: 'details-label', text: t('details.director') }), h('bdi', { text: info.director })]) : null,
        this.buttons,
        info.cast && info.cast.length ? this.castRow(info.cast) : null,
      ]);
      this.body.appendChild(h('div', { class: 'details-hero' }, [poster, main]));

      if (this.kind === 'series' && info.seasons && info.seasons.length) this.renderSeasons();

      const restore = !this.autoFocus && focusedKey && this.body.querySelector('[data-key="' + focusedKey + '"]');
      if (this.params.focusEpisode && this.episodes.el.isConnected) {
        App.focus.set(this.episodes.el);
        this.params.focusEpisode = false;
      } else {
        App.focus.set(restore || this.buttons.querySelector('.focusable'));
      }
    },

    button(key, icon, label, onclick, primary) {
      return h('button', {
        class: 'btn big focusable' + (primary ? ' primary' : ''), 'data-key': key, onclick: onclick,
        html: (icon ? App.icons[icon] : '') + '<span>' + App.esc(label) + '</span>',
      });
    },

    commonButtons() {
      const item = this.params.item;
      const info = this.info || {};
      const favorite = App.lists.isFavorite(App.state.source.id, item.id, this.kind);
      const list = [
        this.button('fav', 'star', t(favorite ? 'details.inFavorites' : 'details.favorite'), () => {
          const on = App.lists.toggleFavorite(App.state.source.id, item.id, this.kind);
          App.ui.toast(t(on ? 'fav.added' : 'fav.removed'));
          this.render();
        }),
      ];
      if (info.trailer && App.platform === 'android') {
        list.push(this.button('trailer', 'trailer', t('details.trailer'), () => {
          window.AndroidHost.openUrl('https://www.youtube.com/watch?v=' + encodeURIComponent(info.trailer));
        }));
      }
      return list;
    },

    movieButtons() {
      const progress = App.progress.get(App.state.source.id, this.params.item.id);
      const resume = progress && !progress.done && progress.pos > RESUME_MIN_MS ? progress.pos : 0;
      const list = [];
      if (resume) {
        list.push(this.button('play', 'play', t('details.resume', { time: App.fmtClock(resume / 1000) }), () => this.playMovie(resume), true));
        list.push(this.button('restart', 'restart', t('details.startOver'), () => this.playMovie(0)));
      } else {
        list.push(this.button('play', 'play', t('details.play'), () => this.playMovie(0), true));
      }
      if (App.downloads) list.push(this.button('download', 'download', this.downloadLabel(), () => this.downloadMovie()));
      return list.concat(this.commonButtons());
    },

    seriesButtons() {
      const list = [];
      const info = this.info;
      if (info && info.seasons && info.seasons.length) {
        const next = this.continuePoint();
        const ep = info.seasons[next.season].episodes[next.episode];
        const label = t(next.resumed ? 'details.continueEp' : 'details.playEp', { s: App.fmtNum(ep.season), e: App.fmtNum(ep.num) });
        list.push(this.button('play', 'play', label, () => this.playEpisode(next.season, next.episode), true));
        if (App.downloads) list.push(this.button('download', 'download', this.downloadLabel(), () => this.downloadSeason()));
      }
      return list.concat(this.commonButtons());
    },

    // ---- Downloads (Windows/Mac app) ----

    downloadLabel() {
      if (this.kind === 'series') {
        const season = this.info.seasons[this.seasonIndex == null ? this.continuePoint().season : this.seasonIndex];
        return t('downloads.season', { n: App.fmtNum(season.num) });
      }
      const d = App.downloads.get(this.params.item.id);
      return d ? App.downloads.statusText(d) : t('downloads.download');
    },

    updateDownloadButton() {
      const label = this.buttons && this.buttons.querySelector('[data-key="download"] span');
      if (label) label.textContent = this.downloadLabel();
    },

    downloadMovie() {
      if (App.downloads.get(this.params.item.id)) {
        App.router.go('downloads');
        return;
      }
      if (!App.premium.check(App.premium.canWatchVod())) return;
      App.downloads.addMovie(this.params.item, this.info);
      App.ui.toast(t('downloads.added'));
      this.updateDownloadButton();
    },

    downloadSeason() {
      if (!App.premium.check(App.premium.canWatchVod())) return;
      const season = this.info.seasons[this.seasonIndex == null ? this.continuePoint().season : this.seasonIndex];
      const added = App.downloads.addEpisodes(this.params.item, this.info, season.episodes);
      App.ui.toast(added ? t('downloads.addedMany', { n: App.fmtNum(added) }) : t('downloads.already'));
    },

    downloadEpisode(ep) {
      if (App.downloads.get(ep.id)) {
        App.router.go('downloads');
        return;
      }
      if (!App.premium.check(App.premium.canWatchVod())) return;
      App.downloads.addEpisodes(this.params.item, this.info, [ep]);
      App.ui.toast(t('downloads.added'));
    },

    // The episode to continue with: the one last watched (or the next one if it was finished).
    continuePoint() {
      const seasons = this.info.seasons;
      const sourceId = App.state.source.id;
      const pointer = App.progress.get(sourceId, this.params.item.id);
      if (pointer) {
        for (let s = 0; s < seasons.length; s++) {
          const e = seasons[s].episodes.findIndex(ep => ep.id === pointer.episodeId);
          if (e < 0) continue;
          const p = App.progress.get(sourceId, pointer.episodeId);
          if (!(p && p.done)) return { season: s, episode: e, resumed: true };
          if (e + 1 < seasons[s].episodes.length) return { season: s, episode: e + 1, resumed: true };
          if (s + 1 < seasons.length && seasons[s + 1].episodes.length) return { season: s + 1, episode: 0, resumed: true };
          return { season: s, episode: e, resumed: true };
        }
      }
      const firstSeason = Math.max(0, seasons.findIndex(s => s.episodes.length));
      return { season: firstSeason, episode: 0, resumed: false };
    },

    castRow(names) {
      const row = h('div', { class: 'cast-row' });
      names.slice(0, MAX_CAST).forEach((name, i) => {
        const photo = h('div', { class: 'cast-photo' }, [h('span', { text: App.initials(name) })]);
        row.appendChild(h('button', {
          class: 'cast-member focusable',
          'data-key': 'cast' + i,
          onclick: () => App.router.go('person', { name: name, from: 'details', fromParams: this.backParams() }),
        }, [photo, h('div', { class: 'cast-name', text: name })]));
        App.people.photo(name).then(url => {
          if (url) photo.appendChild(h('img', { src: url, alt: '', onerror: e => e.target.remove() }));
        });
      });
      return h('div', { class: 'details-cast' }, [h('div', { class: 'details-label', text: t('details.cast') }), row]);
    },

    renderSeasons() {
      const seasons = this.info.seasons;
      if (this.seasonIndex == null) this.seasonIndex = this.continuePoint().season;
      const tabs = h('div', { class: 'season-tabs' });
      seasons.forEach((season, i) => {
        const label = season.num === 0 ? t('details.specials') : t('details.season', { n: App.fmtNum(season.num) });
        tabs.appendChild(h('button', {
          class: 'btn focusable' + (i === this.seasonIndex ? ' selected' : ''),
          'data-key': 'season' + i,
          text: label,
          onclick: () => {
            this.seasonIndex = i;
            Array.prototype.forEach.call(tabs.children, (b, j) => b.classList.toggle('selected', j === i));
            this.showEpisodes();
            if (App.downloads) this.updateDownloadButton();
            App.focus.set(this.episodes.el);
          },
        }));
      });
      this.body.appendChild(h('div', { class: 'details-episodes' }, [
        tabs,
        h('div', { class: 'panel episodes-panel' }, [this.episodes.el]),
      ]));
      this.showEpisodes();
    },

    showEpisodes() {
      const season = this.info.seasons[this.seasonIndex];
      const next = this.continuePoint();
      this.episodes.setItems(season.episodes, next.season === this.seasonIndex ? next.episode : 0, App.esc(t('live.emptyGroup')));
    },

    episodeRow(ep) {
      const p = App.progress.get(App.state.source.id, ep.id);
      const percent = p && p.done ? 100 : (p && p.dur > 0 ? Math.min(100, p.pos / p.dur * 100) : 0);
      const meta = [];
      if (ep.duration) meta.push(App.fmtDuration(ep.duration));
      if (p && p.done) meta.push('✓ ' + t('details.watched'));
      const download = App.downloads && App.downloads.get(ep.id);
      if (download) meta.push((download.status === 'done' ? '✓ ' : '↓ ') + App.downloads.statusText(download));
      return '<span class="ep-thumb"><span class="ep-num">' + App.fmtNum(ep.num) + '</span>' +
        (ep.image ? '<img src="' + App.esc(ep.image) + '" alt="" onerror="this.remove()">' : '') +
        (percent ? '<span class="poster-progress"><i style="width:' + percent.toFixed(1) + '%"></i></span>' : '') + '</span>' +
        '<span class="ep-text"><span class="ep-title">' + App.esc(t('details.episode', { e: App.fmtNum(ep.num) }) + '  ·  ' + (ep.title || '')) + '</span>' +
        '<span class="ep-meta">' + App.esc(meta.join('  ·  ')) + '</span>' +
        (ep.plot ? '<span class="ep-plot">' + App.esc(ep.plot) + '</span>' : '') + '</span>' +
        (App.downloads ? '<span class="row-action" title="' + App.esc(t('downloads.episode')) + '">' +
          App.icons[download && download.status === 'done' ? 'check' : 'download'] + '</span>' : '');
    },

    backParams() {
      return Object.assign({}, this.params, { keep: true });
    },

    playMovie(startMs) {
      if (!App.premium.check(App.premium.canWatchVod())) return;
      const item = this.params.item;
      App.router.go('vodPlayer', {
        kind: 'movie',
        title: (this.info && this.info.title) || item.name,
        item: item,
        url: App.vod.movieUrl(item, this.info),
        startMs: startMs,
        back: this.backParams(),
      });
    },

    playEpisode(seasonIndex, episodeIndex) {
      if (!App.premium.check(App.premium.canWatchVod())) return;
      const seasons = this.info.seasons;
      const queue = [];
      let index = 0;
      seasons.forEach((season, s) => season.episodes.forEach((ep, e) => {
        if (s === seasonIndex && e === episodeIndex) index = queue.length;
        queue.push(ep);
      }));
      const p = App.progress.get(App.state.source.id, queue[index].id);
      App.router.go('vodPlayer', {
        kind: 'episode',
        title: (this.info && this.info.title) || this.params.item.name,
        item: this.params.item,
        queue: queue,
        index: index,
        startMs: p && !p.done && p.pos > RESUME_MIN_MS ? p.pos : 0,
        back: Object.assign(this.backParams(), { focusEpisode: true }),
      });
    },

    onKey(name) {
      this.autoFocus = false;
      if (name !== 'Back') return false;
      const from = this.params.from || 'library';
      App.router.go(from, Object.assign({ kind: this.kind, keep: true }, this.params.fromParams || {}));
      return true;
    },
  });
})();
