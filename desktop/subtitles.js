/*
 * Subtitles (and audio-track details) for movies played on computers.
 *
 * Chromium plays MKV and MP4 files but ignores the subtitle tracks inside them.
 * The local proxy (server.js) hands every movie response to tap(), which reads
 * the subtitles out of the data on its way to the player: no second request to
 * the IPTV server, which matters because many accounts allow one connection.
 * The page then asks for them with snapshot() (GET /subtitles?key=…).
 *
 *   MKV / WebM  S_TEXT/UTF8 (SRT), S_TEXT/ASS, S_TEXT/SSA, S_TEXT/WEBVTT,
 *               also zlib-compressed or header-stripped
 *   MP4 / MOV   tx3g (mov_text) and wvtt, in files with a moov index
 * Image subtitles (PGS, VobSub, DVB) are not read.
 *
 * Subtitles arrive as the player downloads ahead, so they are ready before
 * they are due; after a seek, the new range request brings the ones from there.
 */
'use strict';
const zlib = require('zlib');

const MAX_MEDIA = 4;               // movies remembered at once
const MAX_ELEMENT = 4 * 1024 * 1024; // larger "small" elements mean the parse went wrong
const MAX_MOOV = 64 * 1024 * 1024;
const OPEN_CUE_MS = 5000;          // a cue without a duration lasts until the next one, or this long

const stores = new Map();

// One movie's tracks and the cues found so far (from all its range requests).
class Media {
  constructor() {
    this.kind = null;        // 'mkv' | 'mp4'
    this.text = [];          // [{ id, language, label, codec, default, forced }]
    this.audio = [];         // [{ language, label, codec, channels, default }]
    this.cues = [];          // [{ seq, track, start, end, text }]
    this.seq = 0;
    this.seen = new Set();
    this.open = new Map();   // track → cue still waiting for its end
    this.mkv = null;         // { scale, tracks: Map(number → track) }
    this.mp4 = null;         // { boxes: Map(offset → size), samples: [...], moovAt }
  }

  addCue(track, start, end, text) {
    text = text.replace(/\r\n?/g, '\n').replace(/\0+$/, '').trim();
    const key = track + '|' + start + '|' + text;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const open = this.open.get(track);
    if (open && open.start < start && open.end > start) {
      open.end = start; // close the previous one at this one's start,
      open.seq = ++this.seq; // and send it again with that end
    }
    const cue = { seq: ++this.seq, track: track, start: Math.round(start), end: Math.round(end == null ? start + OPEN_CUE_MS : end), text: text };
    if (end == null) this.open.set(track, cue);
    else this.open.delete(track);
    if (text) this.cues.push(cue);
  }
}

function media(key) {
  let m = stores.get(key);
  if (m) {
    stores.delete(key); // most recent last
  } else {
    m = new Media();
    while (stores.size >= MAX_MEDIA) stores.delete(stores.keys().next().value);
  }
  stores.set(key, m);
  return m;
}

// What the page gets: the tracks and the cues after `since` (a cue's seq).
function snapshot(key, since) {
  const m = stores.get(key);
  if (!m) return { kind: null, text: [], audio: [], cues: [], last: 0 };
  // A cue changes after being sent only by getting an earlier end; it then has a new seq.
  return {
    kind: m.kind,
    text: m.text,
    audio: m.audio,
    cues: m.cues.filter(c => c.seq > (since || 0)).map(c => [c.seq, c.track, c.start, c.end, c.text]),
    last: m.seq,
  };
}

// ---- Matroska ----

