(function () {
  'use strict';
  const App = window.App;
  App.locales = App.locales || {};

  const i18n = App.i18n = {
    lang: 'en',

    // To add a language: create js/locales/<code>.js, load it in index.html, and list it here.
    languages: [
      { code: 'en', name: 'English', dir: 'ltr' },
      { code: 'fa', name: 'فارسی', dir: 'rtl' },
      { code: 'fr', name: 'Français', dir: 'ltr' },
      { code: 'es', name: 'Español', dir: 'ltr' },
      { code: 'ar', name: 'العربية', dir: 'rtl' },
      { code: 'zh', name: '中文', dir: 'ltr' },
      { code: 'tr', name: 'Türkçe', dir: 'ltr' },
    ],

    // t('sources.expires', { date: '…' }) — falls back to English, then to the key itself.
    t(key, params) {
      let s = (App.locales[i18n.lang] || {})[key];
      if (s == null) s = (App.locales.en || {})[key];
      if (s == null) return key;
      if (params) s = s.replace(/\{(\w+)\}/g, (m, name) => (params[name] != null ? params[name] : m));
      return s;
    },

    setLang(code) {
      const lang = i18n.languages.find(l => l.code === code) || i18n.languages[0];
      i18n.lang = lang.code;
      document.documentElement.lang = lang.code;
      document.documentElement.dir = lang.dir;
      App.events.emit('lang', lang.code);
    },

    isRtl() {
      return document.documentElement.dir === 'rtl';
    },

    // Arrow keys that point forward/backward in reading order.
    forwardKey() { return i18n.isRtl() ? 'Left' : 'Right'; },
    backwardKey() { return i18n.isRtl() ? 'Right' : 'Left'; },
  };

  App.t = i18n.t;
})();
