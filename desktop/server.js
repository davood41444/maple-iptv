/*
 * The desktop app's local web server (127.0.0.1 only): serves the shared web/
 * interface and, like the Android app's HttpProxy, /proxy?url=... so playlists
 * and streams from IPTV servers (plain http, no CORS headers) can be loaded.
 *
 * /proxy only answers requests carrying the cookie set with the page, so other
 * programs on the computer (or web pages) can't use it as an open proxy.
 * Movies passing through have their subtitles read out (subtitles.js); the page
 * gets them from /subtitles?key=<movie address>&since=<last cue seen>.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const subtitles = require('./subtitles');

// A fixed port keeps the page's address, and so its saved data, the same every time.
const PORTS = [47110, 47111, 47112, 47113, 47114];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

// An HLS playlist reached through a redirect (common with IPTV servers): its
// relative addresses belong to the final address, which the player never sees,
// so they are made absolute.
function absolutePlaylist(text, base) {
  const absolute = uri => {
    try { return new URL(uri, base).href; } catch (e) { return uri; }
  };
  return text.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed[0] !== '#') return absolute(trimmed);
    return line.replace(/URI="([^"]+)"/g, (all, uri) => 'URI="' + absolute(uri) + '"');
  }).join('\n');
}

async function proxy(target, req, res) {
  if (!/^https?:\/\//i.test(target || '')) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('Missing or invalid url');
    return;
  }
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  const headers = {};
  ['user-agent', 'range'].forEach(name => { if (req.headers[name]) headers[name] = req.headers[name]; });
  try {
    const upstream = await fetch(target, { signal: abort.signal, headers });
    const out = {
      'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
      'cache-control': 'no-store',
    };
    // Byte ranges: HLS segments in one file, and seeking in movies.
    // (fetch has already unzipped compressed bodies, so their length no longer matches.)
    const lengths = upstream.headers.get('content-encoding') ? ['content-range', 'accept-ranges'] : ['content-range', 'content-length', 'accept-ranges'];
    lengths.forEach(name => {
      if (upstream.headers.get(name)) out[name] = upstream.headers.get(name);
    });
    if (upstream.redirected && upstream.ok && (/mpegurl/i.test(out['content-type']) || /\.m3u8?$/i.test(new URL(upstream.url).pathname))) {
      const text = absolutePlaylist(await upstream.text(), upstream.url);
      delete out['content-length'];
      res.writeHead(upstream.status, out);
      res.end(text);
      return;
    }
    res.writeHead(upstream.status, out);
    if (!upstream.body) {
      res.end();
      return;
    }
    const body = Readable.fromWeb(upstream.body).on('error', () => res.destroy());
    // Movies: read their subtitles on the way through (see subtitles.js).
    if (upstream.ok && subtitles.isMovie(target, out['content-type'])) {
      body.on('data', subtitles.tap(target, subtitles.rangeStart(out['content-range'])));
    }
    body.pipe(res);
  } catch (e) {
    if (abort.signal.aborted) return;
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(String(e.cause ? e.cause.message : e.message));
  }
}

const VIDEO_TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.ts': 'video/mp2t', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo' };

// A downloaded video, with byte ranges so the player can seek; key: its address on the
// page, under which its subtitles are kept.
function serveVideo(file, key, req, res) {
  fs.stat(file, (err, stat) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    const type = VIDEO_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const size = stat.size;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (!m || (!m[1] && !m[2])) {
      res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
      fs.createReadStream(file).on('data', subtitles.tap(key, 0)).pipe(res);
      return;
    }
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { 'content-range': 'bytes */' + size });
      res.end();
      return;
    }
    res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': 'bytes ' + start + '-' + end + '/' + size, 'accept-ranges': 'bytes' });
    fs.createReadStream(file, { start: start, end: end }).on('data', subtitles.tap(key, start)).pipe(res);
  });
}

function serveFile(file, res, extraHeaders) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, Object.assign({ 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }, extraHeaders));
    res.end(data);
  });
}

// webRoot: the shared interface; vendorRoot: hls.js and mpegts.js, served as /vendor/…;
// downloadedFile(id): the finished download's path, served as /downloads/<id>.<ext>.
// Resolves to the address to open.
function startServer(webRoot, vendorRoot, downloadedFile) {
  const token = crypto.randomBytes(24).toString('hex');
  const cookie = 'maple=' + token;

  const handler = port => (req, res) => {
    // Only this computer's own address: guards against DNS-rebinding pages.
    if (req.headers.host !== '127.0.0.1:' + port) {
      res.writeHead(403);
      res.end();
      return;
    }
    const url = new URL(req.url, 'http://127.0.0.1');
    const fromPage = (req.headers.cookie || '').split(/;\s*/).includes(cookie);
    if (url.pathname === '/proxy') {
      if (!fromPage) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (url.searchParams.get('ua')) req.headers['user-agent'] = url.searchParams.get('ua');
      proxy(url.searchParams.get('url'), req, res);
      return;
    }
    if (url.pathname.startsWith('/downloads/')) {
      const id = decodeURIComponent(url.pathname.slice(11).replace(/\.[^.]*$/, ''));
      const file = fromPage && downloadedFile(id);
      if (!file) {
        res.writeHead(404);
        res.end();
        return;
      }
      serveVideo(file, url.pathname, req, res);
      return;
    }
    // The subtitles read so far from a movie (key: its address on the page).
    if (url.pathname === '/subtitles') {
      if (!fromPage) {
        res.writeHead(403);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(subtitles.snapshot(url.searchParams.get('key'), Number(url.searchParams.get('since')) || 0)));
      return;
    }
    const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const root = name.startsWith('/vendor/') && fs.existsSync(path.join(vendorRoot, name.slice(8))) ? vendorRoot : webRoot;
    const file = path.normalize(path.join(root, root === vendorRoot ? name.slice(8) : name));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    serveFile(file, res, name === '/index.html' ? { 'set-cookie': cookie + '; HttpOnly; SameSite=Strict; Path=/' } : null);
  };

  return new Promise((resolve, reject) => {
    const tryPort = i => {
      if (i >= PORTS.length) {
        reject(new Error('No free port for the interface'));
        return;
      }
      const server = http.createServer(handler(PORTS[i]));
      server.once('error', () => tryPort(i + 1));
      server.listen(PORTS[i], '127.0.0.1', () => resolve('http://127.0.0.1:' + PORTS[i] + '/'));
    };
    tryPort(0);
  });
}

module.exports = { startServer };