const MKV_IDS = {
  EBML: 0x1a45dfa3, SEGMENT: 0x18538067, INFO: 0x1549a966, TIMECODE_SCALE: 0x2ad7b1,
  TRACKS: 0x1654ae6b, TRACK_ENTRY: 0xae, TRACK_NUMBER: 0xd7, TRACK_TYPE: 0x83, CODEC_ID: 0x86,
  CODEC_PRIVATE: 0x63a2, LANGUAGE: 0x22b59c, LANGUAGE_IETF: 0x22b59d, NAME: 0x536e,
  FLAG_DEFAULT: 0x88, FLAG_FORCED: 0x55aa, FLAG_ENABLED: 0xb9, DEFAULT_DURATION: 0x23e383,
  AUDIO: 0xe1, CHANNELS: 0x9f,
  CONTENT_ENCODINGS: 0x6d80, CONTENT_ENCODING: 0x6240, CONTENT_COMPRESSION: 0x5034,
  COMP_ALGO: 0x4254, COMP_SETTINGS: 0x4255,
  CLUSTER: 0x1f43b675, TIMECODE: 0xe7, SIMPLE_BLOCK: 0xa3, BLOCK_GROUP: 0xa0, BLOCK: 0xa1,
  BLOCK_DURATION: 0x9b,
};
const TEXT_CODECS = ['S_TEXT/UTF8', 'S_TEXT/ASCII', 'S_TEXT/ASS', 'S_TEXT/SSA', 'S_TEXT/WEBVTT'];

// An EBML variable-length number at buf[p]: { value, length }, or null if it doesn't fit yet.
// With keepMarker (element ids) the length marker bit stays in the value.
function vint(buf, p, keepMarker) {
  if (p >= buf.length) return null;
  const first = buf[p];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || p + length > buf.length) return length > 8 ? { value: -1, length: 1, bad: true } : null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = (first & (0xff >> length)) === (0xff >> length);
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[p + i];
    if (buf[p + i] !== 0xff) allOnes = false;
  }
  return { value: value, length: length, unknown: !keepMarker && allOnes };
}

// The children of a fully read element: [{ id, data }].
function children(buf) {
  const out = [];
  for (let p = 0; p < buf.length;) {
    const id = vint(buf, p, true);
    if (!id || id.bad) break;
    const size = vint(buf, p + id.length);
    if (!size || size.bad || size.unknown) break;
    const start = p + id.length + size.length;
    out.push({ id: id.value, data: buf.subarray(start, Math.min(start + size.value, buf.length)) });
    p = start + size.value;
  }
  return out;
}

const uint = data => data.reduce((v, b) => v * 256 + b, 0);
const str = data => data.toString('utf8').replace(/\0+$/, '');

function readMkvTracks(m, data) {
  const tracks = new Map();
  const text = [];
  const audio = [];
  for (const entry of children(data)) {
    if (entry.id !== MKV_IDS.TRACK_ENTRY) continue;
    const t = { language: 'eng', default: true, forced: false, enabled: true };
    for (const c of children(entry.data)) {
      switch (c.id) {
        case MKV_IDS.TRACK_NUMBER: t.number = uint(c.data); break;
        case MKV_IDS.TRACK_TYPE: t.type = uint(c.data); break;
        case MKV_IDS.CODEC_ID: t.codec = str(c.data); break;
        case MKV_IDS.LANGUAGE: if (!t.ietf) t.language = str(c.data); break;
        case MKV_IDS.LANGUAGE_IETF: t.language = str(c.data); t.ietf = true; break;
        case MKV_IDS.NAME: t.label = str(c.data); break;
        case MKV_IDS.FLAG_DEFAULT: t.default = !!uint(c.data); break;
        case MKV_IDS.FLAG_FORCED: t.forced = !!uint(c.data); break;
        case MKV_IDS.FLAG_ENABLED: t.enabled = !!uint(c.data); break;
        case MKV_IDS.DEFAULT_DURATION: t.defaultDuration = uint(c.data) / 1e6; break;
        case MKV_IDS.AUDIO:
          for (const a of children(c.data)) if (a.id === MKV_IDS.CHANNELS) t.channels = uint(a.data);
          break;
        case MKV_IDS.CONTENT_ENCODINGS:
          for (const enc of children(c.data)) {
            if (enc.id !== MKV_IDS.CONTENT_ENCODING) continue;
            for (const comp of children(enc.data)) {
              if (comp.id !== MKV_IDS.CONTENT_COMPRESSION) continue;
              t.compression = { algo: 0, settings: null };
              for (const k of children(comp.data)) {
                if (k.id === MKV_IDS.COMP_ALGO) t.compression.algo = uint(k.data);
                if (k.id === MKV_IDS.COMP_SETTINGS) t.compression.settings = Buffer.from(k.data);
              }
            }
          }
          break;
      }
    }
    if (t.number == null) continue;
    if (t.type === 0x11 && TEXT_CODECS.includes(t.codec) && t.enabled) {
      t.id = 'mkv' + t.number;
      tracks.set(t.number, t);
      text.push({ id: t.id, language: t.language, label: t.label || '', codec: t.codec, default: t.default, forced: t.forced });
    } else if (t.type === 2) {
      audio.push({ language: t.language, label: t.label || '', codec: t.codec, channels: t.channels || 0, default: t.default });
    }
  }
  m.kind = 'mkv';
  m.mkv = Object.assign(m.mkv || { scale: 1e6 }, { tracks: tracks });
  m.text = text;
  m.audio = audio;
}

