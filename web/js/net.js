(function () {
  'use strict';
  const App = window.App;

  // A Tizen app may request any origin allowed in its config.xml. Everywhere
  // else, IPTV servers' missing CORS headers (and plain http) get in the way,
  // so requests go through the host's /proxy endpoint: HttpProxy.kt on
  // Android, tools/dev-server.js in a desktop browser.
  function requestUrl(url, ua) {
    if (App.platform === 'tizen') return url;
    return '/proxy?url=' + encodeURIComponent(url) + (ua ? '&ua=' + encodeURIComponent(ua) : '');
  }

  function netError(kind, status) {
    const error = new Error(App.t('err.' + kind, { status: status }));
    error.kind = kind;
    return error;
  }

  App.net = {
    netError: netError,

    getText(url, opts) {
      opts = opts || {};
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', requestUrl(url, opts.ua), true);
        xhr.timeout = opts.timeout || 60000;
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
          else if (xhr.status === 502 || xhr.status === 0) reject(netError('network'));
          else reject(netError('http', xhr.status));
        };
        xhr.onerror = () => reject(netError('network'));
        xhr.ontimeout = () => reject(netError('timeout'));
        if (opts.onProgress) xhr.onprogress = e => opts.onProgress(e.loaded);
        xhr.send();
      });
    },

    getJson(url, opts) {
      return App.net.getText(url, opts).then(text => {
        try {
          return JSON.parse(text);
        } catch (e) {
          throw netError('parse');
        }
      });
    },
  };
})();
