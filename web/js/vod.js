/*
 * Movies and series ("video on demand").
 *
 * A library (App.vod.load('movies' | 'series')) is
 *   { kind, items, byId, groups: [{ id, name, items }], recent }
 * with items { id, name, poster, rating, year, group, added, … }.
 * Xtream servers provide the lists and details through player_api.php; M3U
 * playlists only give names, posters and stream URLs.
 */
(function () {
  'use strict';
  const App = window.App;
  const STALE_AFTER = 3600 * 1000;
  const RECENT_COUNT = 200;

  const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };
  const decode = s => String(s || '').replace(/&(amp|quot|#39|lt|gt);/g, m => ENTITIES[m]).trim();
  const yearOf = s => { const m = /\b(19|20)\d{2}\b/.exec(s || ''); return m ? m[0] : ''; };
  const first = list => (Array.isArray(list) ? list.find(Boolean) : list) || '';

  function splitCast(s) {
    const seen = new Set();
    return decode(s).split(/\s*,\s*/).filter(name => name && !seen.has(name) && seen.add(name)).slice(0, 12);
  }

  function durationSecs(info) {
    if (Number(info.duration_secs) > 0) return Number(info.duration_secs);
    const m = /(\d+):(\d+):(\d+)/.exec(info.duration || '');
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  }

  // ---- Lists ----

  async function fetchXtream(kind, source, onProgress) {
    const api = App.sources.xtreamApi(source);
    const movies = kind === 'movies';
    const results = await Promise.all([
      App.net.getJson(api + '&action=' + (movies ? 'get_vod_categories' : 'get_series_categories')),
      App.net.getJson(api + '&action=' + (movies ? 'get_vod_streams' : 'get_series'), { onProgress: onProgress, timeout: 180000 }),
    ]);
    const categories = Array.isArray(results[0]) ? results[0] : [];
    const list = Array.isArray(results[1]) ? results[1] : [];
    const categoryName = {};
    categories.forEach(c => { categoryName[c.category_id] = decode(c.category_name); });
    // Only what the lists need: details are fetched per title when opened.
    const items = list.map(x => (movies ? {
      id: 'm' + x.stream_id,
      streamId: x.stream_id,
      name: decode(x.name),
      poster: x.stream_icon || '',
      rating: Number(x.rating) || 0,
      year: yearOf(x.name),
      group: categoryName[x.category_id] || '',
      added: Number(x.added) * 1000 || 0,
      ext: x.container_extension || 'mp4',
      adult: String(x.is_adult) === '1' || undefined,
    } : {
      id: 's' + x.series_id,
      seriesId: x.series_id,
      name: decode(x.name),
      poster: x.cover || '',
      rating: Number(x.rating) || 0,
      year: yearOf(x.releaseDate || x.release_date || x.name),
      group: categoryName[x.category_id] || '',
      added: Number(x.last_modified) * 1000 || 0,
      cast: decode(x.cast) || undefined, // for "also in your library" on actor pages
    }));
    return { items: items, groupOrder: categories.map(c => categoryName[c.category_id]) };
  }

  // "Show Name S01 E02" → { title: 'Show Name', season: 1, episode: 2 }
  function parseEpisodeName(name) {
    const m = /^(.*?)[\s._-]*S(\d{1,2})[\s._-]*E(\d{1,4})/i.exec(name);
    return m ? { title: m[1].trim() || name, season: Number(m[2]), episode: Number(m[3]) } : { title: name, season: 1, episode: 0 };
  }

  function fromM3U(kind, playlist) {
    const vod = playlist.m3uVod || { movies: [], episodes: [] };
    if (kind === 'movies') {
      return {
        items: vod.movies.map(m => ({
          id: 'm' + m.id, name: m.name, poster: m.logo, rating: 0, year: yearOf(m.name), group: m.group, added: 0, url: m.url,
        })),
      };
    }
    const shows = new Map();
    vod.episodes.forEach(e => {
      const parsed = parseEpisodeName(e.name);
      const key = parsed.title.toLowerCase();
      if (!shows.has(key)) {
        shows.set(key, { id: 's' + key, name: parsed.title, poster: e.logo, rating: 0, year: yearOf(e.name), group: e.group, added: 0, episodes: [] });
      }
      shows.get(key).episodes.push({ id: 'e' + e.id, season: parsed.season, num: parsed.episode, title: e.name, url: e.url, image: e.logo });
    });
    return { items: Array.from(shows.values()) };
  }

  function hydrate(kind, data, savedAt) {
    const items = data.items.filter(x => !App.sources.isDivider(x.name));
    const byId = new Map();
    const groups = new Map();
    items.forEach(x => {
      byId.set(x.id, x);
      if (!groups.has(x.group)) groups.set(x.group, []);
      groups.get(x.group).push(x);
    });
    let names = Array.from(groups.keys()).filter(Boolean);
    if (data.groupOrder) {
      const order = new Map(data.groupOrder.map((name, i) => [name, i]));
      const rank = name => (order.has(name) ? order.get(name) : Infinity);
      names.sort((a, b) => rank(a) - rank(b));
    }
    if (groups.has('')) names = names.concat(['']);
    const recent = items.some(x => x.added) ? items.slice().sort((a, b) => b.added - a.added).slice(0, RECENT_COUNT) : [];
    return {
      kind: kind,
      items: items,
      byId: byId,
      groups: names.map(name => ({ id: 'g:' + name, name: name, items: groups.get(name) })),
      recent: recent,
      savedAt: savedAt, // when the list was downloaded
    };
  }

  const libraries = {};
  const pending = {};

  async function download(kind, source, onProgress) {
    const data = await fetchXtream(kind, source, onProgress);
    App.cache.put(source.id + ':' + kind, { savedAt: Date.now(), data: data });
    return data;
  }

  async function loadLibrary(kind, source, opts) {
    // M3U playlists carry their movies and series, so they're as fresh as the playlist.
    if (source.type !== 'xtream') return hydrate(kind, fromM3U(kind, App.state.playlist), App.state.playlist.savedAt);
    if (!opts.force) {
      const cached = await App.cache.get(source.id + ':' + kind);
      if (cached && cached.data) {
        if (Date.now() - cached.savedAt > STALE_AFTER) {
          download(kind, source).then(data => {
            libraries[source.id + ':' + kind] = hydrate(kind, data, Date.now());
            App.events.emit('library', kind);
          }, e => console.warn('Background refresh failed', e));
        }
        return hydrate(kind, cached.data, cached.savedAt);
      }
    }
    return hydrate(kind, await download(kind, source, opts.onProgress), Date.now());
  }

  // ---- Details ----

  const details = new Map();

  async function movieInfo(item) {
    const source = App.state.source;
    if (source.type !== 'xtream') return { title: item.name, poster: item.poster, year: item.year, cast: [] };
    const json = await App.net.getJson(App.sources.xtreamApi(source) + '&action=get_vod_info&vod_id=' + item.streamId, { timeout: 20000 });
    const info = (json && json.info) || {};
    const data = (json && json.movie_data) || {};
    return {
      title: decode(info.name || data.name) || item.name,
      poster: info.movie_image || info.cover_big || item.poster,
      backdrop: first(info.backdrop_path) || info.backdrop || '',
      plot: decode(info.plot || info.description),
      genre: decode(info.genre).replace(/\s*\/\s*/g, ', '),
      director: decode(info.director),
      cast: splitCast(info.cast || info.actors),
      year: yearOf(info.releasedate || info.release_date) || item.year,
      duration: durationSecs(info),
      rating: Number(info.rating) || item.rating,
      trailer: info.youtube_trailer || '',
      ext: data.container_extension || item.ext,
    };
  }

  function episodeFromXtream(e, season, item) {
    const info = e.info || {};
    return {
      id: 'e' + e.id,
      episodeId: e.id,
      seriesId: item.seriesId,
      season: season,
      num: Number(e.episode_num) || 0,
      title: decode(e.title || info.name),
      plot: decode(info.plot),
      image: info.movie_image || info.cover_big || '',
      duration: durationSecs(info),
      ext: e.container_extension || 'mp4',
    };
  }

  async function seriesInfo(item) {
    const source = App.state.source;
    if (source.type !== 'xtream') {
      const bySeason = new Map();
      item.episodes.forEach(e => {
        if (!bySeason.has(e.season)) bySeason.set(e.season, []);
        bySeason.get(e.season).push(e);
      });
      return {
        title: item.name, poster: item.poster, year: item.year, cast: [],
        seasons: Array.from(bySeason.keys()).sort((a, b) => a - b).map(n => ({
          num: n, name: '', episodes: bySeason.get(n).sort((a, b) => a.num - b.num),
        })),
      };
    }
    const json = await App.net.getJson(App.sources.xtreamApi(source) + '&action=get_series_info&series_id=' + item.seriesId, { timeout: 30000 });
    const info = (json && json.info) || {};
    const meta = new Map(((json && json.seasons) || []).map(s => [Number(s.season_number), s]));
    let episodes = (json && json.episodes) || {};
    // Some panels send an array of per-season arrays instead of an object.
    if (Array.isArray(episodes)) {
      const bySeason = {};
      episodes.forEach(list => (list || []).forEach(e => { (bySeason[e.season] = bySeason[e.season] || []).push(e); }));
      episodes = bySeason;
    }
    const seasonNumbers = Object.keys(episodes).map(Number)
      .sort((a, b) => (a === 0) - (b === 0) || a - b); // Specials (season 0) last
    return {
      title: decode(info.name) || item.name,
      poster: info.cover || item.poster,
      backdrop: first(info.backdrop_path),
      plot: decode(info.plot),
      genre: decode(info.genre).replace(/\s*\/\s*/g, ', '),
      director: decode(info.director),
      cast: splitCast(info.cast),
      year: yearOf(info.releaseDate || info.release_date) || item.year,
      rating: Number(info.rating) || item.rating,
      trailer: info.youtube_trailer || '',
      seasons: seasonNumbers.map(n => ({
        num: n,
        name: decode((meta.get(n) || {}).name),
        episodes: (episodes[n] || []).map(e => episodeFromXtream(e, n, item)).sort((a, b) => a.num - b.num),
      })),
    };
  }

  function streamUrl(type, id, ext) {
    const source = App.state.source;
    return App.sources.xtreamBase(source.server) + '/' + type + '/' + encodeURIComponent(source.username) + '/' +
      encodeURIComponent(source.password) + '/' + id + '.' + (ext || 'mp4');
  }

  App.vod = {
    // Shares one download between callers; force skips the cache.
    load(kind, opts) {
      opts = opts || {};
      const source = App.state.source;
      const key = source.id + ':' + kind;
      if (!opts.force && libraries[key]) return Promise.resolve(libraries[key]);
      if (!pending[key]) {
        pending[key] = loadLibrary(kind, source, opts).then(library => {
          libraries[key] = library;
          App.events.emit('library', kind);
          return library;
        }).finally(() => { delete pending[key]; });
      }
      return pending[key];
    },

    loaded(kind) {
      return libraries[App.state.source.id + ':' + kind] || null;
    },

    // Forget loaded lists, e.g. after the playlist was refreshed.
    reset() {
      Object.keys(libraries).forEach(key => delete libraries[key]);
      details.clear();
    },

    info(kind, item) {
      const key = App.state.source.id + ':' + item.id;
      if (!details.has(key)) {
        const promise = kind === 'movies' ? movieInfo(item) : seriesInfo(item);
        details.set(key, promise);
        promise.catch(() => details.delete(key));
      }
      return details.get(key);
    },

    // What the player opens: a downloaded copy (Windows/Mac app) if there is one.
    movieUrl(item, info) {
      return (App.downloads && App.downloads.localUrl(item.id)) || this.remoteMovieUrl(item, info);
    },

    episodeUrl(episode) {
      return (App.downloads && App.downloads.localUrl(episode.id)) || this.remoteEpisodeUrl(episode);
    },

    remoteMovieUrl(item, info) {
      return item.url || streamUrl('movie', item.streamId, (info && info.ext) || item.ext);
    },

    remoteEpisodeUrl(episode) {
      return episode.url || streamUrl('series', episode.episodeId, episode.ext);
    },
  };

  // ---- Cast photos ----
  // The server only lists names, so actors are looked up on Wikipedia (no
  // account needed). Only pages describing an actor are used, to avoid
  // showing someone else with the same name.
  const PEOPLE_MAX = 800;
  const ACTOR_WORDS = /\b(actor|actress|comedian|entertainer|performer|voice artist)\b|بازیگر|هنرپیشه|ممثل/i;
  // Names in Arabic script: Persian Wikipedia, or Arabic Wikipedia in the Arabic interface.
  const wikiHost = name => (/[؀-ۿ]/.test(name) ? (App.i18n.lang === 'ar' ? 'ar' : 'fa') : 'en') + '.wikipedia.org';
  let people = null;

  function peopleCache() {
    if (!people) people = App.store.get('people', {});
    return people;
  }

  const UA = 'MapleIPTV/1.0 (info@mapleonlinesolutions.com)';
  const MAX_TITLES = 30;

  // Works the person is credited in (Wikidata "cast member"), with English and Persian titles.
  async function filmography(qid) {
    const query = 'SELECT ?label (MIN(YEAR(?date)) AS ?year) WHERE { ?work wdt:P161 wd:' + qid + ' ; rdfs:label ?label . ' +
      'FILTER(LANG(?label) IN ("en", "fa")) OPTIONAL { ?work wdt:P577 ?date } } GROUP BY ?label';
    const json = await App.net.getJson('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query), { timeout: 15000, ua: UA });
    return ((json && json.results && json.results.bindings) || []).map(b => ({
      title: b.label.value,
      year: b.year ? Number(b.year.value) : 0,
    }));
  }

  // "Anna (2019)", "Migration-PD", "Recep İvedik 7_PST …" → "anna", "migration", "recep ivedik 7"
  function titleKey(s) {
    return String(s || '').toLowerCase()
      .replace(/\((19|20)\d{2}\)/g, ' ')
      .replace(/[\s._-]+(pd|ps|pst|ss|fs|sub|dub|subbed|dubbed|multi|hd|fhd|4k|uhd)\b.*$/i, '')
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  function matchTitle(kind, work) {
    const library = App.vod.loaded(kind);
    if (!library) return [];
    if (!library.titleIndex) {
      library.titleIndex = new Map();
      library.items.forEach(x => {
        const key = titleKey(x.name);
        if (!library.titleIndex.has(key)) library.titleIndex.set(key, []);
        library.titleIndex.get(key).push(x);
      });
    }
    return (library.titleIndex.get(titleKey(work.title)) || [])
      .filter(x => !work.year || !x.year || Math.abs(Number(x.year) - work.year) <= 1);
  }
  const wikiSummary = (host, title) => App.net.getJson('https://' + host + '/api/rest_v1/page/summary/' +
    encodeURIComponent(title.replace(/ /g, '_')), { timeout: 10000, ua: UA });

  App.people = {
    // { name, photo, description, bio } from Wikipedia, or null when no actor page is found.
    // The article in the interface language is used when there is one.
    async details(name) {
      const host = wikiHost(name);
      const lang = App.i18n.lang;
      let page;
      try {
        page = await wikiSummary(host, name);
      } catch (e) {
        return null;
      }
      if (!page || page.type !== 'standard' || !ACTOR_WORDS.test(page.description || page.extract || '')) return null;
      const result = {
        name: page.title,
        photo: page.originalimage ? page.originalimage.source : (page.thumbnail && page.thumbnail.source),
        description: page.description || '',
        bio: page.extract || '',
      };
      if (host !== lang + '.wikipedia.org') {
        try {
          const links = await App.net.getJson('https://' + host + '/w/api.php?action=query&format=json&prop=langlinks&lllang=' + lang +
            '&redirects=1&titles=' + encodeURIComponent(page.title), { timeout: 10000, ua: UA });
          const pages = (links && links.query && links.query.pages) || {};
          const link = Object.keys(pages).map(k => pages[k].langlinks && pages[k].langlinks[0]).find(Boolean);
          if (link) {
            const local = await wikiSummary(lang + '.wikipedia.org', link['*']);
            if (local && local.extract) {
              result.bio = local.extract;
              result.description = local.description || result.description;
              result.name = local.title || result.name;
            }
          }
        } catch (e) { /* keep the original text */ }
      }
      return result;
    },

    // Movies and series of this playlist that the actor appears in: series whose
    // cast lists the name, plus titles from the actor's Wikidata filmography.
    async titles(name) {
      const found = new Map();
      const add = (kind, item) => { if (!found.has(item.id)) found.set(item.id, { kind: kind, item: item }); };
      const needle = App.normalize(name);
      const series = App.vod.loaded('series');
      if (series) series.items.forEach(x => { if (x.cast && App.normalize(x.cast).indexOf(needle) >= 0) add('series', x); });
      try {
        const page = await wikiSummary(wikiHost(name), name);
        if (page && page.wikibase_item) {
          (await filmography(page.wikibase_item)).forEach(work => {
            ['movies', 'series'].forEach(kind => matchTitle(kind, work).forEach(item => add(kind, item)));
          });
        }
      } catch (e) { /* the cast lists alone */ }
      return Array.from(found.values()).slice(0, MAX_TITLES);
    },

    // Actor names from the series cast lists that contain the query (for search).
    findNames(query) {
      const series = App.vod.loaded('series');
      if (!series) return [];
      if (!series.castNames) {
        series.castNames = new Map();
        series.items.forEach(x => (x.cast || '').split(/\s*,\s*/).forEach(n => {
          n = n.trim();
          if (n.length > 2) series.castNames.set(App.normalize(n), n);
        }));
      }
      const q = App.normalize(query);
      const names = [];
      series.castNames.forEach((display, key) => { if (names.length < 12 && key.indexOf(q) >= 0) names.push(display); });
      return names;
    },

    photo(name) {
      const cache = peopleCache();
      if (name in cache) return Promise.resolve(cache[name] || null);
      return wikiSummary(wikiHost(name), name).then(page => {
        const ok = page && page.type === 'standard' && page.thumbnail && ACTOR_WORDS.test(page.description || page.extract || '');
        return ok ? page.thumbnail.source : '';
      }, error => (error.kind === 'http' ? '' : null)).then(photo => {
        if (photo === null) return null; // network trouble: try again another time
        cache[name] = photo;
        const names = Object.keys(cache);
        if (names.length > PEOPLE_MAX) names.slice(0, names.length - PEOPLE_MAX).forEach(n => delete cache[n]);
        App.store.set('people', cache);
        return photo || null;
      });
    },
  };
})();
