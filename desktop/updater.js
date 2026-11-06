/*
 * In-app updates for the desktop app. web/js/update.js decides when and asks the user;
 * this module downloads the release file (checking its SHA-256) and installs it:
 *   Windows         the installer runs quietly (/S) and starts the new version (--force-run)
 *   Linux AppImage  the new AppImage replaces this one, and the app restarts
 *   Linux .deb      installing needs the system, so the browser downloads the new .deb
 *   Mac             the .dmg opens in Finder and the app quits, so the new one can replace it
 *
 * For testing from source: MAPLE_UPDATE_TEST=windows|mac|appimage|deb pretends to be that
 * install, and MAPLE_UPDATE_DRYRUN=1 downloads and checks but only logs the install step.
 */
'use strict';
const { app, net, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Release files come only from the project's GitHub releases.
const RELEASES = 'https://github.com/davood41444/maple-iptv/releases/';

let downloaded = null;

function kind() {
  if (process.env.MAPLE_UPDATE_TEST) return process.env.MAPLE_UPDATE_TEST;
  if (!app.isPackaged) return null; // running from source
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'linux') return process.env.APPIMAGE ? 'appimage' : 'deb';
  return null;
}

function folder() {
  switch (kind()) {
    case 'mac': return app.getPath('downloads'); // the .dmg stays where the user finds it
    case 'appimage': return path.dirname(process.env.APPIMAGE || app.getPath('temp')); // same disk, for the swap
    default: return path.join(app.getPath('temp'), 'maple-iptv-update');
  }
}

async function download(url, sha256, onProgress) {
  if (!String(url).startsWith(RELEASES)) throw new Error('Not a Maple IPTV release file: ' + url);
  const dir = folder();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, decodeURIComponent(new URL(url).pathname.split('/').pop()));
  const part = file + '.part';
  const response = await net.fetch(url);
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const total = Number(response.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(part);
  let received = 0;
  let lastPercent = -1;
  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
      const percent = total ? Math.floor(received * 100 / total) : 0;
      if (percent !== lastPercent) onProgress(lastPercent = percent);
    }
    await new Promise((resolve, reject) => out.end(error => (error ? reject(error) : resolve())));
  } catch (e) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw e;
  }
  const actual = hash.digest('hex');
  if (sha256 && actual !== String(sha256).toLowerCase()) {
    fs.rmSync(part, { force: true });
    throw new Error('The download is damaged (SHA-256 mismatch)');
  }
  fs.renameSync(part, file);
  downloaded = file;
  return { file: file, sha256: actual, size: received };
}

async function install() {
  if (!downloaded) throw new Error('Nothing downloaded');
  const k = kind();
  if (process.env.MAPLE_UPDATE_DRYRUN) {
    console.log('[update] dry run: would install', k, downloaded);
    return;
  }
  if (k === 'windows') {
    spawn(downloaded, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
    setTimeout(() => app.exit(0), 5000); // the installer waits for the app to close
  } else if (k === 'appimage') {
    const target = process.env.APPIMAGE;
    fs.chmodSync(downloaded, 0o755);
    fs.renameSync(downloaded, target);
    app.relaunch({ execPath: target, args: [] });
    app.exit(0);
  } else if (k === 'mac') {
    await shell.openPath(downloaded);
    app.quit();
  } else {
    throw new Error('No install step for ' + k);
  }
}

function open(url) {
  if (String(url).startsWith(RELEASES)) shell.openExternal(url);
}

module.exports = { kind, download, install, open };
