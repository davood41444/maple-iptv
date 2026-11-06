/*
 * Turns remote/keyboard input into key names: Up Down Left Right Enter Back,
 * Digit0-9, ChannelUp ChannelDown, PlayPause Play Pause Stop, Info Guide Menu,
 * Red Green Yellow Blue, LastChannel, PageUp PageDown, and Done/Cancel from the
 * Tizen on-screen keyboard.
 */
(function () {
  'use strict';
  const App = window.App;

  const CODES = {
    37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down', 13: 'Enter',
    27: 'Back', 8: 'Back', 10009: 'Back',
    33: 'PageUp', 34: 'PageDown',
    427: 'ChannelUp', 428: 'ChannelDown',
    10252: 'PlayPause', 415: 'Play', 19: 'Pause', 413: 'Stop',
    457: 'Info', 403: 'Red', 404: 'Green', 405: 'Yellow', 406: 'Blue',
    65376: 'Done', 65385: 'Cancel',
    // Computer keyboards (the Windows/Mac app): Space, M, F, + and −.
    32: 'Space', 77: 'KeyM', 70: 'KeyF', 187: 'Plus', 107: 'Plus', 189: 'Minus', 109: 'Minus',
  };
  for (let d = 0; d <= 9; d++) {
    CODES[48 + d] = 'Digit' + d;
    CODES[96 + d] = 'Digit' + d;
  }

  // Tizen only delivers these remote keys to apps that register them.
  const TIZEN_KEYS = {
    ChannelUp: 'ChannelUp', ChannelDown: 'ChannelDown', PreviousChannel: 'LastChannel',
    MediaPlayPause: 'PlayPause', MediaPlay: 'Play', MediaPause: 'Pause', MediaStop: 'Stop',
    Info: 'Info', Guide: 'Guide',
    ColorF0Red: 'Red', ColorF1Green: 'Green', ColorF2Yellow: 'Yellow', ColorF3Blue: 'Blue',
  };

  function registerTizenKeys() {
    const names = Object.keys(TIZEN_KEYS).concat(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    names.forEach(name => {
      try {
        tizen.tvinputdevice.registerKey(name);
        const key = tizen.tvinputdevice.getKey(name);
        if (key && TIZEN_KEYS[name]) CODES[key.code] = TIZEN_KEYS[name];
      } catch (e) {
        // Not every model has every key.
      }
    });
  }

  function isEditable(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  let handler = null;
  // Keys that are down. Android's WebView doesn't mark a held key's repeats,
  // so another keydown before the keyup counts as a repeat.
  const held = {};

  function onKeyDown(e) {
    const name = CODES[e.keyCode];
    if (!name) return;
    const repeat = e.repeat || !!held[e.keyCode];
    held[e.keyCode] = true;
    const editing = isEditable(document.activeElement);
    // While typing, characters, Backspace and the caret keys belong to the field.
    if (editing && (/^Digit/.test(name) || name === 'Left' || name === 'Right' || e.keyCode === 8)) return;
    if (handler(name, { repeat: repeat, editing: editing }) !== false) e.preventDefault();
  }

  // OK coming back up, for cards that tell a short press from holding OK.
  function onKeyUp(e) {
    delete held[e.keyCode];
    if (CODES[e.keyCode] === 'Enter' && !isEditable(document.activeElement)) handler('EnterUp', { repeat: false, editing: false });
  }

  App.keys = {
    init(fn) {
      handler = fn;
      if (App.platform === 'tizen') registerTizenKeys();
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);
      // A keyup missed while the app was in the background must not leave a key "held".
      const release = () => Object.keys(held).forEach(code => delete held[code]);
      window.addEventListener('blur', release);
      document.addEventListener('visibilitychange', release);
    },
    // On-screen buttons that stand in for a remote key (the touch Back button).
    press(name) {
      handler(name, { repeat: false, editing: false });
    },
  };

  // Events from the Android host (MainActivity.sendToPage): remote keys the
  // WebView doesn't deliver itself, and ExoPlayer state.
  App.native = { onPlayer: null };
  window.__nativeEvent = function (event) {
    if (event.type === 'key') {
      handler(event.key, { repeat: !!event.repeat, editing: isEditable(document.activeElement) });
    } else if (event.type === 'player' && App.native.onPlayer) {
      App.native.onPlayer(event);
    } else if (event.type === 'phone') {
      App.events.emit('phone', event.data);
    } else if (event.type === 'billing') {
      App.events.emit('billing', event);
    }
  };
})();
