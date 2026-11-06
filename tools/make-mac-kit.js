/*
 * Packs everything needed to build the Mac app on a Mac into
 * dist/MapleIPTV-Mac-<version>.zip: the desktop/ app (without node_modules),
 * the shared web/ interface, "Build Maple IPTV.command" (marked executable, so
 * a double-click runs it) and the Persian instructions.
 *
 *   node tools/make-mac-kit.js
 *
 * The zip is written by hand because Windows' own zip tools can't mark a file
 * executable for macOS.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DESKTOP = path.join(ROOT, 'desktop');
const version = require(path.join(DESKTOP, 'package.json')).version;
const OUT = path.join(ROOT, 'dist', 'MapleIPTV-Mac-' + version + '.zip');
const TOP = 'MapleIPTV-Mac/';

// [path inside the zip, file on disk, executable?]
const files = [];
const add = (name, file, exec) => files.push([TOP + name, file, !!exec]);
const addTree = (name, dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) addTree(name + e.name + '/', full);
  else add(name + e.name, full);
});

['main.js', 'preload.js', 'server.js', 'subtitles.js', 'downloads.js', 'package.json', 'package-lock.json'].forEach(f => add('desktop/' + f, path.join(DESKTOP, f)));
add('desktop/build/icon.png', path.join(DESKTOP, 'build', 'icon.png'));
addTree('desktop/vendor/', path.join(DESKTOP, 'vendor'));
addTree('web/', path.join(ROOT, 'web'));
add('Build Maple IPTV.command', path.join(DESKTOP, 'build-mac.command'), true);
add('README - Install on Mac (Persian).txt', path.join(DESKTOP, 'MAC-README-fa.txt'));

function dosTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const chunks = [];
const central = [];
let offset = 0;
const now = dosTime(new Date());
files.forEach(([name, file, exec]) => {
  const data = fs.readFileSync(file);
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const stored = deflated.length >= data.length;
  const body = stored ? data : deflated;
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = zlib.crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6); // UTF-8 names
  header.writeUInt16LE(stored ? 0 : 8, 8);
  header.writeUInt16LE(now.time, 10);
  header.writeUInt16LE(now.date, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(body.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  chunks.push(header, nameBuf, body);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE((3 << 8) | 20, 4); // made on Unix, so the permissions below count
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(stored ? 0 : 8, 10);
  entry.writeUInt16LE(now.time, 12);
  entry.writeUInt16LE(now.date, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(body.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(nameBuf.length, 28);
  entry.writeUInt32LE(((exec ? 0o100755 : 0o100644) << 16) >>> 0, 38);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, nameBuf);
  offset += header.length + nameBuf.length + body.length;
});
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat(chunks.concat([centralBuf, end])));
console.log('Mac kit: ' + path.relative(ROOT, OUT) + ' (' + files.length + ' files, ' + Math.round(fs.statSync(OUT).size / 1024) + ' KB)');