function mkvCueText(track, data) {
  if (track.compression) {
    if (track.compression.algo === 0) data = zlib.inflateSync(data);
    else if (track.compression.algo === 3) data = Buffer.concat([track.compression.settings || Buffer.alloc(0), data]);
    else return null; // bzlib / lzo: not used for subtitles in practice
  }
  let text = data.toString('utf8');
  // ASS/SSA blocks: ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text
  if (/S_TEXT\/(ASS|SSA)/.test(track.codec)) {
    const parts = text.split(',');
    text = parts.length > 8 ? parts.slice(8).join(',') : parts[parts.length - 1];
  }
  return text;
}

/*
 * Reads a Matroska byte stream from any offset. From 0 it reads the header
 * (Info, Tracks) and then the clusters; from elsewhere it first finds the next
 * cluster. Segment, Cluster and BlockGroup are entered; everything else is
 * either read whole (small elements we need) or skipped by its size, so the
 * video and audio are never copied.
 */
class MkvParser {
  constructor(m, offset) {
    this.m = m;
    this.pos = offset;          // file offset of pending[0]
    this.pending = Buffer.alloc(0);
    this.skip = 0;
    this.sync = offset > 0;     // looking for a cluster
    this.clusterTime = null;
    this.group = null;          // { end, block } inside a BlockGroup
  }

  push(chunk) {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    for (;;) {
      if (this.skip) {
        const n = Math.min(this.skip, this.pending.length);
        this.consume(n);
        this.skip -= n;
        if (this.skip) return;
      }
      if (this.sync && !this.findCluster()) return;
      if (!this.element()) return;
    }
  }

  consume(n) {
    this.pending = this.pending.subarray(n);
    this.pos += n;
  }

  // Drops bytes up to the next cluster (checked by its timecode child). False if more data is needed.
  findCluster() {
    const buf = this.pending;
    for (let i = buf.indexOf(0x1f); i >= 0 && i + 4 <= buf.length; i = buf.indexOf(0x1f, i + 1)) {
      if (buf[i + 1] !== 0x43 || buf[i + 2] !== 0xb6 || buf[i + 3] !== 0x75) continue;
      const size = vint(buf, i + 4);
      if (!size) { this.consume(i); return false; }
      const child = vint(buf, i + 4 + size.length, true);
      if (!child) { this.consume(i); return false; }
      if (size.bad || child.value !== MKV_IDS.TIMECODE) continue;
      this.consume(i);
      this.sync = false;
      this.finishGroup();
      this.clusterTime = null;
      return true;
    }
    this.consume(Math.max(0, buf.length - 3));
    return false;
  }

