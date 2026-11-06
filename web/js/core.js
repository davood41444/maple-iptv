/*
 * Shared helpers. The app is plain scripts (no build step) so the same files
 * run in the Android WebView, as a Samsung Tizen web app, in the Windows/Mac
 * app (desktop/), and in a desktop browser. Every script attaches what it
 * defines to the global App object.
 */
(function () {
  'use strict';
  const App = window.App = window.App || {};

  App.platform = window.AndroidHost ? 'android' : window.tizen ? 'tizen' : window.DesktopHost ? 'desktop' : 'browser';
  document.documentElement.classList.add('platform-' + App.platform);
  // The iPhone/iPad app provides the Android bridge too (ios/MapleIPTV/HostScript.swift);
  // this marks where Apple's rules differ (purchases through the App Store only).
  App.ios = !!window.MapleIos;

  // Tiny event bus: App.events.on('lang', fn); App.events.emit('lang', 'fa')
  const handlers = {};
  App.events = {
    on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    emit(name, data) { (handlers[name] || []).forEach(fn => fn(data)); },
  };

  // Build a DOM element: h('button', { class: 'btn', onclick: fn }, ['Label'])
  App.h = function (tag, attrs, children) {
    const el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(key => {
      const value = attrs[key];
      if (value == null || value === false) return;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'html') el.innerHTML = value;
      else if (key.slice(0, 2) === 'on') el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? '' : value);
    });
    (children || []).forEach(child => {
      if (child != null) el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return el;
  };

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  App.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);

  let numberFormat = null;
  App.fmtNum = function (n) {
    if (!numberFormat || numberFormat.lang !== App.i18n.lang) {
      numberFormat = new Intl.NumberFormat(App.i18n.lang);
      numberFormat.lang = App.i18n.lang;
    }
    return numberFormat.format(n);
  };

  // Show a string of digits in the current language's numerals (keeps leading zeros),
  // e.g. Persian ۰-۹ or Arabic ٠-٩, matching App.fmtNum.
  const digitSets = {};
  App.localDigits = function (s) {
    const lang = App.i18n.lang;
    if (!(lang in digitSets)) {
      const format = new Intl.NumberFormat(lang, { useGrouping: false });
      const digits = '0123456789'.split('').map(d => format.format(Number(d)));
      digitSets[lang] = digits.join('') === '0123456789' ? null : digits;
    }
    const digits = digitSets[lang];
    return digits ? String(s).replace(/[0-9]/g, d => digits[d]) : s;
  };

  App.fmtTime = date => date.toLocaleTimeString(App.i18n.lang, { hour: '2-digit', minute: '2-digit' });
  App.fmtDate = ms => new Date(ms).toLocaleDateString(App.i18n.lang, { year: 'numeric', month: 'short', day: 'numeric' });

  // "5 minutes ago", "yesterday", "3 days ago" in the interface language.
  App.fmtAgo = function (ms) {
    if (typeof Intl.RelativeTimeFormat !== 'function') return App.fmtDate(ms) + ' ' + App.fmtTime(new Date(ms));
    const format = new Intl.RelativeTimeFormat(App.i18n.lang, { numeric: 'auto' });
    const minutes = Math.max(1, Math.round((Date.now() - ms) / 60000));
    if (minutes < 60) return format.format(-minutes, 'minute');
    if (minutes < 24 * 60) return format.format(-Math.round(minutes / 60), 'hour');
    return format.format(-Math.round(minutes / 1440), 'day');
  };

  App.fmtBytes = function (n) {
    if (n < 1024 * 1024) return App.fmtNum(Math.round(n / 1024)) + ' KB';
    return App.fmtNum(Math.round(n / 1024 / 102.4) / 10) + ' MB';
  };

  // Lower-case and unify Arabic/Persian letter variants and digits, for search.
  const LETTERS = { 'ي': 'ی', 'ى': 'ی', 'ك': 'ک', 'ة': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا' };
  App.normalize = function (s) {
    return String(s || '').toLowerCase()
      .replace(/[ً-ٰٟ‌‍]/g, '')
      .replace(/[يىكةأإآ]/g, c => LETTERS[c])
      .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
      .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
  };

  App.initials = function (name) {
    const words = String(name || '').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase() || '#';
  };

  App.debounce = function (fn, ms) {
    let timer = null;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  };

  App.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const scripts = {};
  App.loadScript = function (src) {
    if (!scripts[src]) {
      scripts[src] = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = resolve;
        el.onerror = () => { delete scripts[src]; reject(new Error('Failed to load ' + src)); };
        document.head.appendChild(el);
      });
    }
    return scripts[src];
  };
})();
