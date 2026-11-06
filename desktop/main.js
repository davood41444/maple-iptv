/*
 * Maple IPTV for Windows, Mac and Linux: the shared web/ interface in an Electron
 * window, served by server.js. The page talks to this side through preload.js
 * (window.DesktopHost).
 *
 *   npm start                      run from the source tree
 *   MAPLE_USER_DATA=<dir> npm start   with separate saved data (for testing)
 *   MAPLE_DOWNLOADS=<dir>             and a separate default download folder
 *   MAPLE_TEST_VERSION=1.0.0          report an older version (to test in-app updates, see updater.js)
 */
'use strict';
const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./server');
const { Downloads } = require('./downloads');
const updater = require('./updater');

const WEB_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web');
const VENDOR_ROOT = path.join(__dirname, 'vendor');

if (process.env.MAPLE_USER_DATA) app.setPath('userData', process.env.MAPLE_USER_DATA);
// video.audioTracks, so a movie's other audio languages can be chosen (web/js/player.js).
app.commandLine.appendSwitch('enable-blink-features', 'AudioVideoTracks');

let win = null;

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function createWindow(address) {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    show: false,
    title: 'Maple IPTV',
    backgroundColor: '#0b0f17',
    icon: path.join(__dirname, 'build', 'icon.png'),
    // No title bar: the interface runs to the top, with the system's window
    // buttons drawn over its top corner (the page leaves room for them).
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: '#0b0f17', symbolColor: '#c9d2e3', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  // F11 or Alt+Enter: full screen. Every other key belongs to the interface.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  // Links (trailers) open in the normal browser; the window stays on the interface.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(address)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  win.on('closed', () => { win = null; });
  win.loadURL(address);
}

ipcMain.on('version', event => { event.returnValue = process.env.MAPLE_TEST_VERSION || app.getVersion(); });
ipcMain.on('is-fullscreen', event => { event.returnValue = !!win && win.isFullScreen(); });
ipcMain.on('fullscreen', (event, on) => { if (win) win.setFullScreen(!!on); });
ipcMain.on('quit', () => app.quit());

ipcMain.on('update:kind', event => { event.returnValue = updater.kind(); });
ipcMain.handle('update:download', (event, url, sha256) =>
  updater.download(url, sha256, percent => event.sender.send('update:progress', percent)));
ipcMain.handle('update:install', () => updater.install());
ipcMain.handle('update:open', (event, url) => updater.open(url));

// Downloads (downloads.js); finished files are served to the page as /downloads/<id>.<ext>.
let downloads = null;
function setUpDownloads() {
  const folder = process.env.MAPLE_DOWNLOADS || path.join(app.getPath('downloads'), 'Maple IPTV');
  downloads = new Downloads(app.getPath('userData'), folder, state => {
    if (win) win.webContents.send('downloads', state);
  });
  ipcMain.handle('dl:state', () => downloads.state());
  ipcMain.handle('dl:add', (event, entry) => downloads.add(entry));
  ipcMain.handle('dl:pause', (event, id) => downloads.pause(id));
  ipcMain.handle('dl:resume', (event, id) => downloads.resume(id));
  ipcMain.handle('dl:remove', (event, id) => downloads.remove(id));
  ipcMain.handle('dl:streaming', (event, on) => downloads.setStreaming(on));
  ipcMain.handle('dl:show', (event, id) => {
    const file = id && downloads.filePath(id);
    if (file) shell.showItemInFolder(file);
    else fs.mkdir(downloads.folder, { recursive: true }, () => shell.openPath(downloads.folder));
  });
  ipcMain.handle('dl:choose-folder', async () => {
    const result = await dialog.showOpenDialog(win, { defaultPath: downloads.folder, properties: ['openDirectory', 'createDirectory'] });
    if (!result.canceled && result.filePaths[0]) downloads.setFolder(result.filePaths[0]);
    return downloads.folder;
  });
}

// One window: opening the app again brings the running one forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(async () => {
    // The interface needs no camera, microphone, notifications…
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
    setUpDownloads();
    createWindow(await startServer(WEB_ROOT, VENDOR_ROOT, id => downloads.filePath(id)));
  });
  app.on('window-all-closed', () => app.quit());
}