  // Reads one element header and acts on it. False if more data is needed.
  element() {
    const buf = this.pending;
    const id = vint(buf, 0, true);
    if (!id) return false;
    const size = id.bad ? null : vint(buf, id.length);
    if (!id.bad && !size) return false;
    if (id.bad || size.bad) return this.lost();
    const head = id.length + size.length;
    const at = this.pos;
    if (this.group && at >= this.group.end) this.finishGroup();
    const I = MKV_IDS;

    // Containers we walk into.
    if (id.value === I.SEGMENT || id.value === I.CLUSTER) {
      if (id.value === I.CLUSTER) { this.finishGroup(); this.clusterTime = null; }
      this.consume(head);
      return true;
    }
    if (id.value === I.BLOCK_GROUP) {
      if (size.unknown) return this.lost();
      this.finishGroup();
      this.group = { end: at + head + size.value, block: null, duration: null };
      this.consume(head);
      return true;
    }
    if (size.unknown) return this.lost(); // only the containers above may have an unknown size

    // Blocks: look at the track number first, keep only subtitle blocks.
    if (id.value === I.SIMPLE_BLOCK || id.value === I.BLOCK) {
      const track = vint(buf, head);
      if (!track) return false;
      const t = this.m.mkv && this.m.mkv.tracks.get(track.value);
      if (!t || this.clusterTime == null || size.value > MAX_ELEMENT) {
        this.consume(head);
        this.skip = size.value;
        return true;
      }
      if (buf.length < head + size.value) return false;
      this.block(t, id.value === I.BLOCK, buf.subarray(head + track.length, head + size.value));
      this.consume(head + size.value);
      return true;
    }

    if (![I.INFO, I.TRACKS, I.TIMECODE, I.BLOCK_DURATION].includes(id.value)) {
      this.consume(head);
      this.skip = size.value;
      return true;
    }
    if (size.value > MAX_ELEMENT) return this.lost();
    if (buf.length < head + size.value) return false;
    const data = buf.subarray(head, head + size.value);
    if (id.value === I.INFO) {
      for (const c of children(data)) if (c.id === I.TIMECODE_SCALE) this.m.mkv = Object.assign(this.m.mkv || { tracks: new Map() }, { scale: uint(c.data) });
    } else if (id.value === I.TRACKS) {
      readMkvTracks(this.m, data);
    } else if (id.value === I.TIMECODE) {
      this.clusterTime = uint(data);
    } else if (id.value === I.BLOCK_DURATION && this.group) {
      this.group.duration = uint(data);
    }
    this.consume(head + size.value);
    return true;
  }

  // A block's payload after the track number: int16 time, flags, data.
  block(track, inGroup, data) {
    if (data.length < 3 || (data[2] & 0x06)) return; // laced subtitles: not used in practice
    const scale = (this.m.mkv && this.m.mkv.scale || 1e6) / 1e6;
    const start = (this.clusterTime + data.readInt16BE(0)) * scale;
    const cue = { track: track, start: start, payload: Buffer.from(data.subarray(3)) };
    if (inGroup && this.group) {
      this.group.block = cue;
      this.group.scale = scale;
    } else {
      this.emit(cue, track.defaultDuration != null ? start + track.defaultDuration : null);
    }
  }

  finishGroup() {
    const g = this.group;
    this.group = null;
    if (!g || !g.block) return;
    const b = g.block;
    this.emit(b, g.duration != null ? b.start + g.duration * g.scale : (b.track.defaultDuration != null ? b.start + b.track.defaultDuration : null));
  }

  emit(cue, end) {
    let text;
    try { text = mkvCueText(cue.track, cue.payload); } catch (e) { return; }
    if (text != null) this.m.addCue(cue.track.id, cue.start, end, text);
  }

  // Something didn't parse: look for the next cluster.
  lost() {
    this.finishGroup();
    this.consume(1);
    this.sync = true;
    return true;
  }
}

// ---- MP4 / MOV ----

function boxes(buf, start, end, fn) {
  for (let p = start; p + 8 <= end;) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let head = 8;
    if (size === 1) {
      if (p + 16 > end) return;
      size = Number(buf.readBigUInt64BE(p + 8));
      head = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < head) return;
    fn(type, p + head, Math.min(p + size, end));
    p += size;
  }
}

function child(buf, start, end, path) {
  let found = null;
  boxes(buf, start, end, (type, s, e) => {
    if (found || type !== path[0]) return;
    found = path.length === 1 ? [s, e] : child(buf, s, e, path.slice(1));
  });
  return found;
}

const MP4_TEXT = ['tx3g', 'wvtt', 'text'];
const MP4_LANGUAGE = buf => {
  const l = buf.readUInt16BE(0);
  return l ? String.fromCharCode(((l >> 10) & 31) + 96, ((l >> 5) & 31) + 96, (l & 31) + 96) : 'und';
};

