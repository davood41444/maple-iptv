(function () {
  'use strict';
  const App = window.App;
  const PREFIX = 'homeiptv.';

  // Small values live in localStorage (wrapped: it can throw when full or disabled).
  const store = App.store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch (e) {
        console.warn('Could not save ' + key, e);
      }
    },
    remove(key) {
      try { localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
    },
  };

  const DEFAULTS = {
    lang: 'en',
    activeSource: null,
    resumeLast: true,
    upIsNext: true,
    aspect: 'fit',
    subtitles: 'fa',
    subSize: 'm',
    subColor: 'white',
    subBackground: 'shadow',
    subFont: 'default',
    vodSort: 'added',
    pin: null,
    volume: 1, // the Windows/Mac app's own volume (TVs and phones use their own)
    muted: false,
    reporting: null, // install reports to the website (js/report.js): null until asked
  };

  App.settings = {
    get(key) {
      const saved = store.get('settings', {});
      return key in saved ? saved[key] : DEFAULTS[key];
    },
    set(key, value) {
      const saved = store.get('settings', {});
      saved[key] = value;
      store.set('settings', saved);
    },
  };

  // Saved playlists: { id, name, type: 'm3u' | 'xtream', url | server+username+password+format, expires? }
  App.sourcesStore = {
    all() { return store.get('sources', []); },
    get(id) { return this.all().find(s => s.id === id) || null; },
    save(source) {
      const list = this.all();
      const i = list.findIndex(s => s.id === source.id);
      if (i >= 0) list[i] = source; else list.push(source);
      store.set('sources', list);
    },
    remove(id) {
      store.set('sources', this.all().filter(s => s.id !== id));
      ['recent.', 'last.', 'progress.'].forEach(prefix => store.remove(prefix + id));
      App.lists.forget(id);
      App.progress.forget(id);
      ['', ':movies', ':series'].forEach(suffix => App.cache.del(id + suffix));
    },
  };

  // Per-playlist id lists. Favourites (kind: 'live', 'movies' or 'series')
  // are checked for every list row drawn, so they are kept in memory as Sets.
  const MAX_RECENT = 30;
  const KINDS = ['live', 'movies', 'series'];
  const favoriteSets = {};
  const favoriteKey = (sourceId, kind) => (kind && kind !== 'live' ? 'fav.' + kind + '.' : 'fav.') + sourceId;
  function favoriteSet(sourceId, kind) {
    const key = favoriteKey(sourceId, kind);
    if (!favoriteSets[key]) favoriteSets[key] = new Set(store.get(key, []));
    return favoriteSets[key];
  }

  App.lists = {
    favorites(sourceId, kind) { return Array.from(favoriteSet(sourceId, kind)); },
    isFavorite(sourceId, id, kind) { return favoriteSet(sourceId, kind).has(id); },
    toggleFavorite(sourceId, id, kind) {
      const set = favoriteSet(sourceId, kind);
      const added = !set.has(id);
      if (added) set.add(id); else set.delete(id);
      store.set(favoriteKey(sourceId, kind), Array.from(set));
      return added;
    },
    forget(sourceId) {
      KINDS.forEach(kind => {
        delete favoriteSets[favoriteKey(sourceId, kind)];
        store.remove(favoriteKey(sourceId, kind));
      });
    },
    recent(sourceId) { return store.get('recent.' + sourceId, []); },
    clearRecent(sourceId) { store.remove('recent.' + sourceId); },
    pushRecent(sourceId, channelId) {
      const list = this.recent(sourceId).filter(id => id !== channelId);
      list.unshift(channelId);
      store.set('recent.' + sourceId, list.slice(0, MAX_RECENT));
    },
    last(sourceId) { return store.get('last.' + sourceId, null); },
    setLast(sourceId, channelId) { store.set('last.' + sourceId, channelId); },
  };

  /*
   * Where each movie / episode was left off: { pos, dur, at, done } in ms,
   * keyed by item id ('m…' movies, 'e…' episodes). Series ('s…') keep a
   * pointer to the episode being watched: { episodeId, at }.
   */
  const MAX_PROGRESS = 400;
  const progressCache = {};
  function progressMap(sourceId) {
    if (!progressCache[sourceId]) progressCache[sourceId] = store.get('progress.' + sourceId, {});
    return progressCache[sourceId];
  }

  App.progress = {
    get(sourceId, id) {
      return progressMap(sourceId)[id] || null;
    },
    set(sourceId, id, entry) {
      const map = progressMap(sourceId);
      map[id] = Object.assign({}, entry, { at: Date.now() });
      const ids = Object.keys(map);
      if (ids.length > MAX_PROGRESS) {
        ids.sort((a, b) => map[a].at - map[b].at).slice(0, ids.length - MAX_PROGRESS).forEach(old => delete map[old]);
      }
      store.set('progress.' + sourceId, map);
    },
    // Ids starting with prefix, most recently watched first.
    recent(sourceId, prefix) {
      const map = progressMap(sourceId);
      return Object.keys(map).filter(id => id.charAt(0) === prefix).sort((a, b) => map[b].at - map[a].at);
    },
    forget(sourceId) {
      delete progressCache[sourceId];
    },
    // Takes one title off "Continue watching" (a series keeps its episodes' resume points).
    remove(sourceId, id) {
      const map = progressMap(sourceId);
      delete map[id];
      store.set('progress.' + sourceId, map);
    },
    // Empties "Continue watching" (and resume points) for a playlist.
    clear(sourceId) {
      progressCache[sourceId] = {};
      store.remove('progress.' + sourceId);
    },
  };

  // Downloaded channel lists can be several MB, too big for localStorage, so
  // they are cached in IndexedDB. Every failure resolves to null: the cache is optional.
  let dbPromise = null;
  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise(resolve => {
        try {
          const req = indexedDB.open('homeiptv', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('playlists');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    }
    return dbPromise;
  }

  function run(mode, action) {
    return openDb().then(db => new Promise(resolve => {
      if (!db) return resolve(null);
      try {
        const tx = db.transaction('playlists', mode);
        const req = action(tx.objectStore('playlists'));
        tx.oncomplete = () => resolve(req.result == null ? null : req.result);
        tx.onerror = tx.onabort = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    }));
  }

  App.cache = {
    get(id) { return run('readonly', s => s.get(id)); },
    put(id, value) { return run('readwrite', s => s.put(value, id)); },
    del(id) { return run('readwrite', s => s.delete(id)); },
  };
})();
