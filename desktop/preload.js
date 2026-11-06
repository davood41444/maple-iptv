/* What the page may ask of the desktop app (window.DesktopHost). */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('DesktopHost', {
  os: process.platform, // 'win32' | 'darwin' | 'linux'
  osVersion: process.getSystemVersion(),
  arch: process.arch,
  appVersion: () => ipcRenderer.sendSync('version'),
  isFullScreen: () => ipcRenderer.sendSync('is-fullscreen'),
  setFullScreen: on => ipcRenderer.send('fullscreen', !!on),
  quit: () => ipcRenderer.send('quit'),

  // Downloads (desktop/downloads.js): state() and every change give
  // { folder, streaming, items: [{ id, status, received, size, speed, path, … }] }.
  downloads: {
    state: () => ipcRenderer.invoke('dl:state'),
    add: entry => ipcRenderer.invoke('dl:add', entry),
    pause: id => ipcRenderer.invoke('dl:pause', id),
    resume: id => ipcRenderer.invoke('dl:resume', id),
    remove: id => ipcRenderer.invoke('dl:remove', id),
    setStreaming: on => ipcRenderer.invoke('dl:streaming', !!on),
    show: id => ipcRenderer.invoke('dl:show', id || null),
    chooseFolder: () => ipcRenderer.invoke('dl:choose-folder'),
    onChange: fn => ipcRenderer.on('downloads', (event, state) => fn(state)),
  },
});