// The tracks and, for subtitle tracks, where each sample is and when it shows.
function readMoov(m, moov) {
  const text = [];
  const audio = [];
  const samples = [];
  const mvhd = child(moov, 0, moov.length, ['mvhd']);
  const movieScale = mvhd ? moov.readUInt32BE(mvhd[0] + (moov[mvhd[0]] === 1 ? 20 : 12)) : 1000;
  boxes(moov, 0, moov.length, (type, s, e) => {
    if (type !== 'trak') return;
    const hdlr = child(moov, s, e, ['mdia', 'hdlr']);
    const mdhd = child(moov, s, e, ['mdia', 'mdhd']);
    const stbl = child(moov, s, e, ['mdia', 'minf', 'stbl']);
    const tkhd = child(moov, s, e, ['tkhd']);
    if (!hdlr || !mdhd || !stbl) return;
    const handler = moov.toString('latin1', hdlr[0] + 8, hdlr[0] + 12);
    const v1 = moov[mdhd[0]] === 1;
    const timescale = moov.readUInt32BE(mdhd[0] + (v1 ? 20 : 12)) || 1000;
    const language = MP4_LANGUAGE(moov.subarray(mdhd[0] + (v1 ? 32 : 20)));
    const trackId = tkhd ? moov.readUInt32BE(tkhd[0] + (moov[tkhd[0]] === 1 ? 20 : 12)) : text.length + 1;
    const name = (moov.toString('utf8', hdlr[0] + 24, hdlr[1]).replace(/\0[\s\S]*$/, '') || '').trim();
    const stsd = child(moov, stbl[0], stbl[1], ['stsd']);
    if (!stsd) return;
    const entry = stsd[0] + 8; // after version/flags and entry count
    const format = moov.toString('latin1', entry + 4, entry + 8);
    const flags = tkhd ? moov.readUInt32BE(tkhd[0]) & 0xffffff : 3;
    if (handler === 'soun') {
      audio.push({ language: language, label: /handler|sound|audio/i.test(name) ? '' : name, codec: format, channels: moov.readUInt16BE(entry + 8 + 16), default: !!(flags & 1) });
      return;
    }
    if (!['sbtl', 'text', 'subt'].includes(handler) || !MP4_TEXT.includes(format)) return;
    const id = 'mp4' + trackId;
    text.push({ id: id, language: language, label: /handler|subtitle|text/i.test(name) ? '' : name, codec: format, default: !!(flags & 1), forced: false });

    // Edit list: an empty edit delays the track; a media time skips into it.
    let shiftMs = 0;
    const elst = child(moov, s, e, ['edts', 'elst']);
    if (elst) {
      const v = moov[elst[0]];
      const count = moov.readUInt32BE(elst[0] + 4);
      for (let i = 0, p = elst[0] + 8; i < count; i++) {
        const duration = v === 1 ? Number(moov.readBigUInt64BE(p)) : moov.readUInt32BE(p);
        const mediaTime = v === 1 ? Number(moov.readBigInt64BE(p + 8)) : moov.readInt32BE(p + 4);
        p += v === 1 ? 20 : 12;
        if (mediaTime === -1) { shiftMs += duration / movieScale * 1000; continue; }
        shiftMs -= mediaTime / timescale * 1000;
        break;
      }
    }

    // Sample table: times (stts), sizes (stsz), chunks (stsc + stco/co64).
    const box = name4 => child(moov, stbl[0], stbl[1], [name4]);
    const stts = box('stts');
    const stsz = box('stsz');
    const stsc = box('stsc');
    const stco = box('stco') || box('co64');
    const co64 = !box('stco');
    if (!stts || !stsz || !stsc || !stco) return;
    const times = [];
    let t = 0;
    for (let i = 0, n = moov.readUInt32BE(stts[0] + 4), p = stts[0] + 8; i < n; i++, p += 8) {
      const count = moov.readUInt32BE(p);
      const delta = moov.readUInt32BE(p + 4);
      for (let k = 0; k < count; k++) { times.push([t, t + delta]); t += delta; }
    }
    const fixed = moov.readUInt32BE(stsz[0] + 4);
    const count = moov.readUInt32BE(stsz[0] + 8);
    const sizes = [];
    for (let i = 0; i < count; i++) sizes.push(fixed || moov.readUInt32BE(stsz[0] + 12 + i * 4));
    const chunkCount = moov.readUInt32BE(stco[0] + 4);
    const chunks = [];
    for (let i = 0; i < chunkCount; i++) chunks.push(co64 ? Number(moov.readBigUInt64BE(stco[0] + 8 + i * 8)) : moov.readUInt32BE(stco[0] + 8 + i * 4));
    const runs = [];
    for (let i = 0, n = moov.readUInt32BE(stsc[0] + 4), p = stsc[0] + 8; i < n; i++, p += 12) runs.push([moov.readUInt32BE(p), moov.readUInt32BE(p + 4)]);
    let sample = 0;
    for (let r = 0; r < runs.length; r++) {
      const firstChunk = runs[r][0] - 1;
      const lastChunk = r + 1 < runs.length ? runs[r + 1][0] - 1 : chunks.length;
      for (let c = firstChunk; c < lastChunk && c < chunks.length; c++) {
        let offset = chunks[c];
        for (let k = 0; k < runs[r][1] && sample < sizes.length; k++, sample++) {
          const [a, b] = times[sample] || [0, 0];
          if (sizes[sample] > 2) {
            samples.push({ track: id, format: format, offset: offset, size: sizes[sample], start: a / timescale * 1000 + shiftMs, end: b / timescale * 1000 + shiftMs });
          }
          offset += sizes[sample];
        }
      }
    }
  });
  samples.sort((a, b) => a.offset - b.offset);
  m.kind = 'mp4';
  m.text = text;
  m.audio = audio;
  m.mp4.samples = samples;
}

