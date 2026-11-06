/*
 * Movie and episode downloads for the Windows/Mac app.
 *
 * One file at a time (IPTV accounts often allow a single connection), and none
 * while the page says something is streaming. A download writes to "<name>.part"
 * and continues it with a Range request after a pause, a lost connection or a
 * restart; finished, it is renamed. The list lives in <userData>/downloads.json.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const NOTIFY_MS = 500;
const RETRY_MS = 15000;

// Windows can't have these in file names; also no trailing dots or spaces.
function safeName(name) {
  const clean = String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return clean.slice(0, 120) || 'Download';
}

class Downloads {
  // dataDir: where downloads.json is kept; folder: default place for the files;
  // onChange(state) hears every change (at most every half second while downloading).
  constructor(dataDir, folder, onChange) {
    this.file = path.join(dataDir, 'downloads.json');
    this.onChange = onChange;
    this.active = null;
    this.streaming = false;
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) { /* first run */ }
    this.folder = saved.folder || folder;
    this.items = (saved.items || []).map(d => Object.assign(d, { status: d.status === 'downloading' ? 'queued' : d.status, speed: 0 }));
    setTimeout(() => this.pump(), 2000);
  }

  state() {
    return {
      folder: this.folder,
      streaming: this.streaming,
      items: this.items.map(d => {
        const copy = Object.assign({}, d);
        delete copy.url; // it holds the account's password
        return copy;
      }),
    };
  }

  save() {
    fs.writeFile(this.file, JSON.stringify({ folder: this.folder, items: this.items.map(d => Object.assign({}, d, { speed: undefined })) }), () => {});
  }

  changed() {
    this.save();
    this.onChange(this.state());
  }

  find(id) {
    return this.items.find(d => d.id === id) || null;
  }

  // entry: { id, url, ext, name, subfolder?, ua?, …anything the page wants back }
  add(entry) {
    if (!entry || !entry.id || !/^https?:\/\//i.test(entry.url || '')) return false;
    if (this.find(entry.id)) return false;
    const dir = path.join(this.folder, ...String(entry.subfolder || '').split('/').filter(Boolean).map(safeName));
    let target = path.join(dir, safeName(entry.name) + '.' + safeName(entry.ext || 'mp4'));
    for (let n = 2; fs.existsSync(target) || this.items.some(d => d.path === target); n++) {
      target = path.join(dir, safeName(entry.name) + ' (' + n + ').' + safeName(entry.ext || 'mp4'));
    }
    this.items.push(Object.assign({}, entry, { path: target, status: 'queued', received: 0, size: 0, speed: 0, addedAt: Date.now() }));
    this.changed();
    this.pump();
    return true;
  }

  pause(id) {
    const d = this.find(id);
    if (!d || d.status === 'done') return;
    d.status = 'paused';
    if (this.active === d) this.abort();
    this.changed();
  }

  resume(id) {
    const d = this.find(id);
    if (!d || d.status === 'done') return;
    d.status = 'queued';
    d.error = null;
    this.changed();
    this.pump();
  }

  remove(id) {
    const d = this.find(id);
    if (!d) return;
    if (this.active === d) this.abort();
    this.items = this.items.filter(x => x !== d);
    fs.rm(d.path + '.part', { force: true }, () => {});
    if (d.status === 'done') fs.rm(d.path, { force: true }, () => {});
    this.changed();
    this.pump();
  }

  // The page is playing a stream (the account's connection is in use).
  setStreaming(on) {
    if (this.streaming === !!on) return;
    this.streaming = !!on;
    if (on && this.active) {
      this.active.status = 'queued';
      this.abort();
    }
    this.changed();
    this.pump();
  }

  setFolder(folder) {
    this.folder = folder;
    this.changed();
  }

  // The finished file for an id, or null.
  filePath(id) {
    const d = this.find(id);
    return d && d.status === 'done' ? d.path : null;
  }

  abort() {
    if (this.controller) this.controller.abort();
  }

  pump() {
    if (this.active || this.streaming) return;
    const next = this.items.find(d => d.status === 'queued');
    if (next) this.run(next);
  }

  async run(d) {
    this.active = d;
    d.status = 'downloading';
    d.error = null;
    const controller = this.controller = new AbortController();
    const part = d.path + '.part';
    let timer = null;
    try {
      await fs.promises.mkdir(path.dirname(d.path), { recursive: true });
      let have = 0;
      try { have = (await fs.promises.stat(part)).size; } catch (e) { /* new */ }
      const headers = {};
      if (d.ua) headers['user-agent'] = d.ua;
      if (have) headers.range = 'bytes=' + have + '-';
      const res = await fetch(d.url, { signal: controller.signal, headers: headers });
      if (res.status === 200) have = 0; // the server ignored the Range: start over
      else if (res.status !== 206) throw new Error('HTTP ' + res.status);
      const length = Number(res.headers.get('content-length')) || 0;
      d.size = length ? have + length : 0;
      d.received = have;
      if (length && fs.promises.statfs) {
        const disk = await fs.promises.statfs(path.dirname(d.path));
        if (length > disk.bavail * disk.bsize) throw Object.assign(new Error('disk-full'), { code: 'disk-full' });
      }
      this.changed();

      // Speed over the last couple of seconds, and progress for the page.
      let windowStart = Date.now();
      let windowBytes = 0;
      const counter = new Transform({
        transform(chunk, encoding, done) {
          d.received += chunk.length;
          windowBytes += chunk.length;
          done(null, chunk);
        },
      });
      timer = setInterval(() => {
        const now = Date.now();
        if (now - windowStart >= 2000) {
          d.speed = Math.round(windowBytes * 1000 / (now - windowStart));
          windowStart = now;
          windowBytes = 0;
        }
        this.onChange(this.state());
      }, NOTIFY_MS);

      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part, { flags: have ? 'a' : 'w' }));
      await fs.promises.rename(part, d.path);
      d.status = 'done';
      d.size = d.received;
      d.doneAt = Date.now();
    } catch (e) {
      if (controller.signal.aborted) {
        // Paused, removed, or waiting for playback to end: status already set.
      } else {
        d.status = 'error';
        d.error = e.code === 'disk-full' ? 'disk-full' : String(e.cause ? e.cause.message : e.message);
        // A dropped connection is tried again by itself after a while.
        if (d.error !== 'disk-full' && !/^HTTP 4/.test(d.error)) {
          setTimeout(() => { if (d.status === 'error') this.resume(d.id); }, RETRY_MS);
        }
      }
    } finally {
      clearInterval(timer);
      d.speed = 0;
      this.active = null;
      this.controller = null;
      // Removed while downloading: its partial file can only go once it is closed.
      if (this.items.includes(d)) this.changed();
      else fs.rm(part, { force: true }, () => {});
      this.pump();
    }
  }
}

module.exports = { Downloads };
