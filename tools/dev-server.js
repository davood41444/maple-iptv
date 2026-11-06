/*
 * Development server: serves web/ at http://localhost:8080 so the TV interface
 * can be tried in a desktop browser (arrow keys, Enter, Backspace/Esc = Back,
 * PageUp/PageDown = channel up/down).
 *
 * Like the Android app, it provides /proxy?url=... so playlists and streams
 * from IPTV servers (which don't send CORS headers) can be loaded.
 *
 *   node tools/dev-server.js
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const demoXtream = require('./demo-xtream');
const subtitles = require('../desktop/subtitles');

const ROOT = path.join(__dirname, '..', 'web');
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.m3u': 'audio/x-mpegurl; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
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
      'access-control-allow-origin': '*',
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
    // Movies: read their subtitles on the way through, like the desktop app.
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

function serveFile(file, res) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/proxy') {
    if (url.searchParams.get('ua')) req.headers['user-agent'] = url.searchParams.get('ua');
    return proxy(url.searchParams.get('url'), req, res);
  }
  if (url.pathname === '/subtitles') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(subtitles.snapshot(url.searchParams.get('key'), Number(url.searchParams.get('since')) || 0)));
  }
  if (url.pathname === '/sample.m3u') return serveFile(path.join(__dirname, 'sample.m3u'), res);
  if (demoXtream(url, res)) return;
  const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }
  serveFile(file, res);
}).listen(PORT, '127.0.0.1', () => {
  console.log('Home IPTV dev server: http://localhost:' + PORT + '  (sample playlist: http://localhost:' + PORT + '/sample.m3u)');
});