function mp4CueText(format, data) {
  if (format === 'wvtt') {
    const parts = [];
    boxes(data, 0, data.length, (type, s, e) => {
      if (type === 'vttc') boxes(data, s, e, (t2, s2, e2) => { if (t2 === 'payl') parts.push(data.toString('utf8', s2, e2)); });
    });
    return parts.join('\n');
  }
  // tx3g / QuickTime text: 16-bit length, then UTF-8 (or UTF-16 with a byte-order mark).
  const length = data.readUInt16BE(0);
  const body = data.subarray(2, 2 + length);
  if (body[0] === 0xfe && body[1] === 0xff) return Buffer.from(body.subarray(2)).swap16().toString('utf16le');
  return body.toString('utf8');
}

/*
 * Reads an MP4 byte stream from any offset. Top-level boxes are followed from
 * 0 (and from any offset where one is known to start); the moov index is read
 * whole; subtitle samples are picked out of the data by their file offsets,
 * whichever request carries them.
 */
class Mp4Parser {
  constructor(m, offset) {
    this.m = m;
    if (!m.mp4) m.mp4 = { boxes: new Map(), samples: null };
    this.pos = offset;
    // Where the next top-level box starts: 0, or the first one known (from an earlier
    // request) at or after this offset; the player's ranges rarely start on a box.
    this.next = offset === 0 ? 0 : null;
    for (const [at, size] of m.mp4.boxes) {
      for (const p of [at, at + size]) if (p >= offset && (this.next == null || p < this.next)) this.next = p;
    }
    this.headBytes = null;    // a box header cut by the end of a chunk
    this.moov = null;         // { at, size, parts, have }
    this.partial = new Map(); // sample → collected bytes
  }

  push(chunk) {
    const start = this.pos;
    const end = start + chunk.length;
    this.pos = end;
    this.boxes(chunk, start, end);
    this.samples(chunk, start, end);
  }

