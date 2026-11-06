/*
 * Assembles the Samsung (Tizen) web app in build/tizen: the shared web/
 * interface plus tizen/config.xml and the icon, with Samsung's TV API script
 * added to index.html.
 *
 *   node tools/build-tizen.js
 *
 * Then sign and install it with Tizen Studio's CLI (see README.md):
 *   tizen package -t wgt -s MapleIPTV -- build/tizen
 *   rename "build/tizen/Maple IPTV.wgt" to MapleIPTV.wgt (the TV's installer fails on the space)
 *   tizen install -n MapleIPTV.wgt -t UN50M70HAFXZC -- build/tizen
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'build', 'tizen');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'web'), OUT, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tizen', 'config.xml'), path.join(OUT, 'config.xml'));
fs.copyFileSync(path.join(ROOT, 'tizen', 'icon.png'), path.join(OUT, 'icon.png'));

// webapis.js provides AVPlay and other TV APIs; it only exists on the TV.
const indexPath = path.join(OUT, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const marker = '<script src="vendor/qrcode.js"></script>';
if (html.indexOf(marker) < 0) throw new Error('index.html changed: could not find ' + marker);
fs.writeFileSync(indexPath, html.replace(marker, '<script src="$WEBAPIS/webapis/webapis.js"></script>\n  ' + marker));

console.log('Tizen app assembled in ' + path.relative(ROOT, OUT));
