/*
 * Downloads in the Windows/Mac app (the work itself is desktop/downloads.js):
 * what has been downloaded, adding movies and episodes, and the local address
 * of a finished file, which the player then uses instead of the server.
 * Downloads wait while anything streams (accounts often allow one connection).
 */
(function () {
  'use strict';
  const App = window.App;
  if (App.platform !== 'desktop') return;
  const t = App.t;
  const host = window.DesktopHost.downloads;
  const pad = n => String(n).padStart(2, '0');

  App.downloads = {
    state: { folder: '', streaming: false, items: [] },
    byId: new Map(),

    init() {
      host.onChange(state => this.set(state));
      host.state().then(state => this.set(state));
      let streaming = false;
      App.player.on(state => {
        const channel = App.player.channel;
        const now = !!channel && channel.url.charAt(0) !== '/' && state !== 'idle' && state !== 'error';
        if (now !== streaming) {
          streaming = now;
          host.setStreaming(now);
        }
      });
    },

    set(state) {
      this.state = state;
      this.byId = new Map(state.items.map(d => [d.id, d]));
      App.events.emit('downloads', state);
    },

    // A movie's or episode's download in the current playlist, or null.
    get(itemId) {
      return App.state.source ? this.byId.get(App.state.source.id + ':' + itemId) || null : null;
    },

    fileUrl(d) {
      return '/downloads/' + encodeURIComponent(d.id) + '.' + d.ext;
    },

    // Where the player finds a finished download; null if there is none.
    localUrl(itemId) {
      const d = this.get(itemId);
      return d && d.status === 'done' ? this.fileUrl(d) : null;
    },

    addMovie(item, info) {
      info = info || {};
      const title = info.title || item.name;
      const year = info.year || item.year;
      return this.add({
        itemId: item.id, kind: 'movie', title: title, year: year, poster: info.poster || item.poster,
        url: App.vod.remoteMovieUrl(item, info), ext: info.ext || item.ext || 'mp4',
        name: title + (year && title.indexOf(year) < 0 ? ' (' + year + ')' : ''), subfolder: 'Movies',
      });
    },

    // Returns how many were added (episodes already downloaded are skipped).
    addEpisodes(series, info, episodes) {
      info = info || {};
      const title = info.title || series.name;
      return episodes.filter(ep => {
        const code = 'S' + pad(ep.season) + 'E' + pad(ep.num);
        return this.add({
          itemId: ep.id, kind: 'episode', title: title, seriesId: series.id, poster: info.poster || series.poster,
          episode: { id: ep.id, episodeId: ep.episodeId, season: ep.season, num: ep.num, title: ep.title, ext: ep.ext, image: ep.image, url: ep.url },
          url: App.vod.remoteEpisodeUrl(ep), ext: ep.ext || 'mp4',
          name: title + ' - ' + code + (ep.title && !/S\d+\s*E\d+/i.test(ep.title) ? ' - ' + ep.title : ''),
          subfolder: 'Series/' + title + '/Season ' + ep.season,
        });
      }).length;
    },

    add(entry) {
      const id = App.state.source.id + ':' + entry.itemId;
      if (this.byId.has(id)) return false;
      Object.assign(entry, { id: id, sourceId: App.state.source.id, ua: navigator.userAgent });
      host.add(entry);
      // Shown straight away; the app's own state follows.
      this.byId.set(id, Object.assign({}, entry, { status: 'queued', received: 0, size: 0 }));
      return true;
    },

    pause: id => host.pause(id),
    resume: id => host.resume(id),
    remove: id => host.remove(id),
    show: id => host.show(id),
    chooseFolder: () => host.chooseFolder(),

    percent(d) {
      return d.size ? Math.min(100, Math.floor(d.received / d.size * 100)) : 0;
    },

    // "Downloading 45%", "Paused", "Downloaded"…
    statusText(d) {
      switch (d.status) {
        case 'done': return t('downloads.done');
        case 'downloading': return t('downloads.downloading', { p: d.size ? App.fmtNum(this.percent(d)) + '%' : App.fmtBytes(d.received) });
        case 'paused': return t('downloads.paused');
        case 'error': return t(d.error === 'disk-full' ? 'downloads.diskFull' : 'downloads.failed');
      }
      return t(this.state.streaming ? 'downloads.waitingPlayback' : 'downloads.queued');
    },
  };
})();