  boxes(chunk, start, end) {
    const known = this.m.mp4.boxes;
    if (this.moov) this.collectMoov(chunk, start, end);
    while (this.next != null && this.next < end) {
      const carried = this.headBytes;
      let header;
      if (carried) header = Buffer.concat([carried, chunk.subarray(0, 16)]);
      else if (this.next >= start) header = chunk.subarray(this.next - start, this.next - start + 16);
      else { this.next = null; return; }
      if (header.length < 8 || (header.readUInt32BE(0) === 1 && header.length < 16)) {
        this.headBytes = header; // finish it with the next chunk
        return;
      }
      this.headBytes = null;
      let size = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      if (size === 1) size = Number(header.readBigUInt64BE(8));
      if (!/^[a-z0-9 ©]{4}$/i.test(type) || size < 8) { this.next = null; return; }
      known.set(this.next, size);
      if (type === 'moov' && size <= MAX_MOOV && !this.m.mp4.samples) {
        this.moov = { at: this.next, size: size, parts: carried ? [carried] : [], have: carried ? carried.length : 0 };
        this.collectMoov(chunk, start, end);
      }
      this.next += size;
    }
  }

  collectMoov(chunk, start, end) {
    const mv = this.moov;
    const from = Math.max(start, mv.at + mv.have);
    const to = Math.min(end, mv.at + mv.size);
    if (from >= to || from !== mv.at + mv.have) return;
    mv.parts.push(chunk.subarray(from - start, to - start));
    mv.have += to - from;
    if (mv.have < mv.size) return;
    this.moov = null;
    const moov = Buffer.concat(mv.parts);
    try {
      readMoov(this.m, moov.subarray(moov.readUInt32BE(0) === 1 ? 16 : 8));
    } catch (e) { /* not a moov we can read */ }
  }

  samples(chunk, start, end) {
    const list = this.m.mp4.samples;
    if (!list || !list.length) return;
    // First sample ending after `start` (binary search on offsets).
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].offset + list[mid].size <= start) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < list.length && list[i].offset < end; i++) {
      const s = list[i];
      const from = Math.max(start, s.offset);
      const to = Math.min(end, s.offset + s.size);
      let got = this.partial.get(s);
      if (!got) {
        if (from !== s.offset) continue; // its start went by in another request
        got = [];
        this.partial.set(s, got);
      }
      got.push(chunk.subarray(from - start, to - start));
      if (to < s.offset + s.size) continue;
      this.partial.delete(s);
      try {
        const text = mp4CueText(s.format, Buffer.concat(got));
        if (text) this.m.addCue(s.track, s.start, s.end, text);
      } catch (e) { /* damaged sample */ }
    }
  }
}

// ---- Entry point for the proxy ----

/*
 * Returns a function to call with each chunk of a movie response (key: the
 * movie's address as the page knows it; offset: where the response starts in
 * the file), or null when there is nothing to read. Never throws into the
 * response: a parsing problem only stops the subtitles.
 */
function tap(key, offset) {
  let parser = null;
  let off = false;
  return chunk => {
    if (off) return;
    try {
      if (!parser) {
        const m = media(key);
        if (offset === 0 && chunk.length >= 8 && chunk.readUInt32BE(0) === MKV_IDS.EBML) parser = new MkvParser(m, 0);
        else if (offset === 0 && chunk.length >= 8 && /^(ftyp|moov|free|mdat|wide|skip)$/.test(chunk.toString('latin1', 4, 8))) parser = new Mp4Parser(m, 0);
        else if (m.kind === 'mkv') parser = new MkvParser(m, offset);
        else if (m.kind === 'mp4' || m.mp4) parser = new Mp4Parser(m, offset);
        else { off = true; return; }
      }
      parser.push(chunk);
    } catch (e) {
      off = true;
    }
  };
}

// Movie addresses worth reading (not playlists, segments or live streams).
function isMovie(url, contentType) {
  if (/\.(mkv|mk3d|webm|mp4|m4v|mov)(\?|#|$)/i.test(url)) return true;
  return /^video\/(x-matroska|webm|mp4|quicktime)/i.test(contentType || '');
}

// The start offset of a response from its Content-Range header (0 for a whole file).
function rangeStart(contentRange) {
  const m = /^bytes (\d+)-/.exec(contentRange || '');
  return m ? Number(m[1]) : 0;
}

module.exports = { tap, snapshot, isMovie, rangeStart };
