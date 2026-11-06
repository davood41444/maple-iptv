/* Shared interface pieces: icons, the top bar, toasts, loading and modal dialogs. */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const t = App.t;

  App.icons = {
    tv: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4.5" width="20" height="13.5" rx="2.6" fill="currentColor"/><path d="M10 8.6l5.2 2.65L10 13.9z" fill="var(--bg)"/><rect x="8" y="19.4" width="8" height="1.9" rx=".95" fill="currentColor"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h11M19 7h2M3 17h4M12 17h9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="16.5" cy="7" r="2.6" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="9.5" cy="17" r="2.6" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.9l2.8 5.7 6.3.9-4.6 4.5 1.1 6.3L12 17.3l-5.6 3 1.1-6.3-4.6-4.5 6.3-.9z" stroke-linejoin="round"/></svg>',
    globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    film: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7.5 3v18M16.5 3v18M3 8h4.5M3 12h4.5M3 16h4.5M16.5 8H21M16.5 12H21M16.5 16H21" stroke="currentColor" stroke-width="2"/></svg>',
    series: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6.5" width="19" height="13.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 3.2h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 10.2l5 3-5 3z" fill="currentColor"/></svg>',
    list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M16 14.5l5 3-5 3z" fill="currentColor"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5l13 7.5-13 7.5z" fill="currentColor"/></svg>',
    restart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M4.5 3.5V8H9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    trailer: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 9l5 3-5 3z" fill="currentColor"/></svg>',
  };

  App.icons.lock = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';
  App.icons.sort = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v15M3.5 15.5L7 19l3.5-3.5M13 6h8M13 11h6M13 16h4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  App.icons.refresh = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M19.5 3.5V8H15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  App.icons.phone = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.5 18.5h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  // A category row: name, then its size, or a lock while parental control hides it.
  App.groupRow = g => '<span class="g-name"><span>' + App.esc(g.label) + '</span></span>' +
    (g.locked ? '<span class="g-lock">' + App.icons.lock + '</span>' : '<span class="g-count">' + App.fmtNum(g.count) + '</span>');

  App.icons.person = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4.2" fill="currentColor"/><path d="M3.8 21c.8-4.6 4.2-7 8.2-7s7.4 2.4 8.2 7z" fill="currentColor"/></svg>';
  App.icons.pause ='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>';
  App.icons.prev = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 5h2.4v14H5.5zM19.5 5v14L9 12z" fill="currentColor"/></svg>';
  App.icons.next = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.1 5h2.4v14h-2.4zM4.5 5L15 12 4.5 19z" fill="currentColor"/></svg>';
  App.icons.back = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4.5L7.5 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  App.icons.download = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  App.icons.check = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  App.icons.folder = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5V17.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  App.icons.trash = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 12.5h9L17.5 7M10 10.5v6M14 10.5v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  App.icons.home ='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11L12 4l8.5 7M6 9.5V20h4.5v-5.5h3V20H18V9.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  App.icons.volume = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  App.icons.mute = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  App.icons.fullscreen = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  App.icons.rewind = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a7 7 0 1 0 2.05-4.95" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><path d="M5 3.8V8h4.2" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="15.4" text-anchor="middle" font-size="7.5" font-weight="800" fill="currentColor" font-family="Arial">10</text></svg>';
  App.icons.forward = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.05-4.95" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><path d="M19 3.8V8h-4.2" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="15.4" text-anchor="middle" font-size="7.5" font-weight="800" fill="currentColor" font-family="Arial">10</text></svg>';
  App.icons.subtitles ='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6.5 13.5h4M13 13.5h4.5M6.5 16h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  App.fmtRating = r => App.fmtNum(Math.round(r * 10) / 10);

  // 3725 → "1:02:05", 125 → "2:05"
  App.fmtClock = function (secs) {
    secs = Math.max(0, Math.floor(secs));
    const h = Math.floor(secs / 3600);
    const m = Math.floor(secs / 60) % 60;
    const s = secs % 60;
    const pad = n => (n < 10 ? '0' : '') + n;
    return App.localDigits(h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s));
  };

  // 6300 → "1h 45m" (localised)
  App.fmtDuration = function (secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.round(secs / 60) % 60;
    return h ? App.t('time.hm', { h: App.fmtNum(h), m: App.fmtNum(m) }) : App.t('time.m', { m: App.fmtNum(m) });
  };

  let toastTimer = null;

  App.ui = {
    header(title, actions) {
      return h('header', { class: 'topbar' }, [
        // The Windows/Mac app has a Back button for the mouse (the remote's Back elsewhere).
        App.platform === 'desktop' ? h('button', {
          class: 'topbar-back', title: t('nav.back'), html: App.icons.back, onclick: () => App.keys.press('Back'),
        }) : null,
        h('div', { class: 'brand' }, [
          h('span', { class: 'brand-mark' }, [h('img', { src: 'img/logo-mark.png', alt: '' })]),
          h('span', { class: 'brand-name', text: t('app.name') }),
        ]),
        title ? h('div', { class: 'topbar-title', text: title }) : null,
        h('div', { class: 'topbar-spacer' }),
        h('div', { class: 'topbar-actions' }, actions || []),
        h('div', { class: 'clock', text: App.fmtTime(new Date()) }),
      ]);
    },

    // One row of a channel list: logo (initials until it loads), name with what's on now
    // underneath, favourite star. Channels outside the free version show a lock.
    channelRow(c, favorite) {
      const logo = c.logo ? '<img src="' + App.esc(c.logo) + '" alt="" onerror="this.remove()">' : '';
      const locked = App.premium && !App.premium.canPlayChannel(c);
      const now = App.ui.nowTitle(c);
      return '<span class="ch-logo"><span class="ch-initials">' + App.esc(App.initials(c.name)) + '</span>' + logo + '</span>' +
        '<span class="ch-text"><span class="ch-name"><span>' + App.esc(c.name) + '</span></span>' +
        (now == null ? '' : '<span class="ch-sub">' + App.esc(now) + '</span>') + '</span>' +
        (locked ? '<span class="ch-lock">' + App.icons.lock + '</span>' : '') +
        '<span class="ch-fav' + (favorite ? ' on' : '') + '">' + App.icons.star + '</span>';
    },

    // The programme on now from the guide already fetched: a title, "no programme",
    // '' while not fetched yet, or null when the playlist has no guide.
    nowTitle(c) {
      const source = App.state.source;
      if (!source || source.type !== 'xtream' || !c.streamId) return null;
      const items = App.sources.cachedNowNext(source, c);
      if (!items) return '';
      const time = Date.now();
      const current = items.find(e => e.start <= time && e.end > time);
      return current ? current.title : t('live.noProgram');
    },

    // Fetches what's on now for the channel rows on screen once the list stops moving,
    // a few at a time, and redraws those rows.
    loadRowGuide(list) {
      clearTimeout(list.guideTimer);
      list.guideTimer = setTimeout(() => {
        const source = App.state.source;
        if (!source || source.type !== 'xtream') return;
        const queue = [];
        const end = Math.min(list.items.length, Math.ceil(list.top) + list.visibleCount() + 1);
        for (let i = Math.max(0, Math.floor(list.top)); i < end; i++) {
          const c = list.items[i];
          if (!c || !c.streamId) continue;
          if (!App.sources.cachedNowNext(source, c)) queue.push(i);
          // Fetched meanwhile by someone else (the preview): just redraw.
          else if (list.rows.get(i) && list.rows.get(i).querySelector('.ch-sub:empty')) list.refreshRow(i);
        }
        const worker = async () => {
          while (queue.length) {
            const i = queue.shift();
            const c = list.items[i];
            await App.sources.nowNext(source, c);
            if (list.items[i] === c) list.refreshRow(i);
          }
        };
        for (let n = 0; n < 3; n++) worker();
      }, 400);
    },

    // "Now" (with progress) and "Next" programme lines from App.sources.nowNext().
    epgHtml(items) {
      if (!items || !items.length) return '';
      const now = Date.now();
      const current = items.find(e => e.start <= now && e.end > now) || items[0];
      const next = items.find(e => e.start >= current.end);
      const span = e => App.fmtTime(new Date(e.start)) + ' – ' + App.fmtTime(new Date(e.end));
      const progress = Math.max(0, Math.min(100, (now - current.start) / (current.end - current.start) * 100));
      let html = '<div class="epg-line"><span class="epg-label">' + t('player.now') + '</span><span class="epg-title">' +
        App.esc(current.title) + '</span><span class="epg-time">' + span(current) + '</span></div>' +
        '<div class="epg-progress"><span style="width:' + progress.toFixed(1) + '%"></span></div>';
      if (next) {
        html += '<div class="epg-line next"><span class="epg-label">' + t('player.next') + '</span><span class="epg-title">' +
          App.esc(next.title) + '</span><span class="epg-time">' + span(next) + '</span></div>';
      }
      return html;
    },

    iconButton(icon, label, onclick, extraClass) {
      return h('button', {
        class: 'btn icon-btn focusable ' + (extraClass || ''),
        html: App.icons[icon] + '<span>' + App.esc(label) + '</span>',
        onclick: onclick,
      });
    },

    toast(message, kind) {
      const el = document.getElementById('toast');
      el.textContent = message;
      el.className = 'show ' + (kind || '');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.className = ''; }, kind === 'error' ? 6000 : 3000);
    },

    // loading('Text') shows the overlay, loading(false) hides it.
    loading(text) {
      const el = document.getElementById('loading');
      el.classList.toggle('hidden', text === false);
      if (text !== false) el.querySelector('.loading-text').textContent = text || '';
    },

    confirm(message, okLabel, cancelLabel) {
      return modal((box, close) => {
        box.appendChild(h('div', { class: 'modal-text', text: message }));
        box.appendChild(h('div', { class: 'modal-actions' }, [
          h('button', { class: 'btn primary focusable initial-focus', text: okLabel || t('common.ok'), onclick: () => close(true) }),
          h('button', { class: 'btn focusable', text: cancelLabel || t('common.cancel'), onclick: () => close(false) }),
        ]));
      }).then(Boolean);
    },

    // Four-digit PIN: the remote's number keys or the on-screen keypad. Resolves to the PIN or null.
    pin(title) {
      let value = '';
      let dots;
      let close;
      let finished = false;
      const done = result => {
        if (finished) return;
        finished = true;
        close(result);
      };
      const render = () => {
        Array.prototype.forEach.call(dots.children, (dot, i) => dot.classList.toggle('filled', i < value.length));
        if (value.length === 4) setTimeout(() => done(value), 150);
      };
      const press = key => {
        if (key === 'del') value = value.slice(0, -1);
        else if (value.length < 4) value += key;
        render();
      };
      return modal((box, closeModal) => {
        close = closeModal;
        box.classList.add('pin-modal');
        box.appendChild(h('div', { class: 'modal-title', text: title }));
        dots = h('div', { class: 'pin-dots' }, [0, 1, 2, 3].map(() => h('span')));
        box.appendChild(dots);
        const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
        box.appendChild(h('div', { class: 'pin-pad' }, keys.map(key => h('button', {
          class: 'btn focusable' + (key === '1' ? ' initial-focus' : ''),
          text: key === 'del' ? '⌫' : (key === 'ok' ? t('common.ok') : App.localDigits(key)),
          onclick: () => {
            if (key === 'ok') done(value.length === 4 ? value : null);
            else press(key);
          },
        }))));
      }, name => {
        if (/^Digit/.test(name)) {
          press(name.slice(5));
          return true;
        }
        if (name === 'Back') {
          done(null);
          return true;
        }
        return false;
      });
    },

    // A message with an OK button; lines are shown one per row.
    info(title, lines) {
      return modal((box, close) => {
        box.appendChild(h('div', { class: 'modal-title', text: title }));
        lines.forEach(line => box.appendChild(h('div', { class: 'modal-line', dir: 'auto', text: line })));
        box.appendChild(h('div', { class: 'modal-actions' }, [
          h('button', { class: 'btn primary focusable', text: t('common.ok'), onclick: () => close(true) }),
        ]));
      });
    },

    // options: [{ value, label }]; resolves to the chosen value, or null.
    choose(title, options, current) {
      return modal((box, close) => {
        box.appendChild(h('div', { class: 'modal-title', text: title }));
        box.appendChild(h('div', { class: 'modal-options' }, options.map(o => h('button', {
          class: 'btn option focusable' + (o.value === current ? ' selected initial-focus' : ''),
          text: o.label,
          onclick: () => close(o.value),
        }))));
      });
    },
  };

  // build(box, close) fills the dialog; onKey(name) may handle keys first.
  function modal(build, onKey) {
    return new Promise(resolve => {
      const previous = App.focus.current;
      const box = h('div', { class: 'modal' });
      const backdrop = h('div', { class: 'modal-backdrop' }, [box]);
      const overlay = {
        el: backdrop,
        onKey(name) {
          if (onKey && onKey(name)) return true;
          if (name !== 'Back') return false;
          close(null);
          return true;
        },
      };
      function close(value) {
        App.router.popOverlay(overlay);
        backdrop.remove();
        App.focus.set(previous && document.body.contains(previous) ? previous : null);
        resolve(value);
      }
      build(box, close);
      document.getElementById('overlays').appendChild(backdrop);
      App.router.pushOverlay(overlay);
      App.focus.set(box.querySelector('.initial-focus') || box.querySelector('.focusable'));
    });
  }

  /*
   * Typing a channel number with the remote: digits collect in `el`, and
   * onDone(number) fires after a short pause or on commit().
   */
  function NumberEntry(el, onDone) {
    this.el = el;
    this.onDone = onDone;
    this.value = '';
    this.timer = null;
  }

  NumberEntry.prototype = {
    get active() {
      return this.value !== '';
    },
    push(digit) {
      if (this.value.length >= 5) return;
      this.value += digit;
      this.el.textContent = App.localDigits(this.value);
      this.el.classList.remove('hidden');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.commit(), 1500);
    },
    commit() {
      const n = parseInt(this.value, 10);
      this.cancel();
      if (n > 0) this.onDone(n);
    },
    cancel() {
      clearTimeout(this.timer);
      this.value = '';
      this.el.classList.add('hidden');
    },
  };

  App.NumberEntry = NumberEntry;
})();
