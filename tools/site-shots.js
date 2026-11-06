/*
 * Takes the website's app screenshots (site/public/maple-iptv/assets/shots/*.jpg)
 * with the demo playlist's made-up names, at TV size (1920x1080):
 *
 *   desktop\node_modules\electron\dist\electron.exe tools/site-shots.js
 */
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

process.env.DEMO_SHOWCASE = '1';
process.env.PORT = '8090';
require('./dev-server'); // serves web/ and the demo playlist

const BASE = 'http://localhost:8090/';
const OUT = path.join(__dirname, '..', 'site', 'public', 'maple-iptv', 'assets', 'shots');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, webPreferences: { offscreen: true, partition: 'shots' } }); // in memory: no cached playlist
  const page = win.webContents;
  page.setFrameRate(30);
  page.on('console-message', e => { if (e.level === 'warning' || e.level === 'error') console.log('page:', e.message); });
  const run = js => page.executeJavaScript(js);
  const key = async (code, name) => {
    await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${name}', keyCode: ${code}, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: '${name}', keyCode: ${code}, bubbles: true }));`);
    await wait(400);
  };
  const shot = async name => {
    const image = await page.capturePage();
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, name + '.jpg'), image.resize({ width: 1600 }).toJPEG(84));
    console.log('saved', name);
  };

  await page.loadURL(BASE);
  await run(`localStorage.clear();
    localStorage.setItem('homeiptv.sources', JSON.stringify([{ id: 'demo', type: 'xtream', name: 'Maple Demo', format: 'hls',
      server: '${BASE}demo', username: 'demo', password: 'demo' }]));
    localStorage.setItem('homeiptv.settings', JSON.stringify({ activeSource: 'demo', resumeLast: false, lang: 'en' }));`);
  await page.loadURL(BASE);
  await wait(7000);
  await shot('home');

  await run(`App.router.go('live')`);
  await wait(3000);
  await key(40, 'ArrowDown');
  await key(40, 'ArrowDown');
  await key(13, 'Enter'); // preview
  await wait(10000);
  await shot('live');

  await run(`App.router.go('library', { kind: 'movies', fresh: true })`);
  await wait(6000);
  await shot('movies');

  await key(13, 'Enter'); // the focused poster → details
  await wait(5000);
  await key(13, 'Enter'); // Play (the demo clip is 10 seconds long)
  await wait(4000);
  await key(13, 'Enter'); // pause: the controls stay up
  await wait(800);
  await shot('player');
  app.quit();
}).catch(e => {
  console.error(e);
  app.exit(1);
});
