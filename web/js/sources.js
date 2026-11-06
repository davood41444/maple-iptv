/*
 * Loading channel lists from M3U playlists and Xtream Codes servers.
 *
 * A channel is { id, num, name, logo, group, url, ua?, referrer?, streamId? }.
 * A loaded playlist is { channels, byId, groups: [{ id, name, channels }], info }.
 */
(function () {
  'use strict';
  const App = window.App;
  // Saved lists open instantly; older than this, they are also refreshed in the background.
  const STALE_AFTER = 3600 * 1000;

  function userError(kind) {
    return App.net.netError(kind);
  }

  // Providers put headings like "####IRAN | Persian ####" in their lists; they can't be played.
  function isDivider(name) {
    const s = String(name || '').trim();
    return !/[\p{L}\p{N}]/u.test(s) || (/^([#=*~_-])\1{2,}/.test(s) && /([#=*~_-])\1{2,}$/.test(s));
  }

  // M3U playlists from IPTV panels mix live channels with movies and series episodes.
  function m3uKind(url, name) {
    if (/\/series\//i.test(url)) return 'episode';
    if (/\/movie\//i.test(url) || /\.(mp4|mkv|avi|mov|m4v|webm|wmv)(\?|$)/i.test(url)) {
      return /S\d{1,2}[\s._-]*E\d{1,4}/i.test(name) ? 'episode' : 'movie';
    }
    return 'live';
  }

  // ---- M3U ----

  // #EXTINF:-1 tvg-id="x" tvg-logo="http://…" group-title="News",Channel name
  function parseExtinf(line) {
    let inQuotes = false;
    let i = 8;
    for (; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (c === ',' && !inQuotes) break;
    }
    const attrs = {};
    const re = /([\w-]+)="([^"]*)"/g;
    const head = line.slice(8, i);
    let m;
    while ((m = re.exec(head))) attrs[m[1].toLowerCase()] = m[2];
    return { name: line.slice(i + 1).trim() || attrs['tvg-name'] || '', attrs: attrs, group: '' };
  }

  function parseM3U(text) {
    const lines = text.split(/\r?\n/);
    const channels = [];
    const seen = new Set();
    let info = null;
    let opts = {};
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n].trim();
      if (!line) continue;
      if (line.charAt(0) === '#') {
        if (line.slice(0, 8) === '#EXTINF:') {
          info = parseExtinf(line);
        } else if (line.slice(0, 8) === '#EXTGRP:') {
          if (info) info.group = line.slice(8).trim();
        } else if (line.slice(0, 11) === '#EXTVLCOPT:') {
          const opt = line.slice(11);
          const eq = opt.indexOf('=');
          const key = opt.slice(0, eq).trim().toLowerCase();
          const value = opt.slice(eq + 1).trim();
          if (key === 'http-user-agent') opts.ua = value;
          else if (key === 'http-referrer') opts.referrer = value;
        }
        continue;
      }
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(line)) continue;
      const attrs = info ? info.attrs : {};
      let id = line;
      if (seen.has(id)) id = line + '#' + n;
      seen.add(id);
      const name = (info && info.name) || line.split('/').pop();
      channels.push({
        id: id,
        kind: m3uKind(line, name),
        name: name,
        logo: attrs['tvg-logo'] || '',
        group: (attrs['group-title'] || (info && info.group) || '').trim(),
        url: line,
        ua: opts.ua || attrs['user-agent'] || undefined,
        referrer: opts.referrer || undefined,
      });
      info = null;
      opts = {};
    }
    return channels;
  }

  function loadM3U(source, onProgress) {
    return App.net.getText(source.url, { onProgress: onProgress, timeout: 120000 }).then(text => {
      if (text.indexOf('#EXTINF') < 0 && !/^\s*#EXTM3U/.test(text)) throw userError('parse');
      const entries = parseM3U(text);
      return {
        channels: entries.filter(e => e.kind === 'live'),
        m3uVod: {
          movies: entries.filter(e => e.kind === 'movie'),
          episodes: entries.filter(e => e.kind === 'episode'),
        },
      };
    });
  }

  // ---- Xtream Codes ----

  // Accepts "host:port", "http://host:port/", or a pasted player_api.php / get.php link.
  function xtreamBase(server) {
    let s = String(server || '').trim();
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s.replace(/\/(player_api|get|xmltv)\.php.*$/i, '').replace(/\/+$/, '');
  }

  function xtreamApi(source) {
    return xtreamBase(source.server) + '/player_api.php?username=' + encodeURIComponent(source.username) +
      '&password=' + encodeURIComponent(source.password);
  }

  async function loadXtream(source, onProgress) {
    const api = xtreamApi(source);
    const account = await App.net.getJson(api);
    const user = account && account.user_info;
    if (!user || String(user.auth) !== '1') throw userError('auth');
    if (user.status && user.status !== 'Active') throw userError(user.status === 'Expired' ? 'expired' : 'auth');

    const results = await Promise.all([
      App.net.getJson(api + '&action=get_live_categories'),
      App.net.getJson(api + '&action=get_live_streams', { onProgress: onProgress, timeout: 120000 }),
    ]);
    const categories = Array.isArray(results[0]) ? results[0] : [];
    const streams = Array.isArray(results[1]) ? results[1] : [];
    const categoryName = {};
    categories.forEach(c => { categoryName[c.category_id] = String(c.category_name || '').trim(); });

    const base = xtreamBase(source.server);
    const ext = source.format === 'hls' ? 'm3u8' : 'ts';
    const auth = encodeURIComponent(source.username) + '/' + encodeURIComponent(source.password);
    return {
      channels: streams.map(s => ({
        id: 'x' + s.stream_id,
        name: String(s.name || '').trim(),
        logo: s.stream_icon || '',
        group: categoryName[s.category_id] || '',
        url: base + '/live/' + auth + '/' + s.stream_id + '.' + ext,
        streamId: s.stream_id,
        adult: String(s.is_adult) === '1' || undefined,
      })),
      groupOrder: categories.map(c => categoryName[c.category_id]),
      info: { expires: Number(user.exp_date) > 0 ? Number(user.exp_date) * 1000 : null },
    };
  }

  // Base64 EPG titles are UTF-8.
  function decodeBase64(s) {
    try {
      const binary = atob(s || '');
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes).trim();
    } catch (e) {
      return String(s || '');
    }
  }

  // ---- Loading with cache ----

  // Number the channels and index them by id and group for the screens.
  function build(data) {
    const channels = data.channels.filter(c => !isDivider(c.name));
    const byId = new Map();
    const groups = new Map();
    channels.forEach((c, i) => {
      c.num = i + 1;
      byId.set(c.id, c);
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group).push(c);
    });
    let names = Array.from(groups.keys()).filter(Boolean);
    if (data.groupOrder) {
      const order = new Map(data.groupOrder.map((name, i) => [name, i]));
      const rank = name => (order.has(name) ? order.get(name) : Infinity);
      names.sort((a, b) => rank(a) - rank(b));
    }
    if (groups.has('')) names = names.concat(['']);
    return {
      channels: channels,
      byId: byId,
      groups: names.map(name => ({ id: 'g:' + name, name: name, channels: groups.get(name) })),
      info: data.info || null,
      m3uVod: data.m3uVod || null,
    };
  }

  async function download(source, onProgress) {
    const data = source.type === 'xtream' ? await loadXtream(source, onProgress) : await loadM3U(source, onProgress);
    const vodCount = data.m3uVod ? data.m3uVod.movies.length + data.m3uVod.episodes.length : 0;
    if (!data.channels.length && !vodCount) throw userError('empty');
    App.cache.put(source.id, { savedAt: Date.now(), data: data });
    return data;
  }

  const epgCache = new Map();

  App.sources = {
    parseM3U: parseM3U,
    xtreamBase: xtreamBase,
    xtreamApi: xtreamApi,
    isDivider: isDivider,
    decodeBase64: decodeBase64,

    // Opens from the cache when there is one, so the TV starts quickly; an old
    // cache is refreshed in the background and announced with a 'playlist'
    // event. force: always download. The playlist's savedAt says when it was downloaded.
    async load(source, opts) {
      opts = opts || {};
      const built = (data, savedAt) => Object.assign(build(data), { savedAt: savedAt });
      if (!opts.force) {
        const cached = await App.cache.get(source.id);
        if (cached && cached.data) {
          if (Date.now() - cached.savedAt > STALE_AFTER) {
            download(source).then(
              data => App.events.emit('playlist', { sourceId: source.id, playlist: built(data, Date.now()) }),
              e => console.warn('Background refresh failed', e));
          }
          return built(cached.data, cached.savedAt);
        }
      }
      return built(await download(source, opts.onProgress), Date.now());
    },

    // Now/next programme for an Xtream channel, or null when not available.
    // A failed request counts as "no programme" for a couple of minutes.
    async nowNext(source, channel) {
      if (!source || source.type !== 'xtream' || !channel.streamId) return null;
      const key = source.id + ':' + channel.streamId;
      const hit = epgCache.get(key);
      if (hit && hit.until > Date.now()) return hit.items;
      let items = [];
      let keep = 5 * 60000;
      try {
        const json = await App.net.getJson(xtreamApi(source) + '&action=get_short_epg&limit=2&stream_id=' + channel.streamId, { timeout: 15000 });
        items = ((json && json.epg_listings) || [])
          .map(e => ({ title: decodeBase64(e.title), start: Number(e.start_timestamp) * 1000, end: Number(e.stop_timestamp) * 1000 }))
          .filter(e => e.title);
      } catch (e) {
        keep = 2 * 60000;
      }
      epgCache.set(key, { items: items, until: Date.now() + keep });
      return items;
    },

    // What nowNext() already has for the channel, without asking the server (undefined if nothing).
    cachedNowNext(source, channel) {
      const hit = epgCache.get(source.id + ':' + channel.streamId);
      return hit && hit.until > Date.now() ? hit.items : undefined;
    },
  };
})();
